'use strict';

const { getIndex, getFieldsCache, getDuplicateIds } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { getRegistry } = require('../../registries/typeRegistry');
const { buildSchemaIntelligence, collectHealthStats, computeHealthScore } = require('../../features/health/healthStats');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { getVaultGeneration } = require('../../core/indexService');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function parseChecks(checkArg) {
    if (!checkArg) return ['schema', 'broken-links', 'duplicates'];
    const checks = checkArg.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    return checks.length ? checks : ['schema', 'broken-links', 'duplicates'];
}

function parseThresholdNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function hasThresholdFlags(options) {
    return options.maxBrokenLinks !== null
        || options.schemaCoverage !== null
        || options.noOrphans
        || options.maxStaleDays !== null
        || options.minHealthScore !== null;
}

function collectThresholds({ idIndex, fieldsCache, intel, maxBrokenLinks, schemaCoverage, noOrphans, maxStaleDays, minHealthScore, brokenLinks }) {
    const thresholds = [];
    const healthStats = collectHealthStats();
    const healthScore = computeHealthScore(healthStats);

    if (maxBrokenLinks !== null) {
        thresholds.push({
            check: 'max-broken-links',
            threshold: maxBrokenLinks,
            actual: brokenLinks.length,
            passed: brokenLinks.length <= maxBrokenLinks
        });
    }

    if (schemaCoverage !== null) {
        const total = intel.coverage.reduce((sum, entry) => sum + entry.total, 0);
        const conformant = intel.coverage.reduce((sum, entry) => sum + entry.conformant, 0);
        const actual = total > 0 ? Number(((conformant / total) * 100).toFixed(2)) : 0;
        thresholds.push({
            check: 'schema-coverage',
            threshold: schemaCoverage,
            actual,
            passed: actual >= schemaCoverage
        });
    }

    if (noOrphans) {
        thresholds.push({
            check: 'no-orphans',
            threshold: 0,
            actual: healthStats.orphans.length,
            passed: healthStats.orphans.length === 0
        });
    }

    if (maxStaleDays !== null) {
        const priors = getCachedPriors(fieldsCache, getVaultGeneration());
        const noteIds = Array.from(idIndex.keys());
        const avgInbound = noteIds.length > 0
            ? noteIds.reduce((sum, noteId) => sum + (getBacklinks(noteId) || []).length, 0) / noteIds.length
            : 0;
        let actual = 0;
        for (const [id] of idIndex) {
            const fields = fieldsCache.get(id) || {};
            const lifecycle = inferLifecycleState(id, fields, {
                fieldsCache,
                idIndex,
                typeFieldBundles: priors.typeFieldBundles,
                noteRoleTypePriors: priors.noteRoleTypePriors,
                fieldTargetTypes: priors.fieldTargetTypes,
                noteType: String(fields.type || '').trim().toLowerCase(),
                inboundCount: (getBacklinks(id) || []).length,
                avgInbound
            });
            const days = lifecycle?.metrics?.lastTouchedDays;
            if (Number.isFinite(days)) actual = Math.max(actual, days);
        }
        thresholds.push({
            check: 'max-stale-days',
            threshold: maxStaleDays,
            actual,
            passed: actual <= maxStaleDays
        });
    }

    if (minHealthScore !== null) {
        thresholds.push({
            check: 'min-health-score',
            threshold: minHealthScore,
            actual: healthScore,
            passed: healthScore >= minHealthScore
        });
    }

    return thresholds;
}

function run({ json, checks, output, maxBrokenLinks, schemaCoverage, noOrphans, maxStaleDays, minHealthScore }) {
    const enabled = new Set(parseChecks(checks));
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const registry = getRegistry();
    const normalizedThresholds = {
        maxBrokenLinks: parseThresholdNumber(maxBrokenLinks),
        schemaCoverage: parseThresholdNumber(schemaCoverage),
        noOrphans: Boolean(noOrphans),
        maxStaleDays: parseThresholdNumber(maxStaleDays),
        minHealthScore: parseThresholdNumber(minHealthScore)
    };

    const brokenLinks = [];
    if (enabled.has('broken-links')) {
        for (const [id] of idIndex) {
            for (const edge of getEdges(id) || []) {
                if (!idIndex.has(edge.targetId)) {
                    brokenLinks.push({ from: id, to: edge.targetId, field: edge.field });
                }
            }
        }
    }

    const schemaViolations = [];
    if (enabled.has('schema')) {
        const intel = buildSchemaIntelligence(idIndex, fieldsCache, registry);
        for (const coverage of intel.coverage) {
            for (const note of coverage.notesWithMissing) {
                schemaViolations.push({
                    id: note.noteId,
                    type: coverage.type,
                    missing: note.missingFields
                });
            }
        }
    }

    const duplicateIds = [];
    if (enabled.has('duplicates')) {
        for (const [id, files] of getDuplicateIds()) {
            duplicateIds.push({ id, files: [...files] });
        }
    }

    const exitCode = (schemaViolations.length || brokenLinks.length || duplicateIds.length) ? 1 : 0;
    const intel = buildSchemaIntelligence(idIndex, fieldsCache, registry);
    const thresholds = hasThresholdFlags(normalizedThresholds)
        ? collectThresholds({
            idIndex,
            fieldsCache,
            intel,
            brokenLinks,
            ...normalizedThresholds
        })
        : [];
    const thresholdFailures = thresholds.some((entry) => !entry.passed);

    const payload = {
        ok: exitCode === 0 && !thresholdFailures,
        brokenLinks,
        schemaViolations,
        duplicateIds,
        thresholds
    };

    const finalExitCode = payload.ok ? 0 : 1;

    if (json) {
        emitCliSuccess(payload, output);
        process.exit(finalExitCode);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Validate');
        fmt.row('Checks', [...enabled].join(', '));
        fmt.row('Broken links', brokenLinks.length);
        fmt.row('Schema violations', schemaViolations.length);
        fmt.row('Duplicate IDs', duplicateIds.length);
        if (thresholds.length) fmt.row('Threshold checks', thresholds.length);

        if (brokenLinks.length) {
            fmt.blank();
            fmt.subheader(fmt.warn('Broken links'));
            fmt.table(brokenLinks, [
                { key: 'from', label: 'from' },
                { key: 'field', label: 'field' },
                { key: 'to', label: 'missing id' }
            ]);
        }

        if (schemaViolations.length) {
            fmt.blank();
            fmt.subheader(fmt.warn('Schema violations'));
            fmt.table(schemaViolations.map((entry) => ({
                id: entry.id,
                type: entry.type,
                missing: entry.missing.join(', ')
            })), [
                { key: 'id', label: 'note' },
                { key: 'type', label: 'type' },
                { key: 'missing', label: 'missing fields' }
            ]);
        }

        if (duplicateIds.length) {
            fmt.blank();
            fmt.subheader(fmt.warn('Duplicate IDs'));
            fmt.table(duplicateIds.map((entry) => ({
                id: entry.id,
                files: entry.files.join(', ')
            })), [
                { key: 'id', label: 'id' },
                { key: 'files', label: 'files' }
            ]);
        }

        if (thresholds.length) {
            fmt.blank();
            fmt.subheader(fmt.warn('Thresholds'));
            fmt.table(thresholds.map((entry) => ({
                check: entry.check,
                threshold: entry.threshold,
                actual: entry.actual,
                passed: entry.passed ? 'yes' : 'no'
            })), [
                { key: 'check', label: 'check' },
                { key: 'threshold', label: 'threshold' },
                { key: 'actual', label: 'actual' },
                { key: 'passed', label: 'passed' }
            ]);
        }

        fmt.blank();
        console.log(finalExitCode === 0 ? fmt.ok('Vault is clean.') : fmt.err('Validation failed.'));
        fmt.blank();
    }), output);
    process.exit(finalExitCode);
}

module.exports = { run };
