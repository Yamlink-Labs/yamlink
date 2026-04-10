(function () {
    const vscode = acquireVsCodeApi();
    let editingCell = null;
    let selectedCell = null;
    let requestCounter = 0;
    let pendingSingle = new Map();
    let pendingBulk = new Map();
    let historyStack = [];
    let statusTimer = null;
    let draggingHeader = null;
    let dragAfter = false;
    let resizingState = null;
    let suppressSortClickUntil = 0;
    const DEFAULT_STATUS_MESSAGE = 'Double-click to edit, click booleans twice to toggle, paste from spreadsheets into selected cells, Ctrl/Cmd+Z to undo.';

    (function ensureStatusSurface() {
        const bar = document.querySelector('.live-bar');
        if (!bar) return;
        if (!document.getElementById('table-status')) {
            bar.innerHTML = `<span id="table-status" class="live-status">${DEFAULT_STATUS_MESSAGE}</span><span>Click relation pills to open</span>`;
        }
    }());

    function getStatusDefaultMessage() {
        return DEFAULT_STATUS_MESSAGE;
    }

    function clearStatusTimer() {
        clearTimeout(statusTimer);
    }

    function setStatusTimer(nextTimer) {
        statusTimer = nextTimer;
    }

    const viewRuntime = window.YamlinkViewPanelStateRuntime.createViewPanelStateRuntime({
        vscode,
        getStatusDefaultMessage,
        getSelectedCell: function () { return selectedCell; },
        setSelectedCell: function (cell) { selectedCell = cell; },
        clearStatusTimer,
        setStatusTimer,
        normaliseDateInput
    });

    const {
        applyColumnWidth,
        applyPanelView,
        clearSelection,
        getColumnIndex,
        getColumnWidth,
        getDataHeaders,
        getEditableVisibleCells,
        getSortValue,
        getVisibleColumnIndex,
        getVisibleHeaders,
        moveColumn,
        navigateCell,
        reorderColumns,
        resetPanelState,
        saveState,
        selectCell,
        setStatus,
        switchTab,
        syncColumnToggleOrder,
        updateTableSummary,
        updateVisibleCount
    } = viewRuntime;

    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        btn.addEventListener('click', function () { switchTab(i); });
    });

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

    function queueHistory(edits) {
        if (!Array.isArray(edits) || edits.length === 0) return;
        historyStack.push({ edits });
        if (historyStack.length > 50) historyStack.shift();
    }

    function findCellForEdit(edit) {
        var selector = `.cell-editable[data-filepath="${CSS.escape(edit.filePath)}"][data-field="${CSS.escape(edit.field)}"]`;
        if (edit.panelTab !== undefined && edit.panelTab !== null) {
            var scopedPanel = document.querySelector(`.tab-panel[data-tab="${CSS.escape(String(edit.panelTab))}"]`);
            if (scopedPanel) {
                var scopedCell = scopedPanel.querySelector(selector);
                if (scopedCell) return scopedCell;
            }
        }
        return document.querySelector(selector);
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
            const cell = findCellForEdit(edit);
            if (!cell) return;
            const requestId = String(++requestCounter);
            const previous = String(cell.dataset.value || '').trim();
            const next = edit.previous;
            const panelTab = cell.closest('.tab-panel')?.dataset.tab || edit.panelTab || null;
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
                panelTab,
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
            filePath: cell.dataset.filepath,
            panelTab: cell.closest('.tab-panel')?.dataset.tab || null
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

    function revertRow(row) {
        var filePath = row?.querySelector('.revert-row-btn')?.dataset.filepath || row?.dataset.filepath || '';
        if (editingCell || pendingSingle.size > 0 || pendingBulk.size > 0) return;
        if (!filePath || !row) return;

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
            var cell = row.querySelector('.cell-editable[data-field="' + CSS.escape(field) + '"]');
            if (!cell) return;
            var current = String(cell.dataset.value || '').trim();
            var revertTo = String(originalValue || '').trim();
            if (current === revertTo) return;
            var requestId = String(++requestCounter);
            var panelTab = row.closest('.tab-panel')?.dataset.tab || null;
            cell.dataset.pendingRequestId = requestId;
            cell.dataset.value = revertTo;
            cell.innerHTML = renderCellValue(cell.dataset.editMode || 'text', revertTo);
            pendingBulk.set(requestId, {
                cell: cell,
                previous: current,
                next: revertTo,
                previousHtml: renderCellValue(cell.dataset.editMode || 'text', current),
                field: field,
                filePath: filePath,
                panelTab
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
            revertRow(revertBtn.closest('tr'));
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
            const visibleColumns = Array.from(panel.querySelectorAll('thead th[data-col]'))
                .filter(th => !th.classList.contains('hidden-col'))
                .map(th => th.dataset.col);
            vscode.postMessage({ command: 'export', format: exportBtn.dataset.format, queryIndex, visibleColumns });
            return;
        }

        const resetBtn = event.target.closest('.reset-btn');
        if (resetBtn) {
            resetPanelState(resetBtn.closest('.tab-panel'));
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
        if (event.target.closest('.col-resizer')) return;
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
                panelTab: pending.panelTab,
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
                        panelTab: pending.panelTab,
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
            applyPanelView(panel);
            saveState();
        });
    });

    document.querySelectorAll('thead th[data-col]').forEach(function (th) {
        th.addEventListener('click', function (event) {
            if (resizingState) return;
            if (Date.now() < suppressSortClickUntil) return;
            if (event.target.closest('.col-resizer')) return;
            const panel = th.closest('.tab-panel');
            const tbody = panel.querySelector('tbody');
            const all = Array.from(panel.querySelectorAll('thead th[data-col]'));
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
            updateTableSummary(panel);
            saveState();
        });
    });

    document.addEventListener('mousedown', function (event) {
        var handle = event.target.closest('.col-resizer');
        if (!handle) return;
        event.preventDefault();
        event.stopPropagation();
        var th = handle.closest('th[data-col]');
        var panel = th && th.closest('.tab-panel');
        if (!th || !panel) return;
        resizingState = {
            panel: panel,
            col: th.dataset.col,
            startX: event.clientX,
            startWidth: getColumnWidth(panel, th.dataset.col) || th.getBoundingClientRect().width
        };
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', function (event) {
        if (!resizingState) return;
        event.preventDefault();
        var nextWidth = resizingState.startWidth + (event.clientX - resizingState.startX);
        applyColumnWidth(resizingState.panel, resizingState.col, nextWidth);
    });

    document.addEventListener('mouseup', function () {
        if (!resizingState) return;
        var panel = resizingState.panel;
        var col = resizingState.col;
        var handle = panel.querySelector('.col-resizer[data-col-resizer="' + CSS.escape(col) + '"]');
        if (handle) handle.classList.remove('active');
        document.body.style.cursor = '';
        suppressSortClickUntil = Date.now() + 250;
        saveState();
        setStatus('Resized column "' + col + '".', 'success');
        resizingState = null;
    });

    document.addEventListener('dragstart', function (event) {
        if (event.target.closest('.col-resizer')) return;
        var th = event.target.closest('th[data-col]');
        if (!th) return;
        draggingHeader = th;
        dragAfter = false;
        th.classList.add('dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', th.dataset.col || '');
        }
    });

    document.addEventListener('dragover', function (event) {
        if (resizingState) return;
        var target = event.target.closest('th[data-col]');
        if (!draggingHeader || !target || target === draggingHeader) return;
        event.preventDefault();
        dragAfter = event.clientX > target.getBoundingClientRect().left + (target.offsetWidth / 2);
        document.querySelectorAll('th[data-col].drag-over, th[data-col].drag-over-after').forEach(function (th) {
            th.classList.remove('drag-over', 'drag-over-after');
        });
        target.classList.add(dragAfter ? 'drag-over-after' : 'drag-over');
    });

    document.addEventListener('dragleave', function (event) {
        var target = event.target.closest('th[data-col]');
        if (!target) return;
        target.classList.remove('drag-over', 'drag-over-after');
    });

    document.addEventListener('drop', function (event) {
        if (resizingState) return;
        var target = event.target.closest('th[data-col]');
        if (!draggingHeader || !target || target === draggingHeader) return;
        event.preventDefault();
        var panel = target.closest('.tab-panel');
        reorderColumns(panel, draggingHeader, target, dragAfter);
        saveState();
        setStatus('Moved column "' + draggingHeader.dataset.col + '".', 'success');
        updateTableSummary(panel);
        updateVisibleCount(panel);
        document.querySelectorAll('th[data-col].drag-over, th[data-col].drag-over-after').forEach(function (th) {
            th.classList.remove('drag-over', 'drag-over-after');
        });
    });

    document.addEventListener('dragend', function () {
        document.querySelectorAll('th[data-col].dragging, th[data-col].drag-over, th[data-col].drag-over-after').forEach(function (th) {
            th.classList.remove('dragging', 'drag-over', 'drag-over-after');
        });
        draggingHeader = null;
        dragAfter = false;
    });

    document.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            const panel = chip.closest('.tab-panel');
            panel.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            applyPanelView(panel);
            saveState();
        });
    });

    document.querySelectorAll('.tab-panel').forEach(function (panel) {
        applyPanelView(panel);
    });
}());
