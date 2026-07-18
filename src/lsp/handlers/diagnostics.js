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
