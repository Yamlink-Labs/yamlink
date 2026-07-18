'use strict';

const React = require('react');
const SelectionList = require('../components/SelectionList');
const Panel = require('../components/Panel');
const { p, SYM } = require('../palette');
const {
    SKIP_FIELDS,
    pad,
    readNoteBody
} = require('../noteDetail');
const {
    readScopedJson,
    writeScopedJson,
    getContextsPath
} = require('../storage');
const { formatHistoryEvent } = require('./explorerFormat');
const { renderTypeRow, renderNoteRow } = require('./explorerRows');
const { handleExplorerKey } = require('./explorerInput');
const { buildExplorerDetail } = require('./explorerDetail');

// Explorer.js — the 0.7.4 monolith-decomposition pass split this file's two
// largest pieces out into pure, testable modules (see TODO.md): the
// mode-dispatched keyboard handler (explorerInput.js) and the mode-dispatched
// detail-panel content builder (explorerDetail.js). This file is now the
// state-holding shell — every useState/useRef/useEffect/useCallback is
// unchanged from before the split; it just builds a `state`/`actions`
// snapshot each render and calls into the extracted modules instead of
// inlining their logic. No behavior changes.

function Explorer({
    ink, getNode, getNoteIntelligence, getTypes, getNodes,
    patchNode, patchNodesBulk, postNode, deleteNode, getMutations,
    host, port, initialId, initialType = 'all', initialFilterText = '', initialMode = '',
    onNavigate, onQuit, onStateChange, onPeek, onNoteView, disabled, vaultPath, width, splitMode
}) {
    const { Box, Text, useInput } = ink;
    const [activePane, setActivePane] = React.useState('types');
    const [typeCursor, setTypeCursor] = React.useState(0);
    const [noteCursor, setNoteCursor] = React.useState(0);
    const [types, setTypes] = React.useState([]);
    const [notes, setNotes] = React.useState([]);
    const [preview, setPreview] = React.useState(null);
    const [nodeDetail, setNodeDetail] = React.useState(null);
    const [previewLoading, setPreviewLoading] = React.useState(false);
    const [bodyLines, setBodyLines] = React.useState([]);
    const [refreshKey, setRefreshKey] = React.useState(0);

    const [mode, setMode] = React.useState('browse');
    const [filterText, setFilterText] = React.useState(initialFilterText);
    const [editFieldCursor, setEditFieldCursor] = React.useState(0);
    const [editField, setEditField] = React.useState('');
    const [editValue, setEditValue] = React.useState('');
    const [selectedIds, setSelectedIds] = React.useState([]);
    const [bulkActionCursor, setBulkActionCursor] = React.useState(0);
    const [bulkFieldName, setBulkFieldName] = React.useState('');
    const [bulkValue, setBulkValue] = React.useState('');
    const [createForm, setCreateForm] = React.useState({ step: 0, id: '', type: '', name: '' });
    const [linkFieldName, setLinkFieldName] = React.useState('');
    const [linkPickNotes, setLinkPickNotes] = React.useState([]);
    const [linkPickFilter, setLinkPickFilter] = React.useState('');
    const [linkPickCursor, setLinkPickCursor] = React.useState(0);
    const [linkPickLoading, setLinkPickLoading] = React.useState(false);
    const [loadError, setLoadError] = React.useState('');
    const [contexts, setContexts] = React.useState([]);
    const [contextCursor, setContextCursor] = React.useState(0);
    const [toast, setToast] = React.useState({ msg: '', err: false });
    const [historyEvents, setHistoryEvents] = React.useState([]);
    const [historyLoading, setHistoryLoading] = React.useState(false);
    const [historyCursor, setHistoryCursor] = React.useState(0);
    const [historyError, setHistoryError] = React.useState('');
    const [traverseTarget, setTraverseTarget] = React.useState(null);
    const [traverseStack, setTraverseStack] = React.useState([]);

    const toastTimerRef = React.useRef(null);
    const previewTimerRef = React.useRef(null);
    const jumpedRef = React.useRef(null);
    const initialModeAppliedRef = React.useRef(false);

    const showToast = React.useCallback((msg, err = false) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, err });
        toastTimerRef.current = setTimeout(() => setToast({ msg: '', err: false }), err ? 3000 : 2500);
    }, []);

    const onStateChangeRef = React.useRef(onStateChange);
    React.useEffect(() => { onStateChangeRef.current = onStateChange; });

    const contextsFile = vaultPath ? getContextsPath(vaultPath) : '';

    React.useEffect(() => {
        if (!contextsFile || !vaultPath) return;
        const stored = readScopedJson(contextsFile, vaultPath, []);
        setContexts(Array.isArray(stored) ? stored : []);
    }, [contextsFile, vaultPath]);

    React.useEffect(() => {
        getTypes({ host, port })
            .then((result) => {
                const raw = Array.isArray(result) ? result : [];
                const total = raw.reduce((sum, entry) => sum + Number(entry?.count || 0), 0);
                const nextTypes = [{ type: 'all', count: total }].concat(
                    raw.map((entry) => ({ type: String(entry.type || ''), count: Number(entry.count || 0) }))
                        .filter((entry) => entry.type)
                );
                setTypes(nextTypes);
                if (initialType) {
                    const index = nextTypes.findIndex((entry) => entry.type === initialType);
                    if (index !== -1) setTypeCursor(index);
                }
                setLoadError('');
            })
            .catch((err) => setLoadError(err.message || String(err)));
    }, [getTypes, host, port, initialType]);

    const selectedType = types[Math.max(0, Math.min(typeCursor, Math.max(0, types.length - 1)))] || { type: 'all', count: 0 };
    const totalNoteCount = Math.max(1, types.length > 0 && types[0].type === 'all' ? types[0].count : types.reduce((s, t) => s + t.count, 0));

    React.useEffect(() => {
        if (!selectedType) return;
        getNodes({
            host, port,
            type: selectedType.type === 'all' ? undefined : selectedType.type
        }).then((result) => {
            const nextNotes = (Array.isArray(result) ? result : []).map((node) => ({
                id: String(node.id || ''),
                type: String(node.type || ''),
                filePath: String(node._filePath || ''),
                label: String(node.name || node.title || node.id || ''),
                status: String(node.status || ''),
                inbound: Array.isArray(node._inbound) ? node._inbound.length : 0
            }));
            setNotes(nextNotes);
            setNoteCursor(0);
            setPreview(null);
            setNodeDetail(null);
            setBodyLines([]);
            setPreviewLoading(false);
            setSelectedIds((current) => current.filter((id) => nextNotes.some((note) => note.id === id)));
            if (activePane === 'notes' && !nextNotes.length) setActivePane('types');
        }).catch((err) => {
            setNotes([]);
            setPreview(null);
            setNodeDetail(null);
            setLoadError(err.message || String(err));
        });
    }, [getNodes, host, port, refreshKey, selectedType]);

    const filteredNotes = React.useMemo(() => {
        if (!filterText.trim()) return notes;
        const q = filterText.toLowerCase();
        return notes.filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
    }, [notes, filterText]);

    React.useEffect(() => {
        if (initialId && initialId !== jumpedRef.current && notes.length > 0) {
            const idx = notes.findIndex((n) => n.id === initialId);
            if (idx !== -1) {
                jumpedRef.current = initialId;
                if (idx !== noteCursor) setNoteCursor(idx);
                if (activePane !== 'notes') setActivePane('notes');
            }
        }
    }, [activePane, initialId, noteCursor, notes]);

    React.useEffect(() => {
        const next = initialFilterText || '';
        if (next !== filterText) setFilterText(next);
    }, [filterText, initialFilterText]);

    React.useEffect(() => {
        if (!initialMode || initialModeAppliedRef.current) return;
        if (initialMode === 'edit-pick' && filteredNotes.length > 0) {
            initialModeAppliedRef.current = true;
            setActivePane('notes');
            setMode('edit-pick');
        }
    }, [filteredNotes.length, initialMode]);

    const safeNoteCursor = Math.max(0, Math.min(noteCursor, Math.max(0, filteredNotes.length - 1)));
    const selectedNote = filteredNotes[safeNoteCursor] || null;
    const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

    const editableFields = nodeDetail
        ? Object.entries(nodeDetail).filter(([k]) => !SKIP_FIELDS.has(k) && !k.startsWith('__') && !k.startsWith('_'))
        : [];

    const filteredPickNotes = React.useMemo(() => {
        if (!linkPickFilter.trim()) return linkPickNotes;
        const q = linkPickFilter.toLowerCase();
        return linkPickNotes.filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
    }, [linkPickNotes, linkPickFilter]);

    const safePickCursor = Math.max(0, Math.min(linkPickCursor, Math.max(0, filteredPickNotes.length - 1)));

    React.useEffect(() => {
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        if (!selectedNote) {
            setPreview(null);
            setNodeDetail(null);
            setBodyLines([]);
            setPreviewLoading(false);
            return undefined;
        }

        setPreviewLoading(true);
        previewTimerRef.current = setTimeout(() => {
            Promise.all([
                getNoteIntelligence({ host, port, id: selectedNote.id }).catch(() => null),
                getNode({ host, port, id: selectedNote.id }).catch(() => null)
            ]).then(([intelligence, detail]) => {
                setPreview(intelligence);
                setNodeDetail(detail);
                setPreviewLoading(false);
                if (detail?._filePath) {
                    readNoteBody(detail._filePath).then(setBodyLines);
                } else {
                    setBodyLines([]);
                }
            });
        }, 200);

        return () => {
            if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        };
    }, [getNode, getNoteIntelligence, host, port, selectedNote, refreshKey]);

    React.useEffect(() => {
        onStateChangeRef.current?.({
            noteId: selectedNote?.id || '',
            typeFilter: selectedType.type,
            filterText
        });
    }, [filterText, selectedNote, selectedType.type]);

    const forceDetailRefresh = React.useCallback(() => {
        setNodeDetail(null);
        setPreview(null);
        setBodyLines([]);
        setRefreshKey((k) => k + 1);
    }, []);

    const clearBulkState = React.useCallback(() => {
        setSelectedIds([]);
        setBulkActionCursor(0);
        setBulkFieldName('');
        setBulkValue('');
    }, []);

    const _toggleSelectedNote = React.useCallback((noteId) => {
        if (!noteId) return;
        setSelectedIds((current) => current.includes(noteId)
            ? current.filter((id) => id !== noteId)
            : current.concat(noteId));
    }, []);

    // Traverse: when target changes, switch type if needed
    React.useEffect(() => {
        if (!traverseTarget || !types.length) return;
        const idx = types.findIndex((t) => t.type === traverseTarget.type);
        const nextTypeCursor = idx !== -1 ? idx : 0;
        if (nextTypeCursor !== typeCursor) setTypeCursor(nextTypeCursor);
        if (activePane !== 'notes') setActivePane('notes');
    }, [activePane, traverseTarget, typeCursor, types]);

    // Traverse: once notes load, jump to target note
    React.useEffect(() => {
        if (!traverseTarget || !notes.length) return;
        const idx = notes.findIndex((n) => n.id === traverseTarget.id);
        if (idx !== -1) {
            if (idx !== noteCursor) setNoteCursor(idx);
            setTraverseTarget(null);
        }
    }, [noteCursor, notes, traverseTarget]);

    const saveOperationalContext = React.useCallback(() => {
        if (!vaultPath || !contextsFile) return;
        const nextContext = {
            name: `context-${Date.now()}`,
            screen: 'explorer',
            noteId: selectedNote?.id || '',
            typeFilter: selectedType.type,
            filterText
        };
        const next = [...contexts, nextContext].slice(-20);
        setContexts(next);
        writeScopedJson(contextsFile, vaultPath, next);
        showToast(`${nextContext.name} saved`);
    }, [contexts, contextsFile, filterText, selectedNote, selectedType.type, showToast, vaultPath]);

    const restoreOperationalContext = React.useCallback((entry) => {
        if (!entry) return;
        const nextTypeIndex = Math.max(0, types.findIndex((item) => item.type === (entry.typeFilter || 'all')));
        setTypeCursor(nextTypeIndex === -1 ? 0 : nextTypeIndex);
        setFilterText(String(entry.filterText || ''));
        setActivePane('notes');
        setMode('browse');
        if (entry.noteId) {
            jumpedRef.current = entry.noteId;
            setTimeout(() => {
                const index = filteredNotes.findIndex((note) => note.id === entry.noteId);
                if (index !== -1) setNoteCursor(index);
            }, 0);
        }
        showToast(`restored ${entry.name}`);
    }, [filteredNotes, showToast, types]);

    const traverseTo = React.useCallback((targetId) => {
        // Jump directly if target is already in the current notes list
        const directIdx = notes.findIndex((n) => n.id === targetId);
        if (directIdx !== -1) {
            setTraverseStack((s) => [...s, { id: selectedNote?.id, type: selectedType.type }]);
            setNoteCursor(directIdx);
            setActivePane('notes');
            return;
        }
        // Otherwise fetch the note's type and navigate
        getNode({ host, port, id: targetId })
            .then((target) => {
                setTraverseStack((s) => [...s, { id: selectedNote?.id, type: selectedType.type }]);
                setTraverseTarget({ id: targetId, type: target.type || 'all' });
            })
            .catch(() => showToast('note not found', true));
    }, [getNode, host, notes, port, selectedNote, selectedType.type, showToast]);

    const explorerState = {
        mode, filterText, filteredNotes, selectedNote, editableFields, editFieldCursor,
        editField, editValue, bulkActionCursor, bulkFieldName, bulkValue, selectedIds,
        createForm, linkFieldName, linkPickFilter, linkPickLoading, filteredPickNotes,
        safePickCursor, contexts, contextCursor, historyLoading, historyError,
        historyEvents, historyCursor, activePane, nodeDetail, traverseStack, notes,
        splitMode, types, host, port, preview, bodyLines, previewLoading, selectedType,
        safeEditFieldCursor: Math.max(0, Math.min(editFieldCursor, Math.max(0, editableFields.length - 1)))
    };

    const explorerActions = {
        onQuit, setFilterText, setMode, setNoteCursor, onNoteView,
        setEditFieldCursor, setEditField, setEditValue,
        patchNode, showToast, forceDetailRefresh,
        setBulkActionCursor, setBulkFieldName, setBulkValue,
        patchNodesBulk, clearBulkState, deleteNode,
        setCreateForm, postNode, setRefreshKey,
        setLinkFieldName, setLinkPickLoading, setLinkPickFilter, setLinkPickCursor,
        getNodes, setLinkPickNotes,
        setContextCursor, restoreOperationalContext,
        setHistoryEvents, setHistoryLoading, setHistoryError, setHistoryCursor, getMutations,
        onNavigate, _toggleSelectedNote, onPeek, saveOperationalContext,
        traverseTo, setTraverseStack, setTraverseTarget,
        setActivePane, setTypeCursor, setPreview, setNodeDetail, setBodyLines
    };

    useInput((input, key) => {
        handleExplorerKey(input, key, explorerState, explorerActions);
    }, { isActive: !disabled });

    const { title: detailTitle, content: detailContent } = buildExplorerDetail(ink, explorerState);

    const notesHeaderCount = filterText ? `${filteredNotes.length} match` : `${notes.length} total`;
    const selectedCountText = selectedIds.length ? `  ${selectedIds.length} selected` : '';
    const notesHeaderLine = mode === 'filter'
        ? '  ' + p.accent('/') + ' ' + p.primary(filterText) + p.accent('█') + p.muted('  [Esc] clear')
        : splitMode
            ? '  ' + p.muted(pad('ID', 20)) + ' ' + p.muted('TYPE     ') + p.muted(notesHeaderCount + selectedCountText)
            : '  ' + p.muted('SEL ') + p.muted(pad('ID', 24)) + ' ' + p.muted(pad('NAME', 30)) + p.muted(selectedType.type === 'all' ? ' TYPE        ' : ' STATUS      ') + p.muted(notesHeaderCount + selectedCountText);
    const paneWidth = Number(width) || 96;
    const typesPanelWidth = splitMode
        ? Math.max(18, Math.floor(paneWidth * 0.22))
        : (width ? Math.max(20, Math.floor(paneWidth * 0.30)) : '32%');
    const splitRootHeight = splitMode ? Math.max(20, (process.stdout.rows || 32) - 8) : undefined;
    const splitTopHeight = splitMode ? 11 : undefined;
    const splitDetailHeight = splitMode ? Math.max(8, splitRootHeight - splitTopHeight - 1) : undefined;

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1, height: splitRootHeight },
        loadError
            ? React.createElement(Box, { marginBottom: 1 },
                React.createElement(Text, null, p.err(`  ${SYM.warn} ${loadError}`)))
            : null,
        React.createElement(
            Box,
            { flexDirection: 'row', height: splitTopHeight },
            React.createElement(Panel, {
                ink, title: 'Types', width: typesPanelWidth, marginRight: 1, height: splitTopHeight,
                children: React.createElement(Box, { flexDirection: 'column' },
                    React.createElement(Text, null, splitMode
                        ? '  ' + p.muted(pad('TYPE', 10)) + ' ' + p.muted('N')
                        : '  ' + p.muted(pad('TYPE', 12)) + ' ' + p.muted(pad('N', 3)) + '  ' + p.muted('SHARE')),
                    React.createElement(SelectionList, {
                        ink, items: types, cursor: typeCursor, maxVisible: splitMode ? 6 : 12,
                        emptyText: '(loading...)',
                        renderItem: (item, index, isSelected) => renderTypeRow(item, index, isSelected, { ink, activePane, mode, splitMode, totalNoteCount })
                    })
                )
            }),
            React.createElement(Panel, {
                ink, title: `Notes — ${selectedType.type}${selectedIds.length ? ` · ${selectedIds.length} selected` : ''}`, flexGrow: 1, height: splitTopHeight,
                children: React.createElement(Box, { flexDirection: 'column' },
                    React.createElement(Text, null, notesHeaderLine),
                    React.createElement(SelectionList, {
                        ink, items: filteredNotes, cursor: safeNoteCursor, maxVisible: splitMode ? 6 : 11,
                        emptyText: filterText ? '(no matches)' : '(empty)',
                        renderItem: (item, index, isSelected) => renderNoteRow(item, index, isSelected, { ink, activePane, mode, splitMode, selectedIdSet, selectedType })
                    })
                )
            })
        ),
        React.createElement(Panel, {
            ink,
            title: detailTitle,
            height: splitDetailHeight,
            children: React.createElement(Box, { flexDirection: 'column' }, detailContent)
        }),
        toast.msg
            ? React.createElement(Box, null, React.createElement(Text, null, toast.err ? p.err('  ' + toast.msg) : p.ok('  ' + toast.msg)))
            : null
    );
}

Explorer.readContexts = function readContexts(filePath, vaultPath) {
    return readScopedJson(filePath, vaultPath, []);
};

Explorer.formatHistoryEvent = formatHistoryEvent;

module.exports = Explorer;
