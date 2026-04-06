'use strict';

const path = require('path');

function getWorkspaceRoots(workspaceFolders) {
    if (!Array.isArray(workspaceFolders)) return [];
    return workspaceFolders
        .map(folder => folder?.uri?.fsPath)
        .filter(Boolean);
}

function getPrimaryWorkspaceRoot(workspaceFolders) {
    return getWorkspaceRoots(workspaceFolders)[0] ?? null;
}

function getWorkspaceRootForFile(workspaceFolders, filePath) {
    if (!filePath) return getPrimaryWorkspaceRoot(workspaceFolders);

    const normalizedFile = path.resolve(filePath);
    const roots = getWorkspaceRoots(workspaceFolders)
        .map(root => path.resolve(root))
        .sort((a, b) => b.length - a.length);

    for (const root of roots) {
        if (normalizedFile === root) return root;
        if (normalizedFile.startsWith(root + path.sep)) return root;
    }

    return roots[0] ?? null;
}

module.exports = {
    getWorkspaceRoots,
    getPrimaryWorkspaceRoot,
    getWorkspaceRootForFile
};
