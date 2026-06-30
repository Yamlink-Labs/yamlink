const vscode = require('vscode');
const crypto = require('crypto');
const { collectHealthStats } = require('./health/healthStats');
const { buildHealthHtml } = require('./health/healthHtml');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { openNoteTarget } = require('./navigation/openNoteTarget');

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

    panel.webview.onDidReceiveMessage(async (message) => {
        // Open a node file
        if (message.command === 'openNode') {
            openNoteTarget(message.id, { preview: false }).catch(() => {});
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

        if (message.command === 'createSchemaFromCluster') {
            let rawFields = [];
            if (Array.isArray(message.fields)) {
                rawFields = message.fields;
            } else if (typeof message.fields === 'string') {
                try { rawFields = JSON.parse(message.fields); } catch { rawFields = []; }
            }
            const fields = rawFields.map((f) => String(f || '').trim()).filter(Boolean);
            const noteType = String(message.type || '').trim().toLowerCase() || null;
            await createSchemaNote({ type: noteType, fields });
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

/**
 * Create a schema note for the given type and fields.
 * If type is null, prompts the user via VS Code input box.
 * Shared by the health panel webview button and the yamlink.proposeSchema command.
 *
 * @param {{ type: string|null, fields: string[] }} opts
 * @returns {Promise<void>}
 */
async function createSchemaNote({ type, fields }) {
    try {
        const workspaceRoot = getPrimaryWorkspaceRoot(vscode.workspace.workspaceFolders);
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace root available for schema creation.');
            return;
        }

        let noteType = String(type || '').trim().toLowerCase();
        if (!noteType) {
            noteType = String(await vscode.window.showInputBox({
                prompt: 'Type name for the new schema note',
                placeHolder: 'contact'
            }) || '').trim().toLowerCase();
        }
        if (!noteType) return;

        const schemaId = `schema-${noteType}`;
        const schemaBody = [
            '---',
            `id: ${schemaId}`,
            'type: schema',
            `for: ${noteType}`,
            'fields:',
            ...(fields.length ? fields.map((f) => `  - ${f}`) : ['  - name']),
            '---',
            ''
        ].join('\n');

        const targetUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), `${schemaId}.md`);
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(schemaBody, 'utf8'));
        const document = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(document, { preview: false });
        vscode.window.showInformationMessage(`Schema note created: ${schemaId}.md`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create schema note: ${error.message || String(error)}`);
    }
}

module.exports = { openHealthPanel, updatePanel, createSchemaNote };
