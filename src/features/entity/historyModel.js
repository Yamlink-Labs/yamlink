'use strict';

const { getMutationEvents } = require('../../runtime/mutationEventLog');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @param {string} noteId
 * @returns {{ groups: { label: string, events: object[] }[], totalCount: number, arc: object[] }}
 */
function buildHistoryModel(noteId) {
    const events = getMutationEvents({ noteId, limit: 200 });
    const totalCount = events.length;
    if (!totalCount) return { groups: [], totalCount: 0, arc: [] };

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
        arc: buildNoteArc(events)
    };
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
        (e.type === 'field_added' || e.type === 'relation_changed') &&
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
        case 'field_changed': return event.field ? event.field + ' updated' : 'Field updated';
        case 'field_added': return event.field ? event.field + ' added' : 'Field added';
        case 'field_removed': return event.field ? event.field + ' removed' : 'Field removed';
        case 'relation_changed': return event.field ? event.field + ' changed' : 'Relation changed';
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

module.exports = { buildHistoryModel, buildNoteArc };
