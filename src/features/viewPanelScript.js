// src/features/viewPanelScript.js
// Browser-side JS for the Yamlink view panel webview
// Loaded as an external file via asWebviewUri — no require(), no Node APIs

(function () {
    var vscode      = acquireVsCodeApi();
    var editingCell = null;

    // ── State snapshot — posted to Node before every re-render ──
    function collectState() {
        var activeTab = 0;
        document.querySelectorAll('.tab-btn').forEach(function (b, i) {
            if (b.classList.contains('active')) activeTab = i;
        });

        var tabs = [];
        document.querySelectorAll('.tab-panel').forEach(function (tp) {
            var search = tp.querySelector('.fsearch');
            var sorted = tp.querySelector('thead th.sorted');
            var sarr   = sorted ? sorted.querySelector('.sarr') : null;
            tabs.push({
                search: search ? search.value : '',
                sort:   sorted ? { col: sorted.dataset.col, asc: sarr && sarr.textContent === '↑' } : null
            });
        });

        return { activeTab: activeTab, tabs: tabs };
    }

    function saveState() {
        vscode.postMessage({ command: 'saveState', state: collectState() });
    }

    // ── Tab switching ──
    function switchTab(idx) {
        document.querySelectorAll('.tab-btn').forEach(function (b, i) {
            b.classList.toggle('active', i === idx);
        });
        document.querySelectorAll('.tab-panel').forEach(function (p, i) {
            p.style.display = i === idx ? 'flex' : 'none';
        });
        saveState();
    }

    document.querySelectorAll('.tab-btn').forEach(function (btn, i) {
        btn.addEventListener('click', function () { switchTab(i); });
    });

    // ── Click: open node (ID cell or relation pill) ──
    document.addEventListener('click', function (e) {
        if (editingCell) return;
        var pill = e.target.closest('.cell-rel[data-id]');
        if (pill) { vscode.postMessage({ command: 'openNode', id: pill.dataset.id }); return; }
        var cid = e.target.closest('.cell-id[data-id]');
        if (cid) { vscode.postMessage({ command: 'openNode', id: cid.dataset.id }); }
    });

    // ── Double-click: edit cell ──
    document.addEventListener('dblclick', function (e) {
        var cell = e.target.closest('.cell-editable');
        if (cell) { e.preventDefault(); e.stopPropagation(); startEdit(cell); }
    });

    // ── Cell flash — brief green pulse on successful save ──
    // Optimistic: fires immediately after the write is dispatched.
    // Keeps users confident the edit happened without waiting for
    // a round-trip confirmation.
    function flashCell(cell) {
        cell.classList.add('cell-saved');
        setTimeout(function () { cell.classList.remove('cell-saved'); }, 700);
    }

    // ── Cell editing ──
    function startEdit(cell) {
        if (editingCell) finishEdit(editingCell, true);
        editingCell = cell;
        cell.classList.add('editing');

        var isRel = cell.dataset.relation === 'true';
        var inp   = document.createElement('input');
        inp.className = 'cell-input';
        inp.type      = 'text';
        inp.value     = cell.dataset.value || '';
        if (isRel) inp.setAttribute('list', 'yids');

        cell.innerHTML = '';
        cell.appendChild(inp);
        inp.focus();
        inp.select();

        // Typing [[ in a plain cell promotes it to relation mode
        if (!isRel) {
            inp.addEventListener('input', function () {
                if (inp.value.startsWith('[[')) {
                    cell.dataset.relation = 'true';
                    inp.value = inp.value.replace(/^\[\[/, '');
                    inp.setAttribute('list', 'yids');
                    inp.style.color = '#4fc4a0';
                }
            });
        }

        inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter')  { ev.preventDefault(); ev.stopPropagation(); finishEdit(cell, false, inp.value); }
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finishEdit(cell, true); }
        });
        inp.addEventListener('blur', function () {
            setTimeout(function () { finishEdit(cell, false, inp.value); }, 150);
        });
    }

    function finishEdit(cell, cancelled, newValue) {
        if (editingCell !== cell) return;
        editingCell = null;
        cell.classList.remove('editing');

        var orig  = cell.dataset.value || '';
        var isRel = cell.dataset.relation === 'true';

        if (cancelled || newValue === undefined) { restore(cell, orig, isRel); return; }

        newValue = newValue.trim();
        if (!newValue || newValue === orig) { restore(cell, orig, isRel); return; }

        // Relation: must be a known ID
        if (isRel) {
            var known = Array.from(document.querySelectorAll('#yids option'))
                .map(function (o) { return o.value; });
            if (!known.includes(newValue)) {
                restore(cell, orig, isRel);
                var w = document.createElement('span');
                w.style.cssText = 'color:#e5a96a;font-family:monospace;font-size:10px;padding:2px 6px;';
                w.textContent   = '"' + newValue + '" not found';
                cell.innerHTML  = '';
                cell.appendChild(w);
                setTimeout(function () { restore(cell, orig, isRel); }, 2000);
                return;
            }
        }

        cell.dataset.value = newValue;
        restore(cell, newValue, isRel);

        // Flash the cell to confirm the write happened — users need this
        // signal since edits save silently with no other feedback.
        flashCell(cell);

        vscode.postMessage({
            command:  'editCell',
            filePath: cell.dataset.filepath,
            field:    cell.dataset.field,
            value:    isRel ? '[[' + newValue + ']]' : newValue
        });
    }

    function restore(cell, val, isRel) {
        if (!val) { cell.textContent = '—'; cell.classList.add('cell-empty'); return; }
        cell.classList.remove('cell-empty');
        if (isRel) {
            cell.innerHTML = '<span class="cell-rel" data-id="' + val + '">' + val + '</span>';
        } else {
            cell.textContent = val;
        }
    }

    // ── Per-panel: column sort + filter ──
    document.querySelectorAll('.tab-panel').forEach(function (tp) {
        var tbody        = tp.querySelector('tbody');
        var search       = tp.querySelector('.fsearch');
        var fcount       = tp.querySelector('.fcount strong');
        var sortCol      = null;
        var sortAsc      = true;
        var activeFilter = 'all';

        function applyFilters() {
            var term    = search ? search.value.toLowerCase() : '';
            var visible = 0;
            if (!tbody) return;

            tbody.querySelectorAll('tr').forEach(function (row) {
                var ok = !term || row.textContent.toLowerCase().includes(term);
                if (ok && activeFilter.startsWith('type:')) ok = row.dataset.type === activeFilter.slice(5);
                else if (ok && activeFilter === 'no-relation') ok = !row.querySelector('.cell-rel');
                row.style.display = ok ? '' : 'none';
                if (ok) visible++;
            });

            if (fcount) fcount.textContent = visible;

            // Update chip counts to reflect search-filtered subset.
            // Each chip shows how many visible rows match its own filter —
            // so when search narrows the table, chips stay accurate.
            tp.querySelectorAll('.chip').forEach(function (chip) {
                var filter  = chip.dataset.filter;
                var chipN   = chip.querySelector('.chip-n');
                if (!chipN) return;

                var chipCount = 0;
                tbody.querySelectorAll('tr').forEach(function (row) {
                    // Count only rows that pass the search filter
                    var passesSearch = !term || row.textContent.toLowerCase().includes(term);
                    if (!passesSearch) return;

                    if (filter === 'all') {
                        chipCount++;
                    } else if (filter.startsWith('type:')) {
                        if (row.dataset.type === filter.slice(5)) chipCount++;
                    } else if (filter === 'no-relation') {
                        if (!row.querySelector('.cell-rel')) chipCount++;
                    }
                });

                chipN.textContent = chipCount;
            });
        }

        tp.querySelectorAll('thead th').forEach(function (th, ci) {
            th.addEventListener('click', function () {
                if (!tbody) return;
                sortAsc = sortCol === th.dataset.col ? !sortAsc : true;
                sortCol = th.dataset.col;
                tp.querySelectorAll('thead th').forEach(function (t) {
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
                saveState();
            });
        });

        tp.querySelectorAll('.chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                tp.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                activeFilter = chip.dataset.filter;
                applyFilters();
            });
        });

        if (search) search.addEventListener('input', function () { applyFilters(); saveState(); });
    });

    // ── Initialise: honour active tab already encoded in HTML ──
    var initialActive = 0;
    document.querySelectorAll('.tab-btn').forEach(function (b, i) {
        if (b.classList.contains('active')) initialActive = i;
    });
    document.querySelectorAll('.tab-panel').forEach(function (p, i) {
        p.style.display = i === initialActive ? 'flex' : 'none';
    });

    // ── Signal to the live bar that JS is running ──
    var status = document.getElementById('jsstatus');
    if (status) {
        status.textContent = 'live · updates on save · double-click to edit';
        status.style.color = '';
    }

}());