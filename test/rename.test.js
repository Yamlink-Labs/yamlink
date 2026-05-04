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

    test('matches multiple occurrences on the same line', () => {
        const text = 'see [[alpha]] and also [[alpha|Alpha Note]]';
        const matches = findRenameMatchesInText(text, 'alpha');
        assert.equal(matches.length, 2);
    });

    test('match range targets only the id, not the brackets', () => {
        const text = 'link: [[some-node]]';
        const matches = findRenameMatchesInText(text, 'some-node');
        assert.equal(matches.length, 1);
        assert.equal(text.slice(matches[0].start, matches[0].end), 'some-node');
    });

    test('does not match a prefix of a longer id', () => {
        const matches = findRenameMatchesInText('ref: [[alpha-extended]]', 'alpha');
        assert.equal(matches.length, 0);
    });

    test('handles ids with regex special characters safely', () => {
        const matches = findRenameMatchesInText('see [[note.v2+final]]', 'note.v2+final');
        assert.equal(matches.length, 1);
    });

    test('returns empty array for empty text', () => {
        assert.deepEqual(findRenameMatchesInText('', 'alpha'), []);
    });

    test('extractIdFromDocument returns null when no id field present', () => {
        const document = { getText() { return '---\ntype: note\n---\n'; } };
        assert.equal(extractIdFromDocument(document), null);
    });

    test('extractIdFromDocument returns null for plain body with no frontmatter', () => {
        const document = { getText() { return 'Just a note.\n'; } };
        assert.equal(extractIdFromDocument(document), null);
    });
});

Module._resolveFilename = originalResolve;
