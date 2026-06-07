'use strict';

(function () {
    function normaliseColumnFilters(filters) {
        var source = filters && typeof filters === 'object' ? filters : {};
        var normalised = {};
        Object.entries(source).forEach(function (entry) {
            var col = entry[0];
            var raw = entry[1];
            if (!col || raw == null) return;

            if (Array.isArray(raw)) {
                var valuesFromArray = raw.map(function (value) {
                    return String(value || '').trim();
                }).filter(Boolean);
                if (valuesFromArray.length) {
                    normalised[col] = { mode: 'include', values: valuesFromArray };
                }
                return;
            }

            if (typeof raw !== 'object') return;

            if (Array.isArray(raw.values)) {
                var values = raw.values.map(function (value) {
                    return String(value || '').trim();
                }).filter(Boolean);
                if (values.length) {
                    normalised[col] = {
                        mode: raw.mode === 'exclude' ? 'exclude' : 'include',
                        values: values
                    };
                }
                return;
            }

            if (typeof raw.value === 'string' && raw.value.trim()) {
                normalised[col] = {
                    mode: raw.mode === 'exclude' ? 'exclude' : 'include',
                    values: [raw.value.trim()]
                };
            }
        });
        return normalised;
    }

    function serialiseColumnFilters(filters) {
        var normalised = normaliseColumnFilters(filters);
        var serialised = {};
        Object.entries(normalised).forEach(function (entry) {
            serialised[entry[0]] = {
                mode: entry[1].mode,
                values: entry[1].values.slice()
            };
        });
        return serialised;
    }

    function setColumnFilterValues(filters, fieldName, values, options) {
        var next = normaliseColumnFilters(filters);
        var cleanValues = (Array.isArray(values) ? values : [])
            .map(function (value) { return String(value || '').trim(); })
            .filter(Boolean);
        if (!fieldName) return next;
        if (!cleanValues.length) {
            delete next[fieldName];
            return next;
        }
        next[fieldName] = {
            mode: options && options.mode === 'exclude' ? 'exclude' : 'include',
            values: Array.from(new Set(cleanValues))
        };
        return next;
    }

    function computeNextSortState(currentSort, fieldName) {
        var activeField = currentSort && (currentSort.field || currentSort.col);
        var activeDirection = currentSort && (currentSort.direction || (currentSort.asc === false ? 'desc' : 'asc'));
        if (activeField === fieldName) {
            return {
                field: fieldName,
                direction: activeDirection === 'desc' ? 'asc' : 'desc'
            };
        }
        return {
            field: fieldName,
            direction: 'asc'
        };
    }

    function getCellFilterValue(cell) {
        return String((cell && cell.dataset && cell.dataset.filterValue) || (cell && cell.dataset && cell.dataset.value) || (cell && cell.textContent) || '')
            .trim()
            .toLowerCase();
    }

    function rowMatchesColumnFilters(row, columnFilters, getColumnIndex) {
        return Object.entries(normaliseColumnFilters(columnFilters)).every(function (entry) {
            var col = entry[0];
            var filterRule = entry[1] || {};
            var index = getColumnIndex(col);
            if (index < 0) return true;
            var cell = row.children[index];
            var cellValue = getCellFilterValue(cell);
            var selected = new Set((filterRule.values || []).map(function (value) {
                return String(value || '').trim().toLowerCase();
            }).filter(Boolean));
            if (!selected.size) return true;
            return filterRule.mode === 'exclude'
                ? !selected.has(cellValue)
                : selected.has(cellValue);
        });
    }

    function createViewPanelStateRuntime(options) {
        const {
            vscode,
            getStatusDefaultMessage,
            getSelectedCell,
            setSelectedCell,
            clearStatusTimer,
            setStatusTimer,
            normaliseDateInput
        } = options;

        function getState() {
            const tabs = [];
            document.querySelectorAll('.tab-panel').forEach(function (panel) {
                const search = panel.querySelector('.fsearch');
                const hiddenCols = Array.from(panel.querySelectorAll('[data-col-toggle]'))
                    .filter(input => !input.checked)
                    .map(input => input.dataset.colToggle);
                const columnOrder = Array.from(panel.querySelectorAll('thead th[data-col]')).map(th => th.dataset.col);
                const columnWidths = {};
                panel.querySelectorAll('col[data-col]').forEach(function (col) {
                    var width = parseInt(col.style.width, 10);
                    if (Number.isFinite(width) && width >= 120) {
                        columnWidths[col.dataset.col] = width;
                    }
                });
                const sorted = panel.querySelector('thead th.sorted');
                tabs.push({
                    search: search ? search.value : '',
                    filter: (() => {
                        const activeChip = panel.querySelector('.chip.active');
                        return activeChip ? activeChip.dataset.filter : 'all';
                    })(),
                    columnFilters: (() => {
                        try { return serialiseColumnFilters(JSON.parse(panel.dataset.columnFilters || '{}')); } catch (_) { return {}; }
                    })(),
                    page: Math.max(1, Number(panel.dataset.currentPage || 1)),
                    pageSize: Math.max(0, Number(panel.dataset.pageSize || 50)),
                    hiddenCols,
                    columnOrder,
                    columnWidths,
                    sort: sorted ? {
                        field: sorted.dataset.col,
                        direction: sorted.dataset.asc === 'false' ? 'desc' : 'asc'
                    } : null,
                    layout: panel.dataset.layout || 'table',
                    matrixColType: panel.dataset.matrixColType || ''
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
            clearStatusTimer();
            if (tone) {
                setStatusTimer(setTimeout(function () {
                    target.textContent = getStatusDefaultMessage();
                    target.className = 'live-status';
                }, 2600));
            }
        }

        function getActiveFilter(panel) {
            var chip = panel.querySelector('.chip.active');
            return chip ? chip.dataset.filter : 'all';
        }

        function getActiveSort(panel) {
            return panel.querySelector('thead th.sorted');
        }

        function getColumnFilters(panel) {
            try { return normaliseColumnFilters(JSON.parse(panel.dataset.columnFilters || '{}')); } catch (_) { return {}; }
        }

        function setColumnFilters(panel, filters) {
            panel.dataset.columnFilters = JSON.stringify(serialiseColumnFilters(filters || {}));
        }

        function renderColumnFilters(panel) {
            var host = panel.querySelector('.table-filters');
            if (!host) return;
            var filters = getColumnFilters(panel);
            var entries = Object.entries(filters);
            if (!entries.length) {
                host.innerHTML = '';
                host.style.display = 'none';
                return;
            }
            host.innerHTML = entries.map(function (entry) {
                var col = entry[0];
                var filter = entry[1] || {};
                var label = filter.mode === 'exclude' ? 'not' : 'in';
                var values = Array.isArray(filter.values) ? filter.values : [];
                return '<span class="filter-pill">' +
                    '<span class="filter-pill-label">' + col + '</span>' +
                    '<span>' + label + ' ' + values.map(function (value) { return '"' + String(value || '') + '"'; }).join(', ') + '</span>' +
                    '<button type="button" data-remove-filter="' + col + '" aria-label="Remove filter">×</button>' +
                    '</span>';
            }).join('');
            host.style.display = 'flex';
        }

        function updateVisibleCount(panel) {
            var count = panel.querySelector('.fcount');
            if (!count) return;
            var total = Number(count.dataset.totalRows || 0);
            var visible = Array.from(panel.querySelectorAll('tbody tr')).filter(function (row) {
                return row.children.length > 1 && row.style.display !== 'none';
            }).length;
            var filtered = Number(panel.dataset.filteredRows || visible);
            if (filtered === total && visible === total) {
                count.innerHTML = `<strong>${total}</strong> rows`;
            } else if (filtered === total) {
                count.innerHTML = `<strong>${visible}</strong> of ${total} rows`;
            } else {
                count.innerHTML = `<strong>${visible}</strong> of ${filtered} matching rows`;
            }
            var empty = panel.querySelector('.no-visible-state');
            if (empty) empty.style.display = total > 0 && filtered === 0 ? 'block' : 'none';
        }

        function updateTableSummary(panel) {
            var summary = panel.querySelector('.table-summary');
            if (!summary) return;
            var parts = [];
            var filter = getActiveFilter(panel);
            var sorted = getActiveSort(panel);
            var search = panel.querySelector('.fsearch');
            if (filter && filter !== 'all') {
                parts.push('Filtered to ' + filter.slice(5));
            }
            if (search && search.value.trim()) {
                parts.push('Search: "' + search.value.trim() + '"');
            }
            var columnFilters = getColumnFilters(panel);
            var filterEntries = Object.entries(columnFilters);
            if (filterEntries.length) {
                parts.push(filterEntries.map(function (entry) {
                    var filter = entry[1] || {};
                    var values = Array.isArray(filter.values) ? filter.values : [];
                    return entry[0] + ' ' + (filter.mode === 'exclude' ? 'is not' : 'in') + ' ' + values.map(function (value) {
                        return '"' + String(value || '') + '"';
                    }).join(', ');
                }).join(' | '));
            }
            if (sorted) {
                parts.push('Sorted by ' + sorted.dataset.col + ' ' + (sorted.dataset.asc === 'true' ? 'asc' : 'desc'));
            }
            var pageSize = Math.max(0, Number(panel.dataset.pageSize || 50));
            var currentPage = Math.max(1, Number(panel.dataset.currentPage || 1));
            var filtered = Number(panel.dataset.filteredRows || 0);
            if (pageSize > 0 && filtered > pageSize) {
                var totalPages = Math.max(1, Math.ceil(filtered / pageSize));
                parts.push('Page ' + currentPage + ' of ' + totalPages);
            }
            summary.textContent = parts.join(' | ');
            summary.style.display = parts.length ? 'block' : 'none';
        }

        function renderPagination(panel, filteredRows) {
            var host = panel.querySelector('.table-pagination');
            if (!host) return;
            var pageSize = Math.max(0, Number(panel.dataset.pageSize || 50));
            var currentPage = Math.max(1, Number(panel.dataset.currentPage || 1));
            var filtered = Math.max(0, Number(filteredRows || 0));
            var totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered / pageSize));
            if (currentPage > totalPages) {
                currentPage = totalPages;
                panel.dataset.currentPage = String(currentPage);
            }
            var status = host.querySelector('.table-pagination-status');
            if (status) {
                status.textContent = pageSize === 0
                    ? 'Showing all matching rows'
                    : 'Page ' + currentPage + ' of ' + totalPages;
            }
            var prev = host.querySelector('[data-page-nav="prev"]');
            var next = host.querySelector('[data-page-nav="next"]');
            if (prev) prev.disabled = currentPage <= 1 || pageSize === 0 || filtered === 0;
            if (next) next.disabled = currentPage >= totalPages || pageSize === 0 || filtered === 0;
            var select = host.querySelector('[data-page-size]');
            if (select) select.value = String(pageSize);
            host.hidden = pageSize === 0 ? filtered === 0 : filtered <= pageSize;
        }

        function setCurrentPage(panel, nextPage) {
            var pageSize = Math.max(0, Number(panel.dataset.pageSize || 25));
            var filtered = Math.max(0, Number(panel.dataset.filteredRows || 0));
            var totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered / pageSize));
            var safePage = Math.max(1, Math.min(Number(nextPage || 1), totalPages));
            panel.dataset.currentPage = String(safePage);
        }

        function setPageSize(panel, nextSize) {
            var safeSize = Math.max(0, Number(nextSize || 50));
            panel.dataset.pageSize = String(safeSize);
            panel.dataset.currentPage = '1';
        }

        function requestRerender() {
            vscode.postMessage({ command: 'requestRerender', state: getState() });
        }

        function requestViewUpdate(panel) {
            if (panel && panel.dataset.largeResult === 'true') {
                requestRerender();
            } else {
                applyPanelView(panel);
            }
        }

        function applyPanelView(panel) {
            if (panel && panel.dataset.largeResult === 'true') {
                var columnFilters = getColumnFilters(panel);
                panel.querySelectorAll('[data-col-filter-toggle]').forEach(function (button) {
                    var field = button.dataset.colFilterToggle;
                    var filterRule = columnFilters[field];
                    button.classList.toggle('has-filter', !!(filterRule && Array.isArray(filterRule.values) && filterRule.values.length));
                });
                panel.querySelectorAll('[data-col-filter-value]').forEach(function (input) {
                    var field = input.dataset.colFilterValue;
                    var filterRule = columnFilters[field];
                    var values = filterRule && Array.isArray(filterRule.values) ? filterRule.values : [];
                    input.checked = values.includes(input.value);
                });
                var totalFiltered = Number(panel.dataset.totalFilteredRows || 0);
                panel.dataset.filteredRows = String(totalFiltered);
                renderColumnFilters(panel);
                renderPagination(panel, totalFiltered);
                updateVisibleCount(panel);
                updateTableSummary(panel);
                return;
            }
            var term = ((panel.querySelector('.fsearch') || {}).value || '').toLowerCase();
            var filter = getActiveFilter(panel);
            var columnFilters = getColumnFilters(panel);
            panel.querySelectorAll('[data-col-filter-toggle]').forEach(function (button) {
                var field = button.dataset.colFilterToggle;
                var filterRule = columnFilters[field];
                var active = !!(filterRule && Array.isArray(filterRule.values) && filterRule.values.length);
                button.classList.toggle('has-filter', active);
            });
            panel.querySelectorAll('[data-col-filter-value]').forEach(function (input) {
                var field = input.dataset.colFilterValue;
                var filterRule = columnFilters[field];
                var values = filterRule && Array.isArray(filterRule.values) ? filterRule.values : [];
                input.checked = values.includes(input.value);
            });
            var matchedRows = [];
            panel.querySelectorAll('tbody tr').forEach(function (row) {
                if (row.children.length <= 1) return;
                var matchesSearch = !term || row.textContent.toLowerCase().includes(term);
                var matchesFilter = filter === 'all' || row.dataset.type === filter.slice(5);
                var matchesColumns = rowMatchesColumnFilters(row, columnFilters, function (col) {
                    return getColumnIndex(panel, col);
                });
                if (matchesSearch && matchesFilter && matchesColumns) {
                    matchedRows.push(row);
                } else {
                    row.style.display = 'none';
                }
            });
            panel.dataset.filteredRows = String(matchedRows.length);
            var pageSize = Math.max(0, Number(panel.dataset.pageSize || 50));
            var currentPage = Math.max(1, Number(panel.dataset.currentPage || 1));
            var totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(matchedRows.length / pageSize));
            if (currentPage > totalPages) {
                currentPage = totalPages;
                panel.dataset.currentPage = String(currentPage);
            }
            var pageStart = pageSize === 0 ? 0 : (currentPage - 1) * pageSize;
            var pageEnd = pageSize === 0 ? matchedRows.length : pageStart + pageSize;
            matchedRows.forEach(function (row, index) {
                row.style.display = index >= pageStart && index < pageEnd ? '' : 'none';
            });
            renderColumnFilters(panel);
            renderPagination(panel, matchedRows.length);
            updateVisibleCount(panel);
            updateTableSummary(panel);
        }

        function getColumnIndex(panel, col) {
            return Array.from(panel.querySelectorAll('thead th')).findIndex(th => th.dataset.col === col);
        }

        function resetPanelState(panel) {
            var search = panel.querySelector('.fsearch');
            if (search) search.value = '';
            panel.querySelectorAll('.chip').forEach(function (chip) {
                chip.classList.toggle('active', chip.dataset.filter === 'all');
            });
            panel.querySelectorAll('thead th').forEach(function (th) {
                th.classList.remove('sorted');
                delete th.dataset.asc;
            });
            delete panel.dataset.sortState;
            panel.querySelectorAll('[data-col-toggle]').forEach(function (input) {
                input.checked = true;
                var col = input.dataset.colToggle;
                panel.querySelectorAll(`[data-col="${CSS.escape(col)}"]`).forEach(function (el) {
                    el.classList.remove('hidden-col');
                });
                var index = getColumnIndex(panel, col);
                if (index >= 0) {
                    panel.querySelectorAll(`tbody td:nth-child(${index + 1})`).forEach(function (el) {
                        el.classList.remove('hidden-col');
                    });
                }
            });
            var tbody = panel.querySelector('tbody');
            if (tbody) {
                Array.from(tbody.querySelectorAll('tr'))
                    .sort(function (a, b) {
                        return Number(a.dataset.rowIndex || 0) - Number(b.dataset.rowIndex || 0);
                    })
                    .forEach(function (tr) { tbody.appendChild(tr); });
            }
            panel.querySelectorAll('col[data-col]').forEach(function (col) {
                col.style.width = '';
            });
            panel.querySelectorAll('thead th[data-col]').forEach(function (th) {
                th.style.width = '';
            });
            panel.dataset.currentPage = '1';
            panel.dataset.pageSize = '50';
            setColumnFilters(panel, {});
            requestViewUpdate(panel);
            saveState();
            setStatus('Reset table filters, search, sort, and widths.', 'success');
        }

        function clearSelection() {
            const selectedCell = getSelectedCell();
            if (selectedCell) selectedCell.classList.remove('cell-selected');
            setSelectedCell(null);
        }

        function switchTab(idx) {
            document.querySelectorAll('.tab-btn').forEach((button, i) => {
                const isActive = i === idx;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                button.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            document.querySelectorAll('.tab-panel').forEach((panel, i) => {
                const isActive = i === idx;
                panel.style.display = isActive ? 'flex' : 'none';
                panel.hidden = !isActive;
            });
            clearSelection();
            saveState();
        }

        function selectCell(cell) {
            if (!cell || cell.classList.contains('hidden-col')) return;
            clearSelection();
            setSelectedCell(cell);
            cell.classList.add('cell-selected');
        }

        function getVisibleHeaders(panel) {
            return Array.from(panel.querySelectorAll('thead th[data-col]')).filter(th => !th.classList.contains('hidden-col'));
        }

        function getDataHeaders(panel) {
            return Array.from(panel.querySelectorAll('thead th[data-col]'));
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

        function syncColumnToggleOrder(panel) {
            var labels = Array.from(panel.querySelectorAll('[data-col-toggle]')).map(function (input) {
                return input.closest('label');
            });
            if (!labels.length) return;
            var menu = labels[0].parentElement;
            var headers = getDataHeaders(panel);
            headers.forEach(function (header, index) {
                var col = header.dataset.col;
                var label = labels.find(function (entry) {
                    var input = entry.querySelector('[data-col-toggle]');
                    return input && input.dataset.colToggle === col;
                });
                if (label) menu.appendChild(label);
                panel.querySelectorAll('.col-move').forEach(function (button) {
                    if (button.dataset.col !== col) return;
                    if (button.dataset.colMove === 'left') button.disabled = index <= 0;
                    if (button.dataset.colMove === 'right') button.disabled = index >= headers.length - 1;
                });
            });
        }

        function getColumnWidth(panel, col) {
            var colEl = panel.querySelector('col[data-col="' + CSS.escape(col) + '"]');
            return colEl ? parseInt(colEl.style.width, 10) || 0 : 0;
        }

        function applyColumnWidth(panel, col, width) {
            var safeWidth = Math.max(120, Math.min(720, Math.round(width)));
            var colEl = panel.querySelector('col[data-col="' + CSS.escape(col) + '"]');
            var th = panel.querySelector('thead th[data-col="' + CSS.escape(col) + '"]');
            if (colEl) colEl.style.width = safeWidth + 'px';
            if (th) th.style.width = safeWidth + 'px';
        }

        function reorderColumns(panel, movingHeader, targetHeader, placeAfter) {
            if (!movingHeader || !targetHeader || movingHeader === targetHeader) return;
            var headerRow = panel.querySelector('thead tr');
            var fullHeaders = Array.from(headerRow.children);
            var movingIndex = fullHeaders.indexOf(movingHeader);
            var targetIndex = fullHeaders.indexOf(targetHeader);
            if (movingIndex === -1 || targetIndex === -1) return;

            headerRow.insertBefore(movingHeader, placeAfter ? targetHeader.nextSibling : targetHeader);

            panel.querySelectorAll('tbody tr').forEach(function (row) {
                var cells = Array.from(row.children);
                var movingCell = cells[movingIndex];
                var targetCell = cells[targetIndex];
                if (!movingCell || !targetCell || movingCell === targetCell) return;
                row.insertBefore(movingCell, placeAfter ? targetCell.nextSibling : targetCell);
            });

            syncColumnToggleOrder(panel);
        }

        function moveColumn(panel, col, delta) {
            const headers = getDataHeaders(panel);
            const fromIndex = headers.findIndex(th => th.dataset.col === col);
            const toIndex = fromIndex + delta;
            if (fromIndex === -1 || toIndex < 0 || toIndex >= headers.length) return;
            reorderColumns(panel, headers[fromIndex], headers[toIndex], delta > 0);
        }

        return {
            applyColumnWidth,
            applyPanelView,
            clearSelection,
            getActiveSort,
            getColumnIndex,
            getColumnWidth,
            getDataHeaders,
            getEditableVisibleCells,
            getSortValue,
            getState,
            getVisibleColumnIndex,
            getVisibleHeaders,
            moveColumn,
            navigateCell,
            reorderColumns,
            requestRerender,
            requestViewUpdate,
            resetPanelState,
            saveState,
            setColumnFilters,
            selectCell,
            setStatus,
            setCurrentPage,
            setPageSize,
            switchTab,
            syncColumnToggleOrder,
            updateTableSummary,
            updateVisibleCount,
            getColumnFilters,
            renderColumnFilters,
            renderPagination
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            normaliseColumnFilters,
            serialiseColumnFilters,
            setColumnFilterValues,
            computeNextSortState,
            rowMatchesColumnFilters
        };
    }

    if (typeof window !== 'undefined') {
        window.YamlinkViewPanelStateRuntime = {
            createViewPanelStateRuntime
        };
    }
}());
