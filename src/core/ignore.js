'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE_FILE = '.yamlinkignore';

/** @typedef {{ type: 'dir'|'path'|'name', value: string }} IgnoreRule */

/** @param {string} rawRule @returns {IgnoreRule|null} */
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

/** @param {string} content @returns {IgnoreRule[]} */
function parseIgnoreFile(content) {
    return String(content || '')
        .split(/\r?\n/)
        .map(normalizeRule)
        .filter(Boolean);
}

/** @param {string} workspaceRoot @returns {IgnoreRule[]} */
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

/** @param {string} filePath @param {string} workspaceRoot @returns {string} */
function toRelativeWorkspacePath(filePath, workspaceRoot) {
    if (!filePath || !workspaceRoot) return '';
    const resolvedFile = path.resolve(filePath);
    const resolvedRoot = path.resolve(workspaceRoot);
    if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
        return '';
    }
    return path.relative(resolvedRoot, resolvedFile).replace(/\\/g, '/');
}

/** @param {string} filePath @param {string} workspaceRoot @param {IgnoreRule[]} [rules] @returns {boolean} */
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
