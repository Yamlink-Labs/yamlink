'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = '_templates';
const SYSTEM_TYPES = new Set(['schema', 'dashboard', 'template']);

function extractTemplateType(content) {
    const match = content.match(/^\s*type:\s*(.+)$/m);
    return match ? match[1].trim().toLowerCase() : '';
}

function extractTemplateFields(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];
    return fmMatch[1].split('\n')
        .map(line => line.match(/^\s*([\w-]+):/)?.[1])
        .filter(Boolean)
        .filter(f => f !== 'id' && f !== 'type' && f !== 'created');
}

/**
 * @param {string} workspaceRoot
 * @returns {{ name: string, filePath: string, content: string, type: string, fields: string[] }[]}
 */
function loadTemplates(workspaceRoot) {
    if (!workspaceRoot) return [];
    const templatesPath = path.join(workspaceRoot, TEMPLATES_DIR);
    if (!fs.existsSync(templatesPath)) return [];

    let files;
    try { files = fs.readdirSync(templatesPath); } catch (_) { return []; }

    return files
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => {
            const filePath = path.join(templatesPath, f);
            let content = '';
            try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
            const type = extractTemplateType(content);
            const fields = extractTemplateFields(content);
            return { name: path.basename(f, '.md'), filePath, content, type, fields };
        })
        .filter(t => t && t.content.length > 0);
}

/**
 * @param {string} workspaceRoot
 * @param {string} type
 * @returns {{ name: string, filePath: string, content: string, type: string, fields: string[] } | null}
 */
function getTemplateForType(workspaceRoot, type) {
    if (!type || !workspaceRoot) return null;
    const normalizedType = type.toLowerCase();
    const templates = loadTemplates(workspaceRoot);
    return templates.find(t => t.type === normalizedType) || null;
}

/**
 * Returns notes whose fields are missing keys defined in their `_templates/` counterpart.
 * Only absent keys are flagged — empty values are intentional.
 * @param {string} workspaceRoot
 * @param {Map<string,object>} fieldsCache
 * @returns {{ type: string, noteId: string, missingFields: string[] }[]}
 */
function getTemplateDrift(workspaceRoot, fieldsCache) {
    if (!workspaceRoot || !fieldsCache) return [];

    const templates = loadTemplates(workspaceRoot);
    if (!templates.length) return [];

    const templateMap = new Map();
    for (const t of templates) {
        if (t.type && t.fields.length > 0) {
            templateMap.set(t.type, t.fields);
        }
    }
    if (!templateMap.size) return [];

    const drift = [];
    for (const [noteId, fields] of fieldsCache) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!noteType || SYSTEM_TYPES.has(noteType) || !templateMap.has(noteType)) continue;

        const templateFields = templateMap.get(noteType);
        const missingFields = templateFields.filter(f => !(f in (fields || {})));
        if (missingFields.length > 0) {
            drift.push({ type: noteType, noteId, missingFields });
        }
    }

    return drift;
}

/**
 * @param {{ type: string, noteId: string, missingFields: string[] }[]} drift
 * @returns {Map<string, { driftCount: number, notes: { noteId: string, missingFields: string[] }[] }>}
 */
function summarizeTemplateDrift(drift) {
    const byType = new Map();
    for (const entry of drift) {
        if (!byType.has(entry.type)) {
            byType.set(entry.type, { driftCount: 0, notes: [] });
        }
        const bucket = byType.get(entry.type);
        bucket.driftCount++;
        bucket.notes.push({ noteId: entry.noteId, missingFields: entry.missingFields });
    }
    return byType;
}

module.exports = {
    TEMPLATES_DIR,
    loadTemplates,
    getTemplateForType,
    getTemplateDrift,
    summarizeTemplateDrift,
    extractTemplateType,
    extractTemplateFields
};
