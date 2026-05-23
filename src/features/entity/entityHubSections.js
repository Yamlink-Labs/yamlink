'use strict';

const {
    getVisibleRelationColumns,
    getVisibleTaskColumns,
    extractRelations
} = require('../entityHubModel');

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
        '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
            '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
            '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
        '        <span class="hub-chevron">&#9658;</span>',
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
    esc
};
