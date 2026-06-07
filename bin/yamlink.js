#!/usr/bin/env node
'use strict';

// Minimal vscode stub — allows feature modules that guard against missing
// diagnosticCollection (like diagnostics.js / healthStats.js) to load cleanly
// without the VS Code host. None of the actual VS Code APIs are invoked by CLI.
const Module = require('module');
const _originalResolve = Module._resolveFilename.bind(Module);
require.cache['__yamlink_vscode_stub__'] = {
    id: '__yamlink_vscode_stub__', filename: '__yamlink_vscode_stub__', loaded: true,
    exports: {
        languages: { createDiagnosticCollection: () => ({ set: () => {}, clear: () => {}, delete: () => {}, forEach: () => {}, dispose: () => {} }) },
        workspace: { onDidChangeTextDocument: () => ({ dispose: () => {} }), onDidSaveTextDocument: () => ({ dispose: () => {} }), textDocuments: [] },
        window:    { createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, clear: () => {}, dispose: () => {} }) },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        Diagnostic: class Diagnostic { constructor(r, m, s) { this.range = r; this.message = m; this.severity = s; } },
        Range:      class Range      { constructor(s, e) { this.start = s; this.end = e; } },
        Position:   class Position   { constructor(l, c) { this.line = l; this.character = c; } },
        Uri:        { file: p => ({ fsPath: p, scheme: 'file' }), joinPath: (b, ...p) => ({ fsPath: [b.fsPath || b, ...p].join('/'), scheme: 'file' }) },
        EventEmitter: class EventEmitter { constructor() { this._l = []; } get event() { return cb => { this._l.push(cb); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(cb => cb(d)); } },
    }
};
Module._resolveFilename = (req, parent, ...rest) =>
    req === 'vscode' ? '__yamlink_vscode_stub__' : _originalResolve(req, parent, ...rest);

require('../src/cli/index.js');
