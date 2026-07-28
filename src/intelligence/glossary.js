'use strict';

const fs = require('fs');

/**
 * Reads a note's body text verbatim (original casing, frontmatter stripped) —
 * deliberately not the query engine's `readBody()` cache in
 * `src/engine/queryExecutor.js`, which lowercases everything for
 * case-insensitive search matching. A glossary definition excerpt needs to
 * display like real prose, not a search-index string.
 * @param {string} filePath
 * @returns {string}
 */
function readNoteBodyVerbatim(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return '';
    }
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? content.slice(match[0].length) : content;
}

/**
 * @param {string} bodyText
 * @returns {string}
 */
function extractFirstParagraph(bodyText) {
    const paragraphs = String(bodyText || '')
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.replace(/\r?\n/g, ' ').trim())
        .filter(Boolean);
    return paragraphs[0] || '';
}

/**
 * @typedef {{ id: string, term: string, type: string, definition: string, definitionSource: 'field'|'body'|'none', backlinkIds: string[], extra: Record<string,string> }} GlossaryEntry
 */

/**
 * Builds the glossary's flat entry list: every note whose type is in
 * `options.types`, each with a definition (an explicit `definition:`/
 * `summary:` field if present, else the note's own first body paragraph,
 * never invented text) and its full backlink list (the same `getBacklinks()`
 * data Note Report's Links tab already reads, just gathered across every
 * term-note instead of one note at a time).
 *
 * @param {{ fieldsCache: Map<string,object>, idIndex: Map<string,string> }} vault
 * @param {{ types: string[], showZeroBacklinkTerms?: boolean, extraFields?: string[] }} options
 * @param {{ getBacklinksFn: (id: string) => {field:string, sourceId:string}[], readBodyFn?: (filePath: string) => string }} deps
 * @returns {GlossaryEntry[]}
 */
function buildGlossaryEntries(vault, options, deps) {
    const { fieldsCache, idIndex } = vault;
    const typeSet = new Set((options.types || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean));
    if (!typeSet.size) return [];

    const showZeroBacklinkTerms = options.showZeroBacklinkTerms !== false;
    const extraFields = options.extraFields || [];
    const readBodyFn = deps.readBodyFn || readNoteBodyVerbatim;

    const entries = [];
    for (const [id, fields] of fieldsCache) {
        const type = String(fields?.type || '').trim().toLowerCase();
        if (!typeSet.has(type)) continue;

        const backlinkIds = [...new Set(
            deps.getBacklinksFn(id).map((edge) => edge.sourceId).filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));

        if (!showZeroBacklinkTerms && backlinkIds.length === 0) continue;

        const explicitDefinition = String(fields?.definition || fields?.summary || '').trim();
        let definition = explicitDefinition;
        /** @type {'field'|'body'|'none'} */
        let definitionSource = explicitDefinition ? 'field' : 'none';
        if (!definition) {
            const filePath = idIndex.get(id);
            if (filePath) {
                definition = extractFirstParagraph(readBodyFn(filePath));
                if (definition) definitionSource = 'body';
            }
        }

        /** @type {Record<string,string>} */
        const extra = {};
        for (const fieldName of extraFields) {
            const value = fields?.[fieldName];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                extra[fieldName] = String(value);
            }
        }

        entries.push({
            id,
            term: String(fields?.name || fields?.title || id),
            type,
            definition,
            definitionSource,
            backlinkIds,
            extra
        });
    }

    return entries;
}

/**
 * @typedef {{ letter: string|null, entries: GlossaryEntry[] }} GlossaryLetterGroup
 * @typedef {{ type: string|null, letters: GlossaryLetterGroup[] }} GlossaryTypeGroup
 */

/**
 * Buckets a flat entry list into alphabetical letter sections, optionally
 * nested under a type section first. `groupByType: true` with a single
 * selected type still produces one type group — a harmless one-line header,
 * not a bug — so no special-casing is needed for the single-type case.
 *
 * `sortBy: 'mostReferenced'` ranks entries by backlink count (descending,
 * ties broken alphabetically) instead of alphabetizing — a ranked list has
 * no natural letter sections, so each type bucket collapses to a single
 * `{ letter: null, entries }` group in that case rather than forcing A-Z
 * headers onto a frequency-ordered list.
 * @param {GlossaryEntry[]} entries
 * @param {{ groupByType?: boolean, sortBy?: 'alphabetical'|'mostReferenced' }} [options]
 * @returns {GlossaryTypeGroup[]}
 */
function groupGlossaryEntries(entries, options = {}) {
    const groupByType = options.groupByType !== false;
    const sortBy = options.sortBy === 'mostReferenced' ? 'mostReferenced' : 'alphabetical';

    function bucketsFor(list) {
        if (sortBy === 'mostReferenced') {
            const ranked = [...list].sort((a, b) => {
                const byCount = b.backlinkIds.length - a.backlinkIds.length;
                return byCount !== 0 ? byCount : a.term.localeCompare(b.term);
            });
            return [{ letter: null, entries: ranked }];
        }

        const sorted = [...list].sort((a, b) => a.term.localeCompare(b.term));
        const byLetter = new Map();
        for (const entry of sorted) {
            const letter = (entry.term[0] || '#').toUpperCase();
            if (!byLetter.has(letter)) byLetter.set(letter, []);
            byLetter.get(letter).push(entry);
        }
        return [...byLetter.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([letter, groupEntries]) => ({ letter, entries: groupEntries }));
    }

    if (!groupByType) {
        return [{ type: null, letters: bucketsFor(entries) }];
    }

    const byType = new Map();
    for (const entry of entries) {
        if (!byType.has(entry.type)) byType.set(entry.type, []);
        byType.get(entry.type).push(entry);
    }
    return [...byType.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([type, groupEntries]) => ({ type, letters: bucketsFor(groupEntries) }));
}

module.exports = {
    readNoteBodyVerbatim,
    extractFirstParagraph,
    buildGlossaryEntries,
    groupGlossaryEntries
};
