'use strict';

// Vault-learned formula patterns — what calc-cell names/expressions are
// commonly used for notes of a given type, learned purely from the vault's
// own existing formulas. No hardcoded field names, no global heuristics —
// same "the vault teaches the system" philosophy vaultPriors.js already
// states for frontmatter fields, applied here to calc formulas instead.
//
// Deliberately scoped to EXPRESSION TEXT, not a more abstract "structural
// shape" (e.g. "two refs combined with *"): frontmatter field names already
// genuinely recur across same-typed notes (every `expense` note tends to
// have `price`/`quantity`), so the literal expression text itself is
// already a meaningful, reusable signal without needing fuzzier shape
// matching. This also keeps the one-sentence explanation an authoring
// surface can show completely honest and simple: "used in N other <type>
// notes" is directly, literally true — clearing the same bar CLAUDE.md's
// "Elite math & physics for Yamlink" section sets for any intelligence
// signal before it ships as a named, user-facing thing.
//
// Unnamed cells (automatic Y<N> labels only) are never counted — a name
// the user chose to type is a real signal of intent; a positional label is
// not, and would just pollute the counts with incidental numbering.

const fs = require('fs');
const { scanInlineCalcs } = require('../engine/inlineCalc');

function normalizeText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripLeadingFrontmatter(content) {
    const normalized = normalizeText(content);
    if (/^\s*---/.test(normalized)) {
        const firstDash = normalized.indexOf('---');
        const closingIdx = normalized.indexOf('---', firstDash + 3);
        return closingIdx !== -1 ? normalized.slice(closingIdx + 3) : normalized;
    }
    return normalized;
}

/** @param {string} filePath @returns {string|null} */
function defaultReadBody(filePath) {
    try {
        return stripLeadingFrontmatter(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

/**
 * @typedef {{ name: string, label: string, expr: string, count: number }} FormulaPattern
 */

/**
 * Vault-wide formula-pattern priors, bucketed by note type. Scans every
 * note's body once, collecting every successfully-evaluated, user-NAMED
 * calc cell's `{name, expr}` pair, tallied by (type, name, expr) triple so
 * the same name used with a different expression across notes is tracked
 * separately, not blurred together.
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Map<string, string>} idIndex
 * @param {(filePath: string) => string|null} [readBody]
 * @returns {Map<string, FormulaPattern[]>} keyed by lowercased note type,
 * each array sorted by descending count. Callers decide their own
 * "worth suggesting" count threshold — this returns everything observed,
 * including one-off patterns, the same way vaultPriors.js's raw maps stay
 * complete and confidence-gating happens one layer up (fieldPlanner.js).
 */
function buildFormulaPriors(fieldsCache, idIndex, readBody = defaultReadBody) {
    /** @type {Map<string, Map<string, FormulaPattern>>} */
    const byType = new Map();

    for (const [id, fields] of fieldsCache.entries()) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (!type) continue;
        const filePath = idIndex.get(id);
        if (!filePath) continue;
        const body = readBody(filePath);
        if (!body) continue;

        for (const block of scanInlineCalcs(body)) {
            if (!block.evalResult.ok || !block.name) continue;
            const key = `${block.name.toLowerCase()}\u0000${block.expr.trim()}`;
            if (!byType.has(type)) byType.set(type, new Map());
            const patterns = byType.get(type);
            const existing = patterns.get(key);
            if (existing) existing.count++;
            else patterns.set(key, { name: block.name, label: block.label, expr: block.expr.trim(), count: 1 });
        }
    }

    /** @type {Map<string, FormulaPattern[]>} */
    const result = new Map();
    for (const [type, patterns] of byType.entries()) {
        result.set(type, [...patterns.values()].sort((a, b) => b.count - a.count));
    }
    return result;
}

// Generation-keyed cache — this is a real hot path (consulted on every
// completion request while typing inside a formula), unlike calcHealth.js's
// deliberately-uncached panel-open scan, so a full vault-wide body re-scan
// per keystroke would blow straight through completion's 30ms budget on
// any vault past trivial size. Same pattern as vaultPriors.js's own cache.
let _cachedGeneration = -1;
let _cachedPriors = null;

/** @returns {void} */
function resetFormulaPriorsCache() {
    _cachedGeneration = -1;
    _cachedPriors = null;
}

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Map<string, string>} idIndex
 * @param {number} generation
 * @param {(filePath: string) => string|null} [readBody]
 * @returns {Map<string, FormulaPattern[]>}
 */
function getCachedFormulaPriors(fieldsCache, idIndex, generation, readBody = defaultReadBody) {
    if (generation !== _cachedGeneration || !_cachedPriors) {
        _cachedPriors = buildFormulaPriors(fieldsCache, idIndex, readBody);
        _cachedGeneration = generation;
    }
    return _cachedPriors;
}

module.exports = { buildFormulaPriors, getCachedFormulaPriors, resetFormulaPriorsCache, defaultReadBody };
