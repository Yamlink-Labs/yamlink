'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors }                               = require('../../intelligence/vaultPriors');
const { buildNoteArc }                                  = require('../../intelligence/noteArc');
const { getBacklinks, getEdges }                        = require('../../core/graph');
const {
    formatLikelyMissingFields,
    getExpectedRelationTypes,
    rankWikilinkTargets,
    evaluateFieldForSurface
} = require('../../intelligence/authoringEngine');
const { LEVEL }                                         = require('../../intelligence/fieldPlanner');
const { buildHoverBadgeDataUri }                        = require('../../intelligence/hoverBadge');
const {
    getHumanLabel,
    buildRelationCandidateDetail,
    buildRelationCandidateEvidence,
    resolveFrontmatterRelationCandidates,
    rankCandidateIds
} = require('../../intelligence/completionRelationHelpers');
const {
    getDocumentType,
    extractFrontmatterFields
} = require('../../intelligence/completionContextHelpers');
const { getSchema }                                     = require('../../registries/schemaRegistry');
const {
    buildAdaptiveFrontmatterContext,
    collectObservedFrontmatterFields,
    collectRoleAlignedObservedFrontmatterFields,
    collectContextualObservedFrontmatterFields,
    collectAdaptiveFrontmatterFieldSuggestions,
    collectSchemaAdaptiveGapSuggestions,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions
} = require('../../intelligence/completionAdaptiveHelpers');
const { summarizeNoteRoleReasons }                      = require('../../intelligence/noteRolesCore');
const { respond }                                       = require('../transport');
const { getDocumentText }                               = require('../documentState');
const { inFrontmatter, uriToPath }                      = require('../utils');

function _fieldValueHint(field, priors) {
    if (priors.workflowFields && priors.workflowFields.has(field)) {
        const { values } = priors.workflowFields.get(field);
        return values.slice(0, 4).join(' | ');
    }
    const amb = priors.fieldAmbiguity && priors.fieldAmbiguity.get(field);
    if (amb && amb.linkRatio > 0.5) return '[[relation]]';
    return '';
}

// fieldKey — optional frontmatter field the wikilink is being typed into.
// priors   — vault priors for target-type ranking.
// When fieldKey is known, notes whose type matches the field's dominant target
// type are ranked first (score 0 vs 1/2/3 for everything else).
function _wikilinkCompletions(partial, fieldKey) {
    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();
    const expectedTypes = fieldKey
        ? getExpectedRelationTypes(fieldKey, { fieldsCache, generation: getVaultGeneration() })
        : [];

    const ranked = rankWikilinkTargets(Array.from(idIndex.keys()).map((id) => {
        const fields = fieldsCache.get(id) || {};
        const aliases = Array.isArray(fields.aliases)
            ? fields.aliases
            : String(fields.aliases || '')
                .split(/,\s*/)
                .filter(Boolean);
        return {
            id,
            label: String(fields.name || fields.title || id),
            aliases,
            type: String(fields.type || ''),
            status: String(fields.status || '')
        };
    }), partial, { expectedTypes });

    return ranked.slice(0, 50).map((entry, index) => ({
        label:      entry.label !== entry.id ? entry.label : entry.id,
        kind:       17, // Reference
        detail:     entry.type + (entry.status ? ` · ${entry.status}` : ''),
        documentation: { kind: 'markdown', value: buildRelationCandidateDocumentationMarkdown(entry.id, entry.type, [], null) },
        insertText: entry.id + ']]',
        filterText: [entry.id, entry.label].concat(entry.aliases || []).join(' '),
        sortText:   String(index).padStart(4, '0') + entry.label.toLowerCase(),
        data:       { id: entry.id }
    }));
}

// Merges a collector's suggestions into fieldScores/detailByField using the
// same accumulation shape completionProviders.js uses on the VS Code side:
// first mention sets the score, subsequent mentions from other signal
// sources add on top and append their detail rather than overwrite it.
function _mergeFieldSignal(fieldScores, detailByField, key, baseScore, addScore, detail) {
    if (!fieldScores.has(key)) {
        fieldScores.set(key, baseScore);
        detailByField.set(key, detail);
    } else {
        fieldScores.set(key, fieldScores.get(key) + addScore);
        detailByField.set(key, `${detailByField.get(key)}; ${detail}`);
    }
}

function _frontmatterKeyCompletions(partial, lines, priors, content, filePath) {
    const fieldsCache = getFieldsCache();
    const idIndex = getIndex();

    // Scans between the opening and closing `---` fences. The first line of
    // any frontmatter block IS an opening `---`, so it must be skipped rather
    // than treated as the closing fence — otherwise this loop exits before
    // reading a single field, and noteId/noteType always stay null.
    let noteType = null;
    let noteId   = null;
    let seenOpeningFence = false;
    for (const l of lines) {
        if (l.trim() === '---') {
            if (!seenOpeningFence) { seenOpeningFence = true; continue; }
            break;
        }
        const typeMatch = /^type:\s+(\S+)/.exec(l);
        const idMatch   = /^id:\s+(\S+)/.exec(l);
        if (typeMatch && !noteType) noteType = typeMatch[1];
        if (idMatch   && !noteId)   noteId   = idMatch[1];
    }
    const docType = noteType ? String(noteType).trim().toLowerCase() : null;

    const fieldScores = new Map();
    const detailByField = new Map();
    const arcFields   = new Map(); // field -> confidenceLabel for arc-predicted fields
    const clusterFields = new Set(); // fields matched via an emergent cluster, not a confirmed type bundle

    for (const key of ['id', 'type', 'name', 'title', 'status', 'date', 'tags', 'summary', 'created', 'updated']) {
        fieldScores.set(key, 20);
    }

    // Schema fields — highest priority, same as completionProviders.js.
    const schema = getSchema(docType);
    if (schema?.fields) {
        for (const [key, def] of Object.entries(schema.fields)) {
            fieldScores.set(key, 1400 + (def.required ? 80 : 0));
            detailByField.set(key, def.type === 'relation'
                ? `${key}${def.required ? ' (required)' : ''} · schema relation${def.target ? ` → ${def.target}` : ''}`
                : `${key}${def.required ? ' (required)' : ''} · from schema`);
        }
    }

    if (noteType && priors.typeFieldBundles && priors.typeFieldBundles.has(noteType)) {
        for (const [field, count] of priors.typeFieldBundles.get(noteType)) {
            if (field.startsWith('_')) continue;
            fieldScores.set(field, (fieldScores.get(field) || 0) + count * 2);
        }
    }

    if (priors.typeFieldBundles) {
        for (const [, bundle] of priors.typeFieldBundles) {
            for (const [field, count] of bundle) {
                if (field.startsWith('_')) continue;
                if (!fieldScores.has(field)) fieldScores.set(field, count * 0.5);
            }
        }
    }

    // The 6 signal sources VS Code's completion already uses (drift, note-role,
    // archetype, observed/role-aligned, contextual, adaptive + adaptive-gap) —
    // ported here so LSP clients (Zed, Neovim, etc.) get the same intelligence
    // depth, not a simplified approximation. Best-effort: a failure in any one
    // of these must not break basic frontmatter completion.
    try {
        const documentAdapter = {
            getText: () => content,
            uri: filePath ? { fsPath: filePath } : undefined
        };
        const adaptiveContext = buildAdaptiveFrontmatterContext(documentAdapter, docType, idIndex, getSchema);

        for (const entry of collectDriftMissingFieldSuggestions(documentAdapter, docType, idIndex)) {
            _mergeFieldSignal(fieldScores, detailByField, entry.key, 1350 + entry.score, 200 + entry.score, entry.driftNote);
        }

        for (const entry of collectNoteRoleFieldSuggestions(documentAdapter, docType, idIndex)) {
            const noteRoleReason = entry.noteRole ? summarizeNoteRoleReasons(entry.noteRole) : '';
            const roleLead = entry.roleSummary || `${entry.source} note`;
            const detail = noteRoleReason ? `common on ${roleLead}; ${noteRoleReason}` : `common on ${roleLead}`;
            _mergeFieldSignal(fieldScores, detailByField, entry.key,
                900 + entry.score + (!docType ? 220 : 0), entry.score + (!docType ? 120 : 0), detail);
        }

        for (const entry of collectArchetypeFieldSuggestions(documentAdapter, docType)) {
            _mergeFieldSignal(fieldScores, detailByField, entry.key,
                1000 + entry.score + (!docType ? 160 : 0), entry.score + (!docType ? 80 : 0),
                `suggested for ${entry.source} notes`);
        }

        const observedFields = docType
            ? collectObservedFrontmatterFields(docType).map((entry) => ({ ...entry, roleAligned: false, noteRole: null }))
            : collectRoleAlignedObservedFrontmatterFields(documentAdapter, docType, idIndex);
        const observedScope = docType || 'similar';
        for (const entry of observedFields) {
            const detail = entry.roleAligned
                ? `common in ${entry.noteRole?.noteRole || observedScope} workflows (${entry.count} notes)`
                : `observed in ${entry.count} ${observedScope} note${entry.count === 1 ? '' : 's'}`;
            _mergeFieldSignal(fieldScores, detailByField, entry.key,
                500 + entry.count + (entry.roleAligned ? 120 : 0), entry.count + (entry.roleAligned ? 40 : 0), detail);
        }

        for (const entry of collectContextualObservedFrontmatterFields(documentAdapter, docType, idIndex)) {
            const sharedLead = entry.sharedFields.length
                ? `common alongside ${entry.sharedFields.slice(0, 2).join(', ')}`
                : `common in ${entry.role} notes`;
            const detail = `${sharedLead} (${entry.count} similar notes)`;
            _mergeFieldSignal(fieldScores, detailByField, entry.key,
                1100 + entry.score, Math.min(180, entry.count * 20), detail);
        }

        for (const entry of collectAdaptiveFrontmatterFieldSuggestions(documentAdapter, docType, idIndex, adaptiveContext)) {
            const detail = [entry.summary, entry.bodyEvidence].filter(Boolean).join('; ');
            _mergeFieldSignal(fieldScores, detailByField, entry.key, 1250 + entry.score, 160 + entry.score, detail);
        }

        for (const entry of collectSchemaAdaptiveGapSuggestions(documentAdapter, docType, idIndex, adaptiveContext)) {
            const alternatives = entry.alternatives?.length ? `; similar notes also use ${entry.alternatives.join(', ')}` : '';
            const detail = `${entry.missingSummary}. ${entry.summary}${alternatives}${entry.bodyEvidence ? `; ${entry.bodyEvidence}` : ''}`;
            _mergeFieldSignal(fieldScores, detailByField, entry.key, 1180 + entry.score, 140 + Math.min(180, entry.score), detail);
        }
    } catch (_) {}

    // Arc boost — surface this note's predicted missing fields at the top.
    // Arc fields with medium+ confidence get a "likely missing" detail annotation.
    try {
        const noteFields = (noteId && fieldsCache.get(noteId)) || {};
        const arc = buildNoteArc(
            noteFields, noteType || '', fieldsCache,
            priors.typeFieldBundles, priors.fieldTargetTypes,
            priors.outcomeCalibration, { limit: 5, emergentClusters: priors.emergentClusters }
        );
        for (const { field, confidenceLabel, emergentCluster } of arc.missingFields || []) {
            if (field.startsWith('_')) continue;
            arcFields.set(field, confidenceLabel);
            if (emergentCluster) clusterFields.add(field);
            const boost = confidenceLabel === 'high' ? 500 : confidenceLabel === 'medium' ? 200 : 50;
            fieldScores.set(field, (fieldScores.get(field) || 0) + boost);
        }
    } catch (_) {}

    const p = partial.toLowerCase();
    const items = [];
    for (const [field, score] of fieldScores) {
        if (p && !field.startsWith(p)) continue;
        const conf   = arcFields.get(field);
        const detail = clusterFields.has(field)
            ? 'matches an emerging pattern in this vault'
            : (conf === 'high' || conf === 'medium')
                ? 'likely missing'
                : detailByField.get(field) || _fieldValueHint(field, priors);
        items.push({
            label:      field,
            kind:       10, // Property
            insertText: field + ': ',
            sortText:   String(999 - Math.min(Math.round(score), 998)).padStart(4, '0') + field,
            detail
        });
    }

    items.sort((a, b) => a.sortText.localeCompare(b.sortText));
    return items.slice(0, 30);
}

function _frontmatterValueCompletions(fieldKey, valueText, priors) {
    const fieldsCache = getFieldsCache();
    const vp = valueText.toLowerCase();

    if (fieldKey === 'type') {
        const types = new Set();
        for (const [, fields] of fieldsCache) {
            if (fields.type) types.add(String(fields.type));
        }
        const items = [];
        for (const t of [...types].sort()) {
            if (vp && !t.startsWith(vp)) continue;
            items.push({ label: t, kind: 12, insertText: t, sortText: t });
        }
        return items;
    }

    if (priors.workflowFields && priors.workflowFields.has(fieldKey)) {
        const { values } = priors.workflowFields.get(fieldKey);
        const items = [];
        for (const v of values) {
            if (vp && !v.startsWith(vp)) continue;
            items.push({ label: v, kind: 12, insertText: v, sortText: v });
        }
        return items.sort((a, b) => a.label.localeCompare(b.label));
    }

    return [];
}

// Apollo palette roles (see docs/architecture/YAMLINK-COLOR-PALETTE.md):
// lavender = type/identity labels, mint = links/relations/connections.
// Mirrors VS Code's buildRelationCandidateDocumentation for parity — always
// built for every candidate, not just sibling matches, and kept out of
// `detail` (a single-line field on this surface too) so evidence renders as
// a real multi-line card instead of one crammed, wrapping line.
function buildRelationCandidateDocumentationMarkdown(id, noteType, reasons, siblingTargetId) {
    const status = String(getFieldsCache().get(String(id || '').trim().toLowerCase())?.status || '').trim();
    const badges = [];
    if (noteType) badges.push({ text: noteType, bg: '#C49BF0', fg: '#151617' });
    if (status) badges.push({ text: status, bg: '#5ECFBE', fg: '#151617' });
    if (siblingTargetId) badges.push({ text: 'connected', bg: '#C5FFBF', fg: '#151617' });
    let value = badges.length ? `![](${buildHoverBadgeDataUri(badges)})\n\n` : '';
    const lines = [...reasons];
    const backlinkCount = (getBacklinks(id) || []).length;
    if (backlinkCount > 0) {
        lines.push(`Linked from ${backlinkCount} other note${backlinkCount === 1 ? '' : 's'}`);
    }
    if (siblingTargetId) {
        lines.push(`Already connected to **${siblingTargetId}** — ranked higher because this note already links to it.`);
    }
    if (lines.length) value += lines.map((line) => `- ${line}`).join('\n');
    return value;
}

// Implicit relation-value completion — offers [[id]] candidates for a relation
// field's value before the user has typed any bracket, mirroring VS Code's
// provideLinkAndDateCompletions. Gated through the same classifier/planner
// pipeline as VS Code (evaluateFieldForSurface(..., 'completion')) so LSP
// clients don't suggest linking a field that isn't confidently a relation —
// returns null when the field isn't relation-shaped at all (caller should
// fall back to scalar value completion), or [] when it is relation-shaped
// but the classifier's confidence doesn't clear COMPLETION_ONLY.
function _relationValueCompletions(content, lines, position, filePath) {
    const idIndex = getIndex();
    const documentAdapter = {
        getText: () => content,
        lineAt: (n) => ({ text: lines[n] || '' }),
        uri: filePath ? { fsPath: filePath } : undefined
    };
    const frontmatterRelation = resolveFrontmatterRelationCandidates(documentAdapter, position, idIndex);
    if (!frontmatterRelation) return null;

    if (!frontmatterRelation.hasWiki) {
        const docType = getDocumentType(documentAdapter);
        const noteFields = extractFrontmatterFields(documentAdapter);
        const evaluation = evaluateFieldForSurface(frontmatterRelation.fieldName, 'completion', {
            noteType: docType,
            noteFields,
            documentText: content,
            fieldsCache: getFieldsCache(),
            generation: getVaultGeneration()
        });
        if (evaluation.plan.level < LEVEL.COMPLETION_ONLY) return [];
    }

    const ranked = rankCandidateIds(
        frontmatterRelation.candidateIds,
        frontmatterRelation.partial,
        frontmatterRelation.preferredIds,
        frontmatterRelation.localLinkedIds,
        frontmatterRelation.observedIdScores,
        frontmatterRelation.rankingHints
    );

    return ranked.slice(0, 50).map((id, index) => {
        const humanName = getHumanLabel(id);
        const preferred = frontmatterRelation.preferredIds.includes(id);
        const detail = buildRelationCandidateDetail(id, idIndex, frontmatterRelation, preferred);
        const siblingTargetId = frontmatterRelation.rankingHints?.siblingContextEvidence?.get(String(id || '').trim().toLowerCase());
        const { noteType, reasons } = buildRelationCandidateEvidence(id, frontmatterRelation, preferred);
        const documentation = { kind: 'markdown', value: buildRelationCandidateDocumentationMarkdown(id, noteType, reasons, siblingTargetId) };
        return {
            label:      humanName || id,
            kind:       17, // Reference
            detail,
            documentation,
            insertText: `[[${id}]]`,
            filterText: humanName ? `${id} ${humanName}` : id,
            sortText:   (preferred ? '01-' : '02-') + String(index).padStart(4, '0') + id,
            data:       { id }
        };
    });
}

function handleCompletion(msg, state) {
    const { textDocument, position } = msg.params || {};
    if (!textDocument || !position) { respond(msg.id, []); return; }

    const content = getDocumentText(state, textDocument.uri);
    const lines   = content.split('\n');
    const line    = lines[position.line] || '';
    const prefix  = line.slice(0, position.character);

    const fieldsCache = getFieldsCache();
    const generation  = getVaultGeneration();
    const priors      = getCachedPriors(fieldsCache, generation);

    // 1. Wikilink completion — [[partial
    //    When inside frontmatter, pass the field key so completions are ranked
    //    by the field's dominant target type from vault priors.
    const openIdx = prefix.lastIndexOf('[[');
    if (openIdx !== -1 && !prefix.slice(openIdx).includes(']]')) {
        const partial  = prefix.slice(openIdx + 2).toLowerCase();
        const colonIdx = prefix.indexOf(':');
        const fieldKey = (colonIdx !== -1 && inFrontmatter(lines, position.line))
            ? prefix.slice(0, colonIdx).trim()
            : null;
        respond(msg.id, _wikilinkCompletions(partial, fieldKey));
        return;
    }

    // 2. Frontmatter context only below here
    if (!inFrontmatter(lines, position.line)) {
        respond(msg.id, []);
        return;
    }

    const colonIdx = prefix.indexOf(':');

    if (colonIdx === -1) {
        respond(msg.id, _frontmatterKeyCompletions(prefix.trim(), lines, priors, content, uriToPath(textDocument.uri)));
        return;
    }

    const fieldKey  = prefix.slice(0, colonIdx).trim();
    const valueText = prefix.slice(colonIdx + 1).trimStart();
    if (valueText.startsWith('[[') || valueText.startsWith('![[')) {
        respond(msg.id, []);
        return;
    }

    const relationItems = _relationValueCompletions(content, lines, position, uriToPath(textDocument.uri));
    if (relationItems !== null) {
        respond(msg.id, relationItems);
        return;
    }
    respond(msg.id, _frontmatterValueCompletions(fieldKey, valueText, priors));
}

function handleCompletionResolve(msg, _state) {
    const item = msg.params || {};
    const noteId = item.data && item.data.id ? String(item.data.id) : '';
    if (!noteId) { respond(msg.id, item); return; }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    if (!idIndex.has(noteId)) { respond(msg.id, item); return; }

    const fields = fieldsCache.get(noteId) || {};
    const type = String(fields.type || '');
    const status = String(fields.status || '');
    const name = String(fields.name || fields.title || noteId);
    const summary = String(fields.summary || '');
    const backlinks = getBacklinks(noteId) || [];
    const outgoing = getEdges(noteId) || [];
    const generation = getVaultGeneration();
    const priors = getCachedPriors(fieldsCache, generation);

    let likelyMissing = [];
    try {
        const arc = buildNoteArc(
            fields,
            type,
            fieldsCache,
            priors.typeFieldBundles,
            priors.fieldTargetTypes,
            priors.outcomeCalibration,
            { limit: 3, typeBundleTotals: priors.typeBundleTotals, emergentClusters: priors.emergentClusters }
        );
        likelyMissing = (arc.missingFields || [])
            .filter((field) => field && (field.confidenceLabel === 'high' || field.confidenceLabel === 'medium'))
            .slice(0, 2)
            .map((field) => field.field);
    } catch (_) {}

    const importantFields = ['status', 'date', 'unit', 'homeworld', 'rank', 'owner'];
    const fieldLines = [];
    for (const key of importantFields) {
        if (!fields[key]) continue;
        fieldLines.push(`- ${key}: ${fields[key]}`);
        if (fieldLines.length >= 4) break;
    }

    const md = [
        `**${name}**`,
        type ? `\`${type}\`${status ? ` · ${status}` : ''}` : (status ? status : ''),
        summary ? `\n${summary}` : '',
        `\n- id: ${noteId}`,
        `- inbound: ${backlinks.length}`,
        `- outbound: ${outgoing.length}`,
        ...fieldLines,
        likelyMissing.length ? `- ${formatLikelyMissingFields(likelyMissing, { limit: 2 })}` : ''
    ].filter(Boolean).join('\n');

    respond(msg.id, {
        ...item,
        documentation: {
            kind: 'markdown',
            value: md
        },
        detail: type + (status ? ` · ${status}` : '') + ` · ${backlinks.length} in · ${outgoing.length} out`
    });
}

module.exports = { handleCompletion, handleCompletionResolve };
