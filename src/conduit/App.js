'use strict';

const React = require('react');
const Briefing = require('./screens/Briefing');
const Query = require('./screens/Query');
const Navigator = require('./screens/Navigator');
const Explorer = require('./screens/Explorer');
const Health = require('./screens/Health');
const Search = require('./screens/Search');
const Graph = require('./screens/Graph');
const Diff = require('./screens/Diff');
const Radar = require('./screens/Radar');
const Trends = require('./screens/Trends');
const StatusBar = require('./components/StatusBar');
const HelpOverlay = require('./components/HelpOverlay');
const CommandPalette = require('./components/CommandPalette');
const QuickCapture = require('./components/QuickCapture');
const Peek = require('./components/Peek');
const NoteView = require('./components/NoteView');
const Warp = require('./components/Warp');
const SplitPane = require('./components/SplitPane');
const { openInEditor, readNoteBody } = require('./noteDetail');
const { p, SYM, termWidth } = require('./palette');
const {
    getNodes,
    getNode,
    runQuery,
    runSearch,
    getGraph,
    getTypes,
    getHealth,
    getTrends,
    getTasks,
    getMutations,
    getNoteIntelligence,
    getNeighborhood,
    getDiff,
    patchNode,
    patchNodesBulk,
    postNode,
    deleteNode,
    useEventStream
} = require('./useApi');
const {
    readScopedJson,
    writeScopedJson,
    getBookmarksPath,
    readLastSessionTimestamp,
    writeLastSessionTimestamp
} = require('./storage');

function humanEventLabel(type) {
    switch (String(type || '').trim()) {
    case 'note_created': return 'Created';
    case 'note_touched': return 'Updated';
    case 'note_deleted': return 'Deleted';
    case 'field_added': return 'Added';
    case 'field_changed': return 'Updated';
    case 'field_removed': return 'Removed';
    case 'relation_added': return 'Linked';
    case 'relation_changed': return 'Relinked';
    case 'relation_removed': return 'Unlinked';
    case 'type_set': return 'Typed';
    case 'task_status_changed': return 'Task';
    case 'rebuild': return 'Rebuilt';
    default: return String(type || 'Event');
    }
}

async function fetchBriefingData(host, port, lastSessionTs) {
    const diffSince = Diff.windowToSince('session', lastSessionTs || null);
    const [nodes, graph, types, health, tasks, mutations, diff] = await Promise.all([
        getNodes({ host, port }),
        getGraph({ host, port }).catch(() => ({ edges: [] })),
        getTypes({ host, port }).catch(() => []),
        getHealth({ host, port }).catch(() => ({ brokenLinks: 0 })),
        getTasks({ host, port, done: false, limit: 5 }).catch(() => []),
        getMutations({ host, port, limit: 6 }).catch(() => []),
        getDiff({ host, port, since: diffSince }).catch(() => ({ changes: [] }))
    ]);
    return {
        pulse: {
            notes: Array.isArray(nodes) ? nodes.length : 0,
            edges: Array.isArray(graph?.edges) ? graph.edges.length : 0,
            types: Array.isArray(types) ? types.length : 0,
            broken: Number(health?.brokenLinks || 0)
        },
        typesList: (Array.isArray(types) ? types : [])
            .map((t) => ({ type: String(t.type || ''), count: Number(t.count || 0) }))
            .filter((t) => t.type)
            .slice(0, 8),
        tasks: (Array.isArray(tasks) ? tasks : []).map((task) => ({
            id: task.noteId,
            label: task.text,
            date: task.date || '',
            source: task.noteId,
            overdue: Boolean(task.overdue),
            dueToday: Boolean(task.dueToday)
        })),
        initialActivity: (Array.isArray(mutations) ? mutations : []).map((mutation) => ({
            timestamp: mutation.timestamp || new Date().toISOString(),
            type: mutation.type || 'event',
            label: humanEventLabel(mutation.type),
            noteId: mutation.noteId || ''
        })),
        sessionDelta: buildSessionDelta(diff)
    };
}

function buildSessionDelta(diffBody) {
    const changes = Array.isArray(diffBody?.changes) ? diffBody.changes : [];
    const typeCounts = new Map();
    let createdNotes = 0;
    for (const change of changes) {
        const fields = change?.fields || {};
        const fieldNames = Object.keys(fields);
        const type = String(change?.type || '').trim();
        if (fieldNames.includes('type') && fieldNames.some((field) => field === 'name' || field === 'title' || field === 'created')) {
            createdNotes += 1;
        }
        if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    const rankedTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
    return {
        changedNotes: changes.length,
        createdNotes,
        topType: rankedTypes[0]?.[0] || '',
        topTypeCount: rankedTypes[0]?.[1] || 0
    };
}

function buildPaletteItems(commands, notes, types, navigate, setShowHelp) {
    const commandItems = commands;
    const noteItems = (Array.isArray(notes) ? notes : []).slice(0, 40).map((node) => ({
        id: `note:${node.id}`,
        label: `note: ${node.name || node.title || node.id}`,
        description: 'Open note in Explorer',
        detail: String(node.id || ''),
        action: () => navigate('explorer', { noteId: String(node.id || '') })
    }));
    const typeItems = (Array.isArray(types) ? types : []).slice(0, 10).map((entry) => ({
        id: `type:${entry.type}`,
        label: `type: ${entry.type}`,
        description: 'Filter Explorer to this type',
        detail: String(entry.count || ''),
        action: () => navigate('explorer', { typeFilter: String(entry.type || 'all') })
    }));
    return commandItems.concat(noteItems, typeItems).slice(0, 50);
}

function createPaneState(screen = 'briefing', routeState = {}) {
    return { screen, routeState: routeState && typeof routeState === 'object' ? routeState : {} };
}

function clonePaneState(pane) {
    return createPaneState(pane?.screen || 'briefing', { ...(pane?.routeState || {}) });
}

function shallowEqualObject(a, b) {
    const left = a && typeof a === 'object' ? a : {};
    const right = b && typeof b === 'object' ? b : {};
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (left[key] !== right[key]) return false;
    }
    return true;
}

function samePaneState(a, b) {
    const leftRoute = a?.routeState || {};
    const rightRoute = b?.routeState || {};
    if (String(a?.screen || '') !== String(b?.screen || '')) return false;
    const leftKeys = Object.keys(leftRoute);
    const rightKeys = Object.keys(rightRoute);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        const leftValue = leftRoute[key];
        const rightValue = rightRoute[key];
        const bothObjects = leftValue && typeof leftValue === 'object' && rightValue && typeof rightValue === 'object';
        if (bothObjects) {
            if (!shallowEqualObject(leftValue, rightValue)) return false;
        } else if (leftValue !== rightValue) {
            return false;
        }
    }
    return true;
}

function updatePaneRoute(pane, target, payload) {
    const current = clonePaneState(pane);
    if (target === 'explorer') {
        current.routeState = {
            ...current.routeState,
            explorer: {
                noteId: typeof payload === 'string' ? payload : String(payload?.noteId || payload?.id || ''),
                typeFilter: typeof payload === 'object' ? String(payload?.typeFilter || 'all') : 'all',
                filterText: typeof payload === 'object' ? String(payload?.filterText || '') : '',
                mode: typeof payload === 'object' ? String(payload?.mode || '') : ''
            }
        };
    } else if (target === 'query') {
        current.routeState = {
            ...current.routeState,
            query: { query: String(payload?.query || '') }
        };
    } else if (target === 'search') {
        current.routeState = {
            ...current.routeState,
            search: { query: String(payload?.query || '') }
        };
    } else if (target === 'navigator') {
        current.routeState = {
            ...current.routeState,
            navigator: { query: String(payload?.query || ''), noteId: String(payload?.noteId || '') }
        };
    } else if (target === 'graph') {
        current.routeState = {
            ...current.routeState,
            graph: { noteId: typeof payload === 'string' ? payload : String(payload?.noteId || '') }
        };
    } else if (target === 'radar') {
        current.routeState = {
            ...current.routeState,
            radar: { noteId: typeof payload === 'string' ? payload : String(payload?.noteId || '') }
        };
    }
    current.screen = target;
    return current;
}

function toggleSplitViewState({ splitMode, activePaneIndex, panes }) {
    if (splitMode) {
        const focused = clonePaneState(panes[activePaneIndex] || panes[0]);
        return {
            splitMode: false,
            activePaneIndex: 0,
            panes: [focused, clonePaneState(focused)]
        };
    }
    const primary = clonePaneState(panes[0]);
    return {
        splitMode: true,
        activePaneIndex,
        panes: [primary, clonePaneState(primary)]
    };
}

function cyclePaneIndex(activePaneIndex) {
    return activePaneIndex === 0 ? 1 : 0;
}

function updatePaneStateAt(panes, paneIndex, updater) {
    let changed = false;
    const next = panes.map((pane, index) => {
        if (index !== paneIndex) return pane;
        const updated = updater(clonePaneState(pane));
        if (!samePaneState(pane, updated)) changed = true;
        return changed ? updated : pane;
    });
    return changed ? next : panes;
}

function summarizePaneStatus(splitMode, activePaneIndex) {
    if (!splitMode) return '';
    return activePaneIndex === 0
        ? '◉ left  ○ right'
        : '○ left  ◉ right';
}

function applyStreamEventData(current, event) {
    return {
        ...current,
        activity: [
            {
                timestamp: event.timestamp || new Date().toISOString(),
                type: event.type || 'event',
                label: humanEventLabel(event.type),
                noteId: event.noteId || ''
            },
            ...(current.activity || [])
        ].slice(0, 8)
    };
}

function App({ ink, TextInput, host, port, initialData, vaultPath }) {
    const { Box, Text, useApp, useInput, useStdout } = ink;
    const { exit } = useApp();
    const { stdout } = useStdout();
    const [splitMode, setSplitMode] = React.useState(false);
    const [activePaneIndex, setActivePaneIndex] = React.useState(0);
    const [panes, setPanes] = React.useState(() => [createPaneState('briefing', {}), createPaneState('briefing', {})]);
    const [connState, setConnState] = React.useState('connecting');
    const [dataError, setDataError] = React.useState('');
    const [showHelp, setShowHelp] = React.useState(false);
    const [showPalette, setShowPalette] = React.useState(false);
    const [showCapture, setShowCapture] = React.useState(false);
    const [showWarp, setShowWarp] = React.useState(false);
    const [warpQuery, setWarpQuery] = React.useState('');
    const [toast, setToast] = React.useState({ msg: '', err: false });
    const [paletteLoading, setPaletteLoading] = React.useState(false);
    const [paletteItems, setPaletteItems] = React.useState([]);
    const [peek, setPeek] = React.useState({ open: false, note: null, detail: null, intelligence: null, bodyLines: [], loading: false, error: '' });
    const [noteView, setNoteView] = React.useState({ open: false, noteId: '' });
    const [data, setData] = React.useState(() => ({
        pulse: initialData?.pulse || {},
        typesList: initialData?.typesList || [],
        tasks: initialData?.tasks || [],
        activity: initialData?.initialActivity || [],
        sessionDelta: initialData?.sessionDelta || null
    }));

    const [lastSessionTs, setLastSessionTs] = React.useState(null);
    const [graphVersion, setGraphVersion] = React.useState(0);

    React.useEffect(() => {
        if (!vaultPath) return;
        const prev = readLastSessionTimestamp(vaultPath);
        setLastSessionTs(prev);
        writeLastSessionTimestamp(vaultPath);
    }, [vaultPath]);

    const toastTimerRef = React.useRef(null);
    const bookmarksRef = React.useRef({});
    const bookmarkPendingRef = React.useRef(null);
    const bookmarkTimerRef = React.useRef(null);

    const bookmarksFile = vaultPath ? getBookmarksPath(vaultPath) : '';

    const showToast = React.useCallback((msg, err = false) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, err });
        toastTimerRef.current = setTimeout(() => setToast({ msg: '', err: false }), err ? 3000 : 2500);
    }, []);

    React.useEffect(() => {
        if (!bookmarksFile || !vaultPath) return;
        bookmarksRef.current = readScopedJson(bookmarksFile, vaultPath, {});
    }, [bookmarksFile, vaultPath]);

    const activePaneIndexRef = React.useRef(activePaneIndex);
    React.useEffect(() => { activePaneIndexRef.current = activePaneIndex; });

    const navigate = React.useCallback((target, payload, paneIndex) => {
        const idx = typeof paneIndex === 'number' ? paneIndex : activePaneIndexRef.current;
        setPanes((current) => updatePaneStateAt(current, idx, (pane) => updatePaneRoute(pane, target, payload)));
    }, []);

    const refresh = React.useCallback(async () => {
        try {
            const nextData = await fetchBriefingData(host, port, lastSessionTs);
            setDataError('');
            setData((current) => ({
                pulse: nextData.pulse,
                typesList: nextData.typesList || current.typesList || [],
                tasks: nextData.tasks,
                activity: current.activity && current.activity.length ? current.activity : (nextData.initialActivity || []),
                sessionDelta: nextData.sessionDelta || current.sessionDelta || null
            }));
        } catch (err) {
            setDataError(err.message || String(err));
        }
    }, [host, port, lastSessionTs]);

    const openNoteView = React.useCallback((id) => {
        if (!id) return;
        setNoteView({ open: true, noteId: String(id) });
    }, []);

    const textInputScreens = new Set(['query', 'navigator', 'search']);
    const overlayActive = showHelp || showPalette || showCapture || peek.open || noteView.open || showWarp;
    const currentPane = panes[activePaneIndex] || panes[0];
    const currentScreen = currentPane?.screen || 'briefing';
    const paneWidth = Math.max(36, Math.floor(((stdout?.columns || termWidth()) / 2)) - 1);

    const paletteCommands = React.useMemo(() => [
        { id: 'briefing',  label: 'briefing',   description: 'Vault pulse, activity, open tasks',  action: () => navigate('briefing') },
        { id: 'search',    label: 'search',     description: 'Full-text vault search',              action: () => navigate('search') },
        { id: 'explorer',  label: 'explorer',   description: 'Browse and edit notes by type',       action: () => navigate('explorer') },
        { id: 'query',     label: 'query',      description: 'Run a query against the vault',       action: () => navigate('query') },
        { id: 'navigator', label: 'navigator',  description: 'Search notes by type',               action: () => navigate('navigator') },
        { id: 'graph',     label: 'graph',      description: 'Graph traversal — follow connections',action: () => navigate('graph') },
        { id: 'health',    label: 'health',     description: 'Schema coverage and vault health',    action: () => navigate('health') },
        { id: 'diff',      label: 'diff',       description: 'Vault changes since last session',    action: () => navigate('diff') },
        { id: 'radar',     label: 'radar',      description: 'Radial connection map for current note', action: () => navigate('radar') },
        { id: 'trends',    label: 'trends',     description: 'Vault projections and staleness forecast', action: () => navigate('trends') },
        { id: 'new-note',  label: 'new note',   description: 'Create a note (Explorer → [n])',      action: () => navigate('explorer') },
        { id: 'help',      label: 'help',       description: 'Show keyboard shortcuts',             action: () => setShowHelp(true) },
    ], [navigate]);

    React.useEffect(() => {
        if (!showPalette) return;
        let cancelled = false;
        setPaletteItems(paletteCommands);
        setPaletteLoading(true);
        Promise.all([
            getNodes({ host, port }).catch(() => []),
            getTypes({ host, port }).catch(() => [])
        ]).then(([nodes, types]) => {
            if (cancelled) return;
            setPaletteItems(buildPaletteItems(paletteCommands, nodes, types, navigate, setShowHelp));
            setPaletteLoading(false);
        });
        return () => { cancelled = true; };
    }, [showPalette, paletteCommands, host, port, navigate]);

    const loadTypeArcSuggestions = React.useCallback(async ({ host: targetHost, port: targetPort, type }) => {
        const nodes = await getNodes({ host: targetHost, port: targetPort, type });
        const sample = Array.isArray(nodes) ? nodes.find((node) => String(node.id || '').trim()) : null;
        if (!sample) return { arc: { missingFields: [] } };
        return getNoteIntelligence({ host: targetHost, port: targetPort, id: sample.id });
    }, []);

    const openPeek = React.useCallback((id) => {
        if (!id) return;
        setPeek({ open: true, note: { id, label: id, type: '' }, detail: null, intelligence: null, bodyLines: [], loading: true, error: '' });
        Promise.all([
            getNode({ host, port, id }),
            getNoteIntelligence({ host, port, id }).catch(() => null)
        ]).then(async ([detail, intelligence]) => {
            const bodyLines = detail?._filePath ? await readNoteBody(detail._filePath) : [];
            setPeek({
                open: true,
                note: {
                    id: String(detail?.id || id),
                    label: String(detail?.name || detail?.title || detail?.id || id),
                    type: String(detail?.type || ''),
                    status: String(detail?.status || ''),
                    inbound: Array.isArray(detail?._inbound) ? detail._inbound.length : 0
                },
                detail,
                intelligence,
                bodyLines,
                loading: false,
                error: ''
            });
        }).catch((error) => {
            setPeek({ open: true, note: null, detail: null, intelligence: null, bodyLines: [], loading: false, error: error.message || String(error) });
        });
    }, [host, port]);

    const restoreBookmark = React.useCallback((digit) => {
        const entry = bookmarksRef.current[String(digit)];
        if (!entry) {
            showToast(`bookmark ${digit} not set`, true);
            return;
        }
        if (entry.screen === 'query') {
            navigate('query', { query: entry.query || '' }, activePaneIndex);
        } else if (entry.screen === 'search') {
            navigate('search', { query: entry.query || '' }, activePaneIndex);
        } else if (entry.screen === 'navigator') {
            navigate('navigator', { query: entry.query || '', noteId: entry.noteId || '' }, activePaneIndex);
        } else if (entry.screen === 'graph') {
            navigate('graph', { noteId: entry.noteId || '' }, activePaneIndex);
        } else if (entry.screen === 'explorer') {
            navigate('explorer', { noteId: entry.noteId || '', filterText: entry.query || '', typeFilter: entry.typeFilter || 'all' }, activePaneIndex);
        } else {
            navigate(entry.screen || 'briefing', undefined, activePaneIndex);
        }
        showToast(`→ bookmark ${digit}`);
    }, [activePaneIndex, navigate, showToast]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            exit();
            return;
        }
        if (bookmarkPendingRef.current && /^[0-9]$/.test(input)) {
            const digit = input;
            const pending = bookmarkPendingRef.current;
            bookmarkPendingRef.current = null;
            if (bookmarkTimerRef.current) clearTimeout(bookmarkTimerRef.current);
            if (pending === 'set') {
                const pane = panes[activePaneIndex] || createPaneState('briefing', {});
                const current = pane.routeState?.[pane.screen] || {};
                const entry = {
                    screen: pane.screen,
                    noteId: current.noteId || '',
                    query: current.query || current.filterText || '',
                    typeFilter: current.typeFilter || ''
                };
                bookmarksRef.current = { ...bookmarksRef.current, [digit]: entry };
                if (bookmarksFile && vaultPath) writeScopedJson(bookmarksFile, vaultPath, bookmarksRef.current);
                showToast(`bookmark ${digit} set`);
            } else if (pending === 'jump') {
                restoreBookmark(digit);
            }
            return;
        }
        if (overlayActive) return;
        if (input === '|') {
            const next = toggleSplitViewState({ splitMode, activePaneIndex, panes });
            setSplitMode(next.splitMode);
            setActivePaneIndex(next.activePaneIndex);
            setPanes(next.panes);
            return;
        }
        if (splitMode && key.tab) {
            setActivePaneIndex((index) => cyclePaneIndex(index));
            return;
        }
        if (splitMode && activePaneIndex === 1 && input === 'q' && !textInputScreens.has(currentScreen)) {
            const next = toggleSplitViewState({ splitMode, activePaneIndex, panes });
            setSplitMode(next.splitMode);
            setActivePaneIndex(next.activePaneIndex);
            setPanes(next.panes);
            return;
        }
        if (input === '?') {
            setShowHelp((value) => !value);
            return;
        }
        if ((input === ':' && !textInputScreens.has(currentScreen)) || (key.ctrl && input === 'p')) {
            setShowPalette(true);
            return;
        }
        if (input === 'c' && !textInputScreens.has(currentScreen)) {
            setShowCapture(true);
            return;
        }
        if (input === 'm' && !textInputScreens.has(currentScreen)) {
            bookmarkPendingRef.current = 'set';
            if (bookmarkTimerRef.current) clearTimeout(bookmarkTimerRef.current);
            bookmarkTimerRef.current = setTimeout(() => { bookmarkPendingRef.current = null; }, 1000);
            return;
        }
        if (input === '\'' && !textInputScreens.has(currentScreen)) {
            bookmarkPendingRef.current = 'jump';
            if (bookmarkTimerRef.current) clearTimeout(bookmarkTimerRef.current);
            bookmarkTimerRef.current = setTimeout(() => { bookmarkPendingRef.current = null; }, 1000);
            return;
        }
        if (!textInputScreens.has(currentScreen)) {
            if (input === '1') { navigate('briefing', undefined, activePaneIndex); return; }
            if (input === '2') { navigate('query', undefined, activePaneIndex); return; }
            if (input === '3') { navigate('navigator', undefined, activePaneIndex); return; }
            if (input === '4') { navigate('explorer', undefined, activePaneIndex); return; }
            if (input === '5') { navigate('health', undefined, activePaneIndex); return; }
            if (input === '6') { navigate('search', undefined, activePaneIndex); return; }
            if (input === '7') { navigate('graph', undefined, activePaneIndex); return; }
            if (input === '8') { navigate('diff', undefined, activePaneIndex); return; }
            if (input === '9') { navigate('radar', undefined, activePaneIndex); return; }
            if (input === '0') { navigate('trends', undefined, activePaneIndex); return; }
        }
        // Any unhandled printable char on non-text screens triggers warp navigation.
        // Ink's useInput has no stopPropagation — every mounted screen's own
        // useInput hook and this global one both fire for the same keypress —
        // so a screen-owned single-letter shortcut needs an explicit carve-out
        // here or Warp always wins (this is exactly why `navigator` is a
        // textInputScreens member: its own 'v'/'o'/'g'/'p' keys are only safe
        // because the whole catch-all is skipped for that screen).
        const screenReservedKey = currentScreen === 'graph' && input === 'v';
        if (!textInputScreens.has(currentScreen) && !screenReservedKey && input && input.charCodeAt(0) >= 32) {
            setWarpQuery(input);
            setShowWarp(true);
            return;
        }
    }, { isActive: true });

    React.useEffect(() => {
        refresh().catch(() => {});
    }, [refresh]);

    useEventStream({
        host,
        port,
        onConnect() {
            setConnState('live');
        },
        onDisconnect() {
            setConnState('disconnected');
        },
        onEvent(event) {
            if (event.type === 'connected') { setConnState('live'); return; }
            setData((current) => applyStreamEventData(current, event));
            if (event.type === 'rebuild') {
                refresh().catch(() => {});
            }
            if (event.type === 'relation_added' || event.type === 'relation_changed' || event.type === 'rebuild') {
                setGraphVersion((v) => v + 1);
            }
        }
    });

    function handlePaneStateChange(paneIndex, screenName, state) {
        setPanes((current) => updatePaneStateAt(current, paneIndex, (pane) => {
            const previous = pane.routeState?.[screenName] || {};
            if (shallowEqualObject(previous, state || {})) return pane;
            return {
                ...pane,
                routeState: {
                    ...pane.routeState,
                    [screenName]: state
                }
            };
        }));
    }

    function renderScreenNode(pane, paneIndex) {
        const paneScreen = pane?.screen || 'briefing';
        const paneRoute = pane?.routeState || {};
        const paneDisabled = overlayActive || (splitMode && paneIndex !== activePaneIndex);
        const onPaneNavigate = (target, payload) => navigate(target, payload, paneIndex);
        const common = {
            ink,
            host,
            port,
            onNavigate: onPaneNavigate,
            onQuit: exit,
            width: splitMode ? paneWidth : undefined,
            splitMode
        };

        if (paneScreen === 'query') {
            return React.createElement(Query, {
                ...common,
                TextInput,
                runQuery,
                initialQuery: paneRoute.query?.query || '',
                onStateChange: (state) => handlePaneStateChange(paneIndex, 'query', state),
                onNoteView: openNoteView,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'navigator') {
            return React.createElement(Navigator, {
                ...common,
                TextInput,
                getTypes,
                getNodes,
                initialQuery: paneRoute.navigator?.query || '',
                initialId: paneRoute.navigator?.noteId || '',
                onStateChange: (state) => handlePaneStateChange(paneIndex, 'navigator', state),
                onPeek: openPeek,
                onNoteView: openNoteView,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'explorer') {
            return React.createElement(Explorer, {
                ...common,
                getNode,
                getNoteIntelligence,
                getTypes,
                getNodes,
                getMutations,
                patchNode,
                patchNodesBulk,
                postNode,
                deleteNode,
                vaultPath,
                initialId: paneRoute.explorer?.noteId || '',
                initialType: paneRoute.explorer?.typeFilter || 'all',
                initialFilterText: paneRoute.explorer?.filterText || '',
                initialMode: paneRoute.explorer?.mode || '',
                onStateChange: (state) => handlePaneStateChange(paneIndex, 'explorer', state),
                onPeek: openPeek,
                onNoteView: openNoteView,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'health') {
            return React.createElement(Health, {
                ...common,
                getHealth,
                getTypes,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'search') {
            return React.createElement(Search, {
                ...common,
                runSearch,
                initialQuery: paneRoute.search?.query || '',
                onStateChange: (state) => handlePaneStateChange(paneIndex, 'search', state),
                onPeek: openPeek,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'graph') {
            return React.createElement(Graph, {
                ...common,
                getNode,
                getTypes,
                getNodes,
                initialId: paneRoute.graph?.noteId || '',
                graphVersion,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'diff') {
            return React.createElement(Diff, {
                ...common,
                getDiff,
                lastSessionTs,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'radar') {
            return React.createElement(Radar, {
                ...common,
                centerId: paneRoute.radar?.noteId || '',
                getNeighborhood,
                disabled: paneDisabled
            });
        }
        if (paneScreen === 'trends') {
            return React.createElement(Trends, {
                ...common,
                getTrends,
                disabled: paneDisabled
            });
        }
        return React.createElement(Briefing, {
            ...common,
            data,
            connState,
            dataError,
            lastSessionTs,
            disabled: paneDisabled
        });
    }

    const screenNode = splitMode
        ? React.createElement(
            Box,
            { flexDirection: 'row', width: '100%' },
            React.createElement(SplitPane, {
                ink,
                pane: panes[0],
                isActive: activePaneIndex === 0,
                paneIndex: 0,
                width: paneWidth
            }, renderScreenNode(panes[0], 0)),
            React.createElement(Box, { marginX: 0 },
                React.createElement(Text, null, p.faint(SYM.pipe))
            ),
            React.createElement(SplitPane, {
                ink,
                pane: panes[1],
                isActive: activePaneIndex === 1,
                paneIndex: 1,
                width: paneWidth
            }, renderScreenNode(panes[1], 1))
        )
        : renderScreenNode(panes[0], 0);

    return React.createElement(
        Box,
        { flexDirection: 'column', width: '100%' },
        showPalette
            ? React.createElement(CommandPalette, {
                ink,
                commands: paletteItems,
                loading: paletteLoading,
                onClose: () => setShowPalette(false)
            })
            : null,
        showCapture
            ? React.createElement(QuickCapture, {
                ink,
                host,
                port,
                getTypes,
                loadTypeArcSuggestions,
                postNode,
                onToast: showToast,
                onClose: () => setShowCapture(false)
            })
            : null,
        noteView.open
            ? React.createElement(NoteView, {
                ink,
                noteId: noteView.noteId,
                host,
                port,
                getNode,
                getNoteIntelligence,
                onClose: () => setNoteView({ open: false, noteId: '' })
            })
            : showWarp
                ? React.createElement(Warp, {
                    ink,
                    initialQuery: warpQuery,
                    commands: paletteCommands,
                    typesList: data.typesList,
                    getNodes,
                    host,
                    port,
                    onNavigate: navigate,
                    onClose: () => setShowWarp(false)
                })
                : screenNode,
        peek.open
            ? React.createElement(Peek, {
                ink,
                note: peek.note,
                nodeDetail: peek.detail,
                intelligence: peek.intelligence,
                bodyLines: peek.bodyLines,
                loading: peek.loading,
                error: peek.error,
                onClose: () => setPeek({ open: false, note: null, detail: null, intelligence: null, bodyLines: [], loading: false, error: '' }),
                onOpen: () => openInEditor(peek.detail?._filePath || ''),
                onEdit: () => {
                    setPeek({ open: false, note: null, detail: null, intelligence: null, bodyLines: [], loading: false, error: '' });
                    navigate('explorer', { noteId: peek.note?.id || '', mode: 'edit-pick' });
                }
            })
            : null,
        showHelp
            ? React.createElement(HelpOverlay, {
                ink,
                bindings: [
                    { key: '[1]', action: 'Briefing — vault pulse' },
                    { key: '[2]', action: 'Query — run queries' },
                    { key: '[3]', action: 'Navigator — search notes' },
                    { key: '[4]', action: 'Explorer — browse by type' },
                    { key: '[5]', action: 'Health — schema & coverage' },
                    { key: '[6]', action: 'Search — full-text vault search' },
                    { key: '[7]', action: 'Graph — traverse note connections' },
                    { key: '[8]', action: 'Diff — vault changes over time' },
                    { key: '[9]', action: 'Radar — radial connection map' },
                    { key: '[0]', action: 'Trends — projections and stale forecast' },
                    { key: '[:/Ctrl+P]', action: 'command palette' },
                    { key: '[c]', action: 'quick capture' },
                    { key: '[m0-9]', action: 'set bookmark' },
                    { key: '[\'0-9]', action: 'jump bookmark' },
                    { key: '[|]', action: 'toggle split view' },
                    { key: '[Tab]', action: 'switch active pane (split mode)' },
                    { key: '[e]', action: 'edit field (Explorer)' },
                    { key: '[o]', action: 'open note body in $EDITOR (Explorer)' },
                    { key: '[v]', action: 'view note — full rendered body' },
                    { key: '[p]', action: 'peek note detail' },
                    { key: '[H]', action: 'note history (Explorer)' },
                    { key: '[]]', action: 'follow outbound link (Explorer)' },
                    { key: '[[[]', action: 'follow inbound link (Explorer)' },
                    { key: '[S]', action: 'save context (Explorer)' },
                    { key: '[R]', action: 'restore context (Explorer)' },
                    { key: '[n]', action: 'new note (Explorer)' },
                    { key: '[D]', action: 'delete note (Explorer)' },
                    { key: '[g]', action: 'graph this note (Explorer)' },
                    { key: '[r]', action: 'radar this note (Explorer)' },
                    { key: '[Esc]', action: 'back / cancel' },
                    { key: '[?]', action: 'close help' },
                    { key: '[any letter]', action: 'warp — type to jump anywhere' },
                    { key: '[Ctrl+C]', action: 'quit' }
                ]
            })
            : null,
        toast.msg
            ? React.createElement(Box, { paddingX: 1 }, React.createElement(Text, null, toast.err ? p.err('  ' + toast.msg) : p.ok('  ' + toast.msg)))
            : null,
        React.createElement(Text, null, p.faint('─'.repeat(termWidth()))),
        React.createElement(StatusBar, {
            ink,
            noteCount: data.pulse?.notes || 0,
            connState,
            host,
            port,
            screen: currentScreen,
            splitMode,
            paneStatus: summarizePaneStatus(splitMode, activePaneIndex)
        })
    );
}

App.fetchBriefingData = fetchBriefingData;
App.buildPaletteItems = buildPaletteItems;
App.buildSessionDelta = buildSessionDelta;
App.createPaneState = createPaneState;
App.updatePaneRoute = updatePaneRoute;
App.toggleSplitViewState = toggleSplitViewState;
App.cyclePaneIndex = cyclePaneIndex;
App.summarizePaneStatus = summarizePaneStatus;
App.applyStreamEventData = applyStreamEventData;

module.exports = App;
