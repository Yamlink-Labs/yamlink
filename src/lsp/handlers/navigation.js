'use strict';

const fs = require('fs');
const path = require('path');

const { getIndex, getAliasIndex, getBodyBlockIndex, getFieldsCache } = require('../../core/indexService');
const { resolveLinkedTarget, parseLinkedTargetParts, canonicalizeLinkedTarget } = require('../../core/id');
const { findBlockLine }                          = require('../../core/bodyBlocks');
const { resolveImageEmbed }                      = require('../../core/imageEmbed');
const { respond, respondImmediate }              = require('../transport');
const { getDocumentText }                        = require('../documentState');
const { cancellationCheckpoint, isRequestCancelled } = require('../cancellation');
const { beginWorkDone, reportWorkDone, endWorkDone, reportPartialResult } = require('../progress');
const {
    wikilinkMatchAtPosition,
    pathToUri,
    uriToPath,
    WIKILINK_RE,
    getLinkedOccurrences,
    collectLinkedCandidateFiles,
    findAnchorLine,
    normalizeAnchorText
} = require('../utils');

// True when the wikilink match at `matchStart` in `line` is an embed
// (`![[...]]`) rather than a plain reference (`[[...]]`) — WIKILINK_RE itself
// doesn't capture the leading `!`, so this checks the preceding character.
function isEmbedMatch(line, matchStart) {
    return matchStart > 0 && line[matchStart - 1] === '!';
}

function resolveTargetLocation(rawTarget, idIndex, aliasIndex) {
    const resolvedId = resolveLinkedTarget(rawTarget, idIndex, aliasIndex);
    const filePath = resolvedId ? idIndex.get(resolvedId) : null;
    if (!filePath) return null;

    const parts = parseLinkedTargetParts(rawTarget);
    let targetLine = 0;
    if (parts.anchor) {
        const anchorNorm = normalizeAnchorText(parts.anchor);
        if (anchorNorm) {
            const anchorLine = findAnchorLine(filePath, anchorNorm);
            if (anchorLine !== -1) targetLine = anchorLine;
        }
    } else if (parts.blockId) {
        const blockLine = findBlockLine(getBodyBlockIndex(), resolvedId, parts.blockId);
        if (blockLine !== -1) targetLine = blockLine;
    }

    return {
        resolvedId,
        filePath,
        targetLine,
        parts
    };
}

function buildDocumentLinks(content, idIndex, aliasIndex, docPath) {
    const links = [];
    const lines = String(content || '').split('\n');
    const docDir = docPath ? path.dirname(docPath) : null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        WIKILINK_RE.lastIndex = 0;
        let match;
        while ((match = WIKILINK_RE.exec(line)) !== null) {
            const rawTarget = match[1].trim();
            const location = resolveTargetLocation(rawTarget, idIndex, aliasIndex);
            if (!location) {
                // Same image-embed fallback as handleDefinition above — a
                // ![[photo.png]] link with no resolvable note target should
                // still produce a real, clickable document link when it
                // resolves to a real image file.
                if (docDir && isEmbedMatch(line, match.index)) {
                    const imagePath = resolveImageEmbed(rawTarget, docDir);
                    if (imagePath) {
                        links.push({
                            range: {
                                start: { line: lineIdx, character: match.index },
                                end: { line: lineIdx, character: match.index + match[0].length }
                            },
                            target: pathToUri(imagePath),
                            tooltip: rawTarget
                        });
                    }
                }
                continue;
            }

            let target = pathToUri(location.filePath);
            if (location.targetLine > 0 || location.parts.anchor || location.parts.blockId) {
                target += `#L${location.targetLine + 1}`;
            }

            links.push({
                range: {
                    start: { line: lineIdx, character: match.index },
                    end: { line: lineIdx, character: match.index + match[0].length }
                },
                target,
                tooltip: location.resolvedId
            });
        }
    }

    return links;
}

function handleDefinition(msg, state) {
    const { textDocument, position } = msg.params || {};
    if (!textDocument || !position) { respond(msg.id, null); return; }

    const content = getDocumentText(state, textDocument.uri);
    const lines   = content.split('\n');
    const line    = lines[position.line] || '';

    const linkMatch = wikilinkMatchAtPosition(line, position.character);
    if (!linkMatch) { respond(msg.id, null); return; }

    const idIndex  = getIndex();
    const aliasIndex = getAliasIndex();
    const location = resolveTargetLocation(linkMatch.rawTarget, idIndex, aliasIndex);
    if (!location) {
        // ![[photo.png]] isn't a note — go-to-definition should still work if
        // it resolves to a real image file, otherwise this looks like a
        // working link (semantic tokens/document link both already parse it)
        // without go-to-definition actually doing anything. Same fix VS
        // Code's definition.js already has; this was the LSP-side gap.
        if (isEmbedMatch(line, linkMatch.start)) {
            const docPath = uriToPath(textDocument.uri);
            const imagePath = docPath ? resolveImageEmbed(linkMatch.rawTarget, path.dirname(docPath)) : null;
            if (imagePath) {
                respond(msg.id, {
                    uri: pathToUri(imagePath),
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
                });
                return;
            }
        }
        respond(msg.id, null);
        return;
    }

    respond(msg.id, {
        uri:   pathToUri(location.filePath),
        range: {
            start: { line: location.targetLine, character: 0 },
            end: { line: location.targetLine, character: 0 }
        }
    });
}

function handleDocumentLink(msg, state) {
    const { textDocument } = msg.params || {};
    if (!textDocument) { respond(msg.id, []); return; }

    const content = getDocumentText(state, textDocument.uri);
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    respond(msg.id, buildDocumentLinks(content, idIndex, aliasIndex, uriToPath(textDocument.uri)));
}

function handleDocumentHighlight(msg, state) {
    const { textDocument, position } = msg.params || {};
    if (!textDocument || !position) { respond(msg.id, []); return; }

    const content = getDocumentText(state, textDocument.uri);
    const lines = content.split('\n');
    const line = lines[position.line] || '';

    const linkMatch = wikilinkMatchAtPosition(line, position.character);
    let id = linkMatch ? resolveLinkedTarget(linkMatch.rawTarget, getIndex(), getAliasIndex()) : null;
    const currentParts = linkMatch ? parseLinkedTargetParts(linkMatch.rawTarget) : null;
    if (!id) {
        const idMatch = /^(id:\s+)(\S+)/.exec(line);
        if (idMatch) {
            const start = idMatch[1].length;
            const end = start + idMatch[2].length;
            if (position.character >= start && position.character <= end) id = idMatch[2];
        }
    }

    if (!id) { respond(msg.id, []); return; }

    const highlights = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const currentLine = lines[lineIdx];

        const idMatch = /^(id:\s+)(\S+)/.exec(currentLine);
        if (idMatch && idMatch[2] === id) {
            highlights.push({
                range: {
                    start: { line: lineIdx, character: idMatch[1].length },
                    end: { line: lineIdx, character: idMatch[1].length + id.length }
                },
                kind: 1
            });
        }

        WIKILINK_RE.lastIndex = 0;
        let match;
        while ((match = WIKILINK_RE.exec(currentLine)) !== null) {
            const currentRaw = String(match[1] || '').trim();
            const currentId = resolveLinkedTarget(currentRaw, getIndex(), getAliasIndex());
            if (linkMatch?.rawTarget) {
                const matchParts = parseLinkedTargetParts(currentRaw);
                if (currentParts?.anchor || currentParts?.blockId) {
                    if (matchParts.anchor !== currentParts.anchor) continue;
                    if (matchParts.blockId !== currentParts.blockId) continue;
                    if (currentId !== id) continue;
                } else if (currentId !== id) {
                    continue;
                }
                if (!currentParts?.anchor && !currentParts?.blockId && (matchParts.anchor || matchParts.blockId)) {
                    continue;
                }
            } else if (currentId !== id) {
                continue;
            }
            highlights.push({
                range: {
                    start: { line: lineIdx, character: match.index },
                    end: { line: lineIdx, character: match.index + match[0].length }
                },
                kind: 2
            });
        }
    }

    respond(msg.id, highlights);
}

async function handleReferences(msg, state) {
    const { textDocument, position, context } = msg.params || {};
    if (!textDocument || !position) { respond(msg.id, []); return; }

    const content = state.openDocs.get(textDocument.uri) || '';
    const lines   = content.split('\n');
    const line    = lines[position.line] || '';

    const linkMatch = wikilinkMatchAtPosition(line, position.character);
    const idIndex = getIndex();
    const aliasIndex = getAliasIndex();
    let id = linkMatch ? resolveLinkedTarget(linkMatch.rawTarget, idIndex, aliasIndex) : null;
    const linkParts = linkMatch ? parseLinkedTargetParts(linkMatch.rawTarget) : null;
    const scopedAnchor = linkParts?.anchor || '';
    const scopedBlockId = linkParts?.blockId || '';
    if (!id) {
        const m = /^id:\s+(\S+)/.exec(line);
        if (m) id = m[1];
    }

    if (!id) { respond(msg.id, []); return; }

    const includeDecl     = !!(context && context.includeDeclaration);
    const declarationPath = idIndex.get(id);
    const locations       = [];
    const fieldsCache     = getFieldsCache();

    const declarationFields = fieldsCache.get(id) || {};
    const aliasTexts = Array.isArray(declarationFields.aliases)
        ? declarationFields.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
        : String(declarationFields.aliases || '')
            .split(/,\s*/)
            .map((alias) => String(alias || '').trim())
            .filter(Boolean);
    const lookupTargets = [id].concat(aliasTexts);
    const candidateFiles = collectLinkedCandidateFiles({
        vaultPath: state.vaultPath,
        state,
        id,
        idIndex,
        aliasTexts
    });
    const diskOccurrences = getLinkedOccurrences(state, lookupTargets);
    const openDocUris = new Set(state.openDocs.keys());
    const workDoneToken = msg?.params?.workDoneToken;
    const partialResultToken = msg?.params?.partialResultToken;
    beginWorkDone(workDoneToken, 'Yamlink references', `Resolving references for "${id}"`, 0);

    let processed = 0;
    let emitted = 0;
    const total = Math.max(1, diskOccurrences.length + candidateFiles.size);
    for (const occurrence of diskOccurrences) {
        if ((processed++ % 200) === 0) await cancellationCheckpoint(state, msg.id);
        const occurrenceUri = pathToUri(occurrence.filePath);
        if (openDocUris.has(occurrenceUri)) continue;
        const currentId = resolveLinkedTarget(occurrence.rawTarget, idIndex, aliasIndex);
        if (currentId !== id) continue;
        if (linkMatch?.rawTarget) {
            const currentParts = parseLinkedTargetParts(occurrence.rawTarget);
            if (scopedAnchor || scopedBlockId) {
                if (currentParts.anchor !== scopedAnchor) continue;
                if (currentParts.blockId !== scopedBlockId) continue;
            } else if (currentParts.anchor || currentParts.blockId) {
                if (canonicalizeLinkedTarget(occurrence.rawTarget) !== canonicalizeLinkedTarget(linkMatch.rawTarget)) continue;
            }
        }
        locations.push({
            uri: occurrenceUri,
            range: {
                start: { line: occurrence.line, character: occurrence.start },
                end: { line: occurrence.line, character: occurrence.end }
            }
        });
        if (partialResultToken && locations.length - emitted >= 25) {
            reportPartialResult(partialResultToken, locations.slice(emitted));
            emitted = locations.length;
        }
    }

    if (includeDecl && declarationPath) {
        const declarationUri = pathToUri(declarationPath);
        if (!openDocUris.has(declarationUri)) {
            let declarationText = '';
            try { declarationText = fs.readFileSync(declarationPath, 'utf8'); } catch (_) { declarationText = ''; }
            if (declarationText) {
                const declarationLines = declarationText.split('\n');
                for (let lineIdx = 0; lineIdx < declarationLines.length; lineIdx++) {
                    const dm = /^(id:\s+)(\S+)/.exec(declarationLines[lineIdx]);
                    if (dm && dm[2] === id) {
                        locations.push({
                            uri: declarationUri,
                            range: {
                                start: { line: lineIdx, character: dm[1].length },
                                end: { line: lineIdx, character: dm[1].length + id.length }
                            }
                        });
                        break;
                    }
                }
            }
        }
    }

    for (const filePath of candidateFiles) {
        if ((processed++ % 25) === 0) await cancellationCheckpoint(state, msg.id);
        let text;
        const openUri = pathToUri(filePath);
        if (!state.openDocs.has(openUri)) continue;
        text = state.openDocs.get(openUri) || '';

        const fileLines     = text.split('\n');
        const isDeclaration = filePath === declarationPath;

        for (let lineIdx = 0; lineIdx < fileLines.length; lineIdx++) {
            const fl = fileLines[lineIdx];

            if (isDeclaration && includeDecl) {
                const dm = /^(id:\s+)(\S+)/.exec(fl);
                if (dm && dm[2] === id) {
                    locations.push({
                        uri:   pathToUri(filePath),
                        range: {
                            start: { line: lineIdx, character: dm[1].length },
                            end:   { line: lineIdx, character: dm[1].length + id.length }
                        }
                    });
                    continue;
                }
            }

            WIKILINK_RE.lastIndex = 0;
            let m;
            while ((m = WIKILINK_RE.exec(fl)) !== null) {
                const currentRaw = String(m[1] || '').trim();
                const currentId = resolveLinkedTarget(currentRaw, idIndex, aliasIndex);
                if (currentId !== id) {
                    continue;
                }
                if (linkMatch?.rawTarget) {
                    const currentParts = parseLinkedTargetParts(currentRaw);
                    if (scopedAnchor || scopedBlockId) {
                        if (currentParts.anchor !== scopedAnchor) continue;
                        if (currentParts.blockId !== scopedBlockId) continue;
                    } else if (currentParts.anchor || currentParts.blockId) {
                        if (canonicalizeLinkedTarget(currentRaw) !== canonicalizeLinkedTarget(linkMatch.rawTarget)) continue;
                    }
                }
                locations.push({
                    uri:   pathToUri(filePath),
                    range: {
                        start: { line: lineIdx, character: m.index },
                        end:   { line: lineIdx, character: m.index + m[0].length }
                    }
                });
                if (partialResultToken && locations.length - emitted >= 25) {
                    reportPartialResult(partialResultToken, locations.slice(emitted));
                    emitted = locations.length;
                }
            }
        }
        if (processed % 100 === 0) {
            reportWorkDone(workDoneToken, `Processed ${processed} source chunks`, Math.min(100, Math.round((processed / total) * 100)));
        }
    }

    if (isRequestCancelled(state, msg.id)) return;
    if (partialResultToken && locations.length > emitted) {
        reportPartialResult(partialResultToken, locations.slice(emitted));
    }
    endWorkDone(workDoneToken, `Found ${locations.length} references`);
    respondImmediate(msg.id, locations);
}

module.exports = {
    handleDefinition,
    handleReferences,
    handleDocumentLink,
    handleDocumentHighlight,
    buildDocumentLinks
};
