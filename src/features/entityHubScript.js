// src/features/entityHubScript.js
// Browser-side JS for the Yamlink entity hub webview
// Loaded as an external file via asWebviewUri — no require(), no Node APIs

(function () {
    'use strict';

    var vscode = acquireVsCodeApi();

    // ── Click delegation ─────────────────────────────────────────────
    // Handles: hub-node (focal node header), cell-id, cell-rel, section toggle
    document.addEventListener('click', function (e) {

        // Focal node header → open the hub's subject node
        var hubNode = e.target.closest('.hub-node[data-id]');
        if (hubNode) {
            vscode.postMessage({ command: 'openNode', id: hubNode.dataset.id });
            return;
        }

        // ID cell → open source node
        var cid = e.target.closest('.cell-id[data-id]');
        if (cid) {
            vscode.postMessage({ command: 'openNode', id: cid.dataset.id });
            return;
        }

        // Relation pill → open linked node
        var rel = e.target.closest('.cell-rel[data-id]');
        if (rel) {
            vscode.postMessage({ command: 'openNode', id: rel.dataset.id });
            return;
        }

        var suggestion = e.target.closest('[data-insert-view]');
        if (suggestion) {
            if (suggestion.hasAttribute('disabled') || suggestion.getAttribute('aria-disabled') === 'true') {
                return;
            }
            vscode.postMessage({
                command: 'insertView',
                queryText: suggestion.dataset.insertView,
                sourceType: suggestion.dataset.sourceType,
                field: suggestion.dataset.fieldName,
                id: suggestion.dataset.nodeId
            });
            return;
        }

        // Arc missing field → add to frontmatter
        var arcAddBtn = e.target.closest('[data-add-field]');
        if (arcAddBtn) {
            vscode.postMessage({
                command: 'addMissingField',
                field: arcAddBtn.dataset.addField,
                isRelation: arcAddBtn.dataset.isRelation === 'true'
            });
            return;
        }

        // Section header → toggle collapse
        var sectionHeader = e.target.closest('.hub-section-header');
        if (sectionHeader) {
            var section = sectionHeader.closest('.hub-section');
            if (section) {
                section.classList.toggle('open');
                sectionHeader.setAttribute('aria-expanded', section.classList.contains('open') ? 'true' : 'false');
                applySearch();
            }
            return;
        }
    });

    // ── Column sort — scoped per section ────────────────────────────
    document.querySelectorAll('.hub-section').forEach(function (section) {
        var tbody   = section.querySelector('tbody');
        var sortCol = null;
        var sortAsc = true;

        section.querySelectorAll('thead th').forEach(function (th, ci) {
            th.addEventListener('click', function (e) {
                e.stopPropagation(); // don't bubble to section-header toggle
                if (!tbody) return;

                sortAsc = (sortCol === th.dataset.col) ? !sortAsc : true;
                sortCol = th.dataset.col;

                section.querySelectorAll('thead th').forEach(function (t) {
                    t.classList.remove('sorted');
                    t.querySelector('.sarr').textContent = '↕';
                });
                th.classList.add('sorted');
                th.querySelector('.sarr').textContent = sortAsc ? '↑' : '↓';

                Array.from(tbody.querySelectorAll('tr'))
                    .sort(function (a, b) {
                        var av = (a.querySelectorAll('td')[ci] || {}).textContent || '';
                        var bv = (b.querySelectorAll('td')[ci] || {}).textContent || '';
                        return sortAsc
                            ? av.trim().toLowerCase().localeCompare(bv.trim().toLowerCase())
                            : bv.trim().toLowerCase().localeCompare(av.trim().toLowerCase());
                    })
                    .forEach(function (r) { tbody.appendChild(r); });
            });
        });
    });

    // ── Global search — filters rows in the active tab ───────────────
    var searchInput  = document.getElementById('hubsearch');
    var visibleCount = document.getElementById('visible-count');
    var allRows      = Array.from(document.querySelectorAll('tbody tr'));
    var interactiveSelector = '.hub-node[data-id], .cell-id[data-id], .cell-rel[data-id], [data-insert-view], .hub-section-header';

    function decorateInteractiveNodes() {
        document.querySelectorAll(interactiveSelector).forEach(function (node) {
            if (node.matches('.hub-section-header')) {
                node.setAttribute('role', 'button');
                node.setAttribute('tabindex', '0');
                var section = node.closest('.hub-section');
                node.setAttribute('aria-expanded', section && section.classList.contains('open') ? 'true' : 'false');
                return;
            }
            if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
            if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
            if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') {
                node.setAttribute('tabindex', '-1');
            }
        });
    }

    function applySearch() {
        var term    = searchInput ? searchInput.value.toLowerCase() : '';
        var visible = 0;

        allRows.forEach(function (row) {
            var pane     = row.closest('.hub-tab-pane');
            var inActive = !pane || pane.classList.contains('active');
            var section  = row.closest('.hub-section');
            var inOpen   = !section || section.classList.contains('open');
            var matches  = !term || row.textContent.toLowerCase().includes(term);

            row.style.display = matches ? '' : 'none';
            if (matches && inOpen && inActive) visible++;
        });

        if (visibleCount) visibleCount.textContent = visible;
    }

    if (searchInput) {
        searchInput.addEventListener('input', applySearch);
    }

    // ── Tab switching ─────────────────────────────────────────────────
    var TAB_KEY  = 'yamlink.entityHubTab';
    var tabBtns  = Array.from(document.querySelectorAll('.hub-tab-btn'));
    var tabPanes = Array.from(document.querySelectorAll('.hub-tab-pane'));
    var tabIds   = tabBtns.map(function (b) { return b.dataset.tab; });

    function activateTab(tabId, focusButton) {
        if (tabIds.indexOf(tabId) === -1) tabId = tabIds[0] || 'overview';
        tabBtns.forEach(function (btn) {
            var isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.setAttribute('tabindex', isActive ? '0' : '-1');
            if (isActive && focusButton) btn.focus();
        });
        tabPanes.forEach(function (pane) {
            var isActive = pane.id === 'tab-' + tabId;
            pane.classList.toggle('active', isActive);
            pane.hidden = !isActive;
        });
        try { localStorage.setItem(TAB_KEY, tabId); } catch (e) {}
        applySearch();
    }

    tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () { activateTab(btn.dataset.tab, false); });
    });

    document.addEventListener('keydown', function (event) {
        var interactive = event.target.closest(interactiveSelector);
        if (interactive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            interactive.click();
            return;
        }

        var activeTabBtn = event.target.closest('.hub-tab-btn');
        if (!activeTabBtn) return;
        var currentIndex = tabBtns.indexOf(activeTabBtn);
        if (currentIndex === -1) return;
        var nextIndex = currentIndex;

        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabBtns.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabBtns.length) % tabBtns.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabBtns.length - 1;
        else return;

        event.preventDefault();
        activateTab(tabBtns[nextIndex].dataset.tab, true);
    });

    var _savedTab = 'overview';
    try { _savedTab = localStorage.getItem(TAB_KEY) || 'overview'; } catch (e) {}
    decorateInteractiveNodes();
    activateTab(_savedTab, false);

}());
