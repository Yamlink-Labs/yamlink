'use strict';

/* ── Lucide icon helpers ─────────────────────────────────────── */
function _svgIcon(paths, size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex-shrink:0">' + paths + '</svg>';
}
const _CHEVRON_RIGHT = _svgIcon('<polyline points="9 18 15 12 9 6"/>', 11);
const _ARC_ICONS = {
    created:    _svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>', 10),
    typed:      _svgIcon('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>', 10),
    connecting: _svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 10),
    last:       _svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 10),
};

function buildEmptySection(title, emptyTitle, emptyCopy) {
    return [
        `<div class="hub-section" data-field="${esc(title)}">`,
        '    <div class="hub-section-header">',
        '        <span class="hub-chevron">' + _CHEVRON_RIGHT + '</span>',
        `        <span class="hub-field">${esc(title)}</span>`,
        '        <span class="hub-count">0</span>',
        '    </div>',
        '    <div class="hub-section-body">',
        buildSectionEmptyState(emptyTitle, emptyCopy),
        '    </div>',
        '</div>'
    ].join('\n');
}

function buildSectionEmptyState(title, copy) {
    return `<div class="section-empty"><div class="section-empty-title">${title}</div><div class="section-empty-copy">${copy}</div></div>`;
}

const EMPTY_HINTS = {
    '-':                                  { msg: 'Open a Yamlink note to see its report.', hint: '' },
    'not a node':                         { msg: 'This file is not a Yamlink node.', hint: 'Add <code>id: your-note-id</code> to the frontmatter and save to index it.' },
    'Select a Yamlink node to open its report': { msg: 'Open a note in the editor.', hint: 'The Note Report updates whenever you switch to an indexed Markdown file.' }
};

function buildEntityHubEmptyHtml(label) {
    const hint = EMPTY_HINTS[label] || { msg: 'Nothing here yet.', hint: 'Link this node to others with <code>[[note-id]]</code> to build its report.' };
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:#888;font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}',
        '.hub-header{padding:11px 16px 10px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid #2a2a2a;font-size:11px;color:#6f7781;letter-spacing:.08em;text-transform:uppercase}',
        '.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;text-align:center}',
        '.msg{font-size:12px;color:#6f7781;line-height:1.5}',
        '.hint{font-size:11px;color:#555;line-height:1.6}',
        'code{background:#1e2126;padding:1px 5px;border-radius:4px;font-size:10px}',
        '</style></head><body>',
        `<div class="hub-header">${esc(label)}</div>`,
        `<div class="center"><div class="msg">${hint.msg}</div>${hint.hint ? `<div class="hint">${hint.hint}</div>` : ''}</div>`,
        '</body></html>'
    ].join('\n');
}

function buildEntityHubErrorHtml(label, error) {
    const detail = error && error.message ? error.message : String(error || 'Unknown error');
    return [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">',
        '<style>',
        '*{margin:0;padding:0;box-sizing:border-box}',
        'body{background:var(--vscode-editor-background,#141414);color:var(--vscode-editor-foreground,#c8c8c8);font-family:\'Segoe UI\',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}',
        '.hdr{padding:11px 16px 10px;background:var(--vscode-sideBar-background,#1a1a1a);border-bottom:1px solid var(--vscode-panel-border,#2a2a2a);font-size:11px;color:#8b949e;letter-spacing:.08em;text-transform:uppercase}',
        '.body{padding:16px;display:flex;flex-direction:column;gap:10px}',
        '.err{color:#ff9b9b;font-size:13px;font-weight:600}',
        '.detail{color:#8b949e;font-size:12px;line-height:1.45}',
        '</style></head><body>',
        `<div class="hdr">${esc(label)}</div>`,
        '<div class="body">',
        '<div class="err">Note Report hit a runtime error.</div>',
        `<div class="detail">${esc(detail)}</div>`,
        '</div></body></html>'
    ].join('\n');
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = {
    _svgIcon,
    _CHEVRON_RIGHT,
    _ARC_ICONS,
    esc,
    buildSectionEmptyState,
    buildEmptySection,
    buildEntityHubEmptyHtml,
    buildEntityHubErrorHtml,
    EMPTY_HINTS
};
