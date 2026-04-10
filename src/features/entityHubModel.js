'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { getBacklinks } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { normaliseDateInput } = require('../core/date');
const { computeSuggestionsForNode, explainSuggestionState, queryAlreadyExists } = require('../engine/suggestions');
const { buildIncomingViewQuery, buildTypeViewQuery, getSchemaBackedDefaultSortField } = require('../actions/viewBuilder');

const SKIP_FIELDS = new Set(['id', 'created']);

function buildEntityHubModel(nodeId, idIndex, fieldsCache) {
    const nodeFields = fieldsCache.get(nodeId) || {};
    const incomingGroups = buildIncomingGroups(nodeId, idIndex, fieldsCache);
    const outgoingGroups = buildOutgoingGroups(nodeFields, idIndex, fieldsCache);
    const summaryRows = buildSummaryRows(nodeFields);
    const taskSections = buildTaskSections(nodeId, idIndex);
    const timelineRows = buildTimelineRows(nodeId, nodeFields, taskSections);
    const docText = getNodeDocText(nodeId, idIndex);
    const suggestions = buildSuggestionRows(nodeId, idIndex, docText);
    const suggestionExplanation = explainSuggestionState(nodeId);
    const recipes = buildContextualQueryRecipes(nodeId, nodeFields, incomingGroups, outgoingGroups, docText);
    const vaultPositionRows = buildVaultPositionRows(nodeFields, incomingGroups, outgoingGroups);

    return {
        nodeFields,
        incomingGroups,
        outgoingGroups,
        summaryRows,
        taskSections,
        timelineRows,
        suggestions,
        suggestionExplanation,
        recipes,
        vaultPositionRows,
        isEmpty: incomingGroups.length === 0
            && outgoingGroups.length === 0
            && summaryRows.length === 0
            && taskSections.length === 0
            && timelineRows.length === 0
            && suggestions.length === 0
            && recipes.length === 0
    };
}

function buildIncomingGroups(nodeId, idIndex, fieldsCache) {
    const groups = new Map();
    for (const { field, sourceId } of getBacklinks(nodeId)) {
        const filePath = idIndex.get(sourceId);
        const fields = fieldsCache.get(sourceId);
        if (!filePath || !fields) continue;
        if (!groups.has(field)) groups.set(field, []);
        groups.get(field).push({ sourceId, fields, filePath });
    }

    return [...groups.entries()]
        .sort((a, b) => {
            if (a[0] === 'body') return 1;
            if (b[0] === 'body') return -1;
            return a[0].localeCompare(b[0]);
        })
        .map(([field, rows]) => ({ field, rows, direction: 'incoming' }));
}

function extractRelations(raw) {
    return [...String(raw ?? '').matchAll(/\[\[([^\]]+)\]\]/g)]
        .map(match => match[1].trim().split('|')[0].trim())
        .filter(Boolean);
}

function buildOutgoingGroups(nodeFields, idIndex, fieldsCache) {
    const groups = [];
    for (const [field, rawValue] of Object.entries(nodeFields)) {
        if (SKIP_FIELDS.has(field)) continue;
        const targets = extractRelations(rawValue);
        if (targets.length === 0) continue;
        const rows = targets.map(targetId => ({
            sourceId: targetId,
            fields: fieldsCache.get(targetId) || { type: '', label: targetId },
            filePath: idIndex.get(targetId) || null
        }));
        groups.push({ field, rows, direction: 'outgoing' });
    }
    return groups.sort((a, b) => a.field.localeCompare(b.field));
}

function buildSummaryRows(nodeFields) {
    return Object.entries(nodeFields)
        .filter(([key, value]) => !SKIP_FIELDS.has(key) && value && extractRelations(value).length === 0)
        .map(([key, value]) => ({ key, value: String(value) }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

function summariseTypeCounts(rows) {
    const counts = new Map();
    for (const row of rows) {
        const type = String(row.fields?.type || 'unknown').trim().toLowerCase() || 'unknown';
        counts.set(type, (counts.get(type) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([type, count]) => `${type} (${count})`)
        .join(', ');
}

function summariseFieldCounts(groups) {
    return groups
        .map(group => ({ field: group.field, count: group.rows.length }))
        .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field))
        .map(item => `${item.field} (${item.count})`)
        .join(', ');
}

function buildVaultPositionRows(nodeFields, incomingGroups, outgoingGroups) {
    const incomingRows = incomingGroups.flatMap(group => group.rows);
    const outgoingRows = outgoingGroups.flatMap(group => group.rows);
    const bodyMentions = incomingGroups
        .filter(group => group.field === 'body')
        .reduce((sum, group) => sum + group.rows.length, 0);
    const rows = [
        { key: 'node type', value: String(nodeFields.type || 'node') },
        { key: 'inbound links', value: String(incomingRows.length) },
        { key: 'outbound links', value: String(outgoingRows.length) }
    ];

    if (bodyMentions > 0) rows.push({ key: 'body mentions', value: String(bodyMentions) });

    const inboundFields = summariseFieldCounts(incomingGroups);
    const outboundFields = summariseFieldCounts(outgoingGroups);
    const inboundTypes = summariseTypeCounts(incomingRows);
    const outboundTypes = summariseTypeCounts(outgoingRows);

    if (inboundFields) rows.push({ key: 'linked here via', value: inboundFields });
    if (outboundFields) rows.push({ key: 'links out via', value: outboundFields });
    if (inboundTypes) rows.push({ key: 'linked from types', value: inboundTypes });
    if (outboundTypes) rows.push({ key: 'links to types', value: outboundTypes });

    return rows;
}

function buildTaskSections(nodeId, idIndex) {
    const taskRows = buildTaskRows(idIndex);
    const inNote = [];
    const linkedHere = [];

    for (const row of taskRows) {
        const payload = {
            id: row.id,
            text: row.text,
            done: row.done ? 'true' : 'false',
            date: row.date || '',
            file: row.fileId,
            line: String(row.line || '')
        };
        if (row.fileId === nodeId) inNote.push(payload);
        else if (Array.isArray(row.links) && row.links.includes(nodeId)) linkedHere.push(payload);
    }

    const sections = [];
    if (inNote.length > 0) sections.push({ label: 'tasks in note', rows: inNote });
    if (linkedHere.length > 0) sections.push({ label: 'tasks linking here', rows: linkedHere });
    return sections;
}

function buildTimelineRows(nodeId, nodeFields, taskSections) {
    const rows = [];
    const nodeDate = normaliseDateInput(nodeFields.date || '');
    if (nodeDate) {
        rows.push({
            date: nodeDate,
            label: nodeId,
            source: nodeId,
            kind: 'node'
        });
    }

    for (const section of taskSections) {
        for (const row of section.rows) {
            if (!row.date) continue;
            rows.push({
                date: row.date,
                label: row.text,
                source: row.file,
                kind: section.label
            });
        }
    }

    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

function getNodeDocText(nodeId, idIndex) {
    const filePath = idIndex.get(nodeId);
    if (!filePath) return null;
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown' && editor.document.uri.fsPath === filePath) {
        return editor.document.getText();
    }
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
    }
    return null;
}

function buildSuggestionRows(nodeId, idIndex, docText) {
    void idIndex;
    return computeSuggestionsForNode(nodeId, docText, { keepExisting: true }).map(function (row) {
        return {
            ...row,
            inserted: Boolean(row.inserted)
        };
    });
}

function buildContextualQueryRecipes(nodeId, nodeFields, incomingGroups, outgoingGroups, docText) {
    const recipes = [];
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();
    const inboundTypes = [...new Set(
        incomingGroups
            .filter(group => group.field !== 'body')
            .flatMap(group => group.rows)
            .map(row => String(row.fields?.type || '').trim().toLowerCase())
            .filter(Boolean)
    )];
    const outboundTypes = [...new Set(
        outgoingGroups
            .flatMap(group => group.rows)
            .map(row => String(row.fields?.type || '').trim().toLowerCase())
            .filter(Boolean)
    )];

    recipes.push({
        title: 'Backlinks to this note',
        description: 'See everything that links here',
        queryText: buildIncomingViewQuery('*', '*', { label: 'Backlinks' }),
        inserted: docText ? docText.includes(buildIncomingViewQuery('*', '*', { label: 'Backlinks' })) : false
    });

    for (const type of inboundTypes.slice(0, 2)) {
        const queryText = buildIncomingViewQuery(type, '*', {
            label: `${type} backlinks`,
            sortField: getSchemaBackedDefaultSortField(type),
            limit: 10
        });
        recipes.push({
            title: `Incoming ${type}`,
            description: `Focus on ${type} nodes linking here`,
            queryText,
            inserted: docText ? queryAlreadyExists(docText, type, '*', nodeId) || docText.includes(queryText) : false
        });
    }

    if (nodeType) {
        const queryText = buildTypeViewQuery(nodeType, 'smart', {
            label: `${nodeType}s`,
            sortField: getSchemaBackedDefaultSortField(nodeType),
            limit: 25
        });
        recipes.push({
            title: `More ${nodeType} notes`,
            description: `Browse other ${nodeType} nodes`,
            queryText,
            inserted: docText ? docText.includes(queryText) : false
        });
    }

    for (const type of outboundTypes.slice(0, 1)) {
        const queryText = buildTypeViewQuery(type, 'smart', {
            label: `${type}s`,
            sortField: getSchemaBackedDefaultSortField(type),
            limit: 25
        });
        recipes.push({
            title: `${type} references`,
            description: `Browse linked ${type} nodes`,
            queryText,
            inserted: docText ? docText.includes(queryText) : false
        });
    }

    const seen = new Set();
    return recipes.filter(recipe => {
        if (!recipe.queryText || seen.has(recipe.queryText)) return false;
        seen.add(recipe.queryText);
        return true;
    });
}

function getVisibleRelationColumns(rows) {
    const fieldSet = new Set();
    for (const { fields } of rows) {
        for (const key of Object.keys(fields || {})) {
            if (SKIP_FIELDS.has(key)) continue;
            const raw = fields[key];
            if (String(raw ?? '').trim()) fieldSet.add(key);
        }
    }
    return ['id', ...Array.from(fieldSet).sort()];
}

function getVisibleTaskColumns(rows) {
    const candidates = ['date', 'done', 'file', 'text'];
    const visible = candidates.filter(function (col) {
        return rows.some(function (row) {
            return String(row[col] ?? '').trim();
        });
    });
    return ['id', ...visible];
}

module.exports = {
    buildContextualQueryRecipes,
    buildEntityHubModel,
    getVisibleRelationColumns,
    getVisibleTaskColumns,
    extractRelations
};
