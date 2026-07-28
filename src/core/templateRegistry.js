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

function isWikilinkValue(value) {
    return /^\[\[[^\]]*\]\]$/.test(String(value || '').trim());
}

function extractFrontmatterAndBody(content) {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { frontmatterLines: [], body: normalized };
    return { frontmatterLines: match[1].split('\n'), body: match[2] || '' };
}

/**
 * Builds a blank-skeleton template from an existing note's raw file content,
 * matching the hand-authored shape every real template in `_templates/`
 * already uses (see loadTemplates/applyTemplate above): every key is kept,
 * every value is blanked except `type:` (the whole registry keys templates
 * off of that value). A YAML block-list field (key on one line, `- [[x]]`
 * items on the lines below) collapses to a single blank placeholder item
 * instead of repeating every real entry, so the template still shows it's a
 * list without carrying over note-specific link targets. The body keeps
 * only its heading lines — the note's structural shape — and drops all
 * prose, since that's inherently note-specific.
 * @param {string} noteContent
 * @returns {string}
 */
function buildTemplateFromNote(noteContent) {
    const { frontmatterLines, body } = extractFrontmatterAndBody(noteContent);
    const out = ['---'];
    let i = 0;
    while (i < frontmatterLines.length) {
        const line = frontmatterLines[i];
        const keyMatch = line.match(/^([\w-]+):\s*(.*)$/);
        if (!keyMatch) { i++; continue; }
        const [, key, rawValue] = keyMatch;
        const value = rawValue.trim();
        const lowerKey = key.toLowerCase();

        if (lowerKey === 'type') {
            out.push(`type: ${value}`);
            i++;
            continue;
        }
        if (lowerKey === 'id') {
            out.push('id:');
            i++;
            continue;
        }

        if (!value) {
            let j = i + 1;
            let sawListItem = false;
            let sawWikilinkItem = false;
            while (j < frontmatterLines.length && /^\s*-\s*(.*)$/.test(frontmatterLines[j])) {
                sawListItem = true;
                const itemValue = frontmatterLines[j].match(/^\s*-\s*(.*)$/)[1].trim();
                if (isWikilinkValue(itemValue)) sawWikilinkItem = true;
                j++;
            }
            out.push(`${key}:`);
            if (sawListItem) out.push(sawWikilinkItem ? '  - [[]]' : '  - ');
            i = j > i + 1 ? j : i + 1;
            continue;
        }

        out.push(isWikilinkValue(value) ? `${key}: [[]]` : `${key}: `);
        i++;
    }
    out.push('---');

    const headingLines = String(body || '').split('\n').filter(l => /^#{1,6}\s/.test(l));
    if (headingLines.length) {
        out.push('', ...headingLines);
    }
    out.push('', '');

    return out.join('\n');
}

/**
 * Writes a generated template to `_templates/<type>.md`. Refuses to
 * overwrite an existing template for that type unless `force` is set —
 * a hand-crafted template is easy to lose and hard to notice losing.
 * @param {string} workspaceRoot
 * @param {string} type
 * @param {string} content
 * @param {{ force?: boolean }} [options]
 * @returns {string} the written file path
 */
function saveTemplateFile(workspaceRoot, type, content, options) {
    const force = Boolean(options && options.force);
    const normalizedType = String(type || '').trim().toLowerCase();
    if (!workspaceRoot || !normalizedType) {
        throw new Error('workspaceRoot and type are required');
    }
    const templatesPath = path.join(workspaceRoot, TEMPLATES_DIR);
    if (!fs.existsSync(templatesPath)) fs.mkdirSync(templatesPath, { recursive: true });
    const filePath = path.join(templatesPath, `${normalizedType}.md`);
    if (fs.existsSync(filePath) && !force) {
        const err = new Error(`Template for type "${normalizedType}" already exists at ${filePath}`);
        /** @type {Error & { code?: string }} */ (err).code = 'TEMPLATE_EXISTS';
        throw err;
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

module.exports = {
    TEMPLATES_DIR,
    loadTemplates,
    getTemplateForType,
    getTemplateDrift,
    summarizeTemplateDrift,
    extractTemplateType,
    extractTemplateFields,
    buildTemplateFromNote,
    saveTemplateFile
};
