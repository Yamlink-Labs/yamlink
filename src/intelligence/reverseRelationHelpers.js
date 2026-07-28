'use strict';

/**
 * Structural autocomplete, Behavior B — when a new note is created from a
 * broken bracket (e.g. typing `[[roughnecks]]` on a character note and
 * choosing "Create unit note"), the new note likely wants a field pointing
 * back at the note it was created from. This infers which field that is,
 * and how confident that inference is:
 *
 * - 'observed': an existing note of the target type already has a field
 *   named after the source type (e.g. other `unit` notes already have a
 *   `characters:` field) — real vault evidence, safe to auto-fill.
 * - 'guessed': no existing note of the target type has any such field; the
 *   only candidate is the source type's own name, with zero corroborating
 *   evidence. Callers should not silently write this — "honest silence
 *   over wrong guesses."
 *
 * @param {string} targetType @param {string} sourceType @param {string} sourceId
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @returns {{ field: string, confidence: 'observed'|'guessed' }|null}
 */
function inferReverseRelationField(targetType, sourceType, sourceId, fieldsCache) {
    const normalizedSourceType = String(sourceType || '').trim().toLowerCase();
    if (!normalizedSourceType) return null;
    const normalizedTargetType = String(targetType || '').trim().toLowerCase();

    for (const fields of fieldsCache.values()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (noteType !== normalizedTargetType) continue;
        if (Object.prototype.hasOwnProperty.call(fields, normalizedSourceType)) {
            return { field: normalizedSourceType, confidence: 'observed' };
        }
        if (Object.prototype.hasOwnProperty.call(fields, `${normalizedSourceType}s`)) {
            return { field: `${normalizedSourceType}s`, confidence: 'observed' };
        }
    }

    if (sourceId && normalizedSourceType) return { field: normalizedSourceType, confidence: 'guessed' };
    return null;
}

/** @param {string} existingValue @param {string} targetId @returns {string} */
function mergeRelationFieldValue(existingValue, targetId) {
    const nextLink = `[[${targetId}]]`;
    const current = String(existingValue || '').trim();
    if (!current) return nextLink;
    if (current.includes(nextLink)) return current;
    return `${current}, ${nextLink}`;
}

module.exports = {
    inferReverseRelationField,
    mergeRelationFieldValue
};
