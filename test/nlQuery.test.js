'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseNaturalQuery, matchVocab, exampleQueries } = require('../src/intelligence/nlQuery');

const VOCAB = {
    types: ['contact', 'project', 'mission', 'task', 'starship'],
    fields: ['status', 'company', 'commander', 'faction', 'due', 'created'],
    workflowFields: new Map([
        ['status', { values: ['active', 'inactive', 'done', 'pending', 'deployed'] }]
    ]),
    noteIds: ['johnny-rico', 'roughnecks', 'acme-corp', 'project-alpha']
};

// ── matchVocab ────────────────────────────────────────────────────────────

describe('matchVocab', () => {
    it('exact match', () => assert.equal(matchVocab('contact', ['contact', 'project']), 'contact'));
    it('plural → singular', () => assert.equal(matchVocab('contacts', ['contact', 'project']), 'contact'));
    it('plural -ies → -y', () => assert.equal(matchVocab('companies', ['company', 'project']), 'company'));
    it('prefix match', () => assert.equal(matchVocab('proj', ['contact', 'project']), 'project'));
    it('no match returns null', () => assert.equal(matchVocab('banana', ['contact', 'project']), null));
    it('null input returns null', () => assert.equal(matchVocab(null, ['contact']), null));
});

// ── parseNaturalQuery ─────────────────────────────────────────────────────

describe('parseNaturalQuery — bare type', () => {
    it('plain type', () => {
        const r = parseNaturalQuery('contacts', VOCAB);
        assert.ok(r);
        assert.ok(r.query.includes('type = contact'));
    });
    it('"all X"', () => {
        const r = parseNaturalQuery('all projects', VOCAB);
        assert.ok(r && r.query.includes('type = project'));
    });
    it('"show me all X"', () => {
        const r = parseNaturalQuery('show me all missions', VOCAB);
        assert.ok(r && r.query.includes('type = mission'));
    });
    it('unknown type returns null', () => {
        assert.equal(parseNaturalQuery('unicorns', VOCAB), null);
    });
});

describe('parseNaturalQuery — status filter', () => {
    it('"active X"', () => {
        const r = parseNaturalQuery('active projects', VOCAB);
        assert.ok(r);
        assert.ok(r.query.includes('type = project'));
        assert.ok(r.query.includes('status = active'));
    });
    it('"X that are active"', () => {
        const r = parseNaturalQuery('contacts that are inactive', VOCAB);
        assert.ok(r && r.query.includes('status = inactive'));
    });
    it('"deployed starships"', () => {
        const r = parseNaturalQuery('deployed starships', VOCAB);
        assert.ok(r && r.query.includes('status = deployed'));
    });
});

describe('parseNaturalQuery — date filters', () => {
    it('"stale X"', () => {
        const r = parseNaturalQuery('stale contacts', VOCAB);
        assert.ok(r);
        assert.ok(r.query.includes('file.modified < days-ago(30)'));
    });
    it('"recent X"', () => {
        const r = parseNaturalQuery('recent contacts', VOCAB);
        assert.ok(r);
        assert.ok(r.query.includes('file.modified > days-ago(7)'));
        assert.ok(r.query.includes('sort file.modified desc'));
    });
    it('"X from this week"', () => {
        const r = parseNaturalQuery('projects from this week', VOCAB);
        assert.ok(r && r.query.includes('file.modified > days-ago(7)'));
    });
    it('"X due today"', () => {
        const r = parseNaturalQuery('tasks due today', VOCAB);
        assert.ok(r && r.query.includes('due = today()'));
    });
    it('"X due this week"', () => {
        const r = parseNaturalQuery('tasks due this week', VOCAB);
        assert.ok(r && r.query.includes('days-from-now(7)'));
    });
    it('"X overdue"', () => {
        const r = parseNaturalQuery('tasks overdue', VOCAB);
        assert.ok(r && r.query.includes('due < today()'));
    });
    it('"X not modified in N days"', () => {
        const r = parseNaturalQuery("contacts i haven't updated in 45 days", VOCAB);
        assert.ok(r && r.query.includes('days-ago(45)'));
    });
});

describe('parseNaturalQuery — relation filter', () => {
    it('"X linked to Y"', () => {
        const r = parseNaturalQuery('missions linked to johnny-rico', VOCAB);
        assert.ok(r);
        assert.ok(r.query.includes('via johnny-rico'));
        assert.ok(r.query.includes('type = mission'));
    });
    it('"X about Y"', () => {
        const r = parseNaturalQuery('projects about acme-corp', VOCAB);
        assert.ok(r && r.query.includes('via acme-corp'));
    });
});

describe('parseNaturalQuery — field filters', () => {
    it('"X without Y"', () => {
        const r = parseNaturalQuery('contacts without company', VOCAB);
        assert.ok(r && r.query.includes('company is empty'));
    });
    it('"X missing Y"', () => {
        const r = parseNaturalQuery('contacts missing faction', VOCAB);
        assert.ok(r && r.query.includes('faction is empty'));
    });
    it('"X with Y"', () => {
        const r = parseNaturalQuery('contacts with company', VOCAB);
        assert.ok(r && r.query.includes('company exists'));
    });
    it('"X that have Y"', () => {
        const r = parseNaturalQuery('projects that have commander', VOCAB);
        assert.ok(r && r.query.includes('commander exists'));
    });
});

describe('parseNaturalQuery — grouping', () => {
    it('"group X by Y"', () => {
        const r = parseNaturalQuery('group contacts by status', VOCAB);
        assert.ok(r && r.query.includes('group by status'));
    });
    it('"X by Y"', () => {
        const r = parseNaturalQuery('contacts by status', VOCAB);
        assert.ok(r && r.query.includes('group by status'));
    });
});

describe('parseNaturalQuery — result shape', () => {
    it('returns query, explanation, confidence', () => {
        const r = parseNaturalQuery('active projects', VOCAB);
        assert.ok(r);
        assert.ok(typeof r.query === 'string');
        assert.ok(r.query.startsWith('!view'));
        assert.ok(typeof r.explanation === 'string');
        assert.ok(r.confidence === 'high' || r.confidence === 'medium');
    });
    it('returns null for empty input', () => {
        assert.equal(parseNaturalQuery('', VOCAB), null);
    });
    it('returns null when no vocab matches', () => {
        assert.equal(parseNaturalQuery('purple elephant dancing', VOCAB), null);
    });
});

describe('exampleQueries', () => {
    it('returns array of strings', () => {
        const ex = exampleQueries(['contact', 'project']);
        assert.ok(Array.isArray(ex) && ex.length > 0);
        assert.ok(ex.every(s => typeof s === 'string'));
    });
    it('uses first vault type in examples', () => {
        const ex = exampleQueries(['starship']);
        assert.ok(ex.some(s => s.includes('starship')));
    });
});
