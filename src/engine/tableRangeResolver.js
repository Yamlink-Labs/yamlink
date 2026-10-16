'use strict';

// Real, query-backed implementation of the `resolveTableRange` callback
// scanInlineCalcs() accepts (see inlineCalc.js). Kept in its own file, same
// reasoning as crossNoteCalcResolver.js: this is the one place that actually
// runs a `!view` query for this feature, so inlineCalc.js itself stays free
// of any query-engine import.
//
// Same-note only, by design — a table reference addresses one of THIS
// note's own `!view` blocks, in the order they appear in its body. Reading
// another note's table is out of scope here, the same single-hop restraint
// cross-note cell references already use.

const { parseAllViewQueries } = require('./queryParser');
const { runQuery } = require('./queryExecutor');
const { coerceFrontmatterText } = require('./inlineCalc');

const TABLE_LABEL_RE = /^T(\d+)$/;

/**
 * Builds a `resolveTableRange(label, field)` callback for scanInlineCalcs,
 * scoped to one note's body text. Each `!view` block in the note gets an
 * automatic label — T1, T2, ... — in document order, the same convention
 * calc cells already use for Y<N>. A query referenced by more than one
 * formula in the same note (e.g. two cells both reading `T1.budget` and
 * `T1.effective_strength`) only runs once: results are cached for the
 * lifetime of this resolver, not across calls — matching how decorations.js
 * already re-scans (and would re-build this resolver for) the whole note on
 * every render, with no cache of its own.
 * @param {string} noteBodyText
 * @returns {(label: string, field: string) => {ok: true, values: import('./mathExpr').ScalarValue[]} | {ok: false, reason: string}}
 */
function createTableRangeResolver(noteBodyText) {
    const queries = parseAllViewQueries(noteBodyText) || [];
    const resultCache = new Map();

    function getResult(index) {
        if (!resultCache.has(index)) resultCache.set(index, runQuery(queries[index]));
        return resultCache.get(index);
    }

    return function resolveTableRange(label, field) {
        const match = TABLE_LABEL_RE.exec(label);
        if (!match) {
            return { ok: false, reason: `"${label}" isn't a table reference — tables in this note are T1, T2, ... in the order their !view blocks appear` };
        }
        const index = Number(match[1]) - 1;
        if (!queries[index]) {
            return { ok: false, reason: queries.length
                ? `this note only has ${queries.length} table${queries.length === 1 ? '' : 's'} (up to T${queries.length})`
                : 'this note has no !view tables yet' };
        }

        const result = getResult(index);
        if (!result.success) return { ok: false, reason: result.error || 'that table failed to run' };

        const fieldNorm = String(field || '').trim().toLowerCase();
        const query = queries[index];
        let raw;
        if (result.groups) {
            const groupField = String(query.groupBy || '').toLowerCase();
            raw = result.groups.map((g) => (fieldNorm === groupField ? g.key : (g.aggregates ? g.aggregates[fieldNorm] : undefined)));
        } else {
            raw = result.rows.map((r) => (r.fields || {})[fieldNorm]);
        }
        if (raw.every((v) => v === undefined)) {
            return { ok: false, reason: `that table has no column named "${field}"` };
        }

        const values = raw
            .filter((v) => v !== undefined && v !== null && v !== '')
            .map((v) => (typeof v === 'string' ? coerceFrontmatterText(v) : v));
        return { ok: true, values };
    };
}

/**
 * Every `!view` table in a note, with its column names — for surfaces that
 * want to let a user pick a `T<N>.<field>` reference (e.g. formula
 * autocomplete) without re-running the resolver per keystroke to discover
 * what's even available. Column names come straight from the query result's
 * own `columns`, so they always match exactly what `createTableRangeResolver`
 * would actually resolve a value for — no separate, potentially-drifting
 * list of "valid" column names to keep in sync.
 * @param {string} noteBodyText
 * @returns {Array<{ label: string, columns: string[] }>}
 */
function listNoteTableColumns(noteBodyText) {
    const queries = parseAllViewQueries(noteBodyText) || [];
    return queries.map((query, index) => {
        const result = runQuery(query);
        return { label: `T${index + 1}`, columns: result.success ? (result.columns || []) : [] };
    });
}

module.exports = { createTableRangeResolver, listNoteTableColumns };
