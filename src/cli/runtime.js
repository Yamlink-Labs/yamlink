'use strict';

const path = require('path');
const { emitCliError } = require('./io');
const { VaultService } = require('../core/vaultService');
const { setMutationEventsProvider: setVaultPriorsMutationEventsProvider } = require('../intelligence/vaultPriors');
const { setMutationEventsProvider: setIntelligenceSnapshotMutationEventsProvider } = require('../intelligence/intelligenceSnapshots');
const { buildIndex, getFieldsCache } = require('../core/index');

function buildIndexQuietly(workspaceFolders) {
    // buildIndex() logs build-time diagnostics (duplicate ids, malformed
    // frontmatter, the summary line) via console.log/warn/error — meant for
    // the VS Code extension host console, not a CLI report. Every one of
    // these is already surfaced structurally by commands that care (doctor's
    // duplicateIds/malformedFiles rows), so raw console noise here is pure
    // duplication, not information — previously only console.log was
    // stubbed, so warn/error still leaked straight into every command's
    // output ahead of its actual formatted report.
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
        buildIndex(workspaceFolders);
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }
}

/**
 * @param {{
 *   json: boolean,
 *   error: unknown,
 *   code?: string,
 *   exitCode?: number,
 *   details?: any
 * }} options
 */
function failCli({ json, error, code = 'USER_ERROR', exitCode = 1, details }) {
    emitCliError({ json, error, code, exitCode, details });
}

function createWorkspaceFolders(vaultPath) {
    return [{ uri: { fsPath: vaultPath }, name: path.basename(vaultPath) }];
}

function createVaultService(workspaceFolders) {
    return new VaultService({
        workspaceFolders,
        buildIndex: () => buildIndexQuietly(workspaceFolders)
    });
}

function initializeCliMutationRuntime(vaultPath) {
    try {
        const mutLog = require('../runtime/mutationEventLog');
        mutLog.initMutationLog(path.join(vaultPath, '.yamlink', 'mutation-log.ndjson'));
        mutLog.setSnapshotFieldsCacheProvider(() => getFieldsCache());
        setVaultPriorsMutationEventsProvider(mutLog.getMutationEvents);
        setIntelligenceSnapshotMutationEventsProvider(mutLog.getMutationEvents);
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const nonce = Math.random().toString(36).slice(2, 8);
        const cliSessionId = `cli-${stamp}-${nonce}`;
        mutLog.setDefaultMutationContextProvider(() => ({ sessionId: cliSessionId, source: 'cli' }));
    } catch (_) {}
}

module.exports = {
    buildIndexQuietly,
    createVaultService,
    createWorkspaceFolders,
    failCli,
    initializeCliMutationRuntime
};
