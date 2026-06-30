'use strict';

const fs   = require('fs');
const path = require('path');

const { getIndex, getAliasIndex, getFieldsCache }        = require('../../core/indexService');
const { appendMutationEvents, withMutationContext }      = require('../../runtime/mutationEventLog');
const { respond, respondImmediate, respondError }        = require('../transport');
const { pathToUri, WIKILINK_RE, collectLinkedCandidateFiles } = require('../utils');
const { CONTENT_MODIFIED, isStaleDocumentRequest, getDocumentText } = require('../documentState');
const { cancellationCheckpoint, isRequestCancelled } = require('../cancellation');
const { beginWorkDone, reportWorkDone, endWorkDone } = require('../progress');
const { resolveLinkedTarget, parseLinkedTargetParts, canonicalizeLinkedTarget, canonicalizeId } = require('../../core/id');

function _escapeRegex(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function _buildRenameRegex(oldId) {
    return new RegExp(`!?\\[\\[${_escapeRegex(oldId)}(?=\\||#|\\^|\\]\\])`, 'g');
}

function _findRenameMatches(text, oldId) {
    const re = _buildRenameRegex(oldId);
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        const start = m.index + (m[0].startsWith('!') ? 3 : 2);
        out.push({ start, end: start + oldId.length });
    }
    return out;
}

function _getAliasTexts(fields) {
    if (Array.isArray(fields.aliases)) {
        return fields.aliases.map((alias) => String(alias || '').trim()).filter(Boolean);
    }
    return String(fields.aliases || '')
        .split(/,\s*/)
        .map((alias) => String(alias || '').trim())
        .filter(Boolean);
}

function _shouldRenameBackingFile(filePath, oldId) {
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.md') return false;
    const baseName = path.basename(filePath, ext).trim().toLowerCase();
    return baseName === String(oldId || '').trim().toLowerCase();
}

function handlePrepareRename(msg, state) {
    const { textDocument, position } = msg.params || {};
    if (!textDocument || !position) { respond(msg.id, null); return; }

    const content = getDocumentText(state, textDocument.uri);
    const lines   = content.split('\n');
    const line    = lines[position.line] || '';

    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    let id = null;
    let startChar = -1;
    let endChar   = -1;

    // Check wikilink
    WIKILINK_RE.lastIndex = 0;
    let wm;
    while ((wm = WIKILINK_RE.exec(line)) !== null) {
        if (position.character >= wm.index && position.character <= wm.index + wm[0].length) {
            id        = resolveLinkedTarget(wm[1].trim(), idIndex, aliasIndex);
            const parts = parseLinkedTargetParts(wm[1].trim());
            const targetText = parts.target.trim();
            startChar = wm.index + 2; // after [[
            endChar   = startChar + targetText.length;
            break;
        }
    }

    // Fall back to id: frontmatter field
    if (!id) {
        const m = /^(id:\s+)(\S+)/.exec(line);
        if (m) {
            const valStart = m[1].length;
            const valEnd   = valStart + m[2].length;
            if (position.character >= valStart && position.character <= valEnd) {
                id        = m[2];
                startChar = valStart;
                endChar   = valEnd;
            }
        }
    }

    if (!id) { respond(msg.id, null); return; }

    if (!idIndex.has(id)) { respond(msg.id, null); return; }

    respond(msg.id, {
        range: {
            start: { line: position.line, character: startChar },
            end:   { line: position.line, character: endChar }
        },
        placeholder: id
    });
}

async function handleRename(msg, state) {
    const { textDocument, position, newName } = msg.params || {};
    if (!textDocument || !position || !newName) { respond(msg.id, null); return; }
    if (isStaleDocumentRequest(state, textDocument.uri, textDocument?.version)) {
        respondError(msg.id, CONTENT_MODIFIED, 'Content modified');
        return;
    }

    const content = getDocumentText(state, textDocument.uri);
    const lines   = content.split('\n');
    const line    = lines[position.line] || '';

    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();

    let oldId = null;
    WIKILINK_RE.lastIndex = 0;
    let wm;
    while ((wm = WIKILINK_RE.exec(line)) !== null) {
        if (position.character >= wm.index && position.character <= wm.index + wm[0].length) {
            oldId = resolveLinkedTarget(wm[1].trim(), idIndex, aliasIndex) || canonicalizeLinkedTarget(wm[1].trim());
            break;
        }
    }
    if (!oldId) {
        const m = /^(id:\s+)(\S+)/.exec(line);
        if (m) oldId = m[2];
    }

    if (!oldId) { respondError(msg.id, -32602, 'No renameable identifier at position'); return; }

    if (!idIndex.has(oldId)) {
        respondError(msg.id, -32602, `No note with id "${oldId}" found in vault`);
        return;
    }

    const newId   = String(newName).trim();
    const changes = {};
    const documentChanges = [];
    const sourceFilePath = idIndex.get(oldId);
    const fields = getFieldsCache().get(oldId) || {};
    const aliasTexts = _getAliasTexts(fields);
    const renamedSourceUri = sourceFilePath && _shouldRenameBackingFile(sourceFilePath, oldId)
        ? pathToUri(path.join(path.dirname(sourceFilePath), canonicalizeId(newId) + path.extname(sourceFilePath)))
        : null;
    const candidateFiles = collectLinkedCandidateFiles({
        vaultPath: state.vaultPath,
        state,
        id: oldId,
        idIndex,
        aliasTexts
    });
    const workDoneToken = msg?.params?.workDoneToken;
    const total = Math.max(1, candidateFiles.size || 1);

    beginWorkDone(workDoneToken, 'Yamlink rename', `Renaming "${oldId}" to "${newId}"`, 0);
    let processed = 0;
    for (const filePath of candidateFiles) {
        if ((processed++ % 25) === 0) await cancellationCheckpoint(state, msg.id);
        const uri = pathToUri(filePath);
        let text = state.openDocs.has(uri)
            ? (state.openDocs.get(uri) || '')
            : null;
        if (text == null) {
            try { text = fs.readFileSync(filePath, 'utf8'); } catch (_) { continue; }
        }

        const edits = [];

        if (sourceFilePath && filePath === sourceFilePath) {
            const fileLines = text.split('\n');
            for (let i = 0; i < fileLines.length; i++) {
                const idMatch = /^(id:\s+)(\S+)/.exec(fileLines[i]);
                if (idMatch && idMatch[2] === oldId) {
                    edits.push({
                        range: {
                            start: { line: i, character: idMatch[1].length },
                            end:   { line: i, character: idMatch[1].length + oldId.length }
                        },
                        newText: newId
                    });
                    break;
                }
            }
        }

        const matches = _findRenameMatches(text, oldId);
        if (matches.length > 0) {
            const fileLines   = text.split('\n');
            const lineOffsets = [];
            let off = 0;
            for (const l of fileLines) { lineOffsets.push(off); off += l.length + 1; }

            for (const { start, end } of matches) {
                let li = 0;
                for (let i = 0; i < lineOffsets.length; i++) {
                    if (lineOffsets[i] <= start) li = i;
                    else break;
                }
                const lineStart = lineOffsets[li];
                edits.push({
                    range: {
                        start: { line: li, character: start - lineStart },
                        end:   { line: li, character: end   - lineStart }
                    },
                    newText: newId
                });
            }
        }

        if (edits.length > 0) {
            if (renamedSourceUri && sourceFilePath && filePath === sourceFilePath) {
                documentChanges.push({
                    textDocument: { uri: renamedSourceUri, version: null },
                    edits
                });
            } else {
                if (!changes[uri]) changes[uri] = [];
                changes[uri].push(...edits);
            }
        }

        if (processed === total || processed % 100 === 0) {
            reportWorkDone(
                workDoneToken,
                `Processed ${processed} / ${total} candidate files`,
                Math.min(100, Math.round((processed / total) * 100))
            );
        }
    }

    if (renamedSourceUri && sourceFilePath) {
        documentChanges.unshift({
            kind: 'rename',
            oldUri: pathToUri(sourceFilePath),
            newUri: renamedSourceUri,
            options: { overwrite: false, ignoreIfExists: false }
        });
    }

    if (isRequestCancelled(state, msg.id)) return;

    const result = {};
    if (Object.keys(changes).length > 0) result.changes = changes;
    if (documentChanges.length > 0) result.documentChanges = documentChanges;
    endWorkDone(workDoneToken, `Prepared rename edits across ${processed} files`);
    respondImmediate(msg.id, result);

    if (Object.keys(changes).length > 0 || documentChanges.length > 0) {
        try {
            appendMutationEvents(withMutationContext([{
                type:      'field_changed',
                noteId:    oldId,
                field:     'id',
                oldValue:  oldId,
                newValue:  newId,
                timestamp: new Date().toISOString()
            }], {
                source: 'lsp',
                cause: 'lsp_rename'
            }));
        } catch (_) {}
    }
}

module.exports = { handlePrepareRename, handleRename };
