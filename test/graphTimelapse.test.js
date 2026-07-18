'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    pickCheckpointTimestamps,
    buildTimelapseFrame,
    buildTimelapseSequence
} = require('../src/features/graph/graphTimelapse');

const DAY = 86400000;

describe('pickCheckpointTimestamps', () => {
    test('returns an empty array when there are no mutation events', () => {
        assert.deepEqual(pickCheckpointTimestamps([], new Date().toISOString()), []);
    });

    test('returns just now when now is not after the earliest event', () => {
        const now = new Date(2026, 0, 1).toISOString();
        const events = [{ timestamp: now }];
        assert.deepEqual(pickCheckpointTimestamps(events, now), [now]);
    });

    test('produces evenly-spaced timestamps from earliest event to now, inclusive of both ends', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const earliest = now - 130 * DAY;
        // Bounded by frameCount, not event count, once there are enough events —
        // 20 spread-out events comfortably exceed the requested 10 frames.
        const events = Array.from({ length: 20 }, (_, i) => ({
            timestamp: new Date(earliest + i * 6 * DAY).toISOString()
        }));
        const nowIso = new Date(now).toISOString();
        const result = pickCheckpointTimestamps(events, nowIso, 10);

        assert.equal(result.length, 10);
        assert.equal(result[0], new Date(earliest).toISOString());
        assert.equal(result[result.length - 1], nowIso);
        // Strictly increasing
        for (let i = 1; i < result.length; i++) {
            assert.ok(Date.parse(result[i]) > Date.parse(result[i - 1]));
        }
    });

    test('never produces more frames than there are events, plus one', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const events = [
            { timestamp: new Date(now - 10 * DAY).toISOString() },
            { timestamp: new Date(now - 5 * DAY).toISOString() }
        ];
        const result = pickCheckpointTimestamps(events, new Date(now).toISOString(), 14);
        assert.equal(result.length, 3);
    });
});

describe('buildTimelapseFrame', () => {
    test('reconstructs a frame with the notes that existed at the target time, and a relation edge added later is absent before it existed', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([
            ['a', { id: 'a', type: 'note', name: 'Alpha', mentor: '[[b]]' }],
            ['b', { id: 'b', type: 'person', name: 'Beta' }]
        ]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 10 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            { type: 'note_created', noteId: 'b', timestamp: new Date(now - 8 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            {
                type: 'field_added', noteId: 'a', field: 'mentor',
                timestamp: new Date(now - 3 * DAY).toISOString(),
                oldValue: null, newValue: '[[b]]'
            }
        ];

        // Before the relation was added: both notes exist, no edge yet.
        const early = buildTimelapseFrame(new Date(now - 5 * DAY).toISOString(), { fieldsCache, mutationEvents });
        assert.equal(early.nodes.length, 2);
        assert.equal(early.edges.length, 0);

        // After: the mentor relation resolves to a real edge.
        const late = buildTimelapseFrame(new Date(now).toISOString(), { fieldsCache, mutationEvents });
        assert.equal(late.nodes.length, 2);
        assert.equal(late.edges.length, 1);
        assert.equal(late.edges[0].source, 'a');
        assert.equal(late.edges[0].target, 'b');
        assert.equal(late.edges[0].field, 'mentor');
    });

    test('excludes notes that did not exist yet at the target timestamp', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'note' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 1 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const frame = buildTimelapseFrame(new Date(now - 5 * DAY).toISOString(), { fieldsCache, mutationEvents });
        assert.equal(frame.nodes.length, 0);
        assert.equal(frame.edges.length, 0);
    });

    test('shows a body-text mention edge when bodyLinksCache is provided (mutation-log fallback path for non-git vaults)', () => {
        // core/index.js now tracks body-text wikilink mentions going forward
        // (the bodyLinksCache work) — this proves buildTimelapseFrame actually
        // surfaces that as a real, field: 'body' edge, not just frontmatter
        // relations, for vaults with no git history to fall back on.
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([
            ['a', { id: 'a', type: 'note' }],
            ['b', { id: 'b', type: 'note' }]
        ]);
        const bodyLinksCache = new Map([['a', '[[b]]']]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 10 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            { type: 'note_created', noteId: 'b', timestamp: new Date(now - 10 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const frame = buildTimelapseFrame(new Date(now).toISOString(), { fieldsCache, mutationEvents, bodyLinksCache });
        const bodyEdge = frame.edges.find((e) => e.field === 'body');
        assert.ok(bodyEdge, 'expected a body-mention edge');
        assert.equal(bodyEdge.source, 'a');
        assert.equal(bodyEdge.target, 'b');
    });

    test('resolves a wikilink written by display-name alias, not just an exact canonical id — the same alias index the live graph already uses', () => {
        // This is the real bug the user hit: buildHistoricalGraph()'s edge
        // extraction previously only ever canonicalized [[Display Name]] into
        // a guessed id and checked for an exact match — it never consulted
        // the alias index at all, unlike the live graph's own edge builder
        // (core/index.js's registerResolvedEdges -> resolveLinkedTarget).
        // A vault where every wikilink is written by alias, not by the raw
        // canonical id, would show 0 historical edges despite the live graph
        // showing real ones.
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        // The wikilink target ("Rasczak's Roughnecks") does NOT naively
        // canonicalize to the note's real id ("roughnecks") — resolution can
        // only succeed by going through the alias index, exactly like the
        // live graph's registerResolvedEdges -> resolveLinkedTarget does.
        const fieldsCache = new Map([
            ['carl-jenkins', { id: 'carl-jenkins', type: 'person', name: 'Carl Jenkins', mentor: "[[Rasczak's Roughnecks]]" }],
            ['roughnecks', { id: 'roughnecks', type: 'unit', name: "Rasczak's Roughnecks" }]
        ]);
        const idIndex = new Map([['carl-jenkins', 'x'], ['roughnecks', 'x']]);
        // canonicalizeId strips the apostrophe: "Rasczak's Roughnecks" -> "rasczak-s-roughnecks"
        const aliasIndex = new Map([['rasczak-s-roughnecks', 'roughnecks']]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'carl-jenkins', timestamp: new Date(now - 10 * DAY).toISOString(), field: null, oldValue: null, newValue: null },
            { type: 'note_created', noteId: 'roughnecks', timestamp: new Date(now - 10 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];

        const frame = buildTimelapseFrame(new Date(now).toISOString(), { fieldsCache, mutationEvents, idIndex, aliasIndex });
        assert.equal(frame.edges.length, 1);
        assert.equal(frame.edges[0].source, 'carl-jenkins');
        assert.equal(frame.edges[0].target, 'roughnecks');
    });

    test('each returned node carries the xgraph-shaped fields the renderer/layout expect', () => {
        const now = Date.parse('2026-07-13T00:00:00.000Z');
        const fieldsCache = new Map([['a', { id: 'a', type: 'person', name: 'Alpha' }]]);
        const mutationEvents = [
            { type: 'note_created', noteId: 'a', timestamp: new Date(now - 1 * DAY).toISOString(), field: null, oldValue: null, newValue: null }
        ];
        const frame = buildTimelapseFrame(new Date(now).toISOString(), { fieldsCache, mutationEvents });
        assert.equal(frame.nodes.length, 1);
        const node = frame.nodes[0];
        assert.equal(node.id, 'a');
        assert.equal(node.label, 'Alpha');
        assert.equal(node.kind, 'person');
        assert.ok(Number.isFinite(node.weight));
        assert.ok(Array.isArray(node.edges));
    });
});

describe('buildTimelapseSequence', () => {
    test('builds a full frame sequence from the live vault accessors', () => {
        // buildTimelapseSequence reads getFieldsCache()/getMutationEvents()/
        // getVaultSnapshots() directly — with none seeded, it should degrade
        // gracefully to an empty sequence rather than throwing.
        const result = buildTimelapseSequence({ frameCount: 6 });
        assert.ok(Array.isArray(result.frames));
        assert.ok('earliest' in result);
        assert.ok('latest' in result);
    });
});
