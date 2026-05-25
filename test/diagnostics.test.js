'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── VS Code stub ──────────────────────────────────────────────────────────────
class FakeRange {
    constructor(startOrLine, startChar, endLine, endChar) {
        if (typeof startOrLine === 'object') {
            this.start = startOrLine;
            this.end = startChar;
        } else {
            this.start = { line: startOrLine, character: startChar };
            this.end   = { line: endLine,     character: endChar };
        }
    }
}
class FakePosition {
    constructor(line, character) { this.line = line; this.character = character; }
}
class FakeDiagnostic {
    constructor(range, message, severity) {
        this.range    = range;
        this.message  = message;
        this.severity = severity;
        this.source   = '';
        this.code     = '';
    }
}

const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

class FakeCollection {
    constructor() { this._map = new Map(); }
    set(uri, diags) { this._map.set(uri.toString(), diags); }
    get(uri) { return this._map.get(uri.toString()) || []; }
    clear() { this._map.clear(); }
    forEach(fn) { this._map.forEach((diags, uri) => fn({ toString: () => uri }, diags, this)); }
}

// ── Registry / index stubs ────────────────────────────────────────────────────
let _knownTypes    = new Set();
let _duplicateIds  = new Map();
let _dupSchemas    = new Map();
let _fieldsCache   = new Map();
let _backlinks     = [];
let _suggestions   = [];
let _hasSchema     = false;
let _schemaFields  = {};
let _schemaSourceId = '';

const vscodeMock = {
    languages: { createDiagnosticCollection: () => new FakeCollection() },
    workspace:  { onDidChangeTextDocument: () => ({ dispose(){} }),
                  onDidOpenTextDocument:   () => ({ dispose(){} }),
                  textDocuments: [],
                  workspaceFolders: null },
    window:     { onDidChangeActiveTextEditor: () => ({ dispose(){} }) },
    Range:       FakeRange,
    Position:    FakePosition,
    Diagnostic:  FakeDiagnostic,
    DiagnosticSeverity
};

const originalResolve = Module._resolveFilename.bind(Module);

require.cache['__diag_vscode__'] = { id: '__diag_vscode__', filename: '__diag_vscode__', loaded: true, exports: vscodeMock };
require.cache['__diag_typeReg__'] = { id: '__diag_typeReg__', filename: '__diag_typeReg__', loaded: true, exports: { isKnownType: (t) => _knownTypes.has(t) } };
require.cache['__diag_schemaReg__'] = { id: '__diag_schemaReg__', filename: '__diag_schemaReg__', loaded: true, exports: {
    hasSchema: () => _hasSchema,
    getSchema: () => ({ fields: _schemaFields, sourceId: _schemaSourceId }),
    getDuplicateSchemas: () => _dupSchemas
}};
require.cache['__diag_index__'] = { id: '__diag_index__', filename: '__diag_index__', loaded: true, exports: {
    getDuplicateIds: () => _duplicateIds,
    getFieldsCache:  () => _fieldsCache,
    getAliasIndex:   () => new Map([['johnny-rico', 'juan-rico']])
}};
require.cache['__diag_graph__'] = { id: '__diag_graph__', filename: '__diag_graph__', loaded: true, exports: {
    getBacklinks: () => _backlinks
}};
require.cache['__diag_suggestions__'] = { id: '__diag_suggestions__', filename: '__diag_suggestions__', loaded: true, exports: {
    computeSuggestionsForNode: () => _suggestions,
    QUERY_SUGGESTION_THRESHOLD: 3
}};
require.cache['__diag_id__'] = { id: '__diag_id__', filename: '__diag_id__', loaded: true, exports: {
    extractCanonicalIdFromFrontmatter: (text) => {
        const m = text.match(/^\s*id:\s*(.+)/m);
        return m ? m[1].trim() : null;
    },
    resolveLinkedTarget: (raw, idIndex, aliasIndex) => {
        const canonical = String(raw || '').trim().split('|')[0].trim().split('#')[0].trim().split('^')[0].trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');
        if (!canonical) return null;
        if (idIndex.has(canonical)) return canonical;
        const resolved = aliasIndex?.get(canonical);
        return resolved && idIndex.has(resolved) ? resolved : null;
    }
}};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode')                              return '__diag_vscode__';
    if (request === '../registries/typeRegistry')          return '__diag_typeReg__';
    if (request === '../registries/schemaRegistry')        return '__diag_schemaReg__';
    if (request === '../core/index')                       return '__diag_index__';
    if (request === '../core/indexService')                       return '__diag_index__';
    if (request === '../core/graph')                       return '__diag_graph__';
    if (request === '../engine/suggestions')               return '__diag_suggestions__';
    if (request === '../core/id')                          return '__diag_id__';
    return originalResolve(request, parent, ...rest);
};

const { validateDocument, registerDiagnostics, getBrokenCount } = require('../src/diagnostics/diagnostics');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeDoc(text, languageId = 'markdown') {
    const lines = text.split('\n');
    return {
        languageId,
        getText() { return text; },
        uri: { toString() { return 'file:///test.md'; } },
        get lineCount() { return lines.length; },
        lineAt(n) {
            const t = lines[n] || '';
            return {
                text: t,
                range: new FakeRange(n, 0, n, t.length)
            };
        },
        positionAt(offset) {
            let remaining = offset;
            for (let i = 0; i < lines.length; i++) {
                if (remaining <= lines[i].length) return new FakePosition(i, remaining);
                remaining -= lines[i].length + 1;
            }
            return new FakePosition(lines.length - 1, 0);
        }
    };
}

// Initialise the collection by calling registerDiagnostics with a dummy context
let diagnosticCollection;
{
    const fakeContext = { subscriptions: { push() {} } };
    // capture the collection the module creates
    const original = vscodeMock.languages.createDiagnosticCollection;
    vscodeMock.languages.createDiagnosticCollection = () => {
        diagnosticCollection = new FakeCollection();
        vscodeMock.languages.createDiagnosticCollection = original;
        return diagnosticCollection;
    };
    registerDiagnostics(fakeContext, () => new Map());
}

function runValidate(doc, idIndex = new Map()) {
    validateDocument(doc, () => idIndex);
    return diagnosticCollection.get(doc.uri);
}

function resetState() {
    _knownTypes    = new Set();
    _duplicateIds  = new Map();
    _dupSchemas    = new Map();
    _fieldsCache   = new Map();
    _backlinks     = [];
    _suggestions   = [];
    _hasSchema     = false;
    _schemaFields  = {};
    _schemaSourceId = '';
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('validateDocument', () => {
    test('non-markdown documents produce no diagnostics', () => {
        resetState();
        const doc = makeDoc('hello world', 'plaintext');
        const diags = runValidate(doc);
        assert.equal(diags.length, 0);
    });

    test('missingId diagnostic when frontmatter has no id', () => {
        resetState();
        const doc = makeDoc('---\ntitle: No ID\n---\n\nBody.\n');
        const diags = runValidate(doc);
        const codes = diags.map(d => d.code);
        assert.ok(codes.includes('yamlink.missingId'), 'missingId present');
    });

    test('missingId diagnostic when there is no frontmatter at all', () => {
        resetState();
        const doc = makeDoc('Just a plain file.\n');
        const diags = runValidate(doc);
        assert.ok(diags.some(d => d.code === 'yamlink.missingId'));
    });

    test('no missingId when valid id present', () => {
        resetState();
        const idIndex = new Map([['alpha', {}]]);
        const doc = makeDoc('---\nid: alpha\n---\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(!diags.some(d => d.code === 'yamlink.missingId'));
    });

    test('brokenLink for unknown wikilink in body', () => {
        resetState();
        const doc = makeDoc('---\nid: alpha\n---\n\nSee [[unknown-node]].\n');
        const diags = runValidate(doc, new Map([['alpha', {}]]));
        assert.ok(diags.some(d => d.code === 'yamlink.brokenLink'), 'brokenLink expected');
    });

    test('no brokenLink when wikilink target exists', () => {
        resetState();
        const idIndex = new Map([['alpha', {}], ['beta', {}]]);
        const doc = makeDoc('---\nid: alpha\n---\n\nSee [[beta]].\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(!diags.some(d => d.code === 'yamlink.brokenLink'));
    });

    test('no brokenLink when wikilink resolves via canonicalization or alias', () => {
        resetState();
        const idIndex = new Map([['alpha', {}], ['what-is-yamlink', {}], ['juan-rico', {}]]);
        const doc = makeDoc('---\nid: alpha\n---\n\nSee [[What is Yamlink?]] and [[johnny-rico]] and [[what is yamlink#intro]].\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(!diags.some(d => d.code === 'yamlink.brokenLink'));
    });

    test('brokenRelation for unknown wikilink in frontmatter', () => {
        resetState();
        const doc = makeDoc('---\nid: alpha\nfriend: [[ghost]]\n---\n');
        const diags = runValidate(doc, new Map([['alpha', {}]]));
        assert.ok(diags.some(d => d.code === 'yamlink.brokenRelation'));
        assert.ok(!diags.some(d => d.code === 'yamlink.brokenLink'));
    });

    test('duplicateId diagnostic when id appears in multiple files', () => {
        resetState();
        _duplicateIds = new Map([['alpha', ['file1.md', 'file2.md']]]);
        const idIndex = new Map([['alpha', {}]]);
        const doc = makeDoc('---\nid: alpha\n---\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(diags.some(d => d.code === 'yamlink.duplicateId'));
    });

    test('malformedSchema diagnostic for schema node without target', () => {
        resetState();
        const idIndex = new Map([['my-schema', {}]]);
        const doc = makeDoc('---\nid: my-schema\ntype: schema\n---\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(diags.some(d => d.code === 'yamlink.malformedSchema'), 'malformedSchema expected');
    });

    test('duplicateSchema diagnostic for second schema targeting same type', () => {
        resetState();
        _dupSchemas = new Map([['person', ['schema-person-original']]]);
        const idIndex = new Map([['schema-dupe', {}]]);
        const doc = makeDoc('---\nid: schema-dupe\ntype: schema\ntarget: person\n---\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(diags.some(d => d.code === 'yamlink.duplicateSchema'));
    });

    test('missingRequiredField when schema has required field absent', () => {
        resetState();
        _hasSchema = true;
        _schemaFields = { 'email': { required: true } };
        _schemaSourceId = 'schema-contact';
        const idIndex = new Map([['alice', {}]]);
        const doc = makeDoc('---\nid: alice\ntype: contact\n---\n');
        const diags = runValidate(doc, idIndex);
        assert.ok(diags.some(d => d.code === 'yamlink.missingRequiredField'));
    });

    test('querySuggestion diagnostic when suggestions engine returns results', () => {
        resetState();
        _suggestions = [{ title: 'People who mention you' }];
        const idIndex = new Map([['alpha', {}]]);
        const doc = makeDoc('---\nid: alpha\n---\n');
        const diags = runValidate(doc, idIndex);
        const diag = diags.find(d => d.code === 'yamlink.querySuggestion');
        assert.ok(diag);
        assert.equal(diag.range.start.line, 1);
        assert.equal(diag.range.start.character, 0);
        assert.equal(diag.range.end.line, 1);
        assert.equal(diag.range.end.character, 'id: alpha'.length);
    });
});

describe('getBrokenCount', () => {
    test('counts broken links and relations across documents', () => {
        resetState();
        const idIndex = new Map([['host', {}]]);
        const doc1 = makeDoc('---\nid: host\n---\n\nSee [[missing-a]] and [[missing-b]].\n');
        const doc2 = makeDoc('---\nid: host\nrel: [[missing-c]]\n---\n');
        // Give each doc a distinct URI
        doc1.uri = { toString: () => 'file:///doc1.md' };
        doc2.uri = { toString: () => 'file:///doc2.md' };
        runValidate(doc1, idIndex);
        runValidate(doc2, idIndex);
        assert.equal(getBrokenCount(), 3);
    });
});
