// src/features/viewCodeLens.js
// CodeLens provider for !view blocks — shows "▶ Run" / "✕ Close" above each block.

const vscode = require('vscode');

/** @param {import('vscode').ExtensionContext} context @param {(() => string|null)|null} getOpenViewDocumentPath @returns {import('vscode').CodeLensProvider & { refresh: () => void }} */
function registerViewCodeLens(context, getOpenViewDocumentPath) {
    const emitter = new vscode.EventEmitter();

    const provider = {
        onDidChangeCodeLenses: emitter.event,

        refresh() {
            emitter.fire();
        },

        provideCodeLenses(document) {
            if (document.languageId !== 'markdown') return [];
            const lines = document.getText().split('\n');
            const lenses = [];
            const openDocumentPath = typeof getOpenViewDocumentPath === 'function'
                ? getOpenViewDocumentPath()
                : null;
            const open = !!openDocumentPath && document.uri?.fsPath === openDocumentPath;
            let viewIndex = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trimStart().startsWith('!view ')) {
                    const range = new vscode.Range(i, 0, i, lines[i].length);
                    const idx = viewIndex;
                    lenses.push(new vscode.CodeLens(range, {
                        title: open ? '✕ Close view' : '▶ Run',
                        command: open ? 'yamlink.closeViewPanel' : 'yamlink.runViewsAt',
                        arguments: [idx]
                    }));
                    viewIndex++;
                }
            }
            return lenses;
        }
    };

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'markdown' }, provider)
    );
    context.subscriptions.push(emitter);

    return provider;
}

module.exports = { registerViewCodeLens };
