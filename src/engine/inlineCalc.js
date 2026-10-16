'use strict';

// Pure scanner for inline `=expr` calculations in a note body — shared by
// decorations.js (live result text) and hover.js (label/dependency card) so
// both always agree on what each block is. No VS Code imports.
//
// Every calc block gets an automatic cell label — Y1, Y2, Y3... — in
// document order (one shared sequence, named or not), like an Excel cell
// coordinate. Uppercase on purpose: variable names are case-sensitive, so
// `Y1` can never collide with a lowercase `y1` a user names themselves
// (common in math/science notes), and it matches Excel's uppercase refs.

const { evaluateExpression, isReservedFunctionName, RESERVED_LITERAL_NAMES, RESERVED_KEYWORD_NAMES } = require('./mathExpr');

const CALC_SOURCE = '`([A-Za-z_][A-Za-z0-9_]*)?=([^`]+)`';
const CELL_LABEL_RE = /^Y\d+$/;
const VALID_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Seeds the calc environment from a note's own frontmatter, so a formula can
 * read real vault data (`` `total=price*quantity` `` where `price`/`quantity`
 * are plain YAML fields) instead of only ever referencing another calc cell.
 * Deliberately same-note only in this pass — a cross-note reference
 * (`crossNoteCalcResolver.js`) still only reads the target note's calc
 * cells, not its frontmatter; that's a natural follow-on, not required here.
 *
 * Every field is filtered, never trusted as-is — "honest silence over wrong
 * guesses" applied to frontmatter the same way it already applies to calc
 * values themselves:
 * - Only scalar values (`number`/`string`/`boolean`) are usable — a list, a
 *   wikilink relation, or a nested object has no single value a formula
 *   could read, so those fields are simply absent from the seed (referencing
 *   one by name fails as an honest, ordinary "Unknown variable", same as any
 *   other field a note doesn't have).
 * - Only names already shaped like a valid identifier (`[A-Za-z_][...]*`)
 *   are seeded — a hyphenated field like `unit-price` would otherwise
 *   silently mis-tokenize as `unit - price` (subtraction) the moment someone
 *   referenced it, which is far worse than simply not offering it.
 * - A name that collides with a reserved word (`true`/`false`/`and`/`or`/
 *   `not`/`if`) or the `Y<N>` cell-label shape is skipped, not seeded — this
 *   is an existing note's own frontmatter field, not something the user
 *   authored as a calc name, so silently excluding it is the honest,
 *   least-surprising choice rather than treating an unrelated vault field as
 *   broken.
 * - A same-note calc cell of the same name still shadows it going forward
 *   from the point it's defined, via the exact same `env[name] = value`
 *   overwrite every other redefinition already uses — no new precedence
 *   logic needed, since this only ever changes what `env` starts with.
 * @param {Record<string, unknown>|null|undefined} frontmatterFields
 * @returns {Record<string, import('./mathExpr').ScalarValue>}
 */
// The vault index stores every frontmatter value as text, so "9" must become 9
// here or `squad_size-casualties` fails as string arithmetic. Same rule as the
// query engine's classifyScalarValue, so formulas and `!view` agree.
const PLAIN_NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
function _coerceFrontmatterString(text) {
    const trimmed = text.trim();
    if (PLAIN_NUMBER_RE.test(trimmed)) return Number(trimmed);
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return text;
}

function buildFrontmatterSeedEnv(frontmatterFields) {
    /** @type {Record<string, import('./mathExpr').ScalarValue>} */
    const seed = {};
    if (!frontmatterFields || typeof frontmatterFields !== 'object') return seed;
    for (const [key, value] of Object.entries(frontmatterFields)) {
        if (!VALID_IDENTIFIER_RE.test(key)) continue;
        const lowerKey = key.toLowerCase();
        if (RESERVED_LITERAL_NAMES.has(lowerKey) || RESERVED_KEYWORD_NAMES.has(lowerKey) || CELL_LABEL_RE.test(key)) continue;
        if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') continue;
        // A relation field's value is stored as the raw wikilink text (e.g.
        // "[[acme]]"), not a scalar — a formula has no single value to read
        // there, so it should fail as an ordinary unknown variable, same as
        // a list field, never resolve to that literal bracket text.
        if (typeof value === 'string' && value.trim().startsWith('[[')) continue;
        seed[key] = typeof value === 'string' ? _coerceFrontmatterString(value) : value;
    }
    return seed;
}

// Number formatting — a trailing `as <format>` clause on the calc source
// itself (`` `=price*qty as currency` ``), stripped off BEFORE the real
// expression ever reaches mathExpr.js — the evaluator has no concept of
// formatting, and never will (same "doesn't know anything about notes or
// naming" purity goal that already keeps cross-note syntax out of it).
// Formatting is display metadata only: `evalResult.value` always stays the
// real number, so a formatted cell still composes correctly in further
// same-note/cross-note math and query comparisons — exactly like Excel,
// where a currency-formatted cell's underlying value is still a plain
// number. A closed, named vocabulary (`currency`, `percent`, `comma`, or a
// fixed-decimals pattern like `0`/`0.0`/`0.00`), matching this project's
// existing closed-vocabulary convention (e.g. task priority tags) rather
// than an open-ended printf-style spec.
const FORMAT_CLAUSE_RE = /\s+as\s+([A-Za-z0-9.]+)\s*$/i;
const DECIMAL_FORMAT_RE = /^0(\.0+)?$/;
const NAMED_FORMATS = new Set(['currency', 'percent', 'comma']);

/** @param {string} formatName @returns {boolean} */
function isValidFormatName(formatName) {
    return NAMED_FORMATS.has(formatName.toLowerCase()) || DECIMAL_FORMAT_RE.test(formatName);
}

/**
 * Renders a calc value for display per its `as <format>` clause. Never
 * changes the underlying value — this is called only at render time by
 * decorations.js/hover.js/previewRenderer.js, each independently, so they
 * never disagree about what a formatted cell looks like. A non-numeric
 * value (string/boolean) or no format at all just stringifies plainly —
 * formatting never produces a `#VALUE!`; it's cosmetic, not a computation.
 * @param {import('./mathExpr').ScalarValue} value @param {string|null} format
 * @returns {string}
 */
function formatCalcValue(value, format) {
    if (!format || typeof value !== 'number') return String(value);
    const lower = format.toLowerCase();
    if (lower === 'currency') {
        return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (lower === 'percent') {
        return (value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
    }
    if (lower === 'comma') {
        return Math.round(value).toLocaleString('en-US');
    }
    const decimalMatch = DECIMAL_FORMAT_RE.exec(format);
    if (decimalMatch) {
        const decimals = decimalMatch[1] ? decimalMatch[1].length - 1 : 0;
        return value.toFixed(decimals);
    }
    return String(value);
}

// Cross-note reference syntax — reuses Yamlink's own existing block-reference
// convention (`note^block-id`, wrapped in a wikilink) rather than inventing a
// new one. mathExpr.js never sees this: it's substituted away into a plain
// synthetic identifier (see resolveCrossNoteReferences below) before the
// expression ever reaches the parser, so the evaluator stays exactly as
// note-agnostic as its own header comment already claims.
const CROSS_NOTE_REF_RE = /\[\[([^\]]+)\]\]\^([\w-]+)/g;
const CROSS_NOTE_RANGE_RE = /\[\[([^\]]+)\]\]\^(Y\d+):(Y\d+)/g;
const RANGE_DEFINITION_RE = /^\s*(Y\d+)\s*:\s*(Y\d+)\s*$/;
// `T1.budget` — the whole `budget` column of the first `!view` table in this
// same note, in the order that table currently displays its rows. Same-note
// only, by design, matching the single-hop restraint cross-note references
// already use elsewhere in this file.
const TABLE_RANGE_REF_RE = /\bT(\d+)\.([A-Za-z_][\w-]*)\b/g;

/**
 * Replaces every `[[note]]^label` span with same-length spaces, so a regex
 * hunting for a bare `Y<N>` token (same-note dependency tracking, the
 * save-triggered renumbering in decorations.js) can never accidentally match
 * the label half of a cross-note reference — `[[budget]]^Y2`'s `Y2` belongs
 * to budget's own numbering, not this note's, and must never be rewritten or
 * counted as a local dependency just because it happens to look like one.
 * Same-length replacement keeps every other offset in `expr` unchanged, so
 * callers can still index into the ORIGINAL string using match positions
 * found in the masked one.
 * @param {string} expr
 * @returns {string}
 */
function maskCrossNoteReferences(expr) {
    return expr
        .replace(CROSS_NOTE_RANGE_RE, (whole) => ' '.repeat(whole.length))
        .replace(CROSS_NOTE_REF_RE, (whole) => ' '.repeat(whole.length))
        .replace(TABLE_RANGE_REF_RE, (whole) => ' '.repeat(whole.length));
}

// Human badges for each typed error code (see mathExpr.js's ERROR_CODES for
// where DIV0/NAME/VALUE originate). REF is produced only here, never by
// mathExpr.js itself — see reclassifyAsReferenceError() below. CYCLE is
// listed for completeness/future doc reference but never actually assigned
// today: this scanner's single top-to-bottom pass with one running `env`
// makes a real cycle structurally impossible (a name/label only exists for
// blocks after its own definition) — it becomes reachable only once
// cross-note references exist, at which point this map gains real use, not
// just a placeholder.
const ERROR_CODE_LABELS = {
    REF: '#REF!',
    DIV0: '#DIV/0!',
    NAME: '#NAME?',
    VALUE: '#VALUE!',
    CYCLE: '#CYCLE!'
};

/**
 * mathExpr.js can't tell a broken cell reference (`Y5` when there is no
 * fifth cell) from any other unresolved name — it has no concept of a
 * "cell," by design (see mathExpr.js's own header comment). This is the one
 * place that distinction gets made: a `NAME` failure whose identifier is
 * shaped like this scanner's own `Y<N>` label convention is re-labeled
 * `REF` and reworded to read as a broken reference, not an unknown name.
 * @param {import('./mathExpr').EvalResult} evalResult
 * @returns {import('./mathExpr').EvalResult}
 */
function reclassifyAsReferenceError(evalResult) {
    if (evalResult.ok) return evalResult;
    const failure = /** @type {{ ok: false, code: string, error: string, identifier?: string }} */ (evalResult);
    if (failure.code !== 'NAME' || !failure.identifier || !CELL_LABEL_RE.test(failure.identifier)) return evalResult;
    const identifier = failure.identifier;
    return { ok: false, code: 'REF', error: `Reference broken: ${identifier} does not exist`, identifier };
}

/**
 * Replaces every `[[note]]^label` span in `expr` with a synthetic identifier
 * (`__xref1`, `__xref2`, ...) bound to its resolved value, so the rest of the
 * pipeline (mathExpr.js's parser) only ever sees ordinary identifiers.
 *
 * Deliberately single-hop: `resolveCrossNoteRef`, when called against another
 * note's body, is expected to run that note's OWN calc cells with no
 * resolver of its own (see crossNoteCalcResolver.js) — so if that note's own
 * formula in turn references a third note, that nested reference simply
 * fails as an ordinary unresolved reference inside that note's own scan.
 * This isn't a missing feature; it's what makes a cross-note cycle
 * structurally impossible, the same way same-note forward references already
 * are, rather than something that needs runtime cycle detection.
 *
 * If ANY reference in the expression fails to resolve (or no resolver was
 * supplied at all — most callers of scanInlineCalcs don't pass one, and
 * that's a supported, honest "not available here" case, not a bug), the
 * whole substitution short-circuits: no partial evaluation, matching
 * "honest silence over wrong guesses."
 *
 * @param {string} expr
 * @param {((noteId: string, label: string) => {ok: true, value: import('./mathExpr').ScalarValue} | {ok: false, reason: string})|null|undefined} resolveCrossNoteRef
 * @returns {{ substituted: string, syntheticEnv: Record<string, import('./mathExpr').ScalarValue>, syntheticRanges: Record<string, import('./mathExpr').ScalarValue[]>, syntheticLabels: Record<string, string>, failure: string|null }}
 */
function resolveCrossNoteReferences(expr, resolveCrossNoteRef) {
    let syntheticIndex = 0;
    let failure = null;
    /** @type {Record<string, import('./mathExpr').ScalarValue>} */
    const syntheticEnv = {};
    /** @type {Record<string, import('./mathExpr').ScalarValue[]>} */
    const syntheticRanges = {};
    const rangeExpr = expr.replace(CROSS_NOTE_RANGE_RE, (whole, rawNoteId, startLabel, endLabel) => {
        if (failure) return whole;
        syntheticIndex += 1;
        const key = `__xrange${syntheticIndex}`;
        const noteId = String(rawNoteId || '').trim();
        const first = Number(startLabel.slice(1));
        const last = Number(endLabel.slice(1));
        if (last < first) {
            failure = `[[${noteId}]]^${startLabel}:${endLabel} — the range end comes before its start`;
            return key;
        }
        if (!resolveCrossNoteRef) {
            failure = `[[${noteId}]]^${startLabel}:${endLabel} — cross-note references aren't available here`;
            return key;
        }
        const values = [];
        for (let n = first; n <= last; n++) {
            const result = resolveCrossNoteRef(noteId, `Y${n}`);
            if (!result.ok) {
                const rejection = /** @type {{ ok: false, reason: string }} */ (result);
                failure = `[[${noteId}]]^Y${n} — ${rejection.reason}`;
                return key;
            }
            values.push(result.value);
        }
        syntheticRanges[key] = values;
        return key;
    });
    // Maps each synthetic identifier back to the original `[[note]]^label`
    // text it replaced — display-only, read by hover.js's step-by-step
    // inspector so a trace entry for `__xref1` can render as the reference
    // the user actually typed instead of the internal placeholder name.
    /** @type {Record<string, string>} */
    const syntheticLabels = {};
    const substituted = rangeExpr.replace(CROSS_NOTE_REF_RE, (whole, rawNoteId, label) => {
        if (failure) return whole;
        syntheticIndex += 1;
        const key = `__xref${syntheticIndex}`;
        const noteId = String(rawNoteId || '').trim();
        syntheticLabels[key] = `[[${noteId}]]^${label}`;
        if (!resolveCrossNoteRef) {
            failure = `[[${noteId}]]^${label} — cross-note references aren't available here`;
            return key;
        }
        const result = resolveCrossNoteRef(noteId, label);
        if (!result.ok) {
            const rejection = /** @type {{ ok: false, reason: string }} */ (result);
            failure = `[[${noteId}]]^${label} — ${rejection.reason}`;
            return key;
        }
        syntheticEnv[key] = result.value;
        return key;
    });
    return { substituted, syntheticEnv, syntheticRanges, syntheticLabels, failure };
}

/**
 * `T1.budget` reads the whole `budget` column of this note's first `!view`
 * table, in the order that table currently displays — same-note only.
 * `resolveTableRange(label, field)` is the live, I/O-backed implementation
 * (see tableRangeResolver.js); it runs the table's query, so it's only ever
 * called when a formula actually contains a `T<N>.<field>` reference.
 * @param {string} expr
 * @param {((label: string, field: string) => {ok: true, values: import('./mathExpr').ScalarValue[]} | {ok: false, reason: string})|null|undefined} resolveTableRange
 */
function resolveTableRanges(expr, resolveTableRange) {
    let syntheticIndex = 0;
    let failure = null;
    /** @type {Record<string, import('./mathExpr').ScalarValue[]>} */
    const syntheticRanges = {};
    const substituted = expr.replace(TABLE_RANGE_REF_RE, (whole, num, field) => {
        if (failure) return whole;
        syntheticIndex += 1;
        const key = `__trange${syntheticIndex}`;
        const label = `T${num}`;
        if (!resolveTableRange) {
            failure = `${label}.${field} — table references aren't available here`;
            return key;
        }
        const result = resolveTableRange(label, field);
        if (!result.ok) {
            const rejection = /** @type {{ ok: false, reason: string }} */ (result);
            failure = `${label}.${field} — ${rejection.reason}`;
            return key;
        }
        syntheticRanges[key] = result.values;
        return key;
    });
    return { substituted, syntheticRanges, failure };
}

/**
 * `prices=Y1:Y8` names a run of automatic cell labels so later functions can
 * take it as one argument: `median(prices)`, `sumif(prices, ">40")`. The cells
 * are read as they stand at this point in the note, like any other reference.
 */
function defineNamedRange(name, expr, env, ranges, base) {
    const match = RANGE_DEFINITION_RE.exec(expr);
    const first = Number(match[1].slice(1));
    const last = Number(match[2].slice(1));
    if (!name) {
        return { ...base, evalResult: { ok: false, code: 'VALUE', error: 'A range needs a name, for example prices=Y1:Y8' } };
    }
    if (last < first) {
        return { ...base, evalResult: { ok: false, code: 'VALUE', error: `Range invalid: ${match[1]}:${match[2]} (end before start)` } };
    }
    const values = [];
    for (let n = first; n <= last; n++) {
        const cell = `Y${n}`;
        if (!Object.prototype.hasOwnProperty.call(env, cell)) {
            return { ...base, evalResult: { ok: false, code: 'REF', error: `${cell} doesn't exist in this note yet` } };
        }
        values.push(env[cell]);
    }
    ranges[name] = values;
    return { ...base, evalResult: { ok: true, value: `${match[1]}:${match[2]}` } };
}

/** @param {string} text @returns {Array<{start: number, end: number}>} */
function collectFencedCodeBlockSpans(text) {
    const spans = [];
    const regex = /^```[\s\S]*?^```/gm;
    let match;
    while ((match = regex.exec(text)) !== null) {
        spans.push({ start: match.index, end: match.index + match[0].length });
    }
    return spans;
}

/**
 * Cells (by label or name) that an expression reads, with the value each
 * held when this block was evaluated. Function calls are not dependencies.
 * @param {string} expr @param {Record<string, import('./mathExpr').ScalarValue>} env
 * @returns {Array<{ref: string, value: import('./mathExpr').ScalarValue}>}
 */
function collectDependencies(expr, env) {
    const seen = new Set();
    const deps = [];
    const identifier = /[A-Za-z_][A-Za-z0-9_]*/g;
    let match;
    while ((match = identifier.exec(expr)) !== null) {
        const followedBy = expr.slice(match.index + match[0].length).trimStart()[0];
        if (followedBy === '(') continue;
        const ref = match[0];
        if (seen.has(ref) || !Object.prototype.hasOwnProperty.call(env, ref)) continue;
        seen.add(ref);
        deps.push({ ref, value: env[ref] });
    }
    return deps;
}

/**
 * @typedef {import('./mathExpr').EvalResult} CalcResult
 * @typedef {{
 *   start: number, end: number, exprStart: number,
 *   name: string|null, label: string, expr: string, format: string|null,
 *   deps: Array<{ref: string, value: import('./mathExpr').ScalarValue}>, evalResult: CalcResult
 * }} InlineCalcBlock
 */

/**
 * Scan a note's text for inline calc blocks, evaluating top-to-bottom with
 * one running environment — a name or label only exists for blocks after its
 * own definition, so forward references and cycles are impossible by
 * construction. A failed block never enters the environment.
 *
 * `options.resolveCrossNoteRef`, when supplied, lets an expression also
 * reference another note's calc cell via `[[note]]^label` (the same wikilink
 * + block-sigil convention Yamlink already uses everywhere else for
 * block-level references) — see resolveCrossNoteReferences() above for the
 * substitution mechanism and crossNoteCalcResolver.js for the real,
 * I/O-backed implementation most callers should pass. Omitting it (every
 * existing caller today) means cross-note syntax in an expression simply
 * fails as an honest `#REF!` rather than a crash or a silently wrong value —
 * "not available here" is itself a valid, supported outcome, not an error
 * condition callers need to guard against separately.
 *
 * `options.frontmatterFields`, when supplied, seeds the starting environment
 * from the note's own frontmatter (see buildFrontmatterSeedEnv() above) —
 * lets a formula read real vault data (`` `total=price*quantity` ``) instead
 * of only ever referencing another calc cell. Omitting it (same as omitting
 * `resolveCrossNoteRef`) just means no frontmatter fields are available —
 * referencing one fails as an ordinary "Unknown variable", not a crash.
 *
 * `options.trace`, when true, additionally collects a step-by-step
 * resolution trace per block (see mathExpr.js's `collectTrace` option) and a
 * `syntheticLabels` map translating any cross-note `__xrefN` placeholder back
 * to the `[[note]]^label` text it replaced — both consumed only by hover.js's
 * step-by-step inspector. Omitted by every other caller (decorations.js's
 * hot ghost-text path included) so this costs nothing there; the returned
 * block shape is byte-identical to before this option existed when omitted.
 * @param {string} text
 * @param {{
 *   resolveCrossNoteRef?: (noteId: string, label: string) => {ok: true, value: import('./mathExpr').ScalarValue} | {ok: false, reason: string},
 *   resolveTableRange?: (label: string, field: string) => {ok: true, values: import('./mathExpr').ScalarValue[]} | {ok: false, reason: string},
 *   frontmatterFields?: Record<string, unknown>,
 *   trace?: boolean
 * }} [options]
 * @returns {InlineCalcBlock[]}
 */
function scanInlineCalcs(text, options = {}) {
    const resolveCrossNoteRef = options.resolveCrossNoteRef || null;
    const resolveTableRange = options.resolveTableRange || null;
    const wantTrace = !!options.trace;
    const fencedSpans = collectFencedCodeBlockSpans(text);
    const regex = new RegExp(CALC_SOURCE, 'g');
    /** @type {Record<string, import('./mathExpr').ScalarValue>} */
    const env = buildFrontmatterSeedEnv(options.frontmatterFields);
    /** @type {Record<string, import('./mathExpr').ScalarValue[]>} */
    const ranges = {};
    /** @type {InlineCalcBlock[]} */
    const blocks = [];
    let index = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (fencedSpans.some((span) => start < span.end && end > span.start)) continue;

        const name = match[1] || null;
        const rawExpr = match[2];
        index += 1;
        const label = `Y${index}`;

        // Peel off a trailing `as <format>` display clause before the real
        // expression goes anywhere else — mathExpr.js, cross-note resolution,
        // and dependency scanning all only ever see the arithmetic part.
        let expr = rawExpr;
        let format = null;
        let formatError = null;
        const formatMatch = FORMAT_CLAUSE_RE.exec(rawExpr);
        if (formatMatch) {
            const formatName = formatMatch[1];
            if (isValidFormatName(formatName)) {
                format = formatName.toLowerCase() === 'currency' || formatName.toLowerCase() === 'percent' || formatName.toLowerCase() === 'comma'
                    ? formatName.toLowerCase()
                    : formatName;
                expr = rawExpr.slice(0, formatMatch.index);
            } else {
                formatError = `Format invalid: "${formatName}" — use currency, percent, comma, or a decimal pattern like 0.00`;
            }
        }

        const base = { start, end, exprStart: start + 1 + (name ? name.length : 0) + 1, name, label, expr, format, deps: [] };

        if (name && RESERVED_LITERAL_NAMES.has(name.toLowerCase())) {
            blocks.push({ ...base, evalResult: { ok: false, code: 'VALUE', error: `Name reserved: "${name}" is a reserved word` } });
            continue;
        }
        // Checked before isReservedFunctionName() on purpose: `and`/`or`/`not`
        // are now ALSO callable as ordinary functions (see mathExpr.js's
        // RAW_ARG_FUNCTIONS — ordinary function-call syntax, `and(a, b)`, as
        // a pure alias alongside the infix keyword form), but they're
        // fundamentally keywords first — a cell named "and" should say so,
        // not "is a built-in function", which would be a confusing, less
        // accurate answer for a name that was always rejected for being a
        // keyword long before it also happened to gain function-call sugar.
        if (name && RESERVED_KEYWORD_NAMES.has(name.toLowerCase())) {
            blocks.push({ ...base, evalResult: { ok: false, code: 'VALUE', error: `Name reserved: "${name}" is a keyword` } });
            continue;
        }
        if (name && isReservedFunctionName(name)) {
            blocks.push({ ...base, evalResult: { ok: false, code: 'VALUE', error: `Name reserved: "${name}" is a built-in function` } });
            continue;
        }
        if (name && name.toLowerCase() === 'as') {
            blocks.push({ ...base, evalResult: { ok: false, code: 'VALUE', error: 'Name reserved: "as" is the formatting clause' } });
            continue;
        }
        if (name && CELL_LABEL_RE.test(name)) {
            blocks.push({ ...base, evalResult: { ok: false, code: 'VALUE', error: `Name reserved: "${name}" is an automatic cell label` } });
            continue;
        }
        if (formatError) {
            blocks.push({ ...base, evalResult: { ok: false, code: 'VALUE', error: formatError } });
            continue;
        }

        if (RANGE_DEFINITION_RE.test(expr)) {
            blocks.push(defineNamedRange(name, expr, env, ranges, base));
            continue;
        }
        const deps = collectDependencies(maskCrossNoteReferences(expr), env);
        const tableResolution = resolveTableRanges(expr, resolveTableRange);
        const crossNoteResolution = tableResolution.failure
            ? { substituted: tableResolution.substituted, syntheticEnv: {}, syntheticRanges: {}, syntheticLabels: {}, failure: null }
            : resolveCrossNoteReferences(tableResolution.substituted, resolveCrossNoteRef);
        const { substituted, syntheticEnv, syntheticRanges, syntheticLabels } = crossNoteResolution;
        const failure = tableResolution.failure || crossNoteResolution.failure;
        /** @type {import('./mathExpr').EvalResult} */
        let evalResult = failure
            ? { ok: false, code: 'REF', error: failure }
            : reclassifyAsReferenceError(evaluateExpression(substituted, { ...env, ...syntheticEnv }, { collectTrace: wantTrace, ranges: { ...ranges, ...tableResolution.syntheticRanges, ...syntheticRanges } }));
        // mathExpr.js's start/end offsets are relative to `substituted`, not
        // `expr` — `[[note]]^label` → `__xrefN` substitution changes string
        // length, so a position would silently point at the wrong span once
        // a cross-note reference is involved. Only trust it when nothing was
        // actually substituted (the common case: no cross-note refs at all).
        if (!evalResult.ok && substituted !== expr && 'start' in evalResult) {
            const { start: _start, end: _end, ...withoutOffset } = /** @type {{start:number,end:number}} */ (evalResult);
            evalResult = /** @type {import('./mathExpr').EvalResult} */ (withoutOffset);
        }
        if (evalResult.ok) {
            if (name) env[name] = evalResult.value;
            env[label] = evalResult.value;
        }
        // `trace`/`syntheticLabels` are only ever attached when the caller
        // asked for them (options.trace, see hover.js) — every other caller
        // (decorations.js's hot ghost-text path, running on every keystroke)
        // gets back the exact same block shape as before this was added.
        const traceFields = wantTrace ? { trace: 'trace' in evalResult ? evalResult.trace || [] : [], syntheticLabels } : {};
        blocks.push({ ...base, deps, evalResult, ...traceFields });
    }
    return blocks;
}

module.exports = { scanInlineCalcs, collectFencedCodeBlockSpans, ERROR_CODE_LABELS, maskCrossNoteReferences, formatCalcValue, buildFrontmatterSeedEnv, coerceFrontmatterText: _coerceFrontmatterString };
