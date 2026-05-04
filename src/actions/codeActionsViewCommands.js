const vscode = require('vscode');
const { computeSuggestionsForNode } = require('../engine/suggestions');
const { buildEntityHubModel } = require('../features/entityHubModel');
const { getFieldsCache, getPathIndex } = require('../core/indexService');
const { getTypes: getRegisteredTypes } = require('../registries/typeRegistry');
const {
    defaultSelectClauseForType,
    getSchemaBackedDefaultSortField,
    buildTypeViewQuery,
    revealDocumentAndRunViews,
    runViewRefinementBuilder,
    runViewRefinementByIndex
} = require('./viewBuilder');

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildSmartStarterItems(activeDocument, noteId) {
    if (!activeDocument || !noteId) return [];

    const idIndex = getPathIndex();
    const fieldsCache = getFieldsCache();
    const model = buildEntityHubModel(noteId, idIndex, fieldsCache);
    const docText = activeDocument.getText();
    const suggestions = computeSuggestionsForNode(noteId, docText, { keepExisting: false });
    const items = [];
    const seen = new Set();

    function pushItem(label, query, detail) {
        const flatLabel = String(label || '').trim();
        const flatQuery = String(query || '').trim();
        if (!flatLabel || !flatQuery || seen.has(flatQuery)) return;
        seen.add(flatQuery);
        items.push({
            label: `Smart: ${flatLabel}`,
            query: flatQuery,
            detail: String(detail || '').trim() || 'Yamlink thinks this is a useful next view from the note you are in.'
        });
    }

    for (const recipe of model.recipes.slice(0, 5)) {
        if (recipe.inserted) continue;
        pushItem(recipe.title, recipe.queryText, recipe.description);
    }

    for (const suggestion of suggestions.slice(0, 5)) {
        pushItem(suggestion.title, suggestion.queryText, suggestion.description);
    }

    const nodeType = String(model.nodeFields?.type || '').trim().toLowerCase();
    if (nodeType) {
        pushItem(
            `Latest ${capitalize(nodeType)}s`,
            buildTypeViewQuery(nodeType, 'smart', {
                label: `Latest ${capitalize(nodeType)}s`,
                sortField: getSchemaBackedDefaultSortField(nodeType) || 'created',
                sortDirection: 'desc',
                limit: 10
            }),
            `A quick operational table for notes like this ${nodeType}.`
        );
    }

    pushItem(
        'Backlinks to this note',
        '!view incoming *',
        `Everything already pointing at ${noteId}.`
    );

    return items;
}

async function buildStarterViewQuery(activeDocument, getTypes) {
    const noteId = activeDocument ? (getPathIndex().get(activeDocument.uri.fsPath) ?? null) : null;
    const typeProvider = typeof getTypes === 'function' ? getTypes : getRegisteredTypes;
    const knownTypes = Array.from(typeProvider()).sort();
    const noteFields = noteId ? (getFieldsCache().get(noteId) || {}) : {};
    const smartItems = buildSmartStarterItems(activeDocument, noteId);

    function makeItem(label, query, detail) {
        const compact = query.replace(/\n/g, ' · ');
        return { label, description: compact, query, detail };
    }

    const items = [
        ...smartItems.map(i => ({ ...i, description: i.query.replace(/\n/g, ' · ') })),
        { label: '$(edit) Custom query…', description: 'Type a !view query directly', query: '__custom__', detail: 'Enter any query text by hand' },
        makeItem('All nodes', '!view *', 'Browse the whole vault'),
        makeItem('Tasks', '!view tasks', 'All task rows across the vault'),
        makeItem('Open tasks', '!view open-tasks', 'Only incomplete tasks'),
        makeItem('Done tasks', '!view done-tasks', 'Only completed tasks'),
        makeItem('Overdue tasks', '!view overdue', 'Incomplete tasks with dates before today'),
        makeItem('Undated tasks', '!view undated-tasks', 'Tasks that still need a date'),
        makeItem('Calendar', '!view calendar', 'All dated tasks, sorted by date'),
        makeItem('Today', '!view today', 'Tasks due today'),
        makeItem('Upcoming', '!view upcoming', 'Tasks due in the next two weeks')
    ];

    if (noteId && !smartItems.some(item => item.query === '!view incoming *')) {
        items.push(makeItem('Backlinks to this note', '!view incoming *', `See what links to ${noteId}`));
    }

    for (const type of knownTypes) {
        const q = `!view ${type}${defaultSelectClauseForType(type)}`;
        items.push(makeItem(`${type} table`, q, `Start with ${type} nodes`));
    }

    const picked = await vscode.window.showQuickPick(items, {
        title: 'Yamlink — Insert view block',
        placeHolder: 'Pick a query or type to filter',
        matchOnDescription: true,
        matchOnDetail: true
    });
    if (!picked) return null;
    if (picked.query === '__custom__') {
        const raw = await vscode.window.showInputBox({
            title: 'Custom view query',
            prompt: 'Enter a !view query',
            placeHolder: '!view contact where status = active sort date desc',
            validateInput: v => (v && v.trim().startsWith('!view')) ? null : 'Query must start with !view'
        });
        return raw ? raw.trim() : null;
    }
    return picked.query;
}

function registerViewCommands(context, getTypes) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.insertViewBlock', async (document, queryText, sourceType) => {
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'markdown') {
                    vscode.window.showInformationMessage('Yamlink: Open a Markdown note to insert a view block.');
                    return;
                }
                document = editor.document;
            }

            if (!queryText) {
                queryText = await buildStarterViewQuery(document, getTypes);
                if (!queryText) return;
            }

            const text = document.getText();
            const lastLine = document.lineCount - 1;
            const lastChar = document.lineAt(lastLine).text.length;

            let prefix = '';
            if (!text.endsWith('\n\n')) {
                prefix = text.endsWith('\n') ? '\n' : '\n\n';
            }

            const selectClause = sourceType ? defaultSelectClauseForType(sourceType) : '';
            const headingLabel = sourceType
                ? `${capitalize(sourceType)}s`
                : queryText.replace(/^!view\s+/i, '').split('\n')[0].trim() || 'View';
            const insertion = `${prefix}## ${headingLabel}\n\n${queryText}${selectClause}\n`;

            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(lastLine, lastChar), insertion);

            await vscode.workspace.applyEdit(edit);
            await document.save();
            await revealDocumentAndRunViews(document);

            vscode.window.showInformationMessage(
                sourceType
                    ? `Yamlink: Inserted !view ${sourceType} block`
                    : 'Yamlink: Inserted view block'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.queryBuilder', async () => {
            await vscode.commands.executeCommand('yamlink.insertViewBlock');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.refineViewBlock', async (document, range) => {
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'markdown') {
                    vscode.window.showInformationMessage('Yamlink: Open a Markdown note to refine a view block.');
                    return;
                }
                document = editor.document;
                range = editor.selection;
            }

            const refined = await runViewRefinementBuilder(document, range);
            if (!refined || !refined.nextText) return;

            const edit = new vscode.WorkspaceEdit();
            const start = new vscode.Position(refined.start, 0);
            const endLine = Math.max(refined.end - 1, refined.start);
            const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
            edit.replace(document.uri, new vscode.Range(start, end), refined.nextText);

            await vscode.workspace.applyEdit(edit);
            await document.save();
            await revealDocumentAndRunViews(document);
            vscode.window.showInformationMessage('Yamlink: Refined view block');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.refineViewBlockAtIndex', async (document, queryIndex) => {
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'markdown') {
                    vscode.window.showInformationMessage('Yamlink: Open a Markdown note to refine a view block.');
                    return;
                }
                document = editor.document;
            }

            const refined = await runViewRefinementByIndex(document, Number(queryIndex));
            if (!refined || !refined.nextText) return;

            const edit = new vscode.WorkspaceEdit();
            const start = new vscode.Position(refined.start, 0);
            const endLine = Math.max(refined.end - 1, refined.start);
            const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
            edit.replace(document.uri, new vscode.Range(start, end), refined.nextText);

            await vscode.workspace.applyEdit(edit);
            await document.save();
            await revealDocumentAndRunViews(document);
            vscode.window.showInformationMessage('Yamlink: Refined view block');
        })
    );
}

module.exports = {
    buildStarterViewQuery,
    registerViewCommands
};
