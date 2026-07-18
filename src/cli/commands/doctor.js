'use strict';

const { getIndex, getFieldsCache, getDuplicateIds, getMalformedFiles, getVaultGeneration } = require('../../core/indexService');
const { getEdges, getBacklinks } = require('../../core/graph');
const { getRegistry } = require('../../registries/typeRegistry');
const { getCachedPriors } = require('../../intelligence/vaultPriors');
const { inferLifecycleState } = require('../../intelligence/lifecycleState');
const { buildSchemaIntelligence } = require('../../features/health/healthStats');
const { buildNoteArc } = require('../../intelligence/noteArc');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

function collectDoctorData() {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const registry = getRegistry();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());

    const brokenLinks = [];
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) {
                brokenLinks.push({ from: id, to: edge.targetId, field: edge.field });
            }
        }
    }

    const duplicateIds = [];
    for (const [id, files] of getDuplicateIds()) {
        duplicateIds.push({ id, files: [...files] });
    }

    const malformedFiles = [];
    for (const [file, message] of getMalformedFiles()) {
        malformedFiles.push({ file, message });
    }

    const orphans = [];
    const noteIds = [...idIndex.keys()];
    let totalInbound = 0;
    for (const id of noteIds) totalInbound += (getBacklinks(id) || []).length;
    const avgInbound = noteIds.length > 0 ? totalInbound / noteIds.length : 0;

    const staleNotes = [];
    const arcGapByType = new Map();

    for (const id of noteIds) {
        const fields = fieldsCache.get(id) || {};
        const noteType = String(fields.type || '').trim().toLowerCase();
        if (!SYSTEM_TYPES.has(noteType) && (getEdges(id) || []).length === 0 && (getBacklinks(id) || []).length === 0) {
            orphans.push(id);
        }

        if (!noteType || SYSTEM_TYPES.has(noteType)) continue;

        const lifecycle = inferLifecycleState(id, fields, {
            fieldsCache,
            idIndex,
            fieldTargetTypes: priors.fieldTargetTypes,
            typeFieldBundles: priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            noteType,
            inboundCount: (getBacklinks(id) || []).length,
            avgInbound,
        });
        if (lifecycle.state === 'stale') {
            staleNotes.push({ id, type: noteType, summary: lifecycle.reasons[0] || lifecycle.label });
        }

        const bundle = arcGapByType.get(noteType) || { total: 0, withGap: 0 };
        bundle.total += 1;
        const arc = buildNoteArc(
            fields,
            noteType,
            fieldsCache,
            priors.typeFieldBundles,
            priors.fieldTargetTypes,
            priors.outcomeCalibration,
            { emergentClusters: priors.emergentClusters }
        );
        if (arc.missingFields.length > 0) bundle.withGap += 1;
        arcGapByType.set(noteType, bundle);
    }

    const schemaIntel = buildSchemaIntelligence(idIndex, fieldsCache, registry);
    const schemaViolations = [];
    for (const coverage of schemaIntel.coverage) {
        for (const note of coverage.notesWithMissing) {
            schemaViolations.push({
                id: note.noteId,
                type: coverage.type,
                missing: note.missingFields
            });
        }
    }

    const arcGaps = [...arcGapByType.entries()]
        .map(([type, stats]) => ({
            type,
            total: stats.total,
            withGap: stats.withGap,
            ratio: stats.total > 0 ? stats.withGap / stats.total : 0
        }))
        .filter((entry) => entry.ratio > 0.30)
        .sort((a, b) => b.ratio - a.ratio);

    return {
        brokenLinks,
        duplicateIds,
        malformedFiles,
        orphans,
        schemaViolations,
        staleNotes,
        arcGaps,
    };
}

function run({ json, output }) {
    const data = collectDoctorData();
    const payload = {
        brokenLinks: {
            count: data.brokenLinks.length,
            notes: [...new Set(data.brokenLinks.map((entry) => entry.from))],
            refs: data.brokenLinks
        },
        duplicateIds: data.duplicateIds,
        malformedFiles: data.malformedFiles,
        orphans: data.orphans,
        schemaViolations: data.schemaViolations,
        staleNotes: {
            count: data.staleNotes.length,
            notes: data.staleNotes
        },
        arcGaps: data.arcGaps,
        healthy: data.brokenLinks.length === 0
            && data.duplicateIds.length === 0
            && data.malformedFiles.length === 0
            && data.orphans.length === 0
            && data.schemaViolations.length === 0
            && data.staleNotes.length === 0
            && data.arcGaps.length === 0
    };

    if (json) {
        emitCliSuccess(payload, output);
        process.exit(payload.healthy ? 0 : 1);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Doctor');
        fmt.row('Broken links', data.brokenLinks.length === 0 ? fmt.ok('0') : fmt.err(String(data.brokenLinks.length)));
        fmt.row('Duplicate IDs', data.duplicateIds.length === 0 ? fmt.ok('0') : fmt.err(String(data.duplicateIds.length)));
        fmt.row('Malformed frontmatter', data.malformedFiles.length === 0 ? fmt.ok('0') : fmt.err(String(data.malformedFiles.length)));
        fmt.row('Orphans', data.orphans.length === 0 ? fmt.ok('0') : fmt.warn(String(data.orphans.length)));
        fmt.row('Schema violations', data.schemaViolations.length === 0 ? fmt.ok('0') : fmt.err(String(data.schemaViolations.length)));
        fmt.row('Stale notes', data.staleNotes.length === 0 ? fmt.ok('0') : fmt.warn(String(data.staleNotes.length)));
        fmt.row('Arc gaps', data.arcGaps.length === 0 ? fmt.ok('0') : fmt.warn(String(data.arcGaps.length)));

        fmt.blank();
        console.log(data.brokenLinks.length === 0 ? `${fmt.ok('✓')} Broken links` : `${fmt.err('✗')} Broken links`);
        if (data.brokenLinks.length) {
            fmt.table(data.brokenLinks.map((entry) => ({
                note: entry.from,
                field: entry.field,
                missing: entry.to
            })), [
                { key: 'note', label: 'note' },
                { key: 'field', label: 'field' },
                { key: 'missing', label: 'missing id' }
            ]);
            fmt.blank();
        }

        console.log(data.duplicateIds.length === 0 ? `${fmt.ok('✓')} Duplicate IDs` : `${fmt.err('✗')} Duplicate IDs`);
        if (data.duplicateIds.length) {
            fmt.table(data.duplicateIds.map((entry) => ({
                id: entry.id,
                files: entry.files.join(', ')
            })), [
                { key: 'id', label: 'id' },
                { key: 'files', label: 'files' }
            ]);
            fmt.blank();
        }

        console.log(data.malformedFiles.length === 0 ? `${fmt.ok('✓')} Malformed frontmatter` : `${fmt.err('✗')} Malformed frontmatter`);
        if (data.malformedFiles.length) {
            fmt.table(data.malformedFiles.map((entry) => ({
                file: entry.file,
                error: entry.message
            })), [
                { key: 'file', label: 'file' },
                { key: 'error', label: 'yaml error' }
            ]);
            fmt.blank();
        }

        console.log(data.orphans.length === 0 ? `${fmt.ok('✓')} Orphan notes` : `${fmt.warn('✗')} Orphan notes`);
        if (data.orphans.length) {
            fmt.table(data.orphans.map((id) => ({ id })), [{ key: 'id', label: 'note' }]);
            fmt.blank();
        }

        console.log(data.schemaViolations.length === 0 ? `${fmt.ok('✓')} Schema violations` : `${fmt.err('✗')} Schema violations`);
        if (data.schemaViolations.length) {
            fmt.table(data.schemaViolations.map((entry) => ({
                id: entry.id,
                type: entry.type,
                missing: entry.missing.join(', ')
            })), [
                { key: 'id', label: 'note' },
                { key: 'type', label: 'type' },
                { key: 'missing', label: 'missing fields' }
            ]);
            fmt.blank();
        }

        console.log(data.staleNotes.length === 0 ? `${fmt.ok('✓')} Stale notes` : `${fmt.warn('✗')} Stale notes`);
        if (data.staleNotes.length) {
            fmt.table(data.staleNotes.map((entry) => ({
                id: entry.id,
                type: entry.type,
                summary: entry.summary
            })), [
                { key: 'id', label: 'note' },
                { key: 'type', label: 'type' },
                { key: 'summary', label: 'summary' }
            ]);
            fmt.blank();
        }

        console.log(data.arcGaps.length === 0 ? `${fmt.ok('✓')} Arc gaps` : `${fmt.warn('✗')} Arc gaps`);
        if (data.arcGaps.length) {
            fmt.table(data.arcGaps.map((entry) => ({
                type: entry.type,
                affected: `${entry.withGap}/${entry.total}`,
                ratio: `${Math.round(entry.ratio * 100)}%`
            })), [
                { key: 'type', label: 'type' },
                { key: 'affected', label: 'notes with gap' },
                { key: 'ratio', label: 'gap ratio' }
            ]);
            fmt.blank();
        }

        console.log(payload.healthy ? fmt.ok('Vault is healthy.') : fmt.err('Doctor found issues.'));
        fmt.blank();
    }), output);
    process.exit(payload.healthy ? 0 : 1);
}

module.exports = { run, collectDoctorData };
