'use strict';

const { getFieldsCache, getVaultGeneration, parseFrontmatter } = require('../../core/indexService');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { buildNoteArc } = require('../../intelligence/noteArc');
const { CATEGORY } = require('../../intelligence/fieldCategory');
const {
    classifyFieldForAuthoring,
    formatDateSignal,
    formatLikelyMissingFields,
    formatRelationSignal,
    formatWorkflowSignal,
    getExpectedRelationTypes
} = require('../../intelligence/authoringEngine');
const { respond } = require('../transport');

function _lineInRange(lineIndex, range) {
    if (!range) return true;
    const startLine = Number.isFinite(range.start?.line) ? range.start.line : 0;
    const endLine = Number.isFinite(range.end?.line) ? range.end.line : Number.MAX_SAFE_INTEGER;
    return lineIndex >= startLine && lineIndex <= endLine;
}

function _hint(lineIndex, character, label, kind = 1) {
    return {
        position: { line: lineIndex, character },
        label,
        kind,
        paddingLeft: true
    };
}

function _relationHint(fieldName, classification, expectedTypes, priors) {
    if (Array.isArray(expectedTypes) && expectedTypes.length > 0) {
        return formatRelationSignal(fieldName, expectedTypes);
    }

    const targetMap = priors.fieldTargetTypes && priors.fieldTargetTypes.get(fieldName);
    if (targetMap && targetMap.size > 0) {
        const topTypes = [...targetMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([type]) => type);
        return formatRelationSignal(fieldName, topTypes);
    }

    if (classification.targetType) {
        return formatRelationSignal(fieldName, [classification.targetType]);
    }

    return formatRelationSignal(fieldName, [], { soft: true });
}

function _workflowHint(fieldName, priors) {
    const workflow = priors.workflowFields && priors.workflowFields.get(fieldName);
    return formatWorkflowSignal(workflow?.values || []);
}

function _fieldHint(fieldName, rawValue, noteFields, noteType, priors, fieldsCache) {
    const { classification } = classifyFieldForAuthoring(fieldName, {
        fieldsCache,
        noteFields,
        noteType,
        generation: getVaultGeneration()
    });
    const expectedTypes = getExpectedRelationTypes(fieldName, {
        fieldsCache,
        noteType,
        generation: getVaultGeneration()
    });

    const hasExplicitWikilinkValue = /\[\[[^\]]+\]\]/.test(String(rawValue || ''));

    if (classification.category === CATEGORY.RELATION && classification.confidence >= 0.45) {
        return _relationHint(fieldName, classification, expectedTypes, priors);
    }
    if (hasExplicitWikilinkValue) {
        return _relationHint(fieldName, classification, expectedTypes, priors);
    }
    if (classification.category === CATEGORY.WORKFLOW && classification.confidence >= 0.45) {
        return _workflowHint(fieldName, priors);
    }
    if (classification.category === CATEGORY.DATE && classification.confidence >= 0.45) {
        return formatDateSignal();
    }
    return '';
}

function _arcHint(noteFields, noteType, priors, fieldsCache) {
    if (!noteType) return '';
    try {
        const arc = buildNoteArc(
            noteFields,
            noteType,
            fieldsCache,
            priors.typeFieldBundles,
            priors.fieldTargetTypes,
            priors.outcomeCalibration,
            { typeBundleTotals: priors.typeBundleTotals, limit: 5, emergentClusters: priors.emergentClusters }
        );
        const ranked = (arc.missingFields || []).filter(Boolean);
        const missing = ranked
            .filter((item) => item.confidenceLabel === 'high' || item.confidenceLabel === 'medium')
            .slice(0, 3)
            .map((item) => item.field);
        const fallback = ranked.slice(0, 2).map((item) => item.field);
        const fields = missing.length ? missing : fallback;
        return formatLikelyMissingFields(fields, { limit: 3 });
    } catch (_) {
        return '';
    }
}

function handleInlayHint(msg, state) {
    const { textDocument, range } = msg.params || {};
    if (!textDocument) { respond(msg.id, []); return; }

    const content = state.openDocs.get(textDocument.uri) || '';
    if (!content) { respond(msg.id, []); return; }

    const parsed = parseFrontmatter(content);
    if (!parsed || typeof parsed !== 'object') { respond(msg.id, []); return; }

    const noteFields = parsed || {};
    const noteType = noteFields.type || '';
    const lines = content.split('\n');
    if (!lines[0] || lines[0].trim() !== '---') { respond(msg.id, []); return; }

    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());

    const hints = [];
    let frontmatterEnd = -1;

    for (let i = 1; i < lines.length; i++) {
        if (lines[i] && lines[i].trim() === '---') {
            frontmatterEnd = i;
            break;
        }
        if (!_lineInRange(i, range)) continue;
        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
        if (!match) continue;
        const fieldName = match[1];
        const rawValue = match[2];
        if (fieldName === 'id' || fieldName === 'type') continue;
        const label = _fieldHint(fieldName, rawValue, noteFields, noteType, priors, fieldsCache);
        if (!label) continue;
        hints.push(_hint(i, lines[i].length, label));
    }

    if (frontmatterEnd !== -1 && _lineInRange(frontmatterEnd, range)) {
        const label = _arcHint(noteFields, noteType, priors, fieldsCache);
        if (label) {
            hints.push(_hint(frontmatterEnd, lines[frontmatterEnd].length, label));
        }
    }

    respond(msg.id, hints);
}

module.exports = { handleInlayHint };
