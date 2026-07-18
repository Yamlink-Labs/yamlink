'use strict';

const { getIndex, getFieldsCache, getVaultGeneration, getAliasIndex } = require('../../core/indexService');
const { getBacklinks }                                  = require('../../core/graph');
const { resolveLinkedTarget, parseLinkedTargetParts }   = require('../../core/id');
const { getCachedPriors }                               = require('../../intelligence/vaultPriors');
const { inferLifecycleState }                           = require('../../intelligence/lifecycleState');
const { computeNoteDrift }                              = require('../../intelligence/driftDetector');
const { buildNoteArc }                                  = require('../../intelligence/noteArc');
const { formatLikelyMissingFields }                     = require('../../intelligence/authoringEngine');
const { buildHoverBadgeMarkdown }                       = require('../../intelligence/hoverBadge');
const { respond }                                       = require('../transport');
const { getDocumentText }                               = require('../documentState');
const { wikilinkAtPosition, pathToUri }                 = require('../utils');

const INLINE_WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function escapeMarkdown(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/([`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function renderInlineFileLinks(text, idIndex, aliasIndex) {
    const raw = String(text || '');
    if (!raw) return '';
    let result = '';
    let lastIndex = 0;
    INLINE_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_WIKILINK_RE.exec(raw)) !== null) {
        result += escapeMarkdown(raw.slice(lastIndex, match.index));
        const inner = String(match[1] || '').trim();
        const parts = parseLinkedTargetParts(inner);
        const resolvedId = resolveLinkedTarget(inner, idIndex, aliasIndex);
        const filePath = resolvedId ? idIndex.get(resolvedId) : null;
        const displayText = parts.label || parts.target || inner;
        result += filePath
            ? `[${escapeMarkdown(displayText)}](${pathToUri(filePath)})`
            : escapeMarkdown(`[[${inner}]]`);
        lastIndex = match.index + match[0].length;
    }
    result += escapeMarkdown(raw.slice(lastIndex));
    return result;
}

function handleHover(msg, state) {
    const { textDocument, position } = msg.params || {};
    if (!textDocument || !position) { respond(msg.id, null); return; }

    const content = getDocumentText(state, textDocument.uri);
    const lines   = content.split('\n');
    const line    = lines[position.line] || '';

    const rawTarget = wikilinkAtPosition(line, position.character);
    if (!rawTarget) { respond(msg.id, null); return; }

    const fieldsCache = getFieldsCache();
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();

    const id = resolveLinkedTarget(rawTarget, idIndex, aliasIndex);
    if (!id) { respond(msg.id, null); return; }

    const noteFields = fieldsCache.get(id);
    if (!noteFields) { respond(msg.id, null); return; }

    const generation = getVaultGeneration();
    const priors     = getCachedPriors(fieldsCache, generation);
    const backlinks  = getBacklinks(id) || [];
    const inbound    = backlinks.length;

    const name    = String(noteFields.name || noteFields.title || id);
    const type    = String(noteFields.type    || '');
    const status  = String(noteFields.status  || '');
    const summary = String(noteFields.summary || '');
    const targetParts = parseLinkedTargetParts(rawTarget);

    // Lifecycle
    let lifecycleLabel = '';
    try {
        const lifecycle = inferLifecycleState(id, noteFields, {
            fieldsCache,
            idIndex,
            typeFieldBundles:   priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            inboundCount:       inbound,
            noteType:           type
        });
        if (lifecycle && lifecycle.label) lifecycleLabel = lifecycle.label;
    } catch (_) {}

    // Drift — only surface if not on-track
    let driftLabel = '';
    try {
        const drift = computeNoteDrift(id, noteFields, fieldsCache, priors);
        if (!drift.insufficientData && drift.driftLabel && drift.driftLabel !== 'on-track') {
            driftLabel = drift.driftLabelHuman || drift.driftLabel;
        }
    } catch (_) {}

    // Arc — top 2 missing fields with medium+ confidence
    const arcGaps = [];
    try {
        const arc = buildNoteArc(
            noteFields, type, fieldsCache,
            priors.typeFieldBundles, priors.fieldTargetTypes,
            priors.outcomeCalibration, { limit: 3, emergentClusters: priors.emergentClusters }
        );
        for (const f of arc.missingFields || []) {
            if (f.confidenceLabel === 'high' || f.confidenceLabel === 'medium') {
                arcGaps.push(f.field);
                if (arcGaps.length >= 2) break;
            }
        }
    } catch (_) {}

    // Build markdown card
    let md = `**${escapeMarkdown(name)}**`;
    const badgeMarkdown = buildHoverBadgeMarkdown({ type, status });
    if (badgeMarkdown) md += `\n\n${badgeMarkdown}`;
    if (summary) md += `\n\n${renderInlineFileLinks(summary, idIndex, aliasIndex)}`;

    const stats = [`↑ ${inbound} inbound`];
    if (lifecycleLabel) stats.push(lifecycleLabel);
    if (driftLabel)     stats.push(driftLabel);
    md += '\n\n' + stats.map(escapeMarkdown).join('  ·  ');

    if (targetParts.anchor) {
        md += `\n\n- section: ${escapeMarkdown(targetParts.anchor)}`;
    } else if (targetParts.blockId) {
        md += `\n\n- block: ^${escapeMarkdown(targetParts.blockId)}`;
    }

    if (arcGaps.length) {
        md += `\n\n**${escapeMarkdown(formatLikelyMissingFields(arcGaps, { limit: 2 }))}**`;
    }

    respond(msg.id, { contents: { kind: 'markdown', value: md } });
}

module.exports = { handleHover };
