'use strict';

const React = require('react');
const SelectionList = require('../components/SelectionList');
const Panel = require('../components/Panel');
const { p, SYM } = require('../palette');
const {
    SKIP_FIELDS,
    truncate,
    pad,
    openInEditor,
    readNoteBody,
    renderNoteDetail
} = require('../noteDetail');
const {
    readScopedJson,
    writeScopedJson,
    getContextsPath
} = require('../storage');

const EVENT_BADGES = {
    note_created:         'CREATED',
    note_touched:         'UPDATED',
    note_deleted:         'DELETED',
    field_changed:        'CHANGED',
    field_added:          'ADDED',
    field_removed:        'REMOVED',
    relation_added:       'LINKED',
    relation_changed:     'RELINKED',
    relation_removed:     'UNLINKED',
    task_status_changed:  'TASK',
    type_set:             'TYPED',
};

function buildSplitDetailContent({ ink, note, nodeDetail, intelligence, selectedType, selectedIds, previewLoading }) {
    const { Box, Text } = ink;
    if (!note) {
        return React.createElement(Text, null, p.faint('Select a note to preview  •  [n] new note'));
    }
    if (previewLoading) {
        return React.createElement(Text, null, p.muted('loading...'));
    }

    const lifecycle = intelligence ? (intelligence.lifecycle || null) : null;
    const drift = intelligence ? (intelligence.drift || null) : null;
    const arc = intelligence ? (intelligence.arc || null) : null;
    const relationMap = new Map(
        Array.isArray(nodeDetail?._outbound)
            ? nodeDetail._outbound.map((edge) => [String(edge.field || ''), String(edge.to || '')])
            : []
    );

    const displayFields = nodeDetail
        ? Object.entries(nodeDetail)
            .filter(([k]) => !SKIP_FIELDS.has(k) && !k.startsWith('__') && !k.startsWith('_'))
            .slice(0, 6)
        : [];
    const fieldKeyWidth = displayFields.reduce((max, [k]) => Math.max(max, k.length), 6);

    const likelyMissing = (Array.isArray(arc?.missingFields) ? arc.missingFields : [])
        .filter((entry) => entry && (entry.confidenceLabel === 'high' || entry.confidenceLabel === 'medium'))
        .slice(0, 3)
        .map((entry) => entry.field);

    const keyHints = selectedIds.length > 1
        ? '[Enter] bulk  [e] edit  [o] editor  [p] peek  [Esc] back'
        : '[Enter] view  [e] edit  [o] editor  [p] peek  [H] hist  [Esc] back';

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(
            Text,
            null,
            p.bold(note.label || note.id) +
            '  ' +
            p.type(note.type || selectedType.type || '')
        ),
        lifecycle || drift
            ? React.createElement(
                Text,
                null,
                p.muted('state: ') +
                p.primary(String(lifecycle?.label || lifecycle?.state || 'unknown')) +
                '  ' +
                p.muted('drift: ') +
                p.primary(String(drift?.driftLabelHuman || drift?.driftLabel || 'unknown'))
            )
            : null,
        ...displayFields.map(([key, val], index) => {
            const display = relationMap.has(key)
                ? p.secondary(SYM.relation + ' ') + p.type(truncate(String(val ?? ''), 22))
                : p.primary(truncate(String(val ?? ''), 24));
            return React.createElement(
                Text,
                { key: `split-field-${index}` },
                '  ' + p.muted(pad(key, fieldKeyWidth + 1)) + ' ' + display
            );
        }),
        likelyMissing.length > 0
            ? React.createElement(
                Text,
                { key: 'split-missing' },
                p.warn('  missing: ') + p.secondary(likelyMissing.join(', '))
            )
            : null,
        React.createElement(Text, null, ''),
        React.createElement(Text, null, p.faint('body: [o] open in $EDITOR')),
        React.createElement(Text, null, p.faint(keyHints))
    );
}

function formatHistoryEvent(event) {
    const date = String(event.timestamp || '').slice(0, 10);
    const badge = EVENT_BADGES[event.type] || 'EVENT';
    let desc = '';
    const type = event.type || '';
    if (type === 'field_changed' || type === 'field_added' || type === 'field_removed') {
        const from = event.oldValue !== null && event.oldValue !== undefined ? String(event.oldValue).slice(0, 18) : null;
        const to   = event.newValue !== null && event.newValue !== undefined ? String(event.newValue).slice(0, 18) : null;
        const fieldPart = event.field ? String(event.field) + ': ' : '';
        desc = fieldPart + (from !== null ? from : '—') + ' → ' + (to !== null ? to : '—');
    } else if (type === 'relation_added' || type === 'relation_changed' || type === 'relation_removed') {
        const val = type === 'relation_removed' ? event.oldValue : event.newValue;
        const target = val ? String(val).slice(0, 28) : '—';
        desc = (event.field ? String(event.field) + ': ' : '') + target;
    } else if (type === 'task_status_changed') {
        desc = String(event.field || '') + ' → ' + String(event.newValue || '');
    } else if (type === 'type_set') {
        desc = String(event.newValue || '');
    }
    return { date, badge, desc };
}

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

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }

        if (mode === 'filter') {
            if (key.escape) { setFilterText(''); setMode('browse'); return; }
            if (key.backspace || key.delete) {
                setFilterText((t) => {
                    const next = t.slice(0, -1);
                    if (next === '') setMode('browse');
                    return next;
                });
                return;
            }
            if (key.downArrow || input === 'j') { setNoteCursor((c) => Math.min(Math.max(0, filteredNotes.length - 1), c + 1)); return; }
            if (key.upArrow || input === 'k') { setNoteCursor((c) => Math.max(0, c - 1)); return; }
            if (key.return) {
                if (selectedNote) {
                    setMode('browse');
                    if (onNoteView) { onNoteView(selectedNote.id); } else { openInEditor(selectedNote.filePath); }
                }
                return;
            }
            if (input && input.charCodeAt(0) >= 32) { setFilterText((t) => t + input); setNoteCursor(0); return; }
            return;
        }

        if (mode === 'edit-pick') {
            if (key.escape) { setMode('browse'); return; }
            if (input === 'j' || key.downArrow) { setEditFieldCursor((c) => Math.min(c + 1, editableFields.length - 1)); return; }
            if (input === 'k' || key.upArrow) { setEditFieldCursor((c) => Math.max(0, c - 1)); return; }
            if (key.return && editableFields.length > 0) {
                const [fKey, fVal] = editableFields[Math.min(editFieldCursor, editableFields.length - 1)];
                setEditField(fKey);
                setEditValue(String(fVal ?? ''));
                setMode('edit-type');
            }
            return;
        }

        if (mode === 'edit-type') {
            if (key.escape) { setMode('edit-pick'); return; }
            if (key.backspace || key.delete) { setEditValue((v) => v.slice(0, -1)); return; }
            if (key.return) {
                patchNode({ host, port, id: selectedNote.id, fields: { [editField]: editValue } })
                    .then(() => { showToast(`✓ ${editField}: ${truncate(editValue, 30)}`); setMode('browse'); forceDetailRefresh(); })
                    .catch((err) => { showToast(err.message || 'patch failed', true); setMode('browse'); });
                return;
            }
            if (input && input.charCodeAt(0) >= 32) { setEditValue((v) => v + input); return; }
            return;
        }

        if (mode === 'bulk-menu') {
            if (key.escape) { setMode('browse'); return; }
            if (input === 'j' || key.downArrow) { setBulkActionCursor((c) => Math.min(2, c + 1)); return; }
            if (input === 'k' || key.upArrow) { setBulkActionCursor((c) => Math.max(0, c - 1)); return; }
            if (key.return) {
                if (bulkActionCursor === 0) {
                    setBulkFieldName('');
                    setBulkValue('');
                    setMode('bulk-field-name');
                } else if (bulkActionCursor === 1) {
                    setBulkValue('');
                    setMode('bulk-status-value');
                } else {
                    setMode('bulk-delete-confirm');
                }
            }
            return;
        }

        if (mode === 'bulk-field-name') {
            if (key.escape) { setMode('bulk-menu'); return; }
            if (key.backspace || key.delete) { setBulkFieldName((v) => v.slice(0, -1)); return; }
            if (key.return) {
                if (!bulkFieldName.trim()) { showToast('field name required', true); return; }
                setBulkValue('');
                setMode('bulk-field-value');
                return;
            }
            if (input && input.charCodeAt(0) >= 32) { setBulkFieldName((v) => v + input); return; }
            return;
        }

        if (mode === 'bulk-field-value' || mode === 'bulk-status-value') {
            if (key.escape) { setMode('bulk-menu'); return; }
            if (key.backspace || key.delete) { setBulkValue((v) => v.slice(0, -1)); return; }
            if (key.return) {
                const field = mode === 'bulk-status-value' ? 'status' : bulkFieldName.trim();
                if (!field) { showToast('field name required', true); return; }
                if (!patchNodesBulk) { showToast('bulk update unavailable', true); setMode('browse'); return; }
                const updates = selectedIds.map((id) => ({ id, fields: { [field]: bulkValue } }));
                patchNodesBulk({ host, port, updates })
                    .then(() => {
                        showToast(`✓ updated ${selectedIds.length} notes`);
                        clearBulkState();
                        setMode('browse');
                        forceDetailRefresh();
                    })
                    .catch((err) => {
                        showToast(err.message || 'bulk update failed', true);
                        setMode('browse');
                    });
                return;
            }
            if (input && input.charCodeAt(0) >= 32) { setBulkValue((v) => v + input); return; }
            return;
        }

        if (mode === 'bulk-delete-confirm') {
            if (key.escape || input === 'n') { setMode('bulk-menu'); return; }
            if (input === 'y') {
                Promise.all(selectedIds.map((id) => deleteNode({ host, port, id })))
                    .then(() => {
                        showToast(`✓ deleted ${selectedIds.length} notes`);
                        clearBulkState();
                        setMode('browse');
                        forceDetailRefresh();
                    })
                    .catch((err) => {
                        showToast(err.message || 'bulk delete failed', true);
                        setMode('browse');
                    });
            }
            return;
        }

        if (mode === 'create') {
            if (key.escape) { setMode('browse'); return; }
            if (key.backspace || key.delete) {
                setCreateForm((f) => {
                    const c = { ...f };
                    if (c.step === 0) c.id = c.id.slice(0, -1);
                    else if (c.step === 1) c.type = c.type.slice(0, -1);
                    else c.name = c.name.slice(0, -1);
                    return c;
                });
                return;
            }
            if (key.return) {
                if (createForm.step < 2) { setCreateForm((f) => ({ ...f, step: f.step + 1 })); }
                else {
                    const fields = { id: createForm.id.trim(), type: createForm.type.trim() };
                    if (createForm.name.trim()) fields.name = createForm.name.trim();
                    if (!fields.id) { showToast('id is required', true); return; }
                    postNode({ host, port, fields })
                        .then(() => { showToast(`✓ Created: ${fields.id}`); setMode('browse'); setRefreshKey((k) => k + 1); })
                        .catch((err) => { showToast(err.message || 'create failed', true); setMode('browse'); });
                }
                return;
            }
            if (input && input.charCodeAt(0) >= 32) {
                setCreateForm((f) => {
                    const c = { ...f };
                    if (c.step === 0) c.id = c.id + input;
                    else if (c.step === 1) c.type = c.type + input;
                    else c.name = c.name + input;
                    return c;
                });
                return;
            }
            return;
        }

        if (mode === 'delete-confirm') {
            if (key.escape || input === 'n') { setMode('browse'); return; }
            if (input === 'y') {
                deleteNode({ host, port, id: selectedNote.id })
                    .then(() => { showToast(`✓ Deleted: ${selectedNote.id}`); setMode('browse'); setRefreshKey((k) => k + 1); })
                    .catch((err) => { showToast(err.message || 'delete failed', true); setMode('browse'); });
                return;
            }
            return;
        }

        if (mode === 'link-field') {
            if (key.escape) { setMode('browse'); return; }
            if (key.backspace || key.delete) { setLinkFieldName((v) => v.slice(0, -1)); return; }
            if (key.return) {
                if (!linkFieldName.trim()) { showToast('field name required', true); return; }
                setLinkPickLoading(true);
                setLinkPickFilter('');
                setLinkPickCursor(0);
                getNodes({ host, port })
                    .then((result) => {
                        const all = (Array.isArray(result) ? result : [])
                            .map((n) => ({ id: String(n.id || ''), type: String(n.type || ''), label: String(n.name || n.title || n.id || '') }))
                            .filter((n) => n.id !== selectedNote?.id);
                        setLinkPickNotes(all);
                        setLinkPickLoading(false);
                        setMode('link-pick');
                    })
                    .catch(() => { setLinkPickLoading(false); showToast('failed to load notes', true); setMode('browse'); });
                return;
            }
            if (input && input.charCodeAt(0) >= 32) { setLinkFieldName((v) => v + input); return; }
            return;
        }

        if (mode === 'link-pick') {
            if (key.escape) { setMode('link-field'); return; }
            if (key.upArrow || input === 'k') { setLinkPickCursor((c) => Math.max(0, c - 1)); return; }
            if (key.downArrow || input === 'j') { setLinkPickCursor((c) => Math.min(Math.max(0, filteredPickNotes.length - 1), c + 1)); return; }
            if (key.backspace || key.delete) { setLinkPickFilter((v) => v.slice(0, -1)); setLinkPickCursor(0); return; }
            if (key.return) {
                const target = filteredPickNotes[safePickCursor];
                if (!target) return;
                const wikilink = `[[${target.id}]]`;
                patchNode({ host, port, id: selectedNote.id, fields: { [linkFieldName.trim()]: wikilink } })
                    .then(() => { showToast(`✓ ${linkFieldName}: ${wikilink}`); setMode('browse'); forceDetailRefresh(); })
                    .catch((err) => { showToast(err.message || 'link failed', true); setMode('browse'); });
                return;
            }
            if (input && input.charCodeAt(0) >= 32) { setLinkPickFilter((v) => v + input); setLinkPickCursor(0); return; }
            return;
        }

        if (mode === 'restore-context') {
            if (key.escape) { setMode('browse'); return; }
            if (input === 'j' || key.downArrow) { setContextCursor((cursor) => Math.min(Math.max(0, contexts.length - 1), cursor + 1)); return; }
            if (input === 'k' || key.upArrow) { setContextCursor((cursor) => Math.max(0, cursor - 1)); return; }
            if (key.return) {
                restoreOperationalContext(contexts[contextCursor]);
            }
            return;
        }

        if (mode === 'history') {
            if (key.escape) { setMode('browse'); return; }
            if (input === 'j' || key.downArrow) { setHistoryCursor((c) => Math.min(Math.max(0, historyEvents.length - 1), c + 1)); return; }
            if (input === 'k' || key.upArrow) { setHistoryCursor((c) => Math.max(0, c - 1)); return; }
            return;
        }

        if (input === '1') { onNavigate('briefing'); return; }
        if (input === '2') { onNavigate('query'); return; }
        if (input === '3') { onNavigate('navigator'); return; }
        if (input === '5') { onNavigate('health'); return; }
        if (input === '6') { onNavigate('search'); return; }
        if (input === '7') { onNavigate('graph'); return; }
        if (input === 'g' && selectedNote) { onNavigate('graph', selectedNote.id); return; }
        if (input === 'r' && selectedNote && activePane === 'notes') { onNavigate('radar', { noteId: selectedNote.id }); return; }
        if (input === ' ' && selectedNote && activePane === 'notes') {
            _toggleSelectedNote(selectedNote.id);
            return;
        }
        if (input === 'e' && selectedNote && activePane === 'notes') { setEditFieldCursor(0); setMode('edit-pick'); return; }
        if (input === 'n') { setCreateForm({ step: 0, id: '', type: '', name: '' }); setMode('create'); return; }
        if (input === 'D' && selectedNote && activePane === 'notes') { setMode('delete-confirm'); return; }
        if (input === 'l' && selectedNote && activePane === 'notes') { setLinkFieldName(''); setMode('link-field'); return; }
        if (input === '/' && activePane === 'notes') { setFilterText(''); setMode('filter'); return; }
        if (input === 'p' && selectedNote && activePane === 'notes' && onPeek) { onPeek(selectedNote.id); return; }
        if (input === 'v' && selectedNote && activePane === 'notes' && onNoteView) { onNoteView(selectedNote.id); return; }
        if (input === 'S' && activePane === 'notes') { saveOperationalContext(); return; }
        if (input === 'R' && activePane === 'notes') { setContextCursor(0); setMode('restore-context'); return; }
        if (input === 'H' && selectedNote && activePane === 'notes') {
            setHistoryEvents([]);
            setHistoryLoading(true);
            setHistoryError('');
            setHistoryCursor(0);
            setMode('history');
            if (getMutations) {
                getMutations({ host, port, id: selectedNote.id, limit: 50 })
                    .then((events) => { setHistoryEvents(events); setHistoryLoading(false); })
                    .catch((err) => { setHistoryError(err.message || 'load failed'); setHistoryLoading(false); });
            } else {
                setHistoryLoading(false);
            }
            return;
        }
        if (input === ']' && selectedNote && nodeDetail && activePane === 'notes') {
            const first = nodeDetail._outbound?.[0];
            if (!first) { showToast('no outbound links'); return; }
            showToast(`→ ${first.to}`);
            traverseTo(first.to);
            return;
        }
        if (input === '[' && selectedNote && nodeDetail && activePane === 'notes') {
            const first = nodeDetail._inbound?.[0];
            if (!first) { showToast('no inbound links'); return; }
            showToast(`← ${first.from}`);
            traverseTo(first.from);
            return;
        }

        if (key.escape) {
            if (filterText) { setFilterText(''); setMode('browse'); return; }
            if (traverseStack.length > 0) {
                const prev = traverseStack[traverseStack.length - 1];
                setTraverseStack((s) => s.slice(0, -1));
                if (prev.id) {
                    const prevIdx = notes.findIndex((n) => n.id === prev.id);
                    if (prevIdx !== -1) {
                        setNoteCursor(prevIdx);
                    } else {
                        setTraverseTarget({ id: prev.id, type: prev.type });
                    }
                }
                return;
            }
            if (activePane === 'notes') {
                setActivePane('types');
                setPreview(null);
                setNodeDetail(null);
                setBodyLines([]);
                return;
            }
            onNavigate('briefing');
            return;
        }
        if (!splitMode && key.tab) { setActivePane((pane) => pane === 'types' ? 'notes' : 'types'); return; }
        if (input === 'j' || key.downArrow) {
            if (activePane === 'types') setTypeCursor((i) => Math.min(Math.max(0, types.length - 1), i + 1));
            else setNoteCursor((i) => Math.min(Math.max(0, filteredNotes.length - 1), i + 1));
            return;
        }
        if (input === 'k' || key.upArrow) {
            if (activePane === 'types') setTypeCursor((i) => Math.max(0, i - 1));
            else setNoteCursor((i) => Math.max(0, i - 1));
            return;
        }
        if (key.return) {
            if (activePane === 'types') { setActivePane('notes'); return; }
            if (activePane === 'notes' && selectedIds.length > 1) {
                setBulkActionCursor(0);
                setMode('bulk-menu');
                return;
            }
            if (selectedNote && onNoteView) { onNoteView(selectedNote.id); return; }
            if (selectedNote) { openInEditor(selectedNote.filePath); return; }
        }
        if (input === 'o' && activePane === 'notes' && selectedNote) openInEditor(selectedNote.filePath);
    }, { isActive: !disabled });

    function renderTypeRow(item, _index, isSelected) {
        const active = activePane === 'types' && mode === 'browse';
        const marker = isSelected ? (active ? p.accent(`${SYM.selected} `) : p.secondary(`${SYM.selected} `)) : p.faint('  ');
        if (splitMode) {
            return React.createElement(Text, null,
                marker + pad(truncate(item.type, 10), 10) + ' ' + p.secondary(pad(String(item.count), 3))
            );
        }
        const barWidth = 8;
        const ratio = item.type === 'all' ? 1 : (item.count / totalNoteCount);
        const filled = Math.round(ratio * barWidth);
        const bar = p.accent('▓'.repeat(filled)) + p.faint('░'.repeat(barWidth - filled));
        return React.createElement(Text, null,
            marker + pad(item.type, 12) + ' ' + p.secondary(pad(String(item.count), 3)) + ' ' + bar
        );
    }

    function renderNoteRow(item, _index, isSelected) {
        const active = activePane === 'notes' && (mode === 'browse' || mode === 'filter');
        const selectedMark = selectedIdSet.has(item.id) ? p.warn('■ ') : p.faint('· ');
        const marker = isSelected ? (active ? p.accent(`${SYM.cursor} `) : p.secondary(`${SYM.cursor} `)) : p.faint('  ');
        if (splitMode) {
            const extra = selectedType.type === 'all'
                ? ' ' + p.type(truncate(item.type, 8))
                : (item.status ? ' ' + p.secondary(truncate(item.status, 8)) : '');
            return React.createElement(Text, null,
                marker + selectedMark + p.type(truncate(item.id, 20)) + extra
            );
        }
        const idText = pad(truncate(item.id, 22), 24);
        const labelText = pad(truncate(item.label, 28), 30);
        const extra = selectedType.type === 'all'
            ? p.type(truncate(item.type, 12))
            : (item.status ? p.secondary(truncate(item.status, 12)) : '');
        return React.createElement(Text, null,
            marker + selectedMark + p.type(idText) + ' ' + p.primary(labelText) + extra
        );
    }

    const safeEditFieldCursor = Math.max(0, Math.min(editFieldCursor, Math.max(0, editableFields.length - 1)));
    let detailTitle = 'Note Detail';
    let detailContent;

    if (mode === 'bulk-menu') {
        detailTitle = `Bulk Actions — ${selectedIds.length} notes`;
        const actions = ['Set field on all', 'Set status on all', 'Delete all'];
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('BULK ') + p.bold(selectedIds.join(', '))),
            React.createElement(Text, null, ''),
            ...actions.map((action, i) => React.createElement(Text, { key: `bulk-action-${i}` },
                (i === bulkActionCursor ? p.accent(`${SYM.cursor} `) : '  ') + p.primary(action)
            )),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[j/k] move  [Enter] choose  [Esc] cancel'))
        );
    } else if (mode === 'bulk-field-name') {
        detailTitle = `Bulk Field — ${selectedIds.length} notes`;
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('FIELD FOR ALL')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('field: ') + p.primary(bulkFieldName) + p.accent('█')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] next  [Esc] back'))
        );
    } else if (mode === 'bulk-field-value' || mode === 'bulk-status-value') {
        detailTitle = mode === 'bulk-status-value' ? `Bulk Status — ${selectedIds.length} notes` : `Bulk Value — ${selectedIds.length} notes`;
        const fieldLabel = mode === 'bulk-status-value' ? 'status' : bulkFieldName;
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('APPLY TO ALL ') + p.bold(fieldLabel)),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('value: ') + p.primary(bulkValue) + p.accent('█')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] apply  [Esc] back  [Backspace] delete'))
        );
    } else if (mode === 'bulk-delete-confirm') {
        detailTitle = `Delete ${selectedIds.length} Notes`;
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.err('DELETE SELECTED')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.secondary(selectedIds.join(', '))),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.err('[y] ') + p.primary('yes, delete all') + '   ' + p.faint('[n/Esc] cancel'))
        );
    } else if (mode === 'edit-pick') {
        detailTitle = 'Edit — Pick Field';
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('EDIT ') + p.bold(selectedNote?.id || '')),
            React.createElement(Text, null, ''),
            ...editableFields.map(([fKey, fVal], i) => {
                const selected = i === safeEditFieldCursor;
                return React.createElement(Text, { key: `ef-${i}` },
                    (selected ? p.accent(`${SYM.cursor} `) : '  ') +
                    p.muted(pad(fKey, 14)) + ' ' + p.primary(truncate(String(fVal ?? ''), 28))
                );
            }),
            editableFields.length === 0 ? React.createElement(Text, null, p.faint('  (no editable fields)')) : null,
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[j/k] move  [Enter] edit field  [Esc] cancel'))
        );
    } else if (mode === 'edit-type') {
        detailTitle = `Edit — ${editField}`;
        const currentVal = editableFields.find(([k]) => k === editField)?.[1] ?? '';
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('EDITING ') + p.bold(editField)),
            React.createElement(Text, null, p.muted('current: ') + p.primary(String(currentVal))),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('new: ') + p.primary(editValue) + p.accent('█')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] save  [Esc] back  [Backspace] delete'))
        );
    } else if (mode === 'create') {
        detailTitle = 'New Note';
        const step = createForm.step;
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('NEW NOTE')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('  id:   ') + (step === 0 ? p.primary(createForm.id) + p.accent('█') : p.primary(createForm.id))),
            React.createElement(Text, null, p.muted('  type: ') + (step === 1 ? p.primary(createForm.type) + p.accent('█') : (step > 1 ? p.primary(createForm.type) : p.faint('—')))),
            React.createElement(Text, null, p.muted('  name: ') + (step === 2 ? p.primary(createForm.name) + p.accent('█') : p.faint('—'))),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint(step < 2 ? '[Enter] next  [Esc] cancel' : '[Enter] create  [Esc] cancel'))
        );
    } else if (mode === 'delete-confirm') {
        detailTitle = 'Confirm Delete';
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.err('DELETE') + ' ' + p.bold(selectedNote?.id || '')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.secondary('This will remove the note file from your vault.')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.err('[y] ') + p.primary('yes, delete') + '   ' + p.faint('[n/Esc] cancel'))
        );
    } else if (mode === 'link-field') {
        detailTitle = 'Add Link';
        const fieldSuggestions = editableFields.slice(0, 6).map(([k]) => k).join('  ');
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('ADD LINK → ') + p.bold(selectedNote?.id || '')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('field: ') + p.primary(linkFieldName) + p.accent('█')),
            fieldSuggestions ? React.createElement(Text, null, p.faint('  existing: ') + p.faint(fieldSuggestions)) : null,
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] pick target  [Esc] cancel'))
        );
    } else if (mode === 'link-pick') {
        detailTitle = `Add Link — ${linkFieldName}`;
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null,
                p.warn(`${linkFieldName}: `) + p.muted('[[') + p.primary(linkPickFilter) + p.accent('█') + p.muted(']]') +
                p.muted(`  ${filteredPickNotes.length} notes`)
            ),
            React.createElement(Text, null, ''),
            linkPickLoading
                ? React.createElement(Text, null, p.muted('loading...'))
                : React.createElement(Box, { flexDirection: 'column' },
                    ...filteredPickNotes.slice(0, 8).map((n, i) => {
                        const sel = i === safePickCursor;
                        return React.createElement(Text, { key: `pick-${i}` },
                            (sel ? p.accent(`${SYM.cursor} `) : '  ') +
                            p.type(pad(truncate(n.id, 22), 24)) + ' ' +
                            p.primary(truncate(n.label, 22)) + ' ' +
                            p.muted(truncate(n.type, 10))
                        );
                    }),
                    filteredPickNotes.length === 0 ? React.createElement(Text, null, p.faint('  no notes match')) : null
                ),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[j/k] move  [type] filter  [Enter] link  [Esc] back'))
        );
    } else if (mode === 'restore-context') {
        detailTitle = 'Restore Context';
        detailContent = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(SelectionList, {
                ink,
                items: contexts,
                cursor: contextCursor,
                maxVisible: 8,
                emptyText: '(no saved contexts)',
                renderItem(entry, _index, isSelected) {
                    return React.createElement(Text, null,
                        (isSelected ? p.accent(`${SYM.cursor} `) : '  ') +
                        p.primary(pad(truncate(entry.name, 22), 24)) +
                        p.type(truncate(entry.noteId || entry.typeFilter || 'all', 18))
                    );
                }
            }),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[j/k] move  [Enter] restore  [Esc] cancel'))
        );
    } else if (mode === 'history') {
        detailTitle = `History — ${selectedNote?.id || ''}`;
        if (historyLoading) {
            detailContent = React.createElement(Text, null, p.muted('  loading history...'));
        } else if (historyError) {
            detailContent = React.createElement(Box, { flexDirection: 'column' },
                React.createElement(Text, null, p.err('  ' + historyError)),
                React.createElement(Text, null, ''),
                React.createElement(Text, null, p.faint('[Esc] back'))
            );
        } else if (!historyEvents.length) {
            detailContent = React.createElement(Box, { flexDirection: 'column' },
                React.createElement(Text, null, p.faint('  (no history recorded for this note)')),
                React.createElement(Text, null, ''),
                React.createElement(Text, null, p.faint('[Esc] back'))
            );
        } else {
            const MAX_HIST_VISIBLE = 7;
            const histStart = Math.max(0, Math.min(historyCursor - Math.floor(MAX_HIST_VISIBLE / 2), historyEvents.length - MAX_HIST_VISIBLE));
            const histVisible = historyEvents.slice(histStart, histStart + MAX_HIST_VISIBLE);
            detailContent = React.createElement(Box, { flexDirection: 'column' },
                React.createElement(Text, null, '  ' + p.muted(`${historyEvents.length} events — newest first`)),
                React.createElement(Text, null, ''),
                ...histVisible.map((event, i) => {
                    const idx = histStart + i;
                    const sel = idx === historyCursor;
                    const { date, badge, desc } = formatHistoryEvent(event);
                    const isGood = badge === 'CREATED' || badge === 'ADDED' || badge === 'LINKED';
                    const isBad  = badge === 'DELETED' || badge === 'REMOVED';
                    const badgeFmt = isGood ? p.ok(pad(badge, 8)) : isBad ? p.err(pad(badge, 8)) : p.warn(pad(badge, 8));
                    return React.createElement(Text, { key: `h-${idx}` },
                        (sel ? p.accent(`${SYM.cursor} `) : '  ') +
                        p.muted(date + '  ') + badgeFmt + '  ' +
                        (desc ? p.primary(truncate(desc, 46)) : '')
                    );
                }),
                React.createElement(Text, null, ''),
                React.createElement(Text, null, p.faint('[j/k] scroll  [Esc] back'))
            );
        }
    } else if (splitMode) {
        detailContent = buildSplitDetailContent({
            ink,
            note: selectedNote,
            nodeDetail,
            intelligence: preview,
            selectedType,
            selectedIds,
            previewLoading
        });
    } else if (selectedNote && previewLoading) {
        detailContent = React.createElement(Text, null, p.muted('loading...'));
    } else if (selectedNote) {
        const keyHints = splitMode
            ? '[↵] view  [e] edit  [o] editor  [p] peek  [H] hist  [l] link  [/] filter  [n] new  [D] del  [g] graph  [Esc] back'
            : '[Space] select  [Enter] view  [e] edit  [o] editor  [p] peek  [H] history  [l] link  [/] filter  []] follow out  [[] follow in  [S] save ctx  [R] restore  [n] new  [D] delete  [g] graph  [Esc] back';
        detailContent = React.createElement(
            Box,
            { flexDirection: 'column' },
            renderNoteDetail(ink, selectedNote, nodeDetail, preview, bodyLines),
            React.createElement(Text, null, p.faint('body: [o] open in $EDITOR')),
            React.createElement(Box, { marginTop: 1 },
                React.createElement(Text, null, p.faint(keyHints))
            )
        );
    } else {
        detailContent = React.createElement(Text, null, p.faint('Select a note to preview  •  [n] new note'));
    }

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
                        emptyText: '(loading...)', renderItem: renderTypeRow
                    })
                )
            }),
            React.createElement(Panel, {
                ink, title: `Notes — ${selectedType.type}${selectedIds.length ? ` · ${selectedIds.length} selected` : ''}`, flexGrow: 1, height: splitTopHeight,
                children: React.createElement(Box, { flexDirection: 'column' },
                    React.createElement(Text, null, notesHeaderLine),
                    React.createElement(SelectionList, {
                        ink, items: filteredNotes, cursor: safeNoteCursor, maxVisible: splitMode ? 6 : 11,
                        emptyText: filterText ? '(no matches)' : '(empty)', renderItem: renderNoteRow
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
