'use strict';

// Structural signatures — infer the operating shape of a vault from its own
// behavior (recurring field bundles, relation topology, recent growth rate)
// rather than from a hardcoded list of archetypes ("this is a CRM vault").
// Per CLAUDE.md's math-advisor rule: every number here ships with a plain,
// honest sentence describing what was actually observed — never a forced
// label matched against a fixed enum. Built entirely on data already
// computed elsewhere (vaultPriors.js's typeFieldBundles, core/graph.js's
// backlink counts, the mutation log's note_created timestamps) — no new
// vault scan, no new intelligence primitive.

const { getCachedPriors } = require('./vaultPriors');
const { getBacklinks } = require('../core/graph');

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {{ type: string, count: number, ratio: number }[]} sorted descending by count
 */
function buildTypeDistribution(fieldsCache) {
    const counts = new Map();
    let total = 0;
    for (const fields of fieldsCache.values()) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (!type) continue;
        counts.set(type, (counts.get(type) || 0) + 1);
        total += 1;
    }
    if (total === 0) return [];
    return [...counts.entries()]
        .map(([type, count]) => ({ type, count, ratio: count / total }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Dominant types are whichever types, taken in descending order, cumulatively
 * cover at least `coverageThreshold` of all typed notes — not a fixed top-N,
 * since a vault with three roughly-even types and a vault with one type at
 * 90% both deserve accurate coverage, not the same arbitrary cutoff.
 * @param {{ type: string, count: number, ratio: number }[]} typeDistribution
 * @param {number} [coverageThreshold]
 * @returns {{ type: string, count: number, ratio: number }[]}
 */
function selectDominantTypes(typeDistribution, coverageThreshold = 0.8) {
    const result = [];
    let cumulative = 0;
    for (const entry of typeDistribution) {
        result.push(entry);
        cumulative += entry.ratio;
        if (cumulative >= coverageThreshold) break;
    }
    return result;
}

/**
 * How consistently a type's notes actually share the same field shape — the
 * mean coverage ratio of that type's most common fields (already computed
 * and cached in vaultPriors.js's typeFieldBundles/typeBundleTotals, not
 * recomputed here). 0 = wildly inconsistent field sets, 1 = every note of
 * this type has exactly the same fields. `sampleSize` fields considered
 * caps how many of the type's top fields count toward the average, so one
 * rare optional field doesn't drag the score down by itself.
 * @param {string} type
 * @param {Map<string, Map<string, number>>} typeFieldBundles
 * @param {Map<string, number>} typeBundleTotals
 * @param {number} [sampleSize]
 * @returns {number}
 */
function computeFieldRigidity(type, typeFieldBundles, typeBundleTotals, sampleSize = 6) {
    const total = typeBundleTotals.get(type) || 0;
    const bundle = typeFieldBundles.get(type);
    if (!total || !bundle || !bundle.size) return 0;
    const ratios = [...bundle.values()]
        .map((count) => count / total)
        .sort((a, b) => b - a)
        .slice(0, sampleSize);
    if (!ratios.length) return 0;
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

/**
 * What fraction of all inbound links point at the most-linked-to slice of
 * notes — a cheap, honest concentration measure. High = a few real hub
 * notes the vault organizes around; low = links spread evenly, no clear
 * center of gravity.
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {number} [topFraction] top slice of notes counted as "hubs"
 * @returns {{ concentration: number, hubCount: number, totalInbound: number }}
 */
function computeHubConcentration(fieldsCache, topFraction = 0.1) {
    const inboundCounts = [];
    let totalInbound = 0;
    for (const id of fieldsCache.keys()) {
        const count = (getBacklinks(id) || []).length;
        inboundCounts.push(count);
        totalInbound += count;
    }
    if (!totalInbound || !inboundCounts.length) {
        return { concentration: 0, hubCount: 0, totalInbound: 0 };
    }
    inboundCounts.sort((a, b) => b - a);
    const hubCount = Math.max(1, Math.round(inboundCounts.length * topFraction));
    const hubInbound = inboundCounts.slice(0, hubCount).reduce((sum, c) => sum + c, 0);
    return { concentration: hubInbound / totalInbound, hubCount, totalInbound };
}

/**
 * Recent creation rate as a share of the vault's total size — a cheap,
 * honest growth signal directly from the mutation log's own timestamps, no
 * historical reconstruction needed (unlike vaultTrends.js's trend-fit,
 * which this deliberately doesn't reuse — a real least-squares trend line
 * is overkill for "is this vault currently growing fast").
 * @param {{ type: string, noteId: string, timestamp: string }[]} mutationEvents
 * @param {number} totalNoteCount
 * @param {number} [windowDays]
 * @param {number} [nowMs]
 * @returns {{ recentCreations: number, ratio: number }}
 */
function computeRecentGrowthRate(mutationEvents, totalNoteCount, windowDays = 30, nowMs = Date.now()) {
    if (!totalNoteCount) return { recentCreations: 0, ratio: 0 };
    const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
    const recentCreations = (mutationEvents || []).filter((event) => {
        if (event?.type !== 'note_created') return false;
        const ts = Date.parse(event.timestamp);
        return Number.isFinite(ts) && ts >= cutoffMs;
    }).length;
    return { recentCreations, ratio: recentCreations / totalNoteCount };
}

/**
 * @param {{ dominantTypes: {type: string, ratio: number, rigidity: number}[], hubs: {concentration: number, hubCount: number, totalInbound: number}, growth: {ratio: number, recentCreations: number} }} signature
 * @returns {string}
 */
function summarizeStructuralSignature(signature) {
    const { dominantTypes, hubs, growth } = signature;
    if (!dominantTypes.length) {
        return 'Not enough typed notes yet to describe this vault\'s structure.';
    }

    const parts = [];
    const typeList = dominantTypes
        .map((t) => `\`${t.type}\` (${Math.round(t.ratio * 100)}%)`)
        .join(', ');
    parts.push(`Dominated by ${typeList}`);

    const avgRigidity = dominantTypes.reduce((sum, t) => sum + t.rigidity, 0) / dominantTypes.length;
    parts.push(avgRigidity >= 0.6
        ? `with a consistent, repeatable field shape (rigidity ${avgRigidity.toFixed(2)})`
        : `with loosely-varying field shapes across notes (rigidity ${avgRigidity.toFixed(2)})`);

    if (hubs.totalInbound > 0) {
        parts.push(hubs.concentration >= 0.5
            ? `a small number of hub notes carry most of the links (top ${hubs.hubCount} notes hold ${Math.round(hubs.concentration * 100)}% of all inbound links)`
            : `links are spread fairly evenly, with no dominant hub notes`);
    }

    parts.push(growth.ratio >= 0.1
        ? `and it's actively growing (${growth.recentCreations} notes created in the last 30 days)`
        : `and growth has been slow recently (${growth.recentCreations} notes created in the last 30 days)`);

    return parts.join(', ') + '.';
}

/**
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {{ type: string, noteId: string, timestamp: string }[]} mutationEvents
 * @param {number} generation
 * @param {{ coverageThreshold?: number, hubTopFraction?: number, growthWindowDays?: number, nowMs?: number }} [options]
 * @returns {{
 *   typeDistribution: {type: string, count: number, ratio: number}[],
 *   dominantTypes: {type: string, count: number, ratio: number, rigidity: number}[],
 *   hubs: { concentration: number, hubCount: number, totalInbound: number },
 *   growth: { recentCreations: number, ratio: number },
 *   summary: string
 * }}
 */
function buildStructuralSignature(fieldsCache, mutationEvents, generation, options = {}) {
    const typeDistribution = buildTypeDistribution(fieldsCache);
    const dominantTypesBase = selectDominantTypes(typeDistribution, options.coverageThreshold ?? 0.8);

    const priors = fieldsCache.size ? getCachedPriors(fieldsCache, generation || 0) : null;
    const dominantTypes = dominantTypesBase.map((entry) => ({
        ...entry,
        rigidity: priors
            ? computeFieldRigidity(entry.type, priors.typeFieldBundles, priors.typeBundleTotals)
            : 0
    }));

    const hubs = computeHubConcentration(fieldsCache, options.hubTopFraction ?? 0.1);
    const growth = computeRecentGrowthRate(
        mutationEvents,
        fieldsCache.size,
        options.growthWindowDays ?? 30,
        options.nowMs ?? Date.now()
    );

    const signature = { typeDistribution, dominantTypes, hubs, growth, summary: '' };
    signature.summary = summarizeStructuralSignature(signature);
    return signature;
}

module.exports = {
    buildTypeDistribution,
    selectDominantTypes,
    computeFieldRigidity,
    computeHubConcentration,
    computeRecentGrowthRate,
    summarizeStructuralSignature,
    buildStructuralSignature
};
