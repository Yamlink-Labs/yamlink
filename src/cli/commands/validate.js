'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getRegistry } = require('../../registries/typeRegistry');
const { buildSchemaIntelligence } = require('../../features/health/healthStats');
const fmt = require('../format');

function run({ json }) {
    const idIndex    = getIndex();
    const fieldsCache = getFieldsCache();
    const registry   = getRegistry();

    const intel = buildSchemaIntelligence(idIndex, fieldsCache, registry);
    const { advisories, coverage, danglingRelations } = intel;

    const totalNonConformant = coverage.reduce((s, c) => s + c.nonConformant, 0);
    const ok = totalNonConformant === 0 && danglingRelations.length === 0;

    if (json) {
        console.log(JSON.stringify({ advisories, coverage, danglingRelations, ok }, null, 2));
        process.exit(ok ? 0 : 1);
        return;
    }

    if (coverage.length === 0) {
        fmt.header('Schema Validation');
        console.log(fmt.c.dim('  No schemas defined. Add schema notes to enable conformance checks.'));
        fmt.blank();
        return;
    }

    fmt.header('Schema Validation');

    for (const c of coverage) {
        const pct = c.total > 0 ? Math.round(c.conformant / c.total * 100) : 100;
        const pctStr = pct === 100 ? fmt.ok(pct + '%') : pct >= 80 ? fmt.warn(pct + '%') : fmt.err(pct + '%');
        fmt.blank();
        fmt.subheader(c.type + ' — ' + pctStr + ' conformant (' + c.conformant + '/' + c.total + ' notes, ' + c.requiredCount + ' required fields)');
        if (c.notesWithMissing.length) {
            fmt.table(
                c.notesWithMissing.map(n => ({
                    note:    fmt.warn(n.noteId),
                    missing: n.missingFields.join(', ')
                })),
                [
                    { key: 'note',    label: 'note' },
                    { key: 'missing', label: 'missing required fields' },
                ]
            );
        }
    }

    if (danglingRelations.length) {
        fmt.blank();
        fmt.subheader(fmt.warn('Dangling relations (' + danglingRelations.length + ')'));
        fmt.table(danglingRelations.map(d => ({
            schema: d.schemaType,
            field:  d.field,
            target: fmt.warn(d.targetType + ' (no notes of this type)')
        })), [
            { key: 'schema', label: 'schema' },
            { key: 'field',  label: 'field' },
            { key: 'target', label: 'target type' },
        ]);
    }

    if (advisories.length) {
        fmt.blank();
        fmt.subheader('Unschematized types');
        fmt.table(advisories, [
            { key: 'type',  label: 'type' },
            { key: 'count', label: 'notes' },
        ]);
    }

    fmt.blank();
    if (ok) {
        console.log(fmt.ok('✓ All schematized notes conform.'));
    } else {
        console.log(fmt.err('✗ ' + totalNonConformant + ' note(s) missing required fields.'));
        process.exit(1);
    }
    fmt.blank();
}

module.exports = { run };
