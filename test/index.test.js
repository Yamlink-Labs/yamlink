'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Module = require('module');
const originalResolve = Module._resolveFilename.bind(Module);

const registeredEdges = new Map();
const registeredTypes = new Map();
const unregisteredLog = [];

Module._resolveFilename = (request, parent, ...rest) => {
    if (request === './graph') return '__stub_graph__';
    if (request === '../registries/typeRegistry') return '__stub_typeReg__';
    if (request === '../registries/schemaRegistry') return '__stub_schemaReg__';
    if (request === 'js-yaml') return '__stub_yaml__';
    if (request === 'vscode') return '__stub_vscode__';
    return originalResolve(request, parent, ...rest);
};

class WorkspaceEdit {
    replace() {}
}

require.cache.__stub_vscode__ = {
    id: '__stub_vscode__',
    filename: '__stub_vscode__',
    loaded: true,
    exports: {
        Uri: { file: (filePath) => ({ fsPath: filePath }) },
        workspace: {
            textDocuments: [],
            applyEdit: async () => true
        },
        Range: class Range {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        },
        WorkspaceEdit
    }
};

require.cache.__stub_yaml__ = {
    id: '__stub_yaml__',
    filename: '__stub_yaml__',
    loaded: true,
    exports: {
        load(text) {
            if (!text || !text.trim()) return null;
            const result = {};
            let currentKey = null;
            let hasAny = false;
            for (const line of text.split('\n')) {
                const listItem = line.match(/^\s+-\s+(.+?)\s*$/);
                if (listItem && currentKey) {
                    if (!Array.isArray(result[currentKey])) result[currentKey] = [];
                    result[currentKey].push(listItem[1]);
                    hasAny = true;
                    continue;
                }
                if (/^\s*[\w-]+:\s+[\w-]+:\s+\S/.test(line)) throw new Error('bad yaml');
                const keyValue = line.match(/^([\w-]+):\s*(.*?)\s*$/);
                if (!keyValue) continue;
                hasAny = true;
                currentKey = keyValue[1];
                const value = keyValue[2].trim();
                if (value === '' || value === 'null') {
                    result[currentKey] = null;
                    continue;
                }
                if (value === 'true') {
                    result[currentKey] = true;
                    continue;
                }
                if (value === 'false') {
                    result[currentKey] = false;
                    continue;
                }
                if (/^\d+$/.test(value)) {
                    result[currentKey] = parseInt(value, 10);
                    continue;
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    result[currentKey] = new Date(`${value}T00:00:00.000Z`);
                    continue;
                }
                result[currentKey] = value.replace(/^["']|["']$/g, '');
            }
            return hasAny ? result : null;
        },
        dump(value) {
            const lines = [];
            for (const [key, raw] of Object.entries(value || {})) {
                if (Array.isArray(raw)) {
                    lines.push(`${key}:`);
                    for (const item of raw) lines.push(`  - ${item}`);
                    continue;
                }
                if (raw === null || raw === undefined || raw === '') {
                    lines.push(`${key}:`);
                    continue;
                }
                if (typeof raw === 'boolean' || typeof raw === 'number') {
                    lines.push(`${key}: ${raw}`);
                    continue;
                }
                lines.push(`${key}: ${String(raw)}`);
            }
            return lines.join('\n');
        }
    }
};

require.cache.__stub_graph__ = {
    id: '__stub_graph__',
    filename: '__stub_graph__',
    loaded: true,
    exports: {
        clearGraph: () => {
            registeredEdges.clear();
        },
        registerEdges: (id, edges) => {
            registeredEdges.set(id, edges);
        },
        removeEdgesForSource: (id) => {
            registeredEdges.delete(id);
        },
        getGraphStats: () => ({ totalEdges: 0 }),
        getEdges: (id) => registeredEdges.get(id) ?? []
    }
};

require.cache.__stub_typeReg__ = {
    id: '__stub_typeReg__',
    filename: '__stub_typeReg__',
    loaded: true,
    exports: {
        clearRegistry: () => {
            registeredTypes.clear();
        },
        registerType: (type, id) => {
            if (!registeredTypes.has(type)) registeredTypes.set(type, new Set());
            registeredTypes.get(type).add(id);
        },
        unregisterType: (type, id) => {
            unregisteredLog.push({ type, id });
            if (registeredTypes.has(type)) registeredTypes.get(type).delete(id);
        },
        getRegistryStats: () => ({ uniqueTypes: registeredTypes.size }),
        getTypes: () => new Set(registeredTypes.keys())
    }
};

require.cache.__stub_schemaReg__ = {
    id: '__stub_schemaReg__',
    filename: '__stub_schemaReg__',
    loaded: true,
    exports: { clearSchemaRegistry: () => {}, registerSchemaNode: () => {} }
};

const {
    parseFrontmatter,
    buildIndex,
    updateSingleFile,
    invalidateFileCache,
    removeFileFromIndex,
    getIndex,
    getFieldsCache,
    getBodyLinksCache,
    extractEdgesFromFrontmatter,
    extractBodyLinks
} = require('../src/core/index.js');
const { writeFieldValue } = require('../src/core/writeField.js');

let tmpDir = null;

function setupVault() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-'));
}

function teardownVault() {
    if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = null;
    }
}

function writeNode(name, content) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

function bumpMtime(filePath) {
    const nextTime = Date.now() / 1000 + 2;
    fs.utimesSync(filePath, nextTime, nextTime);
}

describe('parseFrontmatter', () => {
    test('scalar fields', () => {
        const result = parseFrontmatter('---\nid: rico\ntype: character\nrank: lieutenant\n---\n');
        assert.equal(result.id, 'rico');
        assert.equal(result.rank, 'lieutenant');
    });

    test('YAML list joined to comma string', () => {
        const result = parseFrontmatter('---\nid: m1\ntags:\n  - combat\n  - recon\n---\n');
        assert.equal(result.tags, 'combat, recon');
    });

    test('boolean coerced to string', () => {
        assert.equal(parseFrontmatter('---\nid: x\nactive: true\n---\n').active, 'true');
    });

    test('integer coerced to string', () => {
        assert.equal(parseFrontmatter('---\nid: x\ncasualties: 42\n---\n').casualties, '42');
    });

    test('date scalars stay as YYYY-MM-DD strings', () => {
        assert.equal(parseFrontmatter('---\nid: x\ndue: 2026-03-31\n---\n').due, '2026-03-31');
    });

    test('null value becomes empty string', () => {
        assert.equal(parseFrontmatter('---\nid: x\nnotes: null\n---\n').notes, '');
    });

    test('no frontmatter returns null', () => {
        assert.equal(parseFrontmatter('plain text'), null);
    });

    test('unclosed frontmatter returns null', () => {
        assert.equal(parseFrontmatter('---\nid: x\n'), null);
    });

    test('malformed YAML returns null without throwing', () => {
        assert.equal(parseFrontmatter('---\nbad: key: value\n---\n'), null);
    });

    test('BOM stripped', () => {
        assert.equal(parseFrontmatter('\uFEFF---\nid: bom\n---\n').id, 'bom');
    });

    test('empty frontmatter block returns null', () => {
        assert.equal(parseFrontmatter('---\n---\n'), null);
    });

    // NOTE: this file stubs js-yaml with a simplified hand-written fake (see
    // the Module._resolveFilename override above) that doesn't replicate real
    // js-yaml's flow-sequence array parsing — so the "[[wikilink]] scalar
    // parses as a nested array" ambiguity this stub can't reproduce is tested
    // with the REAL js-yaml library instead, in
    // test/parseFrontmatterWikilinkAmbiguity.test.js (via createVault(), real
    // file writes, real buildIndex()).
});

describe('wikilink edge extraction', () => {
    test('canonicalizes frontmatter wikilink targets', () => {
        const edges = extractEdgesFromFrontmatter(
            '---\n' +
            'id: call-rico\n' +
            'account: [[CloudLabs Solutions]]\n' +
            'contacts:\n' +
            '  - [[Andreas Storms]]\n' +
            '---\n'
        );
        assert.deepEqual(edges, [
            { field: 'account', targetId: 'cloudlabs-solutions' },
            { field: 'contacts', targetId: 'andreas-storms' }
        ]);
    });

    test('canonicalizes body wikilinks and strips aliases anchors and block refs', () => {
        const edges = extractBodyLinks(
            '---\nid: meeting-1\ntype: meeting\n---\n' +
            'Review [[Andreas Storms|Andreas]] with [[CloudLabs Solutions#Contacts]].\n' +
            'Follow up on [[Call Matt^task-1]].\n'
        );
        assert.deepEqual(edges, [
            { field: 'body', targetId: 'andreas-storms' },
            { field: 'body', targetId: 'cloudlabs-solutions' },
            { field: 'body', targetId: 'call-matt' }
        ]);
    });

    test('buildIndex registers canonicalized body-link edges', () => {
        setupVault();
        writeNode('andreas.md', '---\nid: andreas-storms\ntype: contact\n---\n');
        const filePath = writeNode(
            'meeting.md',
            '---\nid: call-andreas\ntype: meeting\n---\nMet with [[Andreas Storms]].\n'
        );
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        assert.deepEqual(require.cache.__stub_graph__.exports.getEdges('call-andreas'), [
            { field: 'body', targetId: 'andreas-storms' }
        ]);
        assert.equal(getIndex().get('andreas-storms').endsWith('andreas.md'), true);
        assert.equal(getIndex().get('call-andreas'), filePath);
        teardownVault();
    });

    test('buildIndex resolves alias wikilinks to the canonical graph target', () => {
        setupVault();
        writeNode(
            'andreas.md',
            '---\n' +
            'id: andreas-storms\n' +
            'type: contact\n' +
            'aliases: Andreas Storms\n' +
            '---\n'
        );
        writeNode(
            'meeting.md',
            '---\n' +
            'id: call-andreas\n' +
            'type: meeting\n' +
            '---\n' +
            'Met with [[Andreas Storms]].\n'
        );
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        assert.deepEqual(require.cache.__stub_graph__.exports.getEdges('call-andreas'), [
            { field: 'body', targetId: 'andreas-storms' }
        ]);
        teardownVault();
    });

    test('buildIndex stores combined frontmatter and body tags in fields cache', () => {
        setupVault();
        writeNode(
            'tagged.md',
            '---\n' +
            'id: tagged-note\n' +
            'type: note\n' +
            'tags: crm, #enterprise\n' +
            '---\n' +
            'Body mentions #follow-up and #crm again.\n'
        );
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        assert.equal(
            getFieldsCache().get('tagged-note').__yamlink_tags,
            'crm, enterprise, follow-up'
        );
        teardownVault();
    });
});

describe('updateSingleFile', () => {
    test('non-markdown file yields no change', () => {
        const result = updateSingleFile('/vault/x.json');
        assert.equal(result.changed, false);
        assert.equal(result.needsFull, false);
    });

    test('missing file requests full rebuild', () => {
        assert.equal(updateSingleFile('/ghost.md').needsFull, true);
    });

    test('no frontmatter yields no change', () => {
        setupVault();
        const filePath = writeNode('plain.md', '# heading\n');
        assert.equal(updateSingleFile(filePath).changed, false);
        teardownVault();
    });

    test('mtime cache hit skips second update', () => {
        setupVault();
        const filePath = writeNode('stable.md', '---\nid: stable\ntype: character\n---\n');
        updateSingleFile(filePath);
        assert.equal(updateSingleFile(filePath).changed, false);
        teardownVault();
    });

    test('force option bypasses mtime cache for table-driven writes', () => {
        setupVault();
        const filePath = writeNode('forced.md', '---\nid: forced\ntype: character\nrank: private\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        updateSingleFile(filePath);
        fs.writeFileSync(filePath, '---\nid: forced\ntype: character\nrank: general\n---\n', 'utf8');
        invalidateFileCache(filePath);
        const result = updateSingleFile(filePath, { force: true });
        assert.equal(result.changed, true);
        assert.equal(getFieldsCache().get('forced').rank, 'general');
        teardownVault();
    });

    test('id change requests full rebuild', () => {
        setupVault();
        const filePath = writeNode('flip.md', '---\nid: original\ntype: character\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: renamed\ntype: character\n---\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        assert.equal(result.needsFull, true);
        assert.ok(result.mutationEvents.some((event) => event.type === 'note_created' && event.noteId === 'renamed'));
        teardownVault();
    });

    test('schema node change requests full rebuild', () => {
        setupVault();
        const filePath = writeNode('s.md', '---\nid: sch\ntype: schema\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: sch\ntype: schema\nextra: yes\n---\n', 'utf8');
        bumpMtime(filePath);
        assert.equal(updateSingleFile(filePath).needsFull, true);
        teardownVault();
    });

    test('field update stays incremental and refreshes fields cache', () => {
        setupVault();
        const filePath = writeNode('hero.md', '---\nid: hero\ntype: character\nrank: private\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: hero\ntype: character\nrank: general\n---\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        assert.equal(result.changed, true);
        assert.equal(result.needsFull, false);
        assert.equal(getFieldsCache().get('hero').rank, 'general');
        teardownVault();
    });

    test('incremental update emits field and relation mutation events', () => {
        setupVault();
        const filePath = writeNode('hero.md', '---\nid: hero\ntype: character\nrank: private\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: hero\ntype: character\nrank: private\nunit: [[roughnecks]]\n---\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        assert.ok(result.mutationEvents.some((event) => event.type === 'field_added' && event.field === 'unit'));
        // Adding a wikilink field where none existed → relation_added (not relation_changed)
        assert.ok(result.mutationEvents.some((event) => event.type === 'relation_added' && event.field === 'unit'));
        teardownVault();
    });

    test('body-only edit emits note_touched so history reflects real work', () => {
        setupVault();
        const filePath = writeNode('hero.md', '---\nid: hero\ntype: character\n---\n\nInitial body.\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: hero\ntype: character\n---\n\nInitial body.\n\nAdded another paragraph.\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        assert.equal(result.changed, true);
        assert.equal(result.needsFull, false);
        assert.ok(result.mutationEvents.some((event) => event.type === 'note_touched' && event.noteId === 'hero'));
        teardownVault();
    });

    test('a body-text wikilink mention added to prose emits a field_added event for the synthetic body-links field, not just note_touched', () => {
        // Real engine change: the mutation log has never recorded body text
        // before this — only frontmatter field deltas. This is what lets
        // x-graph time-lapse's mutation-log fallback path show body-mention
        // growth going forward, for vaults with no git history to fall back on.
        setupVault();
        const filePath = writeNode('hero.md', '---\nid: hero\ntype: character\n---\n\nNo mentions yet.\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: hero\ntype: character\n---\n\nNow mentions [[roughnecks]] in prose.\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        const bodyLinkEvent = result.mutationEvents.find((event) => event.field === '__body_links__');
        assert.ok(bodyLinkEvent, 'expected a mutation event for the synthetic body-links field');
        assert.equal(bodyLinkEvent.type, 'field_added');
        assert.equal(bodyLinkEvent.newValue, '[[roughnecks]]');
        assert.equal(getBodyLinksCache().get('hero'), '[[roughnecks]]');
        teardownVault();
    });

    test('removing the only body-text mention emits a field_removed event', () => {
        setupVault();
        const filePath = writeNode('hero.md', '---\nid: hero\ntype: character\n---\n\nMentions [[roughnecks]] here.\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        assert.equal(getBodyLinksCache().get('hero'), '[[roughnecks]]');
        fs.writeFileSync(filePath, '---\nid: hero\ntype: character\n---\n\nNo more mentions.\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        const bodyLinkEvent = result.mutationEvents.find((event) => event.field === '__body_links__');
        assert.ok(bodyLinkEvent);
        assert.equal(bodyLinkEvent.type, 'field_removed');
        assert.equal(getBodyLinksCache().get('hero'), '');
        teardownVault();
    });

    test('a duplicate body-text mention of the same target does not inflate the tracked value', () => {
        setupVault();
        writeNode('hero.md', '---\nid: hero\ntype: character\n---\n\n[[roughnecks]] and [[roughnecks]] again.\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        assert.equal(getBodyLinksCache().get('hero'), '[[roughnecks]]');
        teardownVault();
    });

    test('type change stays incremental and refreshes fields cache', () => {
        setupVault();
        const filePath = writeNode('typed.md', '---\nid: typed\ntype: mission\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        fs.writeFileSync(filePath, '---\nid: typed\ntype: unit\n---\n', 'utf8');
        bumpMtime(filePath);
        const result = updateSingleFile(filePath);
        assert.equal(result.changed, true);
        assert.equal(result.needsFull, false);
        assert.equal(getFieldsCache().get('typed').type, 'unit');
        teardownVault();
    });
});

describe('removeFileFromIndex', () => {
    test('unknown file is a no-op', () => {
        assert.equal(removeFileFromIndex('/ghost.md').removed, false);
    });

    test('known file is removed from index and fields cache', () => {
        setupVault();
        const filePath = writeNode('dizzy.md', '---\nid: dizzy\ntype: character\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        assert.ok(getIndex().has('dizzy'));
        assert.equal(removeFileFromIndex(filePath).removed, true);
        assert.equal(getIndex().has('dizzy'), false);
        assert.equal(getFieldsCache().has('dizzy'), false);
        teardownVault();
    });

    test('type is unregistered on removal', () => {
        setupVault();
        const filePath = writeNode('zim.md', '---\nid: zim\ntype: sergeant\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        unregisteredLog.length = 0;
        removeFileFromIndex(filePath);
        assert.ok(unregisteredLog.some((entry) => entry.id === 'zim'));
        teardownVault();
    });

    test('second remove returns false', () => {
        setupVault();
        const filePath = writeNode('once.md', '---\nid: once\ntype: character\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        removeFileFromIndex(filePath);
        assert.equal(removeFileFromIndex(filePath).removed, false);
        teardownVault();
    });

    test('emits note_deleted mutation event with the note id', () => {
        setupVault();
        const filePath = writeNode('carl.md', '---\nid: carl-jenkins\ntype: contact\n---\n');
        buildIndex([{ uri: { fsPath: tmpDir } }]);
        const { removed, mutationEvents } = removeFileFromIndex(filePath);
        assert.equal(removed, true);
        assert.equal(mutationEvents.length, 1);
        assert.equal(mutationEvents[0].type, 'note_deleted');
        assert.equal(mutationEvents[0].noteId, 'carl-jenkins');
        teardownVault();
    });
});

describe('writeFieldValue', () => {
    test('updates existing field in place', async () => {
        setupVault();
        const filePath = writeNode('w1.md', '---\nid: w1\nrank: private\n---\nbody\n');
        await writeFieldValue(filePath, 'rank', 'general');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('rank: general'));
        assert.ok(!content.includes('rank: private'));
        teardownVault();
    });

    test('appends missing field before closing block', async () => {
        setupVault();
        const filePath = writeNode('w2.md', '---\nid: w2\n---\nbody\n');
        await writeFieldValue(filePath, 'outcome', 'victory');
        assert.ok(fs.readFileSync(filePath, 'utf8').includes('outcome: victory'));
        teardownVault();
    });

    test('id field stays protected', async () => {
        setupVault();
        const filePath = writeNode('w3.md', '---\nid: protected\n---\n');
        assert.equal(await writeFieldValue(filePath, 'id', 'hacked'), false);
        assert.ok(fs.readFileSync(filePath, 'utf8').includes('id: protected'));
        teardownVault();
    });

    test('missing file returns false', async () => {
        assert.equal(await writeFieldValue('/ghost.md', 'f', 'v'), false);
    });

    test('no frontmatter returns false', async () => {
        setupVault();
        const filePath = writeNode('nofm.md', '# heading\n');
        assert.equal(await writeFieldValue(filePath, 'rank', 'colonel'), false);
        teardownVault();
    });
});
