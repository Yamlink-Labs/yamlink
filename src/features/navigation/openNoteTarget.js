'use strict';

const fs = require('fs');
const vscode = require('vscode');

const { getIndex, getAliasIndex, getBodyBlockIndex } = require('../../core/indexService');
const { resolveLinkedTarget, parseLinkedTargetParts } = require('../../core/id');
const { findBlockLine, normalizeAnchorText } = require('../../core/bodyBlocks');

function findAnchorLine(filePath, anchorNorm) {
    let text = '';
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return -1;
    }
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^#{1,6}\s+(.+)$/);
        if (match && normalizeAnchorText(match[1]) === anchorNorm) return i;
    }
    return -1;
}

function resolveOpenTarget(rawTarget) {
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    const resolvedId = resolveLinkedTarget(rawTarget, idIndex, aliasIndex);
    const filePath = resolvedId ? idIndex.get(resolvedId) : null;
    if (!resolvedId || !filePath) return null;

    const parts = parseLinkedTargetParts(rawTarget);
    let targetLine = 0;
    if (parts.anchor) {
        const anchorNorm = normalizeAnchorText(parts.anchor);
        if (anchorNorm) {
            const anchorLine = findAnchorLine(filePath, anchorNorm);
            if (anchorLine !== -1) targetLine = anchorLine;
        }
    } else if (parts.blockId) {
        const blockLine = findBlockLine(getBodyBlockIndex(), resolvedId, parts.blockId);
        if (blockLine !== -1) targetLine = blockLine;
    }

    return {
        rawTarget: String(rawTarget || ''),
        resolvedId,
        filePath,
        targetLine,
        parts
    };
}

async function openNoteTarget(rawTarget, options = {}) {
    const resolved = resolveOpenTarget(rawTarget);
    if (!resolved) return null;

    const doc = await vscode.workspace.openTextDocument(resolved.filePath);
    const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: options.viewColumn ?? vscode.ViewColumn.One,
        preview: options.preview ?? false
    });

    if (typeof resolved.targetLine === 'number' && resolved.targetLine >= 0) {
        const pos = new vscode.Position(resolved.targetLine, 0);
        if (editor && typeof editor.revealRange === 'function') {
            const range = new vscode.Range(pos, pos);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(
                range,
                vscode.TextEditorRevealType?.InCenterIfOutsideViewport ?? vscode.TextEditorRevealType?.InCenter
            );
        }
    }

    return resolved;
}

module.exports = {
    findAnchorLine,
    resolveOpenTarget,
    openNoteTarget
};
