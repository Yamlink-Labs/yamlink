'use strict';

const path = require('path');
const yaml = require('js-yaml');

const { canonicalizeId, resolveLinkedTarget } = require('../core/id');
const { normaliseDateInput } = require('../core/date');
const { getCachedPriors, getCommonFieldsForType } = require('../intelligence/vaultPriors');
const { buildNoteArc } = require('../intelligence/noteArc');
const { getTemplateForType } = require('../core/templateRegistry');
const { getSchema } = require('../registries/schemaRegistry');
const { parseFrontmatter, getFieldsCache, getVaultGeneration, getIndex } = require('../core/indexService');
const { WIKILINK_RE, uriToPath } = require('./utils');

function splitLines(text) {
    return String(text || '').split('\n');
}

function findFrontmatter(content) {
    const text = String(content || '');
    if (!text.startsWith('---\n') && text.trimStart() !== text) return null;
    if (!/^\s*---/.test(text)) return null;

    const firstDash = text.indexOf('---');
    const closingIndex = text.indexOf('\n---', firstDash + 3);
    if (closingIndex === -1) return null;

    const endMarkerIndex = closingIndex + 4;
    const frontmatterText = text.slice(firstDash + 3, closingIndex + 1);
    const bodyStart = endMarkerIndex;
    let body = text.slice(bodyStart);
    if (body.startsWith('\n')) body = body.slice(1);

    return {
        start: firstDash,
        closingLineIndex: splitLines(text.slice(0, endMarkerIndex)).length - 1,
        frontmatterText,
        body,
        bodyStart: bodyStart + (text.slice(bodyStart).startsWith('\n') ? 1 : 0),
        rawEnd: endMarkerIndex
    };
}

function buildFullDocumentEdit(uri, content, newText) {
    const lines = splitLines(content);
    const lastLine = lines.length - 1;
    const lastChar = (lines[lastLine] || '').length;
    return {
        changes: {
            [uri]: [{
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: lastLine, character: lastChar }
                },
                newText
            }]
        }
    };
}

function insertFieldsBeforeClosing(uri, content, fields) {
    const frontmatter = findFrontmatter(content);
    if (!frontmatter || !Array.isArray(fields) || fields.length === 0) return null;

    const insertText = fields.map((entry) => {
        const key = String(entry.key || '').trim();
        const value = entry.value == null ? '' : String(entry.value);
        return `${key}: ${value}`.trimEnd();
    }).join('\n') + '\n';

    return {
        changes: {
            [uri]: [{
                range: {
                    start: { line: frontmatter.closingLineIndex, character: 0 },
                    end: { line: frontmatter.closingLineIndex, character: 0 }
                },
                newText: insertText
            }]
        }
    };
}

function replaceFrontmatterFieldValue(uri, content, key, newValue) {
    const text = String(content || '');
    const lines = splitLines(text);
    const frontmatter = findFrontmatter(text);
    if (!frontmatter) return null;

    const escapedKey = String(key || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fieldRe = new RegExp(`^(\\s*${escapedKey}:\\s*)(.*)$`);
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] && lines[i].trim() === '---') break;
        const match = fieldRe.exec(lines[i]);
        if (!match) continue;
        return {
            changes: {
                [uri]: [{
                    range: {
                        start: { line: i, character: match[1].length },
                        end: { line: i, character: lines[i].length }
                    },
                    newText: String(newValue ?? '')
                }]
            }
        };
    }
    return null;
}

function buildCreateNoteEdit(vaultPath, targetId, targetType) {
    const noteType = String(targetType || 'note').trim() || 'note';
    const safeId = canonicalizeId(targetId);
    const filePath = path.join(vaultPath, safeId + '.md');
    const uri = filePath.replace(/\\/g, '/').startsWith('/')
        ? 'file://' + filePath.replace(/\\/g, '/')
        : 'file:///' + filePath.replace(/\\/g, '/');

    return {
        documentChanges: [
            { kind: 'create', uri, options: { overwrite: false, ignoreIfExists: true } },
            {
                textDocument: { uri, version: null },
                edits: [{
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    },
                    newText: `---\nid: ${safeId}\ntype: ${noteType}\n---\n`
                }]
            }
        ]
    };
}

function inferDocumentType(fields, priors) {
    const explicit = String(fields.type || '').trim().toLowerCase();
    if (explicit) return explicit;

    const keys = Object.keys(fields || {}).filter((key) => !['id', 'type'].includes(key));
    let bestType = '';
    let bestScore = 0;
    for (const [noteType, bundle] of priors.typeFieldBundles || new Map()) {
        let score = 0;
        for (const key of keys) score += bundle.get(key) || 0;
        if (score > bestScore) {
            bestScore = score;
            bestType = noteType;
        }
    }
    return bestType || 'note';
}

function getOrderedFieldNames(fields, noteType, priors) {
    const seen = new Set();
    const order = [];

    for (const fixed of ['id', 'type']) {
        if (fixed in fields) {
            order.push(fixed);
            seen.add(fixed);
        }
    }

    const commonFields = noteType
        ? getCommonFieldsForType(noteType, priors.typeFieldBundles, getFieldsCache(), { limit: 32, minRatio: 0.2 }, priors.typeBundleTotals)
        : [];
    for (const entry of commonFields) {
        const field = String(entry?.field || '').trim();
        if (!field) continue;
        if (!(field in fields) || seen.has(field)) continue;
        order.push(field);
        seen.add(field);
    }

    for (const key of ['name', 'title', 'status', 'date', 'created', 'updated', 'tags', 'summary']) {
        if (key in fields && !seen.has(key)) {
            order.push(key);
            seen.add(key);
        }
    }

    const remaining = Object.keys(fields)
        .filter((key) => !seen.has(key))
        .sort((a, b) => a.localeCompare(b));
    order.push(...remaining);
    return order;
}

function normalizeFieldValue(key, value) {
    const raw = String(value ?? '');
    const trimmed = raw.trim();
    if (trimmed && (key === 'date' || key === 'created' || key === 'updated')) {
        return normaliseDateInput(trimmed) || trimmed;
    }
    return trimmed;
}

function buildFormattedFrontmatterContent(uri, content) {
    const frontmatter = findFrontmatter(content);
    if (!frontmatter) return null;

    const parsed = parseFrontmatter(content);
    if (!parsed) return null;

    const fields = { ...parsed };
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
    const noteType = inferDocumentType(fields, priors);
    fields.id = canonicalizeId(fields.id || path.basename(uriToPath(uri), path.extname(uriToPath(uri))));
    fields.type = noteType || 'note';

    const orderedFieldNames = getOrderedFieldNames(fields, noteType, priors);
    const orderedFields = {};
    for (const key of orderedFieldNames) {
        orderedFields[key] = normalizeFieldValue(key, fields[key]);
    }

    const yamlText = yaml.dump(orderedFields, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
    }).replace(/\.\.\.\s*$/m, '').trimEnd();

    const body = frontmatter.body;
    return `---\n${yamlText}\n---${body ? `\n\n${body.replace(/^\n+/, '')}` : '\n'}`;
}

function buildScaffoldIdentityEdit(uri, content) {
    const filePath = uriToPath(uri);
    const suggestedId = canonicalizeId(path.basename(filePath, path.extname(filePath)));
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
    const frontmatter = findFrontmatter(content);

    if (!frontmatter) {
        const parsedBody = String(content || '').trimStart();
        const newText = `---\nid: ${suggestedId}\ntype: note\n---${parsedBody ? `\n\n${parsedBody}` : '\n'}`;
        return {
            id: suggestedId,
            type: 'note',
            edit: buildFullDocumentEdit(uri, content, newText)
        };
    }

    const parsed = parseFrontmatter(content) || {};
    const fieldsToAdd = [];
    if (!String(parsed.id || '').trim()) fieldsToAdd.push({ key: 'id', value: suggestedId });

    const inferredType = inferDocumentType(parsed, priors) || 'note';
    if (!String(parsed.type || '').trim()) fieldsToAdd.push({ key: 'type', value: inferredType });
    if (!fieldsToAdd.length) return null;

    return {
        id: String(parsed.id || suggestedId),
        type: inferredType,
        edit: insertFieldsBeforeClosing(uri, content, fieldsToAdd)
    };
}

function suggestUniqueId(uri, content, idIndex) {
    const filePath = uriToPath(uri);
    const baseName = canonicalizeId(path.basename(filePath, path.extname(filePath)));
    const candidateBase = baseName || canonicalizeId((parseFrontmatter(content) || {}).id || 'note');
    if (!candidateBase) return null;

    const existingPath = idIndex.get(candidateBase);
    if (!existingPath || existingPath === filePath) return candidateBase;

    for (let i = 2; i < 1000; i++) {
        const candidate = `${candidateBase}-${i}`;
        const candidatePath = idIndex.get(candidate);
        if (!candidatePath || candidatePath === filePath) return candidate;
    }

    return null;
}

function inferSchemaTarget(uri, content) {
    const parsed = parseFrontmatter(content) || {};
    const explicitId = canonicalizeId(parsed.id || '');
    const filePath = uriToPath(uri);
    const fileBase = canonicalizeId(path.basename(filePath, path.extname(filePath)));
    const candidates = [explicitId, fileBase];

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate.endsWith('-schema') && candidate.length > '-schema'.length) {
            return candidate.slice(0, -'-schema'.length);
        }
    }

    return '';
}

function inferTargetTypeFromField(fieldName, priors) {
    if (!fieldName) return null;
    const targetMap = priors.fieldTargetTypes?.get(fieldName);
    if (!targetMap || targetMap.size === 0) return null;
    const best = [...targetMap.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
}

function collectMissingFieldsForNote(noteId, vaultPath) {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const fields = fieldsCache.get(noteId) || {};
    const type = String(fields.type || '').trim().toLowerCase();
    if (!idIndex.has(noteId) || !type) return { missingFields: [], suggested: [] };

    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const arc = buildNoteArc(
        fields,
        type,
        fieldsCache,
        priors.typeFieldBundles,
        priors.fieldTargetTypes,
        priors.outcomeCalibration,
        { typeBundleTotals: priors.typeBundleTotals, limit: 6 }
    );
    const suggested = [];
    for (const item of arc.missingFields || []) {
        if (!item || !(item.confidenceLabel === 'high' || item.confidenceLabel === 'medium' || item.coldStart)) continue;
        suggested.push(item.field);
    }

    const schema = getSchema(type);
    const required = schema
        ? Object.entries(schema.fields)
            .filter(([, def]) => def && def.required)
            .map(([field]) => field)
        : [];

    const template = getTemplateForType(vaultPath, type);
    const templateFields = template?.fields || [];

    const ordered = [];
    const seen = new Set();
    for (const field of [...required, ...suggested, ...templateFields]) {
        if (!field || (field in fields) || seen.has(field)) continue;
        seen.add(field);
        ordered.push(field);
    }
    return { missingFields: ordered, suggested };
}

function findBrokenLinkTargets(content, idIndex, aliasIndex) {
    const results = [];
    const lines = splitLines(content);
    let frontmatterLimit = -1;
    const frontmatter = findFrontmatter(content);
    if (frontmatter) frontmatterLimit = frontmatter.rawEnd;

    let offset = 0;
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        WIKILINK_RE.lastIndex = 0;
        let match;
        while ((match = WIKILINK_RE.exec(line)) !== null) {
            const rawTarget = match[1].trim();
            const bareTarget = rawTarget.split('|')[0].trim().split('#')[0].trim().split('^')[0].trim();
            if (resolveLinkedTarget(rawTarget, idIndex, aliasIndex)) continue;
            results.push({
                id: canonicalizeId(bareTarget),
                raw: bareTarget,
                line: lineIdx,
                isFrontmatter: frontmatterLimit !== -1 && (offset + match.index) < frontmatterLimit
            });
        }
        offset += line.length + 1;
    }
    return results;
}

module.exports = {
    findFrontmatter,
    buildFullDocumentEdit,
    insertFieldsBeforeClosing,
    replaceFrontmatterFieldValue,
    buildCreateNoteEdit,
    buildFormattedFrontmatterContent,
    buildScaffoldIdentityEdit,
    suggestUniqueId,
    inferSchemaTarget,
    inferTargetTypeFromField,
    collectMissingFieldsForNote,
    findBrokenLinkTargets
};
