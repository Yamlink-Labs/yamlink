// src/engine/query.js
// Pure query engine — no VS Code, no fs writes, no HTML
// Importable by extension, desktop app, or tests

const { getIndex, getFieldsCache } = require('../core/index');

// ─────────────────────────────────────────────────────────────────
// parseSingleViewBlock
// Parses a block of lines starting with !view into a query object.
// A block is the !view line plus any immediately following lines
// that contain select / where / sort clauses (no blank lines between).
//
// Supported syntax:
//   !view contact
//   select name, email, account
//   where account = [[acme]]
//   sort name
//
// All clauses are optional and order-independent after the !view line.
// ─────────────────────────────────────────────────────────────────
function parseSingleViewBlock(lines) {
    if (!lines || lines.length === 0) return null;

    const firstLine = lines[0].trim();
    if (!firstLine.startsWith('!view ')) return null;

    let rest  = firstLine.slice(6).trim();
    let label = null;

    const pipeIdx = rest.indexOf('|');
    if (pipeIdx !== -1) {
        label = rest.slice(pipeIdx + 1).trim() || null;
        rest  = rest.slice(0, pipeIdx).trim();
    }

    // Determine type (first token after !view)
    let type = '*';
    if (rest !== '*' && !rest.startsWith('* ')) {
        const typeMatch = rest.match(/^([\w-]+)/);
        if (!typeMatch) return null;
        type = typeMatch[1].toLowerCase();
        rest = rest.slice(type.length).trim();
    } else if (rest.startsWith('* ')) {
        rest = rest.slice(2).trim();
    } else {
        rest = '';
    }

    // Collect all clause text: remainder of !view line + continuation lines
    const clauseLines = [rest];
    for (let i = 1; i < lines.length; i++) {
        clauseLines.push(lines[i].trim());
    }
    const clauseText = clauseLines.join(' ').trim();

    // Parse select — stops before where / sort / limit
    let select = null;
    const selectMatch = clauseText.match(/\bselect\s+([\w,\s-]+?)(?=\s+where|\s+sort|\s+limit|$)/i);
    if (selectMatch) {
        select = selectMatch[1]
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);
        if (select.length === 0) select = null;
    }

    // Parse sort — stops before limit
    let sort = null;
    const sortMatch = clauseText.match(/\bsort\s+([\w-]+)(\s+desc)?(?=\s+limit|$)/i);
    if (sortMatch) {
        sort = { field: sortMatch[1].toLowerCase(), desc: !!sortMatch[2] };
    }

    // Parse limit
    let limit = null;
    const limitMatch = clauseText.match(/\blimit\s+(\d+)/i);
    if (limitMatch) {
        limit = parseInt(limitMatch[1], 10);
    }

    // Parse where — supports = (equality) and contains (substring)
    let where = null;
    const whereContainsMatch = clauseText.match(
        /\bwhere\s+([\w-]+)\s+contains\s+(.+?)(?=\s+sort|\s+limit|$)/i
    );
    const whereEqMatch = clauseText.match(
        /\bwhere\s+([\w-]+)\s*=\s*\[\[([^\]]+)\]\]|\bwhere\s+([\w-]+)\s*=\s*(\S+)/i
    );
    if (whereContainsMatch) {
        where = {
            field: whereContainsMatch[1].toLowerCase(),
            op:    'contains',
            value: whereContainsMatch[2].trim().toLowerCase()
        };
    } else if (whereEqMatch) {
        where = whereEqMatch[1]
            ? { field: whereEqMatch[1].toLowerCase(), op: 'eq', value: whereEqMatch[2].trim().toLowerCase() }
            : { field: whereEqMatch[3].toLowerCase(), op: 'eq', value: whereEqMatch[4].trim().toLowerCase() };
    }

    return { type, select, where, sort, limit, label };
}

// ─────────────────────────────────────────────────────────────────
// parseAllViewQueries
// Returns all !view blocks found in a document.
// A block starts at a !view line and continues on immediately
// following non-blank lines that hold select/where/sort clauses.
// ─────────────────────────────────────────────────────────────────
function parseAllViewQueries(text) {
    const queries = [];
    const lines   = text.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();

        if (line.startsWith('!view ')) {
            const block = [lines[i]];
            let j = i + 1;

            // Collect continuation clause lines (select / where / sort)
            while (j < lines.length) {
                const next = lines[j].trim();
                if (next.length === 0) break;                    // blank line ends block
                if (next.startsWith('!view ')) break;            // new block starts
                if (/^(select|where|sort|limit)\b/i.test(next)) {
                    block.push(lines[j]);
                    j++;
                } else {
                    break;                                        // non-clause line ends block
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

// Legacy single-line entry point — still works for single !view lines
function parseSingleViewLine(line) {
    return parseSingleViewBlock([line]);
}

// Legacy single-query entry point
function parseViewQuery(text) {
    const all = parseAllViewQueries(text);
    return all ? all[0] : null;
}

// ─────────────────────────────────────────────────────────────────
// runQuery
// Executes a query object against the live index
// Returns { rows, columns, types }
// ─────────────────────────────────────────────────────────────────
function runQuery(query) {
    const rows       = [];
    const fieldCache = getFieldsCache();

    for (const [id, filePath] of getIndex().entries()) {
        const fields = fieldCache.get(id);
        if (!fields) continue;

        const nodeType = (fields.type || '').trim().toLowerCase();

        if (query.type !== '*' && nodeType !== query.type) continue;

        if (query.where) {
            const raw = (fields[query.where.field] || '').toLowerCase();
            if (query.where.op === 'contains') {
                if (!raw.includes(query.where.value)) continue;
            } else {
                // eq — match scalar or unwrapped relation
                const clean = raw.replace(/^\[\[|\]\]$/g, '').trim();
                if (clean !== query.where.value && raw !== query.where.value) continue;
            }
        }

        rows.push({ id, fields, filePath, nodeType });
    }

    // Sort
    if (query.sort) {
        const { field, desc } = query.sort;
        rows.sort((a, b) => {
            const av = (a.fields[field] || a.id || '').toLowerCase();
            const bv = (b.fields[field] || b.id || '').toLowerCase();
            return desc ? bv.localeCompare(av) : av.localeCompare(bv);
        });
    } else {
        rows.sort((a, b) => a.id.localeCompare(b.id));
    }

    // Limit — applied after sort so "limit 5" always means the top 5 sorted rows
    if (query.limit && query.limit > 0) {
        rows.splice(query.limit);
    }

    // ── Column derivation ──────────────────────────────────────────
    // If select was specified, use it directly — id is always prepended.
    // For !view *, also include type unless select overrides it.
    // If no select, derive from all fields present in the result set.
    let columns;

    if (query.select && query.select.length > 0) {
        // Always lead with id; user-specified columns follow in declared order
        columns = ['id', ...query.select.filter(c => c !== 'id')];
    } else {
        const fieldSet = new Set();
        for (const row of rows) {
            for (const key of Object.keys(row.fields)) {
                if (key !== 'id') fieldSet.add(key);
            }
        }
        fieldSet.delete('type');

        columns = query.type === '*'
            ? ['id', 'type', ...Array.from(fieldSet).sort()]
            : ['id', ...Array.from(fieldSet).sort()];
    }

    const types = query.type === '*'
        ? [...new Set(rows.map(r => r.nodeType).filter(Boolean))].sort()
        : [];

    return { rows, columns, types };
}

function buildQueryString(query) {
    let s = '!view ' + query.type;
    if (query.select) s += '\nselect ' + query.select.join(', ');
    if (query.where) {
        s += '\nwhere ' + query.where.field + ' ';
        s += query.where.op === 'contains'
            ? 'contains ' + query.where.value
            : '= ' + (query.where.value.includes(' ') ? query.where.value : '[[' + query.where.value + ']]');
    }
    if (query.sort)  s += '\nsort '  + query.sort.field + (query.sort.desc ? ' desc' : '');
    if (query.limit) s += '\nlimit ' + query.limit;
    return s;
}

module.exports = { parseSingleViewLine, parseSingleViewBlock, parseAllViewQueries, parseViewQuery, runQuery, buildQueryString };