'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { getBacklinks } = require('../core/graph');
const { buildTaskRows } = require('../core/tasks');
const { normaliseDateInput } = require('../core/date');
const { getSchema, getSchemaTargets } = require('../registries/schemaRegistry');
const {
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS
} = require('../intelligence/fieldRolesCore');
const { summarizeNoteRoleReasons, summarizeNoteRole } = require('../intelligence/noteRolesCore');
const { filterItemsForSurface, shouldSurface } = require('../intelligence/confidence');
const {
    buildFrontmatterOpportunityModel,
    buildFrontmatterGuidanceSummary,
    summarizeGuidanceExplanation,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const {
    buildObservedFields,
    buildNoteContext,
    buildBridgePaths,
    buildSharedContextTraces,
    buildAdaptiveFieldPatterns,
    describeContextOrigin,
    summarizeBridgeHints,
    summarizeTraceHints,
    summarizeAdaptiveFieldHints
} = require('../intelligence/suggestionCore');
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
    const suggestions = buildSuggestionRows(nodeId, docText);
    const suggestionExplanation = explainSuggestionState(nodeId);
    const recipes = buildContextualQueryRecipes(nodeId, nodeFields, incomingGroups, outgoingGroups, docText, fieldsCache);
    const vaultPositionRows = buildVaultPositionRows(
        nodeId,
        nodeFields,
        incomingGroups,
        outgoingGroups,
        fieldsCache,
        docText,
        suggestions,
        suggestionExplanation
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
        .filter(([key, value]) => !SKIP_FIELDS.has(key) && key !== 'type' && value && extractRelations(value).length === 0)
        .map(([key, value]) => ({ key, value: String(value) }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

function summarizeFieldNames(items, limit = 3) {
    return items
        .slice(0, limit)
        .map((hint) => hint.field)
        .join('; ');
}

function summarizeConnectionHints(items, limit = 2) {
    return items
        .slice(0, limit)
        .map((hint) => hint.summary || hint.field || hint.targetId || '')
        .filter(Boolean)
        .join('; ');
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
    const observedFields = buildObservedFields(fieldsCache);
    const noteContext = buildNoteContext(nodeFields, nodeType, {
        observedFields,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
    });
    const rows = [];
    if (noteContext.noteRole?.noteRole && shouldSurface(noteContext.noteRole, 'report-note-role', { confidenceKey: 'confidence' })) {
        rows.push({
            key: 'note role',
            value: `${summarizeNoteRole(noteContext.noteRole)} (${Math.round((noteContext.noteRole.confidence || 0) * 100)}%)`
        });
        const why = summarizeNoteRoleReasons(noteContext.noteRole);
        if (why) rows.push({ key: 'why', value: why });
    }

    const bridgePaths = buildBridgePaths(nodeId, nodeFields, noteContext, fieldsCache, {
        nodeType, observedFields, getSchemaTargets, getSchemaForType: getSchema
    });
    const bridgeHints = summarizeBridgeHints(bridgePaths, 2);
    if (bridgeHints.length) {
        rows.push({ key: 'related notes', value: bridgeHints.map(b => b.summary).join('; ') });
        rows.push({ key: 'next links', value: bridgeHints.map(b => `link ${b.candidateId}`).join('; ') });
    }

    const traces = buildSharedContextTraces(nodeId, nodeFields, noteContext, fieldsCache, {
        nodeType, observedFields, getSchemaTargets, getSchemaForType: getSchema
    });
    const traceHints = summarizeTraceHints(traces, 2);
    if (traceHints.length) {
        rows.push({
            key: 'paths',
            value: traceHints.slice(0, 1).map(t => `${t.summary}: ${t.path.join(' -> ')}`).join('; ')
        });
    }

    const frontmatterOpportunities = buildFrontmatterOpportunityModel(nodeFields, {
        nodeId, nodeType, fieldsCache, observedFields, noteContext,
        content: docText,
        getSchemaForType: getSchema, dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS, limit: 4
    });
    const guidance = buildFrontmatterGuidanceSummary(frontmatterOpportunities);
    const reportFields = filterItemsForSurface(frontmatterOpportunities.likelyFields, 'report-opportunities', { scoreScale: 700 });
    const reportGaps = filterItemsForSurface(frontmatterOpportunities.likelyGaps, 'report-opportunities', { scoreScale: 700 });
    const reportContexts = filterItemsForSurface(frontmatterOpportunities.likelyContexts, 'report-opportunities', { scoreScale: 700 });
    const reportConnections = filterItemsForSurface(frontmatterOpportunities.likelyConnections, 'report-opportunities', { scoreScale: 700 });
    const reportCompanions = filterItemsForSurface(frontmatterOpportunities.likelyCompanions, 'report-opportunities', { scoreScale: 700 });
    const reportThreadViews = filterItemsForSurface(frontmatterOpportunities.contextThreadViews || [], 'report-opportunities', { scoreScale: 900 });
    const reportSetups = filterItemsForSurface(frontmatterOpportunities.surroundingSetups || [], 'report-opportunities', { scoreScale: 1100 });
    const bodyHints = docText
        ? buildBodyMentionHints(docText, nodeFields, fieldsCache, { threshold: 2 }).slice(0, 2)
        : [];

    if (guidance.headline) rows.push({ key: 'next step', value: guidance.headline });
    const guidanceWhy = summarizeGuidanceExplanation(guidance);
    if (guidanceWhy) rows.push({ key: 'why', value: guidanceWhy });
    if (guidance.workflowSummary) rows.push({ key: 'pattern', value: guidance.workflowSummary });
    if (guidance.setupSummary) rows.push({ key: 'setup', value: guidance.setupSummary });

    const adaptiveFieldHints = reportFields.slice(0, 2);
    if (adaptiveFieldHints.length) {
        rows.push({ key: 'next fields', value: summarizeFieldNames(adaptiveFieldHints, 3) });
        const relationHint = adaptiveFieldHints.find(h => h.relational && h.sampleTargets.length);
        if (relationHint) {
            rows.push({ key: 'next link', value: `${relationHint.field} often points to ${relationHint.sampleTargets.slice(0, 2).join('; ')}` });
        } else if (bodyHints.length) {
            rows.push({ key: 'next link', value: `link ${bodyHints[0].id}` });
        }
    }
    if (reportGaps.length) rows.push({ key: 'missing', value: summarizeFieldNames(reportGaps, 3) });
    if (frontmatterOpportunities.setupFields.length > 0 && frontmatterOpportunities.setupInsertText) {
        rows.push({ key: 'setup fields', value: frontmatterOpportunities.setupFields.map(h => h.field).join(', ') });
    }
    if (frontmatterOpportunities.recommendedBundle?.fields?.length) {
        rows.push({ key: 'useful fields', value: summarizeFieldNames(frontmatterOpportunities.recommendedBundle.fields, 4) });
    }
    if (reportContexts.length) {
        rows.push({ key: 'context', value: reportContexts.slice(0, 2).map(h => `${h.field} -> ${h.targetId}`).join('; ') });
    }
    if (reportConnections.length) {
        rows.push({ key: 'related note', value: reportConnections.slice(0, 1).map(h => h.summary).join('; ') });
    }
    if (bodyHints.length) {
        rows.push({ key: 'body links', value: bodyHints.map(h => `${h.id} (${h.count})`).join('; ') });
    }
    if (reportCompanions.length) {
        rows.push({ key: 'nearby note', value: reportCompanions.slice(0, 2).map(h => h.summary).join('; ') });
    }
    if (frontmatterOpportunities.contextBundle?.summary) {
        rows.push({ key: 'flow', value: frontmatterOpportunities.contextBundle.summary });
    }
    if (reportThreadViews.length) {
        rows.push({ key: 'common view', value: reportThreadViews.slice(0, 2).map(v => v.summary).join('; ') });
    }
    if (reportSetups.length) {
        rows.push({ key: 'common setup', value: reportSetups.slice(0, 2).map(s => s.summary).join('; ') });
    }

    return rows;
}

function buildSuggestionSignalRows(suggestions, explanation) {
    const rows = [];
    const visibleSuggestions = filterItemsForSurface(suggestions, 'report-suggestions', { scoreScale: 130 });
    if (Array.isArray(visibleSuggestions) && visibleSuggestions.length) {
        const top = visibleSuggestions[0];
        rows.push({
            key: 'next view',
            value: top.title
        });
        rows.push({
            key: 'hints',
            value: visibleSuggestions
                .slice(0, 1)
                .map(function (suggestion) {
                    return suggestion.description;
                })
                .join('; ')
        });
        return rows;
    }

    const reasons = Array.isArray(explanation?.reasons) ? explanation.reasons.filter(Boolean) : [];
    if (reasons.length) {
        rows.push({
            key: 'hints',
            value: reasons.slice(0, 2).join('; ')
        });
    }
    return rows;
}

function buildVaultPositionRows(nodeId, nodeFields, incomingGroups, outgoingGroups, fieldsCache, docText = null, suggestions = [], suggestionExplanation = null) {
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

    return [
        ...buildIntelligenceRows(nodeId, nodeFields, fieldsCache, docText),
        ...buildSuggestionSignalRows(suggestions, suggestionExplanation),
        ...rows
    ];
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
        const observedFields = buildObservedFields(fieldsCache);
        const noteContext = buildNoteContext(nodeFields, nodeType, {
            observedFields,
            getSchemaForType: getSchema,
            dateParser: normaliseDateInput,
            statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
            semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
        });
        const opportunities = buildFrontmatterOpportunityModel(nodeFields, {
            nodeId,
            nodeType,
            content: docText,
            fieldsCache,
            observedFields,
            noteContext,
            getSchemaTargets,
            getSchemaForType: getSchema,
            getDefaultSortField: getSchemaBackedDefaultSortField,
            dateParser: normaliseDateInput,
            statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
            semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
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
