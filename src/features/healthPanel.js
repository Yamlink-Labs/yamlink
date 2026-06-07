const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex } = require('../core/indexService');
const { collectHealthStats } = require('./health/healthStats');
const { buildHealthHtml } = require('./health/healthHtml');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');

let panel = null;
let _extensionUri = null;

/** @param {import('vscode').ExtensionContext} context @returns {void} */
function openHealthPanel(context) {
    _extensionUri = context.extensionUri;

    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        updatePanel();
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'yamlink.healthPanel',
        'Vault Health',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'features')]
        }
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

        const { openViewPanel } = require('./viewPanel');

        // Open !view panel for a type
        if (message.command === 'openView') {
            openViewPanel(context, `# ${message.label}\n\n${message.query}\n`);
        }

        // Open VS Code Problems panel for broken links
        if (message.command === 'openProblems') {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }

        // Open !view * for all nodes
        if (message.command === 'openAllNodes') {
            openViewPanel(context, '# All Nodes\n\n!view *\n');
        }

    }, null, context.subscriptions);

    panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);

    updatePanel();
}

/** @returns {void} */
function updatePanel() {
    if (!panel) return;
    const workspaceRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = panel.webview.cspSource;
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extensionUri, 'src', 'features', 'health', 'healthScript.js')
    );
    panel.webview.html = buildHealthHtml(collectHealthStats({ workspaceRoot }), { scriptUri, nonce, csp });
}

module.exports = { openHealthPanel, updatePanel };
