'use strict';

// Plugin API v1, narrow scope by design: a single read-only evidence-scoring
// hook, not a general extension system. Confirmed with the user directly —
// the alternative (lifecycle hooks like onNoteCreated/onFieldChanged) was
// explicitly deferred as a much bigger contract to stabilize and a much
// bigger blast radius if a plugin misbehaves. This is VS-Code-only: LSP has
// no third-party extension-loading mechanism to hang a registration off of.

const PLUGIN_EVIDENCE_TIMEOUT_MS = 20; // same budget class as completion.js's own signals

/** @type {Set<(fieldName: string, context: Record<string, any>) => {score:number, reason:string}|null>} */
const registeredSources = new Set();

/**
 * Registers a third-party function that contributes one more piece of
 * evidence to Yamlink's field classification (e.g. "is this field a
 * relation, and how confident should we be"). Read-only by design: the
 * function receives a snapshot of the current note's fields and the vault's
 * fieldsCache, and returns `{ score, reason }` or `null` — it cannot write
 * to the vault, and has no way to see or affect other registered sources.
 *
 * A registered source that throws is skipped for that call, never crashes
 * classification. A source that returns malformed data (no numeric score,
 * no reason string) is discarded — every signal Yamlink acts on must be
 * explainable, including third-party ones, so an unexplained score is
 * treated the same as no evidence at all.
 * @param {(fieldName: string, context: Record<string, any>) => {score:number, reason:string}|null} fn
 * @returns {{ dispose(): void }}
 */
function registerFieldEvidenceSource(fn) {
    if (typeof fn !== 'function') {
        throw new Error('registerFieldEvidenceSource requires a function');
    }
    registeredSources.add(fn);
    return { dispose() { registeredSources.delete(fn); } };
}

/** Test-only reset — mirrors the pattern already used for other generation-keyed caches. */
function clearRegisteredEvidenceSources() {
    registeredSources.clear();
}

/**
 * Calls every registered plugin evidence source for one field, in
 * isolation. A wall-clock check after each call catches a pathologically
 * slow source; plugins are plain synchronous functions in v1 (no async
 * plugin API), so this cannot preempt a genuine infinite loop — that would
 * need a real sandbox (a worker thread or subprocess), which is real,
 * separate future work, not something a budget check alone can provide.
 * @param {string} fieldName @param {Record<string,any>} context
 * @returns {{ score: number, reason: string, source: 'plugin' }[]}
 */
function collectPluginEvidence(fieldName, context) {
    const results = [];
    for (const fn of registeredSources) {
        const start = Date.now();
        let raw;
        try {
            raw = fn(fieldName, context);
        } catch (e) {
            continue;
        }
        if (Date.now() - start > PLUGIN_EVIDENCE_TIMEOUT_MS) continue;
        if (!raw || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) continue;
        if (typeof raw.reason !== 'string' || !raw.reason.trim()) continue;
        results.push({
            score: Math.max(0, Math.min(1, raw.score)),
            reason: raw.reason.trim(),
            source: /** @type {'plugin'} */ ('plugin')
        });
    }
    return results;
}

module.exports = {
    registerFieldEvidenceSource,
    clearRegisteredEvidenceSources,
    collectPluginEvidence
};
