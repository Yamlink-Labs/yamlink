(function () {
    function computeNextSortState(currentSort, fieldName) {
        var activeField = currentSort && (currentSort.field || currentSort.col);
        var activeDirection = currentSort && (currentSort.direction || (currentSort.asc === false ? 'desc' : 'asc'));
        if (activeField === fieldName) {
            return { field: fieldName, direction: activeDirection === 'desc' ? 'asc' : 'desc' };
        }
        return { field: fieldName, direction: 'asc' };
    }

    function createViewPanelUiRuntime(options) {
        const {
            vscode,
            state,
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
        } = options;

        let draggingHeader = null;
        let dragAfter = false;
        let resizingState = null;
        let suppressSortClickUntil = 0;

        function handleClick(event) {
            const revertBtn = event.target.closest('.revert-row-btn');
            if (revertBtn) {
                revertRow(revertBtn.closest('tr'));
                return;
            }

            const taskDoneCell = event.target.closest('.cell-task-done');
            if (taskDoneCell) {
                const isDone = taskDoneCell.dataset.value === 'true';
                const newDone = !isDone;
                taskDoneCell.dataset.value = newDone ? 'true' : 'false';
                const span = taskDoneCell.querySelector('.cell-bool');
                if (span) {
                    span.className = 'cell-bool ' + (newDone ? 'true' : 'false');
                    span.textContent = newDone ? 'True' : 'False';
                }
                vscode.postMessage({
                    command: 'toggleTaskDone',
                    filePath: taskDoneCell.dataset.filepath,
                    line: parseInt(taskDoneCell.dataset.line, 10),
                    newDone
                });
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

            const filterBtn = event.target.closest('.filter-selection-btn');
            if (filterBtn) {
                applySelectionFilter('include');
                return;
            }

            const excludeBtn = event.target.closest('.exclude-selection-btn');
            if (excludeBtn) {
                applySelectionFilter('exclude');
                return;
            }

            const clearFiltersBtn = event.target.closest('.clear-column-filters-btn');
            if (clearFiltersBtn) {
                clearQuickFilters(clearFiltersBtn.closest('.tab-panel'));
                return;
            }

            const reportBtn = event.target.closest('.report-btn');
            if (reportBtn) {
                openSelectedReport();
                return;
            }

            const columnsBtn = event.target.closest('.columns-btn');
            if (columnsBtn) {
                const menu = columnsBtn.closest('.toolbar-group, .filterbar')?.querySelector('.toolbar-menu');
                if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                return;
            }

            const columnsFocusBtn = event.target.closest('[data-columns-focus]');
            if (columnsFocusBtn) {
                const group = columnsFocusBtn.closest('.toolbar-group, .quick-fields-card');
                const panel = columnsFocusBtn.closest('.tab-panel');
                const menu = (group && group.querySelector('.toolbar-menu')) || (panel && panel.querySelector('.toolbar-menu'));
                if (menu) menu.style.display = 'block';
                return;
            }

            const quickFieldBtn = event.target.closest('[data-quick-field]');
            if (quickFieldBtn) {
                event.stopPropagation();
                const panel = quickFieldBtn.closest('.tab-panel');
                const field = quickFieldBtn.dataset.quickField;
                if (!panel || !field) return;
                const filterButton = panel.querySelector('[data-col-filter-toggle="' + CSS.escape(field) + '"]');
                const headerCell = panel.querySelector('thead th[data-col="' + CSS.escape(field) + '"]');
                if (headerCell) {
                    headerCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
                if (filterButton) {
                    filterButton.click();
                }
                return;
            }

            const removeFilterBtn = event.target.closest('[data-remove-filter]');
            if (removeFilterBtn) {
                const panel = removeFilterBtn.closest('.tab-panel');
                const filters = setColumnFilterValues(getColumnFilters(panel), removeFilterBtn.dataset.removeFilter, []);
                setColumnFilters(panel, filters);
                applyPanelView(panel);
                saveState();
                return;
            }

            const filterToggleBtn = event.target.closest('[data-col-filter-toggle]');
            if (filterToggleBtn) {
                event.stopPropagation();
                const col = filterToggleBtn.dataset.colFilterToggle;
                const th = filterToggleBtn.closest('th[data-col]');
                if (!th) return;
                const menu = th.querySelector('[data-col-filter-menu="' + CSS.escape(col) + '"]');
                document.querySelectorAll('.th-filter-menu.open').forEach(function (entry) {
                    if (entry !== menu) entry.classList.remove('open');
                });
                document.querySelectorAll('.th-filter-btn.active').forEach(function (entry) {
                    if (entry !== filterToggleBtn) entry.classList.remove('active');
                });
                if (menu) menu.classList.toggle('open');
                filterToggleBtn.classList.toggle('active', !!menu && menu.classList.contains('open'));
                return;
            }

            const filterClearBtn = event.target.closest('[data-col-filter-clear]');
            if (filterClearBtn) {
                event.stopPropagation();
                const panel = filterClearBtn.closest('.tab-panel');
                const nextFilters = setColumnFilterValues(getColumnFilters(panel), filterClearBtn.dataset.colFilterClear, []);
                setColumnFilters(panel, nextFilters);
                applyPanelView(panel);
                saveState();
                return;
            }

            const moveBtn = event.target.closest('.col-move');
            if (moveBtn && !moveBtn.disabled) {
                const panel = moveBtn.closest('.tab-panel');
                moveColumn(panel, moveBtn.dataset.col, moveBtn.dataset.colMove === 'left' ? -1 : 1);
                saveState();
                return;
            }

            const pageNavBtn = event.target.closest('[data-page-nav]');
            if (pageNavBtn) {
                const panel = pageNavBtn.closest('.tab-panel');
                const currentPage = Number(panel.dataset.currentPage || 1);
                setCurrentPage(panel, currentPage + (pageNavBtn.dataset.pageNav === 'next' ? 1 : -1));
                applyPanelView(panel);
                saveState();
                return;
            }

            if (!event.target.closest('.toolbar-menu') && !event.target.closest('[data-columns-focus]')) {
                document.querySelectorAll('.toolbar-menu').forEach(menu => { menu.style.display = 'none'; });
            }
            if (!event.target.closest('.th-filter-menu') && !event.target.closest('[data-col-filter-toggle]')) {
                document.querySelectorAll('.th-filter-menu.open').forEach(function (menu) { menu.classList.remove('open'); });
                document.querySelectorAll('.th-filter-btn.active').forEach(function (button) { button.classList.remove('active'); });
            }

            const editableCell = event.target.closest('.cell-editable');
            if (editableCell) {
                if ((editableCell.dataset.editMode || 'text') === 'boolean' && state.selectedCell === editableCell) {
                    const current = (editableCell.dataset.value || '').toLowerCase() === 'true';
                    commitEdit(editableCell, current ? 'false' : 'true');
                    return;
                }
                selectCell(editableCell);
                return;
            }

            clearSelection();
        }

        function handleDoubleClick(event) {
            if (event.target.closest('.col-resizer')) return;
            const cell = event.target.closest('.cell-editable');
            if (!cell) return;
            if ((cell.dataset.editMode || 'text') === 'boolean') return;
            startEdit(cell);
        }

        function handleKeyDown(event) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                const activeTag = document.activeElement && document.activeElement.tagName;
                if (!state.editingCell && activeTag !== 'INPUT' && activeTag !== 'SELECT' && activeTag !== 'TEXTAREA') {
                    event.preventDefault();
                    performUndo();
                    return;
                }
            }

            if (!state.selectedCell || state.editingCell) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
            if (event.key === 'Enter') {
                event.preventDefault();
                if ((state.selectedCell.dataset.editMode || 'text') === 'boolean') {
                    const current = (state.selectedCell.dataset.value || '').toLowerCase() === 'true';
                    commitEdit(state.selectedCell, current ? 'false' : 'true');
                } else {
                    startEdit(state.selectedCell);
                }
            }
        }

        function handlePaste(event) {
            if (!state.selectedCell || state.editingCell) return;
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
            applyBulkPaste(state.selectedCell, matrix);
        }

        function handleChange(event) {
            if (event.target.matches('[data-page-size]')) {
                const panel = event.target.closest('.tab-panel');
                setPageSize(panel, event.target.value);
                applyPanelView(panel);
                saveState();
                setStatus('Updated rows per page.', 'success');
                return;
            }

            if (!event.target.matches('[data-col-toggle]')) return;
            const col = event.target.dataset.colToggle;
            const panel = event.target.closest('.tab-panel');
            const hide = !event.target.checked;
            panel.querySelectorAll(`[data-col="${CSS.escape(col)}"]`).forEach(el => el.classList.toggle('hidden-col', hide));
            panel.querySelectorAll(`tbody td:nth-child(${getColumnIndex(panel, col) + 1})`).forEach(el => el.classList.toggle('hidden-col', hide));
            saveState();
        }

        function handleFilterCheckboxChange(event) {
            if (!event.target.matches('[data-col-filter-value]')) return;
            const panel = event.target.closest('.tab-panel');
            const col = event.target.dataset.colFilterValue;
            const values = Array.from(panel.querySelectorAll('[data-col-filter-value="' + CSS.escape(col) + '"]:checked'))
                .map(function (input) { return input.value; });
            const nextFilters = setColumnFilterValues(getColumnFilters(panel), col, values);
            setColumnFilters(panel, nextFilters);
            setCurrentPage(panel, 1);
            applyPanelView(panel);
            saveState();
        }

        function handleMessage(event) {
            const msg = event.data || {};
            if (msg.command === 'editResult') {
                handleEditResult(msg);
            }
            if (msg.command === 'bulkEditResult') {
                handleBulkEditResult(msg);
            }
        }

        function handleSearchInput(event) {
            const panel = event.target.closest('.tab-panel');
            setCurrentPage(panel, 1);
            applyPanelView(panel);
            saveState();
        }

        function handleSortClick(th, event) {
            if (resizingState) return;
            if (Date.now() < suppressSortClickUntil) return;
            if (event.target.closest('.col-resizer')) return;
            if (event.target.closest('.th-filter-btn') || event.target.closest('.th-filter-menu')) return;
            const panel = th.closest('.tab-panel');
            const tbody = panel.querySelector('tbody');
            const all = Array.from(panel.querySelectorAll('thead th[data-col]'));
            const index = all.indexOf(th);
            const kind = th.dataset.kind || 'text';
            const nextSort = computeNextSortState(
                th.classList.contains('sorted')
                    ? { field: th.dataset.col, direction: th.dataset.asc === 'false' ? 'desc' : 'asc' }
                    : (panel.dataset.sortState ? JSON.parse(panel.dataset.sortState) : null),
                th.dataset.col
            );
            const asc = nextSort.direction === 'asc';
            all.forEach(el => {
                el.classList.remove('sorted');
                delete el.dataset.asc;
            });
            th.classList.add('sorted');
            th.dataset.asc = asc ? 'true' : 'false';
            panel.dataset.sortState = JSON.stringify(nextSort);
            Array.from(tbody.querySelectorAll('tr'))
                .sort(function (a, b) {
                    const av = getSortValue(kind, (a.children[index] && (a.children[index].dataset.sortValue || a.children[index].textContent)) || '');
                    const bv = getSortValue(kind, (b.children[index] && (b.children[index].dataset.sortValue || b.children[index].textContent)) || '');
                    if (typeof av === 'number' || typeof bv === 'number') {
                        return asc ? av - bv : bv - av;
                    }
                    return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
                })
                .forEach(tr => tbody.appendChild(tr));
            updateTableSummary(panel);
            saveState();
        }

        function handleMouseDown(event) {
            const handle = event.target.closest('.col-resizer');
            if (!handle) return;
            event.preventDefault();
            event.stopPropagation();
            const th = handle.closest('th[data-col]');
            const panel = th && th.closest('.tab-panel');
            if (!th || !panel) return;
            resizingState = {
                panel,
                col: th.dataset.col,
                startX: event.clientX,
                startWidth: getColumnWidth(panel, th.dataset.col) || th.getBoundingClientRect().width
            };
            handle.classList.add('active');
            document.body.style.cursor = 'col-resize';
        }

        function handleMouseMove(event) {
            if (!resizingState) return;
            event.preventDefault();
            const nextWidth = resizingState.startWidth + (event.clientX - resizingState.startX);
            applyColumnWidth(resizingState.panel, resizingState.col, nextWidth);
        }

        function handleMouseUp() {
            if (!resizingState) return;
            const panel = resizingState.panel;
            const col = resizingState.col;
            const handle = panel.querySelector('.col-resizer[data-col-resizer="' + CSS.escape(col) + '"]');
            if (handle) handle.classList.remove('active');
            document.body.style.cursor = '';
            suppressSortClickUntil = Date.now() + 250;
            saveState();
            setStatus('Resized column "' + col + '".', 'success');
            resizingState = null;
        }

        function handleDragStart(event) {
            if (event.target.closest('.col-resizer')) return;
            const th = event.target.closest('th[data-col]');
            if (!th) return;
            draggingHeader = th;
            dragAfter = false;
            th.classList.add('dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', th.dataset.col || '');
            }
        }

        function handleDragOver(event) {
            if (resizingState) return;
            const target = event.target.closest('th[data-col]');
            if (!draggingHeader || !target || target === draggingHeader) return;
            event.preventDefault();
            dragAfter = event.clientX > target.getBoundingClientRect().left + (target.offsetWidth / 2);
            document.querySelectorAll('th[data-col].drag-over, th[data-col].drag-over-after').forEach(function (header) {
                header.classList.remove('drag-over', 'drag-over-after');
            });
            target.classList.add(dragAfter ? 'drag-over-after' : 'drag-over');
        }

        function handleDragLeave(event) {
            const target = event.target.closest('th[data-col]');
            if (!target) return;
            target.classList.remove('drag-over', 'drag-over-after');
        }

        function handleDrop(event) {
            if (resizingState) return;
            const target = event.target.closest('th[data-col]');
            if (!draggingHeader || !target || target === draggingHeader) return;
            event.preventDefault();
            const panel = target.closest('.tab-panel');
            reorderColumns(panel, draggingHeader, target, dragAfter);
            saveState();
            setStatus('Moved column "' + draggingHeader.dataset.col + '".', 'success');
            updateTableSummary(panel);
            updateVisibleCount(panel);
            document.querySelectorAll('th[data-col].drag-over, th[data-col].drag-over-after').forEach(function (header) {
                header.classList.remove('drag-over', 'drag-over-after');
            });
        }

        function handleDragEnd() {
            document.querySelectorAll('th[data-col].dragging, th[data-col].drag-over, th[data-col].drag-over-after').forEach(function (header) {
                header.classList.remove('dragging', 'drag-over', 'drag-over-after');
            });
            draggingHeader = null;
            dragAfter = false;
        }

        function handleChipClick(chip) {
            const panel = chip.closest('.tab-panel');
            panel.querySelectorAll('.chip').forEach(entry => entry.classList.remove('active'));
            chip.classList.add('active');
            setCurrentPage(panel, 1);
            applyPanelView(panel);
            saveState();
        }

        function attach() {
            document.addEventListener('click', handleClick);
            document.addEventListener('dblclick', handleDoubleClick);
            document.addEventListener('keydown', handleKeyDown);
            document.addEventListener('paste', handlePaste);
            document.addEventListener('change', handleChange);
            document.addEventListener('change', handleFilterCheckboxChange);
            document.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('dragstart', handleDragStart);
            document.addEventListener('dragover', handleDragOver);
            document.addEventListener('dragleave', handleDragLeave);
            document.addEventListener('drop', handleDrop);
            document.addEventListener('dragend', handleDragEnd);
            window.addEventListener('message', handleMessage);

            document.querySelectorAll('.fsearch').forEach(function (search) {
                search.addEventListener('input', handleSearchInput);
            });

            document.querySelectorAll('thead th[data-col]').forEach(function (th) {
                th.addEventListener('click', function (event) {
                    handleSortClick(th, event);
                });
            });

            document.querySelectorAll('.chip').forEach(function (chip) {
                chip.addEventListener('click', function () {
                    handleChipClick(chip);
                });
            });

            document.querySelectorAll('.tab-panel').forEach(function (panel) {
                applyPanelView(panel);
                renderPagination(panel, Number(panel.dataset.filteredRows || 0));
            });
        }

        return {
            attach
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            computeNextSortState
        };
    }

    if (typeof window !== 'undefined') {
        window.YamlinkViewPanelUiRuntime = {
            createViewPanelUiRuntime
        };
    }
}());
