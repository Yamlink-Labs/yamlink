'use strict';

// The mode-dispatched detail-panel content builder extracted out of
// Explorer.js's render body (0.7.4 monolith-decomposition pass — see
// TODO.md). Mechanical move: every branch's JSX is unchanged, only the
// closed-over reads are made explicit via a `state` snapshot object built
// fresh each render by Explorer.js. Returns `{ title, content }` — Explorer.js
// assigns these to `detailTitle`/`detailContent` exactly as before.

const React = require('react');
const SelectionList = require('../components/SelectionList');
const { p, SYM } = require('../palette');
const { truncate, pad, renderNoteDetail } = require('../noteDetail');
const { buildSplitDetailContent, formatHistoryEvent } = require('./explorerFormat');

/** @param {object} ink @param {object} state @returns {{title: string, content: object}} */
function buildExplorerDetail(ink, state) {
    const { Box, Text } = ink;
    const {
        mode, selectedIds, bulkActionCursor, bulkFieldName, bulkValue,
        editableFields, safeEditFieldCursor, editField, editValue, createForm,
        selectedNote, linkFieldName, linkPickFilter, linkPickLoading, filteredPickNotes,
        safePickCursor, contexts, contextCursor, historyLoading, historyError,
        historyEvents, historyCursor, splitMode, nodeDetail, preview, bodyLines,
        previewLoading, selectedType
    } = state;

    let title = 'Note Detail';
    let content;

    if (mode === 'bulk-menu') {
        title = `Bulk Actions — ${selectedIds.length} notes`;
        const actions = ['Set field on all', 'Set status on all', 'Delete all'];
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('BULK ') + p.bold(selectedIds.join(', '))),
            React.createElement(Text, null, ''),
            ...actions.map((action, i) => React.createElement(Text, { key: `bulk-action-${i}` },
                (i === bulkActionCursor ? p.accent(`${SYM.cursor} `) : '  ') + p.primary(action)
            )),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[j/k] move  [Enter] choose  [Esc] cancel'))
        );
    } else if (mode === 'bulk-field-name') {
        title = `Bulk Field — ${selectedIds.length} notes`;
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('FIELD FOR ALL')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('field: ') + p.primary(bulkFieldName) + p.accent('█')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] next  [Esc] back'))
        );
    } else if (mode === 'bulk-field-value' || mode === 'bulk-status-value') {
        title = mode === 'bulk-status-value' ? `Bulk Status — ${selectedIds.length} notes` : `Bulk Value — ${selectedIds.length} notes`;
        const fieldLabel = mode === 'bulk-status-value' ? 'status' : bulkFieldName;
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('APPLY TO ALL ') + p.bold(fieldLabel)),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('value: ') + p.primary(bulkValue) + p.accent('█')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] apply  [Esc] back  [Backspace] delete'))
        );
    } else if (mode === 'bulk-delete-confirm') {
        title = `Delete ${selectedIds.length} Notes`;
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.err('DELETE SELECTED')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.secondary(selectedIds.join(', '))),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.err('[y] ') + p.primary('yes, delete all') + '   ' + p.faint('[n/Esc] cancel'))
        );
    } else if (mode === 'edit-pick') {
        title = 'Edit — Pick Field';
        content = React.createElement(Box, { flexDirection: 'column' },
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
        title = `Edit — ${editField}`;
        const currentVal = editableFields.find(([k]) => k === editField)?.[1] ?? '';
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('EDITING ') + p.bold(editField)),
            React.createElement(Text, null, p.muted('current: ') + p.primary(String(currentVal))),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('new: ') + p.primary(editValue) + p.accent('█')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] save  [Esc] back  [Backspace] delete'))
        );
    } else if (mode === 'create') {
        title = 'New Note';
        const step = createForm.step;
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('NEW NOTE')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('  id:   ') + (step === 0 ? p.primary(createForm.id) + p.accent('█') : p.primary(createForm.id))),
            React.createElement(Text, null, p.muted('  type: ') + (step === 1 ? p.primary(createForm.type) + p.accent('█') : (step > 1 ? p.primary(createForm.type) : p.faint('—')))),
            React.createElement(Text, null, p.muted('  name: ') + (step === 2 ? p.primary(createForm.name) + p.accent('█') : p.faint('—'))),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint(step < 2 ? '[Enter] next  [Esc] cancel' : '[Enter] create  [Esc] cancel'))
        );
    } else if (mode === 'delete-confirm') {
        title = 'Confirm Delete';
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.err('DELETE') + ' ' + p.bold(selectedNote?.id || '')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.secondary('This will remove the note file from your vault.')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.err('[y] ') + p.primary('yes, delete') + '   ' + p.faint('[n/Esc] cancel'))
        );
    } else if (mode === 'link-field') {
        title = 'Add Link';
        const fieldSuggestions = editableFields.slice(0, 6).map(([k]) => k).join('  ');
        content = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.warn('ADD LINK → ') + p.bold(selectedNote?.id || '')),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.muted('field: ') + p.primary(linkFieldName) + p.accent('█')),
            fieldSuggestions ? React.createElement(Text, null, p.faint('  existing: ') + p.faint(fieldSuggestions)) : null,
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint('[Enter] pick target  [Esc] cancel'))
        );
    } else if (mode === 'link-pick') {
        title = `Add Link — ${linkFieldName}`;
        content = React.createElement(Box, { flexDirection: 'column' },
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
        title = 'Restore Context';
        content = React.createElement(Box, { flexDirection: 'column' },
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
        title = `History — ${selectedNote?.id || ''}`;
        if (historyLoading) {
            content = React.createElement(Text, null, p.muted('  loading history...'));
        } else if (historyError) {
            content = React.createElement(Box, { flexDirection: 'column' },
                React.createElement(Text, null, p.err('  ' + historyError)),
                React.createElement(Text, null, ''),
                React.createElement(Text, null, p.faint('[Esc] back'))
            );
        } else if (!historyEvents.length) {
            content = React.createElement(Box, { flexDirection: 'column' },
                React.createElement(Text, null, p.faint('  (no history recorded for this note)')),
                React.createElement(Text, null, ''),
                React.createElement(Text, null, p.faint('[Esc] back'))
            );
        } else {
            const MAX_HIST_VISIBLE = 7;
            const histStart = Math.max(0, Math.min(historyCursor - Math.floor(MAX_HIST_VISIBLE / 2), historyEvents.length - MAX_HIST_VISIBLE));
            const histVisible = historyEvents.slice(histStart, histStart + MAX_HIST_VISIBLE);
            content = React.createElement(Box, { flexDirection: 'column' },
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
        content = buildSplitDetailContent({
            ink,
            note: selectedNote,
            nodeDetail,
            intelligence: preview,
            selectedType,
            selectedIds,
            previewLoading
        });
    } else if (selectedNote && previewLoading) {
        content = React.createElement(Text, null, p.muted('loading...'));
    } else if (selectedNote) {
        const keyHints = splitMode
            ? '[↵] view  [e] edit  [o] editor  [p] peek  [H] hist  [l] link  [/] filter  [n] new  [D] del  [g] graph  [Esc] back'
            : '[Space] select  [Enter] view  [e] edit  [o] editor  [p] peek  [H] history  [l] link  [/] filter  []] follow out  [[] follow in  [S] save ctx  [R] restore  [n] new  [D] delete  [g] graph  [Esc] back';
        content = React.createElement(
            Box,
            { flexDirection: 'column' },
            renderNoteDetail(ink, selectedNote, nodeDetail, preview, bodyLines),
            React.createElement(Text, null, p.faint('body: [o] open in $EDITOR')),
            React.createElement(Box, { marginTop: 1 },
                React.createElement(Text, null, p.faint(keyHints))
            )
        );
    } else {
        content = React.createElement(Text, null, p.faint('Select a note to preview  •  [n] new note'));
    }

    return { title, content };
}

module.exports = { buildExplorerDetail };
