const vscode = require('vscode');
const { getIndex } = require('../core/indexService');
const { collectHealthStats } = require('./health/healthStats');
const { buildHealthHtml } = require('./health/healthHtml');

let panel = null;

function openHealthPanel(context) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        updatePanel();
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'yamlink.healthPanel',
        'Vault Health',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.onDidReceiveMessage(message => {
        const idIndex = getIndex();

        // Open a node file
        if (message.command === 'openNode') {
            const filePath = idIndex.get(message.id);
            if (filePath) {
                vscode.workspace.openTextDocument(filePath).then(doc => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
            }
        }

        // Open !view panel for a type
        if (message.command === 'openView') {
            const { openViewPanel } = require('./viewPanel');
            openViewPanel(context, `# ${message.label}\n\n${message.query}\n`);
        }

        // Open VS Code Problems panel for broken links
        if (message.command === 'openProblems') {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }

        // Open !view * for all nodes
        if (message.command === 'openAllNodes') {
            const { openViewPanel } = require('./viewPanel');
            openViewPanel(context, '# All Nodes\n\n!view *\n');
        }

    }, null, context.subscriptions);

    panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);

    updatePanel();
}

function updatePanel() {
    if (!panel) return;
    panel.webview.html = buildHealthHtml(collectHealthStats());
}

module.exports = { openHealthPanel, updatePanel };
