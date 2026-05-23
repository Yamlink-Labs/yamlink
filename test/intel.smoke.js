'use strict';

/**
 * Intelligence smoke test — exercises the full pipeline against the real sample/ vault.
 * Covers all 5 pre-release Zim scenarios without VS Code:
 *   1. Lifecycle classification (hub / consolidated / stale / draft)
 *   2. Drift-aware field completion (homeworld on ace-levy)
 *   3. Note role + bundle suggestion (blank mission note)
 *   4. Signals section data (Note Report overview)
 *   5. Vault drift summary
 *   6. Prior maps sanity check
 *
 * Run with:  node test/intel.smoke.js
 */

const assert = require('node:assert/strict');
const path   = require('path');
const Module = require('module');

// ── VS Code stub ─────────────────────────────────────────────────────────────
const originalResolve = Module._resolveFilename.bind(Module);
require.cache['__smoke_vscode__'] = {
    id: '__smoke_vscode__', filename: '__smoke_vscode__', loaded: true,
    exports: {
        Uri: { file: (f) => ({ fsPath: f }) },
        workspace: { textDocuments: [], applyEdit: async () => true },
        window: { activeTextEditor: null },
        Range: class { constructor(s, e) { this.start = s; this.end = e; } },
        Position: class { constructor(l, c) { this.line = l; this.character = c; } },
        WorkspaceEdit: class { replace() {} }
    }
};
Module._resolveFilename = function (req, parent, ...rest) {
    if (req === 'vscode') return '__smoke_vscode__';
    return originalResolve(req, parent, ...rest);
};
// ─────────────────────────────────────────────────────────────────────────────

const { buildIndex, getIndex, getFieldsCache, getVaultGeneration } = require('../src/core/index');
const { getCachedPriors, getCommonFieldsForType } = require('../src/intelligence/vaultPriors');
const { computeNoteDrift, computeVaultDrift, getDriftSummary } = require('../src/intelligence/driftDetector');
const { inferLifecycleState } = require('../src/intelligence/lifecycleState');
const { inferNoteRole } = require('../src/intelligence/noteRolesCore');
const { getBacklinks } = require('../src/core/graph');

const SAMPLE = path.join(__dirname, '..', 'sample');

buildIndex([{ uri: { fsPath: SAMPLE } }]);

const idIndex     = getIndex();
const fieldsCache = getFieldsCache();
const gen         = getVaultGeneration();
const priors      = getCachedPriors(fieldsCache, gen);

console.log(`\n=== Yamlink Intelligence Smoke Test ===`);
console.log(`Vault:          ${SAMPLE}`);
console.log(`Notes indexed:  ${idIndex.size}`);
console.log(`Vault gen:      ${gen}`);
console.log(`Types in priors: ${[...priors.typeFieldBundles.keys()].join(', ')}`);
console.log();

function lcFor(id) {
    const fields  = fieldsCache.get(id);
    if (!fields) return null;
    const inbound = getBacklinks(id);
    return {
        ...inferLifecycleState(id, fields, {
            inboundCount:       inbound.length,
            fieldsCache,
            typeFieldBundles:   priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors
        }),
        inboundCount: inbound.length
    };
}

// ── TEST 1: Lifecycle classification ─────────────────────────────────────────
console.log('─── TEST 1: Lifecycle classification ─────────────────────────────');

const charIds = [...fieldsCache.entries()]
    .filter(([, f]) => String(f?.type || '').toLowerCase() === 'character')
    .map(([id]) => id);
console.log(`Character notes: ${charIds.join(', ')}`);

const testIds = ['johnny-rico', 'roughnecks', 'ace-levy', 'mission-klendathu'];
const lcResults = {};
for (const id of testIds) {
    const lc = lcFor(id);
    if (!lc) { console.log(`  ${id}: NOT INDEXED`); continue; }
    lcResults[id] = lc;
    console.log(`  ${id}: state=${lc.state}${lc.isStale ? '+stale' : ''} inbound=${lc.inboundCount} likelyType=${lc.likelyType}`);
}

assert.ok(lcResults['johnny-rico'], 'johnny-rico must be classified');
assert.ok(lcResults['roughnecks'],  'roughnecks must be classified');
assert.ok(
    ['hub', 'consolidated', 'growing'].includes(lcResults['roughnecks'].state),
    `roughnecks state should be hub/consolidated/growing; got "${lcResults['roughnecks'].state}"`
);
console.log('  ✔ lifecycle classification passed\n');

// ── TEST 2: Drift-aware completion (homeworld on ace-levy) ────────────────────
console.log('─── TEST 2: Drift-aware completion (homeworld on ace-levy) ───────');

const aceFields = fieldsCache.get('ace-levy');
assert.ok(aceFields, 'ace-levy must be indexed');
console.log(`  ace-levy fields: ${Object.keys(aceFields).join(', ')}`);

const drift = computeNoteDrift('ace-levy', aceFields, fieldsCache, priors);
console.log(`  drift label: ${drift?.driftLabel}, score: ${drift?.driftScore}, insufficientData: ${drift?.insufficientData}`);
console.log(`  missingExpected: ${(drift?.missingExpected || []).map(e => `${e.field}(${Math.round(e.ratio * 100)}%)`).join(', ') || 'none'}`);

assert.ok(drift && !drift.insufficientData, 'drift must produce a real result (vault has ≥3 character notes)');
const hwMissing = (drift.missingExpected || []).find(e => e.field === 'homeworld');
assert.ok(
    hwMissing,
    `homeworld must appear in missingExpected; got: [${(drift.missingExpected || []).map(e => e.field).join(', ')}]`
);
assert.ok(hwMissing.ratio >= 0.60, `homeworld ratio must be ≥0.60; got ${hwMissing.ratio}`);
console.log(`  ✔ homeworld flagged as missing (ratio=${Math.round(hwMissing.ratio * 100)}%)\n`);

// ── TEST 3: Note role + bundle (blank mission note) ───────────────────────────
console.log('─── TEST 3: Note role + bundle (blank mission note) ─────────────');

const missionBundle = getCommonFieldsForType('mission', priors.typeFieldBundles, fieldsCache, { limit: 8, minRatio: 0.30 });
console.log(`  mission bundle: ${missionBundle.map(e => `${e.field}(${Math.round(e.ratio * 100)}%)`).join(', ')}`);

const blankRole = inferNoteRole({ type: 'mission' }, {});
console.log(`  blank mission role: ${blankRole.noteRole || 'none'} (${Math.round((blankRole.confidence || 0) * 100)}%)`);

assert.ok(missionBundle.length > 0, 'mission should have vault-learned bundle fields');
const wantedFields = ['date', 'commander', 'outcome', 'unit'];
const bundleNames  = missionBundle.map(e => e.field);
const found = wantedFields.filter(f => bundleNames.includes(f));
console.log(`  expected fields in bundle: ${found.join(', ')}`);
assert.ok(found.length >= 2, `at least 2 of [date,commander,outcome,unit] expected; got [${found.join(', ')}]`);
console.log('  ✔ mission bundle suggestion passed\n');

// ── TEST 4: Signals section — character note overview ────────────────────────
console.log('─── TEST 4: Signals section (Note Report character notes) ────────');

for (const id of ['johnny-rico', 'carmen-ibanez']) {
    const fields = fieldsCache.get(id);
    if (!fields) { console.log(`  ${id}: NOT INDEXED`); continue; }
    const role      = inferNoteRole(fields, {});
    const lc        = lcFor(id);
    const noteDrift = computeNoteDrift(id, fields, fieldsCache, priors);
    console.log(`  ${id}:`);
    console.log(`    state:    ${lc?.state}${lc?.isStale ? ' +stale' : ''}`);
    console.log(`    role:     ${role.noteRole || 'none'} (${Math.round((role.confidence || 0) * 100)}%)`);
    console.log(`    drift:    ${noteDrift?.driftLabel ?? 'n/a'} (score=${noteDrift?.driftScore ?? 'n/a'})`);
    if (noteDrift?.missingExpected?.length) {
        console.log(`    missing:  ${noteDrift.missingExpected.map(e => e.field).join(', ')}`);
    }
}

const johnnyRole = inferNoteRole(fieldsCache.get('johnny-rico'), {});
assert.ok(
    johnnyRole.noteRole || johnnyRole.confidence > 0,
    `johnny-rico should infer some role; got noteRole=${johnnyRole.noteRole}`
);
console.log('  ✔ signals section data passed\n');

// ── TEST 5: Vault-wide drift summary ──────────────────────────────────────────
console.log('─── TEST 5: Vault-wide drift summary ─────────────────────────────');

const vaultDrift = computeVaultDrift(fieldsCache, priors);
const summary    = getDriftSummary(vaultDrift);
console.log(`  total: ${summary.total}, on-track: ${summary.onTrack}, minor-drift: ${summary.minorDrift}, drifting: ${summary.drifting}, outliers: ${summary.outliers}`);
if (summary.needsAttention.length) {
    console.log(`  needs-attention: ${summary.needsAttention.map(d => `${d.noteId}(${d.driftLabel},score=${d.driftScore})`).join(', ')}`);
}

assert.ok(summary.total > 0, 'vault drift should produce results for sample vault');
const aceVaultDrift = vaultDrift.find(d => d.noteId === 'ace-levy');
assert.ok(aceVaultDrift, 'ace-levy should appear in vault drift results');
assert.ok(aceVaultDrift.driftScore > 0, `ace-levy drift score should be > 0; got ${aceVaultDrift.driftScore}`);
console.log(`  ace-levy vault drift: ${aceVaultDrift.driftLabel} (score=${aceVaultDrift.driftScore})`);
console.log('  ✔ vault drift summary passed\n');

// ── TEST 6: Prior maps sanity ─────────────────────────────────────────────────
console.log('─── TEST 6: Prior maps sanity check ──────────────────────────────');

const charBundle   = priors.typeFieldBundles.get('character');
const charBundleKeys = charBundle ? [...charBundle.keys()] : [];
console.log(`  character bundle: ${charBundleKeys.join(', ')}`);
assert.ok(priors.typeFieldBundles.has('character'), 'typeFieldBundles must include character type');
assert.ok(priors.typeFieldBundles.has('mission'),   'typeFieldBundles must include mission type');
assert.ok(charBundleKeys.includes('homeworld'), `homeworld must be in character bundle`);
assert.ok(charBundleKeys.includes('rank'),      `rank must be in character bundle`);
assert.ok(charBundleKeys.includes('unit'),      `unit must be in character bundle`);

const fieldAmbiguityKeys = [...priors.fieldAmbiguity.keys()];
console.log(`  fieldAmbiguity fields: ${fieldAmbiguityKeys.join(', ')}`);
assert.ok(fieldAmbiguityKeys.length > 0, 'fieldAmbiguity must not be empty');
console.log('  ✔ prior maps sanity passed\n');

// ── DONE ──────────────────────────────────────────────────────────────────────
console.log('=== All intelligence smoke tests passed ===\n');

Module._resolveFilename = originalResolve;
