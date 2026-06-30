'use strict';

const { canonicalizeId } = require('./id');

/**
 * @typedef {'heading'|'task'|'quote'|'footnote'} BodyBlockType
 *
 * @typedef {{
 *   blockId: string,
 *   type: BodyBlockType,
 *   line: number,
 *   endLine: number,
 *   label: string,
 *   text: string
 * }} BodyBlock
 */

function normalizeAnchorText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h >>>= 0;
    }
    return h.toString(36);
}

function buildTaskBlockId(taskNumber, rawText) {
    return `t${taskNumber}-${hashString(String(rawText || '')).slice(0, 6)}`;
}

function buildQuoteBlockId(quoteNumber, text) {
    return `q${quoteNumber}-${hashString(String(text || '')).slice(0, 6)}`;
}

function buildHeadingBlockId(baseSlug, occurrence) {
    const base = `h-${baseSlug || 'section'}`;
    return occurrence <= 1 ? base : `${base}-${occurrence}`;
}

function buildFootnoteBlockId(id) {
    const normalized = canonicalizeId(id) || hashString(String(id || '')).slice(0, 6);
    return `fn-${normalized}`;
}

function findBodyStartLine(lines) {
    if (!lines[0] || lines[0].trim() !== '---') return 0;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') return i + 1;
    }
    return 0;
}

/**
 * Extract only the meaningful addressable body units we want in the first
 * block-ID foundation pass: headings, tasks, blockquotes/callouts, and
 * footnote definitions.
 *
 * @param {string} content
 * @returns {BodyBlock[]}
 */
function extractMeaningfulBodyBlocks(content) {
    const text = String(content || '');
    const lines = text.split('\n');
    const blocks = [];
    const bodyStartLine = findBodyStartLine(lines);
    const headingCounts = new Map();
    let taskNumber = 0;
    let quoteNumber = 0;

    for (let i = bodyStartLine; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;

        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const headingText = String(headingMatch[2] || '').trim();
            const slug = normalizeAnchorText(headingText);
            const occurrence = (headingCounts.get(slug) || 0) + 1;
            headingCounts.set(slug, occurrence);
            blocks.push({
                blockId: buildHeadingBlockId(slug, occurrence),
                type: 'heading',
                line: i,
                endLine: i,
                label: headingText,
                text: headingText
            });
            continue;
        }

        const taskMatch = line.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(.+)$/);
        if (taskMatch) {
            taskNumber += 1;
            const taskIndent = taskMatch[1].length;
            const rawText = String(taskMatch[3] || '').trim();
            let endLine = i;
            for (let j = i + 1; j < lines.length; j++) {
                const next = lines[j];
                const nextTrimmed = next.trim();
                if (!nextTrimmed) {
                    endLine = j;
                    continue;
                }
                const nextIndent = next.match(/^\s*/)?.[0]?.length || 0;
                const isNewListItem = /^[-*+]\s/.test(nextTrimmed) || /^\d+[.)]\s/.test(nextTrimmed);
                const isHeading = /^#+\s/.test(nextTrimmed);
                if (nextIndent <= taskIndent || isNewListItem || isHeading) break;
                endLine = j;
            }
            blocks.push({
                blockId: buildTaskBlockId(taskNumber, rawText),
                type: 'task',
                line: i,
                endLine,
                label: rawText,
                text: rawText
            });
            continue;
        }

        const footnoteMatch = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
        if (footnoteMatch) {
            const footnoteId = String(footnoteMatch[1] || '').trim();
            const valueLines = [String(footnoteMatch[2] || '').trim()];
            let endLine = i;
            let j = i + 1;
            while (j < lines.length && /^( {2,}|\t)/.test(lines[j])) {
                valueLines.push(lines[j].replace(/^( {2,}|\t)/, '').trimEnd());
                endLine = j;
                j++;
            }
            blocks.push({
                blockId: buildFootnoteBlockId(footnoteId),
                type: 'footnote',
                line: i,
                endLine,
                label: footnoteId,
                text: valueLines.join('\n').trim()
            });
            i = endLine;
            continue;
        }

        if (/^>/.test(trimmed)) {
            const quoteLines = [line.replace(/^>\s?/, '').trimEnd()];
            let endLine = i;
            let j = i + 1;
            while (j < lines.length && /^>/.test(lines[j].trim())) {
                quoteLines.push(lines[j].replace(/^>\s?/, '').trimEnd());
                endLine = j;
                j++;
            }
            quoteNumber += 1;
            const quoteText = quoteLines.join('\n').trim();
            blocks.push({
                blockId: buildQuoteBlockId(quoteNumber, quoteText),
                type: 'quote',
                line: i,
                endLine,
                label: quoteText.split('\n')[0] || 'Quote',
                text: quoteText
            });
            i = endLine;
        }
    }

    return blocks;
}

/**
 * @param {Map<string, Map<string, BodyBlock>>} blockIndex
 * @param {string} noteId
 * @param {string} blockId
 * @returns {number}
 */
function findBlockLine(blockIndex, noteId, blockId) {
    const noteBlocks = blockIndex.get(String(noteId || '').trim().toLowerCase());
    if (!noteBlocks) return -1;
    const block = noteBlocks.get(String(blockId || '').trim());
    return block ? block.line : -1;
}

/**
 * @param {BodyBlock[]} blocks
 * @param {number} startLine
 * @param {number} [endLine]
 * @returns {BodyBlock|null}
 */
function findBodyBlockInLineRange(blocks, startLine, endLine = startLine) {
    const rangeStart = Number.isInteger(startLine) ? startLine : -1;
    const rangeEnd = Number.isInteger(endLine) ? endLine : rangeStart;
    if (rangeStart < 0 || rangeEnd < rangeStart) return null;

    const matches = (Array.isArray(blocks) ? blocks : [])
        .filter((block) => block.line <= rangeEnd && block.endLine >= rangeStart)
        .sort((a, b) => {
            const spanA = Math.max(0, a.endLine - a.line);
            const spanB = Math.max(0, b.endLine - b.line);
            return spanA - spanB || a.line - b.line;
        });
    return matches[0] || null;
}

/**
 * @param {string} noteId
 * @param {BodyBlock} block
 * @returns {string}
 */
function formatBlockReference(noteId, block) {
    const id = String(noteId || '').trim();
    if (!id || !block) return '';
    if (block.type === 'heading') {
        return `[[${id}#${String(block.label || '').trim()}]]`;
    }
    return `[[${id}^${String(block.blockId || '').trim()}]]`;
}

module.exports = {
    normalizeAnchorText,
    hashString,
    buildTaskBlockId,
    buildQuoteBlockId,
    buildHeadingBlockId,
    buildFootnoteBlockId,
    extractMeaningfulBodyBlocks,
    findBlockLine,
    findBodyBlockInLineRange,
    formatBlockReference
};
