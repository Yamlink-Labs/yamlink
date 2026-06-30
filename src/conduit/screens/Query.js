'use strict';

const React = require('react');
const { p } = require('../palette');

const EXAMPLES = [
    { query: 'where type = character sort name', note: 'all characters' },
    { query: 'where status = active', note: 'active notes' },
    { query: 'today', note: 'due today' },
    { query: 'upcoming', note: 'due this week' },
    { query: 'where type = mission status = active', note: 'active missions' },
];

function truncate(text, width) {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, width - 1) + '…';
}

function pad(text, width) {
    const value = String(text ?? '');
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

const PRIORITY_COLS = ['id', 'type', 'name', 'title', 'status', 'date', 'created'];
const QUERY_DEBOUNCE_MS = 400;
const MIN_VISIBLE_RESULT_ROWS = 3;
const MAX_VISIBLE_RESULT_ROWS = 12;

function selectColumns(allCols, rows) {
    if (allCols.length <= 6) return allCols;
    const rate = (col) => rows.length === 0 ? 0 :
        rows.filter((r) => String(r?.[col] ?? '').trim().length > 0).length / rows.length;
    const priority = PRIORITY_COLS.filter((c) => allCols.includes(c));
    const rest = allCols.filter((c) => !priority.includes(c)).sort((a, b) => rate(b) - rate(a));
    const picked = [...priority];
    for (const col of rest) {
        if (picked.length >= 6) break;
        if (rate(col) >= 0.15) picked.push(col);
    }
    return picked.length > 0 ? picked.slice(0, 6) : allCols.slice(0, 6);
}

function flattenRows(result) {
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const rawColumns = Array.isArray(result?.columns) && result.columns.length
        ? result.columns
        : (rows[0] ? Object.keys(rows[0]) : []);
    const flatRows = rows.map((row) => {
        const flat = {};
        for (const col of rawColumns) {
            flat[col] = row?.fields?.[col] ?? row?.[col] ?? '';
        }
        return flat;
    });
    const columns = selectColumns(rawColumns, flatRows);
    return { columns, flatRows };
}

function getVisibleResultRowCount(splitMode = false) {
    const terminalRows = Number(process.stdout.rows) || 28;
    const reservedRows = splitMode ? 16 : 14;
    return Math.max(
        MIN_VISIBLE_RESULT_ROWS,
        Math.min(MAX_VISIBLE_RESULT_ROWS, terminalRows - reservedRows)
    );
}

function renderTable(ink, columns, rows, availableWidth, maxRows, cursor) {
    const { Box, Text } = ink;
    if (!rows.length) return null;
    const safeMax = Math.max(1, Number(maxRows) || MAX_VISIBLE_RESULT_ROWS);
    const safeCursor = typeof cursor === 'number' && cursor >= 0 ? cursor : -1;
    // Scroll window to keep cursor visible
    const windowStart = safeCursor >= 0
        ? Math.max(0, Math.min(safeCursor, rows.length - safeMax))
        : 0;
    const visibleRows = rows.slice(windowStart, windowStart + safeMax);
    const maxColumnWidth = Math.max(8, Math.min(28, Math.floor((Number(availableWidth) || 84) / Math.max(columns.length, 1)) - 3));
    // Compute widths from all rows so they stay stable as cursor scrolls
    const widths = columns.map((column) => {
        const longest = rows.reduce((max, row) => Math.max(max, String(row?.[column] ?? '').length), column.length);
        return Math.min(maxColumnWidth, longest);
    });
    const header = p.faint('  ') + columns.map((col, i) => p.header(pad(truncate(col, widths[i]), widths[i]))).join('  ');
    const divider = p.faint('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
    const overflowCount = Math.max(0, rows.length - (windowStart + visibleRows.length));
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, null, header),
        React.createElement(Text, null, divider),
        visibleRows.map((row, ri) => {
            const absoluteIndex = windowStart + ri;
            const isSelected = absoluteIndex === safeCursor;
            const prefix = isSelected ? p.accent('▸ ') : '  ';
            const rowText = columns.map((col, ci) => {
                const raw = row?.[col] ?? '';
                const formatted = pad(truncate(raw, widths[ci]), widths[ci]);
                if (isSelected) return p.accent(formatted);
                if (col === 'id') return p.type(formatted);
                if (col === 'status') return p.warn(formatted);
                if (col === 'type') return p.type(formatted);
                return p.primary(formatted);
            }).join('  ');
            return React.createElement(Text, { key: `query-row-${ri}` }, prefix + rowText);
        }),
        overflowCount > 0
            ? React.createElement(Text, { key: 'query-overflow' }, p.faint(`  + ${overflowCount} more rows not shown`))
            : null
    );
}

function executeQuery({ host, port, query, runQuery, setState }) {
    setState((current) => ({ ...current, loading: true, error: '' }));
    return runQuery({ host, port, query: query.trim() })
        .then((result) => setState({ loading: false, result, error: '' }))
        .catch((error) => setState({ loading: false, result: null, error: error.message || String(error) }));
}

function scheduleLiveQuery({ host, port, query, runQuery, setState }) {
    return setTimeout(() => {
        executeQuery({ host, port, query, runQuery, setState });
    }, QUERY_DEBOUNCE_MS);
}

function Query({ ink, TextInput, host, port, runQuery, onNavigate, onNoteView, onQuit, onStateChange, initialQuery = '', disabled, width, splitMode = false }) {
    const { Box, Text, useInput } = ink;
    const [value, setValue] = React.useState(initialQuery);
    const [state, setState] = React.useState({ loading: false, result: null, error: '' });
    const [resultCursor, setResultCursor] = React.useState(-1);
    const debounceRef = React.useRef(null);
    const onStateChangeRef = React.useRef(onStateChange);
    React.useEffect(() => { onStateChangeRef.current = onStateChange; });

    React.useEffect(() => {
        if (initialQuery !== value) setValue(initialQuery);
    }, [initialQuery]);

    // Reset row cursor whenever the query changes so user starts back in editing mode
    React.useEffect(() => {
        setResultCursor(-1);
    }, [value]);

    const { columns, flatRows } = flattenRows(state.result);
    const hasResult = state.result !== null;

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }
        if (key.escape) {
            // Escape from cursor mode → back to editing
            if (resultCursor >= 0) { setResultCursor(-1); return; }
            if (value.trim() || state.result || state.error) {
                setValue('');
                setState({ loading: false, result: null, error: '' });
            } else {
                onNavigate('briefing');
            }
            return;
        }
        // ↓ / ↑ navigate result rows (TextInput doesn't capture vertical arrows)
        if (key.downArrow && flatRows.length > 0) {
            setResultCursor((c) => Math.min(flatRows.length - 1, c + 1));
            return;
        }
        if (key.upArrow) {
            setResultCursor((c) => Math.max(-1, c - 1));
            return;
        }
        // Enter on a selected row opens the note
        if (key.return && resultCursor >= 0) {
            const row = flatRows[resultCursor];
            const id = String(row?.id || '');
            if (id) {
                if (onNoteView) { onNoteView(id); }
                else { onNavigate('explorer', id); }
            }
            return;
        }
        if (value.trim()) return;
        if (input === '1') { onNavigate('briefing'); return; }
        if (input === '3') { onNavigate('navigator'); return; }
        if (input === '4') { onNavigate('explorer'); return; }
        if (input === '5') { onNavigate('health'); }
    }, { isActive: !disabled });

    React.useEffect(() => {
        onStateChangeRef.current?.({ query: value });
    }, [value]);

    React.useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!value.trim()) {
            setState({ loading: false, result: null, error: '' });
            return undefined;
        }
        debounceRef.current = scheduleLiveQuery({ host, port, query: value.trim(), runQuery, setState });
        return () => clearTimeout(debounceRef.current);
    }, [host, port, runQuery, value]);

    const visibleResultRows = getVisibleResultRowCount(splitMode);
    const rootHeight = splitMode
        ? Math.max(14, (Number(process.stdout.rows) || 28) - 8)
        : Math.max(18, (Number(process.stdout.rows) || 30) - 4);

    const browsingHint = resultCursor >= 0
        ? p.faint('  [↑/↓] navigate  [Enter] open  [Esc] back to query')
        : flatRows.length > 0
            ? p.faint('  [↓] browse results  [Esc] clear')
            : p.faint('  live preview · [Esc] clear');

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1, height: rootHeight },
        React.createElement(Text, null, p.section('Query')),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'row' },
            React.createElement(Text, null, p.accent('›') + ' '),
            React.createElement(TextInput, {
                value,
                onChange: setValue,
                placeholder: 'where type = character sort name',
                focus: !disabled
            })
        ),
        value.trim()
            ? React.createElement(
                Box,
                { marginTop: 1, flexDirection: 'column' },
                state.error
                    ? React.createElement(Text, null, p.err(state.error))
                    : state.loading
                        ? React.createElement(Text, null, p.muted('  updating...'))
                        : React.createElement(
                            Box,
                            { flexDirection: 'column' },
                            renderTable(ink, columns, flatRows, width, visibleResultRows, resultCursor),
                            React.createElement(
                                Box,
                                { marginTop: 1, flexDirection: 'row' },
                                React.createElement(Text, null,
                                    hasResult && flatRows.length
                                        ? p.ok(`  ${flatRows.length} result${flatRows.length !== 1 ? 's' : ''}`)
                                        : p.muted('  no results')
                                ),
                                React.createElement(Text, null, browsingHint)
                            )
                        )
            )
            : React.createElement(
                Box,
                { marginTop: 2, flexDirection: 'column' },
                React.createElement(Text, null, p.muted('  Examples')),
                ...EXAMPLES.slice(0, Math.max(3, visibleResultRows - 1)).map((ex, i) => React.createElement(
                    Box,
                    { key: `ex-${i}`, flexDirection: 'row', marginTop: 0 },
                    React.createElement(Text, null, p.faint('  › ')),
                    React.createElement(Text, null, p.secondary(ex.query)),
                    React.createElement(Text, null, p.faint(`   ${ex.note}`))
                ))
            )
    );
}

Query.QUERY_DEBOUNCE_MS = QUERY_DEBOUNCE_MS;
Query.scheduleLiveQuery = scheduleLiveQuery;
Query.executeQuery = executeQuery;
Query.getVisibleResultRowCount = getVisibleResultRowCount;
Query.renderTable = renderTable;

module.exports = Query;
