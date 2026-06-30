'use strict';

const vscode = require('vscode');
const { getFieldsCache, getPathIndex } = require('../core/indexService');
const { appendMutationEvents } = require('../runtime/mutationEventLog');
const { parseSingleViewBlock } = require('../engine/query');
const { revealDocumentAndRunViews, getViewBlockAtRange } = require('./viewBuilderCore');
const {
    deriveKnownTypes,
    buildStateFromQuery,
    buildPreviewFromState,
    buildBuilderOptions,
    normalizeBuilderState
} = require('./queryBuilderModel');

let builderPanel = null;
let builderSession = null;

function getBuilderEventNoteId(session) {
    return session?.noteId || '__vault__';
}

function createNonce() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function positionAfterInsertedText(start, text) {
    const raw = String(text || '');
    const lines = raw.split('\n');
    if (lines.length === 1) {
        return new vscode.Position(start.line, start.character + lines[0].length);
    }
    return new vscode.Position(
        start.line + lines.length - 1,
        lines[lines.length - 1].length
    );
}

function deriveHeadingLabelFromQuery(queryText, sourceType = null) {
    if (sourceType) {
        return sourceType === '*' ? 'All Nodes' : `${sourceType.charAt(0).toUpperCase()}${sourceType.slice(1)}s`;
    }
    const parsed = parseSingleViewBlock(String(queryText || '').split('\n'));
    if (!parsed) return 'View';
    if (parsed.label) return parsed.label;
    if (parsed.type === 'tasks') {
        const preset = String(parsed.preset || parsed.shorthand || parsed.type);
        return preset
            .split(/[-\s]+/)
            .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
            .join(' ');
    }
    if (parsed.incoming) {
        return parsed.type === '*'
            ? 'Backlinks'
            : `Incoming ${parsed.type.charAt(0).toUpperCase()}${parsed.type.slice(1)}`;
    }
    if (parsed.type === '*') return 'All Nodes';
    return `${parsed.type.charAt(0).toUpperCase()}${parsed.type.slice(1)}s`;
}

function buildBuilderModel(session) {
    const fieldsCache = getFieldsCache();
    const knownTypes = deriveKnownTypes(fieldsCache);
    const state = normalizeBuilderState(session.state, { fieldsCache, knownTypes });
    const options = buildBuilderOptions(state, { fieldsCache, knownTypes });
    const preview = buildPreviewFromState(state, {
        fieldsCache,
        knownTypes,
        contextNodeId: session.noteId || null
    });
    const modeLabel = session.blockInfo ? 'Replace current !view block' : 'Insert new !view block';
    return {
        state,
        options,
        preview,
        meta: {
            noteId: session.noteId || null,
            noteType: session.noteType || '',
            modeLabel,
            applyLabel: session.blockInfo ? 'Replace block' : 'Insert block'
        }
    };
}

function buildInitialViewPanelState(state = {}) {
    return {
        activeTab: 0,
        tabs: [{
            search: '',
            filter: 'all',
            columnFilters: {},
            page: 1,
            pageSize: 50,
            hiddenCols: [],
            columnOrder: [],
            columnWidths: {},
            sort: null,
            layout: state.renderLayout || 'table',
            matrixColType: state.matrixColType || '',
            scatterX: state.scatterX || '',
            scatterY: state.scatterY || '',
            barGroupBy: state.barGroupBy || ''
        }]
    };
}

async function applyBuilderQuery(session, queryText) {
    const document = session.document;
    if (!document) return false;

    if (session.blockInfo) {
        const start = new vscode.Position(session.blockInfo.start, 0);
        const endLine = Math.max(session.blockInfo.end - 1, session.blockInfo.start);
        const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(start, end), queryText);
        await vscode.workspace.applyEdit(edit);
        await document.save();
        await revealDocumentAndRunViews(document);
        vscode.window.showInformationMessage('Yamlink: Replaced !view block');
        return true;
    }

    const text = document.getText();
    const lastLine = document.lineCount - 1;
    const lastChar = document.lineAt(lastLine).text.length;
    let prefix = '';
    if (!text.endsWith('\n\n')) prefix = text.endsWith('\n') ? '\n' : '\n\n';
    const headingLabel = deriveHeadingLabelFromQuery(queryText, session.sourceType || null);
    const insertion = `${prefix}## ${headingLabel}\n\n${queryText}\n`;
    const insertionStart = new vscode.Position(lastLine, lastChar);
    const insertionEnd = positionAfterInsertedText(insertionStart, insertion);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertionStart, insertion);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    await revealDocumentAndRunViews(document, { selection: insertionEnd });
    vscode.window.showInformationMessage('Yamlink: Inserted view block');
    return true;
}

function getWebviewHtml(webview) {
    const nonce = createNonce();
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} https: data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`
    ].join('; ');
    const payload = JSON.stringify({ ready: true });
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Yamlink Query Builder</title>
  <style>
    :root {
      --yl-bg-deepest: color-mix(in srgb, var(--vscode-sideBar-background, #151617) 92%, #0F1011 8%);
      --yl-bg-base: color-mix(in srgb, var(--vscode-editor-background, #151617) 94%, #151617 6%);
      --yl-bg-elevated: color-mix(in srgb, var(--vscode-editorWidget-background, #1C1D1F) 92%, #1C1D1F 8%);
      --yl-bg-hover: color-mix(in srgb, var(--vscode-list-hoverBackground, rgba(53,56,61,.38)) 68%, #222427 32%);
      --yl-bg-active: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, rgba(53,56,61,.48)) 56%, #2B2D31 44%);
      --yl-border: color-mix(in srgb, var(--vscode-panel-border, #2a2a2a) 78%, #35383D 22%);
      --yl-border-strong: color-mix(in srgb, var(--vscode-panel-border, #2a2a2a) 62%, #35383D 38%);
      --yl-text: var(--vscode-editor-foreground, #d6ddf2);
      --yl-muted: color-mix(in srgb, var(--vscode-descriptionForeground, #8b949e) 88%, #d2dae3 12%);
      --yl-muted-strong: color-mix(in srgb, var(--vscode-descriptionForeground, #8b949e) 72%, #d2dae3 28%);
      --yl-link: #C49BF0;
      --yl-mint: #C5FFBF;
      --yl-teal: #5ECFBE;
      --yl-pink: #FF429F;
      --yl-amber: color-mix(in srgb, var(--vscode-editorLightBulb-foreground, #E7A85A) 72%, #E7A85A 28%);
      --bg: var(--yl-bg-base);
      --surface: var(--yl-bg-base);
      --surface-alt: var(--yl-bg-deepest);
      --surface-strong: var(--yl-bg-active);
      --surface-card: var(--yl-bg-elevated);
      --fg: var(--yl-text);
      --muted: var(--yl-muted-strong);
      --muted-2: var(--yl-muted);
      --border: var(--yl-border);
      --border-strong: var(--yl-border-strong);
      --input-border: var(--yl-border);
      --input-bg: color-mix(in srgb, var(--yl-bg-base) 96%, #0F1011 4%);
      --input-fg: var(--yl-text);
      --accent: var(--yl-mint);
      --accent-2: var(--yl-link);
      --accent-3: var(--yl-amber);
      --accent-soft: color-mix(in srgb, var(--yl-mint) 12%, transparent);
      --accent-2-soft: color-mix(in srgb, var(--yl-link) 12%, transparent);
      --accent-3-soft: color-mix(in srgb, var(--yl-amber) 12%, transparent);
      --shadow-soft: 0 10px 30px rgba(0,0,0,.18);
      --shadow-inset: inset 0 1px 0 rgba(255,255,255,.03);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: var(--fg);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-base) 94%, #0F1011 6%) 0%, var(--yl-bg-base) 100%);
    }
    .shell {
      display: grid;
      grid-template-columns: minmax(148px, 0.28fr) minmax(520px, 1.08fr) minmax(272px, 0.5fr);
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--yl-link) 7%, transparent), transparent 28%),
        radial-gradient(circle at top right, color-mix(in srgb, var(--yl-mint) 6%, transparent), transparent 26%),
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-base) 98%, transparent), var(--yl-bg-base));
    }
    .rail,
    .builder,
    .preview {
      min-width: 0;
    }
    .rail {
      border-right: 1px solid var(--border);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-deepest) 96%, transparent), color-mix(in srgb, var(--yl-bg-base) 98%, transparent));
      padding: 11px 9px 11px 11px;
    }
    .builder {
      padding: 11px 11px 14px;
      border-right: 1px solid var(--border);
    }
    .preview {
      padding: 11px 11px 14px 9px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .brand-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--yl-pink), color-mix(in srgb, var(--yl-pink) 72%, white 28%));
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--yl-pink) 12%, transparent);
      flex-shrink: 0;
    }
    .brand-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--yl-pink);
    }
    .brand-state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, var(--yl-mint) 16%);
      background: color-mix(in srgb, var(--surface-card) 92%, var(--yl-mint) 8%);
      color: var(--accent);
      font-size: 11px;
    }
    .rail-card,
    .section,
    .preview-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-elevated) 90%, var(--yl-link) 10%), color-mix(in srgb, var(--yl-bg-elevated) 98%, transparent));
      box-shadow: var(--shadow-inset);
    }
    .rail-card {
      padding: 9px 9px 8px;
      margin-bottom: 6px;
    }
    .rail-title {
      font-size: 10px;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--muted-2);
      margin-bottom: 8px;
    }
    .rail-stack {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .rail-pill {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 9px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 62%, transparent);
      color: var(--fg);
      font-size: 11px;
    }
    .rail-pill strong {
      font-size: 11px;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: var(--muted-2);
      font-weight: 600;
    }
    .rail-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rail-list li {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      align-items: start;
      font-size: 11px;
      color: var(--muted);
      line-height: 1.5;
    }
    .rail-list-index {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--border) 70%, var(--yl-link) 30%);
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-link) 16%);
      color: var(--accent-2);
      font-size: 9px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .rail-list strong {
      display: block;
      color: var(--fg);
      font-size: 11px;
      margin-bottom: 1px;
    }
    .progress-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .progress-item {
      display: grid;
      grid-template-columns: 20px 1fr;
      gap: 9px;
      align-items: start;
      padding: 7px 8px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 56%, transparent);
    }
    .progress-dot {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--border) 70%, var(--yl-link) 30%);
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-link) 16%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
    }
    .progress-copy strong {
      display: block;
      color: var(--fg);
      font-size: 11px;
      margin-bottom: 2px;
    }
    .progress-copy span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .builder-header {
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--yl-link) 10%, transparent), transparent 36%),
        radial-gradient(circle at top left, color-mix(in srgb, var(--yl-mint) 8%, transparent), transparent 34%),
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-elevated) 92%, var(--yl-link) 8%), color-mix(in srgb, var(--yl-bg-elevated) 98%, transparent));
      box-shadow: var(--shadow-inset);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .eyebrow {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent-3);
      margin-bottom: 3px;
    }
    h1 {
      margin: 0;
      font-size: 14px;
      line-height: 1.1;
      color: var(--accent-2);
      letter-spacing: -.02em;
    }
    .hero-copy {
      color: var(--muted);
      line-height: 1.35;
      max-width: 42ch;
      font-size: 11px;
    }
    .builder-header-copy {
      min-width: 0;
      flex: 1;
    }
    .builder-header-hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 10px;
      white-space: nowrap;
    }
    .hero-meta,
    .section-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .chip {
      padding: 5px 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-mint) 16%);
      border: 1px solid color-mix(in srgb, var(--border) 74%, var(--yl-mint) 26%);
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
    }
    .section-badge {
      padding: 3px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface-card) 72%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
      color: var(--muted-2);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    .section {
      padding: 9px;
      margin-top: 8px;
    }
    .builder-tabs {
      display: inline-flex;
      align-items: center;
      gap: 0;
      margin: 0 0 8px;
      padding: 0;
    }
    .builder-tab {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--muted);
      border-radius: 0;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .builder-tab:hover {
      color: var(--fg);
      transform: translateY(-1px);
    }
    .builder-tab.active {
      color: var(--accent-2);
    }
    .builder-tab::after {
      content: '';
      width: 28px;
      height: 1px;
      background: color-mix(in srgb, var(--border) 80%, transparent);
      margin-left: 2px;
    }
    .builder-tab:last-child::after {
      display: none;
    }
    .builder-step {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--border) 74%, var(--yl-link) 26%);
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-link) 16%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .builder-tab.active .builder-step {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-mint) 28%);
      border-color: color-mix(in srgb, var(--yl-mint) 56%, var(--border));
      color: var(--accent);
    }
    .builder-tab-preview {
      opacity: .78;
      cursor: default;
      pointer-events: none;
    }
    .builder-panel {
      display: none;
    }
    .builder-panel.active {
      display: block;
    }
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .section-kicker {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--muted-2);
      margin-bottom: 5px;
    }
    .section-title {
      margin: 0;
      font-size: 14px;
      color: var(--fg);
      letter-spacing: -.01em;
    }
    .section-copy {
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      max-width: 56ch;
    }
    .section-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 72%, var(--yl-link) 28%);
      background: color-mix(in srgb, var(--surface-card) 82%, var(--yl-link) 18%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
    }
    .mode-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .mode-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
      color: var(--muted);
      border-radius: 999px;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
    }
    .mode-btn:hover {
      background: color-mix(in srgb, var(--yl-bg-hover) 80%, transparent);
      border-color: color-mix(in srgb, var(--border-strong) 62%, var(--yl-link) 38%);
      color: var(--fg);
      transform: translateY(-1px);
    }
    .mode-btn.active {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-mint) 28%);
      border-color: color-mix(in srgb, var(--yl-mint) 56%, var(--border));
      color: var(--accent);
      box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--yl-mint) 56%, transparent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field.span-2 { grid-column: span 2; }
    .field.compact-select select {
      max-width: 240px;
    }
    label {
      font-size: 12px;
      color: var(--muted-2);
      letter-spacing: .01em;
    }
    input, select, textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--input-border);
      background: var(--input-bg);
      color: var(--input-fg);
      padding: 8px 10px;
      font: inherit;
      box-shadow: var(--shadow-inset);
      transition: border-color .14s ease, box-shadow .14s ease, background-color .14s ease;
    }
    input:hover, select:hover, textarea:hover {
      border-color: var(--border-strong);
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--yl-mint) 28%, transparent), var(--shadow-inset);
    }
    textarea {
      min-height: 72px;
      resize: vertical;
      line-height: 1.45;
    }
    .field-help {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.45;
    }
    .checkbox-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 6px;
      margin-top: 4px;
    }
    .checkbox-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 9px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface-alt) 68%, transparent);
      font-size: 12px;
      color: var(--fg);
    }
    .checkbox-chip input {
      width: auto;
      margin: 0;
    }
    .preview-shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
      position: sticky;
      top: 10px;
    }
    .preview-card {
      padding: 9px 9px 10px;
    }
    .preview-card-primary {
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--yl-link) 10%, transparent), transparent 36%),
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-elevated) 92%, var(--yl-link) 8%), color-mix(in srgb, var(--yl-bg-elevated) 98%, transparent));
    }
    .preview-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .preview-kicker {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--muted-2);
      margin-bottom: 6px;
    }
    .preview-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--fg);
      letter-spacing: -.01em;
    }
    .preview-sub {
      margin-top: 2px;
      color: var(--muted);
      line-height: 1.45;
      font-size: 11px;
    }
    .preview-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 9px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .preview-status strong {
      color: var(--accent);
      font-weight: 600;
    }
    .stat-line {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 9px;
    }
    .stat-big {
      font-size: 22px;
      color: var(--accent);
      font-weight: 600;
      letter-spacing: -.03em;
    }
    .stat-copy {
      color: var(--muted);
    }
    pre {
      margin: 0;
      padding: 10px 11px;
      border-radius: 12px;
      overflow: auto;
      background: color-mix(in srgb, var(--surface-alt) 76%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 80%, var(--yl-link) 20%);
      color: color-mix(in srgb, var(--fg) 92%, var(--yl-link) 8%);
      line-height: 1.5;
      font-size: 12px;
    }
    .layout-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 0 0 10px;
    }
    .layout-toggle {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .layout-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
      color: var(--muted);
      border-radius: 999px;
      padding: 6px 10px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .layout-btn:hover {
      background: color-mix(in srgb, var(--yl-bg-hover) 80%, transparent);
      color: var(--fg);
      transform: translateY(-1px);
    }
    .layout-btn.active {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-link) 28%);
      border-color: color-mix(in srgb, var(--yl-link) 56%, var(--border));
      color: var(--accent-2);
    }
    .layout-btn[disabled] {
      opacity: .42;
      cursor: not-allowed;
      transform: none;
    }
    .layout-btn-icon,
    .status-icon {
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: currentColor;
      flex-shrink: 0;
    }
    .layout-btn-icon svg,
    .status-icon svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .layout-config {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .layout-note {
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .compact-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .choice-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .choice-btn {
      appearance: none;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 62%, transparent);
      color: var(--muted);
      border-radius: 999px;
      padding: 7px 11px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
    }
    .choice-btn:hover {
      background: color-mix(in srgb, var(--yl-bg-hover) 76%, transparent);
      color: var(--fg);
      transform: translateY(-1px);
    }
    .choice-btn.active {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-link) 28%);
      border-color: color-mix(in srgb, var(--yl-link) 54%, var(--border));
      color: var(--accent-2);
    }
    .field-inline-help {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .subsection {
      border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--surface-alt) 48%, transparent);
      overflow: hidden;
    }
    .subsection summary {
      list-style: none;
      cursor: pointer;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--fg);
      font-size: 12px;
      font-weight: 600;
    }
    .subsection summary::-webkit-details-marker { display: none; }
    .subsection summary::after {
      content: '+';
      color: var(--muted-2);
      font-size: 14px;
      line-height: 1;
    }
    .subsection[open] summary::after { content: '−'; }
    .subsection-head {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .subsection-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .subsection-copy {
      color: var(--muted);
      font-size: 11px;
      font-weight: 400;
    }
    .subsection-state {
      color: var(--muted);
      font-size: 11px;
      font-weight: 500;
    }
    .subsection-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 76%, var(--yl-link) 24%);
      background: color-mix(in srgb, var(--surface-card) 82%, var(--yl-link) 18%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
    }
    .subsection-body {
      padding: 0 10px 10px;
    }
    .preview-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .warning-list, .sample-list {
      margin: 0;
      padding: 0;
      color: var(--muted);
      list-style: none;
    }
    .warning-list li,
    .sample-list li {
      padding: 8px 9px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 62%, transparent);
      line-height: 1.45;
      font-size: 12px;
    }
    .warning-list li {
      border-color: color-mix(in srgb, var(--border) 74%, var(--yl-amber) 26%);
      background: color-mix(in srgb, var(--surface-card) 86%, var(--yl-amber) 14%);
      color: color-mix(in srgb, var(--fg) 88%, var(--yl-amber) 12%);
    }
    .sample-row {
      display: grid;
      gap: 3px;
    }
    .sample-row-primary {
      color: var(--fg);
      font-weight: 600;
      line-height: 1.3;
    }
    .sample-row-secondary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .sample-pill {
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      background: color-mix(in srgb, var(--surface-card) 74%, transparent);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 600;
    }
    .preview-empty {
      padding: 10px 11px;
      border-radius: 12px;
      border: 1px dashed color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 54%, transparent);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .btn {
      appearance: none;
      border-radius: 999px;
      padding: 8px 12px;
      border: 1px solid color-mix(in srgb, var(--border) 74%, var(--yl-mint) 26%);
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-mint) 28%);
      color: var(--accent);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      transition: transform .14s ease, border-color .14s ease, background-color .14s ease, color .14s ease;
    }
    .btn.primary {
      padding-inline: 18px;
      min-width: 132px;
      justify-content: center;
      display: inline-flex;
      align-items: center;
    }
    .btn:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--yl-mint) 56%, var(--border));
    }
    .btn.secondary {
      background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
      border-color: var(--border);
      color: var(--fg);
    }
    .hidden { display: none !important; }
    @media (max-width: 1200px) {
      .shell { grid-template-columns: minmax(140px, 0.28fr) minmax(420px, 1fr); }
      .preview {
        grid-column: 1 / -1;
        border-top: 1px solid var(--border);
        padding-left: 18px;
      }
      .builder { border-right: none; }
      .preview-shell { position: static; }
    }
    @media (max-width: 880px) {
      .shell { grid-template-columns: 1fr; }
      .rail,
      .builder {
        border-right: none;
      }
      .rail,
      .builder,
      .preview {
        border-bottom: 1px solid var(--border);
      }
      .builder,
      .preview,
      .rail {
        padding: 14px;
      }
    }
    @media (max-width: 640px) {
      .grid { grid-template-columns: 1fr; }
      .layout-config { grid-template-columns: 1fr; }
      .field.span-2 { grid-column: span 1; }
      .brand-row { flex-direction: column; align-items: flex-start; }
      h1 { font-size: 18px; }
      .builder-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .builder-tabs {
        width: 100%;
        justify-content: flex-start;
        overflow-x: auto;
      }
      .builder-tab {
        flex: 0 0 auto;
        text-align: left;
      }
      .builder-tab::after {
        width: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="rail">
      <div class="brand-row">
        <div class="brand-mark">
          <span class="brand-dot"></span>
          <span class="brand-title">Yamlink Query Builder</span>
        </div>
        <span class="brand-state">Build</span>
      </div>

      <div class="rail-card">
        <div class="rail-title">Context</div>
        <div class="hero-meta" id="hero-meta"></div>
      </div>

      <div class="rail-card">
        <div class="rail-title">Progress</div>
        <div class="progress-list">
          <div class="progress-item">
            <span class="progress-dot">1</span>
            <div class="progress-copy"><strong>Query</strong><span>Pick the family and primary scope first.</span></div>
          </div>
          <div class="progress-item">
            <span class="progress-dot">2</span>
            <div class="progress-copy"><strong>Refine</strong><span>Keep columns visible, expand filters only when needed.</span></div>
          </div>
          <div class="progress-item">
            <span class="progress-dot">3</span>
            <div class="progress-copy"><strong>Preview</strong><span>Inspect the real syntax, then insert or open it live.</span></div>
          </div>
        </div>
      </div>
    </aside>

    <main class="builder">
      <div class="builder-header">
        <div class="builder-header-copy">
          <div class="eyebrow">Yamlink Query Builder</div>
          <h1>Build a <code>!view</code></h1>
        </div>
        <div class="builder-header-hint">Type → Columns → Filters → Insert</div>
      </div>

      <div class="builder-tabs" role="tablist" aria-label="Query builder steps">
        <button class="builder-tab active" id="builder-tab-1" data-builder-tab="1" role="tab" aria-selected="true" aria-controls="builder-panel-1"><span class="builder-step">1</span><span>View</span></button>
        <button class="builder-tab" id="builder-tab-2" data-builder-tab="2" role="tab" aria-selected="false" aria-controls="builder-panel-2"><span class="builder-step">2</span><span>Shape</span></button>
        <button class="builder-tab builder-tab-preview" type="button" aria-hidden="true"><span class="builder-step">3</span><span>Preview</span></button>
      </div>

      <div class="builder-panel active" id="builder-panel-1" role="tabpanel" aria-labelledby="builder-tab-1">
      <div class="section">
        <div class="section-head">
          <div>
            <div class="section-kicker">Step 1</div>
            <div class="section-title">View Kind</div>
            <div class="section-copy">Choose the query family first.</div>
          </div>
          <div class="section-index">01</div>
        </div>
        <div class="mode-row">
          <button class="mode-btn" data-mode="table">Table</button>
          <button class="mode-btn" data-mode="incoming">Incoming</button>
          <button class="mode-btn" data-mode="tasks">Tasks</button>
        </div>
      </div>
      </div>

      <div class="builder-panel" id="builder-panel-2" role="tabpanel" aria-labelledby="builder-tab-2">
      <div class="section">
        <div class="section-head">
          <div>
            <div class="section-kicker">Step 2</div>
            <div class="section-title">Scope, Fields, and Clauses</div>
            <div class="section-copy">Set the minimum shape first, then refine from the live view if needed.</div>
          </div>
          <div class="section-index">02</div>
        </div>
        <div class="section-meta">
          <span class="section-badge">Type-aware</span>
          <span class="section-badge">Vault-derived</span>
          <span class="section-badge">Insert-ready</span>
        </div>
        <div class="compact-stack">
          <div class="grid">
            <div class="field compact-select" id="field-type-wrap">
              <label for="field-type">Type</label>
              <select id="field-type"></select>
            </div>
            <div class="field hidden" id="field-task-wrap">
              <label for="field-task-preset">Task preset</label>
              <select id="field-task-preset"></select>
            </div>
            <div class="field" id="field-select-mode-wrap">
              <label>Columns</label>
              <div class="choice-group" id="field-select-mode">
                <button class="choice-btn" type="button" data-select-mode="smart">Recommended</button>
                <button class="choice-btn" type="button" data-select-mode="all">All fields</button>
                <button class="choice-btn" type="button" data-select-mode="custom">Custom</button>
              </div>
              <div class="field-inline-help" id="columns-help">Start with the fields Yamlink sees most often for this note type.</div>
            </div>
            <div class="field" id="field-group-wrap">
              <label for="field-group-by">Group by</label>
              <select id="field-group-by"></select>
            </div>
            <div class="field" id="field-via-wrap">
              <label for="field-via">Via relation field</label>
              <select id="field-via"></select>
            </div>
          </div>

          <details class="subsection" id="layout-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Result layout</span><span class="subsection-state" id="layout-state">Table</span></span><span class="subsection-copy">Choose how Yamlink should render this view</span></span>
              <span class="subsection-badge" id="layout-badge">table</span>
            </summary>
            <div class="subsection-body">
              <div class="layout-strip">
                <div class="layout-toggle" id="layout-toggle"></div>
              </div>
              <div class="layout-config" id="layout-config">
                <div class="field hidden" id="layout-matrix-wrap">
                  <label for="layout-matrix-col">Matrix columns</label>
                  <select id="layout-matrix-col"></select>
                </div>
                <div class="field hidden" id="layout-bar-wrap">
                  <label for="layout-bar-group">Bar group by</label>
                  <select id="layout-bar-group"></select>
                </div>
                <div class="field hidden" id="layout-scatter-x-wrap">
                  <label for="layout-scatter-x">Scatter X</label>
                  <select id="layout-scatter-x"></select>
                </div>
                <div class="field hidden" id="layout-scatter-y-wrap">
                  <label for="layout-scatter-y">Scatter Y</label>
                  <select id="layout-scatter-y"></select>
                </div>
              </div>
              <div class="layout-note" id="layout-note"></div>
            </div>
          </details>

          <details class="subsection" id="filter-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Filters</span><span class="subsection-state" id="filter-state">No filters</span></span><span class="subsection-copy">Optional scope narrowing</span></span>
              <span class="subsection-badge" id="filter-badge">0</span>
            </summary>
            <div class="subsection-body">
              <div class="grid">
                <div class="field">
                  <label for="field-where-field">Filter field</label>
                  <select id="field-where-field"></select>
                </div>
                <div class="field">
                  <label for="field-where-operator">Operator</label>
                  <select id="field-where-operator">
                    <option value="=">=</option>
                    <option value="contains">contains</option>
                  </select>
                </div>
                <div class="field span-2">
                  <label for="field-where-value">Value</label>
                  <input id="field-where-value" type="text" placeholder="active or [[johnny-rico]]" />
                  <div class="field-help">Accepts raw text or a Yamlink relation.</div>
                </div>
              </div>
            </div>
          </details>

          <details class="subsection" id="sort-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Sort & limit</span><span class="subsection-state" id="sort-state">No sort</span></span><span class="subsection-copy">Ordering and row cap</span></span>
              <span class="subsection-badge" id="sort-badge">0</span>
            </summary>
            <div class="subsection-body">
              <div class="grid">
                <div class="field">
                  <label for="field-sort-field">Sort field</label>
                  <select id="field-sort-field"></select>
                </div>
                <div class="field">
                  <label for="field-sort-direction">Direction</label>
                  <select id="field-sort-direction">
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </div>
                <div class="field">
                  <label for="field-limit">Limit</label>
                  <select id="field-limit">
                    <option value="0">No limit</option>
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
              </div>
            </div>
          </details>

          <details class="subsection hidden" id="custom-fields-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Custom fields</span><span class="subsection-state" id="custom-state">No custom fields</span></span><span class="subsection-copy">Pick exactly what to show</span></span>
              <span class="subsection-badge" id="custom-badge">0</span>
            </summary>
            <div class="subsection-body">
              <div class="field span-2 hidden" id="field-custom-select-wrap">
                <label>Selected fields</label>
                <div class="checkbox-grid" id="custom-field-list"></div>
              </div>
            </div>
          </details>

          <details class="subsection" id="advanced-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Details</span><span class="subsection-state" id="advanced-state">Optional metadata</span></span><span class="subsection-copy">Labeling and finishing touches</span></span>
              <span class="subsection-badge">+</span>
            </summary>
            <div class="subsection-body">
              <div class="grid">
                <div class="field span-2">
                  <label for="field-label">Label</label>
                  <input id="field-label" type="text" placeholder="Optional label" />
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
      </div>
    </main>

    <aside class="preview">
      <div class="preview-shell">
        <div class="preview-card preview-card-primary">
          <div class="preview-head">
            <div>
              <div class="preview-kicker">Step 3</div>
              <div class="preview-title">Preview Results</div>
              <div class="preview-sub">Inspect the exact query, sample rows, and the current result shape before you insert it.</div>
            </div>
          </div>
          <div class="stat-line">
            <div class="stat-big" id="preview-title">0 rows</div>
            <div class="stat-copy" id="preview-detail"></div>
          </div>
          <div class="preview-status" id="preview-status"></div>
          <pre id="query-preview"></pre>
          <div class="actions">
            <button class="btn primary" id="apply-btn">Insert block</button>
            <button class="btn secondary" id="open-preview-btn">Open preview</button>
            <button class="btn secondary" id="copy-btn">Copy query</button>
          </div>
        </div>

        <div class="preview-card">
          <div class="rail-title">Warnings</div>
          <ul class="warning-list" id="warning-list"></ul>
        </div>

        <div class="preview-card">
          <div class="rail-title">Sample Rows</div>
          <ul class="sample-list" id="sample-list"></ul>
        </div>
      </div>
    </aside>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const els = {
      heroMeta: document.getElementById('hero-meta'),
      builderTabs: Array.from(document.querySelectorAll('[data-builder-tab]')),
      builderPanels: Array.from(document.querySelectorAll('.builder-panel')),
      modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
      type: document.getElementById('field-type'),
      taskPreset: document.getElementById('field-task-preset'),
      label: document.getElementById('field-label'),
      selectMode: document.getElementById('field-select-mode'),
      selectModeButtons: Array.from(document.querySelectorAll('[data-select-mode]')),
      columnsHelp: document.getElementById('columns-help'),
      groupBy: document.getElementById('field-group-by'),
      via: document.getElementById('field-via'),
      whereField: document.getElementById('field-where-field'),
      whereOperator: document.getElementById('field-where-operator'),
      whereValue: document.getElementById('field-where-value'),
      sortField: document.getElementById('field-sort-field'),
      sortDirection: document.getElementById('field-sort-direction'),
      limit: document.getElementById('field-limit'),
      filterSection: document.getElementById('filter-section'),
      sortSection: document.getElementById('sort-section'),
      customSection: document.getElementById('custom-fields-section'),
      layoutSection: document.getElementById('layout-section'),
      advancedSection: document.getElementById('advanced-section'),
      filterBadge: document.getElementById('filter-badge'),
      sortBadge: document.getElementById('sort-badge'),
      customBadge: document.getElementById('custom-badge'),
      layoutBadge: document.getElementById('layout-badge'),
      layoutState: document.getElementById('layout-state'),
      filterState: document.getElementById('filter-state'),
      sortState: document.getElementById('sort-state'),
      customState: document.getElementById('custom-state'),
      advancedState: document.getElementById('advanced-state'),
      customWrap: document.getElementById('field-custom-select-wrap'),
      customFieldList: document.getElementById('custom-field-list'),
      typeWrap: document.getElementById('field-type-wrap'),
      taskWrap: document.getElementById('field-task-wrap'),
      selectModeWrap: document.getElementById('field-select-mode-wrap'),
      groupWrap: document.getElementById('field-group-wrap'),
      viaWrap: document.getElementById('field-via-wrap'),
      previewTitle: document.getElementById('preview-title'),
      previewDetail: document.getElementById('preview-detail'),
      previewStatus: document.getElementById('preview-status'),
      queryPreview: document.getElementById('query-preview'),
      warningList: document.getElementById('warning-list'),
      sampleList: document.getElementById('sample-list'),
      applyBtn: document.getElementById('apply-btn'),
      copyBtn: document.getElementById('copy-btn'),
      openPreviewBtn: document.getElementById('open-preview-btn'),
      layoutToggle: document.getElementById('layout-toggle'),
      layoutNote: document.getElementById('layout-note'),
      layoutMatrixWrap: document.getElementById('layout-matrix-wrap'),
      layoutMatrixCol: document.getElementById('layout-matrix-col'),
      layoutBarWrap: document.getElementById('layout-bar-wrap'),
      layoutBarGroup: document.getElementById('layout-bar-group'),
      layoutScatterXWrap: document.getElementById('layout-scatter-x-wrap'),
      layoutScatterX: document.getElementById('layout-scatter-x'),
      layoutScatterYWrap: document.getElementById('layout-scatter-y-wrap'),
      layoutScatterY: document.getElementById('layout-scatter-y')
    };
    let model = null;
    let suppress = false;

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function optionsHtml(values, current, allowBlankLabel = null) {
      const parts = [];
      if (allowBlankLabel !== null) parts.push('<option value="">' + escapeHtml(allowBlankLabel) + '</option>');
      for (const value of values) {
        const selected = String(value) === String(current) ? ' selected' : '';
        parts.push('<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(value) + '</option>');
      }
      return parts.join('');
    }

    function iconGlyph(name) {
      const icons = {
        table: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.8"/><path d="M2.5 7.5h11"/><path d="M6 3v10"/><path d="M10 3v10"/></svg>',
        matrix: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.8"/><path d="M2.5 6.5h11"/><path d="M2.5 10h11"/><path d="M6 3v10"/><path d="M10 3v10"/></svg>',
        bar: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13V8"/><path d="M8 13V5"/><path d="M13 13V3"/><path d="M2.5 13.5h11"/></svg>',
        scatter: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11"/><path d="M2.5 13.5v-11"/><circle cx="5" cy="9.5" r="1"/><circle cx="8.25" cy="6.25" r="1"/><circle cx="11.5" cy="4.5" r="1"/></svg>',
        ready: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
        note: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25"/><path d="M8 5.5v3.25"/><circle cx="8" cy="11.3" r=".55" fill="currentColor" stroke="none"/></svg>'
      };
      return icons[name] || icons.table;
    }

    function iconHtml(name, className = 'layout-btn-icon') {
      return '<span class="' + className + '">' + iconGlyph(name) + '</span>';
    }

    function readState() {
      const selectedFields = Array.from(els.customFieldList.querySelectorAll('input[type="checkbox"]:checked'))
        .map((input) => input.value);
      const activeMode = els.modeButtons.find((btn) => btn.classList.contains('active'))?.dataset.mode || 'table';
      const selectMode = els.selectModeButtons.find((btn) => btn.classList.contains('active'))?.dataset.selectMode || 'smart';
      return {
        mode: activeMode,
        type: els.type.value,
        taskPreset: els.taskPreset.value,
        label: els.label.value,
        selectMode,
        selectFields: selectedFields,
        groupBy: els.groupBy.value,
        viaField: els.via.value,
        whereField: els.whereField.value,
        whereOperator: els.whereOperator.value,
        whereValue: els.whereValue.value,
        sortField: els.sortField.value,
        sortDirection: els.sortDirection.value,
        limit: Number(els.limit.value || 0),
        renderLayout: els.layoutToggle.querySelector('.layout-btn.active')?.dataset.layout || 'table',
        matrixColType: els.layoutMatrixCol.value,
        scatterX: els.layoutScatterX.value,
        scatterY: els.layoutScatterY.value,
        barGroupBy: els.layoutBarGroup.value
      };
    }

    function postState() {
      if (suppress) return;
      vscode.postMessage({ type: 'stateChanged', state: readState() });
    }

    function renderChips(meta) {
      const chips = [];
      if (meta.modeLabel) chips.push('<span class="chip">' + escapeHtml(meta.modeLabel) + '</span>');
      if (meta.noteId) chips.push('<span class="chip">Context: ' + escapeHtml(meta.noteId) + '</span>');
      if (meta.noteType) chips.push('<span class="chip">Type: ' + escapeHtml(meta.noteType) + '</span>');
      els.heroMeta.innerHTML = chips.join('');
      els.applyBtn.textContent = meta.applyLabel || 'Apply';
    }

    function setBuilderTab(tabId) {
      const target = String(tabId || '1');
      els.builderTabs.forEach((btn) => {
        const active = btn.dataset.builderTab === target;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      els.builderPanels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'builder-panel-' + target);
      });
    }

    function renderModel(nextModel) {
      model = nextModel;
      const { state, options, preview, meta } = nextModel;
      suppress = true;

      renderChips(meta);

      els.modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === state.mode));
      els.type.innerHTML = optionsHtml(options.knownTypes.length ? options.knownTypes : ['*'], state.type);
      els.taskPreset.innerHTML = optionsHtml(['tasks','open-tasks','done-tasks','overdue','undated-tasks','calendar','today','upcoming'], state.taskPreset);
      els.label.value = state.label || '';
      els.selectModeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.selectMode === (state.selectMode || 'smart')));
      els.groupBy.innerHTML = optionsHtml(options.groupableFields || [], state.groupBy, 'No grouping');
      els.via.innerHTML = optionsHtml(options.relationFieldCandidates || [], state.viaField || '*', 'Any relation field');
      els.whereField.innerHTML = optionsHtml(options.fieldCandidates || [], state.whereField, 'No filter');
      els.whereOperator.value = state.whereOperator || '=';
      els.whereValue.value = state.whereValue || '';
      els.sortField.innerHTML = optionsHtml(options.fieldCandidates || [], state.sortField, 'No sort');
      els.sortDirection.value = state.sortDirection || 'asc';
      els.limit.value = String(state.limit || 0);

      const hasFilter = !!(state.whereField && state.whereValue);
      const hasSort = !!(state.sortField || Number(state.limit || 0) > 0);
      const customCount = Array.isArray(state.selectFields) ? state.selectFields.length : 0;
      const activeLayout = state.renderLayout || 'table';
      els.customWrap.classList.toggle('hidden', state.selectMode !== 'custom' || state.mode !== 'table');
      els.customSection.classList.toggle('hidden', state.selectMode !== 'custom' || state.mode !== 'table');
      els.typeWrap.classList.toggle('hidden', state.mode === 'tasks');
      els.taskWrap.classList.toggle('hidden', state.mode !== 'tasks');
      els.selectModeWrap.classList.toggle('hidden', state.mode !== 'table');
      els.groupWrap.classList.toggle('hidden', state.mode !== 'table');
      els.viaWrap.classList.toggle('hidden', state.mode !== 'incoming');
      els.layoutSection.classList.toggle('hidden', state.mode !== 'table');
      els.filterSection.open = hasFilter;
      els.sortSection.open = hasSort;
      if (state.selectMode === 'custom' && state.mode === 'table') {
        els.customSection.open = customCount > 0;
      }
      els.layoutSection.open = state.mode === 'table' && activeLayout !== 'table';
      els.filterBadge.textContent = hasFilter ? '1' : '0';
      els.sortBadge.textContent = String((state.sortField ? 1 : 0) + (Number(state.limit || 0) > 0 ? 1 : 0));
      els.customBadge.textContent = String(customCount);
      els.layoutBadge.textContent = activeLayout;
      els.columnsHelp.textContent = state.selectMode === 'custom'
        ? 'Choose the exact fields Yamlink should surface in the result.'
        : state.selectMode === 'all'
          ? 'Show every observed field for this result set.'
          : 'Start with the fields Yamlink sees most often for this note type.';
      els.filterState.textContent = hasFilter ? (state.whereField + ' ' + (state.whereOperator || '=') + ' ' + state.whereValue) : 'No filters';
      els.sortState.textContent = hasSort
        ? [state.sortField ? ('Sort ' + state.sortField + ' ' + (state.sortDirection || 'asc')) : null, Number(state.limit || 0) > 0 ? ('Limit ' + state.limit) : null].filter(Boolean).join(' · ')
        : 'No sort';
      els.customState.textContent = customCount > 0 ? (customCount + ' fields selected') : 'No custom fields';
      els.advancedState.textContent = state.label ? 'Label set' : 'Optional metadata';

      els.customFieldList.innerHTML = (options.fieldCandidates || []).map((field) => {
        const checked = (state.selectFields || []).includes(field) ? ' checked' : '';
        return '<label class="checkbox-chip"><input type="checkbox" value="' + escapeHtml(field) + '"' + checked + ' /> <span>' + escapeHtml(field) + '</span></label>';
      }).join('');

      els.previewTitle.textContent = preview.summary?.title || 'Preview';
      els.previewDetail.textContent = preview.summary?.detail || '';
      els.queryPreview.textContent = preview.queryText || '';
      const layoutSummary = preview.summary?.layouts || { available: [] };
      els.layoutToggle.innerHTML = (layoutSummary.available || []).map((layout) => {
        const active = activeLayout === layout.key ? ' active' : '';
        const disabled = layout.enabled ? '' : ' disabled';
        const title = layout.detail ? ' title="' + escapeHtml(layout.detail) + '"' : '';
        return '<button class="layout-btn' + active + '" data-layout="' + escapeHtml(layout.key) + '"' + disabled + title + '>' + iconHtml(layout.key) + '<span>' + escapeHtml(layout.label) + '</span></button>';
      }).join('');
      const activeLayoutMeta = (layoutSummary.available || []).find((layout) => layout.key === activeLayout) || null;
      els.layoutState.textContent = activeLayoutMeta?.label || 'Table';
      els.layoutNote.textContent = activeLayoutMeta?.detail || 'Choose how to render this query when you open it in Yamlink View.';
      els.layoutMatrixCol.innerHTML = optionsHtml(layoutSummary.matrixColumnTypes || [], state.matrixColType, 'Pick a type…');
      els.layoutBarGroup.innerHTML = optionsHtml(layoutSummary.barFields || [], state.barGroupBy, 'Pick a field…');
      els.layoutScatterX.innerHTML = optionsHtml(layoutSummary.scatterFields || [], state.scatterX, 'Pick a field…');
      els.layoutScatterY.innerHTML = optionsHtml(layoutSummary.scatterFields || [], state.scatterY, 'Pick a field…');
      els.layoutMatrixWrap.classList.toggle('hidden', activeLayout !== 'matrix');
      els.layoutBarWrap.classList.toggle('hidden', activeLayout !== 'bar');
      els.layoutScatterXWrap.classList.toggle('hidden', activeLayout !== 'scatter');
      els.layoutScatterYWrap.classList.toggle('hidden', activeLayout !== 'scatter');
      const warnings = Array.isArray(preview.summary?.warnings) ? preview.summary.warnings : [];
      els.warningList.innerHTML = warnings.length
        ? warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join('')
        : '<li class="preview-empty">No query warnings right now. This query shape looks structurally clean.</li>';
      els.previewStatus.innerHTML = warnings.length
        ? iconHtml('note', 'status-icon') + '<strong>Review recommended</strong><span>' + escapeHtml(warnings[0]) + '</span>'
        : iconHtml('ready', 'status-icon') + '<strong>Ready to insert</strong><span>Query shape looks valid for this result.</span>';
      const sampleRows = Array.isArray(preview.summary?.sampleRows) ? preview.summary.sampleRows : [];
      const preferredFields = state.selectMode === 'custom'
        ? (state.selectFields || [])
        : state.selectMode === 'all'
          ? (options.fieldCandidates || [])
          : Array.isArray(preview.summary?.visibleFields) ? preview.summary.visibleFields : [];
      els.sampleList.innerHTML = sampleRows.length
        ? sampleRows.map((row) => {
            const fieldKeys = preferredFields.length ? preferredFields : Object.keys(row.fields || {});
            const values = fieldKeys
              .filter((key) => key in (row.fields || {}))
              .slice(0, 4)
              .map((key) => ({ key, value: row.fields[key] }));
            const primary = values[0]?.value || row.id;
            const extras = values.slice(1);
            const typePill = row.type ? '<span class="sample-pill">' + escapeHtml(row.type) + '</span>' : '';
            const secondary = extras.map((entry) => '<span>' + escapeHtml(entry.value) + '</span>').join('');
            return '<li><div class="sample-row"><div class="sample-row-primary">' + escapeHtml(primary) + '</div><div class="sample-row-secondary">' + typePill + secondary + '</div></div></li>';
          }).join('')
        : '<li class="preview-empty">No sample rows yet. Change the scope or filters to pull live notes into the preview.</li>';

      suppress = false;
    }

    els.modeButtons.forEach((btn) => btn.addEventListener('click', () => {
      els.modeButtons.forEach((other) => other.classList.toggle('active', other === btn));
      setBuilderTab('2');
      postState();
    }));
    els.builderTabs.forEach((btn) => btn.addEventListener('click', () => {
      setBuilderTab(btn.dataset.builderTab);
    }));
    els.selectModeButtons.forEach((btn) => btn.addEventListener('click', () => {
      els.selectModeButtons.forEach((other) => other.classList.toggle('active', other === btn));
      postState();
    }));
    els.layoutToggle.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-layout]');
      if (!btn || btn.disabled) return;
      els.layoutToggle.querySelectorAll('[data-layout]').forEach((entry) => entry.classList.toggle('active', entry === btn));
      postState();
    });
    [els.type, els.taskPreset, els.label, els.groupBy, els.via, els.whereField, els.whereOperator, els.whereValue, els.sortField, els.sortDirection, els.limit]
      .forEach((el) => {
        el.addEventListener('change', postState);
        el.addEventListener('input', postState);
      });
    [els.layoutMatrixCol, els.layoutBarGroup, els.layoutScatterX, els.layoutScatterY].forEach((el) => {
      el.addEventListener('change', postState);
      el.addEventListener('input', postState);
    });
    els.customFieldList.addEventListener('change', postState);
    els.applyBtn.addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
    els.openPreviewBtn.addEventListener('click', () => vscode.postMessage({ type: 'openPreview' }));
    els.copyBtn.addEventListener('click', async () => {
      const query = model?.preview?.queryText || '';
      try {
        await navigator.clipboard.writeText(query);
        vscode.postMessage({ type: 'copied' });
      } catch {
        vscode.postMessage({ type: 'copyFallback', query });
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'render') renderModel(msg.model);
    });

    vscode.postMessage(${payload});
  </script>
</body>
</html>`;
}

async function openQueryBuilderPanel(context, options = {}) {
    const document = options.document || vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'markdown') {
        vscode.window.showInformationMessage('Yamlink: Open a Markdown note to use the Query Builder.');
        return;
    }

    const fieldsCache = getFieldsCache();
    const pathIndex = getPathIndex();
    const noteId = pathIndex.get(document.uri.fsPath) || null;
    const noteFields = noteId ? (fieldsCache.get(noteId) || {}) : {};
    const noteType = String(noteFields.type || '').trim().toLowerCase() || '';
    const activeEditor = vscode.window.activeTextEditor;
    const selection = options.range || activeEditor?.selection || new vscode.Range(0, 0, 0, 0);
    const blockInfo = options.blockInfo || getViewBlockAtRange(document, selection);
    const knownTypes = deriveKnownTypes(fieldsCache);
    const sourceQuery = blockInfo?.query || null;
    const defaultType = String(options.sourceType || noteType || knownTypes[0] || '*').trim().toLowerCase();
    let state = buildStateFromQuery(sourceQuery, { fieldsCache, knownTypes, defaultType });
    if (!sourceQuery && options.sourceType) {
        state.type = String(options.sourceType || '').trim().toLowerCase() || state.type;
    }

    builderSession = {
        document,
        blockInfo: sourceQuery ? blockInfo : null,
        noteId,
        noteType,
        sourceType: options.sourceType || null,
        state
    };

    appendMutationEvents([{
        type: 'query_builder_opened',
        noteId: getBuilderEventNoteId(builderSession),
        field: 'query',
        oldValue: null,
        newValue: sourceQuery ? 'refine' : 'new',
        source: 'vscode',
        cause: 'query_builder_open',
        meta: {
            noteType: noteType || null,
            mode: sourceQuery ? 'refine' : 'new'
        }
    }]);

    if (!builderPanel) {
        builderPanel = vscode.window.createWebviewPanel(
            'yamlinkQueryBuilder',
            'Yamlink Query Builder',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        builderPanel.onDidDispose(() => {
            builderPanel = null;
            builderSession = null;
        });
        builderPanel.webview.html = getWebviewHtml(builderPanel.webview);
        builderPanel.webview.onDidReceiveMessage(async (message) => {
            if (!builderSession) return;
            if (message?.type === 'ready' || message?.ready) {
                builderPanel?.webview.postMessage({ type: 'render', model: buildBuilderModel(builderSession) });
                return;
            }
            if (message?.type === 'stateChanged') {
                builderSession.state = normalizeBuilderState(message.state || {}, { fieldsCache: getFieldsCache(), knownTypes: deriveKnownTypes(getFieldsCache()) });
                builderPanel?.webview.postMessage({ type: 'render', model: buildBuilderModel(builderSession) });
                return;
            }
            if (message?.type === 'apply') {
                const model = buildBuilderModel(builderSession);
                await applyBuilderQuery(builderSession, model.preview.queryText);
                appendMutationEvents([{
                    type: 'query_builder_applied',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: model.preview.queryText,
                    source: 'vscode',
                    cause: 'query_builder_apply',
                    meta: {
                        mode: builderSession.blockInfo ? 'replace' : 'insert',
                        layout: builderSession.state?.renderLayout || 'table'
                    }
                }]);
                return;
            }
            if (message?.type === 'openPreview') {
                const model = buildBuilderModel(builderSession);
                const { openViewPanel } = require('../features/viewPanel');
                const previewText = builderSession.noteId
                    ? `---\nid: ${builderSession.noteId}\n${builderSession.noteType ? `type: ${builderSession.noteType}\n` : ''}---\n\n## Query Builder Preview\n\n${model.preview.queryText}\n`
                    : `## Query Builder Preview\n\n${model.preview.queryText}\n`;
                openViewPanel(
                    context,
                    previewText,
                    null,
                    null,
                    0,
                    buildInitialViewPanelState(builderSession.state)
                );
                appendMutationEvents([{
                    type: 'query_builder_preview_opened',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: model.preview.queryText,
                    source: 'vscode',
                    cause: 'query_builder_open_preview',
                    meta: {
                        layout: builderSession.state?.renderLayout || 'table'
                    }
                }]);
                return;
            }
            if (message?.type === 'copied') {
                appendMutationEvents([{
                    type: 'query_builder_copied',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: buildBuilderModel(builderSession).preview.queryText,
                    source: 'vscode',
                    cause: 'query_builder_copy'
                }]);
                vscode.window.setStatusBarMessage('Yamlink: Copied query to clipboard', 2500);
                return;
            }
            if (message?.type === 'copyFallback') {
                await vscode.env.clipboard.writeText(String(message.query || ''));
                appendMutationEvents([{
                    type: 'query_builder_copied',
                    noteId: getBuilderEventNoteId(builderSession),
                    field: 'query',
                    oldValue: null,
                    newValue: String(message.query || ''),
                    source: 'vscode',
                    cause: 'query_builder_copy'
                }]);
                vscode.window.setStatusBarMessage('Yamlink: Copied query to clipboard', 2500);
            }
        });
    } else {
        builderPanel.reveal(vscode.ViewColumn.Beside);
    }

    builderPanel.title = sourceQuery ? 'Yamlink Query Builder — Refine View' : 'Yamlink Query Builder';
    builderPanel.webview.postMessage({ type: 'render', model: buildBuilderModel(builderSession) });
}

module.exports = {
    openQueryBuilderPanel
};
