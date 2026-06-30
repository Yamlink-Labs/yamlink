'use strict';

const React = require('react');
const SelectionList = require('../components/SelectionList');
const Panel = require('../components/Panel');
const { p, SYM, termWidth } = require('../palette');

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

function Graph({ ink, host, port, getNode, getTypes, getNodes, initialId, onNavigate, onQuit, disabled, width, splitMode }) {
    const { Box, Text, useInput } = ink;

    const [activePane, setActivePane] = React.useState(initialId ? 'graph' : 'types');
    const [typeCursor, setTypeCursor] = React.useState(0);
    const [noteCursor, setNoteCursor] = React.useState(0);
    const [types, setTypes] = React.useState([]);
    const [notes, setNotes] = React.useState([]);
    const [selectedType, setSelectedType] = React.useState({ type: 'all', count: 0 });
    const [graphId, setGraphId] = React.useState(initialId || null);
    const [graphData, setGraphData] = React.useState(null);
    const [graphLoading, setGraphLoading] = React.useState(false);
    const [graphCursor, setGraphCursor] = React.useState(0);
    const [history, setHistory] = React.useState([]);
    const [loadError, setLoadError] = React.useState('');

    React.useEffect(() => {
        getTypes({ host, port }).then((raw) => {
            const all = Array.isArray(raw) ? raw : [];
            const total = all.reduce((s, t) => s + (Number(t.count) || 0), 0);
            setTypes([{ type: 'all', count: total }, ...all.map((t) => ({ type: t.type || String(t), count: t.count || 0 }))]);
            setLoadError('');
        }).catch((err) => setLoadError(err.message || String(err)));
    }, [host, port]);

    React.useEffect(() => {
        const t = selectedType?.type;
        getNodes({ host, port, type: t === 'all' ? undefined : t }).then((raw) => {
            const items = (Array.isArray(raw) ? raw : []).map((n) => ({
                id: n.id, label: n.name || n.title || n.id, type: n.type || ''
            }));
            setNotes(items);
            setNoteCursor(0);
            setLoadError('');
        }).catch((err) => setLoadError(err.message || String(err)));
    }, [host, port, selectedType]);

    React.useEffect(() => {
        if (!graphId) return;
        setGraphLoading(true);
        setGraphData(null);
        getNode({ host, port, id: graphId }).then((n) => {
            setGraphData(n);
            setGraphLoading(false);
            setGraphCursor(0);
        }).catch((err) => { setGraphLoading(false); setLoadError(err.message || String(err)); });
    }, [graphId, host, port]);

    const safeNoteCursor = Math.max(0, Math.min(noteCursor, Math.max(0, notes.length - 1)));
    const selectedNote = notes[safeNoteCursor] || null;

    React.useEffect(() => {
        if (!selectedNote || activePane === 'types') return;
        const timer = setTimeout(() => { setGraphId(selectedNote.id); }, 150);
        return () => clearTimeout(timer);
    }, [selectedNote, activePane]);

    const outbound = Array.isArray(graphData?._outbound) ? graphData._outbound : [];
    const inbound = Array.isArray(graphData?._inbound) ? graphData._inbound : [];
    const allEdges = [
        ...outbound.map((e) => ({ dir: 'out', id: e.to, field: e.field })),
        ...inbound.map((e) => ({ dir: 'in', id: e.from, field: e.field })),
    ];

    // Build a type-lookup from loaded notes so we can annotate link targets
    const noteTypeMap = React.useMemo(() => {
        const map = new Map();
        for (const n of notes) map.set(n.id, n.type);
        return map;
    }, [notes]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }

        if (!splitMode && key.tab) {
            if (activePane === 'types') setActivePane('notes');
            else if (activePane === 'notes') { setActivePane('graph'); }
            else setActivePane('types');
            return;
        }

        if (key.escape || input === 'q') {
            if (activePane === 'graph' && history.length > 0) {
                const prev = [...history];
                const id = prev.pop();
                setHistory(prev);
                setGraphId(id);
                setGraphCursor(0);
            } else if (activePane === 'graph') {
                setActivePane('notes');
            } else if (activePane === 'notes') {
                setActivePane('types');
            } else {
                onNavigate('briefing');
            }
            return;
        }

        if (activePane === 'types') {
            if (key.upArrow || input === 'k') { setTypeCursor((c) => Math.max(0, c - 1)); return; }
            if (key.downArrow || input === 'j') { setTypeCursor((c) => Math.min(Math.max(0, types.length - 1), c + 1)); return; }
            if (key.return) {
                const t = types[typeCursor];
                if (t) { setSelectedType(t); setNoteCursor(0); setActivePane('notes'); }
            }
            return;
        }

        if (activePane === 'notes') {
            if (key.upArrow || input === 'k') { setNoteCursor((c) => Math.max(0, c - 1)); return; }
            if (key.downArrow || input === 'j') { setNoteCursor((c) => Math.min(Math.max(0, notes.length - 1), c + 1)); return; }
            if (key.return && selectedNote) { setGraphId(selectedNote.id); setActivePane('graph'); }
            return;
        }

        if (activePane === 'graph') {
            if (key.upArrow || input === 'k') { setGraphCursor((c) => Math.max(0, c - 1)); return; }
            if (key.downArrow || input === 'j') { setGraphCursor((c) => Math.min(Math.max(0, allEdges.length - 1), c + 1)); return; }
            if (key.return && allEdges[graphCursor]) {
                const edge = allEdges[graphCursor];
                setHistory((h) => [...h, graphId]);
                setGraphId(edge.id);
                setGraphCursor(0);
            }
            return;
        }
    }, { isActive: !disabled });

    // Proportion bar for types panel
    const totalNoteCount = Math.max(1, types.length > 0 && types[0].type === 'all' ? types[0].count : types.reduce((s, t) => s + t.count, 0));

    function renderTypeRow(item, _index, isSelected) {
        const active = activePane === 'types';
        const marker = isSelected ? (active ? p.accent(`${SYM.selected} `) : p.secondary(`${SYM.selected} `)) : p.faint('  ');
        const barWidth = 7;
        const ratio = item.type === 'all' ? 1 : (item.count / totalNoteCount);
        const filled = Math.round(ratio * barWidth);
        const bar = p.accent('▓'.repeat(filled)) + p.faint('░'.repeat(barWidth - filled));
        return React.createElement(Text, null,
            marker + pad(item.type, 12) + ' ' + p.secondary(pad(String(item.count), 3)) + ' ' + bar
        );
    }

    function renderNoteRow(item, _index, isSelected) {
        const active = activePane === 'notes';
        const marker = isSelected ? (active ? p.accent(`${SYM.cursor} `) : p.secondary(`${SYM.cursor} `)) : p.faint('  ');
        const idPart = pad(truncate(item.id, 20), 22);
        const labelPart = selectedType.type === 'all'
            ? truncate(item.label, 14)
            : pad(truncate(item.label, 16), 17);
        const typeBadge = selectedType.type === 'all' ? '' : '';
        return React.createElement(Text, null,
            marker + p.type(idPart) + ' ' + p.primary(labelPart) + typeBadge
        );
    }

    let graphContent;
    if (!graphId) {
        graphContent = React.createElement(Text, null, p.faint('  Select a note to see its connections'));
    } else if (graphLoading) {
        graphContent = React.createElement(Text, null, p.muted(`  ${SYM.idle}  loading...`));
    } else if (!graphData) {
        graphContent = React.createElement(Text, null, p.err(`  ${SYM.err}  failed to load`));
    } else {
        const rootType = graphData.type ? p.type(` (${graphData.type})`) : '';
        const breadcrumb = history.length > 0
            ? p.faint(history.slice(-2).map((id) => truncate(id, 14)).join(' › ') + ' › ') + p.accent(graphId)
            : p.accent(graphId);

        graphContent = React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(Text, null, '  ' + breadcrumb + rootType),
            React.createElement(Text, null, ''),
            outbound.length > 0
                ? React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    React.createElement(Text, null, '  ' + p.section(`LINKS OUT  (${outbound.length})`)),
                    React.createElement(Text, null, ''),
                    ...outbound.map((e, i) => {
                        const isCursor = activePane === 'graph' && i === graphCursor;
                        const pfx = isCursor ? p.accent(`  ${SYM.selected} `) : '    ';
                        const targetId = isCursor ? p.accent(pad(truncate(e.to, 28), 30)) : p.primary(pad(truncate(e.to, 28), 30));
                        const targetType = noteTypeMap.get(e.to);
                        const typePart = targetType ? p.type(pad(truncate(targetType, 12), 13)) : p.faint(pad('', 13));
                        return React.createElement(Text, { key: `out-${i}` },
                            pfx + p.ok('→') + '  ' + targetId + typePart + p.faint(`via ${truncate(e.field || '', 14)}`)
                        );
                    }),
                    React.createElement(Text, null, '')
                )
                : React.createElement(Text, null, '  ' + p.faint('no outbound links')),
            inbound.length > 0
                ? React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    React.createElement(Text, null, '  ' + p.section(`LINKS IN  (${inbound.length})`)),
                    React.createElement(Text, null, ''),
                    ...inbound.map((e, i) => {
                        const idx = outbound.length + i;
                        const isCursor = activePane === 'graph' && idx === graphCursor;
                        const pfx = isCursor ? p.accent(`  ${SYM.selected} `) : '    ';
                        const sourceId = isCursor ? p.accent(pad(truncate(e.from, 28), 30)) : p.primary(pad(truncate(e.from, 28), 30));
                        const sourceType = noteTypeMap.get(e.from);
                        const typePart = sourceType ? p.type(pad(truncate(sourceType, 12), 13)) : p.faint(pad('', 13));
                        return React.createElement(Text, { key: `in-${i}` },
                            pfx + p.type('←') + '  ' + sourceId + typePart + p.faint(`via ${truncate(e.field || '', 14)}`)
                        );
                    }),
                    React.createElement(Text, null, '')
                )
                : React.createElement(Text, null, '  ' + p.faint('no inbound links')),
            allEdges.length === 0
                ? React.createElement(Text, null, '  ' + p.warn(`${SYM.warn}  isolated note — no connections`))
                : null
        );
    }

    const divider = p.faint('─'.repeat(Math.max(20, Math.min(Number(width) || termWidth(), termWidth()))));
    const hint = activePane !== 'graph'
        ? (!splitMode
            ? p.faint('[Tab] switch pane  [↑↓] move  [↵] select  [Esc/q] back')
            : p.faint('[↑↓] move  [↵] select  [Esc/q] back'))
        : p.faint('[Esc/q] back  [↑↓] move  [↵] jump to node');

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1 },
        loadError
            ? React.createElement(Box, { marginBottom: 1 },
                React.createElement(Text, null, p.err(`  ${SYM.warn} ${loadError}`)))
            : null,
        React.createElement(
            Box,
            { flexDirection: 'row' },
            React.createElement(Panel, {
                ink,
                title: 'Notes',
                width: width ? Math.max(20, Math.floor(width * 0.36)) : '35%',
                marginRight: 1,
                children: React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    React.createElement(Text, null, '  ' + p.muted(pad('TYPE', 12)) + ' ' + p.muted(pad('N', 3)) + '  ' + p.muted('SHARE')),
                    React.createElement(SelectionList, {
                        ink, items: types, cursor: typeCursor,
                        maxVisible: 6, emptyText: '...', renderItem: renderTypeRow
                    }),
                    React.createElement(Text, null, p.faint('  ' + '─'.repeat(28))),
                    React.createElement(Text, null, '  ' + p.muted(pad('ID', 22)) + ' ' + p.muted('NAME')),
                    React.createElement(SelectionList, {
                        ink, items: notes, cursor: safeNoteCursor,
                        maxVisible: 8, emptyText: '(empty)', renderItem: renderNoteRow
                    })
                )
            }),
            React.createElement(Panel, {
                ink,
                title: graphId ? `Graph — ${truncate(graphId, 28)}` : 'Graph',
                flexGrow: 1,
                children: graphContent
            })
        ),
        React.createElement(Text, null, divider),
        React.createElement(Text, null, hint + p.faint('  [Ctrl+C] quit'))
    );
}

module.exports = Graph;
