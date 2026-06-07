(function () {
    const vscode = acquireVsCodeApi();
    const valueRuntime = window.YamlinkViewPanelValueRuntime;
    const editRuntimeFactory = window.YamlinkViewPanelEditRuntime;
    const uiRuntimeFactory = window.YamlinkViewPanelUiRuntime;
    const tableState = {
        editingCell: null,
        selectedCell: null,
        requestCounter: 0,
        pendingSingle: new Map(),
        pendingBulk: new Map(),
        historyStack: []
    };
    let statusTimer = null;
    const DEFAULT_STATUS_MESSAGE = 'Double-click to edit, use selected cells for quick filters, open reports from the table, paste from spreadsheets, Ctrl/Cmd+Z to undo.';

    (function ensureStatusSurface() {
        const bar = document.querySelector('.live-bar');
        if (!bar) return;
        if (!document.getElementById('table-status')) {
            bar.innerHTML = `<span id="table-status" class="live-status" role="status" aria-live="polite">${DEFAULT_STATUS_MESSAGE}</span><span>Click relation pills to open</span>`;
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

    const {
        normaliseDateInput,
        normaliseOutgoingValue,
        renderCellValue,
        validateValue
    } = valueRuntime;

    const viewRuntime = window.YamlinkViewPanelStateRuntime.createViewPanelStateRuntime({
        vscode,
        getStatusDefaultMessage,
        getSelectedCell: function () { return tableState.selectedCell; },
        setSelectedCell: function (cell) { tableState.selectedCell = cell; },
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
        getEditableVisibleCells,
        getSortValue,
        getVisibleColumnIndex,
        getVisibleHeaders,
        moveColumn,
        navigateCell,
        reorderColumns,
        requestViewUpdate,
        resetPanelState,
        saveState,
        setColumnFilters,
        setCurrentPage,
        setPageSize,
        selectCell,
        setStatus,
        switchTab,
        updateTableSummary,
        updateVisibleCount,
        getColumnFilters,
        renderPagination,
        setColumnFilterValues
    } = viewRuntime;

    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        btn.addEventListener('click', function () { switchTab(i); });
        btn.addEventListener('keydown', function (event) {
            const buttons = Array.from(document.querySelectorAll('.tab-btn'));
            const currentIndex = buttons.indexOf(btn);
            if (currentIndex === -1) return;
            let nextIndex = currentIndex;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
            else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = buttons.length - 1;
            else return;
            event.preventDefault();
            switchTab(nextIndex);
            buttons[nextIndex].focus();
        });
    });

    const editRuntime = editRuntimeFactory.createViewPanelEditRuntime({
        vscode,
        state: tableState,
        selectCell,
        navigateCell,
        getVisibleHeaders,
        getVisibleColumnIndex,
        getEditableVisibleCells,
        applyPanelView,
        requestViewUpdate,
        saveState,
        setColumnFilters,
        getColumnFilters,
        setStatus,
        renderCellValue,
        validateValue,
        normaliseOutgoingValue
    });

    const {
        applySelectionFilter,
        clearQuickFilters,
        openSelectedReport,
        performUndo,
        startEdit,
        commitEdit,
        applyBulkPaste,
        revertRow,
        handleEditResult,
        handleBulkEditResult
    } = editRuntime;

    const uiRuntime = uiRuntimeFactory.createViewPanelUiRuntime({
        vscode,
        state: tableState,
        applyColumnWidth,
        applyPanelView,
        requestViewUpdate,
        clearSelection,
        commitEdit,
        getColumnIndex,
        getColumnWidth,
        getSortValue,
        openSelectedReport,
        moveColumn,
        performUndo,
        reorderColumns,
        resetPanelState,
        saveState,
        selectCell,
        setColumnFilters,
        setCurrentPage,
        setPageSize,
        setStatus,
        startEdit,
        updateTableSummary,
        updateVisibleCount,
        getColumnFilters,
        renderPagination,
        applySelectionFilter,
        clearQuickFilters,
        revertRow,
        handleEditResult,
        handleBulkEditResult,
        applyBulkPaste,
        setColumnFilterValues
    });

    uiRuntime.attach();

    // Matrix layout toggle and column type picker
    document.addEventListener('click', function (e) {
        const layoutBtn = e.target.closest('[data-layout-btn]');
        if (layoutBtn) {
            const newLayout = layoutBtn.dataset.layoutBtn;
            const panel = layoutBtn.closest('.tab-panel');
            if (!panel) return;
            panel.dataset.layout = newLayout;
            if (newLayout === 'table') panel.dataset.matrixColType = '';
            vscode.postMessage({ command: 'requestRerender', state: viewRuntime.getState() });
            return;
        }
        const rowHead = e.target.closest('.matrix-row-head');
        if (rowHead) { vscode.postMessage({ command: 'openNode', id: rowHead.dataset.id }); return; }
        const colHead = e.target.closest('.matrix-col-head');
        if (colHead) { vscode.postMessage({ command: 'openNode', id: colHead.dataset.id }); return; }
        const cell = e.target.closest('.matrix-cell.linked');
        if (cell) { vscode.postMessage({ command: 'openNode', id: cell.dataset.col }); return; }
    });

    document.addEventListener('change', function (e) {
        const sel = e.target.closest('[data-matrix-col-select]');
        if (sel) {
            const panel = sel.closest('.tab-panel');
            if (!panel) return;
            panel.dataset.matrixColType = sel.value;
            vscode.postMessage({ command: 'requestRerender', state: viewRuntime.getState() });
        }
    });
}());
