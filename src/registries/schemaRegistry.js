// ─────────────────────────────────────────────────────────────────
// schemaRegistry.js — Phase 2D
//
// Purely observational. Built from schema nodes discovered during
// the index scan. Cleared and rebuilt on every buildIndex().
//
// A schema node is a Yamlink node with:
//   type: schema
//   target: <targetType>
//   fields:         ← nested YAML block, parsed with js-yaml
//     fieldName:
//       type: string | number | relation
//       required: true | false    (optional, defaults to false)
//       target: <relationType>    (only meaningful when type: relation)
//
// Registry = mirror of reality, not a gatekeeper.
// Enforcement is diagnostics.js's concern (Phase 2D step 2).
//
// Invariants:
//   - One schema per target type is canonical.
//   - Duplicate schemas (same target) are tracked; diagnostics will
//     surface them as Information severity — advisory, non-blocking.
//   - js-yaml is used only here, for the nested fields: block.
//     Flat parseFrontmatter() in index.js is untouched.
// ─────────────────────────────────────────────────────────────────

const yaml = require('js-yaml');

/**
 * @typedef {{ type: string, required: boolean, target?: string, targetTypes?: string[], options?: string[] }} SchemaField
 * @typedef {{ sourceId: string, fields: Record<string, SchemaField> }} SchemaEntry
 */

// targetType → SchemaEntry
let schemaMap = new Map();

// targetType → [sourceId, ...] — only populated when size > 1
let duplicateMap = new Map();

/** @returns {void} */
function clearSchemaRegistry() {
    schemaMap.clear();
    duplicateMap.clear();
}

// ─────────────────────────────────────────────────────────────────
// registerSchemaNode
//
// Called once per node during index build, only when:
//   fields.type === 'schema'
//
// Receives the raw frontmatter string (everything between the two
// --- delimiters) so js-yaml can parse the nested fields: block.
//
// Silently skips nodes that are missing `target:` — they are
// malformed schema nodes. Diagnostics will surface these.
// ─────────────────────────────────────────────────────────────────
/**
 * @param {string} sourceId
 * @param {string} frontmatterText Raw YAML text between `---` delimiters.
 * @returns {void}
 */
function registerSchemaNode(sourceId, frontmatterText) {
    if (!sourceId || !frontmatterText) return;

    let parsed;
    try {
        parsed = yaml.load(frontmatterText);
    } catch (e) {
        console.warn(`Yamlink — schemaRegistry: js-yaml failed on node "${sourceId}":`, e.message);
        return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    const target = parsed.target;
    if (!target || typeof target !== 'string') {
        console.warn(`Yamlink — schemaRegistry: schema node "${sourceId}" has no valid target: field — skipped`);
        return;
    }

    const normalizedTarget = target.trim().toLowerCase();

    // Normalise fields block — tolerates missing fields: entirely
    const rawFields = parsed.fields;
    const fields    = normalizeFields(rawFields, sourceId);

    if (schemaMap.has(normalizedTarget)) {
        // Duplicate — track both, first writer stays canonical
        const existing = schemaMap.get(normalizedTarget);
        if (!duplicateMap.has(normalizedTarget)) {
            duplicateMap.set(normalizedTarget, [existing.sourceId]);
        }
        duplicateMap.get(normalizedTarget).push(sourceId);
        console.warn(
            `Yamlink — schemaRegistry: duplicate schema for type "${normalizedTarget}" ` +
            `(existing: "${existing.sourceId}", new: "${sourceId}") — first writer wins`
        );
        return;
    }

    schemaMap.set(normalizedTarget, { sourceId, fields });
    console.log(
        `Yamlink — schemaRegistry: registered schema for "${normalizedTarget}" ` +
        `from "${sourceId}" with ${Object.keys(fields).length} field(s)`
    );
}

// ─────────────────────────────────────────────────────────────────
// normalizeFields
//
// Accepts the raw parsed value of the fields: key (could be
// an object, null, or undefined) and returns a clean map of:
//   { fieldName → { type: 'string'|'number'|'relation', required: bool, target?: string } }
//
// Unknown field types are preserved as-is and flagged in logs.
// Enforcement / diagnostics will surface them later.
// ─────────────────────────────────────────────────────────────────
const VALID_FIELD_TYPES = new Set(['string', 'number', 'relation', 'date', 'status', 'workflow', 'identity', 'text', 'scalar']);

function normalizeFields(rawFields, sourceId) {
    if (!rawFields || typeof rawFields !== 'object') return {};

    const result = {};

    for (const [fieldName, fieldDef] of Object.entries(rawFields)) {
        if (!fieldDef || typeof fieldDef !== 'object') {
            console.warn(
                `Yamlink — schemaRegistry: field "${fieldName}" in "${sourceId}" ` +
                `has no definition object — skipped`
            );
            continue;
        }

        const fieldType = typeof fieldDef.type === 'string'
            ? fieldDef.type.trim().toLowerCase()
            : null;

        if (!fieldType) {
            console.warn(
                `Yamlink — schemaRegistry: field "${fieldName}" in "${sourceId}" ` +
                `is missing type: — skipped`
            );
            continue;
        }

        if (!VALID_FIELD_TYPES.has(fieldType)) {
            console.warn(
                `Yamlink — schemaRegistry: field "${fieldName}" in "${sourceId}" ` +
                `has unknown type "${fieldType}" — stored but will not be enforced`
            );
        }

        const entry = {
            type:     fieldType,
            required: fieldDef.required === true
        };

        if (Array.isArray(fieldDef.options)) {
            entry.options = fieldDef.options
                .map(v => String(v).trim())
                .filter(Boolean);
        }

        // relation target is optional - absence means "any node"
        if (fieldType === 'relation' && typeof fieldDef.target === 'string') {
            entry.target = fieldDef.target.trim().toLowerCase();
        }

        result[fieldName] = entry;
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────
// Public read API
// ─────────────────────────────────────────────────────────────────

/**
 * @param {string} targetType
 * @returns {boolean}
 */
function hasSchema(targetType) {
    if (!targetType) return false;
    return schemaMap.has(targetType.trim().toLowerCase());
}

/**
 * @param {string} targetType
 * @returns {SchemaEntry | null}
 */
function getSchema(targetType) {
    if (!targetType) return null;
    return schemaMap.get(targetType.trim().toLowerCase()) ?? null;
}

/** @returns {Set<string>} */
function getSchemaTargets() {
    return new Set(schemaMap.keys());
}

/** @returns {Map<string, string[]>} targetType → [sourceId, ...] (only populated for types with 2+ schemas) */
function getDuplicateSchemas() {
    return duplicateMap;
}

/** @returns {{ schemas: number, duplicates: number, targets: string[] }} */
function getSchemaStats() {
    return {
        schemas:    schemaMap.size,
        duplicates: duplicateMap.size,
        targets:    [...schemaMap.keys()]
    };
}

module.exports = {
    clearSchemaRegistry,
    registerSchemaNode,
    hasSchema,
    getSchema,
    getSchemaTargets,
    getDuplicateSchemas,
    getSchemaStats
};
