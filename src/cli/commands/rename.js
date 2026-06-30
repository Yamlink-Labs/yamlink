'use strict';

const fs = require('fs');
const path = require('path');
const { getIndex } = require('../../core/indexService');
const fmt = require('../format');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');
const { appendMutationEvents, withMutationContext } = require('../../runtime/mutationEventLog');

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRenameRegex(oldId) {
    const escaped = escapeRegex(oldId);
    return new RegExp(`!?\\[\\[${escaped}(?=\\||#|\\^|\\]\\])`, 'g');
}

function findRenameMatchesInText(text, oldId) {
    const regex = buildRenameRegex(oldId);
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const start = match.index + (match[0].startsWith('!') ? 3 : 2);
        matches.push({ start, end: start + oldId.length });
    }
    return matches;
}

function contentHasRenameMatch(pattern, content) {
    pattern.lastIndex = 0;
    return pattern.test(content);
}

function rewriteIdLine(content, newId) {
    return content.replace(/^id:\s*.+$/m, `id: ${newId}`);
}

function deriveNoteId(filePath, content) {
    const match = String(content || '').match(/^id:\s*(.+)$/m);
    if (match && match[1]) return String(match[1]).trim();
    return path.basename(filePath, '.md');
}

function walkMarkdownFiles(rootDir) {
    const results = [];
    scan(rootDir);
    return results.sort();

    function scan(currentDir) {
        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (_) {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                scan(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(fullPath);
            }
        }
    }
}

async function run({ oldId, newId, vaultPath, vaultService, json, quiet, dryRun, renameFile }) {
    if (!oldId || !newId) {
        emitCliError({ json, error: 'Usage: yamlink rename <old-id> <new-id>', code: 'USAGE', exitCode: 1 });
        return;
    }

    const idIndex = getIndex();
    const targetPath = idIndex.get(oldId);

    if (!targetPath) {
        const message = `Rename failed: note "${oldId}" does not exist in this vault.`;
        emitCliError({ json, error: message, code: 'NOT_FOUND', details: { oldId, newId, filesUpdated: [], renamed_file: false }, exitCode: 1 });
        return;
    }

    const renamePattern = buildRenameRegex(oldId);
    const filesUpdated = [];
    const updatedContentByPath = new Map();
    const markdownFiles = walkMarkdownFiles(vaultPath);

    for (const filePath of markdownFiles) {
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (_) {
            continue;
        }

        let nextContent = content;
        let changed = false;

        if (filePath === targetPath && /^id:\s*.+$/m.test(nextContent)) {
            const updated = rewriteIdLine(nextContent, newId);
            if (updated !== nextContent) {
                nextContent = updated;
                changed = true;
            }
        }

        if (contentHasRenameMatch(renamePattern, nextContent)) {
            const replaced = nextContent.replace(renamePattern, (match) => {
                const prefix = match.startsWith('!') ? '![[' : '[[';
                return prefix + newId;
            });
            if (replaced !== nextContent) {
                nextContent = replaced;
                changed = true;
            }
        }

        if (!changed) continue;

        filesUpdated.push(filePath);
        updatedContentByPath.set(filePath, nextContent);
    }

    let renamedFile = false;
    let renameFileWarning = null;
    if (renameFile) {
        const expectedSource = path.join(path.dirname(targetPath), `${oldId}.md`);
        const expectedTarget = path.join(path.dirname(targetPath), `${newId}.md`);
        if (path.resolve(targetPath) !== path.resolve(expectedSource)) {
            renameFileWarning = `Skipped file rename because the source file is not named ${oldId}.md`;
        } else if (fs.existsSync(expectedTarget)) {
            emitCliError({ json, error: `Rename failed: target file already exists: ${expectedTarget}`, code: 'CONFLICT', exitCode: 1 });
            return;
        } else if (!dryRun) {
            renamedFile = true;
        } else {
            renamedFile = true;
        }
    }

    if (!dryRun) {
        if (!vaultService) {
            emitCliError({ json, error: 'Vault service unavailable for rename.', code: 'INTERNAL_ERROR', exitCode: 2 });
            return;
        }
        try {
            await vaultService.mutate(async () => {
                for (const filePath of filesUpdated) {
                    fs.writeFileSync(filePath, updatedContentByPath.get(filePath), 'utf8');
                }
                if (renameFile && renamedFile) {
                    const expectedSource = path.join(path.dirname(targetPath), `${oldId}.md`);
                    const expectedTarget = path.join(path.dirname(targetPath), `${newId}.md`);
                    fs.renameSync(expectedSource, expectedTarget);
                }
                const mutationEvents = [{
                    type: 'field_changed',
                    noteId: newId,
                    field: 'id',
                    oldValue: oldId,
                    newValue: newId,
                    timestamp: new Date().toISOString()
                }];
                for (const filePath of filesUpdated) {
                    if (filePath === targetPath) continue;
                    mutationEvents.push({
                        type: 'relation_changed',
                        noteId: deriveNoteId(filePath, updatedContentByPath.get(filePath)),
                        field: 'wikilink',
                        oldValue: oldId,
                        newValue: newId,
                        timestamp: new Date().toISOString()
                    });
                }
                appendMutationEvents(withMutationContext(mutationEvents, {
                    source: 'cli',
                    cause: 'cli_rename_note'
                }));
            });
        } catch (error) {
            emitCliError({ json, error: 'Rename failed: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
            return;
        }
    }

    const payload = {
        ok: true,
        oldId,
        newId,
        dryRun: !!dryRun,
        filesUpdated,
        renamed_file: renamedFile
    };

    if (json) {
        emitCliSuccess(payload);
        return;
    }

    if (quiet) {
        emitText(filesUpdated.join('\n') + (filesUpdated.length ? '\n' : ''));
        return;
    }

    emitText(captureOutput(() => {
        fmt.header(dryRun ? `Rename Preview: ${oldId} → ${newId}` : `Rename: ${oldId} → ${newId}`);
        fmt.row('Target note', targetPath);
        fmt.row('Files updated', filesUpdated.length);
        if (filesUpdated.length) {
            fmt.blank();
            fmt.subheader(dryRun ? 'Would update' : 'Updated files');
            for (const filePath of filesUpdated) {
                console.log('  ' + filePath);
            }
        }
        if (renameFile) {
            fmt.blank();
            fmt.row('Rename file', renamedFile ? (dryRun ? 'would rename' : fmt.ok('renamed')) : fmt.warn('skipped'));
            if (renameFileWarning) console.log('  ' + renameFileWarning);
        }
        fmt.blank();
        console.log(dryRun ? fmt.warn('Dry run only — no files were changed.') : fmt.ok('Rename complete.'));
        fmt.blank();
    }));
}

module.exports = {
    run,
    buildRenameRegex,
    findRenameMatchesInText,
    contentHasRenameMatch
};
