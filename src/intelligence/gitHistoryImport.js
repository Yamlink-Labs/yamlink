'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { canonicalizeId, canonicalizeLinkedTarget } = require('../core/id');

const GUARD_FILENAME = 'git-history-import.done';
const MAX_COMMITS_PER_FILE = 50;
const SKIP_DIRS = new Set([
    '.git', '.obsidian', '.trash', '.vscode', '.cursor', '.zed',
    'node_modules', '.yamlink', '_templates'
]);

function isGitRepo(root) {
    try {
        execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 5000
        });
        return true;
    } catch (_) {
        return false;
    }
}

function getGuardPath(root) {
    return path.join(root, '.yamlink', GUARD_FILENAME);
}

function isImportDone(root) {
    return fs.existsSync(getGuardPath(root));
}

function markImportDone(root) {
    try { fs.mkdirSync(path.join(root, '.yamlink'), { recursive: true }); } catch (_) {}
    fs.writeFileSync(getGuardPath(root), new Date().toISOString() + '\n', 'utf8');
}

function getMdFiles(root) {
    const result = [];
    function walk(dir, rel) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
                    walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
                }
            } else if (entry.name.toLowerCase().endsWith('.md')) {
                result.push(rel ? `${rel}/${entry.name}` : entry.name);
            }
        }
    }
    walk(root, '');
    return result;
}

function getGitLog(root, relPath, limit) {
    try {
        const out = execFileSync('git', [
            '-C', root,
            'log', '--follow', '--no-merges',
            `--max-count=${limit}`,
            '--format=%H %aI',
            '--', relPath.replace(/\\/g, '/')
        ], { stdio: 'pipe', encoding: 'utf8', timeout: 10000 });

        const commits = [];
        for (const line of out.trim().split('\n')) {
            if (!line.trim()) continue;
            const spaceIdx = line.indexOf(' ');
            if (spaceIdx < 0) continue;
            const hash = line.slice(0, spaceIdx).trim();
            const ts = line.slice(spaceIdx + 1).trim();
            if (hash && ts) commits.push({ hash, timestamp: ts });
        }
        return commits.reverse(); // oldest first
    } catch (_) {
        return [];
    }
}

function getFileAtCommit(root, hash, relPath) {
    try {
        return execFileSync('git', [
            '-C', root,
            'show', `${hash}:${relPath.replace(/\\/g, '/')}`
        ], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
    } catch (_) {
        return null;
    }
}

function _extractRelationTargets(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const targets = [];
    for (const value of values) {
        const text = String(value || '');
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const targetId = canonicalizeLinkedTarget(match[1]);
            if (targetId) targets.push(targetId);
        }
    }
    return [...new Set(targets)].sort();
}

function _isNonEmpty(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.some(v => String(v || '').trim());
    return String(rawValue || '').trim().length > 0;
}

/**
 * @param {object|null} prevFields
 * @param {object|null} currFields
 * @param {string} noteId
 * @param {string} timestamp ISO timestamp string.
 * @returns {object[]} Mutation events.
 */
function diffFrontmatters(prevFields, currFields, noteId, timestamp) {
    const events = [];
    if (!currFields || !noteId) return events;

    const prev = prevFields || {};
    const prevExists = prevFields !== null;

    if (!prevExists) {
        events.push({ timestamp, type: 'note_created', noteId, field: null, oldValue: null, newValue: null });
    }

    const prevType = String(prev.type || '').trim();
    const currType = String(currFields.type || '').trim();
    if (currType && prevType !== currType) {
        events.push({ timestamp, type: 'type_set', noteId, field: 'type', oldValue: prevType || null, newValue: currType });
    }

    const fieldNames = new Set([...Object.keys(prev), ...Object.keys(currFields)]);
    for (const fieldName of fieldNames) {
        const fn = String(fieldName).toLowerCase();
        if (!fn || fn === 'id' || fn === 'type' || fn.startsWith('__')) continue;

        const oldValue = prev[fieldName];
        const newValue = currFields[fieldName];
        const hadValue = _isNonEmpty(oldValue);
        const hasValue = _isNonEmpty(newValue);
        const oldTargets = _extractRelationTargets(oldValue);
        const newTargets = _extractRelationTargets(newValue);
        const hasRelations = oldTargets.length > 0 || newTargets.length > 0;
        const targetsChanged = oldTargets.join('|') !== newTargets.join('|') && hasRelations;

        if (!hadValue && hasValue) {
            events.push({ timestamp, type: 'field_added', noteId, field: fieldName, oldValue: oldValue ?? null, newValue });
        } else if (hadValue && !hasValue) {
            events.push({ timestamp, type: 'field_removed', noteId, field: fieldName, oldValue, newValue: null });
        } else if (hadValue && hasValue && !hasRelations) {
            const oldStr = String(oldValue ?? '').trim();
            const newStr = String(newValue ?? '').trim();
            if (oldStr !== newStr) {
                events.push({ timestamp, type: 'field_changed', noteId, field: fieldName, oldValue, newValue });
            }
        }

        if (targetsChanged) {
            events.push({
                timestamp,
                type: 'relation_changed',
                noteId,
                field: fieldName,
                oldValue: oldTargets.join(', ') || null,
                newValue: newTargets.join(', ') || null
            });
        }
    }

    return events;
}

/**
 * @param {string} root Absolute path to the vault root (git repo).
 * @param {{ appendEvents?: (events: object[]) => void, onProgress?: (p: { file: string, done: number, total: number }) => void, maxCommitsPerFile?: number }} [options]
 * @returns {{ skipped: boolean, reason?: string, eventsEmitted: number, filesProcessed: number }}
 */
function runGitHistoryImport(root, options = {}) {
    const { appendEvents, onProgress, maxCommitsPerFile = MAX_COMMITS_PER_FILE } = options;

    if (!isGitRepo(root)) {
        return { skipped: true, reason: 'not-a-git-repo', eventsEmitted: 0, filesProcessed: 0 };
    }
    if (isImportDone(root)) {
        return { skipped: true, reason: 'already-done', eventsEmitted: 0, filesProcessed: 0 };
    }

    const mdFiles = getMdFiles(root);
    let eventsEmitted = 0;
    let filesProcessed = 0;

    for (let i = 0; i < mdFiles.length; i++) {
        const relPath = mdFiles[i];
        onProgress?.({ file: relPath, done: i, total: mdFiles.length });

        const commits = getGitLog(root, relPath, maxCommitsPerFile);
        if (!commits.length) { filesProcessed++; continue; }

        let prevFields = null;

        for (const { hash, timestamp } of commits) {
            const content = getFileAtCommit(root, hash, relPath);
            if (content === null) continue;

            let currFields = null;
            try {
                const parsed = parseFrontmatterDocument(content);
                if (parsed.hasFrontmatter) currFields = parsed.data || {};
            } catch (_) { /* skip malformed */ }

            if (currFields !== null) {
                const noteId = String(currFields.id || '').trim().toLowerCase() ||
                               canonicalizeId(path.basename(relPath, '.md'));
                const events = diffFrontmatters(prevFields, currFields, noteId, timestamp);
                if (events.length && typeof appendEvents === 'function') {
                    appendEvents(events);
                    eventsEmitted += events.length;
                }
            }

            prevFields = currFields;
        }

        filesProcessed++;
    }

    markImportDone(root);
    return { skipped: false, eventsEmitted, filesProcessed };
}

module.exports = {
    isGitRepo,
    isImportDone,
    markImportDone,
    getMdFiles,
    getGitLog,
    getFileAtCommit,
    diffFrontmatters,
    runGitHistoryImport
};
