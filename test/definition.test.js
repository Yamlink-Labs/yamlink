'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const registrations = [];

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class DocumentLink {
    constructor(range, target) {
        this.range = range;
        this.target = target;
    }
}

const vscodeStub = {
    languages: {
        registerDocumentLinkProvider(selector, provider) {
            const registration = { selector, provider };
            registrations.push(registration);
            return registration;
        }
    },
    Uri: {
        file(fsPath) {
            return { fsPath };
        }
    },
    Position,
    Range,
    DocumentLink
};

function buildDocument(lineText) {
    return {
        lineCount: 1,
        lineAt() {
            return { text: lineText };
        }
    };
}

function registerAndGetProvider(idIndex) {
    registrations.length = 0;
    const context = {
        subscriptions: {
            pushed: [],
            push(item) {
                this.pushed.push(item);
            }
        }
    };
    registerDefinition(context, () => idIndex);
    assert.equal(context.subscriptions.pushed.length, 1);
    assert.equal(registrations.length, 1);
    return registrations[0].provider;
}

describe('wikilink document links', () => {
    test('registers a markdown document link provider', () => {
        const provider = registerAndGetProvider(new Map());
        assert.equal(typeof provider.provideDocumentLinks, 'function');
    });

    test('creates document links for plain wikilinks', () => {
        const provider = registerAndGetProvider(new Map([
            ['johnny-rico', 'C:\\vault\\johnny-rico.md']
        ]));

        const links = provider.provideDocumentLinks(
            buildDocument('Text [[johnny-rico]] more')
        );

        assert.equal(links.length, 1);
        assert.ok(links[0] instanceof DocumentLink);
        assert.equal(links[0].target.fsPath, 'C:\\vault\\johnny-rico.md');
        assert.deepEqual(links[0].range.start, new Position(0, 5));
        assert.deepEqual(links[0].range.end, new Position(0, 20));
    });

    test('resolves alias wikilinks without using the alias text', () => {
        const provider = registerAndGetProvider(new Map([
            ['johnny-rico', 'C:\\vault\\johnny-rico.md']
        ]));

        const links = provider.provideDocumentLinks(
            buildDocument('[[johnny-rico|Johnny Rico]]')
        );

        assert.equal(links.length, 1);
        assert.equal(links[0].target.fsPath, 'C:\\vault\\johnny-rico.md');
    });

    test('resolves heading anchors and block refs to the target note', () => {
        const provider = registerAndGetProvider(new Map([
            ['johnny-rico', 'C:\\vault\\johnny-rico.md']
        ]));

        const headingLinks = provider.provideDocumentLinks(
            buildDocument('[[johnny-rico#service-record]]')
        );
        const blockLinks = provider.provideDocumentLinks(
            buildDocument('[[johnny-rico^note-block]]')
        );

        assert.equal(headingLinks[0].target.fsPath, 'C:\\vault\\johnny-rico.md');
        assert.equal(blockLinks[0].target.fsPath, 'C:\\vault\\johnny-rico.md');
    });

    test('resolves embed links too', () => {
        const provider = registerAndGetProvider(new Map([
            ['johnny-rico', 'C:\\vault\\johnny-rico.md']
        ]));

        const links = provider.provideDocumentLinks(
            buildDocument('![[johnny-rico]]')
        );

        assert.equal(links.length, 1);
        assert.equal(links[0].target.fsPath, 'C:\\vault\\johnny-rico.md');
    });

    test('skips links when no target exists', () => {
        const provider = registerAndGetProvider(new Map());

        const links = provider.provideDocumentLinks(
            buildDocument('[[missing-note]]')
        );

        assert.deepEqual(links, []);
    });
});

const indexServiceStub = {
    getAliasIndex() {
        return new Map();
    }
};

const originalResolve = Module._resolveFilename.bind(Module);
const stubIds = {
    vscode: '__def_test_vscode__',
    indexService: '__def_test_index_service__'
};

require.cache[stubIds.vscode] = {
    id: stubIds.vscode,
    filename: stubIds.vscode,
    loaded: true,
    exports: vscodeStub
};

require.cache[stubIds.indexService] = {
    id: stubIds.indexService,
    filename: stubIds.indexService,
    loaded: true,
    exports: indexServiceStub
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return stubIds.vscode;
    if (request === '../core/indexService') return stubIds.indexService;
    return originalResolve(request, parent, ...rest);
};

const { registerDefinition } = require('../src/features/definition');

Module._resolveFilename = originalResolve;
