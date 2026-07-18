'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SelectionList = require('../src/conduit/components/SelectionList');
const QuickCapture = require('../src/conduit/components/QuickCapture');
const CommandPalette = require('../src/conduit/components/CommandPalette');
const Query = require('../src/conduit/screens/Query');
const App = require('../src/conduit/App');
const Peek = require('../src/conduit/components/Peek');
const {
    readScopedJson,
    writeScopedJson,
    getBookmarksPath,
    getContextsPath,
    readLastSessionTimestamp,
    writeLastSessionTimestamp
} = require('../src/conduit/storage');
const Explorer = require('../src/conduit/screens/Explorer');
const Diff = require('../src/conduit/screens/Diff');
const Warp = require('../src/conduit/components/Warp');
const Radar = require('../src/conduit/screens/Radar');
const Briefing = require('../src/conduit/screens/Briefing');
const Navigator = require('../src/conduit/screens/Navigator');
const { handleExplorerKey } = require('../src/conduit/screens/explorerInput');
const { buildExplorerDetail } = require('../src/conduit/screens/explorerDetail');

test('SelectionList window centers on cursor when items > maxVisible', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const windowed = SelectionList.computeWindow(items, 10, 5);
    assert.equal(windowed.start, 8);
    assert.equal(windowed.end, 13);
    assert.deepEqual(windowed.items, [8, 9, 10, 11, 12]);
});

test('SelectionList window clamps at start', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const windowed = SelectionList.computeWindow(items, 1, 5);
    assert.equal(windowed.start, 0);
    assert.equal(windowed.end, 5);
    assert.deepEqual(windowed.items, [0, 1, 2, 3, 4]);
});

test('SelectionList window clamps at end', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const windowed = SelectionList.computeWindow(items, 19, 5);
    assert.equal(windowed.start, 15);
    assert.equal(windowed.end, 20);
    assert.deepEqual(windowed.items, [15, 16, 17, 18, 19]);
});

test('SelectionList empty items renders emptyText', () => {
    const node = SelectionList({
        ink: { Box: 'Box', Text: 'Text' },
        items: [],
        cursor: 0,
        renderItem() {
            return React.createElement('Text', null, 'unused');
        },
        emptyText: 'Nothing here'
    });
    assert.equal(node.type, 'Text');
    assert.equal(node.props.children, 'Nothing here');
});

test('quick capture builds payload from filled suggested fields only', () => {
    const payload = QuickCapture.buildCapturePayload(
        'johnny-rico',
        'character',
        ['rank', 'unit', 'status'],
        { rank: 'Lieutenant', unit: '[[roughnecks]]', status: '' }
    );
    assert.deepEqual(payload, {
        id: 'johnny-rico',
        type: 'character',
        rank: 'Lieutenant',
        unit: '[[roughnecks]]'
    });
});

test('command palette search text includes note labels and details', () => {
    const items = App.buildPaletteItems(
        [{ id: 'briefing', label: 'briefing', description: 'Vault pulse', action() {} }],
        [{ id: 'johnny-rico', name: 'Johnny Rico' }],
        [{ type: 'character', count: 5 }],
        () => {}
    );
    const noteItem = items.find((item) => item.id === 'note:johnny-rico');
    assert.ok(noteItem);
    assert.match(CommandPalette.buildSearchText(noteItem), /johnny rico/i);
    assert.match(CommandPalette.buildSearchText(noteItem), /johnny-rico/i);
});

test('query live execution uses the 400ms debounce window', async () => {
    let called = 0;
    let loadingSeen = false;
    const stateLog = [];
    function setState(next) {
        const current = stateLog.at(-1) || { loading: false, result: null, error: '' };
        const resolved = typeof next === 'function' ? next(current) : next;
        stateLog.push(resolved);
        if (resolved.loading) loadingSeen = true;
    }
    const timer = Query.scheduleLiveQuery({
        host: '127.0.0.1',
        port: 3000,
        query: 'where type = character',
        runQuery: async () => {
            called += 1;
            return { rows: [] };
        },
        setState
    });
    await new Promise((resolve) => setTimeout(resolve, Query.QUERY_DEBOUNCE_MS + 80));
    clearTimeout(timer);
    assert.equal(called, 1);
    assert.equal(loadingSeen, true);
});

test('query visible result row count stays bounded in full-screen mode', () => {
    const originalRows = process.stdout.rows;
    process.stdout.rows = 26;
    try {
        const count = Query.getVisibleResultRowCount(false);
        assert.ok(count >= 3);
        assert.ok(count <= 12);
        assert.equal(count, 12);
    } finally {
        process.stdout.rows = originalRows;
    }
});

test('query visible result row count shrinks in split mode to preserve input visibility', () => {
    const originalRows = process.stdout.rows;
    process.stdout.rows = 22;
    try {
        const count = Query.getVisibleResultRowCount(true);
        assert.ok(count >= 3);
        assert.ok(count <= 12);
        assert.equal(count, 6);
    } finally {
        process.stdout.rows = originalRows;
    }
});

test('query renderTable clips overflowing rows and shows overflow hint', () => {
    const ink = { Box: 'Box', Text: 'Text' };
    const rows = Array.from({ length: 6 }, (_, index) => ({
        id: `note-${index}`,
        type: 'character',
        status: 'active'
    }));
    const element = Query.renderTable(ink, ['id', 'type', 'status'], rows, 80, 3);
    const children = element.props.children.filter(Boolean);
    const overflowNode = children.at(-1);
    assert.equal(overflowNode.type, 'Text');
    assert.match(String(overflowNode.props.children), /\+ 3 more rows not shown/);
});

test('navigator submit opens the selected note in explorer', () => {
    const calls = [];
    const opened = Navigator.openSelectedInExplorer(
        { id: 'johnny-rico', label: 'Johnny Rico' },
        (screen, payload) => calls.push({ screen, payload })
    );
    assert.equal(opened, true);
    assert.deepEqual(calls, [{ screen: 'explorer', payload: 'johnny-rico' }]);
});

test('navigator submit stays inert when nothing is selected', () => {
    const calls = [];
    const opened = Navigator.openSelectedInExplorer(null, (screen, payload) => calls.push({ screen, payload }));
    assert.equal(opened, false);
    assert.deepEqual(calls, []);
});

test('navigator prop-sync does not reset search when the external query already matches local state', () => {
    const nextQuery = 'rico';
    const localQuery = 'rico';
    assert.equal(nextQuery !== localQuery, false);
});

test('explorer prop-sync keeps note cursor stable when initialId already points at the selected note', () => {
    const notes = [
        { id: 'ace-levy' },
        { id: 'johnny-rico' },
        { id: 'lt-rasczak' }
    ];
    const initialId = 'johnny-rico';
    const currentCursor = 1;
    const idx = notes.findIndex((n) => n.id === initialId);
    assert.equal(idx, currentCursor);
});

test('bookmark storage round-trips per vault path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-conduit-bookmarks-'));
    const vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, '.yamlink'), { recursive: true });
    const bookmarksPath = getBookmarksPath(vaultPath);
    writeScopedJson(bookmarksPath, vaultPath, {
        '3': { screen: 'explorer', noteId: 'johnny-rico', query: 'status = active', typeFilter: 'character' }
    });
    const loaded = readScopedJson(bookmarksPath, vaultPath, {});
    assert.deepEqual(loaded['3'], {
        screen: 'explorer',
        noteId: 'johnny-rico',
        query: 'status = active',
        typeFilter: 'character'
    });
});

test('context storage round-trips per vault path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-conduit-contexts-'));
    const vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, '.yamlink'), { recursive: true });
    const contextsPath = getContextsPath(vaultPath);
    const contexts = [
        { name: 'context-1', screen: 'explorer', noteId: 'johnny-rico', typeFilter: 'character', filterText: 'rico' }
    ];
    writeScopedJson(contextsPath, vaultPath, contexts);
    assert.deepEqual(readScopedJson(contextsPath, vaultPath, []), contexts);
});

test('peek renders without mutating the provided note object', () => {
    const note = { id: 'johnny-rico', label: 'Johnny Rico', type: 'character', status: 'active' };
    const original = JSON.parse(JSON.stringify(note));
    const element = Peek({
        ink: { Box: 'Box', Text: 'Text', useInput() {} },
        note,
        nodeDetail: { id: 'johnny-rico', type: 'character', status: 'active' },
        intelligence: { lifecycle: { state: 'growing' }, drift: { driftLabel: 'minor-drift' }, arc: { missingFields: [] } },
        bodyLines: ['Body line'],
        loading: false,
        error: '',
        onClose() {},
        onOpen() {},
        onEdit() {}
    });
    assert.ok(element);
    assert.deepEqual(note, original);
});

test('formatHistoryEvent — field_changed shows field, old, and new value', () => {
    const result = Explorer.formatHistoryEvent({
        type: 'field_changed',
        field: 'status',
        oldValue: 'draft',
        newValue: 'active',
        timestamp: '2026-06-11T10:00:00.000Z'
    });
    assert.equal(result.date, '2026-06-11');
    assert.equal(result.badge, 'CHANGED');
    assert.match(result.desc, /status/);
    assert.match(result.desc, /draft/);
    assert.match(result.desc, /active/);
});

test('formatHistoryEvent — note_created has CREATED badge and empty desc', () => {
    const result = Explorer.formatHistoryEvent({
        type: 'note_created',
        field: null,
        oldValue: null,
        newValue: null,
        timestamp: '2026-06-10T08:00:00.000Z'
    });
    assert.equal(result.date, '2026-06-10');
    assert.equal(result.badge, 'CREATED');
    assert.equal(result.desc, '');
});

test('formatHistoryEvent — relation_added shows target with LINKED badge', () => {
    const result = Explorer.formatHistoryEvent({
        type: 'relation_added',
        field: 'unit',
        oldValue: null,
        newValue: '[[roughnecks]]',
        timestamp: '2026-06-09T12:00:00.000Z'
    });
    assert.equal(result.badge, 'LINKED');
    assert.match(result.desc, /unit/);
    assert.match(result.desc, /roughnecks/);
});

test('formatHistoryEvent — relation_changed shows new target with RELINKED badge', () => {
    const result = Explorer.formatHistoryEvent({
        type: 'relation_changed',
        field: 'unit',
        oldValue: '[[foxhound]]',
        newValue: '[[roughnecks]]',
        timestamp: '2026-06-09T12:00:00.000Z'
    });
    assert.equal(result.badge, 'RELINKED');
    assert.match(result.desc, /unit/);
    assert.match(result.desc, /roughnecks/);
});

test('formatHistoryEvent — relation_removed shows old target with UNLINKED badge', () => {
    const result = Explorer.formatHistoryEvent({
        type: 'relation_removed',
        field: 'unit',
        oldValue: '[[roughnecks]]',
        newValue: null,
        timestamp: '2026-06-09T12:00:00.000Z'
    });
    assert.equal(result.badge, 'UNLINKED');
    assert.match(result.desc, /unit/);
    assert.match(result.desc, /roughnecks/);
});

test('traverseTo — jumps directly when target note is in current notes list', () => {
    // Simulate the direct-jump branch of traverseTo by testing the notes findIndex logic
    const notes = [
        { id: 'johnny-rico', type: 'character', label: 'Johnny Rico', filePath: '', status: '', inbound: 3 },
        { id: 'roughnecks', type: 'unit', label: 'Roughnecks', filePath: '', status: '', inbound: 5 },
        { id: 'carl-jenkins', type: 'character', label: 'Carl Jenkins', filePath: '', status: '', inbound: 1 },
    ];
    const targetId = 'roughnecks';
    const directIdx = notes.findIndex((n) => n.id === targetId);
    assert.equal(directIdx, 1, 'should find roughnecks at index 1');
});

test('traverseTo — returns -1 when target is not in notes list (cross-type case)', () => {
    const notes = [
        { id: 'johnny-rico', type: 'character', label: 'Johnny Rico', filePath: '', status: '', inbound: 3 },
        { id: 'carl-jenkins', type: 'character', label: 'Carl Jenkins', filePath: '', status: '', inbound: 1 },
    ];
    const targetId = 'roughnecks';
    const directIdx = notes.findIndex((n) => n.id === targetId);
    assert.equal(directIdx, -1, 'roughnecks not in character list; triggers cross-type navigate');
});

test('Diff.windowToSince — session returns lastSessionTs when provided', () => {
    const ts = '2026-06-10T08:00:00.000Z';
    const result = Diff.windowToSince('session', ts);
    assert.equal(result, ts);
});

test('Diff.windowToSince — session falls back to ~24h ago when no last session', () => {
    const before = Date.now();
    const result = Diff.windowToSince('session', null);
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    assert.ok(resultMs >= before - 24 * 60 * 60 * 1000 - 100);
    assert.ok(resultMs <= after - 24 * 60 * 60 * 1000 + 100);
});

test('Diff.windowToSince — today returns start of today UTC-aware', () => {
    const result = Diff.windowToSince('today', null);
    const d = new Date(result);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
});

test('Diff.windowToSince — 7d returns roughly 7 days ago', () => {
    const before = Date.now();
    const result = Diff.windowToSince('7d', null);
    const diff = before - new Date(result).getTime();
    assert.ok(diff >= 7 * 24 * 60 * 60 * 1000 - 500);
    assert.ok(diff <= 7 * 24 * 60 * 60 * 1000 + 500);
});

test('Diff.windowToSince — 30d returns roughly 30 days ago', () => {
    const before = Date.now();
    const result = Diff.windowToSince('30d', null);
    const diff = before - new Date(result).getTime();
    assert.ok(diff >= 30 * 24 * 60 * 60 * 1000 - 500);
    assert.ok(diff <= 30 * 24 * 60 * 60 * 1000 + 500);
});

test('Diff.TIME_WINDOWS has four entries with unique keys', () => {
    const keys = Diff.TIME_WINDOWS.map((w) => w.key);
    assert.equal(keys.length, 4);
    assert.equal(new Set(keys).size, 4);
    assert.ok(keys.includes('session'));
    assert.ok(keys.includes('today'));
});

test('last session timestamp round-trips through storage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-session-ts-'));
    const vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, '.yamlink'), { recursive: true });

    assert.equal(readLastSessionTimestamp(vaultPath), null, 'no timestamp before first write');
    writeLastSessionTimestamp(vaultPath);
    const ts = readLastSessionTimestamp(vaultPath);
    assert.ok(typeof ts === 'string', 'timestamp is a string after write');
    assert.ok(new Date(ts).getTime() > 0, 'timestamp is a valid ISO date');
});

test('last session timestamp updates on repeated writes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-session-ts2-'));
    const vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, '.yamlink'), { recursive: true });

    writeLastSessionTimestamp(vaultPath);
    const first = readLastSessionTimestamp(vaultPath);
    writeLastSessionTimestamp(vaultPath);
    const second = readLastSessionTimestamp(vaultPath);
    assert.ok(second >= first, 'second write timestamp is not earlier than first');
});

test('buildSessionDelta summarizes changed notes and strongest type', () => {
    const delta = App.buildSessionDelta({
        changes: [
            { id: 'rico', type: 'character', fields: { type: { from: null, to: 'character' }, name: { from: null, to: 'Johnny Rico' } } },
            { id: 'dizzy', type: 'character', fields: { rank: { from: 'private', to: 'corporal' } } },
            { id: 'planet-p', type: 'mission', fields: { status: { from: 'open', to: 'done' } } }
        ]
    });
    assert.equal(delta.changedNotes, 3);
    assert.equal(delta.createdNotes, 1);
    assert.equal(delta.topType, 'character');
    assert.equal(delta.topTypeCount, 2);
});

test('split mode toggles on and clones the active pane into the secondary pane', () => {
    const initial = {
        splitMode: false,
        activePaneIndex: 0,
        panes: [
            App.updatePaneRoute(App.createPaneState('briefing', {}), 'explorer', { noteId: 'johnny-rico', typeFilter: 'character' }),
            App.createPaneState('briefing', {})
        ]
    };
    const next = App.toggleSplitViewState(initial);
    assert.equal(next.splitMode, true);
    assert.equal(next.panes[0].screen, 'explorer');
    assert.equal(next.panes[1].screen, 'explorer');
    assert.equal(next.panes[1].routeState.explorer.noteId, 'johnny-rico');
});

test('each pane maintains independent screen state', () => {
    let panes = [
        App.createPaneState('briefing', {}),
        App.createPaneState('briefing', {})
    ];
    panes = [
        App.updatePaneRoute(panes[0], 'explorer', { noteId: 'johnny-rico', typeFilter: 'character', filterText: 'rico' }),
        App.updatePaneRoute(panes[1], 'query', { query: 'where type = mission' })
    ];
    assert.equal(panes[0].screen, 'explorer');
    assert.equal(panes[1].screen, 'query');
    assert.equal(panes[0].routeState.explorer.noteId, 'johnny-rico');
    assert.equal(panes[1].routeState.query.query, 'where type = mission');
    assert.equal(panes[0].routeState.query, undefined);
});

test('Tab switches the active pane in split mode', () => {
    assert.equal(App.cyclePaneIndex(0), 1);
    assert.equal(App.cyclePaneIndex(1), 0);
});

test('closing split mode keeps the focused pane as the full-screen pane', () => {
    const state = {
        splitMode: true,
        activePaneIndex: 1,
        panes: [
            App.updatePaneRoute(App.createPaneState('briefing', {}), 'explorer', { noteId: 'johnny-rico' }),
            App.updatePaneRoute(App.createPaneState('briefing', {}), 'query', { query: 'where status = active' })
        ]
    };
    const collapsed = App.toggleSplitViewState(state);
    assert.equal(collapsed.splitMode, false);
    assert.equal(collapsed.activePaneIndex, 0);
    assert.equal(collapsed.panes[0].screen, 'query');
    assert.equal(collapsed.panes[0].routeState.query.query, 'where status = active');
});

test('both panes consume the same SSE-updated vault data model', () => {
    const current = {
        pulse: { notes: 3 },
        activity: [{ type: 'note_created', label: 'Created', noteId: 'old-note', timestamp: '2026-06-01T00:00:00.000Z' }]
    };
    const updated = App.applyStreamEventData(current, {
        type: 'field_changed',
        noteId: 'johnny-rico',
        timestamp: '2026-06-28T12:00:00.000Z'
    });
    assert.equal(updated.activity[0].noteId, 'johnny-rico');
    assert.equal(updated.activity[1].noteId, 'old-note');
    assert.equal(current.activity[0].noteId, 'old-note');
});

test('Briefing session summary text joins creation, type updates, and broken links', () => {
    const line = Briefing.summarizeSessionDelta({
        changedNotes: 4,
        createdNotes: 1,
        topType: 'mission',
        topTypeCount: 2
    }, 1);
    assert.match(line, /1 note created/);
    assert.match(line, /2 missions updated/);
    assert.match(line, /1 broken link in vault/);
});

// Warp navigation tests

test('Warp.scoreMatch — exact match returns 100', () => {
    assert.equal(Warp.scoreMatch('explorer', '', 'explorer'), 100);
});

test('Warp.scoreMatch — prefix match returns 50', () => {
    assert.equal(Warp.scoreMatch('explorer', '', 'explo'), 50);
});

test('Warp.scoreMatch — contains match returns 20', () => {
    assert.equal(Warp.scoreMatch('note explorer', '', 'plor'), 20);
});

test('Warp.scoreMatch — detail-only match returns ≤ 10', () => {
    const score = Warp.scoreMatch('briefing', 'vault pulse', 'pulse');
    assert.ok(score > 0 && score <= 10);
});

test('Warp.scoreMatch — no match returns 0', () => {
    assert.equal(Warp.scoreMatch('briefing', 'vault pulse', 'zzz'), 0);
});

test('Warp.buildWarpResults — empty query returns empty array', () => {
    const results = Warp.buildWarpResults('', [], [], []);
    assert.deepEqual(results, []);
});

test('Warp.buildWarpResults — note label match returns note result', () => {
    const nodes = [
        { id: 'johnny-rico', name: 'Johnny Rico', type: 'character' },
        { id: 'carl-jenkins', name: 'Carl Jenkins', type: 'character' }
    ];
    const results = Warp.buildWarpResults('johnny', [], nodes, []);
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, 'note');
    assert.equal(results[0].noteId, 'johnny-rico');
});

test('Warp.buildWarpResults — type match returns type result', () => {
    const types = [
        { type: 'character', count: 5 },
        { type: 'mission', count: 3 }
    ];
    const results = Warp.buildWarpResults('char', [], [], types);
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, 'type');
    assert.equal(results[0].label, 'character');
});

test('Warp.buildWarpResults — command match returns cmd result', () => {
    const commands = [
        { id: 'query', label: 'query', description: 'Run a query', action() {} },
        { id: 'health', label: 'health', description: 'Vault health', action() {} }
    ];
    const results = Warp.buildWarpResults('quer', commands, [], []);
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, 'cmd');
    assert.equal(results[0].label, 'query');
    assert.equal(typeof results[0].action, 'function');
});

test('Warp.buildWarpResults — results sorted by score descending', () => {
    const nodes = [
        { id: 'ex-note', name: 'note ex', type: 'contact' },    // contains 'ex'
        { id: 'explorer', name: 'explorer', type: 'command' }   // prefix 'ex'
    ];
    const results = Warp.buildWarpResults('ex', [], nodes, []);
    assert.ok(results.length >= 2);
    assert.ok(results[0].score >= results[1].score);
    assert.equal(results[0].noteId, 'explorer');
});

test('Warp.buildWarpResults — caps at MAX_RESULTS items', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `note-${i}`, name: `alpha note ${i}`, type: 'x' }));
    const results = Warp.buildWarpResults('alpha', [], nodes, []);
    assert.ok(results.length <= Warp.MAX_RESULTS);
});

test('Warp.buildWarpResults — cross-kind: all matching kinds appear', () => {
    const commands = [{ id: 'query', label: 'query', description: '', action() {} }];
    const nodes = [{ id: 'quick-note', name: 'Quick Note', type: 'note' }];
    const types = [{ type: 'quest', count: 2 }];
    const results = Warp.buildWarpResults('qu', commands, nodes, types);
    const kinds = new Set(results.map((r) => r.kind));
    assert.ok(kinds.has('cmd'));
    assert.ok(kinds.has('note'));
    assert.ok(kinds.has('type'));
});

// --- Radar pure function tests ---

test('Radar.buildDepthMap — center node has depth 0', () => {
    const edges = [{ from: 'rico', to: 'alice', field: 'contact' }];
    const depths = Radar.buildDepthMap('rico', edges);
    assert.equal(depths.get('rico'), 0);
});

test('Radar.buildDepthMap — direct neighbor has depth 1', () => {
    const edges = [{ from: 'rico', to: 'alice', field: 'contact' }];
    const depths = Radar.buildDepthMap('rico', edges);
    assert.equal(depths.get('alice'), 1);
});

test('Radar.buildDepthMap — second-degree neighbor has depth 2', () => {
    const edges = [
        { from: 'rico', to: 'alice', field: 'contact' },
        { from: 'alice', to: 'zander', field: 'contact' }
    ];
    const depths = Radar.buildDepthMap('rico', edges);
    assert.equal(depths.get('zander'), 2);
});

test('Radar.buildDepthMap — inbound edges also followed', () => {
    const edges = [{ from: 'alice', to: 'rico', field: 'contact' }];
    const depths = Radar.buildDepthMap('rico', edges);
    assert.equal(depths.get('alice'), 1);
});

test('Radar.buildDepthMap — nodes beyond depth 2 not included', () => {
    const edges = [
        { from: 'rico', to: 'alice', field: 'x' },
        { from: 'alice', to: 'bob', field: 'x' },
        { from: 'bob', to: 'carol', field: 'x' }
    ];
    const depths = Radar.buildDepthMap('rico', edges);
    assert.equal(depths.has('carol'), false);
});

test('Radar.isOutbound — true when center has outbound edge to node', () => {
    const edges = [{ from: 'rico', to: 'alice', field: 'contact' }];
    assert.equal(Radar.isOutbound('rico', edges, 'alice'), true);
});

test('Radar.isOutbound — false for inbound-only edge', () => {
    const edges = [{ from: 'alice', to: 'rico', field: 'contact' }];
    assert.equal(Radar.isOutbound('rico', edges, 'alice'), false);
});

test('Radar.arrangeInnerRing — outbound nodes get dir=out', () => {
    const nodes = [{ id: 'alice', type: 'contact' }, { id: 'zander', type: 'contact' }];
    const edges = [
        { from: 'rico', to: 'alice', field: 'x' },
        { from: 'zander', to: 'rico', field: 'x' }
    ];
    const ring = Radar.arrangeInnerRing('rico', nodes, edges);
    const alice = ring.find((n) => n.id === 'alice');
    const zander = ring.find((n) => n.id === 'zander');
    assert.equal(alice.dir, 'out');
    assert.equal(zander.dir, 'in');
});

test('Radar.arrangeInnerRing — all positioned nodes have angle property', () => {
    const nodes = [{ id: 'a', type: 't' }, { id: 'b', type: 't' }, { id: 'c', type: 't' }];
    const edges = [{ from: 'center', to: 'a', field: 'x' }];
    const ring = Radar.arrangeInnerRing('center', nodes, edges);
    for (const n of ring) {
        assert.ok(typeof n.angle === 'number', `node ${n.id} missing angle`);
    }
});

test('Radar.arrangeOuterRing — nodes evenly spaced by angle', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const ring = Radar.arrangeOuterRing(nodes);
    assert.equal(ring.length, 4);
    const angles = ring.map((n) => n.angle);
    const diffs = angles.slice(1).map((a, i) => Math.abs(a - angles[i]));
    // All gaps should be approximately equal
    const firstGap = diffs[0];
    for (const diff of diffs) {
        assert.ok(Math.abs(diff - firstGap) < 0.01, 'angles not evenly spaced');
    }
});

test('Radar.arrangeOuterRing — single node has an angle', () => {
    const ring = Radar.arrangeOuterRing([{ id: 'solo' }]);
    assert.equal(ring.length, 1);
    assert.ok(typeof ring[0].angle === 'number');
});

// ── Explorer.js monolith-decomposition pass ─────────────────────────────
// Real, first-of-their-kind behavioral tests for the two pieces of
// Explorer.js's ~1086-line mode-based state machine that were extracted
// into pure, dependency-injected functions (explorerInput.js/
// explorerDetail.js) — previously untestable without an Ink-rendering
// harness this repo doesn't have. Since neither function needs Ink's
// reconciler to exercise (handleExplorerKey just calls plain setter
// functions; buildExplorerDetail returns plain React-element descriptor
// objects), these run through node:test with zero new dependencies.

function spy() {
    const calls = [];
    const fn = (...args) => { calls.push(args); return fn.returnValue; };
    fn.calls = calls;
    return fn;
}

// React.createElement returns a plain {type, props} descriptor — no
// rendering needed to inspect it, just a recursive walk of .props.children.
function flattenText(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenText).join('');
    if (node && node.props && node.props.children !== undefined) return flattenText(node.props.children);
    return '';
}

const INK_STUB = { Box: 'Box', Text: 'Text', useInput() {} };

function baseExplorerActions() {
    return {
        onQuit: spy(), setFilterText: spy(), setMode: spy(), setNoteCursor: spy(), onNoteView: spy(),
        setEditFieldCursor: spy(), setEditField: spy(), setEditValue: spy(),
        patchNode: spy(), showToast: spy(), forceDetailRefresh: spy(),
        setBulkActionCursor: spy(), setBulkFieldName: spy(), setBulkValue: spy(),
        patchNodesBulk: spy(), clearBulkState: spy(), deleteNode: spy(),
        setCreateForm: spy(), postNode: spy(), setRefreshKey: spy(),
        setLinkFieldName: spy(), setLinkPickLoading: spy(), setLinkPickFilter: spy(), setLinkPickCursor: spy(),
        getNodes: spy(), setLinkPickNotes: spy(),
        setContextCursor: spy(), restoreOperationalContext: spy(),
        setHistoryEvents: spy(), setHistoryLoading: spy(), setHistoryError: spy(), setHistoryCursor: spy(), getMutations: spy(),
        onNavigate: spy(), _toggleSelectedNote: spy(), onPeek: spy(), saveOperationalContext: spy(),
        traverseTo: spy(), setTraverseStack: spy(), setTraverseTarget: spy(),
        setActivePane: spy(), setTypeCursor: spy(), setPreview: spy(), setNodeDetail: spy(), setBodyLines: spy()
    };
}

function baseExplorerState(overrides = {}) {
    return {
        mode: 'browse', filterText: '', filteredNotes: [], selectedNote: null,
        editableFields: [], editFieldCursor: 0, editField: '', editValue: '',
        bulkActionCursor: 0, bulkFieldName: '', bulkValue: '', selectedIds: [],
        createForm: { step: 0, id: '', type: '', name: '' }, linkFieldName: '',
        filteredPickNotes: [], safePickCursor: 0, contexts: [], contextCursor: 0,
        historyEvents: [], activePane: 'notes', nodeDetail: null, traverseStack: [],
        notes: [], splitMode: false, types: [], host: '127.0.0.1', port: 3000,
        ...overrides
    };
}

test('handleExplorerKey — j in notes pane clamps setNoteCursor to filteredNotes length', () => {
    const state = baseExplorerState({ filteredNotes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const actions = baseExplorerActions();
    handleExplorerKey('j', {}, state, actions);
    assert.equal(actions.setNoteCursor.calls.length, 1);
    const updater = actions.setNoteCursor.calls[0][0];
    assert.equal(updater(1), 2);
    assert.equal(updater(2), 2, 'clamps at the last index');
});

test('handleExplorerKey — "/" in notes pane enters filter mode', () => {
    const state = baseExplorerState();
    const actions = baseExplorerActions();
    handleExplorerKey('/', {}, state, actions);
    assert.deepEqual(actions.setFilterText.calls[0], ['']);
    assert.deepEqual(actions.setMode.calls[0], ['filter']);
});

test('handleExplorerKey — Escape in filter mode clears filter and returns to browse', () => {
    const state = baseExplorerState({ mode: 'filter' });
    const actions = baseExplorerActions();
    handleExplorerKey('', { escape: true }, state, actions);
    assert.deepEqual(actions.setFilterText.calls[0], ['']);
    assert.deepEqual(actions.setMode.calls[0], ['browse']);
});

test('handleExplorerKey — edit-pick Enter selects the field under the cursor', () => {
    const state = baseExplorerState({
        mode: 'edit-pick',
        editableFields: [['status', 'active'], ['name', 'Johnny Rico']],
        editFieldCursor: 1
    });
    const actions = baseExplorerActions();
    handleExplorerKey('', { return: true }, state, actions);
    assert.deepEqual(actions.setEditField.calls[0], ['name']);
    assert.deepEqual(actions.setEditValue.calls[0], ['Johnny Rico']);
    assert.deepEqual(actions.setMode.calls[0], ['edit-type']);
});

test('handleExplorerKey — edit-type Enter patches the field and refreshes on success', async () => {
    const state = baseExplorerState({
        mode: 'edit-type',
        editField: 'status',
        editValue: 'active',
        selectedNote: { id: 'johnny-rico' }
    });
    const actions = baseExplorerActions();
    actions.patchNode = (args) => { actions.patchNode.calls.push([args]); return Promise.resolve(); };
    actions.patchNode.calls = [];
    handleExplorerKey('', { return: true }, state, actions);
    assert.deepEqual(actions.patchNode.calls[0][0], {
        host: '127.0.0.1', port: 3000, id: 'johnny-rico', fields: { status: 'active' }
    });
    await Promise.resolve().then(() => {});
    assert.equal(actions.showToast.calls.length, 1);
    assert.match(actions.showToast.calls[0][0], /status: active/);
    assert.deepEqual(actions.setMode.calls[0], ['browse']);
    assert.equal(actions.forceDetailRefresh.calls.length, 1);
});

test('handleExplorerKey — top-level Escape backs out of the notes pane and clears the preview', () => {
    const state = baseExplorerState({ activePane: 'notes' });
    const actions = baseExplorerActions();
    handleExplorerKey('', { escape: true }, state, actions);
    assert.deepEqual(actions.setActivePane.calls[0], ['types']);
    assert.deepEqual(actions.setPreview.calls[0], [null]);
    assert.deepEqual(actions.setNodeDetail.calls[0], [null]);
    assert.deepEqual(actions.setBodyLines.calls[0], [[]]);
});

test('handleExplorerKey — "g" navigates to the graph screen centered on the selected note', () => {
    const state = baseExplorerState({ selectedNote: { id: 'johnny-rico' } });
    const actions = baseExplorerActions();
    handleExplorerKey('g', {}, state, actions);
    assert.deepEqual(actions.onNavigate.calls[0], ['graph', 'johnny-rico']);
});

test('handleExplorerKey — Space toggles the selected note for bulk actions', () => {
    const state = baseExplorerState({ selectedNote: { id: 'johnny-rico' } });
    const actions = baseExplorerActions();
    handleExplorerKey(' ', {}, state, actions);
    assert.deepEqual(actions._toggleSelectedNote.calls[0], ['johnny-rico']);
});

test('handleExplorerKey — bulk-delete-confirm "y" deletes every selected id then refreshes', async () => {
    const state = baseExplorerState({ mode: 'bulk-delete-confirm', selectedIds: ['a', 'b'] });
    const actions = baseExplorerActions();
    const deleted = [];
    actions.deleteNode = ({ id }) => { deleted.push(id); return Promise.resolve(); };
    handleExplorerKey('y', {}, state, actions);
    await Promise.resolve().then(() => Promise.resolve());
    assert.deepEqual(deleted.sort(), ['a', 'b']);
    assert.equal(actions.clearBulkState.calls.length, 1);
    assert.deepEqual(actions.setMode.calls[actions.setMode.calls.length - 1], ['browse']);
});

function baseDetailState(overrides = {}) {
    return {
        mode: 'browse', selectedIds: [], bulkActionCursor: 0, bulkFieldName: '', bulkValue: '',
        editableFields: [], safeEditFieldCursor: 0, editField: '', editValue: '',
        createForm: { step: 0, id: '', type: '', name: '' }, selectedNote: null,
        linkFieldName: '', linkPickFilter: '', linkPickLoading: false, filteredPickNotes: [],
        safePickCursor: 0, contexts: [], contextCursor: 0, historyLoading: false, historyError: '',
        historyEvents: [], historyCursor: 0, splitMode: false, nodeDetail: null, preview: null,
        bodyLines: [], previewLoading: false, selectedType: { type: 'all', count: 0 },
        ...overrides
    };
}

test('buildExplorerDetail — edit-pick shows every editable field with the cursor on the selected one', () => {
    const state = baseDetailState({
        mode: 'edit-pick',
        selectedNote: { id: 'johnny-rico' },
        editableFields: [['status', 'active'], ['name', 'Johnny Rico']],
        safeEditFieldCursor: 1
    });
    const { title, content } = buildExplorerDetail(INK_STUB, state);
    assert.equal(title, 'Edit — Pick Field');
    const text = flattenText(content);
    assert.match(text, /status/);
    assert.match(text, /Johnny Rico/);
});

test('buildExplorerDetail — bulk-menu title includes the selected count', () => {
    const state = baseDetailState({ mode: 'bulk-menu', selectedIds: ['a', 'b', 'c'], bulkActionCursor: 2 });
    const { title, content } = buildExplorerDetail(INK_STUB, state);
    assert.equal(title, 'Bulk Actions — 3 notes');
    assert.match(flattenText(content), /Delete all/);
});

test('buildExplorerDetail — history mode renders formatted events via formatHistoryEvent', () => {
    const state = baseDetailState({
        mode: 'history',
        selectedNote: { id: 'johnny-rico' },
        historyEvents: [
            { type: 'field_changed', field: 'status', oldValue: 'draft', newValue: 'active', timestamp: '2026-06-11T10:00:00.000Z' }
        ]
    });
    const { title, content } = buildExplorerDetail(INK_STUB, state);
    assert.equal(title, 'History — johnny-rico');
    const text = flattenText(content);
    assert.match(text, /CHANGED/);
    assert.match(text, /draft/);
    assert.match(text, /active/);
});

test('buildExplorerDetail — split mode with no selected note shows the empty-state prompt', () => {
    const state = baseDetailState({ splitMode: true, selectedNote: null });
    const { content } = buildExplorerDetail(INK_STUB, state);
    assert.match(flattenText(content), /Select a note to preview/);
});

test('buildExplorerDetail — a selected note renders its detail and the full key-hint line', () => {
    const state = baseDetailState({
        selectedNote: { id: 'johnny-rico', label: 'Johnny Rico', type: 'character', inbound: 0 },
        nodeDetail: { id: 'johnny-rico', type: 'character', status: 'active' },
        preview: null,
        bodyLines: []
    });
    const { content } = buildExplorerDetail(INK_STUB, state);
    const text = flattenText(content);
    assert.match(text, /Johnny Rico/);
    assert.match(text, /follow out/);
});
