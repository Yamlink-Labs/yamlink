'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { canonicalizeId, extractCanonicalIdFromFrontmatter } = require('../src/core/id');

describe('id canonicalization', () => {
    test('normalises accents and spacing into kebab-case ids', () => {
        assert.equal(canonicalizeId('Jaime Ramírez'), 'jaime-ramirez');
        assert.equal(canonicalizeId('  Carmen Ibáñez  '), 'carmen-ibanez');
    });

    test('keeps simple canonical ids stable', () => {
        assert.equal(canonicalizeId('johnny-rico'), 'johnny-rico');
        assert.equal(canonicalizeId('mission_alpha'), 'mission_alpha');
    });

    test('extracts and canonicalizes id fields from frontmatter', () => {
        const text = [
            '---',
            'id: Jaime Ramírez',
            'type: contact',
            '---',
            ''
        ].join('\n');
        assert.equal(extractCanonicalIdFromFrontmatter(text), 'jaime-ramirez');
    });

    test('supports quoted id values too', () => {
        const text = [
            '---',
            'id: "Jean Rasczák"',
            '---',
            ''
        ].join('\n');
        assert.equal(extractCanonicalIdFromFrontmatter(text), 'jean-rasczak');
    });
});
