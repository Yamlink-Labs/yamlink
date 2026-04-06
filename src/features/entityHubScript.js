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
            vscode.postMessage({
                command: 'insertView',
                queryText: suggestion.dataset.insertView,
                sourceType: suggestion.dataset.sourceType,
                field: suggestion.dataset.fieldName,
                id: suggestion.dataset.nodeId
            });
            return;
        }

        // Section header → toggle collapse
        var sectionHeader = e.target.closest('.hub-section-header');
        if (sectionHeader) {
            var section = sectionHeader.closest('.hub-section');
            if (section) {
                section.classList.toggle('open');
                applySearch(); // re-count after collapse
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

    // ── Global search — filters across all sections ──────────────────
    var searchInput  = document.getElementById('hubsearch');
    var visibleCount = document.getElementById('visible-count');
    var allRows      = Array.from(document.querySelectorAll('tbody tr'));
    var total        = allRows.length;

    function applySearch() {
        var term    = searchInput ? searchInput.value.toLowerCase() : '';
        var visible = 0;

        allRows.forEach(function (row) {
            // A row in a collapsed section doesn't contribute to visible count
            var section  = row.closest('.hub-section');
            var inOpen   = !section || section.classList.contains('open');
            var matches  = !term || row.textContent.toLowerCase().includes(term);
            var show     = matches; // show/hide regardless of section state

            row.style.display = show ? '' : 'none';
            if (show && inOpen) visible++;
        });

        if (visibleCount) visibleCount.textContent = visible;
    }

    if (searchInput) {
        searchInput.addEventListener('input', applySearch);
    }

    // ── Signal ready ─────────────────────────────────────────────────
    var status = document.getElementById('jsstatus');
    if (status) {
        status.textContent = 'live · updates on save';
        status.style.color = '';
    }

}());
