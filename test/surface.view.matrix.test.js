'use strict';
/**
 * surface.view.matrix.test.js
 *
 * Tests for buildMatrixGrid — the server-side matrix renderer.
 * Each test creates a real vault so getEdges() reads live graph data.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createVault } = require('./lib/vaultSim');
const { buildMatrixGrid } = require('../src/features/view/viewPanelHtml');

const NOTE = (id, type, extra = '') => `---\nid: ${id}\ntype: ${type}\n${extra}---\n`;

const row = (id, fields = {}) => ({ id, fields });

// ── Empty states ──────────────────────────────────────────────────────────────

describe('buildMatrixGrid — empty states', () => {
    test('no row notes → matrix-empty with row type name', () => {
        const vault = createVault({});
        const html = buildMatrixGrid([], [row('col1')], 'contact', 'account');
        assert.ok(html.includes('matrix-empty'), 'has matrix-empty class');
        assert.ok(html.includes('contact'), 'mentions row type');
        vault.destroy();
    });

    test('no col notes → matrix-empty with col type name', () => {
        const vault = createVault({});
        const html = buildMatrixGrid([row('row1')], [], 'contact', 'account');
        assert.ok(html.includes('matrix-empty'), 'has matrix-empty class');
        assert.ok(html.includes('account'), 'mentions col type');
        vault.destroy();
    });
});

// ── Connected cells ───────────────────────────────────────────────────────────

describe('buildMatrixGrid — connection detection', () => {
    test('outbound edge row→col marks linked cell', () => {
        const vault = createVault({
            'rico.md':   NOTE('rico',   'contact', 'account: "[[mi]]"\n'),
            'mi.md':     NOTE('mi',     'account')
        });
        const rowNotes = [row('rico')];
        const colNotes = [row('mi')];
        const html = buildMatrixGrid(rowNotes, colNotes, 'contact', 'account');
        assert.ok(html.includes('linked'), 'cell is marked linked');
        assert.ok(html.includes('●'), 'dot rendered in linked cell');
        vault.destroy();
    });

    test('inbound edge col→row also marks linked (bidirectional)', () => {
        const vault = createVault({
            'rico.md':   NOTE('rico',   'contact'),
            'mi.md':     NOTE('mi',     'account', 'members: "[[rico]]"\n')
        });
        const rowNotes = [row('rico')];
        const colNotes = [row('mi')];
        const html = buildMatrixGrid(rowNotes, colNotes, 'contact', 'account');
        assert.ok(html.includes('linked'), 'reverse edge also detected');
        vault.destroy();
    });

    test('unrelated notes produce no linked cells', () => {
        const vault = createVault({
            'rico.md':   NOTE('rico',   'contact'),
            'alpha.md':  NOTE('alpha',  'account')
        });
        const rowNotes = [row('rico')];
        const colNotes = [row('alpha')];
        const html = buildMatrixGrid(rowNotes, colNotes, 'contact', 'account');
        assert.ok(!html.includes('linked'), 'no linked cell when unrelated');
        assert.ok(!html.includes('●'), 'no dot when unrelated');
        vault.destroy();
    });

    test('only the correct pair is marked linked in a multi-note grid', () => {
        const vault = createVault({
            'rico.md':    NOTE('rico',   'contact', 'account: "[[mi]]"\n'),
            'carmen.md':  NOTE('carmen', 'contact'),
            'mi.md':      NOTE('mi',     'account'),
            'navajo.md':  NOTE('navajo', 'account')
        });
        const rowNotes = [row('rico'), row('carmen')];
        const colNotes = [row('mi'), row('navajo')];
        const html = buildMatrixGrid(rowNotes, colNotes, 'contact', 'account');

        // rico↔mi should be linked, others should not
        assert.ok(html.includes(`data-row="rico" data-col="mi"`), 'rico↔mi cell present');
        // The linked cell has the class
        const ricoMiLinked = html.includes('linked') && html.includes('data-col="mi"');
        assert.ok(ricoMiLinked, 'rico↔mi is linked');
        vault.destroy();
    });
});

// ── Grid structure ────────────────────────────────────────────────────────────

describe('buildMatrixGrid — HTML structure', () => {
    test('produces matrix-table with thead and tbody', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'contact'),
            'b.md': NOTE('b', 'account')
        });
        const html = buildMatrixGrid([row('a')], [row('b')], 'contact', 'account');
        assert.ok(html.includes('matrix-table'), 'matrix-table class');
        assert.ok(html.includes('<thead>'), 'has thead');
        assert.ok(html.includes('<tbody>'), 'has tbody');
        vault.destroy();
    });

    test('matrix-corner shows row type and col type', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'contact'),
            'b.md': NOTE('b', 'project')
        });
        const html = buildMatrixGrid([row('a')], [row('b')], 'contact', 'project');
        assert.ok(html.includes('matrix-corner-row'), 'corner row label present');
        assert.ok(html.includes('contact'), 'row type in corner');
        assert.ok(html.includes('project'), 'col type in corner');
        vault.destroy();
    });

    test('col headers have matrix-col-head class with data-id', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'contact'),
            'b.md': NOTE('b', 'account')
        });
        const html = buildMatrixGrid([row('a')], [row('b')], 'contact', 'account');
        assert.ok(html.includes('matrix-col-head'), 'col head class');
        assert.ok(html.includes('data-id="b"'), 'col head data-id');
        vault.destroy();
    });

    test('row headers have matrix-row-head class with data-id', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'contact'),
            'b.md': NOTE('b', 'account')
        });
        const html = buildMatrixGrid([row('a')], [row('b')], 'contact', 'account');
        assert.ok(html.includes('matrix-row-head'), 'row head class');
        assert.ok(html.includes('data-id="a"'), 'row head data-id');
        vault.destroy();
    });

    test('summary line shows row count × col count', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'contact'),
            'b.md': NOTE('b', 'account')
        });
        const html = buildMatrixGrid([row('a')], [row('b')], 'contact', 'account');
        assert.ok(html.includes('matrix-summary'), 'matrix-summary present');
        assert.ok(html.includes('1'), 'counts shown');
        vault.destroy();
    });
});

// ── Truncation ────────────────────────────────────────────────────────────────

describe('buildMatrixGrid — truncation', () => {
    test('no truncation note when within limits', () => {
        const vault = createVault({
            'a.md': NOTE('a', 'contact'),
            'b.md': NOTE('b', 'account')
        });
        const html = buildMatrixGrid([row('a')], [row('b')], 'contact', 'account');
        assert.ok(!html.includes('matrix-truncate'), 'no truncate note within limits');
        vault.destroy();
    });

    test('truncation note appears when rows exceed MATRIX_MAX_ROWS (100)', () => {
        const vault = createVault({ 'a.md': NOTE('a', 'contact') });
        const manyRows = Array.from({ length: 101 }, (_, i) => row(`r${i}`));
        const html = buildMatrixGrid(manyRows, [row('col1')], 'contact', 'account');
        assert.ok(html.includes('matrix-truncate'), 'truncate note shown for >100 rows');
        vault.destroy();
    });

    test('truncation note appears when cols exceed MATRIX_MAX_COLS (50)', () => {
        const vault = createVault({ 'a.md': NOTE('a', 'contact') });
        const manyCols = Array.from({ length: 51 }, (_, i) => row(`c${i}`));
        const html = buildMatrixGrid([row('row1')], manyCols, 'contact', 'account');
        assert.ok(html.includes('matrix-truncate'), 'truncate note shown for >50 cols');
        vault.destroy();
    });
});
