'use strict';

const { getIndex, getDuplicateIds } = require('../../core/indexService');
const { getEdges, getGraphStats } = require('../../core/graph');
const { getRegistryStats } = require('../../registries/typeRegistry');
const { getSchemaStats } = require('../../registries/schemaRegistry');
const fmt = require('../format');
const { emitCliSuccess } = require('../io');

function run({ json, vaultPath }) {
    const idIndex    = getIndex();
    const graphStats = getGraphStats();
    const regStats   = getRegistryStats();
    const schemaStats = getSchemaStats();
    const duplicates = getDuplicateIds();

    const brokenLinks = [];
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) {
                brokenLinks.push({ from: id, field: edge.field, to: edge.targetId });
            }
        }
    }

    const dupIds = [];
    for (const [id, paths] of duplicates) {
        dupIds.push({ id, files: [...paths] });
    }

    const data = {
        vault:        vaultPath,
        notes:        idIndex.size,
        edges:        graphStats?.totalEdges ?? 0,
        types:        regStats?.uniqueTypes ?? 0,
        schemas:      schemaStats?.schemas ?? 0,
        brokenLinks,
        duplicateIds: dupIds,
        ok:           brokenLinks.length === 0 && dupIds.length === 0,
    };

    if (json) { emitCliSuccess(data); process.exit(data.ok ? 0 : 1); return; }

    fmt.header('Build: ' + vaultPath);
    fmt.row('Notes',   data.notes);
    fmt.row('Edges',   data.edges);
    fmt.row('Types',   data.types);
    fmt.row('Schemas', data.schemas);

    if (brokenLinks.length) {
        fmt.blank();
        fmt.subheader(fmt.err('Broken links (' + brokenLinks.length + ')'));
        fmt.table(brokenLinks, [
            { key: 'from',  label: 'from' },
            { key: 'field', label: 'field' },
            { key: 'to',    label: 'to (missing)' },
        ]);
    } else {
        fmt.blank();
        fmt.row('Broken links', fmt.ok('none'));
    }

    if (dupIds.length) {
        fmt.blank();
        fmt.subheader(fmt.err('Duplicate IDs (' + dupIds.length + ')'));
        for (const { id, files } of dupIds) {
            fmt.row('  ' + id, files.join(', '));
        }
    }

    fmt.blank();
    if (data.ok) {
        console.log(fmt.ok('✓ Vault is clean.'));
    } else {
        console.log(fmt.err('✗ Vault has issues. Fix broken links or duplicate IDs before release.'));
        process.exit(1);
    }
    fmt.blank();
}

module.exports = { run };
