'use strict';

// Structural signature — a macro-level, honest digest of the vault's own
// shape (dominant types, field-bundle rigidity, hub concentration, recent
// growth rate), built entirely from data already computed elsewhere. See
// src/intelligence/structuralSignature.js for the pure computation and the
// design rationale (no hardcoded archetypes — every number ships with a
// plain sentence describing what was actually observed).

const { getFieldsCache, getVaultGeneration } = require('../../core/indexService');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { buildStructuralSignature } = require('../../intelligence/structuralSignature');
const fmt = require('../format');
const { captureOutput, emitCliSuccess, emitText } = require('../io');

function run({ json, output }) {
    const fieldsCache = getFieldsCache();
    const mutationEvents = getMutationEvents();
    const generation = getVaultGeneration();

    const signature = buildStructuralSignature(fieldsCache, mutationEvents, generation);

    if (json) {
        emitCliSuccess(signature, output);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Vault Structural Signature');
        console.log(signature.summary);

        if (signature.dominantTypes.length) {
            fmt.header('Dominant types');
            for (const entry of signature.dominantTypes) {
                console.log(`  ${entry.type.padEnd(20)} ${String(Math.round(entry.ratio * 100)).padStart(3)}%   rigidity ${entry.rigidity.toFixed(2)}   (${entry.count} notes)`);
            }
        }

        fmt.header('Hub concentration');
        console.log(`  Top ${signature.hubs.hubCount} notes hold ${Math.round(signature.hubs.concentration * 100)}% of ${signature.hubs.totalInbound} total inbound links`);

        fmt.header('Recent growth');
        console.log(`  ${signature.growth.recentCreations} notes created in the last 30 days (${Math.round(signature.growth.ratio * 100)}% of current vault size)`);
    }));
}

module.exports = { run };
