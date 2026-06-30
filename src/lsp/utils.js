'use strict';

const path = require('path');
const fs   = require('fs');
const { getBacklinks } = require('../core/graph');
const { parseLinkedTargetParts } = require('../core/id');
const { loadIgnoreRules, isIgnoredPath } = require('../core/ignore');

function pathToUri(absPath) {
    const normalized = absPath.replace(/\\/g, '/');
    return normalized.startsWith('/') ? 'file://' + normalized : 'file:///' + normalized;
}

function uriToPath(uri) {
    const withoutScheme = String(uri || '').replace(/^file:\/\/\//, '/').replace(/^file:\/\//, '');
    if (/^\/[A-Za-z]:/.test(withoutScheme)) return withoutScheme.slice(1).replace(/\//g, path.sep);
    return withoutScheme.replace(/\//g, path.sep);
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function normalizeAnchorText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function wikilinkMatchAtPosition(line, character) {
    WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = WIKILINK_RE.exec(line)) !== null) {
        if (character >= match.index && character <= match.index + match[0].length) {
            return {
                fullMatch: match[0],
                rawTarget: match[1].trim(),
                start: match.index,
                end: match.index + match[0].length
            };
        }
    }
    return null;
}

function wikilinkAtPosition(line, character) {
    return wikilinkMatchAtPosition(line, character)?.rawTarget || null;
}

function collectMdFiles(workspaceRoot, dir = workspaceRoot, ignoreRules = null) {
    const out = [];
    const rules = Array.isArray(ignoreRules) ? ignoreRules : loadIgnoreRules(workspaceRoot);
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (
                full.includes(`${path.sep}_templates${path.sep}`)
                || full.endsWith(`${path.sep}_templates`)
            ) {
                continue;
            }
            if (isIgnoredPath(full, workspaceRoot, rules)) continue;
            if (entry.isDirectory()) {
                out.push(...collectMdFiles(workspaceRoot, full, rules));
            } else if (entry.name.endsWith('.md')) {
                out.push(full);
            }
        }
    } catch (_) {}
    return out;
}

function extractLinkOccurrences(text) {
    const occurrences = [];
    const lines = String(text || '').split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        WIKILINK_RE.lastIndex = 0;
        let match;
        while ((match = WIKILINK_RE.exec(line)) !== null) {
            const rawTarget = String(match[1] || '').trim();
            const parts = parseLinkedTargetParts(rawTarget);
            const target = String(parts.target || '').trim();
            if (!target) continue;
            occurrences.push({
                target,
                rawTarget,
                line: lineIndex,
                start: match.index,
                end: match.index + match[0].length
            });
        }
    }
    return occurrences;
}

function buildLinkTokenIndex(vaultPath) {
    const tokenIndex = new Map();
    for (const filePath of collectMdFiles(vaultPath)) {
        const text = readTextFileSafe(filePath);
        if (!text) continue;
        const occurrences = extractLinkOccurrences(text);
        for (const occurrence of occurrences) {
            if (!tokenIndex.has(occurrence.target)) tokenIndex.set(occurrence.target, []);
            tokenIndex.get(occurrence.target).push({
                filePath,
                rawTarget: occurrence.rawTarget,
                line: occurrence.line,
                start: occurrence.start,
                end: occurrence.end
            });
        }
    }
    return tokenIndex;
}

function primeLinkTokenIndex(state) {
    if (!state || !state.vaultPath) return;
    state.linkTokenIndex = buildLinkTokenIndex(state.vaultPath);
}

function ensureLinkTokenIndex(state) {
    if (!state) return new Map();
    if (!state.linkTokenIndex) {
        primeLinkTokenIndex(state);
    }
    return state.linkTokenIndex || new Map();
}

function getLinkedOccurrences(state, targets) {
    const linkTokenIndex = ensureLinkTokenIndex(state);
    const occurrences = [];
    for (const target of targets) {
        const matches = linkTokenIndex.get(target);
        if (!matches) continue;
        occurrences.push(...matches);
    }
    return occurrences;
}

function collectLinkedCandidateFiles({ vaultPath, state, id, idIndex, aliasTexts = [] }) {
    const candidateFiles = new Set();
    const declarationPath = idIndex.get(id);
    const lookupTargets = [id].concat(aliasTexts);

    if (declarationPath) {
        candidateFiles.add(declarationPath);
    }

    for (const backlink of getBacklinks(id)) {
        const sourcePath = idIndex.get(backlink.sourceId);
        if (sourcePath) {
            candidateFiles.add(sourcePath);
        }
    }

    for (const uri of state.openDocs.keys()) {
        const openPath = state.uriToPath ? state.uriToPath(uri) : null;
        if (openPath) {
            candidateFiles.add(openPath);
        }
    }

    for (const occurrence of getLinkedOccurrences(state, lookupTargets)) {
        if (occurrence && occurrence.filePath) {
            candidateFiles.add(occurrence.filePath);
        }
    }

    return candidateFiles;
}

function readTextFileSafe(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return null;
    }
}

function findAnchorLine(filePath, anchorNorm) {
    const text = readTextFileSafe(filePath);
    if (!text) return -1;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^#{1,6}\s+(.+)$/);
        if (match && normalizeAnchorText(match[1]) === anchorNorm) return i;
    }
    return -1;
}

/** Returns true if lineIdx falls inside the YAML frontmatter block. */
function inFrontmatter(lines, lineIdx) {
    if (lineIdx <= 0) return false;
    if (!lines[0] || lines[0].trim() !== '---') return false;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] && lines[i].trim() === '---') return lineIdx < i;
    }
    return true; // no closing --- yet
}

module.exports = {
    pathToUri,
    uriToPath,
    WIKILINK_RE,
    wikilinkMatchAtPosition,
    wikilinkAtPosition,
    collectMdFiles,
    primeLinkTokenIndex,
    getLinkedOccurrences,
    collectLinkedCandidateFiles,
    readTextFileSafe,
    inFrontmatter,
    normalizeAnchorText,
    findAnchorLine
};
