'use strict';

const vscode = require('vscode');

function repairUiText(text) {
    return String(text ?? '')
        .replace(/â€”/g, '-')
        .replace(/â€™/g, "'")
        .replace(/â€¦/g, '...');
}

function showBuilderQuickPick(items, options = {}) {
    const safeItems = Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            label: repairUiText(item?.label),
            description: repairUiText(item?.description),
            detail: repairUiText(item?.detail)
        }))
        : items;
    return vscode.window.showQuickPick(safeItems, {
        ...options,
        title: repairUiText(options.title),
        placeHolder: repairUiText(options.placeHolder)
    });
}

function showBuilderInput(options = {}) {
    return vscode.window.showInputBox({
        ...options,
        title: repairUiText(options.title),
        prompt: repairUiText(options.prompt),
        placeHolder: repairUiText(options.placeHolder)
    });
}

module.exports = {
    repairUiText,
    showBuilderQuickPick,
    showBuilderInput
};
