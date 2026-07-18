'use strict';

const {
    getVisibleRelationColumns,
    getVisibleTaskColumns,
    extractRelations
} = require('../entityHubModel');
const {
    _CHEVRON_RIGHT,
    esc,
    buildEmptySection,
    buildSectionEmptyState,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml
} = require('./entityHubSectionHtml');
const {
    buildHistorySection,
    describeHistoryEvent
} = require('./entityHubSectionHistory');

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

function buildBlockBacklinkSection(rows) {
    if (!rows || !rows.length) return '';

    const bodyRows = rows.map(function (row) {
        const targetKind = String(row.targetKind || '');
        const sourceType = String(row.sourceType || '');
        return [
            '<tr>',
            `  <td data-sort-value="${esc(String(row.targetLabel || '').toLowerCase())}">${esc(row.targetLabel || row.targetBlockId || '-')}</td>`,
            `  <td class="cell-id" data-id="${esc(row.sourceId)}" data-sort-value="${esc(String(row.sourceLabel || '').toLowerCase())}">${esc(row.sourceLabel || row.sourceId)}</td>`,
            `  <td data-sort-value="${esc(targetKind.toLowerCase())}">${esc(targetKind || '-')}</td>`,
            `  <td data-sort-value="${esc(String(row.kind || '').toLowerCase())}">${esc(row.kind || '-')}</td>`,
            `  <td data-sort-value="${esc(sourceType.toLowerCase())}">${sourceType ? esc(sourceType) : '<span class="cell-empty">-</span>'}</td>`,
            '</tr>'
        ].join('');
    }).join('');

    return [
        '<div class="hub-section" data-field="block-backlinks">',
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '        <span class="hub-field">block backlinks</span>',
        `        <span class="hub-count">${rows.length}</span>`,
        '    </div>',
        '    <div class="hub-section-body">',
        '        <table>',
        '            <thead><tr><th data-col="target">target <span class="sarr">↕</span></th><th data-col="source">source <span class="sarr">↕</span></th><th data-col="target-kind">target kind <span class="sarr">↕</span></th><th data-col="ref-kind">ref kind <span class="sarr">↕</span></th><th data-col="source-type">source type <span class="sarr">↕</span></th></tr></thead>',
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
    const isColdStart = missingFields.length > 0 && missingFields[0].coldStart === true;
    const isEmergentCluster = missingFields.length > 0 && missingFields[0].emergentCluster === true;

    const rows = missingFields.map(({ field, ratio, calibrationCount, isRelation, coldStart, emergentCluster }) => {
        const relBadge = isRelation ? ' <span class="arc-missing-rel">relation</span>' : '';
        const calNote = calibrationCount > 0
            ? ` <span class="arc-missing-cal" title="Accepted ${calibrationCount}× as a suggestion">✓${calibrationCount}</span>`
            : '';
        const pctLabel = emergentCluster
            ? '<span class="arc-missing-pct arc-missing-pct--starter" title="Matches a repeated field pattern elsewhere in your vault">pattern match</span>'
            : coldStart
                ? '<span class="arc-missing-pct arc-missing-pct--starter">starter</span>'
                : `<span class="arc-missing-pct">${Math.round(ratio * 100)}% of ${esc(inferredType || '')} notes</span>`;
        return [
            '<div class="arc-missing-row">',
            `  <span class="arc-missing-field">${esc(field)}</span>`,
            relBadge,
            calNote,
            `  ${pctLabel}`,
            `  <button class="arc-add-btn" data-add-field="${esc(field)}" data-is-relation="${isRelation}" aria-label="Add ${esc(field)} field" title="Add field to this note">+</button>`,
            '</div>'
        ].join('');
    }).join('\n');

    const hintText = isEmergentCluster
        ? 'Other notes with the fields you\'ve already set here tend to also have these — a repeated pattern in your vault that hasn\'t been formalized as a schema yet.'
        : isColdStart
            ? (inferredType
                ? `Your vault has no other <strong>${esc(inferredType)}</strong> notes yet. These are universally useful fields to consider adding.`
                : 'Useful starter fields for any new note. Add what fits, skip what doesn\'t.')
            : `Fields common on <strong>${esc(inferredType || '')}</strong> notes in your vault that this note doesn't have yet.`;

    return [
        '<div class="hub-section open" data-field="note-arc">',
        '  <div class="hub-section-header">',
        '    <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '    <span class="hub-field">likely missing</span>',
        `    <span class="hub-count">${missingFields.length}</span>`,
        '  </div>',
        '  <div class="hub-section-body">',
        `    <p class="arc-missing-hint">${hintText}</p>`,
        rows,
        '  </div>',
        '</div>'
    ].join('\n');
}

function buildDocumentSection(documentData) {
    const data = documentData || {};
    const blocks = [];

    if (Number(data.wordCount || 0) > 0) {
        blocks.push(buildKeyValueSection('word count', 'document-words', [{ key: 'Words', value: String(data.wordCount) }], true));
    }

    if (Array.isArray(data.entityMentions) && data.entityMentions.length) {
        blocks.push(buildKeyValueSection(
            'entity mentions',
            'document-mentions',
            data.entityMentions.map(function (entry) {
                return { key: entry.id, value: String(entry.count) };
            }),
            true
        ));
    }

    if (Array.isArray(data.headings) && data.headings.length) {
        blocks.push(buildKeyValueSection(
            'headings',
            'document-headings',
            data.headings.map(function (heading, index) {
                return { key: String(index + 1), value: heading };
            }),
            true
        ));
    }

    if (Array.isArray(data.callouts) && data.callouts.length) {
        const calloutCounts = new Map();
        for (const callout of data.callouts) {
            const type = String(callout?.type || '').trim();
            if (!type) continue;
            calloutCounts.set(type, (calloutCounts.get(type) || 0) + 1);
        }
        if (calloutCounts.size) {
            blocks.push(buildKeyValueSection(
                'callouts',
                'document-callouts',
                [...calloutCounts.entries()].map(function ([type, count]) {
                    return { key: type, value: String(count) };
                }),
                true
            ));
        }
    }

    if (Number(data.footnoteCount || 0) > 0) {
        blocks.push(buildKeyValueSection('footnotes', 'document-footnotes', [{ key: 'Footnote definitions', value: String(data.footnoteCount) }], true));
    }

    if (!blocks.length) {
        return '<p class="hub-empty">No body content to analyse.</p>';
    }

    return blocks.join('\n');
}

/**
 * @param {Array<{id:string,label:string,type:string,daysSince:number}>} notes
 * @returns {string}
 */
function buildStaleConnectedSection(notes) {
    if (!notes || !notes.length) return '';
    const rows = notes.map(n => {
        const ageLabel = n.daysSince === 1 ? '1 day ago' : `${n.daysSince} days ago`;
        const typeLabel = n.type ? ` <span class="node-pill">${esc(n.type)}</span>` : '';
        return [
            '<div class="hub-relation-row" data-opennode="true"',
            `     data-node-id="${esc(n.id)}" style="cursor:pointer">`,
            `  <span class="hub-relation-id cell-id" data-id="${esc(n.id)}">${esc(n.label)}</span>`,
            typeLabel,
            `  <span class="hub-relation-meta">${esc(ageLabel)}</span>`,
            '</div>'
        ].join('');
    }).join('\n');

    return [
        '<div class="hub-section open" data-field="stale-connected">',
        '  <div class="hub-section-header">',
        '    <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        '    <span class="hub-field">Stale connected notes</span>',
        `    <span class="hub-count">${notes.length}</span>`,
        '  </div>',
        '  <div class="hub-section-body">',
        '    <p class="hub-hint">Connected notes not updated in 60+ days.</p>',
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
    buildBlockBacklinkSection,
    buildTaskSection,
    buildTimelineSection,
    buildEmptySection,
    buildSectionEmptyState,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml,
    buildHistorySection,
    buildStaleConnectedSection,
    buildUnlinkedMentionsSection,
    buildNoteArcSection,
    buildDocumentSection,
    describeHistoryEvent,
    esc
};
