'use strict';

const vscode = require('vscode');
const { getSchema } = require('../registries/schemaRegistry');
const { parseSingleViewBlock, buildQueryString } = require('../engine/query');
const {
    closestTypeMatch,
    collectFieldCandidates,
    collectRelationFieldCandidates
} = require('../intelligence/queryDiagnostics');

function getViewBlockAtRange(document, range) {
    const lines = document.getText().split('\n');
    let start = range.start.line;
    while (start >= 0) {
        const t = lines[start].trim();
        if (t.startsWith('!view ')) break;
        if (!t || (!/^(select|where|sort|limit|via)\b/i.test(t) && start !== range.start.line)) return null;
        start--;
    }
    if (start < 0 || !lines[start].trim().startsWith('!view ')) return null;
    const block = [lines[start]];
    let end = start + 1;
    while (end < lines.length) {
        const t = lines[end].trim();
        if (!t) break;
        if (t.startsWith('!view ')) break;
        if (/^(select|where|sort|limit|via)\b/i.test(t)) {
            block.push(lines[end]);
            end++;
        } else break;
    }
    return { start, end, block, query: parseSingleViewBlock(block) };
}

function getViewBlockByIndex(document, index) {
    const lines = document.getText().split('\n');
    let currentIndex = -1;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (!lines[lineIndex].trim().startsWith('!view ')) continue;
        currentIndex += 1;
        if (currentIndex !== index) continue;

        const block = [lines[lineIndex]];
        let end = lineIndex + 1;
        while (end < lines.length) {
            const t = lines[end].trim();
            if (!t) break;
            if (t.startsWith('!view ')) break;
            if (/^(select|where|sort|limit|via)\b/i.test(t)) {
                block.push(lines[end]);
                end += 1;
            } else {
                break;
            }
        }

        return { start: lineIndex, end, block, query: parseSingleViewBlock(block) };
    }

    return null;
}

async function revealDocumentAndRunViews(document, options = {}) {
    if (!document) return;
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    const selection = options.selection || null;
    if (editor && selection) {
        const point = selection.active || selection.anchor || selection;
        const nextSelection = point instanceof vscode.Selection
            ? point
            : new vscode.Selection(point, point);
        editor.selection = nextSelection;
        editor.revealRange(new vscode.Range(nextSelection.start, nextSelection.end));
    }
    await vscode.commands.executeCommand('yamlink.runViews');
    return editor;
}

function defaultSelectClauseForType(type) {
    const schema = getSchema ? getSchema(type) : null;
    if (!schema || !schema.fields) return '';
    const schemaFields = Object.keys(schema.fields)
        .filter(f => f !== 'id' && f !== 'created' && f !== 'type')
        .slice(0, 5);
    return schemaFields.length > 0 ? `\nselect ${schemaFields.join(', ')}` : '';
}

function getAvailableFieldsForType(type) {
    if (!type || type === '*') return [];
    const schema = getSchema ? getSchema(type) : null;
    if (!schema || !schema.fields) return [];
    return Object.keys(schema.fields)
        .filter(f => f !== 'id')
        .sort((a, b) => a.localeCompare(b));
}

function getSchemaBackedDefaultSortField(type) {
    const fields = getAvailableFieldsForType(type);
    if (fields.includes('created')) return 'created';
    if (fields.includes('date')) return 'date';
    if (fields.includes('name')) return 'name';
    return '';
}

function appendQueryOptions(baseQuery, options = {}) {
    let query = String(baseQuery || '').trim();
    if (!query) return '';

    const label = String(options.label || '').trim();
    if (label) {
        const firstLineEnd = query.indexOf('\n');
        if (firstLineEnd === -1) {
            query = `${query} | ${label}`;
        } else {
            query = `${query.slice(0, firstLineEnd)} | ${label}${query.slice(firstLineEnd)}`;
        }
    }

    const whereField = String(options.whereField || '').trim();
    const whereValue = String(options.whereValue || '').trim();
    if (whereField && whereValue) {
        const operator = String(options.whereOperator || '=').trim() || '=';
        query += `\nwhere ${whereField} ${operator} ${whereValue}`;
    }

    const sortField = String(options.sortField || '').trim();
    if (sortField) {
        const direction = String(options.sortDirection || 'asc').trim().toLowerCase() === 'desc'
            ? ' desc'
            : '';
        query += `\nsort ${sortField}${direction}`;
    }

    if (Number.isInteger(options.limit) && options.limit > 0) {
        query += `\nlimit ${options.limit}`;
    }

    return query;
}

function buildTypeViewQuery(type, selectMode = 'smart', options = {}) {
    const head = type === '*' ? '!view *' : `!view ${type}`;
    let query = head;
    if (type !== '*' && selectMode !== 'none') {
        query += selectMode === 'all' ? '\nselect *' : defaultSelectClauseForType(type);
    }
    return appendQueryOptions(query, options);
}

function buildIncomingViewQuery(sourceType, viaField, options = {}) {
    let query = `!view incoming ${sourceType}`;
    if (viaField && viaField !== '*') query += `\nvia ${viaField}`;
    return appendQueryOptions(query, options);
}

function refineParsedQuery(query, refinement = {}) {
    if (!query) return null;
    const next = {
        ...query,
        wheres: Array.isArray(query.wheres) ? query.wheres.map(where => ({ ...where })) : []
    };
    const r = /** @type {Record<string, any>} */ (refinement);

    if ('label' in r) next.label = r.label || null;

    if ('sortField' in r) {
        if (r.sortField) {
            next.sort = {
                field: r.sortField,
                desc: String(r.sortDirection || 'asc').toLowerCase() === 'desc'
            };
        } else {
            next.sort = null;
        }
    }

    if ('limit' in r) {
        next.limit = Number.isInteger(r.limit) && r.limit > 0
            ? r.limit
            : null;
    }

    if ('whereField' in r) {
        if (r.whereField && r.whereValue) {
            next.wheres = [{
                field: r.whereField,
                op: r.whereOperator || '=',
                value: r.whereValue,
                valueKind: String(r.whereValue || '').startsWith('[[') && String(r.whereValue || '').endsWith(']]')
                    ? 'relation'
                    : 'string'
            }];
            if (next.wheres[0].valueKind === 'relation') {
                next.wheres[0].value = next.wheres[0].value.slice(2, -2).trim();
            }
            next.where = next.wheres[0];
        } else {
            next.wheres = [];
            next.where = null;
        }
    }

    return next;
}

function buildRefinedBlockText(originalBlock, query) {
    if (!originalBlock || !query) return '';
    return buildQueryString(query);
}

function levenshtein(a, b) {
    const left = String(a ?? '');
    const right = String(b ?? '');
    const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i++) dp[i][0] = i;
    for (let j = 0; j <= right.length; j++) dp[0][j] = j;
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[left.length][right.length];
}

function closestCandidateFromList(candidate, candidates = []) {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (!normalized || !Array.isArray(candidates) || candidates.length === 0) return null;
    const ranked = candidates
        .filter(Boolean)
        .map(function (item) {
            const next = String(item).trim().toLowerCase();
            return { candidate: next, distance: levenshtein(normalized, next) };
        })
        .sort(function (a, b) {
            return a.distance - b.distance || a.candidate.localeCompare(b.candidate);
        });
    if (!ranked.length || ranked[0].distance > 3) return null;
    return ranked[0].candidate;
}

function cloneQuery(query) {
    return {
        ...query,
        sort: query.sort ? { ...query.sort } : null,
        select: Array.isArray(query.select) ? [...query.select] : query.select,
        wheres: Array.isArray(query.wheres) ? query.wheres.map(where => ({ ...where })) : [],
        where: query.where ? { ...query.where } : null
    };
}

function replaceFieldReferences(query, oldField, nextField) {
    const next = cloneQuery(query);
    if (next.sort?.field === oldField) next.sort.field = nextField;
    if (next.via === oldField) next.via = nextField;
    if (Array.isArray(next.wheres)) {
        next.wheres = next.wheres.map(function (where) {
            return where.field === oldField
                ? { ...where, field: nextField }
                : where;
        });
    }
    next.where = next.wheres[0] || null;
    return next;
}

function replaceTypeReference(query, nextType) {
    const next = cloneQuery(query);
    next.type = nextType;
    return next;
}

function buildLikelyRepairActions(query, sortCandidates, filterCandidates, fieldCache) {
    const actions = [];
    const seen = new Set();
    const broadFieldCandidates = Array.from(new Set([
        ...sortCandidates,
        ...filterCandidates,
        ...collectFieldCandidates(query.type, fieldCache)
    ]));
    const relationCandidates = Array.from(new Set([
        ...collectRelationFieldCandidates(query.type, fieldCache)
    ]));

    function pushRepair(label, description, apply) {
        if (seen.has(label)) return;
        seen.add(label);
        actions.push({
            label,
            description,
            value: 'smart-repair',
            apply
        });
    }

    if (query.type && query.type !== '*' && query.type !== 'tasks') {
        const typeSuggestion = closestTypeMatch(query.type, fieldCache);
        if (typeSuggestion && typeSuggestion !== query.type) {
            pushRepair(
                `Repair type: use ${typeSuggestion}`,
                `Yamlink thinks "${typeSuggestion}" is closer than "${query.type}".`,
                function (current) { return replaceTypeReference(current, typeSuggestion); }
            );
        }
    }

    if (query.sort?.field && !sortCandidates.includes(query.sort.field)) {
        const sortSuggestion = closestCandidateFromList(query.sort.field, broadFieldCandidates);
        if (sortSuggestion && sortSuggestion !== query.sort.field) {
            pushRepair(
                `Repair sort: use ${sortSuggestion}`,
                `Replace uncommon sort field "${query.sort.field}" with "${sortSuggestion}".`,
                function (current) {
                    const next = cloneQuery(current);
                    if (next.sort) next.sort.field = sortSuggestion;
                    return next;
                }
            );
        }
    }

    if (query.incoming && query.via && !filterCandidates.includes(query.via)) {
        const viaSuggestion = closestCandidateFromList(query.via, relationCandidates);
        if (viaSuggestion && viaSuggestion !== query.via) {
            pushRepair(
                `Repair relation field: use ${viaSuggestion}`,
                `Replace uncommon relation field "${query.via}" with "${viaSuggestion}".`,
                function (current) {
                    const next = cloneQuery(current);
                    next.via = viaSuggestion;
                    return next;
                }
            );
        }
    }

    const whereRepairs = [];
    for (const where of query.wheres || []) {
        if (where.field === 'id' || where.field === 'body' || where.field === 'any') continue;
        if (filterCandidates.includes(where.field)) continue;
        const fieldSuggestion = closestCandidateFromList(where.field, broadFieldCandidates);
        if (fieldSuggestion && fieldSuggestion !== where.field) {
            pushRepair(
                `Repair filter: ${where.field} -> ${fieldSuggestion}`,
                `Replace uncommon filter field "${where.field}" with "${fieldSuggestion}".`,
                function (current) { return replaceFieldReferences(current, where.field, fieldSuggestion); }
            );
            whereRepairs.push({ from: where.field, to: fieldSuggestion });
        }
    }

    if (actions.length > 1) {
        pushRepair(
            'Apply likely repairs',
            'Apply Yamlink’s best repair guesses across this query in one step.',
            function (current) {
                let next = cloneQuery(current);
                const typeSuggestion = closestTypeMatch(next.type, fieldCache);
                if (typeSuggestion && typeSuggestion !== next.type) next.type = typeSuggestion;

                const nextSortCandidates = Array.from(new Set([
                    ...broadFieldCandidates,
                    ...collectFieldCandidates(next.type, fieldCache)
                ]));
                const nextRelationCandidates = Array.from(new Set([
                    ...relationCandidates,
                    ...collectRelationFieldCandidates(next.type, fieldCache)
                ]));
                if (next.sort?.field && !nextSortCandidates.includes(next.sort.field)) {
                    const sortSuggestion = closestCandidateFromList(next.sort.field, nextSortCandidates);
                    if (sortSuggestion) next.sort.field = sortSuggestion;
                }

                if (next.incoming && next.via) {
                    const viaSuggestion = closestCandidateFromList(next.via, nextRelationCandidates);
                    if (viaSuggestion) next.via = viaSuggestion;
                }

                for (const repair of whereRepairs) {
                    next = replaceFieldReferences(next, repair.from, repair.to);
                }
                return next;
            }
        );
        const bundled = actions.pop();
        actions.unshift(bundled);
    }

    return actions;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function findSchemaRelationField(chosenType, targetType) {
    if (!chosenType || !targetType) return null;
    const schema = getSchema ? getSchema(chosenType) : null;
    if (!schema?.fields) return null;
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        if (fieldDef?.type === 'relation' &&
            String(fieldDef.target || '').toLowerCase() === targetType) {
            return fieldName;
        }
    }
    return null;
}

module.exports = {
    appendQueryOptions,
    buildLikelyRepairActions,
    buildIncomingViewQuery,
    buildRefinedBlockText,
    buildTypeViewQuery,
    capitalize,
    defaultSelectClauseForType,
    findSchemaRelationField,
    getAvailableFieldsForType,
    getSchemaBackedDefaultSortField,
    getViewBlockAtRange,
    getViewBlockByIndex,
    refineParsedQuery,
    revealDocumentAndRunViews
};
