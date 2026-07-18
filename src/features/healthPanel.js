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
            const noteIds = Array.isArray(message.noteIds) ? message.noteIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
            await createSchemaNote({ type: noteType, fields, noteIds });
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
 * Create a schema note for the given type and fields, and — if the schema was
 * proposed from a detected cluster — optionally back-fill the new schema's
 * fields onto the existing member notes that inspired it. This is the second
 * half of the "vault writes its own schema" loop: detection and note-creation
 * already existed, but the schema was never written back onto the notes that
 * justified it in the first place.
 *
 * If type is null, prompts the user via VS Code input box.
 * Shared by the health panel webview button and the yamlink.proposeSchema command.
 *
 * @param {{ type: string|null, fields: string[], noteIds?: string[] }} opts
 * @returns {Promise<void>}
 */
async function createSchemaNote({ type, fields, noteIds = [] }) {
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

        if (fields.length && noteIds.length) {
            await maybeBackfillClusterMembers(noteType, fields, noteIds);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create schema note: ${error.message || String(error)}`);
    }
}

/**
 * Offers to write any of the schema's fields that are missing onto each of the
 * cluster's member notes (empty stub values, same convention as
 * yamlink.addMissingTemplateFields). Explicit opt-in — this writes to
 * potentially many files, so it must never happen silently.
 *
 * @param {string} noteType
 * @param {string[]} fields
 * @param {string[]} noteIds
 * @returns {Promise<void>}
 */
async function maybeBackfillClusterMembers(noteType, fields, noteIds) {
    const { getIndex, getFieldsCache } = require('../core/indexService');
    const { syncIndexAfterWrite } = require('../actions/nodeCreationHelpers');

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();

    const missingByNote = new Map();
    for (const noteId of noteIds) {
        const filePath = idIndex.get(noteId);
        if (!filePath) continue;
        const existing = fieldsCache.get(noteId) || {};
        const missing = fields.filter((f) => !(f in existing));
        if (missing.length) missingByNote.set(noteId, { filePath, missing });
    }

    if (!missingByNote.size) return;

    const totalFields = [...missingByNote.values()].reduce((sum, v) => sum + v.missing.length, 0);
    const choice = await vscode.window.showInformationMessage(
        `Also add the "${noteType}" schema's fields to the ${missingByNote.size} note(s) that inspired it? (${totalFields} field(s) total)`,
        'Add Fields',
        'Skip'
    );
    if (choice !== 'Add Fields') return;

    let notesUpdated = 0;
    for (const [, { filePath, missing }] of missingByNote) {
        const wrote = await insertMissingFieldStubs(filePath, missing);
        if (wrote) {
            syncIndexAfterWrite(filePath);
            notesUpdated++;
        }
    }

    vscode.window.showInformationMessage(
        `Yamlink: Back-filled ${notesUpdated} note(s) with the new "${noteType}" schema fields.`
    );
}

/**
 * Inserts empty `field:` stub lines just before the closing `---` of a note's
 * frontmatter. Same convention as yamlink.addMissingTemplateFields — this is
 * deliberately not writeFieldValue(), which treats an empty-string value as a
 * request to delete the field rather than add a blank one.
 *
 * If the file is already open in an editor, edits it there (and saves) so any
 * unsaved changes aren't clobbered by a raw filesystem write; otherwise writes
 * directly to disk.
 *
 * @param {string} filePath
 * @param {string[]} missingFields
 * @returns {Promise<boolean>}
 */
async function insertMissingFieldStubs(filePath, missingFields) {
    if (!missingFields.length) return false;

    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === filePath);
    const text = openDoc ? openDoc.getText() : (() => {
        try { return require('fs').readFileSync(filePath, 'utf8'); } catch { return null; }
    })();
    if (text === null) return false;

    const lines = text.split('\n');
    let closingDash = -1;
    let inFrontmatter = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].replace(/\r$/, '').trim();
        if (!inFrontmatter && trimmed === '---') { inFrontmatter = true; continue; }
        if (inFrontmatter && trimmed === '---') { closingDash = i; break; }
    }
    if (closingDash === -1) return false;

    const insertion = missingFields.map((f) => `${f}:`).join('\n') + '\n';

    if (openDoc) {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(openDoc.uri, new vscode.Position(closingDash, 0), insertion);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return false;
        if (openDoc.isDirty) await openDoc.save();
        return true;
    }

    try {
        const nextLines = lines.slice();
        nextLines.splice(closingDash, 0, ...insertion.split('\n').slice(0, -1));
        require('fs').writeFileSync(filePath, nextLines.join('\n'), 'utf8');
        return true;
    } catch {
        return false;
    }
}

module.exports = { openHealthPanel, updatePanel, createSchemaNote, insertMissingFieldStubs };
