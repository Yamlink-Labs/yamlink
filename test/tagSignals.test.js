'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    extractTagsFromNodeFields,
    extractTagsFromText,
    collectDocumentTags
} = require('../src/intelligence/tagSignals');

function makeDocument(text) {
    return {
        getText() {
            return text;
        }
    };
}

describe('tag signals', () => {
    test('extracts normalized tags from frontmatter-like fields', () => {
        const tags = extractTagsFromNodeFields({
            tags: 'CRM, #Enterprise',
            label: 'priority-high'
        }).sort();
        assert.deepEqual(tags, ['crm', 'enterprise', 'priority-high']);
    });

    test('extracts normalized tags from body hashtags', () => {
        const tags = extractTagsFromText('Follow up on #Wayne-Inc and #Q2-review').sort();
        assert.deepEqual(tags, ['q2-review', 'wayne-inc']);
    });

    test('collects body and frontmatter tags as one shared signal set', () => {
        const tags = collectDocumentTags(
            makeDocument('Working on #Wayne-Inc and #enterprise rollout'),
            { tags: 'crm, enterprise' }
        ).sort();
        assert.deepEqual(tags, ['crm', 'enterprise', 'wayne-inc']);
    });
});
