(function () {
    function createViewPanelEditRuntime(options) {
        const {
            vscode,
            state,
            selectCell,
            navigateCell,
            getVisibleHeaders,
            getVisibleColumnIndex,
            getEditableVisibleCells,
            requestViewUpdate,
            saveState,
            setColumnFilters,
            getColumnFilters,
            setStatus,
            renderCellValue,
            validateValue,
            normaliseOutgoingValue
        } = options;

        function queueHistory(edits) {
            if (!Array.isArray(edits) || edits.length === 0) return;
            state.historyStack.push({ edits });
            if (state.historyStack.length > 50) state.historyStack.shift();
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

        function getSelectedRowInfo() {
            if (!state.selectedCell) return null;
            var row = state.selectedCell.closest('tr');
            if (!row) return null;
            var idCell = row.querySelector('.cell-id[data-id]');
            if (!idCell) return null;
            return {
                row: row,
                id: idCell.dataset.id
            };
        }

        function getSelectedCellFilterValue(cell) {
            if (!cell) return null;
            var field = cell.dataset.field;
            if (!field) return null;
            var value = String(cell.dataset.value || cell.textContent || '').trim();
            if (!value) return null;
            return { field: field, value: value };
        }

        function applySelectionFilter(mode) {
            if (!state.selectedCell) {
                setStatus('Select a cell first to use it as a filter.', 'error');
                return;
            }
            var panel = state.selectedCell.closest('.tab-panel');
            var selection = getSelectedCellFilterValue(state.selectedCell);
            if (!panel || !selection) {
                setStatus('That cell cannot be used as a quick filter.', 'error');
                return;
            }
            var filters = getColumnFilters(panel);
            filters[selection.field] = { mode: mode, value: selection.value };
            setColumnFilters(panel, filters);
            requestViewUpdate(panel);
            saveState();
            setStatus((mode === 'exclude' ? 'Excluding' : 'Filtering by') + ' ' + selection.field + '.', 'success');
        }

        function clearQuickFilters(panel) {
            if (!panel) return;
            setColumnFilters(panel, {});
            requestViewUpdate(panel);
            saveState();
            setStatus('Cleared quick filters.', 'success');
        }

        function openSelectedReport() {
            var info = getSelectedRowInfo();
            if (!info || !info.id) {
                setStatus('Select an editable row first to open its note report.', 'error');
                return;
            }
            vscode.postMessage({ command: 'openReport', id: info.id });
        }

        function performUndo() {
            if (state.editingCell || state.pendingSingle.size > 0 || state.pendingBulk.size > 0) return;
            const op = state.historyStack.pop();
            if (!op || !op.edits || op.edits.length === 0) {
                setStatus('Nothing to undo.', 'error');
                return;
            }

            const reverseEdits = [];
            op.edits.forEach(function (edit) {
                const cell = findCellForEdit(edit);
                if (!cell) return;
                const requestId = String(++state.requestCounter);
                const previous = String(cell.dataset.value || '').trim();
                const next = edit.previous;
                const panelTab = cell.closest('.tab-panel')?.dataset.tab || edit.panelTab || null;
                cell.dataset.pendingRequestId = requestId;
                cell.dataset.value = next;
                cell.innerHTML = renderCellValue(cell.dataset.editMode || 'text', next);
                state.pendingBulk.set(requestId, {
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
            if (state.editingCell) finishEdit(state.editingCell, true);
            selectCell(cell);
            state.editingCell = cell;
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
            if (state.editingCell !== cell) return;
            state.editingCell = null;
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

            const requestId = String(++state.requestCounter);
            cell.dataset.pendingRequestId = requestId;
            cell.dataset.value = next;
            cell.innerHTML = renderCellValue(mode, next);
            state.pendingSingle.set(requestId, {
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

                    const requestId = String(++state.requestCounter);
                    targetCell.dataset.pendingRequestId = requestId;
                    targetCell.dataset.value = next;
                    targetCell.innerHTML = renderCellValue(targetCell.dataset.editMode || 'text', next);
                    edits.push({
                        requestId,
                        filePath: targetCell.dataset.filepath,
                        field: targetCell.dataset.field,
                        value: normaliseOutgoingValue(targetCell.dataset.editMode || 'text', next)
                    });
                    state.pendingBulk.set(requestId, {
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
            if (state.editingCell || state.pendingSingle.size > 0 || state.pendingBulk.size > 0) return;
            if (!filePath || !row) return;

            var fieldOriginal = new Map();
            var affectedEntries = state.historyStack.filter(function (entry) {
                return entry.edits.some(function (e) { return e.filePath === filePath; });
            });

            if (affectedEntries.length === 0) {
                setStatus('No changes to revert for this row.', 'error');
                return;
            }

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
                var requestId = String(++state.requestCounter);
                var panelTab = row.closest('.tab-panel')?.dataset.tab || null;
                cell.dataset.pendingRequestId = requestId;
                cell.dataset.value = revertTo;
                cell.innerHTML = renderCellValue(cell.dataset.editMode || 'text', revertTo);
                state.pendingBulk.set(requestId, {
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

            for (var hi = state.historyStack.length - 1; hi >= 0; hi--) {
                if (state.historyStack[hi].edits.some(function (e) { return e.filePath === filePath; })) {
                    state.historyStack.splice(hi, 1);
                }
            }

            setStatus('Reverting ' + edits.length + ' change' + (edits.length === 1 ? '' : 's') + '...');
            sendBulkEdits(edits, 'revert');
        }

        function handleEditResult(msg) {
            const pending = state.pendingSingle.get(msg.requestId);
            if (!pending) return;
            state.pendingSingle.delete(msg.requestId);
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

        function handleBulkEditResult(msg) {
            const results = Array.isArray(msg.results) ? msg.results : [];
            const successfulEdits = [];
            let successCount = 0;
            let failedCount = 0;
            results.forEach(function (result) {
                const pending = state.pendingBulk.get(result.requestId);
                if (!pending) return;
                state.pendingBulk.delete(result.requestId);
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

        return {
            applySelectionFilter,
            clearQuickFilters,
            openSelectedReport,
            performUndo,
            startEdit,
            finishEdit,
            commitEdit,
            applyBulkPaste,
            revertRow,
            handleEditResult,
            handleBulkEditResult
        };
    }

    window.YamlinkViewPanelEditRuntime = {
        createViewPanelEditRuntime
    };
}());
