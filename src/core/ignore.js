'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE_FILE = '.yamlinkignore';
const GLOB_CHAR_PATTERN = /[*?]/;

/** @typedef {{ type: 'dir'|'path'|'name'|'glob', value: string, anchored?: boolean, dirLike?: boolean, regex?: RegExp, prefixRegex?: RegExp|null }} IgnoreRule */

/** @param {string} glob @returns {string} */
function globToRegexSource(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                out += '.*';
                i++;
            } else {
                out += '[^/]*';
            }
        } else if (c === '?') {
            out += '[^/]';
        } else {
            out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return out;
}

/** @param {string} rawRule @returns {IgnoreRule|null} */
function normalizeRule(rawRule) {
    const trimmed = String(rawRule || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    // Every rule is already relative to the workspace root — there's no
    // "unanchored" pattern to distinguish, unlike .gitignore. A leading `/`
    // (common muscle memory from .gitignore's root-anchor syntax) must be
    // stripped here, not preserved: rel paths from toRelativeWorkspacePath()
    // never have a leading slash, so a preserved one would never match and
    // the rule would silently ignore nothing.
    const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!normalized) return null;

    const dirLike = normalized.endsWith('/');
    const stripped = dirLike ? normalized.replace(/\/+$/, '') : normalized;
    if (!stripped) return null;

    if (GLOB_CHAR_PATTERN.test(stripped)) {
        // A slash anywhere anchors the pattern to the workspace root, same as
        // the plain 'path'/'dir' rules below. No slash means it behaves like
        // a 'name' rule: matched at any depth, not just the root.
        const anchored = stripped.includes('/');
        const source = globToRegexSource(stripped);
        return {
            type: 'glob',
            value: stripped,
            anchored,
            dirLike,
            regex: new RegExp(`^${source}$`),
            // Only needed for an anchored directory-style glob (e.g. `logs*/`):
            // matches anything nested under a path the glob itself resolves to.
            prefixRegex: anchored && dirLike ? new RegExp(`^${source}/`) : null
        };
    }

    if (dirLike) {
        return { type: 'dir', value: stripped };
    }

    if (stripped.includes('/')) {
        return { type: 'path', value: stripped };
    }

    return { type: 'name', value: stripped };
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

/** @param {IgnoreRule} rule @param {string} rel @returns {boolean} */
function matchesGlobRule(rule, rel) {
    if (rule.anchored) {
        if (rule.regex.test(rel)) return true;
        return Boolean(rule.prefixRegex && rule.prefixRegex.test(rel));
    }

    // A pattern that matches the empty string (e.g. `**`) means "everything,
    // unconditionally" — including a top-level file with no ancestor
    // directory segment at all, which the directory-segment check below
    // would otherwise never reach.
    if (rule.regex.test('')) return true;

    // Unanchored: a plain filename glob (no dirLike) matches by basename at
    // any depth, mirroring the existing 'name' rule. A dirLike unanchored
    // glob (e.g. `drafts*/`) matches a directory segment by that name at any
    // depth, ignoring everything under it.
    const segments = rel.split('/');
    if (rule.dirLike) {
        // Every segment except the final one (the file itself) is a directory.
        return segments.slice(0, -1).some((segment) => rule.regex.test(segment));
    }
    return rule.regex.test(segments[segments.length - 1]);
}

/** @param {string} filePath @param {string} workspaceRoot @param {IgnoreRule[]} [rules] @returns {boolean} */
function isIgnoredPath(filePath, workspaceRoot, rules = []) {
    if (!filePath || !workspaceRoot || !Array.isArray(rules) || rules.length === 0) return false;
    const rel = toRelativeWorkspacePath(filePath, workspaceRoot);
    if (!rel) return false;
    const basename = path.basename(rel);

    return rules.some((rule) => {
        if (!rule || !rule.value) return false;
        if (rule.type === 'glob') {
            return matchesGlobRule(rule, rel);
        }
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
