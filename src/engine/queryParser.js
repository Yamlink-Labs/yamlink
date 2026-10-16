'use strict';

const {
    TASK_PRESETS,
    resolveSimpleViewAlias,
    parseCondition,
    parseWhereGroup,
    classifyScalarValue,
    resolveQueryFunctionValue,
    parseScalarQueryValue,
    compareScalarValues,
    normaliseField
} = require('./queryConditions');

/**
 * @param {string[]} lines
 * @returns {import('./queryConditions').ParsedQuery|null}
 */
function parseSingleViewBlock(lines) {
    if (!lines || lines.length === 0) return null;

    const firstLine = lines[0].trim();
    if (!firstLine.startsWith('!view ')) return null;

    let rest = firstLine.slice(6).trim();
    let label = null;

    const pipeIdx = rest.indexOf('|');
    if (pipeIdx !== -1) {
        label = rest.slice(pipeIdx + 1).trim() || null;
        rest = rest.slice(0, pipeIdx).trim();
    }

    let incoming = false;
    if (rest.startsWith('incoming ') || rest === 'incoming') {
        incoming = true;
        rest = rest.slice('incoming'.length).trim();
    }

    let type = '*';
    let preset = null;
    let shorthand = null;
    if (rest !== '*' && !rest.startsWith('* ')) {
        const typeMatch = rest.match(/^([\w-]+)/);
        if (!typeMatch) return null;
        const alias = resolveSimpleViewAlias(typeMatch[1]);
        if (alias) {
            type = alias.type;
            preset = alias.preset;
            shorthand = alias.shorthand;
        } else {
            type = typeMatch[1].toLowerCase();
        }
        rest = rest.slice(typeMatch[1].length).trim();
        if (!preset) {
            const presetMatch = rest.match(/^(today|upcoming|calendar|agenda)\b/i);
            if (presetMatch) {
                preset = presetMatch[1].toLowerCase() === 'agenda' ? 'upcoming' : presetMatch[1].toLowerCase();
                shorthand = presetMatch[1].toLowerCase();
                rest = rest.slice(presetMatch[1].length).trim();
            }
        }
    } else if (rest.startsWith('* ')) {
        rest = rest.slice(2).trim();
    } else {
        rest = '';
    }

    const clauseLines = [rest];
    for (let i = 1; i < lines.length; i++) clauseLines.push(lines[i].trim());
    const clauseText = clauseLines.join(' ').trim();

    let select = null;
    const selectMatch = clauseText.match(/\bselect\s+([\w,\s.-]+?)(?=\s+where\b|\s+sort\b|\s+limit\b|\s+via\b|\s+group\b|\s+aggregate\b|\s+linked_to\b|\s+linked_from\b|$)/i);
    if (selectMatch) {
        select = selectMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (select.length === 0) select = null;
    }

    // `asc` is accepted but never changes behavior — ascending is already the
    // default when no direction keyword is present at all. Both must be
    // matched explicitly here (not just `desc`): leaving `asc` out of this
    // alternation doesn't make it an error, it makes the WHOLE clause fail to
    // match at all — `[\w.-]+` greedily consumes "date", the optional
    // `(\s+desc)?` group can't match literal " asc" so it matches zero times,
    // and the lookahead then has " asc" immediately after the field with
    // nothing left to consume it, so the entire regex fails silently (no
    // parse warning either, since this is a non-match, not a malformed one) —
    // `sort date asc` and `sort name asc` previously produced `sort: null`
    // with zero indication anything was wrong, found via real sample-vault
    // content, not a bug report.
    let sort = null;
    const sortMatch = clauseText.match(/\bsort\s+([\w.-]+)(\s+(?:asc|desc))?(?=\s+(?:limit|group|aggregate)\b|$)/i);
    if (sortMatch) sort = { field: sortMatch[1].toLowerCase(), desc: /desc/i.test(sortMatch[2] || '') };

    let limit = null;
    const limitMatch = clauseText.match(/\blimit\s+(\d+)/i);
    if (limitMatch) limit = parseInt(limitMatch[1], 10);

    let via = null;
    const viaMatch = clauseText.match(/\bvia\s+([\w-]+)/i);
    if (viaMatch) via = viaMatch[1].toLowerCase();

    // VQL v1: graph traversal clauses. `linked_to [[x]]` means "this row has
    // an outbound edge to x" (row is the source); `linked_from [[x]]` means
    // "x has an outbound edge to this row" (row is the target). An optional
    // trailing `within N` extends either clause transitively up to N hops
    // in the same direction (union of hops 1..N, not just exactly hop N).
    // Omitting `within` behaves exactly as single-hop v1 did — depth
    // defaults to 1, never null, so downstream code has one path. Capped at
    // 5; anything outside 1-5 is a parse warning, not a crash or a silent
    // clamp. Temporal clauses remain a real follow-up, not this pass.
    // Reuses the same [[id]] syntax wikilinks already use, resolved against
    // the plain id (no alias resolution in v1 — a known, stated limitation).
    const MAX_TRAVERSAL_DEPTH = 5;

    function parseTraversalDepth(withinRaw, clauseLabel, warnings) {
        if (withinRaw === undefined) return 1;
        const depth = parseInt(withinRaw, 10);
        if (!Number.isFinite(depth) || depth < 1 || depth > MAX_TRAVERSAL_DEPTH) {
            warnings.push(`"${clauseLabel} within ${withinRaw}" is out of range (1-${MAX_TRAVERSAL_DEPTH}) — ignoring "within", using a single hop.`);
            return 1;
        }
        return depth;
    }

    const traversalWarnings = [];

    let linkedTo = null;
    let linkedToDepth = 1;
    const linkedToMatch = clauseText.match(/\blinked_to\s+\[\[([^\]]+)\]\](?:\s+within\s+(\d+))?/i);
    if (linkedToMatch) {
        linkedTo = linkedToMatch[1].trim();
        linkedToDepth = parseTraversalDepth(linkedToMatch[2], 'linked_to', traversalWarnings);
    }

    let linkedFrom = null;
    let linkedFromDepth = 1;
    const linkedFromMatch = clauseText.match(/\blinked_from\s+\[\[([^\]]+)\]\](?:\s+within\s+(\d+))?/i);
    if (linkedFromMatch) {
        linkedFrom = linkedFromMatch[1].trim();
        linkedFromDepth = parseTraversalDepth(linkedFromMatch[2], 'linked_from', traversalWarnings);
    }

    let groupBy = null;
    const groupByMatch = clauseText.match(/\bgroup\s+by\s+([\w-]+)(?=\s+(?:sort|limit|aggregate)\b|$)/i);
    if (groupByMatch) groupBy = groupByMatch[1].toLowerCase();

    // VQL v1: `aggregate` clause. Computes fold(s) over the full where-filtered
    // (and, if present, group-bucketed) row set — sum/average/min/max/count of a
    // numeric field, or bare row count. Independent of `limit`: aggregates
    // summarize everything matched, `limit` only trims what's *displayed*
    // (mirrors how `group by`'s own `limit` already only trims which *groups*
    // are shown, not the rows counted into each group). Multiple terms are
    // comma-separated, each named via a required `as <alias>` (except bare
    // `count`, whose alias defaults to "count"). `avg` is accepted as an alias
    // for `average` and canonicalised to it here so the rest of the pipeline
    // only ever sees one spelling.
    const parseWarnings = [...traversalWarnings];
    let aggregate = null;
    const AGGREGATE_TERM_RE = /\b(sum|average|avg|min|max|count)\s*(?:\(\s*([\w.-]+)\s*\))?\s*(?:\bas\s+([\w-]+))?/gi;
    const aggregateClauseMatch = clauseText.match(/\baggregate\s+([^\n]+?)(?=\s+where\b|\s+sort\b|\s+limit\b|\s+via\b|\s+group\b|\s+linked_to\b|\s+linked_from\b|\s+as\s+of\b|$)/i);
    if (aggregateClauseMatch) {
        const termsText = aggregateClauseMatch[1];
        const terms = [];
        const termParts = termsText.split(',').map(s => s.trim()).filter(Boolean);
        for (const rawPart of termParts) {
            // `sum(cell.cost) when priority = high as high_cost` — only the
            // rows matching the condition are folded into this term.
            const whenMatch = /^(.*?)\s+when\s+(.+?)\s+as\s+([\w-]+)$/i.exec(rawPart);
            let part = rawPart;
            let whenCond = null;
            let whenText = null;
            if (whenMatch) {
                whenText = whenMatch[2].trim();
                whenCond = parseCondition(whenText);
                if (!whenCond) {
                    parseWarnings.push(`Could not understand the "when" condition in aggregate term "${rawPart}".`);
                    continue;
                }
                part = `${whenMatch[1]} as ${whenMatch[3]}`;
            }
            AGGREGATE_TERM_RE.lastIndex = 0;
            const m = AGGREGATE_TERM_RE.exec(part);
            if (!m) {
                parseWarnings.push(`Could not understand aggregate term: "${part}".`);
                continue;
            }
            let fn = m[1].toLowerCase();
            if (fn === 'avg') fn = 'average';
            const field = m[2] ? m[2].toLowerCase() : null;
            if (fn !== 'count' && !field) {
                parseWarnings.push(`Aggregate function "${fn}" needs a field, e.g. "${fn}(cell.total)".`);
                continue;
            }
            let alias = m[3] ? m[3].toLowerCase() : null;
            if (!alias) {
                if (fn === 'count') alias = 'count';
                else {
                    parseWarnings.push(`Aggregate term "${part.trim()}" needs an alias, e.g. "${part.trim()} as total".`);
                    continue;
                }
            }
            terms.push({ fn, field, alias, ...(whenCond ? { when: whenCond, whenText } : {}) });
        }
        if (terms.length > 0) aggregate = terms;
    }

    // VQL v1: temporal clause. `as of <date>` reconstructs the vault's
    // frontmatter fields as they stood at that point in time (via the Time
    // Engine's existing reconstructVaultAtTime() — no new reconstruction
    // logic, this is new surfacing of it). Accepts the same date vocabulary
    // where clauses already do: a literal date or a function call
    // (today(), days-ago(7), etc.) — resolved once here via
    // parseScalarQueryValue, the same resolver where clauses use. Computed/
    // virtual fields (_inbound_count, file.created, etc.) are NOT
    // reconstructed — a stated limitation, not an oversight; they still
    // reflect current values under `as of`. Does not apply to `incoming`
    // queries or to linked_to/linked_from traversal in this pass.
    let asOf = null;
    const asOfMatch = clauseText.match(/\bas\s+of\s+([a-z][\w-]*\([^)]*\)|\S+)/i);
    if (asOfMatch) {
        const resolved = parseScalarQueryValue(asOfMatch[1]);
        asOf = resolved.value || null;
    }

    const wheres = [];
    const whereGroups = [];
    const whereBlocks = clauseText.match(/\bwhere\s+(?:(?!\b(?:where|sort|limit|select|via|group|aggregate|linked_to|linked_from|as\s+of)\b).)+/gi) || [];
    for (const block of whereBlocks) {
        const condText = block.replace(/^where\s+/i, '').trim();
        const parts = condText.split(/\s+and\s+(?=(?:[\w*.-]+\s+(?:contains\b|=|!=|>=|<=|>|<|\bis\b|\bexists\b)|#[A-Za-z][\w-]*))/i);
        for (const part of parts) {
            const group = parseWhereGroup(part.trim());
            if (group?.conditions?.length) {
                if (group.warning) parseWarnings.push(group.warning);
                whereGroups.push(group.conditions);
                wheres.push(...group.conditions);
            } else if (part.trim()) {
                parseWarnings.push(`Could not understand where clause: "${part.trim()}".`);
            }
        }
    }

    return { type, incoming, via, linkedTo, linkedToDepth, linkedFrom, linkedFromDepth, asOf, select, wheres, whereGroups, where: wheres[0] ?? null, sort, limit, label, preset, shorthand, groupBy, aggregate, parseWarnings };
}

/**
 * @param {string} text
 * @returns {import('./queryConditions').ParsedQuery[]|null}
 */
function parseAllViewQueries(text) {
    const queries = [];
    const lines = text.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.startsWith('!view ')) {
            const block = [lines[i]];
            let j = i + 1;
            while (j < lines.length) {
                const next = lines[j].trim();
                if (!next.length) break;
                if (next.startsWith('!view ')) break;
                if (/^(?:select|where|sort|limit|via|group|aggregate)\b/i.test(next)) {
                    block.push(lines[j]);
                    j++;
                } else {
                    break;
                }
            }
            const q = parseSingleViewBlock(block);
            if (q) queries.push(q);
            i = j;
        } else {
            i++;
        }
    }

    return queries.length > 0 ? queries : null;
}

/** @param {string} line @returns {import('./queryConditions').ParsedQuery|null} */
function parseSingleViewLine(line) { return parseSingleViewBlock([line]); }

/** @param {string} text @returns {import('./queryConditions').ParsedQuery|null} */
function parseViewQuery(text) { const all = parseAllViewQueries(text); return all ? all[0] : null; }

/**
 * @param {import('./queryConditions').ParsedQuery} query
 * @returns {string}
 */
function buildQueryString(query) {
    const prefix = query.incoming ? 'incoming ' : '';
    let head = query.type;
    if (!query.incoming && query.type === 'tasks' && query.shorthand && (!query.select || query.select.length === 0) && !query.via) {
        head = query.shorthand;
    } else if (!query.incoming && query.type === 'tasks' && query.preset) {
        head = query.preset;
    }
    let s = '!view ' + prefix + head;
    if (!query.shorthand && query.type === 'tasks' && query.preset) s += ' ' + query.preset;
    if (query.label) s += ' | ' + query.label;
    if (query.via) s += ' via ' + query.via;
    if (query.linkedTo) {
        s += ' linked_to [[' + query.linkedTo + ']]';
        if (query.linkedToDepth && query.linkedToDepth !== 1) s += ' within ' + query.linkedToDepth;
    }
    if (query.linkedFrom) {
        s += ' linked_from [[' + query.linkedFrom + ']]';
        if (query.linkedFromDepth && query.linkedFromDepth !== 1) s += ' within ' + query.linkedFromDepth;
    }
    if (query.asOf) s += ' as of ' + query.asOf;
    if (query.select) s += '\nselect ' + query.select.join(', ');
    const whereGroups = query.whereGroups && query.whereGroups.length > 0
        ? query.whereGroups
        : ((query.wheres && query.wheres.length > 0)
            ? query.wheres.map((condition) => [condition])
            : (query.where ? [[query.where]] : []));
    const opSymbol = { gte: '>=', lte: '<=', gt: '>', lt: '<' };
    const stringifyWhere = (w) => {
        if (w.tagShorthand || w.field === '__yamlink_tags') {
            return '#' + w.value;
        }
        const scalarValue = w.valueSource || w.value;
        let clause = w.field + ' ';
        if (w.op === 'contains') {
            clause += 'contains ' + w.value;
        } else if (w.op === 'empty') {
            clause += 'is empty';
        } else if (w.op === 'exists') {
            clause += 'exists';
        } else if (w.op === 'neq') {
            clause += w.valueKind === 'relation' ? `!= [[${w.value}]]` : `!= ${scalarValue}`;
        } else if (w.op === 'in') {
            clause += '= ' + (w.values || [w.value]).join(' or ');
        } else if (opSymbol[w.op]) {
            clause += opSymbol[w.op] + ' ' + scalarValue;
        } else if (w.valueKind === 'relation') {
            clause += '= [[' + w.value + ']]';
        } else if (w.valueKind === 'string' && /\s/.test(scalarValue)) {
            clause += '= "' + scalarValue + '"';
        } else {
            clause += '= ' + scalarValue;
        }
        return clause;
    };
    for (const group of whereGroups) {
        if (!group || !group.length) continue;
        s += '\nwhere ' + group.map(stringifyWhere).join(' or ');
    }
    if (query.groupBy) s += '\ngroup by ' + query.groupBy;
    if (query.aggregate && query.aggregate.length > 0) {
        const stringifyAggTerm = (t) => {
            const when = t.whenText ? ` when ${t.whenText}` : '';
            if (t.fn === 'count' && !t.field) {
                if (!when && t.alias === 'count') return 'count';
                return `count${when} as ${t.alias}`;
            }
            return `${t.fn}(${t.field})${when} as ${t.alias}`;
        };
        s += '\naggregate ' + query.aggregate.map(stringifyAggTerm).join(', ');
    }
    if (query.sort) s += '\nsort ' + query.sort.field + (query.sort.desc ? ' desc' : '');
    if (query.limit) s += '\nlimit ' + query.limit;
    return s;
}

module.exports = {
    TASK_PRESETS,
    classifyScalarValue,
    resolveQueryFunctionValue,
    parseScalarQueryValue,
    compareScalarValues,
    normaliseField,
    parseCondition,
    parseWhereGroup,
    parseSingleViewBlock,
    parseAllViewQueries,
    parseSingleViewLine,
    parseViewQuery,
    buildQueryString
};
