'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

require.cache.__sni_index_service__ = {
    id: '__sni_index_service__',
    filename: '__sni_index_service__',
    loaded: true,
    exports: { getVaultGeneration() { return 0; } }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../core/indexService') return '__sni_index_service__';
    return originalResolve(request, parent, ...rest);
};

const {
    extractRelationIds,
    collectCurrentRelationSignals,
    computeObservedRecency
} = require('../src/intelligence/suggestionNoteIndex');

const {
    buildAdaptiveConfidence,
    summarizeAdaptiveFieldHints
} = require('../src/intelligence/suggestionScorer');

const {
    groupStructuredBacklinks,
    summarizeBridgeHints,
    summarizeTraceHints,
    describeContextOrigin
} = require('../src/intelligence/suggestionRelations');

Module._resolveFilename = originalResolve;

// ---------------------------------------------------------------------------

describe('extractRelationIds', () => {
    test('extracts wikilink IDs from a field value', () => {
        const ids = extractRelationIds('works at [[acme-corp]] and knows [[jane-doe]]');
        assert.deepEqual(ids, ['acme-corp', 'jane-doe']);
    });

    test('handles piped wikilinks (alias syntax)', () => {
        const ids = extractRelationIds('[[lt-rasczak|Rasczak]]');
        assert.deepEqual(ids, ['lt-rasczak']);
    });

    test('deduplicates repeated IDs', () => {
        const ids = extractRelationIds('[[rico]] and [[rico]]');
        assert.deepEqual(ids, ['rico']);
    });

    test('returns empty array for plain text with no wikilinks', () => {
        assert.deepEqual(extractRelationIds('just plain text'), []);
    });

    test('returns empty array for null/undefined input', () => {
        assert.deepEqual(extractRelationIds(null), []);
        assert.deepEqual(extractRelationIds(undefined), []);
    });

    test('lowercases all extracted IDs', () => {
        const ids = extractRelationIds('[[Lt-Rasczak]]');
        assert.deepEqual(ids, ['lt-rasczak']);
    });
});

describe('collectCurrentRelationSignals', () => {
    test('collects relation fields and related IDs from note fields', () => {
        const fields = {
            commander: '[[lt-rasczak]]',
            unit: '[[roughnecks]]',
            name: 'Rico'
        };
        const knownIds = new Set(['lt-rasczak', 'roughnecks']);
        const { currentRelationFields, currentRelatedIds } = collectCurrentRelationSignals(fields, [], knownIds);
        assert.ok(currentRelationFields.has('commander'));
        assert.ok(currentRelationFields.has('unit'));
        assert.ok(currentRelatedIds.has('lt-rasczak'));
        assert.ok(currentRelatedIds.has('roughnecks'));
        assert.ok(!currentRelationFields.has('name'));
    });

    test('adds explicitly mentioned IDs to currentRelatedIds', () => {
        const { currentRelatedIds } = collectCurrentRelationSignals({}, ['some-note'], new Set());
        assert.ok(currentRelatedIds.has('some-note'));
    });

    test('returns empty sets for empty input', () => {
        const { currentRelationFields, currentRelatedIds } = collectCurrentRelationSignals();
        assert.equal(currentRelationFields.size, 0);
        assert.equal(currentRelatedIds.size, 0);
    });
});

describe('computeObservedRecency', () => {
    test('returns recencyWeight=1 and null date when no date fields present', () => {
        const r = computeObservedRecency({ name: 'Rico' });
        assert.equal(r.normalizedDate, null);
        assert.equal(r.ageDays, null);
        assert.equal(r.recencyWeight, 1);
    });

    test('picks the most recent date from multiple candidates', () => {
        const r = computeObservedRecency(
            { created: '2026-01-01', updated: '2026-04-01' },
            { referenceDate: '2026-05-08' }
        );
        assert.equal(r.normalizedDate, '2026-04-01');
    });

    test('applies higher recency weight for notes updated within 14 days', () => {
        const r = computeObservedRecency(
            { updated: '2026-05-01' },
            { referenceDate: '2026-05-08' }
        );
        assert.ok(r.ageDays <= 14);
        assert.equal(r.recencyWeight, 1.18);
    });

    test('applies lower recency weight for stale notes (>365 days old)', () => {
        const r = computeObservedRecency(
            { updated: '2024-05-01' },
            { referenceDate: '2026-05-08' }
        );
        assert.ok(r.ageDays > 365);
        assert.equal(r.recencyWeight, 0.7);
    });
});

describe('buildAdaptiveConfidence', () => {
    test('returns high band for high-scoring patterns', () => {
        const r = buildAdaptiveConfidence({
            score: 500, count: 5,
            sharedFields: new Set(['a', 'b']),
            sharedRelatedIds: new Set(['x']),
            sharedTags: new Set(),
            relational: true
        });
        assert.equal(r.confidenceBand, 'high');
        assert.ok(r.confidenceScore >= 520);
    });

    test('returns medium band for moderate patterns', () => {
        // score(200) + count(3)*18 + sharedFields(2)*20 = 294 → medium
        const r = buildAdaptiveConfidence({
            score: 200, count: 3,
            sharedFields: new Set(['a', 'b']),
            sharedRelatedIds: new Set(),
            sharedTags: new Set(),
            relational: false
        });
        assert.equal(r.confidenceBand, 'medium');
    });

    test('returns low band for weak patterns', () => {
        const r = buildAdaptiveConfidence({
            score: 0, count: 0,
            sharedFields: new Set(),
            sharedRelatedIds: new Set(),
            sharedTags: new Set(),
            relational: false
        });
        assert.equal(r.confidenceBand, 'low');
    });
});

describe('groupStructuredBacklinks', () => {
    const fieldsCache = new Map([
        ['note-a', { id: 'note-a', type: 'contact' }],
        ['note-b', { id: 'note-b', type: 'meeting' }]
    ]);

    test('groups backlinks by field + source type', () => {
        const backlinks = [
            { field: 'attendee', sourceId: 'note-a' },
            { field: 'attendee', sourceId: 'note-b' }
        ];
        const { typedGroups, fieldGroups } = groupStructuredBacklinks(backlinks, fieldsCache);
        assert.ok(typedGroups.has('attendee\x00contact'));
        assert.ok(typedGroups.has('attendee\x00meeting'));
        assert.equal(fieldGroups.get('attendee').total, 2);
    });

    test('skips body backlinks', () => {
        const backlinks = [{ field: 'body', sourceId: 'note-a' }];
        const { typedGroups } = groupStructuredBacklinks(backlinks, fieldsCache);
        assert.equal(typedGroups.size, 0);
    });

    test('returns empty maps for empty input', () => {
        const { typedGroups, fieldGroups } = groupStructuredBacklinks([], new Map());
        assert.equal(typedGroups.size, 0);
        assert.equal(fieldGroups.size, 0);
    });
});

describe('summarizeBridgeHints', () => {
    const bridges = [
        { candidateId: 'rico', relatedId: 'rasczak', field: 'commander', origin: 'observed' },
        { candidateId: 'carmen', relatedId: 'rasczak', field: 'commander', origin: 'schema' }
    ];

    test('returns up to limit hints with summary text', () => {
        const hints = summarizeBridgeHints(bridges, 2);
        assert.equal(hints.length, 2);
        assert.match(hints[0].summary, /also connects around/);
    });

    test('respects limit', () => {
        assert.equal(summarizeBridgeHints(bridges, 1).length, 1);
    });

    test('returns empty array for empty input', () => {
        assert.deepEqual(summarizeBridgeHints([], 2), []);
    });
});

describe('summarizeTraceHints', () => {
    const traces = [
        { candidateId: 'rico', relatedId: 'rasczak', field: 'commander', origin: 'observed', path: ['me', 'rasczak', 'rico'] }
    ];

    test('returns trace with path and summary', () => {
        const hints = summarizeTraceHints(traces, 1);
        assert.equal(hints.length, 1);
        assert.deepEqual(hints[0].path, ['me', 'rasczak', 'rico']);
        assert.match(hints[0].summary, /sits close through/);
    });
});

describe('summarizeAdaptiveFieldHints', () => {
    const patterns = [
        {
            field: 'commander',
            relational: true,
            sampleTargets: new Set(['rasczak']),
            sharedFields: new Set(['unit']),
            sharedRelatedIds: new Set(),
            sharedTags: new Set(),
            confidenceBand: 'high'
        }
    ];

    test('returns formatted hints with summary text', () => {
        const hints = summarizeAdaptiveFieldHints(patterns, 1);
        assert.equal(hints.length, 1);
        assert.equal(hints[0].field, 'commander');
        assert.equal(hints[0].relational, true);
        assert.ok(typeof hints[0].summary === 'string');
    });

    test('returns empty array for empty input', () => {
        assert.deepEqual(summarizeAdaptiveFieldHints([], 3), []);
    });
});

describe('describeContextOrigin', () => {
    test('returns label for known origins', () => {
        assert.equal(describeContextOrigin('observed'), 'observed');
        assert.equal(describeContextOrigin('schema'), 'schema');
    });

    test('returns inferred for unknown origin', () => {
        assert.equal(describeContextOrigin('something-else'), 'inferred');
    });
});
