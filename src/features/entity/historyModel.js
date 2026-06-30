'use strict';

const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { getFieldsCache } = require('../../core/indexService');
const { buildSessionNarratives } = require('../../runtime/mutationNarratives');
const { buildNoteEvolution } = require('../../intelligence/noteEvolution');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @param {string} noteId
 * @returns {{ groups: { label: string, events: object[] }[], totalCount: number, arc: object[], sessions: object[], evolution: object|null }}
 */
function buildHistoryModel(noteId) {
    const events = getMutationEvents({ noteId, limit: 200 });
    const totalCount = events.length;
    if (!totalCount) return { groups: [], totalCount: 0, arc: [], sessions: [], evolution: null };
    const fieldsCache = getFieldsCache();

    const now = new Date();
    const todayStr = _localDateStr(now);
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yesterdayStr = _localDateStr(yest);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    const grouped = new Map();
    for (const event of [...events].reverse()) {
        const ts = new Date(event.timestamp);
        const dateStr = _localDateStr(ts);
        let bucket, timeStr;

        if (dateStr === todayStr) {
            bucket = 'Today';
            timeStr = _localTimeStr(ts);
        } else if (dateStr === yesterdayStr) {
            bucket = 'Yesterday';
            timeStr = _localTimeStr(ts);
        } else if (ts >= weekStart) {
            bucket = 'This week';
            timeStr = DAYS[ts.getDay()] + ' ' + _localTimeStr(ts);
        } else {
            bucket = MONTHS[ts.getMonth()] + ' ' + ts.getFullYear();
            timeStr = String(ts.getDate()) + ' ' + MONTHS[ts.getMonth()];
        }

        if (!grouped.has(bucket)) grouped.set(bucket, []);
        grouped.get(bucket).push({ ...event, timeStr });
    }

    return {
        groups: [...grouped.entries()].map(([label, evts]) => ({ label, events: evts })),
        totalCount,
        arc: buildNoteArc(events),
        sessions: buildHistorySessions(events, fieldsCache),
        evolution: buildNoteEvolution(noteId, events)
    };
}

/**
 * Group note events into compact authoring sessions.
 * @param {object[]} events
 * @returns {{ sessionId: string, label: string, count: number, startedAt: string, endedAt: string, durationMinutes: number, topTypes: string[], sources: string[] }[]}
 */
function buildHistorySessions(events, fieldsCache = null) {
    if (!Array.isArray(events) || !events.length) return [];
    const buckets = new Map();

    for (const event of events) {
        const sessionId = String(event?.sessionId || '').trim();
        if (!sessionId) continue;
        if (!buckets.has(sessionId)) buckets.set(sessionId, []);
        buckets.get(sessionId).push(event);
    }

    return [...buckets.entries()]
        .map(([sessionId, sessionEvents]) => buildSessionSummary(sessionId, sessionEvents, fieldsCache))
        .filter(Boolean)
        .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
        .slice(0, 5);
}

function buildSessionSummary(sessionId, sessionEvents, fieldsCache = null) {
    const sorted = [...(sessionEvents || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!sorted.length) return null;
    const startedAt = sorted[0].timestamp;
    const endedAt = sorted[sorted.length - 1].timestamp;
    const durationMinutes = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)
    );
    const typeCounts = new Map();
    const sources = new Set();
    for (const event of sorted) {
        if (event?.type) typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
        if (event?.source) sources.add(String(event.source));
    }
    const topTypes = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([type]) => type);
    const narrative = buildSessionNarratives(sorted, fieldsCache || getFieldsCache(), { limit: 1, requireSessionId: false })[0] || null;

    return {
        sessionId,
        label: buildSessionLabel(sorted),
        count: sorted.length,
        startedAt,
        endedAt,
        durationMinutes,
        topTypes,
        sources: [...sources],
        family: narrative?.family || 'authoring',
        familyLabel: narrative?.familyLabel || 'Authoring',
        familyStrength: narrative?.familyStrength || 'low',
        outcome: narrative?.outcome || 'observed',
        outcomeLabel: narrative?.outcomeLabel || 'Observed',
        summary: narrative?.summary || '',
        focusFields: narrative?.focusFields || [],
        impactedTargets: narrative?.impactedTargets || [],
        sessionReason: narrative?.sessionReason || ''
    };
}

function buildSessionLabel(events) {
    const latest = events?.[events.length - 1];
    if (!latest?.timestamp) return 'Recent session';
    const diffMs = Date.now() - new Date(latest.timestamp).getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMinutes < 60) return diffMinutes <= 1 ? 'Current session' : `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return 'Earlier session';
}

/**
 * Derives a chronological arc (created → typed → first-link → last-activity) from raw events.
 * @param {object[]} events
 * @returns {{ kind: string, timestamp: string, label: string, detail: string|null }[]}
 */
function buildNoteArc(events) {
    if (!events || !events.length) return [];
    const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const phases = [];
    const used = new Set();

    const _key = e => e.timestamp + '\x00' + e.type + '\x00' + (e.field || '');

    const created = sorted.find(e => e.type === 'note_created');
    if (created) {
        phases.push({ kind: 'created', timestamp: created.timestamp, label: 'Note created', detail: null });
        used.add(_key(created));
    }

    const typed = sorted.find(e => e.type === 'type_set');
    if (typed) {
        phases.push({ kind: 'typed', timestamp: typed.timestamp, label: 'Type established', detail: typed.newValue ? String(typed.newValue) : null });
        used.add(_key(typed));
    }

    const connecting = sorted.find(e =>
        (e.type === 'field_added' || e.type === 'relation_added' || e.type === 'relation_changed') &&
        e.newValue && String(e.newValue).includes('[[')
    );
    if (connecting) {
        const ids = _extractRelationIds(String(connecting.newValue));
        phases.push({ kind: 'connecting', timestamp: connecting.timestamp, label: 'First link', detail: ids.length ? ids[0] : null });
        used.add(_key(connecting));
    }

    const last = sorted[sorted.length - 1];
    if (last && !used.has(_key(last))) {
        phases.push({ kind: 'last', timestamp: last.timestamp, label: _describeArcEvent(last), detail: null });
    }

    return phases;
}

function _extractRelationIds(rawValue) {
    if (!rawValue) return [];
    const matches = [...String(rawValue).matchAll(/\[\[([^\]]+)\]\]/g)];
    return matches.map(m => m[1].split('|')[0].split('#')[0].split('^')[0].trim());
}

function _describeArcEvent(event) {
    switch (event.type) {
        case 'note_touched': return 'Note updated';
        case 'field_changed': return event.field ? event.field + ' updated' : 'Field updated';
        case 'field_added': return event.field ? event.field + ' added' : 'Field added';
        case 'field_removed': return event.field ? event.field + ' removed' : 'Field removed';
        case 'relation_added': return event.field ? event.field + ' linked' : 'Relation linked';
        case 'relation_removed': return event.field ? event.field + ' unlinked' : 'Relation removed';
        case 'relation_changed': return event.field ? event.field + ' relinked' : 'Relation updated';
        case 'type_set': return 'Type updated';
        case 'note_created': return 'Note created';
        default: return 'Last activity';
    }
}

function _localDateStr(d) {
    return d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
}

function _localTimeStr(d) {
    return String(d.getHours()).padStart(2, '0') + ':'
        + String(d.getMinutes()).padStart(2, '0');
}

module.exports = { buildHistoryModel, buildNoteArc, buildHistorySessions };
