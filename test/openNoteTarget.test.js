'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

let openedDocs = [];
let shownDocs = [];
let revealedRanges = [];
let selections = [];
let currentIndex = new Map();
let currentAliases = new Map();
let currentBlockIndex = new Map();

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class Selection {
    constructor(anchor, active) {
        this.anchor = anchor;
        this.active = active;
    }
}

require.cache.__open_target_vscode__ = {
    id: '__open_target_vscode__',
    filename: '__open_target_vscode__',
    loaded: true,
    exports: {
        workspace: {
            async openTextDocument(filePath) {
                openedDocs.push(filePath);
                return { uri: { fsPath: filePath } };
            }
        },
        window: {
            async showTextDocument(document) {
                shownDocs.push(document.uri.fsPath);
                return {
                    set selection(value) {
                        selections.push(value);
                    },
                    revealRange(range) {
                        revealedRanges.push(range);
                    }
                };
            }
        },
        ViewColumn: { One: 1 },
        Position,
        Range,
        Selection,
        TextEditorRevealType: {
            InCenter: 0,
            InCenterIfOutsideViewport: 1
        }
    }
};

require.cache.__open_target_index_service__ = {
    id: '__open_target_index_service__',
    filename: '__open_target_index_service__',
    loaded: true,
    exports: {
        getIndex() {
            return currentIndex;
        },
        getAliasIndex() {
            return currentAliases;
        },
        getBodyBlockIndex() {
            return currentBlockIndex;
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__open_target_vscode__';
    if (request === '../../core/indexService') return '__open_target_index_service__';
    return originalResolve(request, parent, ...rest);
};

const { openNoteTarget, resolveOpenTarget } = require('../src/features/navigation/openNoteTarget');
const { buildTaskBlockId } = require('../src/core/bodyBlocks');

function writeTempNote(name, content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-open-target-'));
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return { dir, filePath };
}

beforeEach(() => {
    openedDocs = [];
    shownDocs = [];
    revealedRanges = [];
    selections = [];
    currentIndex = new Map();
    currentAliases = new Map();
    currentBlockIndex = new Map();
});

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('openNoteTarget', () => {
    test('opens a plain note target at line 0', async () => {
        const temp = writeTempNote('rico.md', '---\nid: rico\ntype: contact\n---\n');
        currentIndex.set('rico', temp.filePath);

        const resolved = await openNoteTarget('rico');

        assert.equal(resolved.resolvedId, 'rico');
        assert.deepEqual(openedDocs, [temp.filePath]);
        assert.deepEqual(shownDocs, [temp.filePath]);
        assert.equal(revealedRanges[0].start.line, 0);

        fs.rmSync(temp.dir, { recursive: true, force: true });
    });

    test('resolves heading targets to the heading line', async () => {
        const temp = writeTempNote('rico.md', [
            '---',
            'id: rico',
            'type: contact',
            '---',
            '',
            '## Combat Record',
            'Drop veteran.'
        ].join('\n'));
        currentIndex.set('rico', temp.filePath);

        const resolved = resolveOpenTarget('rico#Combat Record');

        assert.equal(resolved.targetLine, 5);

        fs.rmSync(temp.dir, { recursive: true, force: true });
    });

    test('opens block targets at the resolved block line', async () => {
        const temp = writeTempNote('rico.md', [
            '---',
            'id: rico',
            'type: contact',
            '---',
            '',
            '- [ ] Review recon logs'
        ].join('\n'));
        const blockId = buildTaskBlockId(1, 'Review recon logs');
        currentIndex.set('rico', temp.filePath);
        currentBlockIndex.set('rico', new Map([
            [blockId, { blockId, type: 'task', line: 5, endLine: 5, label: 'Review recon logs', text: 'Review recon logs' }]
        ]));

        const resolved = await openNoteTarget(`rico^${blockId}`);

        assert.equal(resolved.targetLine, 5);
        assert.equal(revealedRanges[0].start.line, 5);
        assert.equal(selections[0].anchor.line, 5);

        fs.rmSync(temp.dir, { recursive: true, force: true });
    });
});
