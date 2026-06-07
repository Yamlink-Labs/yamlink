'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { getBacklinks, getEdges, getGraphStats } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { getVaultGeneration } = require('../core/indexService');
const { normaliseDateInput } = require('../core/date');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const { inferNoteRole, summarizeNoteRole } = require('../intelligence/noteRolesCore');
const {
    getCachedPriors,
    buildVaultStatusValues,
    buildVaultSemanticRolePriors
} = require('../intelligence/vaultPriors');
const { inferLifecycleState, summarizeLifecycleState } = require('../intelligence/lifecycleState');
const { filterItemsForSurface, shouldSurface } = require('../intelligence/confidence');
const {
    buildFrontmatterOpportunityModel,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const { buildNoteContext } = require('../intelligence/suggestionCore');
const { getVaultPatterns } = require('../intelligence/intelligenceCache');
const { computeSuggestionsForNode, explainSuggestionState, queryAlreadyExists } = require('../engine/suggestions');
const { buildIncomingViewQuery, buildTypeViewQuery, getSchemaBackedDefaultSortField } = require('../actions/viewBuilder');
const { buildHistoryModel } = require('./entity/historyModel');
const { findUnlinkedMentions } = require('./entity/unlinkedRefs');
const { getMutationEvents } = require('../runtime/mutationEventLog');
const { buildNoteArc } = require('../intelligence/noteArc');

const SKIP_FIELDS = new Set(['id', 'created']);

/** @param {string} nodeId @param {Map<string,string>} idIndex @param {Map<string,Record<string,any>>} fieldsCache @returns {Record<string,any>} */
function buildEntityHubModel(nodeId, idIndex, fieldsCache) {
    const nodeFields = fieldsCache.get(nodeId) || {};
    const incomingGroups = buildIncomingGroups(nodeId, idIndex, fieldsCache);
    const outgoingGroups = buildOutgoingGroups(nodeId, nodeFields, idIndex, fieldsCache);
    const summaryRows = buildSummaryRows(nodeFields);
    const taskSections = buildTaskSections(nodeId, idIndex);
    const timelineRows = buildTimelineRows(nodeId, nodeFields, taskSections);
    const docText = getNodeDocText(nodeId, idIndex);
    const suggestions = buildSuggestionRows(nodeId, docText);
    const suggestionExplanation = explainSuggestionState(nodeId);
    const recipes = buildContextualQueryRecipes(nodeId, nodeFields, incomingGroups, outgoingGroups, docText, fieldsCache);
    const {
        vaultPositionRows,
        vaultDiagnosticRows
    } = buildVaultPositionRows(
        nodeId,
        nodeFields,
        incomingGroups,
        outgoingGroups,
        idIndex,
        fieldsCache,
        docText,
        suggestions,
        suggestionExplanation
    );
    const { groups: historyGroups, totalCount: historyCount, arc: historyArc } = buildHistoryModel(nodeId);
    const unlinkedMentions = findUnlinkedMentions(
        nodeId,
        nodeFields,
        idIndex,
        fieldsCache,
        getVaultGeneration()
    );

    const _arcPriors = getCachedPriors(fieldsCache, getVaultGeneration());
    const noteArc = buildNoteArc(
        nodeFields,
        String(nodeFields.type || '').trim().toLowerCase(),
        fieldsCache,
        _arcPriors.typeFieldBundles,
        _arcPriors.fieldTargetTypes,
        _arcPriors.outcomeCalibration
    );

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
        vaultDiagnosticRows,
        historyGroups,
        historyCount,
        historyArc,
        unlinkedMentions,
        noteArc,
        isEmpty: incomingGroups.length === 0
            && outgoingGroups.length === 0
            && summaryRows.length === 0
            && taskSections.length === 0
            && timelineRows.length === 0
            && suggestions.length === 0
            && recipes.length === 0
            && historyCount === 0
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

/** @param {any} raw @returns {string[]} */
function extractRelations(raw) {
    return [...String(raw ?? '').matchAll(/\[\[([^\]]+)\]\]/g)]
        .map(match => match[1].trim().split('|')[0].trim())
        .filter(Boolean);
}

function buildOutgoingGroups(nodeId, nodeFields, idIndex, fieldsCache) {
    const groups = new Map();

    for (const { field, targetId } of getEdges(nodeId)) {
        if (SKIP_FIELDS.has(field)) continue;
        if (!groups.has(field)) groups.set(field, []);
        groups.get(field).push({
            sourceId: targetId,
            fields: fieldsCache.get(targetId) || { type: '', label: targetId },
            filePath: idIndex.get(targetId) || null
        });
    }

    // Fallback to frontmatter parsing only if graph edges have not been built yet.
    if (groups.size === 0) {
        for (const [field, rawValue] of Object.entries(nodeFields)) {
            if (SKIP_FIELDS.has(field)) continue;
            const targets = extractRelations(rawValue);
            if (targets.length === 0) continue;
            groups.set(field, targets.map(targetId => ({
                sourceId: targetId,
                fields: fieldsCache.get(targetId) || { type: '', label: targetId },
                filePath: idIndex.get(targetId) || null
            })));
        }
    }

    return [...groups.entries()]
        .map(([field, rows]) => ({ field, rows, direction: 'outgoing' }))
        .sort((a, b) => {
            if (a.field === 'body') return 1;
            if (b.field === 'body') return -1;
            return a.field.localeCompare(b.field);
        });
}

function buildSummaryRows(nodeFields) {
    return Object.entries(nodeFields)
        .filter(([key, value]) => !SKIP_FIELDS.has(key) && key !== 'type' && value && extractRelations(value).length === 0)
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

function buildIntelligenceRows(nodeId, nodeFields, fieldsCache, docText) {
    const nodeType = String(nodeFields.type || '').trim().toLowerCase();
    const { observedFields } = getVaultPatterns(fieldsCache, getVaultGeneration());
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: buildVaultStatusValues(getCachedPriors(fieldsCache, getVaultGeneration()).workflowFields),
        semanticRolePriors: buildVaultSemanticRolePriors(getCachedPriors(fieldsCache, getVaultGeneration()))
    });
    const rows = [];
    if (noteContext.noteRole?.noteRole && shouldSurface(noteContext.noteRole, 'report-note-role', { confidenceKey: 'confidence' })) {
        rows.push({ key: 'note role', value: summarizeNoteRole(noteContext.noteRole) });
    }
    const bodyHints = docText
        ? buildBodyMentionHints(docText, nodeFields, fieldsCache, { threshold: 2 }).slice(0, 2)
        : [];
    if (bodyHints.length) {
        rows.push({ key: 'body evidence', value: bodyHints.map(h => `${h.id} (${h.count})`).join('; ') });
    }
    return rows;
}

function buildSuggestionSignalRows(suggestions) {
    const visibleSuggestions = filterItemsForSurface(suggestions, 'report-suggestions', { scoreScale: 130 });
    if (Array.isArray(visibleSuggestions) && visibleSuggestions.length) {
        return [{ key: 'next view', value: visibleSuggestions[0].title }];
    }
    return [];
}

function buildVaultPositionRows(nodeId, nodeFields, incomingGroups, outgoingGroups, idIndex, fieldsCache, docText = null, suggestions = [], suggestionExplanation = null) {
    const stats = getGraphStats();
    const vaultAvg = stats.nodes > 0 ? (stats.totalEdges / stats.nodes).toFixed(1) : '0';
    const { fieldTargetTypes, typeFieldBundles, noteRoleTypePriors } = getCachedPriors(fieldsCache, getVaultGeneration());

    const incomingRows = incomingGroups.flatMap(group => group.rows);
    const outgoingRows = outgoingGroups.flatMap(group => group.rows);
    const incomingBodyMentions = incomingGroups
        .filter(group => group.field === 'body')
        .reduce((sum, group) => sum + group.rows.length, 0);
    const outgoingBodyMentions = outgoingGroups
        .filter(group => group.field === 'body')
        .reduce((sum, group) => sum + group.rows.length, 0);
    const structuredIncomingGroups = incomingGroups.filter(group => group.field !== 'body');
    const structuredOutgoingGroups = outgoingGroups.filter(group => group.field !== 'body');
    const structuredIncomingRows = structuredIncomingGroups.flatMap(group => group.rows);
    const structuredOutgoingRows = structuredOutgoingGroups.flatMap(group => group.rows);

    const rows = [
        { key: 'note type', value: String(nodeFields.type || 'note') },
        { key: 'structured inbound links', value: `${structuredIncomingRows.length} (vault avg ${vaultAvg})` },
        { key: 'structured outbound links', value: `${structuredOutgoingRows.length} (vault avg ${vaultAvg})` }
    ];

    const inboundFields = summariseFieldCounts(incomingGroups);
    const outboundFields = summariseFieldCounts(outgoingGroups);
    const inboundTypes = summariseTypeCounts(incomingRows);
    const outboundTypes = summariseTypeCounts(outgoingRows);
    const noteRole = inferNoteRole(nodeFields, {});
    const lastMutationEvent = getMutationEvents({ noteId: nodeId, limit: 1 });
    const lastMutationMs = lastMutationEvent.length > 0 ? Date.parse(lastMutationEvent[0].timestamp) : null;
    const lifecycle = inferLifecycleState(nodeId, nodeFields, {
        idIndex,
        fieldsCache,
        fieldTargetTypes,
        typeFieldBundles,
        noteRoleTypePriors,
        noteRole,
        noteType: String(nodeFields.type || '').trim().toLowerCase(),
        inboundCount: incomingRows.length,
        avgInbound: stats.nodes > 0 ? (stats.totalBacklinks || 0) / stats.nodes : 0,
        lastMutationMs: Number.isFinite(lastMutationMs) ? lastMutationMs : undefined
    });

    rows.push({ key: 'lifecycle', value: summarizeLifecycleState(lifecycle) });

    const intelligenceRows = buildIntelligenceRows(nodeId, nodeFields, fieldsCache, docText);
    const noteRoleRow = intelligenceRows.find(row => row.key === 'note role');
    const bodyEvidenceRow = intelligenceRows.find(row => row.key === 'body evidence');
    if (noteRoleRow) rows.push(noteRoleRow);
    const suggestionRows = buildSuggestionSignalRows(suggestions);

    const diagnosticRows = [
        { key: 'total inbound link rows', value: `${incomingRows.length}` },
        { key: 'total outbound link rows', value: `${outgoingRows.length}` }
    ];
    if (incomingBodyMentions > 0) diagnosticRows.push({ key: 'body mentions to this note', value: String(incomingBodyMentions) });
    if (outgoingBodyMentions > 0) diagnosticRows.push({ key: 'body mentions from this note', value: String(outgoingBodyMentions) });
    if (inboundFields) diagnosticRows.push({ key: 'linked here via', value: inboundFields });
    if (outboundFields) diagnosticRows.push({ key: 'links out via', value: outboundFields });
    if (inboundTypes) diagnosticRows.push({ key: 'linked from types', value: inboundTypes });
    if (outboundTypes) diagnosticRows.push({ key: 'links to types', value: outboundTypes });
    if (bodyEvidenceRow) diagnosticRows.push(bodyEvidenceRow);

    return {
        vaultPositionRows: [
            ...rows,
            ...suggestionRows
        ],
        vaultDiagnosticRows: diagnosticRows
    };
}

function buildTaskSections(nodeId, idIndex) {
    const taskRows = buildTaskRows(idIndex, getVaultGeneration());
    const inNote = [];

    for (const row of taskRows) {
        const payload = {
            id: row.id,
            text: row.displayText || row.text,
            done: row.done ? 'true' : 'false',
            date: row.date || '',
            file: row.fileId,
            line: String(row.line || ''),
            body: row.body || ''
        };
        if (row.fileId === nodeId) inNote.push(payload);
    }

    const sections = [];
    if (inNote.length > 0) sections.push({ label: 'tasks in this note', rows: inNote });
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

function buildSuggestionRows(nodeId, docText) {
    return computeSuggestionsForNode(nodeId, docText, { keepExisting: true }).map(function (row) {
        return {
            ...row,
            inserted: Boolean(row.inserted)
        };
    });
}

function buildContextualQueryRecipes(nodeId, nodeFields, incomingGroups, outgoingGroups, docText, fieldsCache = new Map()) {
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

    if (fieldsCache && fieldsCache.size) {
        const { observedFields, observedIndex } = getVaultPatterns(fieldsCache, getVaultGeneration());
        const _priors = getCachedPriors(fieldsCache, getVaultGeneration());
        const _statusValues = buildVaultStatusValues(_priors.workflowFields);
        const _semRolePriors = buildVaultSemanticRolePriors(_priors);
        const noteContext = buildNoteContext(nodeFields, nodeType, {
            observedFields,
            getSchemaForType: getSchema,
            dateParser: normaliseDateInput,
            statusLikeValues: _statusValues,
            semanticRolePriors: _semRolePriors
        });
        const opportunities = buildFrontmatterOpportunityModel(nodeFields, {
            nodeId,
            nodeType,
            content: docText,
            fieldsCache,
            observedFields,
            observedIndex,
            noteContext,
            getSchemaTargets,
            getSchemaForType: getSchema,
            getDefaultSortField: getSchemaBackedDefaultSortField,
            dateParser: normaliseDateInput,
            statusLikeValues: _statusValues,
            semanticRolePriors: _semRolePriors,
            limit: 4,
            connectionLimit: 3
        });

        for (const view of opportunities.relationViews.slice(0, 2)) {
            recipes.push({
                title: `Related thread: ${view.relatedId}`,
                description: view.description,
                queryText: view.queryText,
                inserted: docText ? docText.includes(view.queryText) : false
            });
        }
        for (const setup of opportunities.surroundingSetups.slice(0, 2)) {
            recipes.push({
                title: `Surrounding setup: ${setup.targetId}`,
                description: setup.description,
                queryText: setup.queryText,
                inserted: docText ? docText.includes(setup.queryText) : false
            });
        }
    }

    const seen = new Set();
    return recipes.filter(recipe => {
        if (!recipe.queryText || seen.has(recipe.queryText)) return false;
        seen.add(recipe.queryText);
        return true;
    });
}

/** @param {Array<{fields?: Record<string,any>}>} rows @returns {string[]} */
function getVisibleRelationColumns(rows) {
    const priority = ['type', 'status', 'owner', 'date', 'name', 'title', 'role', 'priority'];
    const fieldSet = new Set();
    for (const { fields } of rows) {
        for (const key of Object.keys(fields || {})) {
            if (SKIP_FIELDS.has(key)) continue;
            const raw = fields[key];
            if (String(raw ?? '').trim()) fieldSet.add(key);
        }
    }
    const fields = Array.from(fieldSet);
    const ordered = [
        ...priority.filter((key) => fields.includes(key)),
        ...fields
            .filter((key) => !priority.includes(key))
            .sort((a, b) => a.localeCompare(b))
    ];
    return ['id', ...ordered.slice(0, 6)];
}

/** @param {Array<Record<string,any>>} rows @returns {string[]} */
function getVisibleTaskColumns(rows) {
    const sameFile = rows.length > 0 && rows.every(function (row) {
        return row.file && row.file === rows[0].file;
    });
    const candidates = sameFile ? ['text', 'date', 'done'] : ['text', 'date', 'done', 'file'];
    const visible = candidates.filter(function (col) {
        return rows.some(function (row) {
            return String(row[col] ?? '').trim();
        });
    });
    return visible;
}

module.exports = {
    buildContextualQueryRecipes,
    buildEntityHubModel,
    buildHistoryModel,
    getVisibleRelationColumns,
    getVisibleTaskColumns,
    extractRelations
};
