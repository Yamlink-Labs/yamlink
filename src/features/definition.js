'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { getAliasIndex, getBodyBlockIndex } = require('../core/indexService');
const { resolveLinkedTarget, parseLinkedTargetParts } = require('../core/id');
const { findBlockLine, normalizeAnchorText } = require('../core/bodyBlocks');

function findAnchorLine(filePath, anchorNorm) {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch (_) { return -1; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^#{1,6}\s+(.+)$/);
        if (m && normalizeAnchorText(m[1]) === anchorNorm) return i;
    }
    return -1;
}

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
                        const rawLinkText = match[1];
                        const resolvedId = resolveLinkedTarget(rawLinkText, idIndex, aliasIdx);
                        const filePath = resolvedId ? idIndex.get(resolvedId) : null;
                        if (!filePath) continue;
                        const parts = parseLinkedTargetParts(rawLinkText);

                        const start = match.index;
                        const end = start + match[0].length;
                        const range = new vscode.Range(
                            new vscode.Position(lineNumber, start),
                            new vscode.Position(lineNumber, end)
                        );

                        let uri = vscode.Uri.file(filePath);
                        if (parts.anchor) {
                            const anchorNorm = normalizeAnchorText(parts.anchor);
                            if (anchorNorm) {
                                const anchorLine = findAnchorLine(filePath, anchorNorm);
                                if (anchorLine !== -1) {
                                    uri = vscode.Uri.file(filePath).with({ fragment: `L${anchorLine + 1}` });
                                }
                            }
                        } else if (parts.blockId) {
                            const blockLine = findBlockLine(getBodyBlockIndex(), resolvedId, parts.blockId);
                            if (blockLine !== -1) {
                                uri = vscode.Uri.file(filePath).with({ fragment: `L${blockLine + 1}` });
                            }
                        }

                        links.push(new vscode.DocumentLink(range, uri));
                    }
                }

                return links;
            }
        })
    );
}

module.exports = { registerDefinition };
