'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__viewpanel_vscode_stub__ = {
    id: '__viewpanel_vscode_stub__',
    filename: '__viewpanel_vscode_stub__',
    loaded: true,
    exports: {}
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__viewpanel_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    normaliseTableDisplayValue,
    extractIdFromText,
    buildTableEmptyStateTitle
} = require('../src/features/viewPanel');

describe('view panel display helpers', () => {
    test('keeps canonical dates untouched and normalises parseable datetime strings', () => {
        assert.equal(normaliseTableDisplayValue('date', '2026-03-31'), '2026-03-31');
        assert.equal(
            normaliseTableDisplayValue('date', 'Mon Mar 30 2026 21:00:00 GMT-0300 (Chile Summer Time)'),
            '2026-03-31'
        );
    });

    test('keeps booleans lowercase for stable rendering', () => {
        assert.equal(normaliseTableDisplayValue('boolean', 'TRUE'), 'true');
        assert.equal(normaliseTableDisplayValue('boolean', 'false'), 'false');
    });

    test('extracts canonical context ids from accented frontmatter values', () => {
        const text = [
            '---',
            'id: Jaime Ramírez',
            'type: contact',
            '---',
            ''
        ].join('\n');
        assert.equal(extractIdFromText(text), 'jaime-ramirez');
    });
    test('uses the incoming empty-state title for backlink views', () => {
        const title = buildTableEmptyStateTitle({
            incoming: true,
            type: 'contact',
            wheres: [],
            where: null
        }, []);
        assert.equal(title, 'No notes link here yet.');
    });
});

Module._resolveFilename = originalResolve;
