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
        resetPanelState,
        saveState,
        setColumnFilters,
        selectCell,
        setStatus,
        switchTab,
        updateTableSummary,
        updateVisibleCount,
        getColumnFilters
    } = viewRuntime;

    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        btn.addEventListener('click', function () { switchTab(i); });
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
        setStatus,
        startEdit,
        updateTableSummary,
        updateVisibleCount,
        getColumnFilters,
        applySelectionFilter,
        clearQuickFilters,
        revertRow,
        handleEditResult,
        handleBulkEditResult,
        applyBulkPaste
    });

    uiRuntime.attach();
}());
