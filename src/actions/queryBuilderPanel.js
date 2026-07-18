'use strict';

const vscode = require('vscode');
const { getFieldsCache, getPathIndex } = require('../core/indexService');
const { appendMutationEvents } = require('../runtime/mutationEventLog');
const { parseSingleViewBlock } = require('../engine/query');
const { revealDocumentAndRunViews, getViewBlockAtRange } = require('./viewBuilderCore');
const {
    deriveKnownTypes,
    buildStateFromQuery,
    buildPreviewFromState,
    buildBuilderOptions,
    normalizeBuilderState
} = require('./queryBuilderModel');
const { getWebviewHtml } = require('./queryBuilder/queryBuilderHtml');

let builderPanel = null;
let builderSession = null;

function getBuilderEventNoteId(session) {
    return session?.noteId || '__vault__';
}

function positionAfterInsertedText(start, text) {
    const raw = String(text || '');
    const lines = raw.split('\n');
    if (lines.length === 1) {
        return new vscode.Position(start.line, start.character + lines[0].length);
    }
    return new vscode.Position(
        start.line + lines.length - 1,
        lines[lines.length - 1].length
    );
}

function deriveHeadingLabelFromQuery(queryText, sourceType = null) {
    if (sourceType) {
        return sourceType === '*' ? 'All Nodes' : `${sourceType.charAt(0).toUpperCase()}${sourceType.slice(1)}s`;
    }
    const parsed = parseSingleViewBlock(String(queryText || '').split('\n'));
    if (!parsed) return 'View';
    if (parsed.label) return parsed.label;
    if (parsed.type === 'tasks') {
        const preset = String(parsed.preset || parsed.shorthand || parsed.type);
        return preset
            .split(/[-\s]+/)
            .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
            .join(' ');
    }
    if (parsed.incoming) {
        return parsed.type === '*'
            ? 'Backlinks'
            : `Incoming ${parsed.type.charAt(0).toUpperCase()}${parsed.type.slice(1)}`;
    }
    if (parsed.type === '*') return 'All Nodes';
    return `${parsed.type.charAt(0).toUpperCase()}${parsed.type.slice(1)}s`;
}

function buildBuilderModel(session) {
    const fieldsCache = getFieldsCache();
    const knownTypes = deriveKnownTypes(fieldsCache);
    const state = normalizeBuilderState(session.state, { fieldsCache, knownTypes });
    const options = buildBuilderOptions(state, { fieldsCache, knownTypes });
    const preview = buildPreviewFromState(state, {
        fieldsCache,
        knownTypes,
        contextNodeId: session.noteId || null
    });
    const modeLabel = session.blockInfo ? 'Replace current !view block' : 'Insert new !view block';
    return {
        state,
        options,
        preview,
        meta: {
            noteId: session.noteId || null,
            noteType: session.noteType || '',
            modeLabel,
            applyLabel: session.blockInfo ? 'Replace block' : 'Insert block'
        }
    };
}

function buildInitialViewPanelState(state = {}) {
    return {
        activeTab: 0,
        tabs: [{
            search: '',
            filter: 'all',
            columnFilters: {},
            page: 1,
            pageSize: 50,
            hiddenCols: [],
            columnOrder: [],
            columnWidths: {},
            sort: null,
            layout: state.renderLayout || 'table',
            matrixColType: state.matrixColType || '',
            scatterX: state.scatterX || '',
            scatterY: state.scatterY || '',
            barGroupBy: state.barGroupBy || ''
        }]
    };
}

async function applyBuilderQuery(session, queryText) {
    const document = session.document;
    if (!document) return false;

    if (session.blockInfo) {
        const start = new vscode.Position(session.blockInfo.start, 0);
        const endLine = Math.max(session.blockInfo.end - 1, session.blockInfo.start);
        const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(start, end), queryText);
        await vscode.workspace.applyEdit(edit);
        await document.save();
        await revealDocumentAndRunViews(document);
        vscode.window.showInformationMessage('Yamlink: Replaced !view block');
        return true;
    }

    const text = document.getText();
    const lastLine = document.lineCount - 1;
    const lastChar = document.lineAt(lastLine).text.length;
    let prefix = '';
    if (!text.endsWith('\n\n')) prefix = text.endsWith('\n') ? '\n' : '\n\n';
    const headingLabel = deriveHeadingLabelFromQuery(queryText, session.sourceType || null);
    const insertion = `${prefix}## ${headingLabel}\n\n${queryText}\n`;
    const insertionStart = new vscode.Position(lastLine, lastChar);
    const insertionEnd = positionAfterInsertedText(insertionStart, insertion);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertionStart, insertion);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    await revealDocumentAndRunViews(document, { selection: insertionEnd });
    vscode.window.showInformationMessage('Yamlink: Inserted view block');
    return true;
}

async function openQueryBuilderPanel(context, options = {}) {
    const document = options.document || vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'markdown') {
        vscode.window.showInformationMessage('Yamlink: Open a Markdown note to use the Query Builder.');
        return;
    }

    const fieldsCache = getFieldsCache();
    const pathIndex = getPathIndex();
    const noteId = pathIndex.get(document.uri.fsPath) || null;
    const noteFields = noteId ? (fieldsCache.get(noteId) || {}) : {};
    const noteType = String(noteFields.type || '').trim().toLowerCase() || '';
    const activeEditor = vscode.window.activeTextEditor;
    const selection = options.range || activeEditor?.selection || new vscode.Range(0, 0, 0, 0);
    const blockInfo = options.blockInfo || getViewBlockAtRange(document, selection);
    const knownTypes = deriveKnownTypes(fieldsCache);
    const sourceQuery = blockInfo?.query || null;
    const defaultType = String(options.sourceType || noteType || knownTypes[0] || '*').trim().toLowerCase();
    let state = buildStateFromQuery(sourceQuery, { fieldsCache, knownTypes, defaultType });
    if (!sourceQuery && options.sourceType) {
        state.type = String(options.sourceType || '').trim().toLowerCase() || state.type;
    }

    builderSession = {
        document,
        blockInfo: sourceQuery ? blockInfo : null,
        noteId,
        noteType,
        sourceType: options.sourceType || null,
        state
    };

    appendMutationEvents([{
        type: 'query_builder_opened',
        noteId: getBuilderEventNoteId(builderSession),
        field: 'query',
        oldValue: null,
        newValue: sourceQuery ? 'refine' : 'new',
        source: 'vscode',
        cause: 'query_builder_open',
        meta: {
            noteType: noteType || null,
            mode: sourceQuery ? 'refine' : 'new'
        }
    }]);

    if (!builderPanel) {
        builderPanel = vscode.window.createWebviewPanel(
            'yamlinkQueryBuilder',
            'Yamlink Query Builder',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        builderPanel.onDidDispose(() => {
            builderPanel = null;
            builderSession = null;
        });
        builderPanel.webview.html = getWebviewHtml(builderPanel.webview);
        builderPanel.webview.onDidReceiveMessage(async (message) => {
            if (!builderSession) return;
            if (message?.type === 'ready' || message?.ready) {
                builderPanel?.webview.postMessage({ type: 'render', model: buildBuilderModel(builderSession) });
                return;
            }
            if (message?.type === 'stateChanged') {
                builderSession.state = normalizeBuilderState(message.state || {}, { fieldsCache: getFieldsCache(), knownTypes: deriveKnownTypes(getFieldsCache()) });
                builderPanel?.webview.postMessage({ type: 'render', model: buildBuilderModel(builderSession) });
                return;
            }
            if (message?.type === 'apply') {
                const model = buildBuilderModel(builderSession);
                await applyBuilderQuery(builderSession, model.preview.queryText);
                appendMutationEvents([{
                    type: 'query_builder_applied',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: model.preview.queryText,
                    source: 'vscode',
                    cause: 'query_builder_apply',
                    meta: {
                        mode: builderSession.blockInfo ? 'replace' : 'insert',
                        layout: builderSession.state?.renderLayout || 'table'
                    }
                }]);
                return;
            }
            if (message?.type === 'openPreview') {
                const model = buildBuilderModel(builderSession);
                const { openViewPanel } = require('../features/viewPanel');
                const previewText = builderSession.noteId
                    ? `---\nid: ${builderSession.noteId}\n${builderSession.noteType ? `type: ${builderSession.noteType}\n` : ''}---\n\n## Query Builder Preview\n\n${model.preview.queryText}\n`
                    : `## Query Builder Preview\n\n${model.preview.queryText}\n`;
                openViewPanel(
                    context,
                    previewText,
                    null,
                    null,
                    0,
                    buildInitialViewPanelState(builderSession.state)
                );
                appendMutationEvents([{
                    type: 'query_builder_preview_opened',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: model.preview.queryText,
                    source: 'vscode',
                    cause: 'query_builder_open_preview',
                    meta: {
                        layout: builderSession.state?.renderLayout || 'table'
                    }
                }]);
                return;
            }
            if (message?.type === 'copied') {
                appendMutationEvents([{
                    type: 'query_builder_copied',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: buildBuilderModel(builderSession).preview.queryText,
                    source: 'vscode',
                    cause: 'query_builder_copy'
                }]);
                vscode.window.setStatusBarMessage('Yamlink: Copied query to clipboard', 2500);
                return;
            }
            if (message?.type === 'copyFallback') {
                await vscode.env.clipboard.writeText(String(message.query || ''));
                appendMutationEvents([{
                    type: 'query_builder_copied',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: String(message.query || ''),
                    source: 'vscode',
                    cause: 'query_builder_copy'
                }]);
                vscode.window.setStatusBarMessage('Yamlink: Copied query to clipboard', 2500);
            }
        });
    } else {
        builderPanel.reveal(vscode.ViewColumn.Beside);
    }

    builderPanel.title = sourceQuery ? 'Yamlink Query Builder — Refine View' : 'Yamlink Query Builder';
    builderPanel.webview.postMessage({ type: 'render', model: buildBuilderModel(builderSession) });
}

module.exports = {
    openQueryBuilderPanel
};
