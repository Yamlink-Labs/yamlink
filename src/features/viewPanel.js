const vscode = require('vscode');
const fs = require('fs');
const { getIndex, getPathIndex } = require('../core/indexService');
const { buildIndex, updateSingleFile, invalidateFileCache } = require('../core/index');
const { parseAllViewQueries, parseViewQuery, runQuery } = require('../engine/query');
const { writeFieldValue } = require('../core/writeField');
const { extractCanonicalIdFromFrontmatter } = require('../core/id');
const { buildViewExportModel, exportViewPdf } = require('../export/pdf');
const { createViewPanelController } = require('./view/viewPanelController');
const { appendMutationEvents } = require('../runtime/mutationEventLog');
const { renderPanel, buildWarningBanner } = require('./view/viewPanelHtml');
const {
    normaliseTableDisplayValue,
    buildTableEmptyStateTitle,
    buildEmptyStateHint,
    classifyQueryWarnings
} = require('./view/viewTableLogic');

/** @param {string} filePath @returns {void} */
function syncIndexAfterWrite(filePath) {
    if (!filePath) return;
    invalidateFileCache(filePath);
    const result = updateSingleFile(filePath, { force: true, workspaceFolders: vscode.workspace.workspaceFolders });
    if (result.needsFull && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }
}

/** @param {string} filePath @param {number|string} lineNumber @param {boolean} newDone @returns {Promise<boolean>} */
async function toggleTaskCheckbox(filePath, lineNumber, newDone) {
    if (!filePath || !lineNumber) return false;
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return false; }

    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lineIdx = Number(lineNumber) - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) return false;

    const original = lines[lineIdx];
    const updated = newDone
        ? original.replace(/^(\s*[-*]\s+)\[ \]/, '$1[x]')
        : original.replace(/^(\s*[-*]\s+)\[x\]/i, '$1[ ]');
    if (updated === original) return false;

    lines[lineIdx] = updated;
    const newContent = lines.join('\n');

    try {
        const targetUri = vscode.Uri.file(filePath);
        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
        if (openDoc) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                openDoc.positionAt(0),
                openDoc.positionAt(openDoc.getText().length)
            );
            edit.replace(targetUri, fullRange, newContent);
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) return false;
            if (openDoc.isDirty) await openDoc.save();
            appendTaskStatusMutationEvent(filePath, lineNumber, newDone);
            return true;
        }
        fs.writeFileSync(filePath, newContent, 'utf8');
        appendTaskStatusMutationEvent(filePath, lineNumber, newDone);
        return true;
    } catch (e) { return false; }
}

function appendTaskStatusMutationEvent(filePath, lineNumber, newDone) {
    if (!filePath || !lineNumber) return;
    const noteId = getPathIndex().get(filePath);
    if (!noteId) return;
    appendMutationEvents([{
        type: 'task_status_changed',
        noteId,
        field: `task:${lineNumber}`,
        oldValue: newDone ? 'open' : 'done',
        newValue: newDone ? 'done' : 'open'
    }]);
}

function ensureIndexBuilt() {
    if (getIndex().size === 0 && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }
}

async function openNode(noteId) {
    const resolvedId = noteId && noteId.includes('#') ? noteId.split('#')[0] : noteId;
    const fp = getIndex().get(resolvedId);
    if (!fp) return;
    try {
        const doc = await vscode.workspace.openTextDocument(fp);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    } catch (err) {
        console.error('Yamlink — openNode failed:', err.message);
    }
}

async function openReport(noteId) {
    const resolvedId = noteId && noteId.includes('#') ? noteId.split('#')[0] : noteId;
    const fp = getIndex().get(resolvedId);
    if (!fp) return;
    try {
        const doc = await vscode.workspace.openTextDocument(fp);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        await vscode.commands.executeCommand('yamlink.openHub');
    } catch (err) {
        console.error('Yamlink — openReport failed:', err.message);
    }
}

async function editCell(filePath, field, value) {
    return writeFieldValue(filePath, field, value);
}

async function refineQuery(sourceDocumentPath, queryIndex) {
    try {
        const doc = await vscode.workspace.openTextDocument(sourceDocumentPath);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        await vscode.commands.executeCommand('yamlink.refineViewBlockAtIndex', doc, queryIndex);
        return parseAllViewQueries(doc.getText());
    } catch (err) {
        console.error('Yamlink — refineQuery failed:', err.message);
        return null;
    }
}

async function exportQueryResult(format, queryList, queryIndex, visibleColumns, contextNodeId) {
    if (!queryList || !queryList[queryIndex]) return;
    const result = runQuery(queryList[queryIndex], contextNodeId || null);
    if (!result.success) {
        vscode.window.showErrorMessage(result.error || 'Could not export view');
        return;
    }
    const columns = Array.isArray(visibleColumns) && visibleColumns.length ? visibleColumns : result.columns;
    const rows = result.rows.map(row => {
        const out = {};
        for (const col of columns) out[col] = col === 'id' ? row.id : (row.fields[col] ?? '');
        return out;
    });

    const uri = await vscode.window.showSaveDialog({
        filters: format === 'csv'
            ? { CSV: ['csv'] }
            : format === 'json'
                ? { JSON: ['json'] }
                : { PDF: ['pdf'] },
        saveLabel: format === 'csv' ? 'Export CSV' : format === 'json' ? 'Export JSON' : 'Export PDF'
    });
    if (!uri) return;

    if (format === 'pdf') {
        const model = buildViewExportModel(queryList[queryIndex], contextNodeId || null);
        model.columns = columns;
        model.rows = rows;
        exportViewPdf(uri.fsPath, model);
        vscode.window.showInformationMessage(`Yamlink: Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to PDF`);
        return;
    }

    const content = format === 'csv' ? toCsv(columns, rows) : JSON.stringify(rows, null, 2);
    fs.writeFileSync(uri.fsPath, content, 'utf8');
    vscode.window.showInformationMessage(`Yamlink: Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${format.toUpperCase()}`);
}

/** @param {string[]} columns @param {Array<Record<string,any>>} rows @returns {string} */
function toCsv(columns, rows) {
    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = columns.map(esc).join(',');
    const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
    return header + '\n' + body;
}

/** @param {string} text @returns {string|null} */
function extractIdFromText(text) {
    return extractCanonicalIdFromFrontmatter(text);
}

const viewPanelController = createViewPanelController({
    parseAllViewQueries,
    extractIdFromText,
    ensureIndexBuilt,
    renderPanel,
    openNode,
    openReport,
    toggleTaskDone: toggleTaskCheckbox,
    editCell,
    exportQueryResult,
    refineQuery,
    syncIndexAfterWrite
});

module.exports = {
    openViewPanel: viewPanelController.openViewPanel,
    refreshViewPanel: viewPanelController.refreshViewPanel,
    isViewPanelOpen: viewPanelController.isViewPanelOpen,
    closeViewPanel: viewPanelController.closeViewPanel,
    getOpenViewDocumentPath: viewPanelController.getOpenViewDocumentPath,
    setViewPanelStateListener: viewPanelController.setViewPanelStateListener,
    parseAllViewQueries,
    parseViewQuery,
    writeFieldValue,
    toggleTaskCheckbox,
    normaliseTableDisplayValue,
    extractIdFromText,
    buildTableEmptyStateTitle,
    buildEmptyStateHint,
    classifyQueryWarnings,
    buildWarningBanner
};
