'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getRegistry } = require('../../registries/typeRegistry');
const { getSchema, getSchemaTargets } = require('../../registries/schemaRegistry');
const { buildSchemaIntelligence } = require('../../features/health/healthStats');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');

function buildSchemaListRows() {
    const schemaTargets = [...getSchemaTargets()].sort();
    const registry = getRegistry();
    return schemaTargets.map((type) => {
        const schema = getSchema(type);
        const fieldEntries = Object.entries(schema?.fields || {});
        const requiredFields = fieldEntries
            .filter(([, def]) => def.required)
            .map(([fieldName]) => fieldName);
        return {
            type,
            requiredFields,
            totalFields: fieldEntries.length,
            noteCount: registry.get(type)?.size || 0
        };
    });
}

function runList({ json, output }) {
    const rows = buildSchemaListRows();

    if (json) {
        emitCliSuccess({ count: rows.length, schemas: rows }, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Schema List');
        if (rows.length === 0) {
            console.log(fmt.c.dim('  No schemas defined. Add schema notes to enable introspection.'));
            fmt.blank();
            return;
        }

        fmt.table(rows.map((row) => ({
            type: row.type,
            required: row.requiredFields.join(', ') || '-',
            total: row.totalFields,
            notes: row.noteCount
        })), [
            { key: 'type', label: 'type' },
            { key: 'required', label: 'required fields' },
            { key: 'total', label: 'total fields' },
            { key: 'notes', label: 'notes governed' }
        ]);
        fmt.blank();
    }), output);
}

function buildTypeCheck(targetType) {
    const schema = getSchema(targetType);
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const registry = getRegistry();
    const intel = buildSchemaIntelligence(idIndex, fieldsCache, registry);
    const coverage = intel.coverage.find((entry) => entry.type === targetType) || {
        type: targetType,
        total: 0,
        conformant: 0,
        nonConformant: 0,
        requiredCount: Object.values(schema.fields || {}).filter((fieldDef) => fieldDef.required).length,
        notesWithMissing: []
    };
    const danglingRelations = intel.danglingRelations.filter((entry) => entry.schemaType === targetType);
    const ok = coverage.nonConformant === 0 && danglingRelations.length === 0;
    return { schema, coverage, danglingRelations, ok, type: targetType };
}

function runCheck({ noteType, all, json, output }) {
    if (all) {
        const targets = [...getSchemaTargets()].sort();
        const results = targets.map((type) => {
            const check = buildTypeCheck(type);
            return {
                type,
                conformant: check.coverage.conformant,
                total: check.coverage.total,
                violations: check.coverage.notesWithMissing.map((entry) => ({
                    id: entry.noteId,
                    missing: entry.missingFields
                }))
            };
        });
        const ok = results.every((entry) => entry.violations.length === 0);
        if (json) {
            emitCliSuccess({ all: true, count: results.length, results }, output);
        } else {
            emitText(captureOutput(() => {
                fmt.header('Schema Check: all');
                if (!results.length) {
                    console.log(fmt.c.dim('  No schemas defined. Add schema notes to enable conformance checks.'));
                    fmt.blank();
                    return;
                }
                for (const entry of results) {
                    fmt.subheader(entry.type);
                    fmt.row('Conformant', `${entry.conformant}/${entry.total}`);
                    fmt.row('Violations', entry.violations.length);
                    if (entry.violations.length) {
                        fmt.table(entry.violations.map((violation) => ({
                            id: violation.id,
                            missing: violation.missing.join(', ')
                        })), [
                            { key: 'id', label: 'note' },
                            { key: 'missing', label: 'missing fields' }
                        ]);
                    }
                    fmt.blank();
                }
            }), output);
        }
        if (!ok) process.exit(1);
        return;
    }

    if (!noteType) {
        emitCliError({ json, outputPath: output, error: 'Usage: yamlink schema check <type> | --all', code: 'USAGE', exitCode: 1 });
        return;
    }
    const targetType = String(noteType || '').trim().toLowerCase();
    const schema = getSchema(targetType);

    if (!schema) {
        const payload = {
            ok: true,
            advisory: `No schema exists for type "${targetType}".`,
            type: targetType,
            coverage: null,
            danglingRelations: []
        };
        if (json) {
            emitCliSuccess(payload, output);
        } else {
            emitText(captureOutput(() => {
                fmt.header(`Schema Check: ${targetType}`);
                console.log(fmt.c.dim(`  No schema exists for type "${targetType}".`));
                fmt.blank();
            }), output);
        }
        return;
    }

    const { coverage, danglingRelations, ok } = buildTypeCheck(targetType);
    const payload = { ok, type: targetType, coverage, danglingRelations };
    if (json) {
        emitCliSuccess(payload, output);
        if (!ok) process.exit(1);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header(`Schema Check: ${targetType}`);
        fmt.row('Conformant', `${coverage.conformant}/${coverage.total}`);
        fmt.row('Required fields', coverage.requiredCount);
        fmt.row('Dangling relations', danglingRelations.length);

        if (coverage.notesWithMissing.length) {
            fmt.blank();
            fmt.subheader(fmt.warn('Missing required fields'));
            fmt.table(coverage.notesWithMissing.map((entry) => ({
                note: entry.noteId,
                missing: entry.missingFields.join(', ')
            })), [
                { key: 'note', label: 'note' },
                { key: 'missing', label: 'missing fields' }
            ]);
        }

        if (danglingRelations.length) {
            fmt.blank();
            fmt.subheader(fmt.warn('Dangling relations'));
            fmt.table(danglingRelations, [
                { key: 'field', label: 'field' },
                { key: 'targetType', label: 'target type' }
            ]);
        }

        fmt.blank();
        console.log(ok ? fmt.ok('All notes of this type conform.') : fmt.err('Schema issues found.'));
        fmt.blank();
    }), output);
    if (!ok) process.exit(1);
}

function run({ action, noteType, json, all, output }) {
    if (action === 'list') {
        runList({ json, output });
        return;
    }
    if (action === 'check') {
        runCheck({ noteType, all, json, output });
        return;
    }

    emitCliError({ json, outputPath: output, error: 'Usage: yamlink schema list|check <type>', code: 'USAGE', exitCode: 1 });
}

module.exports = { run };
