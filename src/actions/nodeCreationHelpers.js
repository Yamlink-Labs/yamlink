'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { canonicalizeId } = require('../core/id');
const { parseFrontmatterDocument } = require('../core/frontmatter');
const { buildIndex, updateSingleFile, invalidateFileCache } = require('../core/index');

function getCommonVaultFields(type, fieldsCache) {
    const fieldCounts = new Map();
    let noteCount = 0;
    for (const fields of fieldsCache.values()) {
        if (String(fields.type || '').toLowerCase() !== type.toLowerCase()) continue;
        noteCount++;
        for (const key of Object.keys(fields)) {
            if (key === 'type' || key === 'id' || key === 'created') continue;
            fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
        }
    }
    if (noteCount === 0) return [];
    const threshold = Math.max(1, noteCount * 0.4);
    return [...fieldCounts.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k);
}

function buildSmartFrontmatter(id, type, fieldsCache, today, reverseField, reverseId) {
    const candidates = [];
    for (const fields of fieldsCache.values()) {
        if (String(fields.type || '').toLowerCase() === type.toLowerCase()) {
            candidates.push(fields);
        }
    }

    if (candidates.length === 0) {
        const typeField = `type: ${type}\n`;
        const reverseBlock = reverseField && reverseId ? `${reverseField}: [[${reverseId}]]\n` : '';
        return `---\nid: ${id}\n${typeField}${reverseBlock}created: ${today}\n---\n\n`;
    }

    const freq = new Map();
    const SKIP = new Set(['id', 'type', 'created', 'updated', 'modified', 'indexed']);
    for (const fields of candidates) {
        for (const key of Object.keys(fields)) {
            if (SKIP.has(key)) continue;
            freq.set(key, (freq.get(key) || 0) + 1);
        }
    }

    const threshold = Math.max(1, Math.ceil(candidates.length * 0.5));
    const commonFields = [...freq.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => key);

    let fm = `---\nid: ${id}\ntype: ${type}\n`;
    for (const field of commonFields) {
        if (reverseField && field === reverseField && reverseId) {
            fm += `${field}: [[${reverseId}]]\n`;
        } else {
            fm += `${field}:\n`;
        }
    }
    if (reverseField && reverseId && !commonFields.includes(reverseField)) {
        fm += `${reverseField}: [[${reverseId}]]\n`;
    }
    fm += `created: ${today}\n---\n\n`;
    return fm;
}

function buildSchemaFrontmatter(id, type, schemaFields, today, reverseField, reverseId) {
    const entries = Object.entries(schemaFields);
    const required = entries.filter(([, def]) => def.required);
    const optional = entries.filter(([, def]) => !def.required);

    let fm = `---\nid: ${id}\ntype: ${type}\n`;
    for (const [fieldName, fieldDef] of [...required, ...optional]) {
        if (reverseField && fieldName === reverseField && reverseId) {
            fm += `${fieldName}: [[${reverseId}]]\n`;
        } else if (fieldDef.type === 'relation') {
            fm += `${fieldName}: [[]]\n`;
        } else {
            fm += `${fieldName}:\n`;
        }
    }
    fm += `created: ${today}\n---\n\n`;
    return fm;
}

function positionCursorOnFirstEmptyField(editor, document) {
    const lines = document.getText().split('\n');
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === 0 && line.trim() === '---') { inFm = true; continue; }
        if (inFm && line.trim() === '---') break;
        if (!inFm) break;
        const relMatch = line.match(/^(\s*[\w-]+:\s*)\[\[\]\]/);
        if (relMatch) {
            const col = relMatch[1].length + 2;
            const pos = new vscode.Position(i, col);
            editor.selection = new vscode.Selection(pos, pos);
            if (typeof editor.revealRange === 'function') {
                editor.revealRange(new vscode.Range(pos, pos));
            }
            return;
        }
        const emptyMatch = line.match(/^(\s*[\w-]+:)\s*$/);
        if (emptyMatch) {
            const col = emptyMatch[1].length + 1;
            const pos = new vscode.Position(i, col);
            editor.selection = new vscode.Selection(pos, pos);
            if (typeof editor.revealRange === 'function') {
                editor.revealRange(new vscode.Range(pos, pos));
            }
            return;
        }
    }
}

async function focusFirstEmptyFieldAndSuggest(editor, document) {
    if (!editor || !document) return false;
    const previousSelection = editor.selection || null;
    positionCursorOnFirstEmptyField(editor, document);
    const nextSelection = editor.selection || null;
    const moved = Boolean(
        nextSelection
        && (!previousSelection
            || nextSelection.start?.line !== previousSelection.start?.line
            || nextSelection.start?.character !== previousSelection.start?.character
            || nextSelection.end?.line !== previousSelection.end?.line
            || nextSelection.end?.character !== previousSelection.end?.character)
    );
    if (moved) {
        await vscode.commands.executeCommand('editor.action.triggerSuggest');
    }
    return moved;
}

function applyTemplate(content, newId, today) {
    let result = content;

    if (/^\s*id:\s*$/m.test(result)) {
        result = result.replace(/^(\s*id:)\s*$/m, `$1 ${newId}`);
    } else if (!/^\s*id:\s*.+/m.test(result)) {
        result = result.replace(/^(---\s*\n)/, `$1id: ${newId}\n`);
    }

    if (/^\s*created:\s*$/m.test(result)) {
        result = result.replace(/^(\s*created:)\s*$/m, `$1 ${today}`);
    }

    if (/^\s*date:\s*$/m.test(result)) {
        result = result.replace(/^(\s*date:)\s*$/m, `$1 ${today}`);
    }

    return result;
}

function buildSuggestedRelationNodeId(targetType, sourceId, fieldName) {
    const source = canonicalizeId(String(sourceId || '').trim()) || 'note';
    const target = canonicalizeId(String(targetType || fieldName || 'related').trim()) || 'related';
    if (source && target) return `${source}-${target}`;
    return `new-${target}`;
}

function buildStarterTemplateContent(type, commonFields) {
    const skip = new Set(['id', 'type', 'created', 'updated', 'modified']);
    const lines = ['---', 'id:', `type: ${type}`];
    for (const field of commonFields) {
        if (skip.has(field)) continue;
        lines.push(`${field}: `);
    }
    lines.push('created:', '---', '', '');
    return lines.join('\n');
}

function inferReverseRelationField(targetType, sourceType, sourceId, fieldsCache) {
    const normalizedSourceType = String(sourceType || '').trim().toLowerCase();
    if (!normalizedSourceType) return null;

    for (const fields of fieldsCache.values()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (noteType !== String(targetType || '').trim().toLowerCase()) continue;
        if (Object.prototype.hasOwnProperty.call(fields, normalizedSourceType)) return normalizedSourceType;
        if (Object.prototype.hasOwnProperty.call(fields, `${normalizedSourceType}s`)) return `${normalizedSourceType}s`;
    }

    if (sourceId && normalizedSourceType) return normalizedSourceType;
    return null;
}

function mergeRelationFieldValue(existingValue, targetId) {
    const nextLink = `[[${targetId}]]`;
    const current = String(existingValue || '').trim();
    if (!current) return nextLink;
    if (current.includes(nextLink)) return current;
    return `${current}, ${nextLink}`;
}

function readExistingFieldValue(filePath, fieldName) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = parseFrontmatterDocument(content);
        if (!parsed?.hasFrontmatter) return '';
        return parsed.data?.[fieldName] ?? '';
    } catch (error) {
        return '';
    }
}

function syncIndexAfterWrite(filePath) {
    if (!filePath) return;
    invalidateFileCache(filePath);
    const result = updateSingleFile(filePath, { force: true, workspaceFolders: vscode.workspace.workspaceFolders });
    if (result.needsFull && vscode.workspace.workspaceFolders) {
        buildIndex(vscode.workspace.workspaceFolders);
    }
}

module.exports = {
    getCommonVaultFields,
    buildSmartFrontmatter,
    buildSchemaFrontmatter,
    positionCursorOnFirstEmptyField,
    focusFirstEmptyFieldAndSuggest,
    applyTemplate,
    buildSuggestedRelationNodeId,
    buildStarterTemplateContent,
    inferReverseRelationField,
    mergeRelationFieldValue,
    readExistingFieldValue,
    syncIndexAfterWrite
};
