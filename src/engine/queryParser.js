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
    const selectMatch = clauseText.match(/\bselect\s+([\w,\s.-]+?)(?=\s+where\b|\s+sort\b|\s+limit\b|\s+via\b|\s+group\b|$)/i);
    if (selectMatch) {
        select = selectMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (select.length === 0) select = null;
    }

    let sort = null;
    const sortMatch = clauseText.match(/\bsort\s+([\w.-]+)(\s+desc)?(?=\s+(?:limit|group)\b|$)/i);
    if (sortMatch) sort = { field: sortMatch[1].toLowerCase(), desc: !!sortMatch[2] };

    let limit = null;
    const limitMatch = clauseText.match(/\blimit\s+(\d+)/i);
    if (limitMatch) limit = parseInt(limitMatch[1], 10);

    let via = null;
    const viaMatch = clauseText.match(/\bvia\s+([\w-]+)/i);
    if (viaMatch) via = viaMatch[1].toLowerCase();

    let groupBy = null;
    const groupByMatch = clauseText.match(/\bgroup\s+by\s+([\w-]+)(?=\s+(?:sort|limit)\b|$)/i);
    if (groupByMatch) groupBy = groupByMatch[1].toLowerCase();

    const wheres = [];
    const whereGroups = [];
    const parseWarnings = [];
    const whereBlocks = clauseText.match(/\bwhere\s+(?:(?!\b(?:where|sort|limit|select|via|group)\b).)+/gi) || [];
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

    return { type, incoming, via, select, wheres, whereGroups, where: wheres[0] ?? null, sort, limit, label, preset, shorthand, groupBy, parseWarnings };
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
                if (/^(?:select|where|sort|limit|via|group)\b/i.test(next)) {
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
