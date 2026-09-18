'use strict';

const { getBacklinks } = require('./graph');

function labelFor(sourceId, fields) {
    return String(fields?.name || fields?.title || sourceId || '').trim();
}

function typeFor(fields) {
    return String(fields?.type || '').trim();
}

function kindForField(field) {
    return field === 'body' ? 'body' : 'frontmatter';
}

function sortGroups(a, b) {
    if (a.field === 'body' && b.field !== 'body') return 1;
    if (a.field !== 'body' && b.field === 'body') return -1;
    return a.field.localeCompare(b.field);
}

function buildDependencyPreview(id, idIndex = new Map(), fieldsCache = new Map()) {
    const rows = [];
    const seenSources = new Set();
    for (const edge of getBacklinks(id) || []) {
        const sourceId = String(edge?.sourceId || '').trim();
        const field = String(edge?.field || '').trim() || 'body';
        if (!sourceId || !idIndex.has(sourceId)) continue;
        const fields = fieldsCache.get(sourceId) || {};
        seenSources.add(sourceId);
        rows.push({
            field,
            kind: kindForField(field),
            sourceId,
            label: labelFor(sourceId, fields),
            type: typeFor(fields),
            filePath: idIndex.get(sourceId) || null
        });
    }

    rows.sort((a, b) => {
        const fieldCompare = sortGroups(a, b);
        if (fieldCompare !== 0) return fieldCompare;
        return a.sourceId.localeCompare(b.sourceId);
    });

    const groupMap = new Map();
    for (const row of rows) {
        if (!groupMap.has(row.field)) {
            groupMap.set(row.field, { field: row.field, kind: row.kind, count: 0, rows: [] });
        }
        const group = groupMap.get(row.field);
        group.count += 1;
        group.rows.push(row);
    }

    const frontmatterTotal = rows.filter((row) => row.kind === 'frontmatter').length;
    const bodyTotal = rows.filter((row) => row.kind === 'body').length;
    return {
        id,
        total: rows.length,
        sourceCount: seenSources.size,
        frontmatterTotal,
        bodyTotal,
        groups: [...groupMap.values()].sort(sortGroups),
        rows
    };
}

function describeDependencyPreview(dependencies) {
    const total = Number(dependencies?.total || 0);
    const sourceCount = Number(dependencies?.sourceCount || 0);
    const frontmatterTotal = Number(dependencies?.frontmatterTotal || 0);
    const bodyTotal = Number(dependencies?.bodyTotal || 0);
    if (!total) return 'No inbound dependencies found.';
    const sourceLabel = sourceCount === 1 ? '1 note' : `${sourceCount} notes`;
    const parts = [];
    if (frontmatterTotal) parts.push(`${frontmatterTotal} frontmatter relation${frontmatterTotal === 1 ? '' : 's'}`);
    if (bodyTotal) parts.push(`${bodyTotal} body mention${bodyTotal === 1 ? '' : 's'}`);
    return `Referenced by ${sourceLabel}: ${parts.join(', ')}.`;
}

module.exports = {
    buildDependencyPreview,
    describeDependencyPreview
};
