'use strict';

const fs = require('fs');
const { scanInlineCalcs } = require('../engine/inlineCalc');

function normalizeText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripLeadingFrontmatter(content) {
    const normalized = normalizeText(content);
    if (/^\s*---/.test(normalized)) {
        const firstDash = normalized.indexOf('---');
        const closingIdx = normalized.indexOf('---', firstDash + 3);
        return closingIdx !== -1 ? normalized.slice(closingIdx + 3) : normalized;
    }
    return normalized;
}

/**
 * @param {string} filePath
 * @returns {string|null}
 */
function defaultReadBody(filePath) {
    try {
        return stripLeadingFrontmatter(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

/**
 * Summarizes inline calculation health for one note body.
 *
 * @param {string} text
 * @returns {{ total: number, evaluated: number, failed: number, byCode: Record<string, number> }}
 */
function buildNoteCalcHealth(text) {
    const blocks = scanInlineCalcs(String(text || ''));
    /** @type {Record<string, number>} */
    const byCode = {};
    let evaluated = 0;

    for (const block of blocks) {
        const result = block.evalResult;
        if (result.ok === true) {
            evaluated++;
            continue;
        }
        if (result.ok === false) {
            byCode[result.code] = (byCode[result.code] || 0) + 1;
        }
    }

    const total = blocks.length;
    return {
        total,
        evaluated,
        failed: total - evaluated,
        byCode
    };
}

/**
 * Summarizes inline calculation health across the vault.
 *
 * @param {Map<string, Record<string, any>>} fieldsCache
 * @param {Map<string, string>} idIndex
 * @param {(filePath: string) => string|null} [readBody]
 * @returns {{
 *   totalCells: number,
 *   evaluatedCells: number,
 *   failedCells: number,
 *   byCode: Record<string, number>,
 *   notesWithFailures: number
 * }}
 */
function buildVaultCalcHealth(fieldsCache, idIndex, readBody = defaultReadBody) {
    const summary = {
        totalCells: 0,
        evaluatedCells: 0,
        failedCells: 0,
        /** @type {Record<string, number>} */
        byCode: {},
        notesWithFailures: 0
    };

    for (const id of fieldsCache.keys()) {
        const filePath = idIndex.get(id);
        if (!filePath) continue;

        const body = readBody(filePath);
        if (!body) continue;

        const noteHealth = buildNoteCalcHealth(body);
        summary.totalCells += noteHealth.total;
        summary.evaluatedCells += noteHealth.evaluated;
        summary.failedCells += noteHealth.failed;
        if (noteHealth.failed > 0) summary.notesWithFailures++;

        for (const [code, count] of Object.entries(noteHealth.byCode)) {
            summary.byCode[code] = (summary.byCode[code] || 0) + count;
        }
    }

    return summary;
}

module.exports = { buildNoteCalcHealth, buildVaultCalcHealth };
