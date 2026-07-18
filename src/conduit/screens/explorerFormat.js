'use strict';

// Pure formatting/rendering helpers extracted out of Explorer.js's monolith
// (part of the 0.7.4 monolith-decomposition pass — see TODO.md). These two
// functions never touched component state directly; they already took every
// dependency as a parameter, so moving them is a zero-risk mechanical split.
// No behavior changes.

const React = require('react');
const { p, SYM } = require('../palette');
const { SKIP_FIELDS, truncate, pad } = require('../noteDetail');

const EVENT_BADGES = {
    note_created:         'CREATED',
    note_touched:         'UPDATED',
    note_deleted:         'DELETED',
    field_changed:        'CHANGED',
    field_added:          'ADDED',
    field_removed:        'REMOVED',
    relation_added:       'LINKED',
    relation_changed:     'RELINKED',
    relation_removed:     'UNLINKED',
    task_status_changed:  'TASK',
    type_set:             'TYPED',
};

function buildSplitDetailContent({ ink, note, nodeDetail, intelligence, selectedType, selectedIds, previewLoading }) {
    const { Box, Text } = ink;
    if (!note) {
        return React.createElement(Text, null, p.faint('Select a note to preview  •  [n] new note'));
    }
    if (previewLoading) {
        return React.createElement(Text, null, p.muted('loading...'));
    }

    const lifecycle = intelligence ? (intelligence.lifecycle || null) : null;
    const drift = intelligence ? (intelligence.drift || null) : null;
    const arc = intelligence ? (intelligence.arc || null) : null;
    const relationMap = new Map(
        Array.isArray(nodeDetail?._outbound)
            ? nodeDetail._outbound.map((edge) => [String(edge.field || ''), String(edge.to || '')])
            : []
    );

    const displayFields = nodeDetail
        ? Object.entries(nodeDetail)
            .filter(([k]) => !SKIP_FIELDS.has(k) && !k.startsWith('__') && !k.startsWith('_'))
            .slice(0, 6)
        : [];
    const fieldKeyWidth = displayFields.reduce((max, [k]) => Math.max(max, k.length), 6);

    const likelyMissing = (Array.isArray(arc?.missingFields) ? arc.missingFields : [])
        .filter((entry) => entry && (entry.confidenceLabel === 'high' || entry.confidenceLabel === 'medium'))
        .slice(0, 3)
        .map((entry) => entry.field);

    const keyHints = selectedIds.length > 1
        ? '[Enter] bulk  [e] edit  [o] editor  [p] peek  [Esc] back'
        : '[Enter] view  [e] edit  [o] editor  [p] peek  [H] hist  [Esc] back';

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(
            Text,
            null,
            p.bold(note.label || note.id) +
            '  ' +
            p.type(note.type || selectedType.type || '')
        ),
        lifecycle || drift
            ? React.createElement(
                Text,
                null,
                p.muted('state: ') +
                p.primary(String(lifecycle?.label || lifecycle?.state || 'unknown')) +
                '  ' +
                p.muted('drift: ') +
                p.primary(String(drift?.driftLabelHuman || drift?.driftLabel || 'unknown'))
            )
            : null,
        ...displayFields.map(([key, val], index) => {
            const display = relationMap.has(key)
                ? p.secondary(SYM.relation + ' ') + p.type(truncate(String(val ?? ''), 22))
                : p.primary(truncate(String(val ?? ''), 24));
            return React.createElement(
                Text,
                { key: `split-field-${index}` },
                '  ' + p.muted(pad(key, fieldKeyWidth + 1)) + ' ' + display
            );
        }),
        likelyMissing.length > 0
            ? React.createElement(
                Text,
                { key: 'split-missing' },
                p.warn('  missing: ') + p.secondary(likelyMissing.join(', '))
            )
            : null,
        React.createElement(Text, null, ''),
        React.createElement(Text, null, p.faint('body: [o] open in $EDITOR')),
        React.createElement(Text, null, p.faint(keyHints))
    );
}

function formatHistoryEvent(event) {
    const date = String(event.timestamp || '').slice(0, 10);
    const badge = EVENT_BADGES[event.type] || 'EVENT';
    let desc = '';
    const type = event.type || '';
    if (type === 'field_changed' || type === 'field_added' || type === 'field_removed') {
        const from = event.oldValue !== null && event.oldValue !== undefined ? String(event.oldValue).slice(0, 18) : null;
        const to   = event.newValue !== null && event.newValue !== undefined ? String(event.newValue).slice(0, 18) : null;
        const fieldPart = event.field ? String(event.field) + ': ' : '';
        desc = fieldPart + (from !== null ? from : '—') + ' → ' + (to !== null ? to : '—');
    } else if (type === 'relation_added' || type === 'relation_changed' || type === 'relation_removed') {
        const val = type === 'relation_removed' ? event.oldValue : event.newValue;
        const target = val ? String(val).slice(0, 28) : '—';
        desc = (event.field ? String(event.field) + ': ' : '') + target;
    } else if (type === 'task_status_changed') {
        desc = String(event.field || '') + ' → ' + String(event.newValue || '');
    } else if (type === 'type_set') {
        desc = String(event.newValue || '');
    }
    return { date, badge, desc };
}

module.exports = { EVENT_BADGES, buildSplitDetailContent, formatHistoryEvent };
