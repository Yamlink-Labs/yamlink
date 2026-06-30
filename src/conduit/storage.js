'use strict';

const fs = require('fs');
const path = require('path');

function walkUpForVaultRoot(startPath) {
    let current = path.resolve(startPath || process.cwd());
    while (true) {
        if (fs.existsSync(path.join(current, '.yamlink'))) return current;
        const parent = path.dirname(current);
        if (parent === current) return '';
        current = parent;
    }
}

function resolveVaultPath({ cwd, nodes } = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    for (const node of list) {
        const filePath = String(node?._filePath || '');
        if (!filePath) continue;
        const found = walkUpForVaultRoot(path.dirname(filePath));
        if (found) return found;
    }
    const cwdRoot = walkUpForVaultRoot(cwd || process.cwd());
    return cwdRoot || path.resolve(cwd || process.cwd());
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readScopedJson(filePath, vaultPath, fallbackValue) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        if (!vaultPath) return fallbackValue;
        return parsed[vaultPath] ?? fallbackValue;
    } catch (_) {
        return fallbackValue;
    }
}

function writeScopedJson(filePath, vaultPath, value) {
    if (!vaultPath) return;
    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
    } catch (_) {
        parsed = {};
    }
    parsed[vaultPath] = value;
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf8');
}

function getBookmarksPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', 'conduit-bookmarks.json');
}

function getContextsPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', 'conduit-contexts.json');
}

function getLastSessionPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', 'conduit-last-session.json');
}

function readLastSessionTimestamp(vaultPath) {
    if (!vaultPath) return null;
    return readScopedJson(getLastSessionPath(vaultPath), vaultPath, null);
}

function writeLastSessionTimestamp(vaultPath) {
    if (!vaultPath) return;
    writeScopedJson(getLastSessionPath(vaultPath), vaultPath, new Date().toISOString());
}

module.exports = {
    resolveVaultPath,
    readScopedJson,
    writeScopedJson,
    getBookmarksPath,
    getContextsPath,
    getLastSessionPath,
    readLastSessionTimestamp,
    writeLastSessionTimestamp
};
