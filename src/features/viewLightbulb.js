'use strict';

const vscode = require('vscode');
const { parseAllViewQueries } = require('../engine/query');

function registerViewLightbulb(context) {
    const provider = {
        provideCodeActions(document, range) {
            if (!document || document.languageId !== 'markdown') return undefined;
            const line = document.lineAt(range.start.line).text;
            if (!line.trim().startsWith('!view ')) return undefined;
            const queries = parseAllViewQueries(document.getText());
            if (!queries || queries.length === 0) return undefined;

            const run = new vscode.CodeAction('Run Yamlink view', vscode.CodeActionKind.QuickFix);
            run.command = { command: 'yamlink.runViews', title: 'Run Yamlink view' };
            run.isPreferred = true;

            const insert = new vscode.CodeAction('Insert Yamlink starter view', vscode.CodeActionKind.RefactorRewrite);
            insert.command = { command: 'yamlink.insertViewBlock', title: 'Insert Yamlink starter view' };

            return [run, insert];
        }
    };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('markdown', provider, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        })
    );
}

module.exports = { registerViewLightbulb };
