'use strict';

const { getIndex, getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getCachedPriors }                               = require('../../intelligence/vaultPriors');
const { buildNoteArc }                                  = require('../../intelligence/noteArc');
const { getBacklinks, getEdges }                        = require('../../core/graph');
const {
    formatLikelyMissingFields,
    getExpectedRelationTypes,
    rankWikilinkTargets
} = require('../../intelligence/authoringEngine');
const { respond }                                       = require('../transport');
const { getDocumentText }                               = require('../documentState');
const { inFrontmatter }                                 = require('../utils');

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
        insertText: entry.id + ']]',
        filterText: [entry.id, entry.label].concat(entry.aliases || []).join(' '),
        sortText:   String(index).padStart(4, '0') + entry.label.toLowerCase(),
        data:       { id: entry.id }
    }));
}

function _frontmatterKeyCompletions(partial, lines, priors) {
    const fieldsCache = getFieldsCache();

    let noteType = null;
    let noteId   = null;
    for (const l of lines) {
        if (l.trim() === '---') break;
        const typeMatch = /^type:\s+(\S+)/.exec(l);
        const idMatch   = /^id:\s+(\S+)/.exec(l);
        if (typeMatch && !noteType) noteType = typeMatch[1];
        if (idMatch   && !noteId)   noteId   = idMatch[1];
    }

    const fieldScores = new Map();
    const arcFields   = new Map(); // field -> confidenceLabel for arc-predicted fields

    for (const key of ['id', 'type', 'name', 'title', 'status', 'date', 'tags', 'summary', 'created', 'updated']) {
        fieldScores.set(key, 20);
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

    // Arc boost — surface this note's predicted missing fields at the top.
    // Arc fields with medium+ confidence get a "likely missing" detail annotation.
    try {
        const noteFields = (noteId && fieldsCache.get(noteId)) || {};
        const arc = buildNoteArc(
            noteFields, noteType || '', fieldsCache,
            priors.typeFieldBundles, priors.fieldTargetTypes,
            priors.outcomeCalibration, { limit: 5 }
        );
        for (const { field, confidenceLabel } of arc.missingFields || []) {
            if (field.startsWith('_')) continue;
            arcFields.set(field, confidenceLabel);
            const boost = confidenceLabel === 'high' ? 500 : confidenceLabel === 'medium' ? 200 : 50;
            fieldScores.set(field, (fieldScores.get(field) || 0) + boost);
        }
    } catch (_) {}

    const p = partial.toLowerCase();
    const items = [];
    for (const [field, score] of fieldScores) {
        if (p && !field.startsWith(p)) continue;
        const conf   = arcFields.get(field);
        const detail = (conf === 'high' || conf === 'medium')
            ? 'likely missing'
            : _fieldValueHint(field, priors);
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
        respond(msg.id, _frontmatterKeyCompletions(prefix.trim(), lines, priors));
        return;
    }

    const fieldKey  = prefix.slice(0, colonIdx).trim();
    const valueText = prefix.slice(colonIdx + 1).trimStart();
    if (valueText.startsWith('[[') || valueText.startsWith('![[')) {
        respond(msg.id, []);
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
            { limit: 3, typeBundleTotals: priors.typeBundleTotals }
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
