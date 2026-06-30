'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    setMutationAppender,
    recordCompletionShown,
    clearPending,
    onSelectionChanged
} = require('../src/features/completionTracker');

describe('completionTracker', () => {
    let emitted;
    let now;
    let originalNow;

    beforeEach(() => {
        emitted = [];
        now = 1_000;
        originalNow = Date.now;
        Date.now = () => now;
        clearPending();
        setMutationAppender((events) => emitted.push(...events));
    });

    test.afterEach(() => {
        Date.now = originalNow;
    });

    test('emits suggestion_ignored when cursor moves to a different line', () => {
        recordCompletionShown('johnny-rico', 'unit', 3);
        now += 3001;
        onSelectionChanged('johnny-rico', 5);
        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].type, 'suggestion_ignored');
        assert.equal(emitted[0].noteId, 'johnny-rico');
        assert.equal(emitted[0].field, 'unit');
        assert.equal(emitted[0].source, 'vscode');
        assert.equal(emitted[0].cause, 'completion_dismissed');
    });

    test('emits suggestion_ignored when cursor moves to a different note', () => {
        recordCompletionShown('johnny-rico', 'unit', 3);
        now += 3001;
        onSelectionChanged('carl-jenkins', 3);
        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].type, 'suggestion_ignored');
        assert.equal(emitted[0].noteId, 'johnny-rico');
    });

    test('does not emit when cursor stays on the same note and line', () => {
        recordCompletionShown('johnny-rico', 'unit', 3);
        onSelectionChanged('johnny-rico', 3);
        assert.equal(emitted.length, 0);
    });

    test('does not emit after clearPending (completion accepted)', () => {
        recordCompletionShown('johnny-rico', 'unit', 3);
        clearPending();
        onSelectionChanged('johnny-rico', 5);
        assert.equal(emitted.length, 0);
    });

    test('only emits once — clears pending after dismiss', () => {
        recordCompletionShown('johnny-rico', 'unit', 3);
        now += 3001;
        onSelectionChanged('johnny-rico', 5);
        onSelectionChanged('johnny-rico', 6);
        assert.equal(emitted.length, 1);
    });

    test('does not emit when no completion was shown', () => {
        onSelectionChanged('johnny-rico', 5);
        assert.equal(emitted.length, 0);
    });

    test('does not emit when noteId is null (non-indexed file)', () => {
        recordCompletionShown(null, 'unit', 3);
        onSelectionChanged(null, 5);
        assert.equal(emitted.length, 0);
    });

    test('does not emit when appender is not set', () => {
        setMutationAppender(null);
        recordCompletionShown('johnny-rico', 'unit', 3);
        onSelectionChanged('johnny-rico', 5);
        assert.equal(emitted.length, 0);
    });

    test('records the most recent shown field — earlier pending is replaced', () => {
        recordCompletionShown('johnny-rico', 'unit', 3);
        now += 3001;
        recordCompletionShown('johnny-rico', 'rank', 4);
        now += 3001;
        onSelectionChanged('johnny-rico', 6);
        assert.equal(emitted.length, 2);
        assert.equal(emitted[0].field, 'unit');
        assert.equal(emitted[1].field, 'rank');
    });
});
