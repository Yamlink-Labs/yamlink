'use strict';

const { buildVaultLenses } = require('../../intelligence/vaultLenses');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { getIndex } = require('../../core/indexService');
const { captureOutput, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function run({ json }) {
    const lenses = buildVaultLenses(getMutationEvents({ limit: 2000 }), getIndex());
    if (json) {
        emitCliSuccess(lenses);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Vault Lenses');
        fmt.subheader('Most edited');
        for (const item of lenses.mostEdited) fmt.row(`  ${item.noteId}`, item.editCount);
        fmt.blank();
        fmt.subheader('Fastest growing types');
        for (const item of lenses.fastestGrowingTypes) fmt.row(`  ${item.type}`, item.count);
        fmt.blank();
        fmt.subheader('Unstable fields');
        for (const item of lenses.unstableFields) fmt.row(`  ${item.field}`, item.reversalCount);
        fmt.blank();
        fmt.subheader('Recurring patterns');
        for (const item of lenses.recurringPatterns) fmt.row(`  ${item.pattern}`, item.count);
        fmt.blank();
    }));
}

module.exports = { run };
