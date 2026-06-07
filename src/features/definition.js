'use strict';

const vscode = require('vscode');
const { getAliasIndex } = require('../core/indexService');
const { resolveLinkedTarget } = require('../core/id');

/** @param {import('vscode').ExtensionContext} context @param {() => Map<string,string>} getIndex @returns {void} */
function registerDefinition(context, getIndex) {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider('markdown', {
            provideDocumentLinks(document) {
                const idIndex = getIndex();
                const aliasIdx = getAliasIndex();
                const links = [];

                for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
                    const line = document.lineAt(lineNumber).text;
                    const regex = /!?\[\[([^\]]+)\]\]/g;

                    let match;
                    while ((match = regex.exec(line)) !== null) {
                        const resolvedId = resolveLinkedTarget(match[1], idIndex, aliasIdx);
                        const filePath = resolvedId ? idIndex.get(resolvedId) : null;
                        if (!filePath) continue;

                        const start = match.index;
                        const end = start + match[0].length;
                        const range = new vscode.Range(
                            new vscode.Position(lineNumber, start),
                            new vscode.Position(lineNumber, end)
                        );

                        links.push(new vscode.DocumentLink(range, vscode.Uri.file(filePath)));
                    }
                }

                return links;
            }
        })
    );
}

module.exports = { registerDefinition };
