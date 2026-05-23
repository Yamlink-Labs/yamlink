'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE_FILE = '.yamlinkignore';

function normalizeRule(rawRule) {
    const trimmed = String(rawRule || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized) return null;

    if (normalized.endsWith('/')) {
        return { type: 'dir', value: normalized.replace(/\/+$/, '') };
    }

    if (normalized.includes('/')) {
        return { type: 'path', value: normalized };
    }

    return { type: 'name', value: normalized };
}

function parseIgnoreFile(content) {
    return String(content || '')
        .split(/\r?\n/)
        .map(normalizeRule)
        .filter(Boolean);
}

function loadIgnoreRules(workspaceRoot) {
    if (!workspaceRoot) return [];
    const ignorePath = path.join(workspaceRoot, IGNORE_FILE);
    if (!fs.existsSync(ignorePath)) return [];
    try {
        return parseIgnoreFile(fs.readFileSync(ignorePath, 'utf8'));
    } catch (_) {
        return [];
    }
}

function toRelativeWorkspacePath(filePath, workspaceRoot) {
    if (!filePath || !workspaceRoot) return '';
    const resolvedFile = path.resolve(filePath);
    const resolvedRoot = path.resolve(workspaceRoot);
    if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
        return '';
    }
    return path.relative(resolvedRoot, resolvedFile).replace(/\\/g, '/');
}

function isIgnoredPath(filePath, workspaceRoot, rules = []) {
    if (!filePath || !workspaceRoot || !Array.isArray(rules) || rules.length === 0) return false;
    const rel = toRelativeWorkspacePath(filePath, workspaceRoot);
    if (!rel) return false;
    const basename = path.basename(rel);

    return rules.some((rule) => {
        if (!rule || !rule.value) return false;
        if (rule.type === 'dir') {
            return rel === rule.value || rel.startsWith(rule.value + '/');
        }
        if (rule.type === 'path') {
            return rel === rule.value;
        }
        return basename === rule.value;
    });
}

module.exports = {
    IGNORE_FILE,
    normalizeRule,
    parseIgnoreFile,
    loadIgnoreRules,
    toRelativeWorkspacePath,
    isIgnoredPath
};
