'use strict';

const path = require('path');
const fs   = require('fs');

const { respond, respondError, notify, log } = require('../transport');
const { initializeVaultService }              = require('../vaultService');
const { uriToPath, primeLinkTokenIndex }      = require('../utils');
const { COMMANDS }                            = require('./executeCommand');
const { semanticLegend }                      = require('./semanticTokens');

const { version } = require('../../../package.json');

async function handleInitialize(msg, state) {
    const params = msg.params || {};

    const rootUri = params.rootUri
        || (Array.isArray(params.workspaceFolders) && params.workspaceFolders[0]
            ? params.workspaceFolders[0].uri : null);

    if (rootUri) state.vaultPath = uriToPath(rootUri);

    if (!state.vaultPath || !fs.existsSync(state.vaultPath)) {
        respondError(msg.id, -32002, 'Vault path not found: ' + state.vaultPath);
        return;
    }

    state.workspaceFolders = [{ uri: { fsPath: state.vaultPath }, name: path.basename(state.vaultPath) }];
    try {
        await initializeVaultService(state);
        primeLinkTokenIndex(state);
    } catch (error) {
        respondError(msg.id, -32603, 'Failed to initialize Yamlink vault: ' + error.message);
        return;
    }

    respond(msg.id, {
        capabilities: {
            textDocumentSync: 2, // Incremental
            completionProvider: {
                triggerCharacters: ['[', ':'],
                resolveProvider:   true
            },
            hoverProvider:           true,
            inlayHintProvider:       true,
            semanticTokensProvider:  {
                legend: semanticLegend(),
                full: true
            },
            documentLinkProvider:    {},
            documentHighlightProvider: true,
            documentFormattingProvider: true,
            definitionProvider:      true,
            referencesProvider:      true,
            callHierarchyProvider:   true,
            documentSymbolProvider:  true,
            selectionRangeProvider:  true,
            foldingRangeProvider:    true,
            workspaceSymbolProvider: true,
            renameProvider:          { prepareProvider: true },
            codeActionProvider:      { codeActionKinds: ['quickfix', 'refactor.rewrite'] },
            diagnosticProvider:      {
                interFileDependencies: false,
                workspaceDiagnostics:  true
            },
            experimental: {
                workspaceCodeActionProvider: true
            },
            executeCommandProvider:  {
                commands: [
                    COMMANDS.NOTE_INTELLIGENCE,
                    COMMANDS.NOTE_ARC,
                    COMMANDS.FIELD_CATEGORY,
                    COMMANDS.ADD_MISSING_FIELDS,
                    COMMANDS.SCAFFOLD_IDENTITY
                ]
            }
        },
        serverInfo: { name: 'yamlink-lsp', version }
    });
}

function handleInitializedNotification(_msg, state) {
    notify('client/registerCapability', {
        registrations: [{
            id:     'yamlink-md-watcher',
            method: 'workspace/didChangeWatchedFiles',
            registerOptions: {
                watchers: [{ globPattern: '**/*.md', kind: 7 }]
            }
        }]
    });
    log('Sent client/registerCapability for **/*.md (vault: ' + state.vaultPath + ')');
}

function handleCancelRequest(msg, state) {
    const id = msg.params && msg.params.id;
    if (id != null) state.cancelledIds.add(id);
}

module.exports = { handleInitialize, handleInitializedNotification, handleCancelRequest };
