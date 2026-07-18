'use strict';

// The mode-dispatched keyboard handler extracted out of Explorer.js's
// useInput callback (0.7.4 monolith-decomposition pass — see TODO.md).
// Explorer.js had ~15 modes handled inline in one ~330-line closure over
// component state. This is a mechanical move, not a rewrite: every branch's
// logic is unchanged, only the closed-over reads/writes are made explicit —
// `state` is a read-only snapshot of the values this handler actually reads
// directly (not via a functional setState updater), and `actions` bundles
// every setter and callback the original closure called. Explorer.js builds
// both objects fresh each render and calls this from its own `useInput`.
//
// Deliberately NOT restructured into per-mode files: the mode transitions
// read like a single state machine and splitting them further would make
// the transitions between modes harder to follow, not easier.

const { openInEditor, truncate } = require('../noteDetail');

/** @param {string} input @param {{ctrl: boolean, escape: boolean, return: boolean, backspace: boolean, delete: boolean, tab: boolean, upArrow: boolean, downArrow: boolean}} key */
function handleExplorerKey(input, key, state, actions) {
    const {
        mode, filterText, filteredNotes, selectedNote, editableFields, editFieldCursor,
        editField, editValue, bulkActionCursor, bulkFieldName, bulkValue, selectedIds, createForm, linkFieldName,
        filteredPickNotes, safePickCursor, contexts, contextCursor, historyEvents,
        activePane, nodeDetail, traverseStack, notes, splitMode, types, host, port
    } = state;
    const {
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
    } = actions;

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
}

module.exports = { handleExplorerKey };
