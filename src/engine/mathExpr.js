'use strict';

// Small, dependency-free arithmetic expression evaluator powering inline
// `` `=expr` `` calculations in note bodies (src/features/decorations.js).
// Deliberately hand-rolled rather than pulling in mathjs/expr-eval: the
// supported grammar is bounded (arithmetic + exponent + a handful of
// functions), and this keeps the engine layer dependency-free and fully
// auditable, matching the project's "no build step, pure CommonJS" rule.
//
// Grammar (precedence low → high):
//   or         := and ('or' and)*
//   and        := not ('and' not)*
//   not        := 'not' not | comparison
//   comparison := expression (('>' | '<' | '>=' | '<=' | '==' | '!=') expression)?   // non-chaining
//   expression := term (('+' | '-') term)*
//   term       := unary (('*' | '/' | '%') unary)*
//   unary      := ('-' | '+') unary | exponent
//   exponent   := primary ('^' unary)?        // right-associative
//   primary    := number | string | 'true' | 'false' | '(' or ')' | ident '(' args ')' | ident
//   args       := argValue (',' argValue)*
//   argValue   := (Y<N> ':' Y<M>) | or          // a range expands to N..M values, see below
//
// A bare `ident` not followed by `(` is a variable reference, resolved
// against the `env` passed to evaluateExpression — this is what lets
// src/features/decorations.js support named, same-note-referenceable
// calculations (`` `total=1+2` `` then `` `=total*3` ``) on top of this
// otherwise-stateless evaluator, without the evaluator itself knowing
// anything about "notes" or "naming."
//
// Value types: a value flowing through this evaluator is a plain JS
// `number`, `string`, or `boolean` — no wrapper object. `typeof` is the type
// tag; nothing else needed one. String literals use `"..."` or `'...'`
// (with `\"`/`\'`/`\\` escapes); `true`/`false` are reserved literal
// keywords, checked in parsePrimary() BEFORE the env/constant lookup so a
// same-note cell can never be named "true"/"false" and silently shadow the
// literal (inlineCalc.js additionally rejects the name outright at
// definition time — see RESERVED_LITERAL_NAMES below). Every arithmetic
// operator (`+ - * / % ^`, unary `+ -`) requires number operands and fails
// with `#VALUE!` otherwise, with one deliberate exception: `+` between two
// strings concatenates, matching how every mainstream language overloads
// `+` for strings. Mixed-type `+` (string + number, boolean + anything) is
// NOT coerced — "honest silence over wrong guesses" means a clear `#VALUE!`
// beats a guessed `"3true"` or a silent `NaN`.
//
// Comparisons and booleans: `==`/`!=` compare across any types and never
// fail (different types are simply not equal — a meaningful, answerable
// question, unlike arithmetic on mismatched types). `> < >= <=` require
// both sides to be the *same* type, and that type must be number or string
// — booleans have no ordering (`#VALUE!`, not a guessed `false < true`).
// Comparisons are deliberately non-chaining: `1 < 2 < 3` parses only
// `1 < 2`, leaving `< 3` to fail honestly as a trailing token, rather than
// silently meaning something most users wouldn't expect. `and`/`or`/`not`
// are keywords (not `&&`/`||`/`!`), recognized structurally by parse
// position — like `true`/`false`, a cell can never be named one of them
// (see RESERVED_KEYWORD_NAMES). `and`/`or` evaluate both operands eagerly
// (no short-circuit) — that's a deliberate, bounded scope cut; reach for
// `if()` when a guard against an error in the untaken side is actually
// needed. `if(cond, thenValue, elseValue)` is the one construct that DOES
// truly short-circuit: the untaken branch's tokens are never even handed
// to a sub-parser (see parseIfCall()), so `if(x != 0, 10/x, 0)` never
// divides by zero when x is 0 — matching Excel's IF, not eager evaluation.
//
// Ranges: `Y<N>:Y<M>` (automatic cell labels only, never a name — only
// labels carry a guaranteed sequential document order) expands to every
// `Y<N>..Y<M>` value in `env`, but only as a function-call argument
// (`sum(Y1:Y5)`, `min(Y1:Y3, 10)`) — never as a standalone value. A range
// with no matching label (forward/out-of-range reference) fails `NAME`
// with that label as the identifier, the same shape any other unresolved
// identifier fails with, so inlineCalc.js's existing `Y<N>` → `#REF!`
// reclassification picks it up for free, no new logic needed there.

/**
 * @typedef {number|string|boolean} ScalarValue
 * @typedef {{ ok: true, value: ScalarValue } | { ok: false, code: string, error: string, identifier?: string, start?: number, end?: number }} EvalResult
 */

// Date/time functions reuse src/core/date.js's existing ISO-date machinery
// rather than reimplementing date math here — the same module
// queryExecutor.js/queryConditions.js already depend on for `!view`'s
// `as of`/date-field handling, so this is a precedented, not a new,
// dependency for the engine layer. A date in this evaluator is simply a
// canonical `YYYY-MM-DD` string — the same ScalarValue used everywhere else
// (no new value type), and the same format every frontmatter date field and
// query date comparison already uses throughout Yamlink. This is also why
// ordering comparisons (`> < >= <=`, already supported for same-type
// strings) just work on two date values with zero changes: ISO 8601's
// lexicographic string order already matches chronological order.
// Deliberately date-only, not date-TIME: there is no time-of-day or
// timezone convention anywhere else in Yamlink (confirmed by reading
// core/date.js itself) for this to interoperate with, so adding one here
// would be a standalone invention, not a real integration. A documented v1
// scope cut, not an oversight — `now()`-with-a-clock-time, date formatting
// beyond the existing canonical display, and month/weekday-name functions
// are all natural, bounded follow-ups if ever needed.
const { getTodayIsoLocal, addDaysIso, daysBetweenIso, normaliseDateInput } = require('../core/date');

/** @param {number[]} values @param {string} name @returns {number} */
function _sampleVariance(values, name) {
    if (values.length < 2) fail(ERROR_CODES.VALUE, `${name}() requires at least two values`);
    const mean = values.reduce((total, v) => total + v, 0) / values.length;
    const sumSq = values.reduce((total, v) => total + (v - mean) * (v - mean), 0);
    return sumSq / (values.length - 1);
}

/** @param {number[]} values @param {string} name @returns {number} */
function _populationVariance(values, name) {
    if (values.length === 0) fail(ERROR_CODES.VALUE, `${name}() requires at least one value`);
    const mean = values.reduce((total, v) => total + v, 0) / values.length;
    const sumSq = values.reduce((total, v) => total + (v - mean) * (v - mean), 0);
    return sumSq / values.length;
}

const FUNCTIONS = {
    sqrt: (a) => Math.sqrt(a),
    abs: (a) => Math.abs(a),
    round: (a) => Math.round(a),
    floor: (a) => Math.floor(a),
    ceil: (a) => Math.ceil(a),
    sum: (...args) => args.reduce((total, value) => total + value, 0),
    average: (...args) => {
        if (args.length === 0) fail(ERROR_CODES.VALUE, 'average() requires at least one argument');
        return args.reduce((total, value) => total + value, 0) / args.length;
    },
    min: (...args) => Math.min(...args),
    max: (...args) => Math.max(...args),

    // Statistics — all variadic, same shape as sum/average/min/max above
    // (works with `sum(Y1:Y5)`-style ranges for free, no new mechanism).
    // Deliberately NOT included in this pass: percentile/quartile (Excel's
    // own PERCENTILE/QUARTILE take a separate "which percentile" parameter
    // alongside the data — a genuinely different argument shape than every
    // other variadic function here, which this evaluator's flat
    // range-expands-into-args design has no clean way to express yet) and
    // correl/covariance (need two PARALLEL series — e.g. correl(Y1:Y3,
    // Y4:Y6) — but a range expands directly into the flat args array with
    // no marker for where one series ends and the next begins, so there's
    // no way to tell the two apart once expanded). Both are real,
    // acknowledged gaps, not quietly dropped — they need an actual array
    // value type to do honestly, which this evaluator doesn't have.
    median: (...args) => {
        if (args.length === 0) fail(ERROR_CODES.VALUE, 'median() requires at least one argument');
        const sorted = [...args].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    },
    // First value with the highest occurrence count, matching Excel's own
    // MODE (not simply "the smallest tied value" — first-encountered is
    // what spreadsheet users already expect). If every value is distinct,
    // there genuinely is no mode — an honest failure, not a guessed value
    // (same choice Excel's own #N/A makes here).
    mode: (...args) => {
        if (args.length === 0) fail(ERROR_CODES.VALUE, 'mode() requires at least one argument');
        const counts = new Map();
        for (const value of args) counts.set(value, (counts.get(value) || 0) + 1);
        let best = null, bestCount = 1;
        for (const value of args) {
            const count = counts.get(value);
            if (count > bestCount) { bestCount = count; best = value; }
        }
        if (best === null) fail(ERROR_CODES.VALUE, 'mode() found no repeated value — every argument is distinct');
        return best;
    },
    // Sample standard deviation / variance (n-1 denominator, matching
    // Excel's STDEV/VAR) — needs at least 2 values, since n-1 would
    // otherwise be zero. stdevp/variancep are the population versions (n
    // denominator, matching Excel's STDEVP/VARP), valid from a single value
    // (population variance of one point is honestly 0, not undefined).
    stdev: (...args) => Math.sqrt(_sampleVariance(args, 'stdev')),
    variance: (...args) => _sampleVariance(args, 'variance'),
    stdevp: (...args) => Math.sqrt(_populationVariance(args, 'stdevp')),
    variancep: (...args) => _populationVariance(args, 'variancep'),

    // Finance — standard time-value-of-money identities, matching Excel's
    // own FV/PV/PMT/NPV/IRR exactly (same formulas, same sign convention:
    // an outflow — money you pay or invest — and the resulting inflow are
    // opposite signs, the same way every spreadsheet and financial
    // calculator already works). Deliberately NOT replicated here: Excel's
    // optional `type` parameter (payments at the start vs. end of each
    // period) — every formula below assumes the far more common ordinary
    // annuity (payments at period end, Excel's own default when `type` is
    // omitted), a documented, bounded scope cut, not an oversight.
    //
    // `pv`/`fv` are optional in fv()/pv() respectively (Excel treats a
    // missing one as 0) — handled by checking `=== undefined` directly,
    // since a formula can simply write fewer arguments than the function
    // has parameters (the same way every other function here already
    // tolerates that; nothing new needed in the parser for this).
    fv: (rate, nper, pmt, pv) => {
        pv = pv === undefined ? 0 : pv;
        if (rate === 0) return -(pv + pmt * nper);
        const growth = Math.pow(1 + rate, nper);
        return -(pv * growth + pmt * (growth - 1) / rate);
    },
    pv: (rate, nper, pmt, fvValue) => {
        fvValue = fvValue === undefined ? 0 : fvValue;
        if (rate === 0) return -(fvValue + pmt * nper);
        const growth = Math.pow(1 + rate, nper);
        return -(fvValue + pmt * (growth - 1) / rate) / growth;
    },
    pmt: (rate, nper, pv, fvValue) => {
        fvValue = fvValue === undefined ? 0 : fvValue;
        if (rate === 0) return -(pv + fvValue) / nper;
        const growth = Math.pow(1 + rate, nper);
        return -(pv * growth + fvValue) * rate / (growth - 1);
    },
    // npv(rate, cf1, cf2, ...): the FIRST cash flow is discounted by one
    // full period, exactly like Excel's own NPV — not period 0. A cash
    // flow happening today (undiscounted) is added separately, outside
    // npv(), the same documented pattern Excel's own NPV help page
    // describes ("NPV(rate, cf1, cf2, ...) + cf0").
    npv: (rate, ...cashflows) => {
        if (cashflows.length === 0) fail(ERROR_CODES.VALUE, 'npv() requires at least one cash flow after the rate');
        return cashflows.reduce((total, cf, i) => total + cf / Math.pow(1 + rate, i + 1), 0);
    },
    // irr(cf0, cf1, ...): cf0 is period 0 (undiscounted — the initial
    // outlay, conventionally negative), cf1.. are discounted — the opposite
    // convention from npv() above, which is a real asymmetry, but it is
    // exactly Excel's own IRR/NPV asymmetry, not one invented here. No
    // closed-form solution exists in general, so this numerically searches
    // for the rate where NPV crosses zero via bisection over -99.9999% to
    // 1000% (a generous, bounded range covering every realistic rate), and
    // fails honestly — never returns a guessed or unstable number — when no
    // sign change exists anywhere in that range (e.g. all cash flows share
    // the same sign, so no real break-even rate exists).
    irr: (...cashflows) => {
        if (cashflows.length < 2) fail(ERROR_CODES.VALUE, 'irr() requires at least two cash flows (an initial outlay and at least one return)');
        const npvAt = (rate) => {
            let total = cashflows[0];
            for (let i = 1; i < cashflows.length; i++) total += cashflows[i] / Math.pow(1 + rate, i);
            return total;
        };
        let lo = -0.999999, hi = 10;
        let fLo = npvAt(lo), fHi = npvAt(hi);
        if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
            fail(ERROR_CODES.VALUE, 'Math error: irr() could not find a solution — cash flows must include both a negative and a positive value');
        }
        let mid = (lo + hi) / 2;
        for (let iter = 0; iter < 200; iter++) {
            mid = (lo + hi) / 2;
            const fMid = npvAt(mid);
            if (Math.abs(fMid) < 1e-7) break;
            if ((fLo < 0) === (fMid < 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
        }
        return mid;
    },

    // Growth — compound annual growth rate, the standard way to express a
    // multi-period change as one steady per-period rate.
    cagr: (beginning, ending, periods) => {
        if (beginning <= 0) fail(ERROR_CODES.VALUE, 'Math error: cagr() requires a positive beginning value');
        if (periods <= 0) fail(ERROR_CODES.VALUE, 'Math error: cagr() requires a positive number of periods');
        return Math.pow(ending / beginning, 1 / periods) - 1;
    },

    sin: (a) => Math.sin(a),
    cos: (a) => Math.cos(a),
    tan: (a) => Math.tan(a),
    log: (a) => Math.log10(a), // base 10 — matches Excel's LOG default
    ln: (a) => Math.log(a),    // natural log — matches Excel's LN
    sign: (a) => Math.sign(a),
    exp: (a) => Math.exp(a),

    // Date/time — see the header comment above the `require('../core/date')`
    // line for why these are date-only (no time-of-day), and why a date is
    // just a `YYYY-MM-DD` string, not a new value type. Listed in
    // RAW_ARG_FUNCTIONS below, since their arguments aren't all numbers —
    // every other function above goes through the universal assertNumber()
    // coercion in parsePrimary; these validate their own argument types
    // instead, failing the same typed way (`fail()`) everything else does.
    today: () => getTodayIsoLocal(),
    date: (y, m, d) => {
        if (typeof y !== 'number' || typeof m !== 'number' || typeof d !== 'number') {
            fail(ERROR_CODES.VALUE, 'Type mismatch: date(year, month, day) requires three numbers');
        }
        const iso = normaliseDateInput(`${y}-${m}-${d}`);
        if (!iso) fail(ERROR_CODES.VALUE, `Range invalid: ${y}-${m}-${d} is not a real calendar date`);
        return iso;
    },
    // b minus a, in whole days — "how many days from a until b" (positive
    // when b is later). Each argument is normalised through the same
    // forgiving parser every other date field in Yamlink already uses
    // (slashes, textual months, etc. all accepted, not just canonical
    // YYYY-MM-DD), consistent with how a frontmatter `date:` field is
    // treated everywhere else in the app.
    days_between: (a, b) => {
        if (typeof a !== 'string' || typeof b !== 'string') {
            fail(ERROR_CODES.VALUE, 'Type mismatch: days_between(date1, date2) requires two dates');
        }
        const isoA = normaliseDateInput(a);
        const isoB = normaliseDateInput(b);
        if (!isoA) fail(ERROR_CODES.VALUE, `Not found: "${a}" is not a recognizable date`);
        if (!isoB) fail(ERROR_CODES.VALUE, `Not found: "${b}" is not a recognizable date`);
        return daysBetweenIso(isoA, isoB);
    },
    add_days: (date, n) => {
        if (typeof date !== 'string') fail(ERROR_CODES.VALUE, 'Type mismatch: add_days(date, days) requires a date as the first argument');
        if (typeof n !== 'number') fail(ERROR_CODES.VALUE, 'Type mismatch: add_days(date, days) requires a number as the second argument');
        const iso = normaliseDateInput(date);
        if (!iso) fail(ERROR_CODES.VALUE, `Not found: "${date}" is not a recognizable date`);
        return addDaysIso(iso, n);
    },

    // Function-call syntax for and/or/not, alongside the infix keywords
    // (`a and b`, `not b`) parseAnd()/parseOr()/parseNot() already handle —
    // a pure alias, not a replacement. This works for free, with no new
    // parser branch: parsePrimary()'s function-call check (`peek().type ===
    // '('`) already runs BEFORE the RESERVED_KEYWORD_NAMES check that would
    // otherwise reject "and"/"or"/"not" as bare identifiers, so the instant
    // one of these is followed by "(", it resolves through this FUNCTIONS
    // lookup exactly like any other function call — confirmed by tracing
    // parsePrimary's actual dispatch order before adding this, not assumed.
    // The infix grammar is completely untouched; both `a and b` and
    // `and(a, b)` produce the identical result.
    //
    // Each local-consts the operands before combining them (not inline
    // `a && b`) for the same reason parseAnd()/parseOr() already do: JS's
    // own `&&`/`||` short-circuit, which would otherwise skip validating the
    // second operand's type whenever the first already determines the
    // result (e.g. `and(false, "x")` — a non-boolean right side should
    // still fail, not silently pass because the left side already made it
    // false).
    and: (a, b) => {
        const left = assertBoolean(a, 'and');
        const right = assertBoolean(b, 'and');
        return left && right;
    },
    or: (a, b) => {
        const left = assertBoolean(a, 'or');
        const right = assertBoolean(b, 'or');
        return left || right;
    },
    not: (a) => !assertBoolean(a, 'not')
};

// Functions whose arguments are NOT all numbers — date()/days_between()/
// add_days() (see above, each validates its own date/number argument types)
// and and()/or()/not() (boolean arguments) — an explicit, minimal allowlist
// rather than relaxing the default for every function, since forcing
// numeric args by default is exactly what gives sqrt/abs/sum/etc. their
// clear, consistent "requires a number" failure without each one
// re-implementing that check itself.
const RAW_ARG_FUNCTIONS = new Set(['date', 'days_between', 'add_days', 'and', 'or', 'not']);

// Conditional aggregates take a range as their first argument and a criterion
// (`">40"`, `"high"`, `"<>0"`) to decide which cells count. They need the
// range's cells kept together as a list, so they are parsed separately from
// the flat-argument functions above.
const CONDITIONAL_FUNCTIONS = new Set(['countif', 'sumif', 'averageif']);

const CRITERION_RE = /^(>=|<=|<>|=|>|<)?\s*([\s\S]*)$/;

function criterionMatches(value, criterion) {
    if (value === null || value === undefined) return false;
    let op = '=';
    let target = criterion;
    if (typeof criterion === 'string') {
        const parsed = CRITERION_RE.exec(criterion);
        op = parsed[1] || '=';
        target = parsed[2].trim();
        const asNumber = target !== '' && !Number.isNaN(Number(target)) ? Number(target) : null;
        if (asNumber !== null && typeof value === 'number') target = asNumber;
        else if (target === 'true' || target === 'false') target = target === 'true';
    }
    if (typeof target === 'number' && typeof value === 'number') {
        if (op === '=') return value === target;
        if (op === '<>') return value !== target;
        if (op === '>') return value > target;
        if (op === '<') return value < target;
        if (op === '>=') return value >= target;
        if (op === '<=') return value <= target;
        return false;
    }
    const left = String(value).toLowerCase();
    const right = String(target).toLowerCase();
    if (op === '=') return left === right;
    if (op === '<>') return left !== right;
    if (typeof value === 'string' && typeof target === 'string') {
        if (op === '>') return left > right;
        if (op === '<') return left < right;
        if (op === '>=') return left >= right;
        if (op === '<=') return left <= right;
    }
    return false;
}

function evaluateConditionalFunction(name, args, displayName, token) {
    const [range, criterion, extra] = args;
    if (!Array.isArray(range)) fail(ERROR_CODES.VALUE, `${displayName}: the first argument must be a range, like Y1:Y8 or a named range`, undefined, token);
    if (Array.isArray(criterion)) fail(ERROR_CODES.VALUE, `${displayName}: the criterion must be a single value`, undefined, token);
    const maxArgs = name === 'countif' ? 2 : 3;
    if (args.length < 2 || args.length > maxArgs) fail(ERROR_CODES.VALUE, `${displayName}: expects ${maxArgs === 2 ? '2' : '2 or 3'} arguments`, undefined, token);
    const matched = [];
    for (let i = 0; i < range.length; i++) if (criterionMatches(range[i], criterion)) matched.push(i);
    if (name === 'countif') return matched.length;
    const target = extra === undefined ? range : extra;
    if (!Array.isArray(target)) fail(ERROR_CODES.VALUE, `${displayName}: the third argument must be a range`, undefined, token);
    if (target.length !== range.length) fail(ERROR_CODES.VALUE, `${displayName}: the ranges must be the same size`, undefined, token);
    const numbers = matched.map((i) => target[i]).filter((v) => typeof v === 'number');
    if (name === 'sumif') return numbers.reduce((a, b) => a + b, 0);
    if (!numbers.length) fail(ERROR_CODES.DIV0, `${displayName}: no matching numeric cells`, undefined, token);
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

// Constants, not functions — a bare identifier (no call parens), resolved
// the same way a named cell is. A user's own env entry always wins if they
// define a variable with the same name (e.g. their own "e" in a physics
// note) — these are only a fallback, not reserved.
const CONSTANTS = {
    pi: Math.PI,
    e: Math.E
};

// Typed error codes, tagged onto every thrown error via `fail()` below so
// `evaluateExpression`'s catch block can surface a stable code alongside the
// human message — not just free text. `#REF!`/`#CYCLE!` (the two most
// Yamlink-specific of the five conventional spreadsheet codes) are NOT
// produced here: `#REF!` needs to know whether a failed identifier looks
// like a Yamlink cell label (`Y<N>`), which is inlineCalc.js's convention,
// not this evaluator's — see inlineCalc.js's reclassification of a `NAME`
// failure into `REF`. `#CYCLE!` is reserved for when cross-note references
// exist; the same-note-only, top-to-bottom env-threading this evaluator's
// only caller uses today makes a real cycle structurally impossible, so
// there's nothing to detect yet — not omitted by oversight.
const ERROR_CODES = { DIV0: 'DIV0', NAME: 'NAME', VALUE: 'VALUE' };
const CELL_RANGE_LABEL_RE = /^Y\d+$/;

// Reserved literal keywords — checked ahead of the env/constant lookup in
// parsePrimary() so a cell can never be named "true"/"false" and silently
// shadow the boolean literal. inlineCalc.js rejects the name outright at
// definition time using this same set (see RESERVED_LITERAL_NAMES export).
const RESERVED_LITERAL_NAMES = new Set(['true', 'false']);

// Reserved structural keywords — "and"/"or"/"not"/"if" are recognized at
// their own grammar levels (parseAnd/parseOr/parseNot/parsePrimary's `if(`
// special case below), never as ordinary identifiers, so — like true/false
// above — a cell can never be named one of these and be ambiguous with the
// keyword. Kept as a separate set from RESERVED_LITERAL_NAMES because the
// two are handled differently in parsePrimary: true/false resolve to a
// value there; reaching one of these as a bare, unconsumed identifier means
// it was used somewhere a keyword isn't valid (e.g. `` `=and` `` alone) and
// should fail with a keyword-specific message, not "unknown variable".
// inlineCalc.js's reserved-name rejection checks the union of both sets.
const RESERVED_KEYWORD_NAMES = new Set(['and', 'or', 'not', 'if']);

/**
 * @param {import('./mathExpr').ScalarValue} value @param {string} context
 * @returns {boolean}
 */
function assertBoolean(value, context) {
    if (typeof value !== 'boolean') {
        fail(ERROR_CODES.VALUE, `Type mismatch: "${context}" requires a boolean, got ${describeType(value)}`);
    }
    return /** @type {boolean} */ (value);
}

/**
 * `==`/`!=` never fail — comparing across types is a meaningful question
 * with an honest answer ("no, these aren't equal"), unlike arithmetic on
 * mismatched types, which is meaningless and stays a #VALUE!.
 * @param {import('./mathExpr').ScalarValue} a @param {import('./mathExpr').ScalarValue} b
 * @returns {boolean}
 */
function valuesEqual(a, b) {
    if (typeof a !== typeof b) return false;
    return a === b;
}

/**
 * Ordering (`> < >= <=`) requires both sides to be the *same* type, and
 * that type must be number or string — booleans have no ordering here (no
 * "false < true" guessing; be explicit with a comparison instead). Numbers
 * compare arithmetically, strings lexicographically (code-point order).
 * @param {string} op @param {import('./mathExpr').ScalarValue} a @param {import('./mathExpr').ScalarValue} b
 * @returns {boolean}
 */
function compareOrdering(op, a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        fail(ERROR_CODES.VALUE, `Type mismatch: booleans can't be ordered with "${op}"`);
    }
    if (typeof a !== typeof b) {
        fail(ERROR_CODES.VALUE, `Type mismatch: can't compare ${describeType(a)} and ${describeType(b)} with "${op}"`);
    }
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '>=') return a >= b;
    return a <= b;
}

/**
 * @param {string} code @param {string} message @param {string} [identifier]
 * @param {{start: number, end: number}} [at] A token (or token-shaped offset
 * pair) pinpointing where in the source text this failure happened, for
 * live editor diagnostics (see diagnostics.js). Only ever supplied at
 * syntax/name-resolution call sites, where the offending token is still
 * directly at hand — by the time a value reaches a type-check (assertNumber/
 * assertBoolean/addValues/compareOrdering) or a division, its original
 * source position has already been lost (this evaluator computes directly
 * as it parses, no separate AST to carry positions through); those failures
 * fall back to a whole-block range at the diagnostic layer instead. A
 * documented, bounded scope cut, not an oversight.
 */
function fail(code, message, identifier, at) {
    /** @type {Error & {code?: string, identifier?: string, start?: number, end?: number}} */
    const err = new Error(message);
    err.code = code;
    if (identifier !== undefined) err.identifier = identifier;
    if (at) { err.start = at.start; err.end = at.end; }
    throw err;
}

/** @param {import('./mathExpr').ScalarValue} value @returns {string} */
function describeType(value) {
    if (typeof value === 'string') return 'a string';
    if (typeof value === 'boolean') return 'a boolean';
    return 'a number';
}

/**
 * @param {import('./mathExpr').ScalarValue} value @param {string} context
 * @returns {number}
 */
function assertNumber(value, context) {
    if (typeof value !== 'number') {
        fail(ERROR_CODES.VALUE, `Type mismatch: "${context}" needs a number, got ${describeType(value)}`);
    }
    return /** @type {number} */ (value);
}

/**
 * `+` is the one operator that overloads across types: number+number adds,
 * string+string concatenates (matching every mainstream language's "+" for
 * strings). Every other mix is a clear #VALUE! — no coercion, so a formula
 * never silently produces "3true" or NaN.
 * @param {import('./mathExpr').ScalarValue} a @param {import('./mathExpr').ScalarValue} b
 * @returns {import('./mathExpr').ScalarValue}
 */
function addValues(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a + b;
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    fail(ERROR_CODES.VALUE, `Type mismatch: can't add ${describeType(a)} and ${describeType(b)}`);
}

// Every token carries its own `start`/`end` character offset within the
// string handed to tokenize() — used only for live diagnostic ranges (see
// fail()'s own comment above); the parser itself never reads these fields.
function tokenize(source) {
    const tokens = [];
    const text = String(source || '');
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '"' || ch === '\'') {
            const tokenStart = i;
            const quote = ch;
            let j = i + 1;
            let value = '';
            let closed = false;
            while (j < text.length) {
                const c = text[j];
                if (c === quote) { closed = true; j++; break; }
                if (c === '\\' && j + 1 < text.length && (text[j + 1] === quote || text[j + 1] === '\\')) {
                    value += text[j + 1];
                    j += 2;
                    continue;
                }
                value += c;
                j++;
            }
            if (!closed) fail(ERROR_CODES.VALUE, 'Syntax error: Unterminated string literal', undefined, { start: tokenStart, end: text.length });
            tokens.push({ type: 'str', value, start: tokenStart, end: j });
            i = j;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            const tokenStart = i;
            let j = i;
            while (j < text.length && /[0-9.]/.test(text[j])) j++;
            const raw = text.slice(i, j);
            if (!/^\d*\.?\d+$/.test(raw)) fail(ERROR_CODES.VALUE, `Syntax error: Invalid number "${raw}"`, undefined, { start: tokenStart, end: j });
            tokens.push({ type: 'num', value: Number(raw), start: tokenStart, end: j });
            i = j;
            continue;
        }
        if (/[a-zA-Z_]/.test(ch)) {
            const tokenStart = i;
            let j = i;
            while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
            tokens.push({ type: 'ident', value: text.slice(i, j), start: tokenStart, end: j });
            i = j;
            continue;
        }
        if (ch === '>' || ch === '<') {
            if (text[i + 1] === '=') { tokens.push({ type: ch + '=', value: ch + '=', start: i, end: i + 2 }); i += 2; continue; }
            tokens.push({ type: ch, value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === '=' && text[i + 1] === '=') { tokens.push({ type: '==', value: '==', start: i, end: i + 2 }); i += 2; continue; }
        if (ch === '!' && text[i + 1] === '=') { tokens.push({ type: '!=', value: '!=', start: i, end: i + 2 }); i += 2; continue; }
        if ('+-*/%^(),:'.includes(ch)) {
            tokens.push({ type: ch, value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        fail(ERROR_CODES.VALUE, `Syntax error: Unexpected character "${ch}"`, undefined, { start: i, end: i + 1 });
    }
    return tokens;
}

// Trace entry kinds pushed by createParser() when a `trace` array is
// supplied (see evaluateExpression()'s `collectTrace` option) — read by
// hover.js to render a step-by-step "how this resolved" breakdown without
// needing a separate AST. Deliberately bounded to the moments worth
// narrating: identifier/range-cell resolution, function calls, if()
// branch-taking, and comparisons. Plain arithmetic (+ - * / % ^) and
// and/or/not composition are NOT traced — a documented v1 scope cut, not an
// oversight: those are the "obvious" part of a formula (the reader already
// sees the operator and the two values beside it in the source text), while
// a reference resolving to a value or a function call folding several cells
// into one result is the part that actually benefits from being spelled out.
// Entries are pushed in true execution order (including inside a taken
// if()-branch sub-parse, since evaluateSubTokens() threads the same array
// through), so rendering them in order naturally reads top-to-bottom.
function createParser(tokens, env, trace, ranges) {
    let pos = 0;
    const peek = () => tokens[pos] || null;
    const next = () => tokens[pos++] || null;
    // Position to point a diagnostic at when there's no real token left to
    // blame (ran off the end of the expression) — the end of the last real
    // token in this call's own token list, or offset 0 for a genuinely empty
    // expression.
    const endOfSource = () => {
        const last = tokens[tokens.length - 1];
        return last ? { start: last.end, end: last.end } : { start: 0, end: 0 };
    };
    const expect = (type) => {
        const token = next();
        if (!token || token.type !== type) {
            fail(ERROR_CODES.VALUE, `Syntax error: Expected "${type}" but got "${token ? token.value : 'end of expression'}"`, undefined, token ? token : endOfSource());
        }
        return token;
    };

    const COMPARISON_OPS = new Set(['>', '<', '>=', '<=', '==', '!=']);

    // Precedence (low → high): or < and < not < comparison < expression
    // (arithmetic). "or"/"and"/"not" are recognized here as keywords, not in
    // the tokenizer — they arrive as ordinary 'ident' tokens (same as
    // true/false), matching this evaluator's existing pattern of resolving
    // keyword-ness structurally, by parse position, rather than by token
    // type. This is also exactly why a cell can never be named "and"/"or"/
    // "not"/"if": see RESERVED_KEYWORD_NAMES above.
    function parseOr() {
        let value = parseAnd();
        for (;;) {
            const token = peek();
            if (token && token.type === 'ident' && token.value.toLowerCase() === 'or') {
                next();
                const rhs = parseAnd();
                // Both sides are type-checked as separate statements, not
                // inline inside a JS "||" — JS's own short-circuiting would
                // otherwise skip assertBoolean(rhs, ...) whenever the left
                // side is already true, silently letting a non-boolean right
                // side (e.g. "true or 'x'") through uninspected.
                const left = assertBoolean(value, 'or');
                const right = assertBoolean(rhs, 'or');
                value = left || right;
            } else break;
        }
        return value;
    }

    function parseAnd() {
        let value = parseNot();
        for (;;) {
            const token = peek();
            if (token && token.type === 'ident' && token.value.toLowerCase() === 'and') {
                next();
                const rhs = parseNot();
                // See parseOr()'s comment above — same reasoning, mirrored.
                const left = assertBoolean(value, 'and');
                const right = assertBoolean(rhs, 'and');
                value = left && right;
            } else break;
        }
        return value;
    }

    function parseNot() {
        const token = peek();
        if (token && token.type === 'ident' && token.value.toLowerCase() === 'not') {
            next();
            return !assertBoolean(parseNot(), 'not');
        }
        return parseComparison();
    }

    // Deliberately non-chaining: "1 < 2 < 3" parses only "1 < 2" here, then
    // the leftover "< 3" surfaces as an honest "unexpected trailing token"
    // at the top level, rather than silently meaning something most users
    // wouldn't expect from a spreadsheet-style formula.
    function parseComparison() {
        const left = parseExpression();
        const token = peek();
        if (token && COMPARISON_OPS.has(token.type)) {
            next();
            const right = parseExpression();
            let result;
            if (token.type === '==') result = valuesEqual(left, right);
            else if (token.type === '!=') result = !valuesEqual(left, right);
            else result = compareOrdering(token.type, left, right);
            if (trace) trace.push({ kind: 'comparison', op: token.type, left, right, result });
            return result;
        }
        return left;
    }

    function parseExpression() {
        let value = parseTerm();
        for (;;) {
            const token = peek();
            if (token && (token.type === '+' || token.type === '-')) {
                next();
                const rhs = parseTerm();
                value = token.type === '+' ? addValues(value, rhs) : assertNumber(value, '-') - assertNumber(rhs, '-');
            } else break;
        }
        return value;
    }

    function parseTerm() {
        let value = parseUnary();
        for (;;) {
            const token = peek();
            if (token && (token.type === '*' || token.type === '/' || token.type === '%')) {
                next();
                const rhs = parseUnary();
                const lhsNum = assertNumber(value, token.type);
                const rhsNum = assertNumber(rhs, token.type);
                if (token.type === '*') value = lhsNum * rhsNum;
                else if (rhsNum === 0) fail(ERROR_CODES.DIV0, 'Math error: division by zero');
                else if (token.type === '/') value = lhsNum / rhsNum;
                else value = lhsNum % rhsNum;
            } else if (token && (token.type === '(' || token.type === 'num' ||
                (token.type === 'ident' && !RESERVED_KEYWORD_NAMES.has(token.value.toLowerCase())))) {
                // Implicit multiplication — "2(1+1)", "2sqrt(9)" — real
                // scientific/algebraic notation the user actually typed
                // (found via a live test case: `2+2(1+1/14)` failed with
                // "Unexpected trailing token (" before this was added).
                // Same precedence as explicit `*`, left-to-right. Excludes
                // "and"/"or"/"not"/"if": those are operators, not operands —
                // without this guard, "0 and x" misparses as "0 * and"
                // (an ordinary ident, as far as this check alone can tell),
                // swallowing the keyword instead of leaving it for parseAnd/
                // parseOr/parseNot to recognize as infix/prefix position.
                const rhs = parseUnary();
                value = assertNumber(value, '*') * assertNumber(rhs, '*');
            } else break;
        }
        return value;
    }

    function parseUnary() {
        const token = peek();
        if (token && token.type === '-') { next(); return -assertNumber(parseUnary(), 'unary -'); }
        if (token && token.type === '+') { next(); return assertNumber(parseUnary(), 'unary +'); }
        return parseExponent();
    }

    function parseExponent() {
        const base = parsePrimary();
        const token = peek();
        if (token && token.type === '^') {
            next();
            const exponent = parseUnary(); // right-associative: 2^3^2 = 2^(3^2)
            return Math.pow(assertNumber(base, '^'), assertNumber(exponent, '^'));
        }
        return base;
    }

    function parseArgs() {
        const args = parseArgumentValues();
        while (peek() && peek().type === ',') {
            next();
            args.push(...parseArgumentValues());
        }
        return args;
    }

    function parseArgumentValues() {
        if (isRangeArgumentAhead()) return parseRangeArgument();
        if (isNamedRangeAhead()) return parseNamedRangeValues();
        return [parseOr()];
    }

    function isNamedRangeAhead() {
        const start = tokens[pos];
        const after = tokens[pos + 1];
        return !!(
            start && start.type === 'ident' &&
            Object.prototype.hasOwnProperty.call(ranges, start.value) &&
            (!after || after.type === ',' || after.type === ')')
        );
    }

    function parseNamedRangeValues() {
        const token = next();
        return ranges[token.value].slice();
    }

    function parseConditionalArgument() {
        if (isRangeArgumentAhead()) return parseRangeValues();
        if (isNamedRangeAhead()) return parseNamedRangeValues();
        return parseOr();
    }

    function parseConditionalArgs() {
        const args = [parseConditionalArgument()];
        while (peek() && peek().type === ',') {
            next();
            args.push(parseConditionalArgument());
        }
        return args;
    }

    function isRangeArgumentAhead() {
        const start = tokens[pos];
        const colon = tokens[pos + 1];
        const end = tokens[pos + 2];
        return !!(
            start && colon && end &&
            start.type === 'ident' &&
            colon.type === ':' &&
            end.type === 'ident' &&
            CELL_RANGE_LABEL_RE.test(start.value) &&
            CELL_RANGE_LABEL_RE.test(end.value)
        );
    }

    function parseRangeArgument() {
        return parseRangeValues();
    }

    function parseRangeValues() {
        const startToken = next();
        expect(':');
        const endToken = next();
        const startLabel = startToken.value;
        const endLabel = endToken.value;
        const startNumber = Number(startLabel.slice(1));
        const endNumber = Number(endLabel.slice(1));
        if (endNumber < startNumber) {
            fail(ERROR_CODES.VALUE, `Range invalid: ${startLabel}:${endLabel} (end before start)`);
        }
        for (const label of [startLabel, endLabel]) {
            if (!Object.prototype.hasOwnProperty.call(env, label)) {
                fail(ERROR_CODES.NAME, `Not found: no variable named "${label}"`, label);
            }
        }
        const values = [];
        for (let i = startNumber; i <= endNumber; i++) {
            const label = `Y${i}`;
            if (!Object.prototype.hasOwnProperty.call(env, label)) {
                fail(ERROR_CODES.NAME, `Not found: no variable named "${label}"`, label);
            }
            const value = env[label];
            if (trace) trace.push({ kind: 'ref', name: label, value });
            values.push(value);
        }
        return values;
    }

    function parsePrimary() {
        const token = next();
        if (!token) fail(ERROR_CODES.VALUE, 'Syntax error: Unexpected end of expression', undefined, endOfSource());
        if (token.type === 'num') return token.value;
        if (token.type === 'str') return token.value;
        if (token.type === '(') {
            // parseOr(), not parseExpression() — a parenthesized group must
            // be transparent to the FULL grammar (comparisons, and/or/not),
            // not just arithmetic. Using parseExpression() here was a real,
            // previously-unreported bug: it silently made every parenthesized
            // sub-expression arithmetic-only, so `(total > 1000) and (count
            // < 5)` or `not (total > 1000)` failed with a confusing "Expected
            // ')'" syntax error the moment the parser hit the comparison
            // operator inside the parens — comparisons/booleans only ever
            // worked unparenthesized at the top level before this fix.
            const value = parseOr();
            expect(')');
            return value;
        }
        if (token.type === 'ident') {
            const name = token.value;
            const literalName = name.toLowerCase();
            if (literalName === 'if' && peek() && peek().type === '(') {
                return parseIfCall();
            }
            if (peek() && peek().type === '(' && CONDITIONAL_FUNCTIONS.has(literalName)) {
                next();
                const args = peek() && peek().type === ')' ? [] : parseConditionalArgs();
                expect(')');
                const result = evaluateConditionalFunction(literalName, args, name, token);
                if (trace) trace.push({ kind: 'call', name: literalName, args, result });
                return result;
            }
            if (peek() && peek().type === '(') {
                const fn = FUNCTIONS[literalName];
                if (!fn) fail(ERROR_CODES.NAME, `Not found: no function named "${name}"`, name, token);
                next();
                const args = peek() && peek().type === ')' ? [] : parseArgs();
                expect(')');
                const callArgs = RAW_ARG_FUNCTIONS.has(literalName) ? args : args.map((arg) => assertNumber(arg, name));
                const result = fn(...callArgs);
                if (trace) trace.push({ kind: 'call', name: literalName, args: callArgs, result });
                return result;
            }
            if (RESERVED_LITERAL_NAMES.has(literalName)) return literalName === 'true';
            if (RESERVED_KEYWORD_NAMES.has(literalName)) {
                fail(ERROR_CODES.VALUE, `Name reserved: "${name}" is a keyword and must be used as part of an expression (e.g. "a ${literalName} b")`, undefined, token);
            }
            if (Object.prototype.hasOwnProperty.call(env, name)) {
                const value = env[name];
                if (trace) trace.push({ kind: 'ref', name, value });
                return value;
            }
            const constantKey = literalName;
            if (Object.prototype.hasOwnProperty.call(CONSTANTS, constantKey)) return CONSTANTS[constantKey];
            fail(ERROR_CODES.NAME, `Not found: no variable named "${name}"`, name, token);
        }
        fail(ERROR_CODES.VALUE, `Syntax error: Unexpected token "${token.value}"`, undefined, token);
    }

    /**
     * `if(cond, thenValue, elseValue)` is not a plain FUNCTIONS entry because
     * it must short-circuit — evaluating BOTH branches eagerly (the way
     * every ordinary function call already does) would defeat its most
     * common real use, a guard like `if(x != 0, 10/x, 0)`: the untaken
     * branch would still throw. Since this parser evaluates directly as it
     * parses (no separate AST), true short-circuiting means never handing
     * the untaken branch's tokens to a sub-parser at all — done here via a
     * cheap paren/comma-depth pre-scan that locates the three argument
     * spans without evaluating anything, then evaluating only the taken one.
     * A nested call's own commas (`if(x>0, sum(Y1,Y2), 0)`) are naturally
     * skipped because they sit at depth > 0; a string literal's internal
     * characters are already opaque by this point (a single 'str' token),
     * so this is safe without any string-aware special-casing.
     * @returns {import('./mathExpr').ScalarValue}
     */
    function parseIfCall() {
        // The 'if' ident was already consumed by parsePrimary() before this
        // was called — only the '(' remains to be consumed here.
        expect('(');
        const condStart = pos;
        let depth = 0;
        let firstComma = -1;
        let secondComma = -1;
        let closeIdx = -1;
        for (let i = pos; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type === '(') depth++;
            else if (t.type === ')') {
                if (depth === 0) { closeIdx = i; break; }
                depth--;
            } else if (t.type === ',' && depth === 0) {
                if (firstComma === -1) firstComma = i;
                else if (secondComma === -1) secondComma = i;
            }
        }
        if (closeIdx === -1 || firstComma === -1 || secondComma === -1) {
            fail(ERROR_CODES.VALUE, 'Syntax error: if() requires exactly 3 arguments: condition, then-value, else-value');
        }
        const condTokens = tokens.slice(condStart, firstComma);
        const thenTokens = tokens.slice(firstComma + 1, secondComma);
        const elseTokens = tokens.slice(secondComma + 1, closeIdx);
        pos = closeIdx + 1; // advance past the whole if(...) call, untaken branch never parsed further than this

        const condValue = evaluateSubTokens(condTokens, 'if() condition');
        if (typeof condValue !== 'boolean') {
            fail(ERROR_CODES.VALUE, 'Syntax error: if() condition must be a boolean — use a comparison like "x > 0"');
        }
        const branch = condValue ? 'then' : 'else';
        const result = condValue
            ? evaluateSubTokens(thenTokens, 'if() then-branch')
            : evaluateSubTokens(elseTokens, 'if() else-branch');
        if (trace) trace.push({ kind: 'if', condition: condValue, branch, result });
        return result;
    }

    /** @param {Array<object>} subTokens @param {string} context @returns {import('./mathExpr').ScalarValue} */
    function evaluateSubTokens(subTokens, context) {
        if (!subTokens.length) fail(ERROR_CODES.VALUE, `Syntax error: ${context} is empty`);
        return createParser(subTokens, env, trace).parse();
    }

    return {
        parse() {
            const value = parseOr();
            if (pos < tokens.length) {
                fail(ERROR_CODES.VALUE, `Syntax error: Unexpected trailing token "${tokens[pos].value}"`, undefined, tokens[pos]);
            }
            return value;
        }
    };
}

/**
 * Evaluate a bounded arithmetic expression, optionally against an
 * environment of previously-named values (see decorations.js's same-note
 * `` `name=expr` `` references). Never throws — always returns a tagged
 * result so callers can render an honest error state instead of a silently
 * wrong number or a crash. On failure, `code` is one of `'DIV0'`, `'NAME'`,
 * or `'VALUE'` (see the `ERROR_CODES` comment above `fail()` for why `REF`
 * and `CYCLE` aren't produced here); `identifier` is set only for a `NAME`
 * failure, carrying the exact unresolved function/variable name so a caller
 * that understands a naming convention this evaluator doesn't (e.g.
 * inlineCalc.js's `Y<N>` cell labels) can reclassify it without re-parsing
 * the human message.
 * `options.collectTrace: true` additionally collects a step-by-step trace of
 * every identifier/range-cell resolution, function call, if() branch taken,
 * and comparison, in true execution order, attached as `trace` on the
 * returned result (present whether evaluation ultimately succeeds or fails —
 * a partial trace up to the failure point is still useful context). Omitted
 * by default so the hot ghost-text/diagnostics path (decorations.js, called
 * on every keystroke) pays zero cost for data only hover.js's inspector
 * card actually renders — see createParser()'s own comment for which
 * moments are traced and why plain arithmetic/and/or/not are deliberately
 * left out.
 * @param {string} source
 * @param {Record<string, ScalarValue>} [env]
 * @param {{ collectTrace?: boolean, ranges?: Record<string, ScalarValue[]> }} [options]
 * @returns {EvalResult}
 */
function evaluateExpression(source, env = {}, options = {}) {
    const raw = String(source || '');
    // fail()'s token offsets are relative to `trimmed` (what tokenize() runs
    // against), so a diagnostic that locates a span in `source` itself needs
    // this correction added back — otherwise every reported offset would be
    // shifted left by exactly the amount of leading whitespace trimmed off.
    const leadingTrim = raw.length - raw.trimStart().length;
    const trace = options.collectTrace ? [] : null;
    try {
        const trimmed = raw.trim();
        if (!trimmed) return { ok: false, code: ERROR_CODES.VALUE, error: 'Syntax error: Empty expression' };
        const tokens = tokenize(trimmed);
        if (!tokens.length) return { ok: false, code: ERROR_CODES.VALUE, error: 'Syntax error: Empty expression' };
        const value = createParser(tokens, env || {}, trace, options.ranges || {}).parse();
        if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, code: ERROR_CODES.VALUE, error: 'Math error: Result is not a finite number', ...(trace ? { trace } : {}) };
        return { ok: true, value, ...(trace ? { trace } : {}) };
    } catch (err) {
        const code = err && err.code ? err.code : ERROR_CODES.VALUE;
        const identifier = err && err.identifier;
        const error = err && err.message ? err.message : 'Syntax error: Invalid expression';
        /** @type {{ok: false, code: string, error: string, identifier?: string, start?: number, end?: number, trace?: object[]}} */
        const result = { ok: false, code, error };
        if (identifier !== undefined) result.identifier = identifier;
        if (err && typeof err.start === 'number' && typeof err.end === 'number') {
            result.start = err.start + leadingTrim;
            result.end = err.end + leadingTrim;
        }
        if (trace) result.trace = trace;
        return result;
    }
}

/** @param {string} name @returns {boolean} */
function isReservedFunctionName(name) {
    const literal = String(name || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(FUNCTIONS, literal) || CONDITIONAL_FUNCTIONS.has(literal);
}

module.exports = { evaluateExpression, isReservedFunctionName, CONDITIONAL_FUNCTIONS, RESERVED_LITERAL_NAMES, RESERVED_KEYWORD_NAMES, ERROR_CODES };
