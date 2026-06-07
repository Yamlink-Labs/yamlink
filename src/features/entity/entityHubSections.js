'use strict';

const {
    getVisibleRelationColumns,
    getVisibleTaskColumns,
    extractRelations
} = require('../entityHubModel');

/* ── Lucide icon helpers ─────────────────────────────────────── */
function _svgIcon(paths, size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex-shrink:0">' + paths + '</svg>';
}
const _CHEVRON_RIGHT = _svgIcon('<polyline points="9 18 15 12 9 6"/>', 11);
const _ARC_ICONS = {
    created:    _svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>', 10),
    typed:      _svgIcon('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>', 10),
    connecting: _svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 10),
    last:       _svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 10),
};

function getRelationRowDisplayName(row) {
    return String(row?.fields?.name || row?.fields?.title || row?.sourceId || '').trim();
}

function getRelationRowType(row) {
    return String(row?.fields?.type || '').trim();
}

function flattenRelationGroups(groups = []) {
    return (Array.isArray(groups) ? groups : []).flatMap(function (group) {
        return (Array.isArray(group.rows) ? group.rows : []).map(function (row) {
            return {
                field: String(group.field || '').trim(),
                note: getRelationRowDisplayName(row),
                type: getRelationRowType(row),
                sourceId: String(row?.sourceId || '').trim()
            };
        });
    }).filter(function (row) {
        return row.field || row.note || row.type || row.sourceId;
    });
}

function buildKeyValueSection(title, fieldName, rows, open = true) {
    if (!rows || rows.length === 0) return '';
    const body = rows.map(row => `<div class="summary-key">${esc(row.key)}</div><div class="summary-value">${esc(row.value)}</div>`).join('');
    return [
        `<div class="hub-section${open ? ' open' : ''}" data-field="${esc(fieldName)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        `        <span class="hub-field">${esc(title)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        <div class="summary-grid">${body}</div>`,
        '    </div>',
        '</div>'
    ].join('\n');
}

function splitSummaryRows(summaryRows) {
    const priority = ['title', 'name', 'status', 'owner', 'date', 'due', 'priority', 'branch', 'mission', 'commander'];
    const ordered = [
        ...priority
            .map((key) => summaryRows.find((row) => row.key === key))
            .filter(Boolean),
        ...summaryRows.filter((row) => !priority.includes(row.key))
    ];
    return {
        primaryRows: ordered.slice(0, 8),
        secondaryRows: ordered.slice(8)
    };
}

function formatActionCard(row) {
    if (row.source === 'suggested') {
        const typeLabel = row.count === 1 ? row.sourceType : `${row.sourceType}s`;
        return {
            title: `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)} linked by ${row.field}`,
            description: `Show the ${typeLabel} that already reference this note through ${row.field}.`,
            queryText: row.queryText
        };
    }
    return {
        title: row.title,
        description: row.description,
        queryText: row.queryText
    };
}

function buildSummarySection(primaryRows, secondaryRows = []) {
    const body = primaryRows.length
        ? primaryRows.map(row => `<div class="summary-key">${esc(row.key)}</div><div class="summary-value">${esc(row.value)}</div>`).join('')
        : buildSectionEmptyState('No scalar frontmatter yet.', 'Add fields like <code>status:</code>, <code>owner:</code>, or <code>date:</code> to make this note easier to scan.');
    const section = [
        '<div class="hub-section open" data-field="summary">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '        <span class="hub-field">briefing</span>',
        `        <span class="hub-count">${primaryRows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        <div class="summary-grid">${body}</div>`,
        '    </div>',
        '</div>'
    ].join('\n');
    if (!secondaryRows.length) return section;
    return [
        section,
        buildKeyValueSection('other fields', 'summary-extra', secondaryRows, false)
    ].join('\n');
}

function buildActionCardRow(nodeId, row) {
    const card = formatActionCard(row);
    const buttonAttrs = row.inserted ? ' disabled aria-disabled="true"' : '';
    const buttonLabel = row.inserted ? 'Already in note' : 'Insert';
    const note = row.inserted
        ? '<div class="suggestion-note">already in note</div>'
        : `<div class="suggestion-note">${esc(row.source === 'suggested' ? 'suggested next view' : 'ready-made view')}</div>`;
    const sourceAttrs = row.sourceType && row.field
        ? ` data-source-type="${esc(row.sourceType)}" data-field-name="${esc(row.field)}"`
        : '';
    return [
        '<div class="suggestion-row">',
        `  <div class="suggestion-copy">${note}<div class="suggestion-title">${esc(card.title)}</div><div class="suggestion-query">${esc(card.description)}</div><div class="suggestion-note">query: ${esc(card.queryText)}</div></div>`,
        `  <button class="suggestion-btn" data-insert-view="${esc(row.queryText)}"${sourceAttrs} data-node-id="${esc(nodeId)}"${buttonAttrs}>${buttonLabel}</button>`,
        '</div>'
    ].join('');
}

function buildActionSection(nodeId, suggestionRows, recipeRows, explanation) {
    const rows = [
        ...suggestionRows.map(function (row) {
            return {
                source: 'suggested',
                title: `${row.count} ${row.count === 1 ? row.sourceType : row.sourceType + 's'} via ${row.field}`,
                description: row.queryText,
                queryText: row.queryText,
                inserted: row.inserted,
                sourceType: row.sourceType,
                field: row.field
            };
        }),
        ...recipeRows.map(function (row) {
            return {
                source: 'recipe',
                title: row.title,
                description: row.description,
                queryText: row.queryText,
                inserted: row.inserted
            };
        })
    ];

    if (!rows.length) {
        const reasonList = Array.isArray(explanation?.reasons) && explanation.reasons.length
            ? `<ul class="section-empty-list">${explanation.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>`
            : '';
        return [
            '<div class="hub-section" data-field="next-views">',
            '    <div class="hub-section-header">',
            '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
            '        <span class="hub-field">next views</span>',
            '        <span class="hub-count">0</span>',
            '    </div>',
            '    <div class="hub-section-body">',
            buildSectionEmptyState(
                esc(explanation?.title || 'No next views yet.'),
                `${esc(explanation?.description || 'Yamlink is still learning the structure around this note.')}${reasonList}`
            ),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    const insertedRow = rows.find(function (row) { return row.inserted; }) || null;
    const suggestedRow = rows.find(function (row) { return !row.inserted; }) || null;

    const sections = [];
    if (suggestedRow) {
        sections.push(
            '<div class="suggestion-list">' + buildActionCardRow(nodeId, suggestedRow) + '</div>'
        );
    }
    if (insertedRow) {
        sections.push(
            '<div class="suggestion-list">' + buildActionCardRow(nodeId, insertedRow) + '</div>'
        );
    }

    const bodyRows = sections.join('\n');

    return [
        '<div class="hub-section open" data-field="next-views">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '        <span class="hub-field">views</span>',
        `        <span class="hub-count">${sections.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        `        ${bodyRows}`,
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildRelationSection(field, rows, direction) {
    const columns = getVisibleRelationColumns(rows);
    const headerCells = columns.map(function (col) {
        const cls = col === 'id' ? ' class="col-id"' : '';
        return `<th${cls} data-col="${esc(col)}">${esc(col)} <span class="sarr">↕</span></th>`;
    }).join('');

    const bodyRows = rows.map(function ({ sourceId, fields }) {
        const cells = columns.map(function (col) {
            if (col === 'id') {
                return `<td class="cell-id" data-id="${esc(sourceId)}">${esc(sourceId)}</td>`;
            }
            const val = fields[col] || '';
            if (!val) return '<td class="cell-empty">-</td>';
            const rels = extractRelations(val);
            if (rels.length === 1) return `<td><span class="cell-rel" data-id="${esc(rels[0])}">${esc(rels[0])}</span></td>`;
            if (rels.length > 1) return `<td>${rels.map(id => `<span class="cell-rel" data-id="${esc(id)}">${esc(id)}</span>`).join('')}</td>`;
            return `<td>${esc(val)}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return [
        `<div class="hub-section open" data-field="${esc(direction + ':' + field)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        `        <span class="hub-field">${esc(direction === 'outgoing' ? `out → ${field}` : `in ← ${field}`)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        `            <thead><tr>${headerCells}</tr></thead>`,
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildCompactRelationTableSection(title, fieldName, groups, open = true) {
    const rows = flattenRelationGroups(groups);
    if (!rows.length) return '';

    const bodyRows = rows.map(function (row) {
        const noteLabel = row.note || row.sourceId;
        const typeLabel = row.type || '';
        return [
            '<tr>',
            `  <td data-sort-value="${esc(row.field.toLowerCase())}">${esc(row.field || '-')}</td>`,
            `  <td class="cell-id" data-id="${esc(row.sourceId)}" data-sort-value="${esc(noteLabel.toLowerCase())}">${esc(noteLabel)}</td>`,
            `  <td data-sort-value="${esc(typeLabel.toLowerCase())}">${typeLabel ? esc(typeLabel) : '<span class="cell-empty">-</span>'}</td>`,
            '</tr>'
        ].join('');
    }).join('');

    return [
        `<div class="hub-section${open ? ' open' : ''}" data-field="${esc(fieldName)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        `        <span class="hub-field">${esc(title)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        '            <thead><tr><th data-col="field">field <span class="sarr">↕</span></th><th data-col="note">note <span class="sarr">↕</span></th><th data-col="type">type <span class="sarr">↕</span></th></tr></thead>',
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildTaskSection(label, rows) {
    const columns = getVisibleTaskColumns(rows);
    const headerCells = columns
        .map(col => `<th data-col="${esc(col)}">${esc(col)} <span class="sarr">↕</span></th>`)
        .join('');

    const bodyRows = rows.map(function (row) {
        const cells = columns.map(function (col) {
            if (col === 'date') return `<td>${row.date ? esc(row.date) : '<span class="cell-empty">-</span>'}</td>`;
            if (col === 'done') return `<td>${row.done === 'true' ? '<span class="cell-rel">done</span>' : '<span class="cell-empty">open</span>'}</td>`;
            if (col === 'file') return `<td class="cell-id" data-id="${esc(row.file)}">${esc(row.file)}</td>`;
            if (col === 'text') {
                const body = String(row.body || '').trim();
                return `<td>${esc(row.text)}${body ? `<div class="cell-empty" style="margin-top:4px">${esc(body)}</div>` : ''}</td>`;
            }
            return '<td class="cell-empty">-</td>';
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return [
        `<div class="hub-section open" data-field="${esc('tasks:' + label)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        `        <span class="hub-field">${esc(label)}</span>`,
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        `            <thead><tr>${headerCells}</tr></thead>`,
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildTimelineSection(rows) {
    if (!rows.length) {
        return [
            '<div class="hub-section" data-field="timeline">',
            '    <div class="hub-section-header">',
            '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
            '        <span class="hub-field">timeline</span>',
            '        <span class="hub-count">0</span>',
            '    </div>',
            '    <div class="hub-section-body">',
            buildSectionEmptyState('No dated activity yet.', 'Timeline entries appear when this note has a <code>date:</code> field or related tasks include a supported date.'),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    const bodyRows = rows.map(function (row) {
        return [
            '<tr>',
            `  <td>${esc(row.date)}</td>`,
            `  <td>${esc(row.kind)}</td>`,
            `  <td>${esc(row.label)}</td>`,
            `  <td class="cell-id" data-id="${esc(row.source)}">${esc(row.source)}</td>`,
            '</tr>'
        ].join('');
    }).join('');

    return [
        '<div class="hub-section open" data-field="timeline">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '        <span class="hub-field">timeline</span>',
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        '            <thead><tr><th data-col="date">date <span class="sarr">↕</span></th><th data-col="kind">kind <span class="sarr">↕</span></th><th data-col="label">label <span class="sarr">↕</span></th><th data-col="source">source <span class="sarr">↕</span></th></tr></thead>',
        `            <tbody>${bodyRows}</tbody>`,
        '        </table>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildEmptySection(title, emptyTitle, emptyCopy) {
    return [
        `<div class="hub-section" data-field="${esc(title)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        `        <span class="hub-field">${esc(title)}</span>`,
        '        <span class="hub-count">0</span>',
        '    </div>',
        '    <div class="hub-section-body">',
        buildSectionEmptyState(emptyTitle, emptyCopy),
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildSectionEmptyState(title, copy) {
    return `<div class="section-empty"><div class="section-empty-title">${title}</div><div class="section-empty-copy">${copy}</div></div>`;
}

const EMPTY_HINTS = {
    '-':                                  { msg: 'Open a Yamlink note to see its report.', hint: '' },
    'not a node':                         { msg: 'This file is not a Yamlink node.', hint: 'Add <code>id: your-note-id</code> to the frontmatter and save to index it.' },
    'Select a Yamlink node to open its report': { msg: 'Open a note in the editor.', hint: 'The Note Report updates whenever you switch to an indexed Markdown file.' }
};

function buildEntityHubEmptyHtml(label) {
    const hint = EMPTY_HINTS[label] || { msg: 'Nothing here yet.', hint: 'Link this node to others with <code>[[note-id]]</code> to build its report.' };
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:#888;font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}',
        '.hub-header{padding:11px 16px 10px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid #2a2a2a;font-size:11px;color:#6f7781;letter-spacing:.08em;text-transform:uppercase}',
        '.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;text-align:center}',
        '.msg{font-size:12px;color:#6f7781;line-height:1.5}',
        '.hint{font-size:11px;color:#555;line-height:1.6}',
        'code{background:#1e2126;padding:1px 5px;border-radius:4px;font-size:10px}',
        '</style></head><body>',
        `<div class="hub-header">${esc(label)}</div>`,
        `<div class="center"><div class="msg">${hint.msg}</div>${hint.hint ? `<div class="hint">${hint.hint}</div>` : ''}</div>`,
        '</body></html>'
    ].join('\n');
}

function buildEntityHubErrorHtml(label, error) {
    const detail = error && error.message ? error.message : String(error || 'Unknown error');
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}',
        '.hdr{padding:11px 16px 10px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);font-size:11px;color:#8b949e;letter-spacing:.08em;text-transform:uppercase}',
        '.body{padding:16px;display:flex;flex-direction:column;gap:10px}',
        '.err{color:#ff9b9b;font-size:13px;font-weight:600}',
        '.detail{color:#8b949e;font-size:12px;line-height:1.45}',
        '</style></head><body>',
        `<div class="hdr">${esc(label)}</div>`,
        '<div class="body">',
        '<div class="err">Note Report hit a runtime error.</div>',
        `<div class="detail">${esc(detail)}</div>`,
        '</div></body></html>'
    ].join('\n');
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

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

// _ARC_ICONS defined at module top with Lucide SVGs

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

function describeHistoryEvent(event) {
    switch (event.type) {
        case 'note_created':
            return 'Note created';
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
        case 'relation_changed': {
            if (event.field) {
                const oldPart = event.oldValue != null
                    ? '<span class="history-old">' + _renderHistoryValue(event.oldValue) + '</span> → '
                    : '';
                return 'Relation <strong>' + esc(event.field) + '</strong>: ' + oldPart + _renderHistoryValue(event.newValue);
            }
            return 'Relation changed';
        }
        case 'task_status_changed':
            return event.newValue === 'done'
                ? 'Task marked <em>done</em>'
                : event.newValue === 'open'
                    ? 'Task reopened'
                    : 'Task status changed';
        default:
            return esc(event.type || 'event');
    }
}

function buildHistorySection(groups, totalCount, arc) {
    const arcHtml = buildArcSection(arc);

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
        '        ' + groupsHtml,
        '    </div>',
        '</div>'
    ].filter(Boolean).join('\n');
}

/**
 * Render the unlinked mentions section for the Links tab.
 * Each entry is a note whose body mentions this note's name/id without a wikilink.
 *
 * @param {Array<{mentioningId: string, mentioningType: string, term: string, count: number}>} mentions
 * @returns {string}
 */
function buildUnlinkedMentionsSection(mentions) {
    if (!mentions || !mentions.length) return '';
    const rows = mentions.map(m => {
        const countLabel = m.count === 1 ? '1 mention' : `${m.count} mentions`;
        const typeLabel = m.mentioningType ? ` <span class="node-pill">${esc(m.mentioningType)}</span>` : '';
        return [
            '<div class="hub-relation-row" data-opennode="true"',
            `     data-node-id="${esc(m.mentioningId)}" style="cursor:pointer">`,
            `  <span class="hub-relation-id">${esc(m.mentioningId)}</span>`,
            typeLabel,
            `  <span class="hub-relation-meta">${esc(countLabel)}</span>`,
            '</div>'
        ].join('');
    }).join('\n');

    return [
        '<div class="hub-section open" data-field="unlinked-mentions">',
        '  <div class="hub-section-header">',
        '    <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '    <span class="hub-field">Unlinked mentions</span>',
        `    <span class="hub-count">${mentions.length}</span>`,
        '  </div>',
        '  <div class="hub-section-body">',
        '    <p class="hub-hint">Notes that mention this note\'s name in body text without a formal wikilink.</p>',
        rows,
        '  </div>',
        '</div>'
    ].join('\n');
}

/**
 * Render the note arc section — fields the current note is likely missing,
 * ranked by how common they are across same-type notes in the vault and how
 * often the system's suggestions for those fields have been accepted.
 *
 * @param {import('../../intelligence/noteArc').NoteArc} noteArc
 * @returns {string}
 */
function buildNoteArcSection(noteArc) {
    if (!noteArc || !noteArc.missingFields || !noteArc.missingFields.length) return '';
    const { inferredType, missingFields } = noteArc;

    const rows = missingFields.map(({ field, ratio, calibrationCount, isRelation }) => {
        const pct = Math.round(ratio * 100);
        const relBadge = isRelation ? ' <span class="arc-missing-rel">relation</span>' : '';
        const calNote = calibrationCount > 0
            ? ` <span class="arc-missing-cal" title="Accepted ${calibrationCount}× as a suggestion">✓${calibrationCount}</span>`
            : '';
        return [
            '<div class="arc-missing-row">',
            `  <span class="arc-missing-field">${esc(field)}</span>`,
            relBadge,
            calNote,
            `  <span class="arc-missing-pct">${pct}% of ${esc(inferredType || '')} notes</span>`,
            `  <button class="arc-add-btn" data-add-field="${esc(field)}" data-is-relation="${isRelation}" aria-label="Add ${esc(field)} field" title="Add field to this note">+</button>`,
            '</div>'
        ].join('');
    }).join('\n');

    return [
        '<div class="hub-section open" data-field="note-arc">',
        '  <div class="hub-section-header">',
        '    <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '    <span class="hub-field">likely missing</span>',
        `    <span class="hub-count">${missingFields.length}</span>`,
        '  </div>',
        '  <div class="hub-section-body">',
        `    <p class="arc-missing-hint">Fields common on <strong>${esc(inferredType || '')}</strong> notes in your vault that this note doesn't have yet.</p>`,
        rows,
        '  </div>',
        '</div>'
    ].join('\n');
}

module.exports = {
    buildKeyValueSection,
    splitSummaryRows,
    buildSummarySection,
    buildActionSection,
    buildRelationSection,
    buildCompactRelationTableSection,
    buildTaskSection,
    buildTimelineSection,
    buildEmptySection,
    buildSectionEmptyState,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml,
    buildHistorySection,
    buildUnlinkedMentionsSection,
    buildNoteArcSection,
    describeHistoryEvent,
    esc
};
