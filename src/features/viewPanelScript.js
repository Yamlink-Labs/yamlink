(function () {
    const vscode = acquireVsCodeApi();
    let editingCell = null;
    let selectedCell = null;
    let requestCounter = 0;
    let pendingSingle = new Map();
    let pendingBulk = new Map();
    let historyStack = [];
    let statusTimer = null;

    (function ensureStatusSurface() {
        const bar = document.querySelector('.live-bar');
        if (!bar) return;
        if (!document.getElementById('table-status')) {
            bar.innerHTML = '<span id="table-status" class="live-status">Double-click to edit, click booleans twice to toggle, paste from spreadsheets into selected cells, Ctrl/Cmd+Z to undo.</span><span>Click relation pills to open</span>';
        }
    }());

    function getState() {
        const tabs = [];
        document.querySelectorAll('.tab-panel').forEach(function (panel) {
            const search = panel.querySelector('.fsearch');
            const hiddenCols = Array.from(panel.querySelectorAll('[data-col-toggle]'))
                .filter(input => !input.checked)
                .map(input => input.dataset.colToggle);
            const columnOrder = Array.from(panel.querySelectorAll('thead th')).map(th => th.dataset.col);
            const sorted = panel.querySelector('thead th.sorted');
            tabs.push({
                search: search ? search.value : '',
                hiddenCols,
                columnOrder,
                sort: sorted ? { col: sorted.dataset.col, asc: sorted.dataset.asc === 'true' } : null
            });
        });
        const activeBtn = document.querySelector('.tab-btn.active');
        return { activeTab: activeBtn ? Number(activeBtn.dataset.tab) : 0, tabs };
    }

    function saveState() {
        vscode.postMessage({ command: 'saveState', state: getState() });
    }

    function setStatus(message, tone) {
        const target = document.getElementById('table-status');
        if (!target) return;
        target.textContent = message;
        target.className = `live-status${tone ? ` ${tone}` : ''}`;
        clearTimeout(statusTimer);
        if (tone) {
            statusTimer = setTimeout(function () {
                target.textContent = 'Double-click to edit, click booleans twice to toggle, paste from spreadsheets into selected cells, Ctrl/Cmd+Z to undo.';
                target.className = 'live-status';
            }, 2600);
        }
    }

    function switchTab(idx) {
        document.querySelectorAll('.tab-btn').forEach((button, i) => button.classList.toggle('active', i === idx));
        document.querySelectorAll('.tab-panel').forEach((panel, i) => panel.style.display = i === idx ? 'flex' : 'none');
        clearSelection();
        saveState();
    }

    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        btn.addEventListener('click', function () { switchTab(i); });
    });

    function clearSelection() {
        if (selectedCell) selectedCell.classList.remove('cell-selected');
        selectedCell = null;
    }

    function selectCell(cell) {
        if (!cell || cell.classList.contains('hidden-col')) return;
        clearSelection();
        selectedCell = cell;
        selectedCell.classList.add('cell-selected');
    }

    function getVisibleHeaders(panel) {
        return Array.from(panel.querySelectorAll('thead th')).filter(th => !th.classList.contains('hidden-col'));
    }

    function getSortValue(kind, text) {
        const raw = String(text ?? '').trim();
        if (kind === 'number') return raw === '' ? Number.POSITIVE_INFINITY : Number(raw);
        if (kind === 'date') return normaliseDateInput(raw) || raw;
        if (kind === 'boolean') return raw.toLowerCase() === 'true' ? '1' : '0';
        return raw.toLowerCase();
    }

    function getVisibleColumnIndex(cell) {
        const row = cell.parentElement;
        return Array.from(row.children).filter(td => !td.classList.contains('hidden-col')).indexOf(cell);
    }

    function navigateCell(cell, direction) {
        var panel = cell.closest('.tab-panel');
        if (!panel) return null;
        var allEditable = [];
        panel.querySelectorAll('tbody tr').forEach(function (row) {
            if (row.style.display === 'none') return;
            Array.from(row.children).forEach(function (td) {
                if (!td.classList.contains('hidden-col') && td.classList.contains('cell-editable')) {
                    allEditable.push(td);
                }
            });
        });
        var idx = allEditable.indexOf(cell);
        if (idx === -1) return null;
        var nextIdx = idx + direction;
        if (nextIdx < 0 || nextIdx >= allEditable.length) return null;
        return allEditable[nextIdx];
    }

    function getEditableVisibleCells(panel, row) {
        return Array.from(row.children).filter(function (cell) {
            return !cell.classList.contains('hidden-col') && cell.classList.contains('cell-editable');
        });
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function toIsoDate(year, month, day) {
        const y = Number(year);
        const m = Number(month);
        const d = Number(day);
        if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
        if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
        return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    function normaliseDateInput(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return null;

        let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
        if (match) return toIsoDate(match[1], match[2], match[3]);

        match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (match) {
            const a = Number(match[1]);
            const b = Number(match[2]);
            if (a > 12 && b <= 12) return toIsoDate(match[3], b, a);
            if (b > 12 && a <= 12) return toIsoDate(match[3], a, b);
            return toIsoDate(match[3], b, a);
        }

        match = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        if (match) {
            const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
            return Number.isInteger(month) && month > 0 ? toIsoDate(match[3], month, match[2]) : null;
        }

        match = raw.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
        if (match) {
            const month = new Date(`${match[2]} 1, 2000`).getMonth() + 1;
            return Number.isInteger(month) && month > 0 ? toIsoDate(match[3], month, match[1]) : null;
        }

        return null;
    }

    function normaliseForDisplay(mode, value) {
        const next = String(value ?? '').trim();
        if (!next) return '';
        if (mode === 'date') {
            return normaliseDateInput(next) || next;
        }
        return next;
    }

    function normaliseOutgoingValue(mode, value) {
        const next = normaliseForDisplay(mode, value);
        if (!next) return '';
        return mode === 'relation' ? `[[${next}]]` : next;
    }

    function renderCellValue(mode, value) {
        const next = normaliseForDisplay(mode, value);
        if (!next) return '-';
        if (mode === 'relation') {
            return `<span class="cell-rel" data-id="${escapeHtml(next)}">${escapeHtml(next)}</span>`;
        }
        if (mode === 'boolean') {
            const isTrue = next.toLowerCase() === 'true';
            return `<span class="cell-bool ${isTrue ? 'true' : 'false'}">${isTrue ? 'True' : 'False'}</span>`;
        }
        return escapeHtml(next);
    }

    function validateValue(cell, value) {
        const mode = cell.dataset.editMode || 'text';
        const next = String(value ?? '').trim();
        if (!next) return { ok: true, value: '' };

        if (mode === 'number' && !/^-?\d+(?:\.\d+)?$/.test(next)) {
            return { ok: false, message: `Expected a number for "${cell.dataset.field}".` };
        }
        if (mode === 'date') {
            const iso = normaliseDateInput(next);
            if (!iso) {
                return { ok: false, message: `Expected a real date for "${cell.dataset.field}".` };
            }
            return { ok: true, value: iso };
        }
        if (mode === 'relation') {
            const exists = Array.from(document.querySelectorAll('#yids option')).some(option => option.value === next);
            if (!exists) {
                return { ok: false, message: `Unknown node "${next}" for relation field "${cell.dataset.field}".` };
            }
        }
        if (mode === 'dropdown') {
            let options = [];
            try { options = JSON.parse(cell.dataset.options || '[]'); } catch (_) {}
            if (options.length > 0 && !options.includes(next)) {
                return { ok: false, message: `Value "${next}" is outside the allowed options for "${cell.dataset.field}".` };
            }
        }

        return { ok: true, value: next };
    }

    function getColumnIndex(panel, col) {
        return Array.from(panel.querySelectorAll('thead th')).findIndex(th => th.dataset.col === col);
    }

    function moveColumn(panel, col, delta) {
        const headers = Array.from(panel.querySelectorAll('thead th'));
        const fromIndex = headers.findIndex(th => th.dataset.col === col);
        const toIndex = fromIndex + delta;
        if (fromIndex === -1 || toIndex < 0 || toIndex >= headers.length) return;

        const headerRow = panel.querySelector('thead tr');
        const movingHeader = headers[fromIndex];
        const anchorHeader = headers[toIndex];
        headerRow.insertBefore(movingHeader, delta < 0 ? anchorHeader : anchorHeader.nextSibling);

        panel.querySelectorAll('tbody tr').forEach(function (row) {
            const cells = Array.from(row.children);
            const movingCell = cells[fromIndex];
            const anchorCell = cells[toIndex];
            row.insertBefore(movingCell, delta < 0 ? anchorCell : anchorCell.nextSibling);
        });

        const toggles = Array.from(panel.querySelectorAll('[data-col-toggle]'));
        const movingToggle = toggles.find(input => input.dataset.colToggle === col)?.closest('label');
        const anchorToggle = toggles[toIndex]?.closest('label');
        if (movingToggle && anchorToggle) {
            anchorToggle.parentElement.insertBefore(movingToggle, delta < 0 ? anchorToggle : anchorToggle.nextSibling);
        }

        panel.querySelectorAll('.col-move').forEach(function (button) {
            const buttonCol = button.dataset.col;
            const index = getColumnIndex(panel, buttonCol);
            if (button.dataset.colMove === 'left') button.disabled = index <= 0;
            if (button.dataset.colMove === 'right') button.disabled = index >= headers.length - 1;
        });
    }

    function queueHistory(edits) {
        if (!Array.isArray(edits) || edits.length === 0) return;
        historyStack.push({ edits });
        if (historyStack.length > 50) historyStack.shift();
    }

    function sendBulkEdits(edits, source) {
        if (!edits.length) return;
        vscode.postMessage({ command: 'editCellsBulk', edits, source: source || 'user' });
    }

    function performUndo() {
        if (editingCell || pendingSingle.size > 0 || pendingBulk.size > 0) return;
        const op = historyStack.pop();
        if (!op || !op.edits || op.edits.length === 0) {
            setStatus('Nothing to undo.', 'error');
            return;
        }

        const reverseEdits = [];
        op.edits.forEach(function (edit) {
            const cell = document.querySelector(`.cell-editable[data-filepath="${CSS.escape(edit.filePath)}"][data-field="${CSS.escape(edit.field)}"]`);
            if (!cell) return;
            const requestId = String(++requestCounter);
            const previous = String(cell.dataset.value || '').trim();
            const next = edit.previous;
            cell.dataset.pendingRequestId = requestId;
            cell.dataset.value = next;
            cell.innerHTML = renderCellValue(cell.dataset.editMode || 'text', next);
            pendingBulk.set(requestId, {
                cell,
                previous,
                next,
                previousHtml: renderCellValue(cell.dataset.editMode || 'text', previous),
                field: edit.field,
                filePath: edit.filePath,
                historyPrevious: previous,
                historyNext: next
            });
            reverseEdits.push({
                requestId,
                filePath: edit.filePath,
                field: edit.field,
                value: normaliseOutgoingValue(cell.dataset.editMode || 'text', next)
            });
        });

        if (!reverseEdits.length) {
            setStatus('Nothing visible to undo in this table.', 'error');
            return;
        }

        setStatus(`Undoing ${reverseEdits.length} change${reverseEdits.length === 1 ? '' : 's'}...`);
        sendBulkEdits(reverseEdits, 'undo');
    }

    function startEdit(cell) {
        if (editingCell) finishEdit(editingCell, true);
        selectCell(cell);
        editingCell = cell;
        const mode = cell.dataset.editMode || 'text';
        const originalValue = cell.dataset.value || '';
        cell.dataset.originalHtml = cell.innerHTML;

        if (mode === 'dropdown') {
            const select = document.createElement('select');
            select.className = 'cell-select';
            let options = [];
            try { options = JSON.parse(cell.dataset.options || '[]'); } catch (_) {}
            options.forEach(function (opt) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (opt === originalValue) option.selected = true;
                select.appendChild(option);
            });
            cell.innerHTML = '';
            cell.appendChild(select);
            select.focus();
            select.addEventListener('change', function () { finishEdit(cell, false, select.value); });
            select.addEventListener('blur', function () { finishEdit(cell, false, select.value); });
            select.addEventListener('keydown', function (event) {
                if (event.key === 'Tab') {
                    event.preventDefault();
                    var target = navigateCell(cell, event.shiftKey ? -1 : 1);
                    finishEdit(cell, false, select.value);
                    if (target) startEdit(target);
                }
            });
            return;
        }

        const input = document.createElement('input');
        input.className = 'cell-input';
        input.type = mode === 'number' ? 'number' : (mode === 'date' ? 'text' : 'text');
        input.value = originalValue;
        input.placeholder = mode === 'date' ? 'YYYY-MM-DD or 26 Mar 2026' : '';
        if (mode === 'relation') input.setAttribute('list', 'yids');
        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                finishEdit(cell, false, input.value);
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                finishEdit(cell, true);
            }
            if (event.key === 'Tab') {
                event.preventDefault();
                var target = navigateCell(cell, event.shiftKey ? -1 : 1);
                finishEdit(cell, false, input.value);
                if (target) startEdit(target);
            }
        });
        input.addEventListener('blur', function () { finishEdit(cell, false, input.value); });
    }

    function finishEdit(cell, cancelled, value) {
        if (editingCell !== cell) return;
        editingCell = null;
        if (cancelled) {
            cell.innerHTML = cell.dataset.originalHtml || renderCellValue(cell.dataset.editMode || 'text', cell.dataset.value || '');
            return;
        }
        commitEdit(cell, value);
    }

    function commitEdit(cell, value) {
        const mode = cell.dataset.editMode || 'text';
        const current = String(cell.dataset.value || '').trim();
        const validation = validateValue(cell, value);
        if (!validation.ok) {
            cell.innerHTML = cell.dataset.originalHtml || renderCellValue(mode, current);
            setStatus(validation.message, 'error');
            return;
        }

        const next = validation.value;
        if (next === current) {
            cell.innerHTML = cell.dataset.originalHtml || renderCellValue(mode, current);
            return;
        }

        const requestId = String(++requestCounter);
        cell.dataset.pendingRequestId = requestId;
        cell.dataset.value = next;
        cell.innerHTML = renderCellValue(mode, next);
        pendingSingle.set(requestId, {
            cell,
            previous: current,
            next,
            field: cell.dataset.field,
            filePath: cell.dataset.filepath
        });
        vscode.postMessage({
            command: 'editCell',
            requestId,
            filePath: cell.dataset.filepath,
            field: cell.dataset.field,
            value: normaliseOutgoingValue(mode, next)
        });
    }

    function applyBulkPaste(startCell, matrix) {
        const panel = startCell.closest('.tab-panel');
        const visibleHeaders = getVisibleHeaders(panel);
        const startColumn = getVisibleColumnIndex(startCell);
        const bodyRows = Array.from(panel.querySelectorAll('tbody tr')).filter(row => row.children.length > 1);
        const startRow = bodyRows.indexOf(startCell.parentElement);
        if (startRow === -1 || startColumn === -1) return;

        const edits = [];
        let affected = 0;

        for (let rowOffset = 0; rowOffset < matrix.length; rowOffset++) {
            const row = bodyRows[startRow + rowOffset];
            if (!row) break;
            const editableCells = getEditableVisibleCells(panel, row);
            for (let colOffset = 0; colOffset < matrix[rowOffset].length; colOffset++) {
                const targetHeader = visibleHeaders[startColumn + colOffset];
                if (!targetHeader) break;
                const targetCell = editableCells.find(cell => cell.dataset.field === targetHeader.dataset.col);
                if (!targetCell) continue;

                const validation = validateValue(targetCell, matrix[rowOffset][colOffset]);
                if (!validation.ok) {
                    setStatus(validation.message, 'error');
                    return;
                }

                const next = validation.value;
                const current = String(targetCell.dataset.value || '').trim();
                if (next === current) continue;

                const requestId = String(++requestCounter);
                targetCell.dataset.pendingRequestId = requestId;
                targetCell.dataset.value = next;
                targetCell.innerHTML = renderCellValue(targetCell.dataset.editMode || 'text', next);
                edits.push({
                    requestId,
                    filePath: targetCell.dataset.filepath,
                    field: targetCell.dataset.field,
                    value: normaliseOutgoingValue(targetCell.dataset.editMode || 'text', next)
                });
                pendingBulk.set(requestId, {
                    cell: targetCell,
                    previous: current,
                    next,
                    previousHtml: renderCellValue(targetCell.dataset.editMode || 'text', current),
                    field: targetCell.dataset.field,
                    filePath: targetCell.dataset.filepath
                });
                affected += 1;
            }
        }

        if (!edits.length) {
            setStatus('Paste matched cells, but no values changed.', 'success');
            return;
        }

        setStatus(`Applying ${affected} pasted value${affected === 1 ? '' : 's'}...`);
        sendBulkEdits(edits, 'user');
    }

    function revertRow(filePath) {
        if (editingCell || pendingSingle.size > 0 || pendingBulk.size > 0) return;

        // Collect the earliest "previous" value per field from history entries touching this filePath
        var fieldOriginal = new Map();
        var affectedEntries = historyStack.filter(function (entry) {
            return entry.edits.some(function (e) { return e.filePath === filePath; });
        });

        if (affectedEntries.length === 0) {
            setStatus('No changes to revert for this row.', 'error');
            return;
        }

        // Walk oldest → newest; first previous seen per field is the original value
        for (var ei = 0; ei < affectedEntries.length; ei++) {
            var editsInEntry = affectedEntries[ei].edits;
            for (var ej = 0; ej < editsInEntry.length; ej++) {
                var e = editsInEntry[ej];
                if (e.filePath !== filePath) continue;
                if (!fieldOriginal.has(e.field)) fieldOriginal.set(e.field, e.previous);
            }
        }

        var edits = [];
        fieldOriginal.forEach(function (originalValue, field) {
            var cell = document.querySelector('.cell-editable[data-filepath="' + CSS.escape(filePath) + '"][data-field="' + CSS.escape(field) + '"]');
            if (!cell) return;
            var current = String(cell.dataset.value || '').trim();
            var revertTo = String(originalValue || '').trim();
            if (current === revertTo) return;
            var requestId = String(++requestCounter);
            cell.dataset.pendingRequestId = requestId;
            cell.dataset.value = revertTo;
            cell.innerHTML = renderCellValue(cell.dataset.editMode || 'text', revertTo);
            pendingBulk.set(requestId, {
                cell: cell,
                previous: current,
                next: revertTo,
                previousHtml: renderCellValue(cell.dataset.editMode || 'text', current),
                field: field,
                filePath: filePath
            });
            edits.push({
                requestId: requestId,
                filePath: filePath,
                field: field,
                value: normaliseOutgoingValue(cell.dataset.editMode || 'text', revertTo)
            });
        });

        if (!edits.length) {
            setStatus('Row is already at its original values.', 'success');
            return;
        }

        // Remove history entries that touched this row
        for (var hi = historyStack.length - 1; hi >= 0; hi--) {
            if (historyStack[hi].edits.some(function (e) { return e.filePath === filePath; })) {
                historyStack.splice(hi, 1);
            }
        }

        setStatus('Reverting ' + edits.length + ' change' + (edits.length === 1 ? '' : 's') + '...');
        sendBulkEdits(edits, 'revert');
    }

    document.addEventListener('click', function (event) {
        const revertBtn = event.target.closest('.revert-row-btn');
        if (revertBtn) {
            revertRow(revertBtn.dataset.filepath);
            return;
        }

        const relation = event.target.closest('.cell-rel[data-id]');
        if (relation) {
            vscode.postMessage({ command: 'openNode', id: relation.dataset.id });
            return;
        }

        const idCell = event.target.closest('.cell-id[data-id]');
        if (idCell) {
            vscode.postMessage({ command: 'openNode', id: idCell.dataset.id });
            return;
        }

        const exportBtn = event.target.closest('.export-btn');
        if (exportBtn) {
            const panel = exportBtn.closest('.tab-panel');
            const queryIndex = Number(panel.dataset.tab);
            const visibleColumns = Array.from(panel.querySelectorAll('thead th'))
                .filter(th => !th.classList.contains('hidden-col'))
                .map(th => th.dataset.col);
            vscode.postMessage({ command: 'export', format: exportBtn.dataset.format, queryIndex, visibleColumns });
            return;
        }

        const columnsBtn = event.target.closest('.columns-btn');
        if (columnsBtn) {
            const menu = columnsBtn.parentElement.querySelector('.toolbar-menu');
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
            return;
        }

        const moveBtn = event.target.closest('.col-move');
        if (moveBtn && !moveBtn.disabled) {
            const panel = moveBtn.closest('.tab-panel');
            moveColumn(panel, moveBtn.dataset.col, moveBtn.dataset.colMove === 'left' ? -1 : 1);
            saveState();
            return;
        }

        if (!event.target.closest('.toolbar-menu')) {
            document.querySelectorAll('.toolbar-menu').forEach(menu => { menu.style.display = 'none'; });
        }

        const editableCell = event.target.closest('.cell-editable');
        if (editableCell) {
            if ((editableCell.dataset.editMode || 'text') === 'boolean' && selectedCell === editableCell) {
                const current = (editableCell.dataset.value || '').toLowerCase() === 'true';
                commitEdit(editableCell, current ? 'false' : 'true');
                return;
            }
            selectCell(editableCell);
            return;
        }

        clearSelection();
    });

    document.addEventListener('dblclick', function (event) {
        const cell = event.target.closest('.cell-editable');
        if (!cell) return;
        if ((cell.dataset.editMode || 'text') === 'boolean') return;
        startEdit(cell);
    });

    document.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            const activeTag = document.activeElement && document.activeElement.tagName;
            if (!editingCell && activeTag !== 'INPUT' && activeTag !== 'SELECT' && activeTag !== 'TEXTAREA') {
                event.preventDefault();
                performUndo();
                return;
            }
        }

        if (!selectedCell || editingCell) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
        if (event.key === 'Enter') {
            event.preventDefault();
            if ((selectedCell.dataset.editMode || 'text') === 'boolean') {
                const current = (selectedCell.dataset.value || '').toLowerCase() === 'true';
                commitEdit(selectedCell, current ? 'false' : 'true');
            } else {
                startEdit(selectedCell);
            }
        }
    });

    document.addEventListener('paste', function (event) {
        if (!selectedCell || editingCell) return;
        const text = event.clipboardData && event.clipboardData.getData('text/plain');
        if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
        event.preventDefault();
        const matrix = text
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .filter(Boolean)
            .map(line => line.split('\t'));
        if (!matrix.length) return;
        applyBulkPaste(selectedCell, matrix);
    });

    document.addEventListener('change', function (event) {
        if (event.target.matches('[data-col-toggle]')) {
            const col = event.target.dataset.colToggle;
            const panel = event.target.closest('.tab-panel');
            const hide = !event.target.checked;
            panel.querySelectorAll(`[data-col="${CSS.escape(col)}"]`).forEach(el => el.classList.toggle('hidden-col', hide));
            panel.querySelectorAll(`tbody td:nth-child(${getColumnIndex(panel, col) + 1})`).forEach(el => el.classList.toggle('hidden-col', hide));
            saveState();
        }
    });

    window.addEventListener('message', function (event) {
        const msg = event.data || {};

        if (msg.command === 'editResult') {
            const pending = pendingSingle.get(msg.requestId);
            if (!pending) return;
            pendingSingle.delete(msg.requestId);
            delete pending.cell.dataset.pendingRequestId;
            if (!msg.ok) {
                pending.cell.dataset.value = pending.previous;
                pending.cell.innerHTML = renderCellValue(pending.cell.dataset.editMode || 'text', pending.previous);
                setStatus(`Could not save "${pending.field}".`, 'error');
                return;
            }
            queueHistory([{
                filePath: pending.filePath,
                field: pending.field,
                previous: pending.previous,
                next: pending.next
            }]);
            setStatus(`Saved "${pending.field}".`, 'success');
        }

        if (msg.command === 'bulkEditResult') {
            const results = Array.isArray(msg.results) ? msg.results : [];
            const successfulEdits = [];
            let successCount = 0;
            let failedCount = 0;
            results.forEach(function (result) {
                const pending = pendingBulk.get(result.requestId);
                if (!pending) return;
                pendingBulk.delete(result.requestId);
                delete pending.cell.dataset.pendingRequestId;
                if (result.ok) {
                    successCount += 1;
                    successfulEdits.push({
                        filePath: pending.filePath,
                        field: pending.field,
                        previous: pending.previous,
                        next: pending.next
                    });
                    return;
                }
                failedCount += 1;
                pending.cell.dataset.value = pending.previous;
                pending.cell.innerHTML = pending.previousHtml;
            });

            const src = msg.source || 'user';
            if (src !== 'undo' && src !== 'revert' && successfulEdits.length > 0) {
                queueHistory(successfulEdits);
            }

            if (failedCount > 0) {
                setStatus(`Saved ${successCount} cell${successCount === 1 ? '' : 's'}, ${failedCount} failed validation or write.`, 'error');
            } else if (successCount > 0) {
                setStatus(src === 'undo'
                    ? `Undid ${successCount} change${successCount === 1 ? '' : 's'}.`
                    : src === 'revert'
                        ? `Reverted ${successCount} change${successCount === 1 ? '' : 's'}.`
                        : `Saved ${successCount} pasted cell${successCount === 1 ? '' : 's'}.`, 'success');
            }
        }
    });

    document.querySelectorAll('.fsearch').forEach(function (search) {
        search.addEventListener('input', function () {
            const panel = search.closest('.tab-panel');
            const term = search.value.toLowerCase();
            panel.querySelectorAll('tbody tr').forEach(function (row) {
                row.style.display = !term || row.textContent.toLowerCase().includes(term) ? '' : 'none';
            });
            saveState();
        });
    });

    document.querySelectorAll('thead th').forEach(function (th) {
        th.addEventListener('click', function () {
            const panel = th.closest('.tab-panel');
            const tbody = panel.querySelector('tbody');
            const all = Array.from(panel.querySelectorAll('thead th'));
            const index = all.indexOf(th);
            const kind = th.dataset.kind || 'text';
            const currentlySorted = th.classList.contains('sorted');
            const asc = !(currentlySorted && th.dataset.asc === 'true');
            all.forEach(el => {
                el.classList.remove('sorted');
                delete el.dataset.asc;
            });
            th.classList.add('sorted');
            th.dataset.asc = asc ? 'true' : 'false';
            Array.from(tbody.querySelectorAll('tr'))
                .sort(function (a, b) {
                    const av = getSortValue(kind, (a.children[index] || {}).textContent || '');
                    const bv = getSortValue(kind, (b.children[index] || {}).textContent || '');
                    if (typeof av === 'number' || typeof bv === 'number') {
                        return asc ? av - bv : bv - av;
                    }
                    return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
                })
                .forEach(tr => tbody.appendChild(tr));
            saveState();
        });
    });

    document.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            const panel = chip.closest('.tab-panel');
            panel.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const filter = chip.dataset.filter;
            panel.querySelectorAll('tbody tr').forEach(function (row) {
                if (filter === 'all') row.style.display = '';
                else row.style.display = row.dataset.type === filter.slice(5) ? '' : 'none';
            });
        });
    });
}());
