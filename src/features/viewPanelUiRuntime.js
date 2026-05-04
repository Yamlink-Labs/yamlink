(function () {
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
                const menu = columnsBtn.closest('.filterbar')?.querySelector('.toolbar-menu');
                if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                return;
            }

            const removeFilterBtn = event.target.closest('[data-remove-filter]');
            if (removeFilterBtn) {
                const panel = removeFilterBtn.closest('.tab-panel');
                const filters = getColumnFilters(panel);
                delete filters[removeFilterBtn.dataset.removeFilter];
                setColumnFilters(panel, filters);
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

            if (!event.target.closest('.toolbar-menu')) {
                document.querySelectorAll('.toolbar-menu').forEach(menu => { menu.style.display = 'none'; });
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
            if (!event.target.matches('[data-col-toggle]')) return;
            const col = event.target.dataset.colToggle;
            const panel = event.target.closest('.tab-panel');
            const hide = !event.target.checked;
            panel.querySelectorAll(`[data-col="${CSS.escape(col)}"]`).forEach(el => el.classList.toggle('hidden-col', hide));
            panel.querySelectorAll(`tbody td:nth-child(${getColumnIndex(panel, col) + 1})`).forEach(el => el.classList.toggle('hidden-col', hide));
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
            applyPanelView(panel);
            saveState();
        }

        function handleSortClick(th, event) {
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
            applyPanelView(panel);
            saveState();
        }

        function attach() {
            document.addEventListener('click', handleClick);
            document.addEventListener('dblclick', handleDoubleClick);
            document.addEventListener('keydown', handleKeyDown);
            document.addEventListener('paste', handlePaste);
            document.addEventListener('change', handleChange);
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
            });
        }

        return {
            attach
        };
    }

    window.YamlinkViewPanelUiRuntime = {
        createViewPanelUiRuntime
    };
}());
