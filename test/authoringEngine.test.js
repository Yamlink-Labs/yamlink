'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);

require.cache.__authoring_schema_stub__ = {
    id: '__authoring_schema_stub__',
    filename: '__authoring_schema_stub__',
    loaded: true,
    exports: {
        getSchema(type) {
            if (type === 'character') {
                return {
                    fields: {
                        unit: { type: 'relation', target: 'unit' },
                        homeworld: { type: 'relation', targetTypes: ['planet', 'location'] }
                    }
                };
            }
            return null;
        }
    }
};

require.cache.__authoring_type_stub__ = {
    id: '__authoring_type_stub__',
    filename: '__authoring_type_stub__',
    loaded: true,
    exports: {
        getTypes() {
            return new Set(['unit', 'character', 'planet']);
        }
    }
};

require.cache.__authoring_roles_stub__ = {
    id: '__authoring_roles_stub__',
    filename: '__authoring_roles_stub__',
    loaded: true,
    exports: {
        inferNoteRole() {
            return { noteRole: 'person', confidence: 0.8 };
        }
    }
};

require.cache.__authoring_body_stub__ = {
    id: '__authoring_body_stub__',
    filename: '__authoring_body_stub__',
    loaded: true,
    exports: {
        extractBodyMentionedIds(text) {
            const result = new Map();
            if (String(text || '').includes('roughnecks')) result.set('roughnecks', 2);
            return result;
        }
    }
};

require.cache.__authoring_fieldcat_stub__ = {
    id: '__authoring_fieldcat_stub__',
    filename: '__authoring_fieldcat_stub__',
    loaded: true,
    exports: {
        CATEGORY: { UNKNOWN: 'UNKNOWN', RELATION: 'RELATION' },
        classifyField(fieldName, options) {
            return {
                category: options.schemaFieldDef ? 'RELATION' : 'UNKNOWN',
                confidence: options.schemaFieldDef ? 1 : 0.2,
                source: options.schemaFieldDef ? 'schema' : 'default',
                reasons: [fieldName]
            };
        }
    }
};

require.cache.__authoring_planner_stub__ = {
    id: '__authoring_planner_stub__',
    filename: '__authoring_planner_stub__',
    loaded: true,
    exports: {
        planFieldActions(classification, surface) {
            return {
                level: classification.category === 'RELATION' && surface === 'completion' ? 1 : 0,
                allowedActions: classification.category === 'RELATION' ? new Set(['createNote']) : new Set()
            };
        }
    }
};

require.cache.__authoring_priors_stub__ = {
    id: '__authoring_priors_stub__',
    filename: '__authoring_priors_stub__',
    loaded: true,
    exports: {
        getCachedPriors() {
            return {
                fieldTargetTypes: new Map([
                    ['owner', new Map([['account', 4], ['contact', 1]])]
                ]),
                typeFieldBundles: new Map(),
                fieldAmbiguity: new Map(),
                noteRoleTypePriors: new Map(),
                typeRoleMap: new Map(),
                workflowFields: new Map(),
                valuePatterns: new Map()
            };
        },
        getDominantTargetType(fieldName, fieldTargetTypes) {
            const counts = fieldTargetTypes.get(fieldName);
            if (!counts) return null;
            const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
            const total = entries.reduce((sum, [, count]) => sum + count, 0);
            const [targetType, count] = entries[0];
            return { targetType, count, total, ratio: count / total };
        }
    }
};

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '../registries/schemaRegistry') return '__authoring_schema_stub__';
    if (request === '../registries/typeRegistry') return '__authoring_type_stub__';
    if (request === './noteRolesCore') return '__authoring_roles_stub__';
    if (request === './frontmatterBodyHints') return '__authoring_body_stub__';
    if (request === './fieldCategory') return '__authoring_fieldcat_stub__';
    if (request === './fieldPlanner') return '__authoring_planner_stub__';
    if (request === './vaultPriors') return '__authoring_priors_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    classifyFieldForAuthoring,
    collectAuthoringFieldSignals,
    evaluateFieldForSurface,
    getExpectedRelationTypes,
    rankWikilinkTargets,
    summarizeAuthoringFieldSignals
} = require('../src/intelligence/authoringEngine');

after(() => {
    Module._resolveFilename = originalResolve;
});

describe('authoringEngine', () => {
    test('classifyFieldForAuthoring routes schema-backed fields through one shared context', () => {
        const result = classifyFieldForAuthoring('unit', {
            noteType: 'character',
            noteFields: { type: 'character', name: 'Johnny Rico' },
            documentText: 'Worked with roughnecks',
            fieldsCache: new Map([['roughnecks', { type: 'unit' }]]),
            generation: 3
        });

        assert.equal(result.classification.category, 'RELATION');
        assert.equal(result.classification.source, 'schema');
        assert.equal(result.context.noteRole.noteRole, 'person');
        assert.equal(result.context.bodyWikilinkCounts.get('roughnecks'), 2);
        assert.deepEqual(result.schemaFieldDef, { type: 'relation', target: 'unit' });
    });

    test('evaluateFieldForSurface attaches planner output to the same classification result', () => {
        const result = evaluateFieldForSurface('unit', 'completion', {
            noteType: 'character',
            noteFields: { type: 'character' },
            fieldsCache: new Map(),
            generation: 1
        });

        assert.equal(result.classification.category, 'RELATION');
        assert.equal(result.plan.level, 1);
        assert.equal(result.plan.allowedActions.has('createNote'), true);
    });

    test('getExpectedRelationTypes prefers schema targets, then vault priors, then known vault types', () => {
        const schemaDriven = getExpectedRelationTypes('homeworld', {
            noteType: 'character',
            fieldsCache: new Map(),
            generation: 1
        });
        assert.deepEqual(schemaDriven, ['planet', 'location']);

        const priorDriven = getExpectedRelationTypes('owner', {
            noteType: '',
            fieldsCache: new Map([['acme', { type: 'account' }]]),
            generation: 1
        });
        assert.deepEqual(priorDriven, ['account']);

        const typeFallback = getExpectedRelationTypes('unit', {
            noteType: '',
            fieldsCache: new Map(),
            generation: 1
        });
        assert.deepEqual(typeFallback, ['unit']);
    });

    test('rankWikilinkTargets boosts expected-type matches ahead of weaker textual matches', () => {
        const ranked = rankWikilinkTargets([
            { id: 'roughnecks', label: 'Roughnecks', type: 'unit' },
            { id: 'rasczak-report', label: 'Rasczak Report', type: 'note' },
            { id: 'rico-roster', label: 'Rico Roster', type: 'note' }
        ], 'r', { expectedTypes: ['unit'] });

        assert.equal(ranked[0].id, 'roughnecks');
        assert.deepEqual(
            ranked.slice(1).map((entry) => entry.id).sort(),
            ['rasczak-report', 'rico-roster']
        );
    });

    test('collectAuthoringFieldSignals returns planner-backed relation signals in priority order', () => {
        const signals = collectAuthoringFieldSignals('lightbulb', {
            noteType: 'character',
            noteFields: {
                type: 'character',
                homeworld: '[[buenos-aires]]',
                unit: '[[roughnecks]]',
                name: 'Johnny Rico'
            },
            documentText: 'Served with roughnecks',
            fieldsCache: new Map([['roughnecks', { type: 'unit' }]]),
            generation: 2
        });

        assert.equal(signals[0].fieldName, 'homeworld');
        assert.deepEqual(signals[0].expectedTypes, ['planet', 'location']);
        assert.ok(signals.some((signal) => signal.fieldName === 'unit'));
    });

    test('summarizeAuthoringFieldSignals returns a short shared summary for read surfaces', () => {
        const summary = summarizeAuthoringFieldSignals('lightbulb', {
            noteType: 'character',
            noteFields: {
                type: 'character',
                unit: '[[roughnecks]]'
            },
            documentText: 'Served with roughnecks',
            fieldsCache: new Map([['roughnecks', { type: 'unit' }]]),
            generation: 2
        });

        assert.ok(summary);
        assert.match(summary.summary, /unit/i);
        assert.ok(
            /unit notes/i.test(summary.summary) || /relation field/i.test(summary.summary),
            `unexpected summary: ${summary.summary}`
        );
    });
});
