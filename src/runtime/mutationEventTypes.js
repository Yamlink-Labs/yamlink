'use strict';

// Canonical registry of every mutation-log event type in the system. Every
// site that calls appendMutationEvents()/emitOutcomeEvent() should emit a
// `type` from this list — before this module existed, the real vocabulary
// only existed as convention, scattered across ~15 emission sites with no
// single source of truth (confirmed by grep, not assumed). This module is
// documentation-grade: it does not gate what appendMutationEvents() accepts
// (see mutationEventLog.js — deliberately permissive on the hot write path),
// but it is the canonical list CODEX.md's MutationEvent contract and
// docs/architecture/TIME-ENGINE.md both point back to, and the place a new
// event type should be added and described before it's used anywhere.
//
// Categories:
// - structural:  note/field/relation/type lifecycle — the backbone the Time
//                Engine's backward-undo reconstruction is built on
//                (VALUE_EVENT_TYPES in core/timeEngine.js is a subset of these)
// - outcome:     user feedback on a system suggestion/prediction — the signal
//                outcomeCalibration.js and implicitWeights.js learn from
//                (OUTCOME_EVENT_TYPES in mutationEventLog.js enforces this
//                subset at emitOutcomeEvent() call sites)
// - task:        checklist state changes inside note bodies
// - telemetry:   UI interaction events (query builder, live note panel) —
//                narrative/session-shaping signal, not vault-content mutation

const MUTATION_EVENT_TYPES = new Map([
    // ── Structural — note/field/relation/type lifecycle ────────────────────
    ['note_created', {
        category: 'structural',
        description: 'A new note was indexed for the first time (or an id was reused after a prior note with that id was deleted).',
        reconstructable: false // no field snapshot is ever captured on creation
    }],
    ['note_deleted', {
        category: 'structural',
        description: 'A previously-indexed note was removed from the vault.',
        reconstructable: false
    }],
    ['note_touched', {
        category: 'structural',
        description: 'A note was saved with no detected field/type/relation change (body-only edit, or a no-op save). Feeds staleness/lifecycle signals.',
        reconstructable: false
    }],
    ['field_added', {
        category: 'structural',
        description: 'A non-relation frontmatter field went from absent to present.',
        reconstructable: true
    }],
    ['field_changed', {
        category: 'structural',
        description: 'A non-relation frontmatter field\'s value changed.',
        reconstructable: true
    }],
    ['field_removed', {
        category: 'structural',
        description: 'A non-relation frontmatter field went from present to absent.',
        reconstructable: true
    }],
    ['type_set', {
        category: 'structural',
        description: 'The note\'s `type:` field changed. Owns the synthetic field name \'type\' rather than being folded into field_changed, since id/type are excluded from the generic per-field loop in core/index.js.',
        reconstructable: true
    }],
    ['relation_added', {
        category: 'structural',
        description: 'A relation-valued field (one whose value resolves to wikilink targets) gained its first target. Emitted alongside the field-level event for the same change — canonicalized/lossy compared to it.',
        reconstructable: false // deliberately excluded from Time Engine value reconstruction — see timeEngine.js
    }],
    ['relation_changed', {
        category: 'structural',
        description: 'A relation-valued field\'s target set changed (still has at least one target before and after).',
        reconstructable: false
    }],
    ['relation_removed', {
        category: 'structural',
        description: 'A relation-valued field lost its last target.',
        reconstructable: false
    }],

    // ── Task — checklist state inside note bodies ───────────────────────────
    ['task_state_changed', {
        category: 'task',
        description: 'A `!view` table task checkbox was toggled from the live table UI.',
        reconstructable: false
    }],
    ['task_status_changed', {
        category: 'task',
        description: 'A task\'s status field (beyond simple checkbox done/undone) changed.',
        reconstructable: false
    }],

    // ── Outcome — user feedback on a system suggestion/prediction ──────────
    // This subset is enforced at runtime: emitOutcomeEvent() in
    // mutationEventLog.js silently no-ops for any type not in this category.
    ['completion_accepted', {
        category: 'outcome',
        description: 'A frontmatter completion suggestion was accepted. Primary signal for outcomeCalibration.js\'s per-field confidence boost.',
        reconstructable: false
    }],
    ['lightbulb_applied', {
        category: 'outcome',
        description: 'A code-action quick fix (missing-field, schema-repair, etc.) was applied.',
        reconstructable: false
    }],
    ['suggestion_ignored', {
        category: 'outcome',
        description: 'A surfaced suggestion was dismissed/ignored rather than accepted — negative calibration signal.',
        reconstructable: false
    }],
    ['template_applied', {
        category: 'outcome',
        description: 'A Smart Template was applied to a note (via note creation or a code action).',
        reconstructable: false
    }],
    ['template_fields_filled', {
        category: 'outcome',
        description: 'A template\'s prompted fields were filled in during creation.',
        reconstructable: false
    }],
    ['block_reference_created', {
        category: 'outcome',
        description: 'A `note^blockId`/`note#Heading` block or section reference was inserted via a copy/insert command. Not yet surfaced in the activity feed or Note Report History tab — logged for future calibration and intelligence use (see ARCHITECTURE.md).',
        reconstructable: false
    }],

    // ── Telemetry — UI interaction, not vault-content mutation ─────────────
    ['query_builder_opened', { category: 'telemetry', description: 'The visual query builder panel was opened.', reconstructable: false }],
    ['query_builder_applied', { category: 'telemetry', description: 'A query built in the visual query builder was applied/run.', reconstructable: false }],
    ['query_builder_copied', { category: 'telemetry', description: 'A query built in the visual query builder was copied to clipboard.', reconstructable: false }],
    ['query_builder_preview_opened', { category: 'telemetry', description: 'The visual query builder\'s live preview was expanded.', reconstructable: false }],
    ['live_note_opened', { category: 'telemetry', description: 'The Live Note rendered sidecar was opened for a note.', reconstructable: false }],
    ['live_note_open_report', { category: 'telemetry', description: 'Note Report was opened from the Live Note sidecar.', reconstructable: false }],
    ['live_note_reveal_source', { category: 'telemetry', description: 'Jumped from the Live Note sidecar back to the source Markdown.', reconstructable: false }]
]);

/** @param {string} type @returns {boolean} */
function isKnownMutationEventType(type) {
    return MUTATION_EVENT_TYPES.has(type);
}

/** @param {string} category @returns {string[]} */
function getMutationEventTypesByCategory(category) {
    return [...MUTATION_EVENT_TYPES.entries()]
        .filter(([, meta]) => meta.category === category)
        .map(([type]) => type);
}

module.exports = {
    MUTATION_EVENT_TYPES,
    isKnownMutationEventType,
    getMutationEventTypesByCategory
};
