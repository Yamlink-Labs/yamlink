'use strict';

const { inferFieldRole, normalizeFieldName } = require('../intelligence/fieldRoles');
const { inferNoteRole } = require('../intelligence/noteRolesCore');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const { getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { collectDocumentTags } = require('../intelligence/tagSignals');
const { collectBodySignals, buildBodySignalHints } = require('../intelligence/bodySignals');

/**
 * Duck-typed document contract shared by VS Code and the LSP server — only
 * needs getText()/.uri.fsPath (lineAt() when line-level context is used), not
 * the full vscode.TextDocument surface. See CLAUDE.md's completion helpers note.
 * @typedef {{ getText: () => string, lineAt?: (n: number) => {text: string}, uri?: {fsPath?: string} }} DocumentLike
 */

const FRONTMATTER_ARCHETYPES = {
    account: ['name', 'status', 'owner', 'contacts', 'website', 'domain', 'industry', 'stage', 'email', 'phone'],
    company: ['name', 'status', 'owner', 'contacts', 'website', 'domain', 'industry', 'stage', 'email', 'phone'],
    contact: ['name', 'account', 'email', 'phone', 'title', 'status', 'owner', 'city'],
    lead: ['name', 'account', 'email', 'phone', 'status', 'owner', 'source', 'stage'],
    opportunity: ['name', 'account', 'owner', 'status', 'stage', 'value', 'close-date'],
    mission: ['name', 'date', 'commander', 'unit', 'outcome', 'status'],
    character: ['name', 'status', 'rank', 'unit', 'species', 'homeworld'],
    task: ['status', 'owner', 'date', 'priority', 'account']
};
const TITLE_ARCHETYPE_KEYWORDS = {
    account: ['account', 'company', 'client', 'customer'],
    contact: ['contact', 'person', 'lead'],
    opportunity: ['deal', 'opportunity', 'pipeline'],
    mission: ['mission', 'operation'],
    character: ['character', 'profile', 'persona']
};
const NOTE_ROLE_FIELD_PRIORS = {
    person: ['name', 'email', 'phone', 'title', 'status', 'owner', 'account', 'city'],
    container: ['name', 'status', 'owner', 'contacts', 'website', 'domain', 'industry', 'stage'],
    event: ['date', 'status', 'purpose', 'participants', 'account', 'location'],
    artifact: ['name', 'status', 'owner', 'product', 'component', 'concept', 'repo'],
    concept: ['name', 'summary', 'status', 'concepts', 'products', 'related'],
    project: ['name', 'status', 'owner', 'repo', 'milestone', 'date'],
    task: ['status', 'owner', 'assignee', 'priority', 'date', 'deadline', 'project', 'repo'],
    place: ['name', 'region', 'status', 'location'],
    record: ['name', 'status', 'date', 'summary']
};
const TYPE_FIELD_ALIASES = new Set([
    'type',
    'note-type',
    'record-type',
    'entity-type',
    'item-type',
    'content-type',
    'category',
    'kind',
    'class',
    'profile-type'
]);

/** @param {string} fieldName @returns {string} */
function normalizeFrontmatterKey(fieldName) {
    return String(fieldName || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
}

/** @param {string} fieldName @returns {boolean} */
function isTypeLikeField(fieldName) {
    const compact = normalizeFieldName(fieldName).replace(/[\s_-]+/g, '');
    return compact === 'type' || compact.endsWith('type') || TYPE_FIELD_ALIASES.has(normalizeFrontmatterKey(fieldName));
}

/** @param {DocumentLike} document @param {number} lineIndex @returns {boolean} */
function isPositionInFrontmatter(document, lineIndex) {
    const lines = document.getText().split('\n');
    let openLine = -1;
    let closeLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
            if (openLine === -1) openLine = i;
            else { closeLine = i; break; }
        }
    }
    if (openLine === -1 || closeLine === -1) return false;
    return lineIndex > openLine && lineIndex < closeLine;
}

/** @param {DocumentLike} document @returns {Record<string,string>} */
function extractFrontmatterFields(document) {
    const text = document.getText();
    const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return /** @type {Record<string,string>} */({});

    const fields = /** @type {Record<string,string>} */({});
    for (const line of match[1].split('\n')) {
        const fieldMatch = line.match(/^\s*([^:\n]+):\s*(.*?)\s*$/);
        if (!fieldMatch) continue;
        fields[normalizeFrontmatterKey(fieldMatch[1])] = fieldMatch[2];
    }
    return fields;
}

function extractDocumentArchetype(document, docType) {
    const candidates = new Set();
    if (docType) candidates.add(String(docType).trim().toLowerCase());

    const text = document.getText();
    const headingMatch = text.match(/^#\s+(.+)$/m);
    const nameMatch = text.match(/^\s*name:\s*(.+?)\s*$/m);
    const pathBits = [];
    if (headingMatch) pathBits.push(headingMatch[1]);
    if (nameMatch) pathBits.push(nameMatch[1]);
    if (document.uri?.fsPath) pathBits.push(document.uri.fsPath.split(/[\\/]/).pop() || '');
    const haystack = pathBits.join(' ').toLowerCase();

    for (const [type, keywords] of Object.entries(TITLE_ARCHETYPE_KEYWORDS)) {
        if (keywords.some(keyword => haystack.includes(keyword))) {
            candidates.add(type);
        }
    }
    return Array.from(candidates);
}

/** @param {DocumentLike} document @returns {string|null} */
function getDocumentType(document) {
    const fields = extractFrontmatterFields(document);
    if (fields.type) return String(fields.type).trim().toLowerCase();

    for (const [key, value] of Object.entries(fields)) {
        if (!isTypeLikeField(key)) continue;
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized) return normalized;
    }
    return null;
}

function extractNoteRoleHints(document, nodeFields = {}) {
    const text = document.getText();
    const hints = [];
    const bodySignals = collectBodySignals(text);
    const headingMatch = text.match(/^#\s+(.+)$/m);
    if (headingMatch) hints.push(headingMatch[1]);
    if (nodeFields.name) hints.push(nodeFields.name);
    if (nodeFields.title) hints.push(nodeFields.title);
    for (const hint of buildBodySignalHints(bodySignals)) {
        hints.push(hint);
    }
    for (const tag of collectDocumentTags(document, nodeFields)) {
        hints.push(tag);
    }
    if (document.uri?.fsPath) {
        hints.push(document.uri.fsPath.split(/[\\/]/).pop() || '');
    }
    return hints;
}

/** @param {DocumentLike} document @param {string|null} docType @param {Map<string,string>} idIndex @returns {{ nodeFields: Record<string,string>, currentFields: Set<string>, currentTags: Set<string>, bodySignals: any, fieldRoleResults: any[], noteRole: any }} */
function buildDocumentIntelligence(document, docType, idIndex) {
    const nodeFields = extractFrontmatterFields(document);
    const currentTags = collectDocumentTags(document, nodeFields);
    const bodySignals = collectBodySignals(document.getText());
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
    const fieldRoleResults = Object.keys(nodeFields)
        .filter((key) => key !== 'id' && !isTypeLikeField(key))
        .map((key) => inferFieldRole(key, { documentType: docType, idIndex }));
    const noteRole = inferNoteRole(nodeFields, {
        fieldRoleResults,
        titleHints: extractNoteRoleHints(document, nodeFields),
        typeRoleMap: priors.typeRoleMap || null,
        noteRolePriors: priors.noteRoleNamePriors || null,
        noteRoleFieldHints: priors.noteRoleFieldHints || null
    });
    return {
        nodeFields,
        currentFields: new Set(Object.keys(nodeFields)),
        currentTags: new Set(currentTags),
        bodySignals,
        fieldRoleResults,
        noteRole
    };
}

/** @param {string} fieldName @param {DocumentLike} document @param {Map<string,string>} idIndex @returns {{ relational: boolean, targetType: string|null, semanticRole: string|null, reasons: string[] }} */
function fieldLooksRelational(fieldName, document, idIndex) {
    const docType = getDocumentType(document);
    const role = inferFieldRole(fieldName, { documentType: docType, idIndex });
    return {
        relational: role.relational,
        targetType: role.targetType,
        semanticRole: role.semanticRole,
        reasons: role.reasons
    };
}

/** @param {string[]} [reasons] @param {number} [max] @returns {string} */
function summariseInferenceReasons(reasons = [], max = 2) {
    return reasons
        .filter(Boolean)
        .slice(0, max)
        .join('; ');
}

function buildFieldInferenceDetail(entryDetail, relationState) {
    const reasonText = summariseInferenceReasons(relationState.reasons);
    if (relationState.relational) {
        const base = relationState.targetType
            ? `${entryDetail} → ${relationState.targetType}`
            : `${entryDetail} → relation`;
        return reasonText ? `${base} · ${reasonText}` : base;
    }
    if (relationState.semanticRole) {
        const base = `${entryDetail} · ${relationState.semanticRole} field`;
        return reasonText ? `${base} · ${reasonText}` : base;
    }
    return reasonText ? `${entryDetail} · ${reasonText}` : entryDetail;
}

module.exports = {
    FRONTMATTER_ARCHETYPES,
    TITLE_ARCHETYPE_KEYWORDS,
    NOTE_ROLE_FIELD_PRIORS,
    TYPE_FIELD_ALIASES,
    normalizeFrontmatterKey,
    isTypeLikeField,
    isPositionInFrontmatter,
    extractFrontmatterFields,
    extractDocumentArchetype,
    getDocumentType,
    extractNoteRoleHints,
    collectDocumentTags,
    buildDocumentIntelligence,
    fieldLooksRelational,
    summariseInferenceReasons,
    buildFieldInferenceDetail
};
