'use strict';

// Lightweight pending-completion tracker.
//
// Records when relation completions are shown for a note/field. If the user
// moves to a different line or note without accepting (via _completionAccepted),
// we emit a suggestion_ignored event so the mutation log captures dismissals.
//
// This is the only place suggestion_ignored fires from the completion path.
// codeActions.js handles the lightbulb-dismiss variant independently.
//
// Signal limitations: `provideCompletionItems` is called on every keystroke so
// any accepted typing (not using VS Code completion) can produce a false-positive
// dismiss event. The signal is useful for narrative building and eventual negative
// calibration; it is NOT high-precision.

let _pending = null; // { noteId, field, line, shownAt }
let _appendFn = null;
const IGNORE_GRACE_MS = 3000;

/** @param {(events: object[]) => void} fn */
function setMutationAppender(fn) {
    _appendFn = typeof fn === 'function' ? fn : null;
}

/**
 * Record that completion items were shown for a field on a given line.
 * Called from completionProviders when relation items are returned.
 * @param {string|null} noteId
 * @param {string} field
 * @param {number} line  zero-based line number of the frontmatter field
 */
function recordCompletionShown(noteId, field, line) {
    if (!noteId || !field || typeof line !== 'number') return;
    const now = Date.now();
    if (_pending && (_pending.noteId !== noteId || _pending.field !== field || _pending.line !== line)) {
        if ((now - _pending.shownAt) >= IGNORE_GRACE_MS) {
            emitIgnored(_pending);
        }
    }
    _pending = { noteId, field, line, shownAt: now };
}

/**
 * Clear the pending entry — called when the user accepts a completion
 * so no dismiss event is emitted.
 */
function clearPending() {
    _pending = null;
}

/**
 * Check whether the current editor position constitutes a dismiss of
 * the pending completion. Called from the onDidChangeTextEditorSelection
 * handler in extension.js.
 *
 * @param {string|null} noteId  id of the note currently open (null if unknown)
 * @param {number} line  zero-based line of the current cursor position
 */
function onSelectionChanged(noteId, line) {
    if (!_pending || !_appendFn) return;
    const { noteId: pNoteId, line: pLine } = _pending;
    if (noteId !== pNoteId || line !== pLine) {
        const age = Date.now() - _pending.shownAt;
        const pending = _pending;
        _pending = null;
        if (age >= IGNORE_GRACE_MS) emitIgnored(pending);
    }
}

function emitIgnored(pending) {
    if (!pending || !_appendFn) return;
    _appendFn([{
        type: 'suggestion_ignored',
        noteId: pending.noteId,
        field: pending.field,
        newValue: null,
        oldValue: null,
        source: 'vscode',
        cause: 'completion_dismissed'
    }]);
}

module.exports = { setMutationAppender, recordCompletionShown, clearPending, onSelectionChanged };
