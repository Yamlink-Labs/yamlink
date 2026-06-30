'use strict';

const path = require('path');

const { getIndex }    = require('../core/indexService');
const { getDuplicateIds, getFieldsCache, getAliasIndex, getVaultGeneration } = require('../core/indexService');
const { getSchema, getDuplicateSchemas, hasSchema } = require('../registries/schemaRegistry');
const { computeNoteDrift } = require('../intelligence/driftDetector');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const { extractCanonicalIdFromFrontmatter, resolveLinkedTarget } = require('../core/id');
const { getTemplateForType } = require('../core/templateRegistry');
const { notify, log, logToClient } = require('./transport');
const { WIKILINK_RE, pathToUri, collectMdFiles, readTextFileSafe } = require('./utils');
const { findFrontmatter } = require('./documentHelpers');
const { cancellationCheckpoint, isRequestCancelled } = require('./cancellation');
const { beginWorkDone, reportWorkDone, endWorkDone, reportPartialResult } = require('./progress');

function collectDiagnosticsFromContent(content, idIndex, filePath, state) {
    const diagnostics = [];
    const text = String(content || '');
    const lines = text.split('\n');
    const hasFrontmatter = /^\s*---/.test(text);
    const hasId = /^\s*id:\s*.+/m.test(text);
    const fieldsCache = getFieldsCache();
    const aliasIndex = getAliasIndex();
    const frontmatter = findFrontmatter(text);
    const frontmatterLimit = frontmatter ? frontmatter.rawEnd : -1;

    if (!hasFrontmatter || !hasId) {
        diagnostics.push({
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            },
            severity: 3,
            source: 'yamlink',
            code: 'yamlink.missingId',
            message: 'Yamlink: This file has no id field and will not be indexed as a note.',
            data: { action: 'scaffoldIdentity' }
        });
    }

    const thisId = extractCanonicalIdFromFrontmatter(text);
    if (thisId) {
        const duplicates = getDuplicateIds();
        if (duplicates.has(thisId)) {
            const idLine = lines.findIndex((line) => /^\s*id:\s*.+/.test(line));
            diagnostics.push({
                range: {
                    start: { line: Math.max(idLine, 0), character: 0 },
                    end: { line: Math.max(idLine, 0), character: (lines[Math.max(idLine, 0)] || '').length }
                },
                severity: 2,
                source: 'yamlink',
                code: 'yamlink.duplicateId',
                message: `Yamlink: id "${thisId}" is declared in multiple files.`,
                data: { id: thisId }
            });
        }
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        WIKILINK_RE.lastIndex = 0;
        let match;
        while ((match = WIKILINK_RE.exec(lines[lineIdx])) !== null) {
            const rawTarget = match[1].trim();
            const bareTarget = rawTarget.split('|')[0].trim().split('#')[0].trim().split('^')[0].trim();
            const id = bareTarget;
            const absoluteOffset = lines.slice(0, lineIdx).reduce((total, line) => total + line.length + 1, 0) + match.index;
            const isInFrontmatter = frontmatterLimit !== -1 && absoluteOffset < frontmatterLimit;
            if (!resolveLinkedTarget(rawTarget, idIndex, aliasIndex)) {
                diagnostics.push({
                    range: {
                        start: { line: lineIdx, character: match.index },
                        end:   { line: lineIdx, character: match.index + match[0].length }
                    },
                    severity: isInFrontmatter ? 3 : 2,
                    source:   'yamlink',
                    code: isInFrontmatter ? 'yamlink.brokenRelation' : 'yamlink.brokenLink',
                    message:  isInFrontmatter
                        ? `Broken relation: [[${id}]] — no note with this ID exists in the vault`
                        : `Broken link: [[${id}]] — no note with this ID exists in the vault`,
                    data: { targetId: id, relation: isInFrontmatter, line: lineIdx }
                });
            }
        }
    }

    const fields = thisId ? (fieldsCache.get(thisId) || {}) : {};
    const noteType = String(fields.type || '').trim().toLowerCase();
    if (thisId && noteType) {
        if (hasSchema(noteType)) {
            const schema = getSchema(noteType);
            const missingRequired = Object.entries(schema.fields)
                .filter(([field, def]) => def && def.required && !(field in fields))
                .map(([field]) => field)
                .filter(Boolean);
            if (missingRequired.length) {
                const typeLine = lines.findIndex((line) => /^\s*type:\s*.+/.test(line));
                diagnostics.push({
                    range: {
                        start: { line: Math.max(typeLine, 0), character: 0 },
                        end: { line: Math.max(typeLine, 0), character: (lines[Math.max(typeLine, 0)] || '').length }
                    },
                    severity: 2,
                    source: 'yamlink',
                    code: 'yamlink.missingRequiredField',
                    message: `Yamlink: Missing required fields: ${missingRequired.join(', ')}`,
                    data: { id: thisId, missingFields: missingRequired }
                });
            }
        }

        if (noteType === 'schema') {
            const targetMatch = text.match(/^\s*target:\s*(.+?)\s*$/m);
            if (!targetMatch) {
                const typeLine = lines.findIndex((line) => /^\s*type:\s*schema\s*$/i.test(line));
                diagnostics.push({
                    range: {
                        start: { line: Math.max(typeLine, 0), character: 0 },
                        end: { line: Math.max(typeLine, 0), character: (lines[Math.max(typeLine, 0)] || '').length }
                    },
                    severity: 2,
                    source: 'yamlink',
                    code: 'yamlink.malformedSchema',
                    message: 'Yamlink: Schema note is missing a target: field.'
                });
            } else {
                const dupSchemas = getDuplicateSchemas();
                const targetType = targetMatch[1].trim().toLowerCase();
                if (dupSchemas.has(targetType)) {
                    const targetLine = lines.findIndex((line) => /^\s*target:\s*.+/.test(line));
                    diagnostics.push({
                        range: {
                            start: { line: Math.max(targetLine, 0), character: 0 },
                            end: { line: Math.max(targetLine, 0), character: (lines[Math.max(targetLine, 0)] || '').length }
                        },
                        severity: 2,
                        source: 'yamlink',
                        code: 'yamlink.duplicateSchema',
                        message: `Yamlink: A schema for "${targetType}" already exists.`
                    });
                }
            }
        }

        if (state?.vaultPath) {
            const template = getTemplateForType(state.vaultPath, noteType);
            const missingTemplateFields = (template?.fields || []).filter((field) => !(field in fields));
            if (missingTemplateFields.length) {
                const typeLine = lines.findIndex((line) => /^\s*type:\s*.+/.test(line));
                diagnostics.push({
                    range: {
                        start: { line: Math.max(typeLine, 0), character: 0 },
                        end: { line: Math.max(typeLine, 0), character: (lines[Math.max(typeLine, 0)] || '').length }
                    },
                    severity: 2,
                    source: 'yamlink',
                    code: 'yamlink.templateDrift',
                    message: `Yamlink: Missing template fields: ${missingTemplateFields.join(', ')}`,
                    data: { id: thisId, missingFields: missingTemplateFields }
                });
            }
        }

        const priors = getCachedPriors(fieldsCache, getVaultGeneration());
        const drift = computeNoteDrift(thisId, fields, fieldsCache, priors);
        if (drift && !drift.insufficientData && (drift.driftLabel === 'drifting' || drift.driftLabel === 'outlier')) {
            const missingFields = (drift.missingExpected || []).map((entry) => entry.field).slice(0, 4);
            if (missingFields.length) {
                const typeLine = lines.findIndex((line) => /^\s*type:\s*.+/.test(line));
                diagnostics.push({
                    range: {
                        start: { line: Math.max(typeLine, 0), character: 0 },
                        end: { line: Math.max(typeLine, 0), character: (lines[Math.max(typeLine, 0)] || '').length }
                    },
                    severity: 2,
                    source: 'yamlink',
                    code: 'yamlink.noteDrift',
                    message: `Yamlink: This note is ${drift.driftLabel} and likely missing: ${missingFields.join(', ')}`,
                    data: { id: thisId, missingFields, driftLabel: drift.driftLabel, driftScore: drift.driftScore }
                });
            }
        }
    }

    return diagnostics;
}

function collectTextDiagnostics(uri, state) {
    const idIndex = getIndex();
    const openText = state.openDocs.get(uri);
    if (typeof openText === 'string') {
        return collectDiagnosticsFromContent(openText, idIndex, filePathFromUri(uri), state);
    }
    const filePath = state.uriToPath ? state.uriToPath(uri) : null;
    const content = filePath ? readTextFileSafe(filePath) : null;
    return collectDiagnosticsFromContent(content || '', idIndex, filePath, state);
}

async function collectWorkspaceDiagnostics(state, requestId = null, options = {}) {
    const items = [];
    const workDoneToken = options.workDoneToken;
    const partialResultToken = options.partialResultToken;
    const files = collectMdFiles(state.vaultPath);
    const total = Math.max(1, files.length || 1);
    let processed = 0;
    let batch = [];

    beginWorkDone(workDoneToken, 'Yamlink workspace diagnostics', 'Scanning markdown files', 0);
    for (const filePath of files) {
        if (requestId != null && (processed++ % 25) === 0) await cancellationCheckpoint(state, requestId);
        const uri = pathToUri(filePath);
        const content = state.openDocs.get(uri) || readTextFileSafe(filePath) || '';
        const item = {
            uri,
            version: null,
            kind: 'full',
            items: collectDiagnosticsFromContent(content, getIndex(), filePath, state)
        };
        items.push(item);
        batch.push(item);
        if (partialResultToken && batch.length >= 25) {
            reportPartialResult(partialResultToken, { items: batch });
            batch = [];
        }
        const percentage = Math.min(100, Math.round((processed / total) * 100));
        if (processed === total || processed % 25 === 0) {
            reportWorkDone(workDoneToken, `Processed ${processed} / ${total} files`, percentage);
        }
    }
    if (partialResultToken && batch.length) {
        reportPartialResult(partialResultToken, { items: batch });
    }
    if (requestId != null && isRequestCancelled(state, requestId)) return [];
    endWorkDone(workDoneToken, `Scanned ${items.length} markdown files`);
    return items;
}

function publishDiagnostics(openDocs) {
    const idIndex = getIndex();
    for (const [uri, content] of openDocs) {
        const diagnostics = collectDiagnosticsFromContent(content, idIndex, filePathFromUri(uri), {
            vaultPath: null,
            openDocs,
            uriToPath: null
        });
        notify('textDocument/publishDiagnostics', { uri, diagnostics });
    }
}

function filePathFromUri(uri) {
    if (!uri) return null;
    const withoutScheme = String(uri).replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
    return withoutScheme.replace(/\//g, path.sep);
}

async function initializeVaultService(state) {
    state.vaultService.onRebuild(() => {
        const noteCount = getIndex().size;
        log(`Index rebuilt — ${noteCount} notes`);
        logToClient(`Yamlink: Index rebuilt — ${noteCount} notes`);
        publishDiagnostics(state.openDocs);
    });
    await state.vaultService.initialize(state.vaultPath);
}

function requestRebuild(state) {
    return state.vaultService.notifyFileChange();
}

async function mutateVault(state, writeFn) {
    return state.vaultService.mutate(writeFn);
}

function getCurrentIndexState(state) {
    return state && state.vaultService ? state.vaultService.getIndex() : null;
}

function getGeneration(state) {
    return state && state.vaultService ? state.vaultService.generation : getVaultGeneration();
}

module.exports = {
    initializeVaultService,
    requestRebuild,
    mutateVault,
    getCurrentIndexState,
    getGeneration,
    publishDiagnostics,
    collectTextDiagnostics,
    collectWorkspaceDiagnostics
};
