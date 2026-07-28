'use strict';

const { parseLinkedTargetParts, resolveLinkedTarget } = require('../core/id');

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Renders a definition string's `[[wikilink]]` occurrences as real, clickable
 * links instead of literal bracket text — a definition pulled straight from a
 * note's own body/field is still real Yamlink markup, and should render the
 * same way the note itself does. A target that doesn't resolve renders as
 * plain escaped text in the error color rather than a dead-looking link —
 * honest about what's actually clickable, never a link that goes nowhere.
 * @param {string} text
 * @param {Map<string,string>} idIndex
 * @param {Map<string,string>} [aliasIndex]
 * @returns {string} HTML
 */
function linkifyDefinition(text, idIndex, aliasIndex) {
    const raw = String(text || '');
    let html = '';
    let lastIndex = 0;
    let match;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(raw)) !== null) {
        html += escapeHtml(raw.slice(lastIndex, match.index));
        const parts = parseLinkedTargetParts(match[1]);
        const resolvedId = idIndex ? resolveLinkedTarget(parts.target, idIndex, aliasIndex) : null;
        const displayText = parts.label || parts.target;
        if (resolvedId) {
            html += `<span class="chip" data-action="openNode" data-node-id="${escapeHtml(resolvedId)}">${escapeHtml(displayText)}</span>`;
        } else {
            html += `<span class="broken-link">${escapeHtml(displayText)}</span>`;
        }
        lastIndex = WIKILINK_RE.lastIndex;
    }
    html += escapeHtml(raw.slice(lastIndex));
    return html;
}

function buildBaseStyles() {
    return `
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #151617; color: #e6e8eb; padding: 24px 32px 60px; }
        .topbar { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
        h1 { font-size: 1.4rem; margin: 0; }
        .settings-btn { background: none; border: 1px solid #2b2d31; color: #9ea3aa; border-radius: 6px; padding: 5px 12px; font-size: 0.8rem; cursor: pointer; }
        .settings-btn:hover { color: #e6e8eb; border-color: #5ecfbe; }
        .sub { color: #9ea3aa; font-size: 0.88rem; margin: 0 0 14px; }
        .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin: 0 0 18px; padding: 10px 14px; border: 1px solid #2b2d31; border-radius: 8px; background: #1a1b1d; }
        .toolbar-group { display: flex; align-items: center; gap: 16px; }
        .toolbar-divider { width: 1px; align-self: stretch; background: #2b2d31; margin: 0 2px; }
        .toolbar-spacer { flex: 1; }
        .toolbar-check { display: flex; align-items: center; gap: 7px; font-size: 0.82rem; color: #c7cad0; cursor: pointer; white-space: nowrap; user-select: none; }
        .toolbar-check input[type="checkbox"] {
            appearance: none; -webkit-appearance: none;
            width: 15px; height: 15px; flex: none;
            border: 1px solid #3a3d42; border-radius: 4px;
            background: #101112; cursor: pointer; position: relative;
            transition: background 0.12s ease, border-color 0.12s ease;
        }
        .toolbar-check input[type="checkbox"]:hover { border-color: #5ecfbe; }
        .toolbar-check input[type="checkbox"]:checked { background: #5ecfbe; border-color: #5ecfbe; }
        .toolbar-check input[type="checkbox"]:checked::after {
            content: ''; position: absolute; left: 4px; top: 1px;
            width: 4px; height: 8px;
            border: solid #0f1011; border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        .toolbar-check input[type="checkbox"]:focus-visible { outline: 2px solid #5ecfbe; outline-offset: 2px; }
        .toolbar-sort { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: #9ea3aa; }
        .select-wrap { position: relative; display: inline-flex; align-items: center; }
        .select-wrap::after {
            content: ''; position: absolute; right: 10px; pointer-events: none;
            width: 6px; height: 6px;
            border-right: 1.5px solid #9ea3aa; border-bottom: 1.5px solid #9ea3aa;
            transform: rotate(45deg) translateY(-3px);
        }
        .toolbar-select {
            appearance: none; -webkit-appearance: none;
            background: #101112; border: 1px solid #2b2d31; border-radius: 6px;
            color: #e6e8eb; padding: 5px 26px 5px 10px; font-size: 0.82rem; cursor: pointer;
        }
        .toolbar-select:hover { border-color: #5ecfbe; }
        .toolbar-select:focus-visible { outline: 2px solid #5ecfbe; outline-offset: 1px; }
        .toolbar-btn {
            display: inline-flex; align-items: center; gap: 6px;
            background: none; border: 1px solid #2b2d31; color: #9ea3aa;
            border-radius: 6px; padding: 5px 12px; font-size: 0.8rem; cursor: pointer;
        }
        .toolbar-btn:hover { color: #e6e8eb; border-color: #5ecfbe; }
        .toolbar-btn.is-confirmed { color: #c5ffbf; border-color: #c5ffbf; }
        .toolbar-btn svg { flex: none; }
        .search-box { width: 100%; max-width: 420px; box-sizing: border-box; background: #1c1d1f; border: 1px solid #2b2d31; border-radius: 8px; color: #e6e8eb; padding: 8px 12px; font-size: 0.88rem; margin: 0 0 24px; }
        .search-box:focus { outline: none; border-color: #5ecfbe; }
        .search-box::placeholder { color: #666b72; }
        .type-group { margin-bottom: 8px; }
        .type-title { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; color: #e7a85a; font-weight: 600; margin: 28px 0 10px; user-select: none; }
        .type-title.is-collapsible { cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .type-title.is-collapsible::before { content: '▾'; font-size: 0.7rem; }
        .type-group.is-collapsed .type-title.is-collapsible::before { content: '▸'; }
        .type-section.is-collapsed { display: none; }
        .letter { font-size: 0.82rem; font-weight: 700; color: #9ea3aa; margin: 18px 0 6px; border-bottom: 1px solid #2b2d31; padding-bottom: 4px; }
        .entry { margin: 0 0 14px; }
        .entry.is-hidden { display: none; }
        .entry.is-focused { outline: 1px solid #5ecfbe; border-radius: 6px; background: #1c1d1f; }
        .term { font-weight: 600; font-size: 0.98rem; margin: 0 0 3px; cursor: pointer; color: #e6e8eb; }
        .term:hover { color: #c5ffbf; }
        .def { font-size: 0.88rem; color: #c7cad0; line-height: 1.5; margin: 0 0 5px; max-width: 62ch; }
        .def .chip { color: #c5ffbf; cursor: pointer; }
        .def .chip:hover { text-decoration: underline; }
        .def .broken-link { color: #ff4a6a; }
        .refs { font-size: 0.78rem; color: #9ea3aa; }
        .refs .chip { color: #c49bf0; cursor: pointer; }
        .refs .chip:hover { text-decoration: underline; }
        .unreferenced { color: #666b72; font-style: italic; }
        .extra { font-size: 0.78rem; color: #666b72; margin-top: 2px; }
        .empty { color: #9ea3aa; padding: 40px 0; max-width: 60ch; line-height: 1.6; }
        .no-results { display: none; color: #666b72; padding: 24px 0; font-style: italic; }
        .no-results.is-visible { display: block; }
        button.link { background: none; border: none; color: #5ecfbe; cursor: pointer; font-size: inherit; padding: 0; text-decoration: underline; }
    `;
}

function buildSettingsButtonHtml() {
    return `<button class="settings-btn" data-action="openSettings">Settings</button>`;
}

/** @param {{ nonce: string }} webview */
function buildEmptyStateHtml({ nonce } = { nonce: '' }) {
    return `<!DOCTYPE html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <style>${buildBaseStyles()}</style></head><body>
        <div class="topbar"><h1>Vault Glossary</h1></div>
        <div class="empty">
            No note types are configured as glossary terms yet. The glossary only shows note types you choose —
            Yamlink can't guess which of your types are conceptual (worth defining) versus entity records
            (contacts, accounts) that already have their own report.
            <br/><br/>
            <button class="link" data-action="openSettings">Set yamlink.glossaryTypes in Settings</button>
        </div>
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            document.addEventListener('click', (event) => {
                const el = event.target.closest('[data-action="openSettings"]');
                if (el) vscode.postMessage({ command: 'openSettings' });
            });
        </script>
    </body></html>`;
}

/**
 * @param {import('../intelligence/glossary').GlossaryTypeGroup[]} groups
 * @param {string[]} types
 * @param {{
 *   nonce: string,
 *   idIndex?: Map<string,string>,
 *   aliasIndex?: Map<string,string>,
 *   groupByType?: boolean,
 *   showZeroBacklinkTerms?: boolean,
 *   sortBy?: 'alphabetical'|'mostReferenced'
 * }} webview
 * @returns {string}
 */
function buildGlossaryHtml(groups, types, webview = { nonce: '' }) {
    const {
        nonce,
        idIndex,
        aliasIndex,
        groupByType = true,
        showZeroBacklinkTerms = true,
        sortBy = 'alphabetical'
    } = webview;
    const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">`;
    const totalEntries = groups.reduce((sum, g) => sum + g.letters.reduce((s, l) => s + l.entries.length, 0), 0);

    const toolbarScript = `
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
            const openNode = event.target.closest('[data-action="openNode"]');
            if (openNode) { vscode.postMessage({ command: 'openNode', id: openNode.dataset.nodeId }); return; }
            const settings = event.target.closest('[data-action="openSettings"]');
            if (settings) { vscode.postMessage({ command: 'openSettings' }); return; }
            const toggleSection = event.target.closest('[data-action="toggleSection"]');
            if (toggleSection) {
                const group = toggleSection.closest('.type-group');
                const section = document.getElementById(toggleSection.dataset.target);
                if (group) group.classList.toggle('is-collapsed');
                if (section) section.classList.toggle('is-collapsed');
                return;
            }
            const copyBtn = event.target.closest('[data-action="copyMarkdown"]');
            if (copyBtn) {
                const text = buildVisibleMarkdown();
                vscode.postMessage({ command: 'copyMarkdown', text });
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('is-confirmed');
                setTimeout(() => { copyBtn.textContent = 'Copy as Markdown'; copyBtn.classList.remove('is-confirmed'); }, 1500);
                return;
            }
        });

        document.addEventListener('change', (event) => {
            if (event.target.id === 'toggle-group-by-type') {
                vscode.postMessage({ command: 'updateSetting', key: 'glossaryGroupByType', value: event.target.checked });
            }
            if (event.target.id === 'toggle-hide-unreferenced') {
                vscode.postMessage({ command: 'updateSetting', key: 'glossaryShowZeroBacklinkTerms', value: !event.target.checked });
            }
            if (event.target.id === 'sort-by-select') {
                vscode.postMessage({ command: 'updateSetting', key: 'glossarySortBy', value: event.target.value });
            }
        });

        function buildVisibleMarkdown() {
            const lines = [];
            document.querySelectorAll('.type-group').forEach((group) => {
                const titleEl = group.querySelector('.type-title');
                const visible = Array.from(group.querySelectorAll('.entry')).filter((e) => !e.classList.contains('is-hidden'));
                if (!visible.length) return;
                if (titleEl) { lines.push('## ' + titleEl.textContent.trim().replace(/^[▾▸]\\s*/, '')); lines.push(''); }
                visible.forEach((entry) => {
                    const termEl = entry.querySelector('.term');
                    const defEl = entry.querySelector('.def');
                    const refsEl = entry.querySelector('.refs');
                    lines.push('**' + (termEl ? termEl.textContent.trim() : '') + '**');
                    if (defEl && defEl.textContent.trim()) lines.push(defEl.textContent.trim());
                    if (refsEl && refsEl.textContent.trim()) lines.push('_' + refsEl.textContent.trim() + '_');
                    lines.push('');
                });
            });
            return lines.join('\\n');
        }
    `;

    if (!totalEntries) {
        return `<!DOCTYPE html><html><head>${cspTag}<style>${buildBaseStyles()}</style></head><body>
            <div class="topbar"><h1>Vault Glossary</h1>${buildSettingsButtonHtml()}</div>
            <div class="empty">No notes found for type(s): ${escapeHtml(types.join(', '))}.</div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                document.addEventListener('click', (event) => {
                    const el = event.target.closest('[data-action="openSettings"]');
                    if (el) vscode.postMessage({ command: 'openSettings' });
                });
            </script>
        </body></html>`;
    }

    const body = groups.map((group, groupIndex) => {
        const sectionId = `type-section-${groupIndex}`;
        const isCollapsible = Boolean(group.type);
        const heading = group.type
            ? `<div class="type-title is-collapsible" data-action="toggleSection" data-target="${sectionId}">${escapeHtml(group.type)}</div>`
            : '';
        const letters = group.letters.map((letterGroup) => {
            const entries = letterGroup.entries.map((entry) => {
                const searchText = escapeHtml(`${entry.term} ${entry.definition}`.toLowerCase());
                const def = entry.definition
                    ? `<div class="def">${linkifyDefinition(entry.definition, idIndex, aliasIndex)}</div>`
                    : '';
                const refs = entry.backlinkIds.length
                    ? `<div class="refs">Referenced in: ${entry.backlinkIds.map((id) =>
                        `<span class="chip" data-action="openNode" data-node-id="${escapeHtml(id)}">${escapeHtml(id)}</span>`
                    ).join(', ')}</div>`
                    : `<div class="refs unreferenced">(not yet referenced)</div>`;
                const extra = Object.entries(entry.extra || {})
                    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
                    .join(' · ');
                const extraHtml = extra ? `<div class="extra">${extra}</div>` : '';
                return `<div class="entry" data-search="${searchText}">
                    <div class="term" data-action="openNode" data-node-id="${escapeHtml(entry.id)}">${escapeHtml(entry.term)}</div>
                    ${def}
                    ${extraHtml}
                    ${refs}
                </div>`;
            }).join('');
            const letterHeading = letterGroup.letter ? `<div class="letter">${escapeHtml(letterGroup.letter)}</div>` : '';
            return `${letterHeading}${entries}`;
        }).join('');
        const lettersHtml = isCollapsible
            ? `<div class="type-section" id="${sectionId}">${letters}</div>`
            : letters;
        return `<div class="type-group">${heading}${lettersHtml}</div>`;
    }).join('');

    return `<!DOCTYPE html><html><head>${cspTag}<style>${buildBaseStyles()}</style></head><body>
        <div class="topbar"><h1>Vault Glossary</h1>${buildSettingsButtonHtml()}</div>
        <p class="sub">${totalEntries} term${totalEntries === 1 ? '' : 's'} across ${escapeHtml(types.join(', '))}</p>
        <div class="toolbar">
            <div class="toolbar-group">
                <label class="toolbar-check"><input type="checkbox" id="toggle-group-by-type" ${groupByType ? 'checked' : ''} /> Group by type</label>
                <label class="toolbar-check"><input type="checkbox" id="toggle-hide-unreferenced" ${!showZeroBacklinkTerms ? 'checked' : ''} /> Hide unreferenced</label>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-sort">
                Sort
                <span class="select-wrap">
                    <select id="sort-by-select" class="toolbar-select">
                        <option value="alphabetical" ${sortBy !== 'mostReferenced' ? 'selected' : ''}>Alphabetical</option>
                        <option value="mostReferenced" ${sortBy === 'mostReferenced' ? 'selected' : ''}>Most referenced</option>
                    </select>
                </span>
            </div>
            <div class="toolbar-spacer"></div>
            <button class="toolbar-btn" data-action="copyMarkdown">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10V3.5A1.5 1.5 0 0 1 4 2h6" stroke="currentColor" stroke-width="1.3"/></svg>
                Copy as Markdown
            </button>
        </div>
        <input class="search-box" type="text" placeholder="Filter terms…" id="glossary-search" />
        ${body}
        <p class="no-results" id="glossary-no-results">No terms match your search.</p>
        <script nonce="${nonce}">
            ${toolbarScript}

            const searchInput = document.getElementById('glossary-search');
            const noResults = document.getElementById('glossary-no-results');
            const allEntries = Array.from(document.querySelectorAll('.entry'));
            let visibleEntries = allEntries.slice();
            let focusedIndex = -1;

            function clearFocus() {
                if (focusedIndex >= 0 && visibleEntries[focusedIndex]) {
                    visibleEntries[focusedIndex].classList.remove('is-focused');
                }
                focusedIndex = -1;
            }

            function setFocus(index) {
                clearFocus();
                if (!visibleEntries.length) return;
                focusedIndex = ((index % visibleEntries.length) + visibleEntries.length) % visibleEntries.length;
                const el = visibleEntries[focusedIndex];
                el.classList.add('is-focused');
                el.scrollIntoView({ block: 'nearest' });
            }

            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim().toLowerCase();
                let count = 0;
                visibleEntries = [];
                for (const entry of allEntries) {
                    const matches = !query || (entry.dataset.search || '').includes(query);
                    entry.classList.toggle('is-hidden', !matches);
                    if (matches) { count++; visibleEntries.push(entry); }
                }
                noResults.classList.toggle('is-visible', count === 0);
                clearFocus();
            });

            searchInput.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setFocus(focusedIndex + 1);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setFocus(focusedIndex - 1);
                } else if (event.key === 'Enter' && focusedIndex >= 0) {
                    event.preventDefault();
                    const termEl = visibleEntries[focusedIndex].querySelector('.term');
                    if (termEl) vscode.postMessage({ command: 'openNode', id: termEl.dataset.nodeId });
                }
            });
        </script>
    </body></html>`;
}

module.exports = { escapeHtml, linkifyDefinition, buildEmptyStateHtml, buildGlossaryHtml };
