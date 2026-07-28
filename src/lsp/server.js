'use strict';

/**
 * Yamlink LSP server — JSON-RPC 2.0 over stdio.
 *
 * Capabilities:
 *   - textDocument/completion       — [[wikilink completions + frontmatter key/value completions
 *   - completionItem/resolve       — richer documentation for a selected completion item
 *   - textDocument/hover            — note preview card for [[id]] links
 *   - textDocument/inlayHint        — frontmatter field hints + likely-missing-field nudges
 *   - textDocument/semanticTokens/full — Yamlink-aware wikilink + frontmatter token coloring
 *   - textDocument/documentLink     — clickable wikilinks across LSP editors
 *   - textDocument/documentHighlight — highlight same-note ID and wikilink references
 *   - textDocument/formatting       — frontmatter-aware normalization
 *   - textDocument/definition       — go-to-definition for [[id]] links
 *   - textDocument/prepareRename    — validate rename position before executing
 *   - textDocument/rename           — vault-wide ID rename
 *   - textDocument/references       — find all notes that link to an ID
 *   - textDocument/documentSymbols  — frontmatter fields + headings as symbols
 *   - textDocument/selectionRange   — nested structural selection for frontmatter + sections
 *   - textDocument/foldingRange     — fold frontmatter + heading sections
 *   - textDocument/codeAction       — broken-link quickfix
 *   - workspace/codeAction          — Yamlink batch quickfixes from workspace diagnostics
 *   - workspace/symbol              — vault-wide ID/name search
 *   - textDocument/publishDiagnostics — broken link warnings (push after rebuild)
 *   - $/cancelRequest               — cancel in-flight requests
 *   - window/logMessage             — surface engine messages to the editor UI
 *
 * What stays VS Code-exclusive: Note Report, Graph, Calendar, Health panels.
 * Transport: Content-Length framing on stdin/stdout. Errors on stderr.
 */

const { startTransport, respond, respondError, log, setResponseGuard } = require('./transport');
const { VaultService } = require('../core/vaultService');
const { RequestCancelledError } = require('./cancellation');

const { handleInitialize, handleInitializedNotification, handleCancelRequest } = require('./handlers/lifecycle');
const { handleDidOpen, handleDidChange, handleDidClose, handleDidChangeWatchedFiles } = require('./handlers/sync');
const { handleCompletion, handleCompletionResolve }    = require('./handlers/completion');
const { handleHover }                                  = require('./handlers/hover');
const { handleInlayHint }                              = require('./handlers/inlayHint');
const { handleSemanticTokensFull }                     = require('./handlers/semanticTokens');
const { handleFormatting }                             = require('./handlers/formatting');
const { handleDefinition, handleReferences, handleDocumentLink, handleDocumentHighlight } = require('./handlers/navigation');
const { handlePrepareRename, handleRename }            = require('./handlers/rename');
const { handleDocumentSymbols, handleWorkspaceSymbol } = require('./handlers/symbols');
const { handleSelectionRange, handleFoldingRange }     = require('./handlers/structure');
const { handlePrepareCallHierarchy, handleIncomingCalls, handleOutgoingCalls } = require('./handlers/callHierarchy');
const { handleCodeAction, handleWorkspaceCodeAction }  = require('./handlers/codeAction');
const { handleTextDocumentDiagnostic, handleWorkspaceDiagnostic } = require('./handlers/diagnostics');
const { handleExecuteCommand }                         = require('./handlers/executeCommand');
const { uriToPath }                                    = require('./utils');

// ── Message router ─────────────────────────────────────────────────────────────

function route(msg, state) {
    if (!msg || typeof msg !== 'object') return;

    const { method, id } = msg;

    if (method === 'initialize')   { return handleInitialize(msg, state); }
    if (method === 'initialized')  { handleInitializedNotification(msg, state); return; }
    if (method === 'shutdown')     { state.shutdownReceived = true; respond(id, null); return; }
    if (method === 'exit') {
        const code = state.shutdownReceived ? 0 : 1;
        // A watched-file rebuild is debounced (notifyFileChange) and may still be
        // pending when exit arrives — waiting for it here (rather than exiting
        // immediately) is what guarantees whatever it triggers (e.g. republishing
        // diagnostics for open documents) isn't silently dropped by a fast exit
        // racing ahead of the debounce timer.
        Promise.resolve(state.vaultService.flushPendingRebuild())
            .catch(() => {})
            .then(() => {
                setImmediate(() => process.stdout.end(() => process.exit(code)));
            });
        return;
    }

    if (method === '$/cancelRequest') { handleCancelRequest(msg, state); return; }

    if (method === 'textDocument/didOpen')              { handleDidOpen(msg, state);               return; }
    if (method === 'textDocument/didChange')            { handleDidChange(msg, state);             return; }
    if (method === 'textDocument/didClose')             { handleDidClose(msg, state);              return; }
    if (method === 'textDocument/completion')           { return handleCompletion(msg, state); }
    if (method === 'completionItem/resolve')            { handleCompletionResolve(msg, state);     return; }
    if (method === 'textDocument/hover')                { handleHover(msg, state);                 return; }
    if (method === 'textDocument/inlayHint')            { handleInlayHint(msg, state);             return; }
    if (method === 'textDocument/semanticTokens/full')  { handleSemanticTokensFull(msg, state);    return; }
    if (method === 'textDocument/documentLink')         { handleDocumentLink(msg, state);          return; }
    if (method === 'textDocument/documentHighlight')    { handleDocumentHighlight(msg, state);     return; }
    if (method === 'textDocument/formatting')           { handleFormatting(msg, state);            return; }
    if (method === 'textDocument/definition')           { handleDefinition(msg, state);            return; }
    if (method === 'textDocument/prepareRename')        { return handlePrepareRename(msg, state); }
    if (method === 'textDocument/rename')               { return handleRename(msg, state); }
    if (method === 'textDocument/references')           { return handleReferences(msg, state); }
    if (method === 'textDocument/prepareCallHierarchy') { return handlePrepareCallHierarchy(msg, state); }
    if (method === 'callHierarchy/incomingCalls')       { return handleIncomingCalls(msg, state); }
    if (method === 'callHierarchy/outgoingCalls')       { return handleOutgoingCalls(msg, state); }
    if (method === 'textDocument/documentSymbols')      { handleDocumentSymbols(msg, state);       return; }
    if (method === 'textDocument/selectionRange')       { handleSelectionRange(msg, state);        return; }
    if (method === 'textDocument/foldingRange')         { handleFoldingRange(msg, state);          return; }
    if (method === 'textDocument/codeAction')           { handleCodeAction(msg, state);            return; }
    if (method === 'textDocument/diagnostic')           { return handleTextDocumentDiagnostic(msg, state); }
    if (method === 'workspace/symbol')                  { return handleWorkspaceSymbol(msg, state); }
    if (method === 'workspace/diagnostic')              { return handleWorkspaceDiagnostic(msg, state); }
    if (method === 'workspace/codeAction')              { handleWorkspaceCodeAction(msg, state);   return; }
    if (method === 'workspace/executeCommand')          { handleExecuteCommand(msg, state);        return; }
    if (method === 'workspace/didChangeWatchedFiles')   { return handleDidChangeWatchedFiles(msg, state); }

    if (id !== undefined && id !== null) {
        respondError(id, -32601, `Method not found: ${method}`);
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

function run(options) {
    const state = {
        vaultPath:        options.vaultPath || process.cwd(),
        workspaceFolders: [],
        openDocs:         new Map(),
        openDocVersions:  new Map(),
        linkTokenIndex:   null,
        uriToPath,
        cancelledIds:     new Set(),
        shutdownReceived: false,
        vaultService:     new VaultService()
    };

    log('Starting — vault: ' + state.vaultPath);
    setResponseGuard((id) => {
        if (!state.cancelledIds.has(id)) return false;
        state.cancelledIds.delete(id);
        return true;
    });

    startTransport((msg) => {
        Promise.resolve()
            .then(() => route(msg, state))
            .catch((err) => {
                if (err instanceof RequestCancelledError) {
                    return;
                }
                log('Unhandled error: ' + (err && err.message ? err.message : String(err)));
                if (msg && msg.id != null) {
                    respondError(msg.id, -32603, 'Internal error');
                }
            });
    });
}

module.exports = { run };
