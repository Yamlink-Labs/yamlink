'use strict';

/**
 * @typedef {import('../runtime/mutationEventLog').MutationEvent} MutationEvent
 * @typedef {{
 *   exists: boolean,
 *   reason?: 'not-yet-created'|'already-deleted'|'deleted'|'no-history',
 *   fields: Record<string, any>|null,
 *   complete: boolean,
 *   earliestReconstructableTimestamp: string|null,
 *   deletedAt?: string
 * }} NoteReconstruction
 * @typedef {{
 *   timestamp: string, type: string, field: string,
 *   oldValue: any, newValue: any, fieldsAfter: Record<string, any>
 * }} TimelineCheckpoint
 * @typedef {{
 *   exists: boolean,
 *   reason?: 'already-deleted'|'deleted'|'no-history',
 *   checkpoints: TimelineCheckpoint[],
 *   complete: boolean,
 *   earliestReconstructableTimestamp: string|null
 * }} NoteTimeline
 */

// Time Engine — historical state reconstruction from the mutation log.
//
// The core constraint that shapes everything here: note_created and
// note_deleted events carry no field snapshot at all — every emission site
// (src/core/index.js, src/api/handlers/nodes.js, src/intelligence/
// gitHistoryImport.js) sets `field: null, oldValue: null, newValue: null`.
// The mutation log only ever records *deltas* (field_added/field_changed/
// field_removed/type_set), never a full point-in-time snapshot. That makes
// forward replay from vault genesis impossible in general — we have no way
// to know a note's initial field set, only what changed afterward.
//
// The only approach that's actually correct given this data model is
// backward reconstruction: start from the note's real current fields (the
// one full, trustworthy snapshot we always have), then undo every recorded
// mutation newer than the target timestamp, in reverse chronological order,
// using each event's oldValue. A field with zero recorded history is assumed
// unchanged since creation — current value equals past value, because
// nothing on record suggests otherwise. The only genuine uncertainty is
// whether the log's retention window (10,000-event rolling cap in
// mutationEventLog.js) reaches back far enough to guarantee that; this
// module reports that honestly via `complete`/`earliestReconstructableTimestamp`
// rather than presenting a possibly-partial reconstruction as certain.
//
// relation_added/relation_changed/relation_removed are deliberately excluded
// from value reconstruction. buildMutationEvents() (core/index.js) emits them
// *alongside* field_added/field_changed/field_removed for the same field
// change on relation-valued fields, but their oldValue/newValue are a
// canonicalized, comma-joined list of extracted target ids — lossy compared
// to the field-level event's raw frontmatter value. The field-level event is
// always the source of truth; the relation-level event exists for edge/graph
// bookkeeping, not value history. type_set is the one event kind that owns
// its own field ('type'), since buildMutationEvents() explicitly excludes
// the id/type keys from its generic per-field loop.
//
// Deleted notes cannot be reconstructed at all: with no field snapshot ever
// captured, there is no record of what a deleted note's content actually
// was. This module says so honestly (`reason: 'deleted'`) rather than
// guessing or silently returning null.

const VALUE_EVENT_TYPES = new Set(['field_added', 'field_changed', 'field_removed', 'type_set']);

// Duplicated from core/index.js's own BODY_LINKS_FIELD constant, deliberately
// not imported — this file is documented as having zero requires (pure,
// dependency-free), and core/index.js is a heavy, non-pure module (fs,
// js-yaml, etc.). It's one literal string, not real coupling.
const BODY_LINKS_FIELD = '__body_links__';

function eventField(event) {
    return event.type === 'type_set' ? 'type' : event.field;
}

function byTimestampAsc(a, b) {
    return String(a.timestamp).localeCompare(String(b.timestamp));
}

/**
 * @param {MutationEvent[]} events
 * @returns {Map<string, MutationEvent[]>} noteId -> that note's events, sorted ascending by timestamp
 */
function groupEventsByNote(events) {
    const groups = new Map();
    for (const event of events || []) {
        if (!event || !event.noteId) continue;
        if (!groups.has(event.noteId)) groups.set(event.noteId, []);
        groups.get(event.noteId).push(event);
    }
    for (const list of groups.values()) list.sort(byTimestampAsc);
    return groups;
}

/**
 * Exact-match lookup against persisted Time Engine snapshots (see
 * src/core/vaultSnapshots.js). A snapshot only ever answers "the vault's
 * exact recorded state at timestamp T" — it deliberately does NOT support
 * interpolating between two snapshots, or between a snapshot and the nearest
 * retained delta, since the deltas that would make that safe are exactly
 * the ones pruned once a newer snapshot supersedes them. An exact match is
 * the only case where using a snapshot can never be a guess.
 *
 * @param {Array<{timestamp: string, notes: Record<string, any>}>} snapshots
 * @param {string} noteId
 * @param {string} atTimestamp
 * @returns {{found: boolean, exists?: boolean, fields?: Record<string, any>|null}}
 */
function _findExactSnapshot(snapshots, noteId, atTimestamp) {
    for (const snapshot of snapshots || []) {
        if (snapshot.timestamp !== atTimestamp) continue;
        if (!Object.prototype.hasOwnProperty.call(snapshot.notes, noteId)) {
            return { found: true, exists: false };
        }
        const fields = snapshot.notes[noteId];
        return { found: true, exists: true, fields: fields === null ? null : fields };
    }
    return { found: false };
}

/**
 * Core reconstruction logic, given this note's own events already filtered
 * and sorted ascending by timestamp. Split out from reconstructNoteAtTime so
 * reconstructVaultAtTime can group the full log by noteId once (O(events))
 * instead of re-filtering the whole log per note (O(notes × events)) — the
 * difference matters directly for the x-graph time-lapse consumer, which
 * calls whole-vault reconstruction repeatedly across many timestamps.
 *
 * @param {string} noteId
 * @param {string} atTimestamp
 * @param {Record<string, any>|null|undefined} currentFields
 * @param {MutationEvent[]} noteEvents already filtered to one noteId, sorted ascending
 * @param {Array<{timestamp: string, notes: Record<string, any>}>} [snapshots] optional persisted Time Engine snapshots, checked for an exact timestamp match before falling back to live backward-undo
 * @param {string} [currentBodyLinks] the note's CURRENT body-text-mention value (core/index.js's bodyLinksCache), injected as a synthetic starting field so field_added/changed/removed events recorded against BODY_LINKS_FIELD can be undone the same way any real field is — this is Time Engine-only, never part of fieldsCache itself
 * @returns {NoteReconstruction}
 */
function _reconstructFromNoteEvents(noteId, atTimestamp, currentFields, noteEvents, snapshots, currentBodyLinks) {
    // An exact snapshot match is authoritative and short-circuits everything
    // below — including cases live backward-undo can never answer today,
    // like a deleted note's actual field values, if a snapshot happened to
    // capture them before the deletion.
    if (snapshots && snapshots.length) {
        const exact = _findExactSnapshot(snapshots, noteId, atTimestamp);
        if (exact.found) {
            return exact.exists
                ? { exists: true, fields: exact.fields, complete: true, earliestReconstructableTimestamp: atTimestamp }
                : { exists: false, reason: 'no-history', fields: null, complete: true, earliestReconstructableTimestamp: null };
        }
    }

    // Use the MOST RECENT note_created event, not the first ever — a note id
    // can be deleted and later reused by a brand-new note. Treating the
    // whole id's history as one continuous lifeline would incorrectly bleed
    // a prior incarnation's field history into the current one.
    const createdEvents = noteEvents.filter((e) => e.type === 'note_created');
    const createdEvent = createdEvents.length ? createdEvents[createdEvents.length - 1] : null;
    const deletedEvent = [...noteEvents].reverse().find((e) => e.type === 'note_deleted') || null;

    if (!currentFields) {
        if (deletedEvent && deletedEvent.timestamp <= atTimestamp) {
            // Existed at some point, but was already gone by the target
            // time too — distinct from never-created, though both mean
            // "doesn't exist as of this timestamp."
            return {
                exists: false, reason: 'already-deleted', fields: null,
                complete: true, earliestReconstructableTimestamp: null
            };
        }
        if (deletedEvent) {
            // Existed at the target time — but no field snapshot for a
            // deleted note was ever captured. Honest "we don't know", not a guess.
            return {
                exists: true, reason: 'deleted', fields: null, complete: false,
                earliestReconstructableTimestamp: null, deletedAt: deletedEvent.timestamp
            };
        }
        return {
            exists: false, reason: 'no-history', fields: null,
            complete: true, earliestReconstructableTimestamp: null
        };
    }

    if (createdEvent && createdEvent.timestamp > atTimestamp) {
        return {
            exists: false, reason: 'not-yet-created', fields: null,
            complete: true, earliestReconstructableTimestamp: createdEvent.timestamp
        };
    }

    // Only undo events belonging to the current incarnation — anything at or
    // before a prior creation (if this id was deleted and reused) is a
    // different note's history, not this one's.
    const lifelineEvents = createdEvent
        ? noteEvents.filter((e) => e.timestamp >= createdEvent.timestamp)
        : noteEvents;

    const working = { ...currentFields };
    if (currentBodyLinks !== undefined) working[BODY_LINKS_FIELD] = currentBodyLinks;
    const relevant = lifelineEvents
        .filter((e) => VALUE_EVENT_TYPES.has(e.type) && e.timestamp > atTimestamp)
        .sort((a, b) => byTimestampAsc(b, a));

    for (const event of relevant) {
        const field = eventField(event);
        if (!field) continue;
        if (event.oldValue === null || event.oldValue === undefined) {
            delete working[field];
        } else {
            working[field] = event.oldValue;
        }
    }

    // If we have this incarnation's own creation event, lifelineEvents holds
    // its complete history from birth — nothing before creation could be
    // missing (and nothing from a prior incarnation is mixed in). Otherwise
    // (the created event scrolled off the 10k-event cap, or this note
    // predates the log and was never git-history-backfilled), we're only
    // confident back to the earliest event we still have.
    const earliestEvent = lifelineEvents[0] || null;
    const complete = Boolean(createdEvent) || !earliestEvent || earliestEvent.timestamp <= atTimestamp;

    return {
        exists: true,
        fields: working,
        complete,
        earliestReconstructableTimestamp: earliestEvent ? earliestEvent.timestamp : null
    };
}

/**
 * Reconstruct a single note's fields as of `atTimestamp`.
 *
 * @param {string} noteId
 * @param {string} atTimestamp ISO-8601 timestamp to reconstruct state at
 * @param {Record<string, any>|null|undefined} currentFields the note's current fieldsCache entry, or null/undefined if it no longer exists
 * @param {MutationEvent[]} allEvents the full retained mutation log (any order, any noteId — filtered internally)
 * @param {Array<{timestamp: string, notes: Record<string, any>}>} [snapshots] optional persisted Time Engine snapshots (src/core/vaultSnapshots.js) — extends reconstruction to exact snapshot-boundary timestamps older than the retained delta window
 * @param {string} [currentBodyLinks] see _reconstructFromNoteEvents's own doc
 * @returns {NoteReconstruction}
 */
function reconstructNoteAtTime(noteId, atTimestamp, currentFields, allEvents, snapshots, currentBodyLinks) {
    const noteEvents = (allEvents || [])
        .filter((e) => e && e.noteId === noteId)
        .sort(byTimestampAsc);
    return _reconstructFromNoteEvents(noteId, atTimestamp, currentFields, noteEvents, snapshots, currentBodyLinks);
}

/**
 * Reconstruct every note's fields as of `atTimestamp` — the whole-vault
 * primitive the future `?at=` graph endpoint sits on top of. Includes notes
 * that no longer exist but are known (via note_created, possibly followed by
 * note_deleted) to have existed at the target time, so a historical vault
 * size/graph doesn't silently undercount deleted notes — those entries carry
 * `exists: true, fields: null` (the "we know it was there, not what it held"
 * case) rather than being omitted.
 *
 * @param {string} atTimestamp
 * @param {{ fieldsCache: Map<string, Record<string, any>>, mutationEvents: MutationEvent[], snapshots?: Array<{timestamp: string, notes: Record<string, any>}>, bodyLinksCache?: Map<string, string> }} context bodyLinksCache is core/index.js's getBodyLinksCache() — optional; omitted entirely for callers that don't care about body-mention edges (vaultTrends.js, healthStats.js, etc.)
 * @returns {Map<string, NoteReconstruction>}
 */
function reconstructVaultAtTime(atTimestamp, { fieldsCache, mutationEvents, snapshots, bodyLinksCache }) {
    const grouped = groupEventsByNote(mutationEvents || []);

    const noteIds = new Set(fieldsCache.keys());
    for (const noteId of grouped.keys()) noteIds.add(noteId);
    if (snapshots && snapshots.length) {
        for (const snapshot of snapshots) {
            for (const noteId of Object.keys(snapshot.notes || {})) noteIds.add(noteId);
        }
    }

    const result = new Map();
    for (const noteId of noteIds) {
        const currentBodyLinks = bodyLinksCache ? bodyLinksCache.get(noteId) : undefined;
        result.set(noteId, _reconstructFromNoteEvents(noteId, atTimestamp, fieldsCache.get(noteId), grouped.get(noteId) || [], snapshots, currentBodyLinks));
    }
    return result;
}

// Sentinel guaranteed to sort lexicographically before any real ISO-8601
// timestamp — used to ask the backward-undo primitive for "the state before
// every retained event," without the off-by-one risk of subtracting a
// millisecond (mutation events from the same write share one timestamp, so a
// note's creation and its first field_added often land on the exact same
// instant — subtracting 1ms could cross that boundary incorrectly).
const EPOCH = '0000-01-01T00:00:00.000Z';

/**
 * Reconstruct a note's full field-value history as a sequence of checkpoints
 * — the layer nearly every Time Engine follow-on (per-field value timelines,
 * lifecycle/drift trajectory, growth-story narration) actually needs: not
 * "what did it look like at one instant" but "how did it get here." Built on
 * top of the same backward-undo primitive rather than a second algorithm —
 * the only new idea here is recovering one known-good anchor state and then
 * forward-replaying newValue across the lifeline from there, which is safe
 * precisely because the anchor is already fully known (either "empty, at
 * birth" when the creation event is retained, or the already-verified
 * backward reconstruction when it isn't).
 *
 * @param {string} noteId
 * @param {Record<string, any>|null|undefined} currentFields
 * @param {MutationEvent[]} allEvents
 * @returns {NoteTimeline}
 */
function buildNoteTimeline(noteId, currentFields, allEvents) {
    const noteEvents = (allEvents || [])
        .filter((e) => e && e.noteId === noteId)
        .sort(byTimestampAsc);

    if (!currentFields) {
        const snapshot = _reconstructFromNoteEvents(noteId, EPOCH, currentFields, noteEvents);
        return {
            exists: snapshot.exists,
            // 'not-yet-created' is only ever returned when currentFields is truthy
            // (see _reconstructFromNoteEvents above) — unreachable in this branch.
            reason: /** @type {'already-deleted'|'deleted'|'no-history'|undefined} */ (snapshot.reason),
            checkpoints: [],
            complete: snapshot.complete,
            earliestReconstructableTimestamp: snapshot.earliestReconstructableTimestamp
        };
    }

    const createdEvents = noteEvents.filter((e) => e.type === 'note_created');
    const createdEvent = createdEvents.length ? createdEvents[createdEvents.length - 1] : null;
    const lifelineEvents = createdEvent
        ? noteEvents.filter((e) => e.timestamp >= createdEvent.timestamp)
        : noteEvents;
    const earliestEvent = lifelineEvents[0] || null;

    let startState;
    if (createdEvent) {
        // A note is definitionally empty before its own first value event —
        // no need to call the undo primitive at all, and calling it with the
        // EPOCH sentinel here would incorrectly trip the "not-yet-created"
        // branch (EPOCH is always earlier than a real createdEvent timestamp).
        startState = {};
    } else if (!earliestEvent) {
        // Never touched, and no creation event on record either — the whole
        // known history is "always looked like this."
        startState = { ...currentFields };
    } else {
        // Creation event scrolled off the retention window (or predates the
        // log). Best-effort anchor: undo everything we do have, back to the
        // earliest retained event — flagged incomplete below.
        const anchor = _reconstructFromNoteEvents(noteId, EPOCH, currentFields, lifelineEvents);
        startState = anchor.exists ? (anchor.fields || {}) : {};
    }

    const valueEvents = lifelineEvents.filter((e) => VALUE_EVENT_TYPES.has(e.type));
    const working = { ...startState };
    const checkpoints = [];
    for (const event of valueEvents) {
        const field = eventField(event);
        if (!field) continue;
        if (event.newValue === null || event.newValue === undefined) {
            delete working[field];
        } else {
            working[field] = event.newValue;
        }
        checkpoints.push({
            timestamp: event.timestamp,
            type: event.type,
            field,
            oldValue: event.oldValue,
            newValue: event.newValue,
            fieldsAfter: { ...working }
        });
    }

    const complete = Boolean(createdEvent) || !earliestEvent;

    return {
        exists: true,
        checkpoints,
        complete,
        earliestReconstructableTimestamp: earliestEvent ? earliestEvent.timestamp : null
    };
}

/**
 * Convenience wrapper over buildNoteTimeline() for the single most-requested
 * follow-on: "how did this one field's value change over time" — e.g.
 * `status: draft (Jan 3) → growing (Feb 1) → consolidated (Mar 15)`.
 *
 * @param {string} noteId
 * @param {string} field
 * @param {Record<string, any>|null|undefined} currentFields
 * @param {MutationEvent[]} allEvents
 * @returns {{ exists: boolean, field: string, history: Array<{timestamp: string, value: any}>, complete: boolean }}
 */
function buildFieldTimeline(noteId, field, currentFields, allEvents) {
    const timeline = buildNoteTimeline(noteId, currentFields, allEvents);
    const history = timeline.checkpoints
        .filter((c) => c.field === field)
        .map((c) => ({ timestamp: c.timestamp, value: c.newValue }));
    return { exists: timeline.exists, field, history, complete: timeline.complete };
}

/**
 * Re-derives graph edges from a whole-vault reconstruction — the live graph
 * module (`src/core/graph.js`) only ever reflects current-state resolved
 * edges, it has no historical concept at all. An edge is only included when
 * its target also existed at the same reconstructed timestamp, so a
 * historical view never shows a dangling link to a note that wasn't there
 * yet (or already gone). Shared by the API's `GET /api/graph?at=` and the
 * CLI's `yamlink graph --at` so both surfaces derive historical edges the
 * same way rather than maintaining two copies of this logic.
 *
 * @param {Map<string, NoteReconstruction>} reconstructed
 * @param {(value: any) => string[]} extractRelationTargets
 * @returns {{nodes: Array<{id: string, type: string|null, complete: boolean}>, edges: Array<{from: string, to: string, field: string}>}}
 */
function buildHistoricalGraph(reconstructed, extractRelationTargets) {
    const nodes = [];
    const edges = [];
    for (const [id, entry] of reconstructed) {
        if (!entry.exists) continue;
        nodes.push({ id, type: entry.fields ? (entry.fields.type || null) : null, complete: entry.complete });
        if (!entry.fields) continue;
        for (const [field, value] of Object.entries(entry.fields)) {
            if (!field || field === 'id' || field === 'type') continue;
            // BODY_LINKS_FIELD is the one deliberate exception to the general
            // "__-prefixed fields are internal, skip them" rule — it's
            // Time Engine-only synthetic data (see core/index.js's
            // bodyLinksCache), not a real frontmatter field, but it DOES need
            // to flow through here to reconstruct body-mention edges.
            if (field !== BODY_LINKS_FIELD && field.startsWith('__')) continue;
            const edgeField = field === BODY_LINKS_FIELD ? 'body' : field;
            for (const targetId of extractRelationTargets(value)) {
                if (reconstructed.has(targetId) && reconstructed.get(targetId).exists) {
                    edges.push({ from: id, to: targetId, field: edgeField });
                }
            }
        }
    }
    return { nodes, edges };
}

module.exports = {
    reconstructNoteAtTime,
    reconstructVaultAtTime,
    buildNoteTimeline,
    buildFieldTimeline,
    buildHistoricalGraph,
    VALUE_EVENT_TYPES
};
