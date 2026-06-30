'use strict';

const { getIndex, getDuplicateIds } = require('../../core/indexService');
const { getEdges } = require('../../core/graph');
const { collectHealthStats, computeHealthScore } = require('../../features/health/healthStats');
const { emitCliError, emitJson, emitText } = require('../io');

function buildPayload(vaultPath) {
    const idIndex = getIndex();
    let brokenLinks = 0;
    for (const [id] of idIndex) {
        for (const edge of getEdges(id) || []) {
            if (!idIndex.has(edge.targetId)) brokenLinks++;
        }
    }
    const duplicateCount = Array.from(getDuplicateIds().keys()).length;
    const health = computeHealthScore(collectHealthStats());
    return {
        vault: vaultPath,
        notes: idIndex.size,
        broken: brokenLinks + duplicateCount,
        health
    };
}

function shellLines(payload, shell) {
    if (shell === 'fish') {
        return [
            `set -x YAMLINK_VAULT "${payload.vault}"`,
            `set -x YAMLINK_NOTES "${payload.notes}"`,
            `set -x YAMLINK_BROKEN "${payload.broken}"`,
            `set -x YAMLINK_HEALTH "${payload.health}"`
        ];
    }
    return [
        `export YAMLINK_VAULT="${payload.vault}"`,
        `export YAMLINK_NOTES="${payload.notes}"`,
        `export YAMLINK_BROKEN="${payload.broken}"`,
        `export YAMLINK_HEALTH="${payload.health}"`
    ];
}

function run({ vaultPath, shell, json }) {
    const normalizedShell = String(shell || '').trim().toLowerCase();
    if (!json && !['bash', 'zsh', 'fish'].includes(normalizedShell)) {
        emitCliError({ json, error: 'Usage: yamlink env --shell bash|zsh|fish', code: 'USAGE', exitCode: 1 });
        return;
    }

    const payload = buildPayload(vaultPath);
    if (json) {
        emitJson(payload);
        return;
    }

    emitText(shellLines(payload, normalizedShell).join('\n') + '\n');
}

module.exports = { run };
