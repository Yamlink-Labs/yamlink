'use strict';

const { respond, respondImmediate } = require('../transport');
const { collectWorkspaceDiagnostics, collectTextDiagnostics } = require('../vaultService');

function handleTextDocumentDiagnostic(msg, state) {
    const uri = msg?.params?.textDocument?.uri || null;
    const diagnostics = uri ? collectTextDiagnostics(uri, state) : [];
    respond(msg.id, { kind: 'full', items: diagnostics });
}

async function handleWorkspaceDiagnostic(msg, state) {
    respondImmediate(msg.id, {
        items: await collectWorkspaceDiagnostics(state, msg.id)
    });
}

module.exports = {
    handleTextDocumentDiagnostic,
    handleWorkspaceDiagnostic
};
