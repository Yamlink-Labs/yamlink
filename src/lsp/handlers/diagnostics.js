'use strict';

const { respond, respondImmediate } = require('../transport');
const { collectWorkspaceDiagnostics, collectTextDiagnostics } = require('../vaultService');

async function handleTextDocumentDiagnostic(msg, state) {
    // A watched-file change may have triggered a debounced rebuild that hasn't
    // completed yet. Waiting for it here (when one is in flight) means a pull
    // request answers with post-rebuild-fresh data instead of racing ahead of
    // it — the client asked "is this valid right now," and "right now" should
    // include a rebuild the server already knows is imminent, not a stale
    // snapshot from before it.
    await state.vaultService.flushPendingRebuild();
    const uri = msg?.params?.textDocument?.uri || null;
    const diagnostics = uri ? collectTextDiagnostics(uri, state) : [];
    respond(msg.id, { kind: 'full', items: diagnostics });
}

async function handleWorkspaceDiagnostic(msg, state) {
    // Same rebuild race `handleTextDocumentDiagnostic` above already guards
    // against, unaudited here until now — a workspace-wide diagnostics scan
    // reads `getIndex()` fresh per file inside `collectWorkspaceDiagnostics`,
    // so starting it while a debounced rebuild is still in flight could scan
    // a stale, pre-rebuild index across the whole vault instead of the
    // freshly-edited state the client actually expects.
    if (state && state.vaultService && typeof state.vaultService.flushPendingRebuild === 'function') {
        await state.vaultService.flushPendingRebuild();
    }
    respondImmediate(msg.id, {
        items: await collectWorkspaceDiagnostics(state, msg.id, {
            workDoneToken: msg?.params?.workDoneToken,
            partialResultToken: msg?.params?.partialResultToken
        })
    });
}

module.exports = {
    handleTextDocumentDiagnostic,
    handleWorkspaceDiagnostic
};
