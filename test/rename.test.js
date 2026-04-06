'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__rename_vscode_stub__ = {
    id: '__rename_vscode_stub__',
    filename: '__rename_vscode_stub__',
    loaded: true,
    exports: {}
};
require.cache.__rename_diag_stub__ = {
    id: '__rename_diag_stub__',
    filename: '__rename_diag_stub__',
    loaded: true,
    exports: { validateAll: () => {} }
};
require.cache.__rename_workspace_stub__ = {
    id: '__rename_workspace_stub__',
    filename: '__rename_workspace_stub__',
    loaded: true,
    exports: { getWorkspaceRoots: () => [] }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__rename_vscode_stub__';
    if (request === '../diagnostics/diagnostics') return '__rename_diag_stub__';
    if (request === './workspace') return '__rename_workspace_stub__';
    return originalResolve(request, parent, ...rest);
};

const { findRenameMatchesInText, extractIdFromDocument } = require('../src/core/rename');

describe('rename propagation matching', () => {
    test('extracts and canonicalizes accented ids from frontmatter', () => {
        const document = {
            getText() {
                return [
                    '---',
                    'id: Jaime Ramírez',
                    'type: contact',
                    '---',
                    ''
                ].join('\n');
            }
        };
        assert.equal(extractIdFromDocument(document), 'jaime-ramirez');
    });

    test('matches plain wikilinks', () => {
        const matches = findRenameMatchesInText('commander: [[johnny-rico]]', 'johnny-rico');
        assert.equal(matches.length, 1);
    });

    test('matches alias wikilinks without replacing label text', () => {
        const text = 'commander: [[johnny-rico|Johnny Rico]]';
        const matches = findRenameMatchesInText(text, 'johnny-rico');
        assert.deepEqual(matches, [{ start: 13, end: 24 }]);
    });

    test('matches embed links', () => {
        const matches = findRenameMatchesInText('See ![[johnny-rico]] later.', 'johnny-rico');
        assert.equal(matches.length, 1);
    });

    test('does not match plain prose mentions', () => {
        const matches = findRenameMatchesInText('johnny-rico survived.', 'johnny-rico');
        assert.equal(matches.length, 0);
    });
});

Module._resolveFilename = originalResolve;
