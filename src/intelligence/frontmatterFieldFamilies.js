'use strict';

const SEMANTIC_FIELD_FAMILIES = {
    title: {
        fields: ['name', 'title', 'label', 'subject'],
        summary: 'a clear label field'
    },
    container: {
        fields: ['account', 'company', 'client', 'partner', 'workspace', 'project', 'team', 'unit'],
        summary: 'the main linked context'
    },
    person: {
        fields: ['owner', 'assignee', 'manager', 'reporter', 'contact', 'lead', 'author'],
        summary: 'a person or owner link'
    },
    date: {
        fields: ['date', 'deadline', 'due', 'followup', 'follow-up', 'start', 'ship-date'],
        summary: 'a date or timing field'
    },
    status: {
        fields: ['status', 'stage', 'phase', 'state'],
        summary: 'a workflow status field'
    },
    summary: {
        fields: ['summary', 'notes', 'description', 'overview', 'details'],
        summary: 'a short summary field'
    },
    priority: {
        fields: ['priority', 'severity', 'importance'],
        summary: 'a priority field'
    },
    location: {
        fields: ['location', 'place', 'site', 'region'],
        summary: 'a location field'
    }
};

const FAMILY_MAP = new Map(
    Object.entries(SEMANTIC_FIELD_FAMILIES).map(([family, config]) => [
        family,
        { summary: config.summary, fields: new Set(config.fields) }
    ])
);

function summarizePattern(pattern) {
    const sharedFields = Array.from(pattern.sharedFields || []);
    const sampleTargets = Array.from(pattern.sampleTargets || []);
    const sharedLead = sharedFields.length
        ? `notes like this often add ${pattern.field} alongside ${sharedFields.slice(0, 2).join(' and ')}`
        : `notes like this often add ${pattern.field}`;
    if (pattern.relational && sampleTargets.length) {
        return `${sharedLead}, often linking to ${sampleTargets.slice(0, 2).join(' and ')}`;
    }
    return sharedLead;
}

function naturalList(items = []) {
    const list = items.filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function pickPreferredSourceType(sourceTypes = []) {
    const list = sourceTypes.filter(Boolean);
    if (!list.length) return '';
    const specific = list.find((type) => type !== 'note');
    return specific || list[0];
}

function pickConnectionField(nodeFields = {}) {
    const keys = Object.keys(nodeFields || {}).map((key) => String(key || '').trim().toLowerCase());
    if (keys.includes('related')) return 'related';
    if (keys.includes('links')) return 'links';
    if (keys.includes('see-also')) return 'see-also';
    if (keys.includes('connections')) return 'connections';
    return 'related';
}

function detectFieldFamily(fieldName, semanticRole = null) {
    const normalized = String(fieldName || '').trim().toLowerCase();
    const compact = normalized.replace(/[_\s]+/g, '-');
    const parts = compact.split('-').filter(Boolean);
    for (const [family, config] of FAMILY_MAP) {
        if (config.fields.has(compact)) return family;
        if (parts.some((part) => config.fields.has(part))) return family;
    }
    if (semanticRole === 'date') return 'date';
    if (semanticRole === 'status') return 'status';
    if (semanticRole === 'person') return 'person';
    if (semanticRole === 'container') return 'container';
    return null;
}

function collectCurrentFieldFamilies(nodeFields = {}, noteContext = {}) {
    const families = new Set();
    const roleResultsByField = new Map(
        (noteContext.fieldRoleResults || []).map((result) => [String(result.fieldName || '').trim().toLowerCase(), result])
    );
    for (const [rawFieldName, rawValue] of Object.entries(nodeFields || {})) {
        const value = String(rawValue || '').trim();
        if (!value) continue;
        const normalized = String(rawFieldName || '').trim().toLowerCase();
        const result = roleResultsByField.get(normalized);
        const family = detectFieldFamily(rawFieldName, result?.semanticRole || null);
        if (family) families.add(family);
    }
    return families;
}

function getFieldRoleResult(noteContext = {}, fieldName = '') {
    const normalized = String(fieldName || '').trim().toLowerCase();
    return (noteContext.fieldRoleResults || []).find((result) => {
        return String(result.fieldName || '').trim().toLowerCase() === normalized;
    }) || null;
}

module.exports = {
    SEMANTIC_FIELD_FAMILIES,
    FAMILY_MAP,
    summarizePattern,
    naturalList,
    pickPreferredSourceType,
    pickConnectionField,
    detectFieldFamily,
    collectCurrentFieldFamilies,
    getFieldRoleResult
};
