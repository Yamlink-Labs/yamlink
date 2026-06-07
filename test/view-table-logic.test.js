'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    esc,
    repairUiText,
    normaliseTableDisplayValue,
    normalizeSavedSort,
    getRowFieldValue,
    applySavedColumnOrder,
    collectColumnFilterValues,
    sortRowsForSavedSort,
    getTaskStatusPresentation,
    buildQuickFieldList,
    classifyQueryWarnings,
    buildTableEmptyStateTitle,
    buildEmptyStateHint
} = require('../src/features/view/viewTableLogic');

describe('esc', () => {
    test('escapes the four HTML special characters', () => {
        assert.equal(esc('<div class="a">&text</div>'), '&lt;div class=&quot;a&quot;&gt;&amp;text&lt;/div&gt;');
    });

    test('coerces non-strings via String()', () => {
        assert.equal(esc(42), '42');
        assert.equal(esc(null), 'null');
    });
});

describe('repairUiText', () => {
    test('converts common UTF-8 mojibake sequences', () => {
        assert.equal(repairUiText('hello Â· world'), 'hello - world');
        assert.equal(repairUiText('noteâ€¦'), 'note...');
        assert.equal(repairUiText('donâ€™t'), "don't");
    });

    test('is a no-op for clean ASCII', () => {
        assert.equal(repairUiText('clean text'), 'clean text');
    });
});

describe('normaliseTableDisplayValue', () => {
    test('leaves canonical date strings untouched', () => {
        assert.equal(normaliseTableDisplayValue('date', '2026-05-28'), '2026-05-28');
    });

    test('normalises datetime strings to ISO date', () => {
        const result = normaliseTableDisplayValue('date', 'Mon Mar 30 2026 21:00:00 GMT-0300');
        assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });

    test('normalises boolean strings to lowercase', () => {
        assert.equal(normaliseTableDisplayValue('boolean', 'TRUE'), 'true');
        assert.equal(normaliseTableDisplayValue('boolean', 'False'), 'false');
    });

    test('returns empty string for blank input', () => {
        assert.equal(normaliseTableDisplayValue('text', ''), '');
        assert.equal(normaliseTableDisplayValue('text', '   '), '');
    });

    test('returns raw value for text kind', () => {
        assert.equal(normaliseTableDisplayValue('text', 'hello'), 'hello');
    });
});

describe('normalizeSavedSort', () => {
    test('returns null for missing or empty input', () => {
        assert.equal(normalizeSavedSort(null), null);
        assert.equal(normalizeSavedSort({}), null);
        assert.equal(normalizeSavedSort({ field: '' }), null);
    });

    test('accepts new shape with field + direction', () => {
        assert.deepEqual(normalizeSavedSort({ field: 'status', direction: 'desc' }), { field: 'status', direction: 'desc' });
    });

    test('accepts legacy shape with col + asc', () => {
        assert.deepEqual(normalizeSavedSort({ col: 'date', asc: true }), { field: 'date', direction: 'asc' });
        assert.deepEqual(normalizeSavedSort({ col: 'date', asc: false }), { field: 'date', direction: 'desc' });
    });

    test('defaults direction to asc when absent', () => {
        assert.deepEqual(normalizeSavedSort({ field: 'name' }), { field: 'name', direction: 'asc' });
    });
});

describe('getRowFieldValue', () => {
    test('returns id for the id field', () => {
        assert.equal(getRowFieldValue({ id: 'rico', fields: {} }, 'id'), 'rico');
    });

    test('returns field value as string', () => {
        assert.equal(getRowFieldValue({ id: 'rico', fields: { status: 'active' } }, 'status'), 'active');
    });

    test('returns empty string for missing field', () => {
        assert.equal(getRowFieldValue({ id: 'rico', fields: {} }, 'missing'), '');
    });

    test('returns empty string for null row', () => {
        assert.equal(getRowFieldValue(null, 'status'), '');
    });
});

describe('applySavedColumnOrder', () => {
    test('is a no-op when savedOrder is empty', () => {
        assert.deepEqual(applySavedColumnOrder(['a', 'b', 'c'], []), ['a', 'b', 'c']);
        assert.deepEqual(applySavedColumnOrder(['a', 'b', 'c'], null), ['a', 'b', 'c']);
    });

    test('reorders to match savedOrder', () => {
        assert.deepEqual(applySavedColumnOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
    });

    test('appends columns absent from savedOrder at the end', () => {
        assert.deepEqual(applySavedColumnOrder(['a', 'b', 'c', 'd'], ['c', 'a']), ['c', 'a', 'b', 'd']);
    });

    test('ignores savedOrder entries not in columns', () => {
        assert.deepEqual(applySavedColumnOrder(['a', 'b'], ['b', 'z', 'a']), ['b', 'a']);
    });
});

describe('collectColumnFilterValues', () => {
    const rows = [
        { id: 'a', fields: { status: 'active' } },
        { id: 'b', fields: { status: 'done' } },
        { id: 'c', fields: { status: 'active' } },
        { id: 'd', fields: { status: '' } }
    ];

    test('returns unique non-empty values sorted alphabetically', () => {
        assert.deepEqual(collectColumnFilterValues(rows, 'status', 'text'), ['active', 'done']);
    });

    test('returns empty array when all values are blank', () => {
        const blankRows = [{ id: 'a', fields: { x: '' } }, { id: 'b', fields: { x: '  ' } }];
        assert.deepEqual(collectColumnFilterValues(blankRows, 'x', 'text'), []);
    });
});

describe('sortRowsForSavedSort', () => {
    const rows = [
        { id: 'b', fields: { status: 'done', score: '10' } },
        { id: 'a', fields: { status: 'active', score: '3' } },
        { id: 'c', fields: { status: 'blocked', score: '7' } }
    ];
    const meta = { status: { kind: 'text' }, score: { kind: 'number' } };

    test('sorts text fields alphabetically ascending', () => {
        const sorted = sortRowsForSavedSort(rows, { field: 'status', direction: 'asc' }, meta);
        assert.deepEqual(sorted.map(r => r.id), ['a', 'c', 'b']);
    });

    test('sorts text fields descending', () => {
        const sorted = sortRowsForSavedSort(rows, { field: 'status', direction: 'desc' }, meta);
        assert.deepEqual(sorted.map(r => r.id), ['b', 'c', 'a']);
    });

    test('sorts number fields numerically', () => {
        const sorted = sortRowsForSavedSort(rows, { field: 'score', direction: 'asc' }, meta);
        assert.deepEqual(sorted.map(r => r.id), ['a', 'c', 'b']);
    });

    test('returns a copy when no sort is specified', () => {
        const sorted = sortRowsForSavedSort(rows, null, meta);
        assert.deepEqual(sorted.map(r => r.id), ['b', 'a', 'c']);
    });
});

describe('getTaskStatusPresentation', () => {
    test('done task', () => {
        const r = getTaskStatusPresentation({ fields: { done: 'true' } }, '2026-05-28');
        assert.equal(r.key, 'true');
        assert.equal(r.label, 'Done');
    });

    test('overdue task', () => {
        const r = getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-01' } }, '2026-05-28');
        assert.equal(r.key, 'overdue');
    });

    test('due today', () => {
        const r = getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-28' } }, '2026-05-28');
        assert.equal(r.key, 'due-today');
    });

    test('due soon (1–3 days)', () => {
        const r = getTaskStatusPresentation({ fields: { done: 'false', date: '2026-05-30' } }, '2026-05-28');
        assert.equal(r.key, 'due-soon');
    });

    test('not done and not near due date', () => {
        const r = getTaskStatusPresentation({ fields: { done: 'false', date: '2026-06-15' } }, '2026-05-28');
        assert.equal(r.key, 'false');
        assert.equal(r.label, 'Not done');
    });
});

describe('buildQuickFieldList', () => {
    test('returns up to 4 non-id columns', () => {
        assert.deepEqual(
            buildQuickFieldList(['id', 'type', 'status', 'owner', 'date', 'rank']),
            ['type', 'status', 'owner', 'date']
        );
    });

    test('returns all columns when fewer than 4', () => {
        assert.deepEqual(buildQuickFieldList(['id', 'type', 'status']), ['type', 'status']);
    });

    test('handles empty or non-array input', () => {
        assert.deepEqual(buildQuickFieldList([]), []);
        assert.deepEqual(buildQuickFieldList(null), []);
    });
});

describe('classifyQueryWarnings', () => {
    test('returns severity none for empty warnings', () => {
        assert.equal(classifyQueryWarnings([]).severity, 'none');
        assert.equal(classifyQueryWarnings(null).severity, 'none');
    });

    test('classifies cross-field or as query-issue', () => {
        const r = classifyQueryWarnings(['Cross-field OR is not supported yet.']);
        assert.equal(r.severity, 'query-issue');
        assert.match(r.primary, /cross-field/i);
    });

    test('classifies parse errors as query-issue', () => {
        const r = classifyQueryWarnings(['Invalid syntax in where clause']);
        assert.equal(r.severity, 'query-issue');
    });

    test('classifies other warnings as query-warning', () => {
        const r = classifyQueryWarnings(['Field "stauts" not found — did you mean "status"?']);
        assert.equal(r.severity, 'query-warning');
        assert.equal(r.primary, 'Field "stauts" not found — did you mean "status"?');
    });
});

describe('buildTableEmptyStateTitle', () => {
    test('incoming view', () => {
        assert.equal(buildTableEmptyStateTitle({ incoming: true, type: 'contact', wheres: [] }, []), 'No notes link here yet.');
    });

    test('tasks view', () => {
        assert.equal(buildTableEmptyStateTitle({ type: 'tasks', wheres: [] }, []), 'No tasks matched this view.');
    });

    test('id filter with no match', () => {
        assert.equal(
            buildTableEmptyStateTitle({ type: 'contact', wheres: [{ field: 'id' }] }, []),
            'The target note was not found in this view.'
        );
    });

    test('generic no-results', () => {
        assert.equal(buildTableEmptyStateTitle({ type: 'contact', wheres: [] }, []), 'No rows matched this view.');
    });

    test('query issue elevates title', () => {
        assert.equal(
            buildTableEmptyStateTitle({ type: 'x', wheres: [] }, ['Cross-field OR is not supported yet.']),
            'This query needs attention.'
        );
    });
});

describe('buildEmptyStateHint', () => {
    test('returns query-issue message for unsupported syntax', () => {
        const hint = buildEmptyStateHint({ type: 'contact', wheres: [] }, ['Cross-field OR is not supported yet.']);
        assert.match(hint, /cross-field/i);
        assert.match(hint, /split the logic/i);
    });

    test('returns primary warning for query-warning severity', () => {
        const hint = buildEmptyStateHint({ type: 'x', wheres: [] }, ['Field "stauts" not found']);
        assert.equal(hint, 'Field "stauts" not found');
    });

    test('returns id-specific hint for id filter with no results', () => {
        const hint = buildEmptyStateHint({ type: 'contact', wheres: [{ field: 'id' }] }, []);
        assert.match(hint, /id matches exactly/);
    });

    test('suggests a broader query for generic no-results', () => {
        const hint = buildEmptyStateHint({ type: 'contact', wheres: [] }, []);
        assert.match(hint, /broader query/);
    });
});
