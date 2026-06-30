'use strict';

const {
    esc,
    _ARC_ICONS,
    _CHEVRON_RIGHT,
    buildSectionEmptyState
} = require('./entityHubSectionHtml');

function _truncateValue(raw, max) {
    if (raw == null) return '';
    const s = String(raw);
    const limit = max || 32;
    return s.length > limit ? s.slice(0, limit) + '…' : s;
}

function _extractRelationIds(rawValue) {
    if (!rawValue) return [];
    const matches = [...String(rawValue).matchAll(/\[\[([^\]]+)\]\]/g)];
    return matches.map(function (m) { return m[1].split('|')[0].split('#')[0].split('^')[0].trim(); });
}

function _renderHistoryValue(raw) {
    if (raw == null || raw === '') return '<em class="history-empty">—</em>';
    const str = String(raw);
    if (str.includes('[[')) {
        const ids = _extractRelationIds(str);
        if (ids.length) return ids.map(function (id) { return '<em>' + esc(id) + '</em>'; }).join(', ');
    }
    return '<em>' + esc(_truncateValue(str, 32)) + '</em>';
}

function _formatArcDate(isoTimestamp) {
    if (!isoTimestamp) return '';
    const d = new Date(isoTimestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return diffDays + 'd ago';
    if (diffDays < 30) return Math.floor(diffDays / 7) + 'w ago';
    if (diffDays < 365) return Math.floor(diffDays / 30) + 'mo ago';
    return Math.floor(diffDays / 365) + 'y ago';
}

function buildArcSection(arc) {
    if (!arc || !arc.length) return '';
    const phasesHtml = arc.map(function (phase, i) {
        const icon = _ARC_ICONS[phase.kind] || '●';
        const dateStr = _formatArcDate(phase.timestamp);
        const detailHtml = phase.detail ? '<span class="arc-detail">' + esc(phase.detail) + '</span>' : '';
        const isLast = i === arc.length - 1;
        return [
            '<div class="arc-phase' + (isLast ? ' arc-phase--last' : '') + '">',
            '<div class="arc-spine">',
            '<span class="arc-icon arc-icon--' + esc(phase.kind) + '">' + icon + '</span>',
            isLast ? '' : '<div class="arc-line"></div>',
            '</div>',
            '<div class="arc-content">',
            '<span class="arc-label">' + esc(phase.label) + '</span>',
            dateStr ? '<span class="arc-date">' + esc(dateStr) + '</span>' : '',
            detailHtml,
            '</div>',
            '</div>'
        ].filter(Boolean).join('');
    }).join('');
    return '<div class="arc-section"><div class="arc-phases">' + phasesHtml + '</div></div>';
}

function buildSessionSection(sessions) {
    if (!sessions || !sessions.length) return '';
    const items = sessions.map(function (session) {
        const detail = [
            session.familyLabel || '',
            session.outcomeLabel || '',
            session.mode || '',
            session.durationMinutes > 0 ? session.durationMinutes + 'm' : 'instant',
            session.focusFields && session.focusFields.length ? 'fields: ' + session.focusFields.join(', ') : '',
            session.impactedTargets && session.impactedTargets.length ? 'targets: ' + session.impactedTargets.join(', ') : '',
            session.causalSummary ? 'chain: ' + session.causalSummary : '',
            session.sources && session.sources.length ? session.sources.join(', ') : '',
            session.sessionReason ? 'trigger: ' + session.sessionReason : ''
        ].filter(Boolean).join(' · ');
        return [
            '<div class="history-session history-session--' + esc(session.family || 'authoring') + '">',
            '  <span class="history-session-label">' + esc(session.label || 'Session') + '</span>',
            '  <span class="history-session-count">' + esc(String(session.count || 0)) + ' events</span>',
            session.summary ? '  <span class="history-session-summary">' + esc(session.summary) + '</span>' : '',
            detail ? '  <span class="history-session-detail">' + esc(detail) + '</span>' : '',
            '</div>'
        ].filter(Boolean).join('');
    }).join('');
    return '<div class="history-sessions">' + items + '</div>';
}

function describeHistoryEvent(event) {
    switch (event.type) {
        case 'note_created':
            return 'Note created';
        case 'note_touched':
            return 'Note updated';
        case 'note_deleted':
            return 'Note deleted';
        case 'type_set':
            return event.newValue
                ? 'Type set to <em>' + esc(String(event.newValue)) + '</em>'
                : 'Type set';
        case 'field_added':
            return event.field
                ? '<strong>' + esc(event.field) + '</strong> added: ' + _renderHistoryValue(event.newValue)
                : 'Field added';
        case 'field_changed': {
            if (event.field) {
                const oldPart = event.oldValue != null
                    ? '<span class="history-old">' + _renderHistoryValue(event.oldValue) + '</span> → '
                    : '';
                return '<strong>' + esc(event.field) + '</strong>: ' + oldPart + _renderHistoryValue(event.newValue);
            }
            return 'Field changed';
        }
        case 'field_removed':
            return event.field
                ? '<strong>' + esc(event.field) + '</strong> removed'
                : 'Field removed';
        case 'relation_added': {
            if (event.field) {
                return 'Linked <strong>' + esc(event.field) + '</strong>: ' + _renderHistoryValue(event.newValue);
            }
            return 'Relation linked';
        }
        case 'relation_removed': {
            if (event.field) {
                return 'Unlinked <strong>' + esc(event.field) + '</strong>: ' + _renderHistoryValue(event.oldValue);
            }
            return 'Relation removed';
        }
        case 'relation_changed': {
            if (event.field) {
                const oldPart = event.oldValue != null
                    ? '<span class="history-old">' + _renderHistoryValue(event.oldValue) + '</span> → '
                    : '';
                return 'Relinked <strong>' + esc(event.field) + '</strong>: ' + oldPart + _renderHistoryValue(event.newValue);
            }
            return 'Relation updated';
        }
        case 'task_status_changed':
            return event.newValue === 'done'
                ? 'Task marked <em>done</em>'
                : event.newValue === 'open'
                    ? 'Task reopened'
                    : 'Task status changed';
        case 'task_state_changed':
            return event.newValue === 'done'
                ? 'Task state changed to <em>done</em>'
                : event.newValue === 'open'
                    ? 'Task state changed to <em>open</em>'
                    : 'Task state changed';
        case 'query_builder_opened':
            return 'Query Builder opened';
        case 'query_builder_applied':
            return 'Query Builder inserted a <em>!view</em> block';
        case 'query_builder_preview_opened':
            return 'Query Builder preview opened';
        case 'query_builder_copied':
            return 'Query Builder copied the generated query';
        case 'live_note_opened':
            return 'Live Note opened';
        case 'live_note_reveal_source':
            return 'Live Note jumped back to source';
        case 'live_note_open_report':
            return 'Live Note opened Note Report';
        case 'vault_import_completed':
            return event.field
                ? 'Imported <em>' + esc(String(event.field)) + '</em> content into the vault'
                : 'Vault import completed';
        default:
            return esc(event.type || 'event');
    }
}

function buildEvolutionSnapshot(evolution) {
    if (!evolution) return '';
    const unstable = (evolution.unstableFields || []).map((item) => `${item.field} (${item.changeCount})`).join(', ');
    const relations = (evolution.relationsFormed || []).map((item) => `${item.field} → ${item.target}`).join(', ');
    return [
        '<div class="history-evolution">',
        '  <div class="history-evolution-title">Evolution snapshot</div>',
        '  <div class="history-evolution-grid">',
        '    <span><strong>Created:</strong> ' + esc(evolution.created || '—') + '</span>',
        '    <span><strong>First type:</strong> ' + esc(evolution.typeSet || '—') + '</span>',
        '    <span><strong>First fields:</strong> ' + esc((evolution.firstFields || []).join(', ') || '—') + '</span>',
        '    <span><strong>Stable fields:</strong> ' + esc((evolution.stableFields || []).join(', ') || '—') + '</span>',
        '    <span><strong>Unstable fields:</strong> ' + esc(unstable || '—') + '</span>',
        '    <span><strong>Relations formed:</strong> ' + esc(relations || '—') + '</span>',
        '    <span><strong>Total edits:</strong> ' + esc(String(evolution.totalEdits || 0)) + '</span>',
        '    <span><strong>Last activity:</strong> ' + esc(evolution.lastActivity || '—') + '</span>',
        '  </div>',
        '</div>'
    ].join('');
}

function buildHistorySection(groups, totalCount, arc, sessions, evolution) {
    const arcHtml = buildArcSection(arc);
    const sessionHtml = buildSessionSection(sessions);
    const evolutionHtml = buildEvolutionSnapshot(evolution);

    if (!groups || !groups.length) {
        return [
            '<div class="hub-section" data-field="history">',
            '    <div class="hub-section-header">',
            '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
            '        <span class="hub-field">history</span>',
            '        <span class="hub-count">0</span>',
            '    </div>',
            '    <div class="hub-section-body">',
            arcHtml ? '        ' + arcHtml : '',
            sessionHtml ? '        ' + sessionHtml : '',
            evolutionHtml ? '        ' + evolutionHtml : '',
            buildSectionEmptyState('No history yet.', 'Field changes, new links, and type assignments appear here as you edit this note.'),
            '    </div>',
            '</div>'
        ].filter(Boolean).join('\n');
    }

    const groupsHtml = groups.map(function (group) {
        const eventsHtml = group.events.map(function (event) {
            return [
                '<div class="history-event">',
                '  <span class="history-dot history-dot--' + esc(event.type || '') + '"></span>',
                '  <span class="history-desc">' + describeHistoryEvent(event) + '</span>',
                '  <span class="history-time">' + esc(event.timeStr || '') + '</span>',
                '</div>'
            ].join('');
        }).join('');
        return [
            '<div class="history-group">',
            '  <div class="history-group-label">' + esc(group.label) + '</div>',
            '  <div class="history-timeline">' + eventsHtml + '</div>',
            '</div>'
        ].join('');
    }).join('');

    return [
        '<div class="hub-section open" data-field="history">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '        <span class="hub-field">history</span>',
        '        <span class="hub-count">' + totalCount + '</span>',
        '    </div>',
        '    <div class="hub-section-body">',
        arcHtml ? '        ' + arcHtml : '',
        sessionHtml ? '        ' + sessionHtml : '',
        evolutionHtml ? '        ' + evolutionHtml : '',
        '        ' + groupsHtml,
        '    </div>',
        '</div>'
    ].filter(Boolean).join('\n');
}

module.exports = {
    _truncateValue,
    _extractRelationIds,
    _renderHistoryValue,
    _formatArcDate,
    buildArcSection,
    buildSessionSection,
    buildEvolutionSnapshot,
    describeHistoryEvent,
    buildHistorySection
};
