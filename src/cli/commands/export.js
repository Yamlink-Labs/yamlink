'use strict';

const fs   = require('fs');

const { getIndex, getFieldsCache, getAliasIndex } = require('../../core/indexService');
const { parseFrontmatterDocument } = require('../../core/frontmatter');
const { resolveViewBlocksToSnapshot } = require('../../core/buildPipeline');
const { resolvePublishLinks } = require('../../core/publish');
const { parseViewQuery, runQuery } = require('../../engine/query');
const fmt = require('../format');
const { emitCliError, emitText } = require('../io');

let _md = null;

function getMd() {
    if (!_md) {
        const MarkdownIt = require('markdown-it');
        const { calloutPlugin } = require('../../export/markdownItCallouts');
        _md = new MarkdownIt({ html: true, linkify: false });
        calloutPlugin(_md);
    }
    return _md;
}

function unwikilink(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, id) => id.trim());
}

function flattenNote(id, fields) {
    const out = { id };
    for (const [k, v] of Object.entries(fields)) {
        if (k.startsWith('__')) continue;
        const raw = Array.isArray(v) ? v.map(unwikilink).join('; ') : unwikilink(String(v ?? ''));
        out[k] = raw;
    }
    return out;
}

function toCSV(rows) {
    if (!rows.length) return '';
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const escape = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
    };
    const lines = [keys.join(',')];
    for (const row of rows) {
        lines.push(keys.map(k => escape(row[k] ?? '')).join(','));
    }
    return lines.join('\n');
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildStandaloneHtml({ title, bodyHtml }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f8f6f1;--fg:#171717;--muted:#666;--line:#ddd6c8;--accent:#186b60}
@media (prefers-color-scheme:dark){:root{--bg:#151515;--fg:#efeee9;--muted:#aaa;--line:#333;--accent:#5ecfbe}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 Georgia,"Times New Roman",serif}
main{max-width:760px;margin:0 auto;padding:56px 24px 80px}
h1,h2,h3,h4{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.2;margin:1.8em 0 .5em}
h1{font-size:2.4rem;margin-top:0}
a{color:var(--accent);text-decoration-thickness:.08em;text-underline-offset:.16em}
code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
pre{overflow:auto;padding:14px;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;margin:1.4em 0;font-family:ui-sans-serif,system-ui,sans-serif;font-size:.92em}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{color:var(--muted);font-size:.76em;text-transform:uppercase;letter-spacing:.08em}
blockquote{border-left:3px solid var(--line);margin:1.4em 0;padding-left:1em;color:var(--muted)}
img{max-width:100%;height:auto}
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}

function renderNoteHtml(id, { json }) {
    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const aliasIndex = getAliasIndex();
    const filePath = idIndex.get(id);

    if (!id) {
        emitCliError({ json, error: 'yamlink export --format html requires --id <note-id>', code: 'USAGE', exitCode: 1 });
        return null;
    }
    if (!filePath) {
        emitCliError({ json, error: 'Note not found: ' + id, code: 'NOT_FOUND', exitCode: 1, details: { id } });
        return null;
    }

    let parsed;
    try {
        parsed = parseFrontmatterDocument(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        emitCliError({ json, error: 'Export failed: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
        return null;
    }

    const fields = fieldsCache.get(id) || parsed.data || {};
    const title = fields.title || fields.name || id;
    const snapshotBody = resolveViewBlocksToSnapshot(parsed.body || '', id);
    const linkedBody = resolvePublishLinks(snapshotBody, idIndex, aliasIndex);
    const bodyHtml = getMd().render(linkedBody);
    return buildStandaloneHtml({ title, bodyHtml });
}

function run({ id, query, format, output, json, quiet }) {
    const idIndex    = getIndex();
    const fieldsCache = getFieldsCache();

    const fmt2 = format || 'json';
    if (fmt2 === 'html') {
        const content = renderNoteHtml(id, { json });
        if (content == null) return;
        if (output) {
            try {
                fs.writeFileSync(output, content, 'utf8');
            } catch (error) {
                emitCliError({ json, error: 'Export failed: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
                return;
            }
            if (!quiet) console.log(fmt.ok('Exported ' + id + ' to ' + output));
        } else {
            emitText(content + '\n');
        }
        return;
    }

    let rows;
    if (query) {
        let text = query.trim();
        if (!text.startsWith('!view ')) text = '!view * ' + text;
        const parsed = parseViewQuery(text);
        if (!parsed) {
            emitCliError({ json, error: 'Could not parse query: ' + query, code: 'QUERY_PARSE_ERROR', exitCode: 1 });
            return;
        }
        const result = runQuery(parsed, new Date().toISOString().slice(0, 10));
        if (!result?.success) {
            emitCliError({ json, error: 'Query failed', code: 'QUERY_FAILED', exitCode: 2 });
            return;
        }
        rows = result.rows.map(r => flattenNote(r.id, r.fields || {}));
    } else {
        rows = [];
        for (const [id] of idIndex) {
            rows.push(flattenNote(id, fieldsCache.get(id) || {}));
        }
    }

    let content;
    if (fmt2 === 'csv') {
        content = toCSV(rows);
    } else {
        content = JSON.stringify(rows, null, 2);
    }

    if (output) {
        try {
            fs.writeFileSync(output, content, 'utf8');
        } catch (error) {
            emitCliError({ json, error: 'Export failed: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
            return;
        }
        if (!quiet) console.log(fmt.ok('Exported ' + rows.length + ' note(s) to ' + output));
    } else {
        emitText(content + '\n');
    }
}

module.exports = { run };
