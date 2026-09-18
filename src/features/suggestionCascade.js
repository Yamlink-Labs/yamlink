'use strict';

// Suggestion cascade — after the user fills one field, nudge the next.
//
// Fires only off a real acceptance signal (completion accepted), never off
// typing. Session-scoped dedup by noteId+field so the same nudge cannot
// repeat for a note this session. Only surfaces the arc's top candidate,
// and only at 'high' confidence — this is the same bar buildNoteArc uses
// for its own confidenceLabel, so cascade nudges never invent confidence
// the rest of the intelligence layer wouldn't stand behind.

const vscode = require('vscode');
const { getFieldsCache, getIndex, getVaultGeneration } = require('../core/indexService');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const { buildNoteArc } = require('../intelligence/noteArc');
const { buildFieldCoOccurrenceMemory, findCoOccurringField } = require('../intelligence/workflowMemory');
const { getMutationEvents } = require('../runtime/mutationEventLog');
const { insertMissingFieldStubs } = require('./healthPanel');
const { syncIndexAfterWrite } = require('../actions/nodeCreationHelpers');

const _cascadeNudgedFields = new Set();

/** Test-only: clear session dedup state between scenarios. @returns {void} */
function resetSuggestionCascade() {
    _cascadeNudgedFields.clear();
}

/**
 * Called from the `yamlink._completionAccepted` handler after a relation
 * completion is accepted. Surfaces at most one non-modal nudge for the
 * note's single highest-confidence missing field.
 * @param {string} noteId
 * @param {string|null} [acceptedField]
 * @returns {Promise<void>}
 */
async function maybeSuggestFieldCascade(noteId, acceptedField = null) {
    const fieldsCache = getFieldsCache();
    const nodeFields = fieldsCache.get(noteId);
    if (!nodeFields) return;
    const noteType = String(nodeFields.type || '').trim().toLowerCase();

    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const arc = buildNoteArc(
        nodeFields,
        noteType,
        fieldsCache,
        priors.typeFieldBundles,
        priors.fieldTargetTypes,
        priors.outcomeCalibration
    );

    const top = arc.missingFields[0];
    let fieldToSuggest = top && top.confidenceLabel === 'high' ? top.field : '';
    if (!fieldToSuggest) {
        const memory = buildFieldCoOccurrenceMemory(getMutationEvents(), { fieldsCache });
        const memoryCandidate = findCoOccurringField(memory, noteType, acceptedField, nodeFields);
        if (!memoryCandidate) return;
        fieldToSuggest = memoryCandidate.field;
    }

    const dedupKey = `${noteId}::${fieldToSuggest}`;
    if (_cascadeNudgedFields.has(dedupKey)) return;
    _cascadeNudgedFields.add(dedupKey);

    const choice = await vscode.window.showInformationMessage(
        `Notes like this usually also have "${fieldToSuggest}" — add it?`,
        'Add Field', 'Dismiss'
    );
    if (choice !== 'Add Field') return;
    const idIndex = getIndex();
    const filePath = idIndex.get(noteId);
    if (!filePath) return;
    const wrote = await insertMissingFieldStubs(filePath, [fieldToSuggest]);
    if (wrote) syncIndexAfterWrite(filePath);
}

module.exports = { maybeSuggestFieldCascade, resetSuggestionCascade };
