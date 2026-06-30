'use strict';

const React = require('react');
const { exec } = require('child_process');
const SelectionList = require('../components/SelectionList');
const { p, SYM } = require('../palette');

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

function normalizeNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : []).map((node) => ({
        id: String(node.id || ''),
        filePath: String(node._filePath || ''),
        label: String(node.name || node.title || node.id || ''),
        status: String(node.status || '')
    }));
}

function openSelectedInExplorer(selected, onNavigate) {
    if (!selected || typeof onNavigate !== 'function') return false;
    onNavigate('explorer', selected.id);
    return true;
}

function Navigator({ ink, TextInput, host, port, getTypes, getNodes, onNavigate, onQuit, onPeek, onNoteView, onStateChange, initialQuery = '', initialId = '', disabled, width, splitMode }) {
    const { Box, Text, useInput } = ink;
    const [types, setTypes] = React.useState([]);
    const [typeIndex, setTypeIndex] = React.useState(0);
    const [nodes, setNodes] = React.useState([]);
    const [search, setSearch] = React.useState(initialQuery);
    const [cursor, setCursor] = React.useState(0);
    const [message, setMessage] = React.useState('');

    React.useEffect(() => {
        getTypes({ host, port })
            .then((result) => {
                const loadedTypes = (Array.isArray(result) ? result : []).map((entry) => ({
                    type: String(entry.type || ''),
                    count: Number(entry.count || 0)
                })).filter((entry) => entry.type);
                setTypes(loadedTypes);
                if (!loadedTypes.length) setNodes([]);
            })
            .catch((error) => {
                setMessage(error.message || String(error));
            });
    }, [getTypes, host, port]);

    React.useEffect(() => {
        if (!types.length) return;
        const currentType = types[typeIndex];
        if (!currentType) return;
        getNodes({ host, port, type: currentType.type })
            .then((fetched) => {
                setNodes(normalizeNodes(fetched));
                setCursor(0);
            })
            .catch((error) => {
                setMessage(error.message || String(error));
            });
    }, [getNodes, host, port, typeIndex, types]);

    const onStateChangeRef = React.useRef(onStateChange);
    React.useEffect(() => { onStateChangeRef.current = onStateChange; });

    const filtered = React.useMemo(
        () => nodes.filter((node) => {
            const needle = search.trim().toLowerCase();
            if (!needle) return true;
            return node.id.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle);
        }),
        [nodes, search]
    );
    const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));
    const selected = filtered[safeCursor] || null;
    const currentType = types[typeIndex] || { type: 'none', count: 0 };

    React.useEffect(() => {
        setSearch(String(initialQuery || ''));
    }, [initialQuery]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            onQuit();
            return;
        }
        if (key.escape) {
            if (search.trim()) {
                setSearch('');
                setMessage('');
            } else {
                onNavigate('briefing');
            }
            return;
        }
        if (!search.trim()) {
            if (input === '1') { onNavigate('briefing'); return; }
            if (input === '2') { onNavigate('query'); return; }
            if (input === '4') { onNavigate('explorer'); return; }
            if (input === '5') { onNavigate('health'); return; }
            if (input === '7') { onNavigate('graph'); return; }
        }
        if (!splitMode && key.tab) {
            if (types.length) {
                setTypeIndex((index) => (index + 1) % types.length);
                setSearch('');
                setMessage('');
            }
            return;
        }
        if (input === 'k' || key.upArrow) {
            setCursor((index) => Math.max(0, index - 1));
            return;
        }
        if (input === 'j' || key.downArrow) {
            setCursor((index) => Math.min(Math.max(0, filtered.length - 1), index + 1));
            return;
        }
        if (key.return) {
            openSelectedInExplorer(selected, onNavigate);
            return;
        }
        if (input === 'o' && selected) {
            const target = selected.filePath || selected.id;
            setMessage(`Opened: ${selected.id}`);
            try {
                const editor = process.env.EDITOR || 'code';
                const safeTarget = target.replace(/"/g, '\\"');
                exec(`"${editor}" "${safeTarget}"`, { windowsHide: true }, () => {});
            } catch (_) {}
            return;
        }
        if (input === 'g' && selected) {
            onNavigate('graph', selected.id);
            return;
        }
        if (input === 'p' && selected && onPeek) {
            onPeek(selected.id);
            return;
        }
        if (input === 'v' && selected && onNoteView) {
            onNoteView(selected.id);
        }
    }, { isActive: !disabled });

    React.useEffect(() => {
        if (!initialId || !filtered.length) return;
        const index = filtered.findIndex((node) => node.id === initialId);
        if (index !== -1 && index !== safeCursor) setCursor(index);
    }, [filtered, initialId, safeCursor]);

    React.useEffect(() => {
        onStateChangeRef.current?.({
            noteId: selected?.id || '',
            query: search
        });
    }, [search, selected]);

    const paneWidth = Number(width) || 84;
    const idWidth = paneWidth < 52 ? 12 : paneWidth < 72 ? 16 : 18;
    const labelWidth = paneWidth < 52 ? 12 : paneWidth < 72 ? 16 : 18;
    const statusWidth = paneWidth < 52 ? 8 : 12;

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1 },
        React.createElement(Text, null, p.section('Navigator')),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'row' },
            React.createElement(Text, null, p.muted('Type: ')),
            React.createElement(Text, null, p.type(currentType.type)),
            React.createElement(
                Text,
                null,
                splitMode
                    ? p.secondary(` (${currentType.count})`)
                    : p.secondary(` (${currentType.count})   [tab] cycle type`)
            )
        ),
        React.createElement(
            Box,
            { flexDirection: 'row' },
            React.createElement(Text, null, p.muted('Search: ')),
            React.createElement(TextInput, {
                value: search,
                onChange: setSearch,
                placeholder: 'rico',
                focus: !disabled
            })
        ),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'column' },
            React.createElement(SelectionList, {
                ink,
                items: filtered,
                cursor: safeCursor,
                maxVisible: 12,
                emptyText: '(no notes)',
                renderItem(node, _index, isSelected) {
                    const marker = isSelected ? p.accent(`${SYM.cursor} `) : p.faint('  ');
                    return React.createElement(
                        Text,
                        null,
                        marker +
                        p.type(pad(truncate(node.id, idWidth), idWidth + 2)) + ' ' +
                        p.primary(pad(truncate(node.label, labelWidth), labelWidth + 2)) +
                        (node.status ? p.secondary(truncate(node.status, statusWidth)) : '')
                    );
                }
            })
        ),
        selected
            ? React.createElement(
                Box,
                { marginTop: 1 },
                React.createElement(
                    Text,
                    null,
                    splitMode
                        ? p.faint('[Enter] open in Explorer  [p] peek  [g] graph  [o] editor  [Esc] clear/back')
                        : p.faint('[Enter] open in Explorer  [p] peek  [g] graph  [o] editor  [Tab] cycle type  [Esc] clear/back')
                )
            )
            : null,
        message
            ? React.createElement(Box, { marginTop: 1 }, React.createElement(Text, null, p.err(message)))
            : null
    );
}

Navigator.openSelectedInExplorer = openSelectedInExplorer;

module.exports = Navigator;
