'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getIndex } = require('../../core/indexService');
const { describeDependencyPreview } = require('../../core/dependencies');
const { parseFrontmatterDocument } = require('../../core/frontmatter');
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

function getScalarFieldValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(getScalarFieldValue).join(' ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function buildDependencyPreviewFromFiles(id, markdownFiles, targetPath) {
    const rows = [];
    const seenSources = new Set();
    const pattern = buildRenameRegex(id);
    for (const filePath of markdownFiles) {
        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (_) {
            continue;
        }
        const sourceId = deriveNoteId(filePath, content);
        let parsed = { data: {}, body: content };
        try {
            parsed = parseFrontmatterDocument(content);
        } catch (_) {
            parsed = { data: {}, body: content };
        }
        for (const [field, value] of Object.entries(parsed.data || {})) {
            if (field === 'id' || field === 'type') continue;
            if (!contentHasRenameMatch(pattern, getScalarFieldValue(value))) continue;
            seenSources.add(sourceId);
            rows.push({
                field,
                kind: 'frontmatter',
                sourceId,
                label: String(parsed.data.name || parsed.data.title || sourceId),
                type: String(parsed.data.type || ''),
                filePath
            });
        }
        if (contentHasRenameMatch(pattern, parsed.body || '')) {
            seenSources.add(sourceId);
            rows.push({
                field: 'body',
                kind: 'body',
                sourceId,
                label: String(parsed.data?.name || parsed.data?.title || sourceId),
                type: String(parsed.data?.type || ''),
                filePath
            });
        }
    }

    const frontmatterTotal = rows.filter((row) => row.kind === 'frontmatter').length;
    const bodyTotal = rows.filter((row) => row.kind === 'body').length;
    return {
        id,
        targetPath,
        total: rows.length,
        sourceCount: seenSources.size,
        frontmatterTotal,
        bodyTotal,
        groups: [],
        rows
    };
}

function canPrompt() {
    return Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
}

function promptYesNo(message) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(message, (answer) => {
            rl.close();
            resolve(/^y(es)?$/i.test(String(answer || '').trim()));
        });
    });
}

function buildDependencyDetails(dependencies) {
    return {
        dependencies,
        dependencySummary: describeDependencyPreview(dependencies)
    };
}

async function confirmLinkedRename({ dependencies, json, force }) {
    if (!dependencies || dependencies.total === 0 || force) return true;
    // Scripts, CI, and any other non-interactive caller can't answer a prompt — rename is
    // documented as unconditional ("vault-wide ID rename"), so proceed automatically here.
    // The dependency count is still surfaced in the human/JSON output below for visibility.
    if (!canPrompt()) return true;
    const summary = describeDependencyPreview(dependencies);
    emitText(`Rename warning: ${summary}\n`);
    const confirmed = await promptYesNo('Continue with rename? [y/N] ');
    if (!confirmed) {
        emitCliError({
            json,
            error: 'Rename cancelled.',
            code: 'CANCELLED',
            details: buildDependencyDetails(dependencies),
            exitCode: 1
        });
        return false;
    }
    return true;
}

async function run({ oldId, newId, vaultPath, vaultService, json, quiet, dryRun, renameFile, force }) {
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

    const markdownFiles = walkMarkdownFiles(vaultPath);
    const dependencies = buildDependencyPreviewFromFiles(oldId, markdownFiles, targetPath);
    if (!dryRun) {
        const confirmed = await confirmLinkedRename({ dependencies, json, force });
        if (!confirmed) return;
    }

    const renamePattern = buildRenameRegex(oldId);
    const filesUpdated = [];
    const updatedContentByPath = new Map();

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
        renamed_file: renamedFile,
        dependencies
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
        fmt.row('Dependencies', describeDependencyPreview(dependencies));
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
