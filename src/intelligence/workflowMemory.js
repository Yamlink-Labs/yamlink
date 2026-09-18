'use strict';

const TRACKED_EVENT_TYPES = new Set(['field_added', 'relation_added']);
const TYPE_EVENT_TYPES = new Set(['type_set', 'field_added', 'field_changed']);
const EXCLUDED_FIELDS = new Set(['id', 'type', 'created']);
const DEFAULT_SESSION_WINDOW_MINUTES = 15;
const DEFAULT_MIN_RATIO = 0.6;
const DEFAULT_MIN_COUNT = 2;

function normalizeField(field) {
    return String(field || '').trim().toLowerCase();
}

function normalizeType(type) {
    return String(type || '').trim().toLowerCase();
}

function eventTime(event) {
    const value = Date.parse(event?.timestamp || '');
    return Number.isFinite(value) ? value : 0;
}

function fallbackTypeFor(noteId, fieldsCache) {
    if (!fieldsCache || typeof fieldsCache.get !== 'function') return '';
    return normalizeType(fieldsCache.get(noteId)?.type);
}

function updateTypeFromEvent(currentType, event) {
    const field = normalizeField(event?.field);
    if (event?.type === 'type_set' || (TYPE_EVENT_TYPES.has(event?.type) && field === 'type')) {
        return normalizeType(event?.newValue) || currentType;
    }
    return currentType;
}

function shouldTrackFieldEvent(event) {
    if (!TRACKED_EVENT_TYPES.has(event?.type)) return false;
    const field = normalizeField(event.field);
    if (!field || EXCLUDED_FIELDS.has(field) || field.startsWith('__')) return false;
    return true;
}

function finishSession(session, sessions) {
    if (!session || session.fields.size < 1 || !session.type) return;
    sessions.push({
        noteId: session.noteId,
        type: session.type,
        fields: [...session.fields].sort(),
        startedAt: session.startedAt,
        endedAt: session.endedAt
    });
}

function buildAuthoringSessions(events, options = {}) {
    const fieldsCache = options.fieldsCache || null;
    const windowMs = Math.max(1, Number(options.sessionWindowMinutes || DEFAULT_SESSION_WINDOW_MINUTES)) * 60 * 1000;
    const byNote = new Map();
    for (const event of events || []) {
        const noteId = String(event?.noteId || '').trim();
        if (!noteId) continue;
        if (!byNote.has(noteId)) byNote.set(noteId, []);
        byNote.get(noteId).push(event);
    }

    const sessions = [];
    for (const [noteId, noteEvents] of byNote) {
        noteEvents.sort((a, b) => eventTime(a) - eventTime(b));
        let currentType = fallbackTypeFor(noteId, fieldsCache);
        let session = null;

        for (const event of noteEvents) {
            const timestamp = eventTime(event);
            currentType = updateTypeFromEvent(currentType, event);
            if (!shouldTrackFieldEvent(event)) continue;

            const field = normalizeField(event.field);
            if (!session || timestamp - session.lastTime > windowMs) {
                finishSession(session, sessions);
                session = {
                    noteId,
                    type: currentType || fallbackTypeFor(noteId, fieldsCache),
                    fields: new Set(),
                    startedAt: event.timestamp || null,
                    endedAt: event.timestamp || null,
                    lastTime: timestamp
                };
            }

            if (!session.type) session.type = currentType || fallbackTypeFor(noteId, fieldsCache);
            session.fields.add(field);
            session.lastTime = timestamp;
            session.endedAt = event.timestamp || session.endedAt;
        }
        finishSession(session, sessions);
    }

    return sessions;
}

function pairKey(a, b) {
    return [a, b].sort().join('\x00');
}

function pairFromKey(key) {
    const [fieldA, fieldB] = key.split('\x00');
    return { fieldA, fieldB };
}

function buildFieldCoOccurrenceMemory(mutationEvents, options = {}) {
    const minRatio = Number.isFinite(options.minRatio) ? options.minRatio : DEFAULT_MIN_RATIO;
    const minCount = Number.isFinite(options.minCount) ? options.minCount : DEFAULT_MIN_COUNT;
    const sessions = buildAuthoringSessions(mutationEvents, options);
    const byType = new Map();

    for (const session of sessions) {
        if (!byType.has(session.type)) {
            byType.set(session.type, { sessionCount: 0, pairCounts: new Map() });
        }
        const bucket = byType.get(session.type);
        bucket.sessionCount += 1;
        const fields = [...new Set(session.fields)].sort();
        for (let i = 0; i < fields.length; i++) {
            for (let j = i + 1; j < fields.length; j++) {
                const key = pairKey(fields[i], fields[j]);
                bucket.pairCounts.set(key, (bucket.pairCounts.get(key) || 0) + 1);
            }
        }
    }

    const memory = new Map();
    for (const [type, bucket] of byType) {
        const rows = [];
        for (const [key, count] of bucket.pairCounts) {
            const ratio = bucket.sessionCount > 0 ? count / bucket.sessionCount : 0;
            if (ratio < minRatio || count < minCount) continue;
            const pair = pairFromKey(key);
            rows.push({
                ...pair,
                coOccurrenceRatio: ratio,
                count,
                sessionCount: bucket.sessionCount
            });
        }
        rows.sort((a, b) => (
            (b.coOccurrenceRatio * b.sessionCount) - (a.coOccurrenceRatio * a.sessionCount)
            || b.count - a.count
            || a.fieldA.localeCompare(b.fieldA)
            || a.fieldB.localeCompare(b.fieldB)
        ));
        if (rows.length) memory.set(type, rows);
    }

    return memory;
}

function findCoOccurringField(memory, noteType, acceptedField, existingFields = {}) {
    const type = normalizeType(noteType);
    const field = normalizeField(acceptedField);
    if (!type || !field) return null;
    const existing = new Set(Object.keys(existingFields || {}).map(normalizeField));
    for (const pair of memory.get(type) || []) {
        const other = pair.fieldA === field ? pair.fieldB : pair.fieldB === field ? pair.fieldA : '';
        if (other && !existing.has(other)) return { ...pair, field: other };
    }
    return null;
}

module.exports = {
    buildAuthoringSessions,
    buildFieldCoOccurrenceMemory,
    findCoOccurringField
};
