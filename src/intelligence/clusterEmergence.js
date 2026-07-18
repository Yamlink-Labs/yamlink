'use strict';

// Cluster emergence detection — finds groups of notes that share an identical
// field signature (same sorted set of non-system fields) and have grown large
// enough to suggest a recurring pattern worth naming or formalizing.
//
// No hardcoded domain knowledge. The vault teaches the system.
// Works on zero-schema vaults — in fact that's where it's most useful.
//
// Confidence levels:
//   low    — 4–6 notes sharing the same signature
//   medium — 7–12 notes
//   high   — 13+ notes

const SYSTEM_FIELDS = new Set([
    'id', 'type', 'created', 'updated', 'modified', 'indexed',
    '__yamlink_tags', 'title', 'name', 'aliases', 'tags', 'body'
]);

const MIN_CLUSTER_SIZE = 4;
const MIN_CLUSTER_FIELDS = 2;
const MAX_CLUSTERS = 5;
const DOMINANT_TYPE_RATIO = 0.6;

function _norm(s) {
    return String(s || '').trim().toLowerCase();
}

/**
 * Compute a deterministic field signature for a note's frontmatter.
 * System and private fields are excluded; result is sorted and pipe-joined.
 * @param {Record<string, any>} fields
 * @returns {string}
 */
function fieldSignature(fields) {
    return Object.keys(fields || {})
        .map(_norm)
        .filter((k) => k && !SYSTEM_FIELDS.has(k) && !k.startsWith('_'))
        .sort()
        .join('|');
}

/**
 * Map a note count to a confidence label.
 * @param {number} count
 * @returns {'low'|'medium'|'high'}
 */
function clusterConfidence(count) {
    if (count >= 13) return 'high';
    if (count >= 7) return 'medium';
    return 'low';
}

/**
 * Detect emerging field-based clusters in the vault.
 *
 * A cluster is a group of notes sharing an identical field signature that
 * exceeds the minimum cluster size. Large enough groups suggest a pattern
 * the vault has organically developed that may be worth naming or schematizing.
 *
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {{ clusters: Array<{
 *   fields: string[],
 *   noteIds: string[],
 *   noteCount: number,
 *   dominantType: string|null,
 *   confidence: 'low'|'medium'|'high'
 * }> }}
 */
function detectClusters(fieldsCache) {
    const sigGroups = new Map();

    for (const [noteId, fields] of fieldsCache) {
        if (!fields) continue;

        const sig = fieldSignature(fields);
        if (!sig) continue;
        const fieldCount = sig.split('|').length;
        if (fieldCount < MIN_CLUSTER_FIELDS) continue;

        if (!sigGroups.has(sig)) {
            sigGroups.set(sig, { noteIds: [], typeCounts: new Map() });
        }
        const group = sigGroups.get(sig);
        group.noteIds.push(noteId);

        const noteType = _norm(fields.type || '');
        if (noteType) {
            group.typeCounts.set(noteType, (group.typeCounts.get(noteType) || 0) + 1);
        }
    }

    const clusters = [];

    for (const [sig, group] of sigGroups) {
        if (group.noteIds.length < MIN_CLUSTER_SIZE) continue;

        // Dominant type: the most common type value if it represents ≥60% of the cluster
        let dominantType = null;
        let maxTypeCount = 0;
        for (const [t, count] of group.typeCounts) {
            if (count > maxTypeCount) { maxTypeCount = count; dominantType = t; }
        }
        if (dominantType && maxTypeCount / group.noteIds.length < DOMINANT_TYPE_RATIO) {
            dominantType = null;
        }

        clusters.push({
            fields: sig.split('|'),
            noteIds: group.noteIds.slice(),
            noteCount: group.noteIds.length,
            dominantType,
            confidence: clusterConfidence(group.noteIds.length)
        });
    }

    clusters.sort((a, b) => b.noteCount - a.noteCount);
    return { clusters: clusters.slice(0, MAX_CLUSTERS) };
}

module.exports = { detectClusters, fieldSignature, clusterConfidence };
