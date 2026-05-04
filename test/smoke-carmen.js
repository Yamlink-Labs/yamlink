'use strict';

// ─────────────────────────────────────────────────────────────────
// smoke-carmen.js
//
// Three-part hardening diagnostic:
//   1. Real-vault smoke test — index the sample vault, exercise the
//      full intelligence stack per note, report any errors or crashes.
//   2. Graph noise assessment — for every field of every note, compare
//      inferFieldRole WITH vs WITHOUT graph observations. Report where
//      graph inference fires and whether the result is semantically sound.
//   3. Confidence threshold assessment — for every note, report note-role
//      confidence against each surface threshold. Flag boundary cases and
//      anything that looks wrong.
//
// Run: node test/smoke-carmen.js
// ─────────────────────────────────────────────────────────────────

const path = require('path');
const { performance } = require('node:perf_hooks');

const { buildIndex, getIndex, getFieldsCache, getVaultGeneration } = require('../src/core/index');
const { getEdges, getBacklinks } = require('../src/core/graph');
const { getRegistry } = require('../src/registries/typeRegistry');
const { getSchema, getSchemaTargets } = require('../src/registries/schemaRegistry');
const { normaliseDateInput } = require('../src/core/date');
const {
    DEFAULT_INFERENCE_CONFIDENCE,
    DEFAULT_STATUS_LIKE_VALUES,
    DEFAULT_SEMANTIC_ROLE_PRIORS,
    normalizeFieldName,
    inferFieldRole: inferFieldRolePure
} = require('../src/intelligence/fieldRolesCore');
const {
    buildNoteContext,
    buildObservedFields
} = require('../src/intelligence/suggestionCore');
const { getEdges: getEdgesForGraph } = require('../src/core/graph');
const { buildFrontmatterOpportunityModel } = require('../src/intelligence/frontmatterIntelligence');
const { computeSuggestionsForNode } = require('../src/engine/suggestions');
const { shouldSurface, filterItemsForSurface, SURFACE_POLICY } = require('../src/intelligence/confidence');
const { summarizeNoteRole } = require('../src/intelligence/noteRolesCore');

// ─── helpers ───────────────────────────────────────────────────────

let errors = 0;
let warnings = 0;
let graphFires = 0;
let graphCorrect = 0;
let graphSuspect = 0;

function pass(msg)  { console.log(`  ✔  ${msg}`); }
function warn(msg)  { console.log(`  ⚠  ${msg}`); warnings++; }
function fail(msg)  { console.log(`  ✖  ${msg}`); errors++; }
function info(msg)  { console.log(`     ${msg}`); }
function section(title) { console.log(`\n── ${title} ──`); }

function buildSyntheticFieldsCache(multiplier) {
    const fieldsCache = new Map();
    function add(id, fields) {
        fieldsCache.set(id, { id, ...fields });
    }
    add('account-acme', { type: 'account', name: 'Acme Corp', owner: '[[alice-smith]]', region: 'north-america' });
    add('account-orbit', { type: 'account', name: 'Orbit Labs', owner: '[[bob-chen]]', region: 'europe' });
    add('alice-smith', { type: 'person', name: 'Alice Smith' });
    add('bob-chen', { type: 'person', name: 'Bob Chen' });
    add('yamlink', { type: 'project', name: 'Yamlink' });
    add('atomix', { type: 'project', name: 'Atomix' });

    for (let i = 1; i <= multiplier; i++) {
        const company = i % 2 === 0 ? 'account-acme' : 'account-orbit';
        add(`contact-${i}`, {
            type: i % 5 === 0 ? 'note' : 'contact',
            name: `Contact ${i}`,
            company: `[[${company}]]`,
            owner: i % 3 === 0 ? '[[alice-smith]]' : '[[bob-chen]]',
            stage: i % 4 === 0 ? 'active' : 'lead'
        });
    }
    for (let i = 1; i <= multiplier; i++) {
        const account = i % 2 === 0 ? 'account-acme' : 'account-orbit';
        const contact = `contact-${((i - 1) % multiplier) + 1}`;
        add(`meeting-${i}`, {
            type: i % 7 === 0 ? 'note' : 'meeting',
            title: `Meeting ${i}`,
            account: `[[${account}]]`,
            contact: `[[${contact}]]`,
            followup: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`
        });
    }
    for (let i = 1; i <= multiplier; i++) {
        const project = i % 2 === 0 ? 'yamlink' : 'atomix';
        add(`task-${i}`, {
            type: i % 6 === 0 ? 'note' : 'task',
            title: `Task ${i}`,
            project: `[[${project}]]`,
            reporter: i % 2 === 0 ? '[[alice-smith]]' : '[[bob-chen]]',
            deadline: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`
        });
    }

    return fieldsCache;
}

// ─── PART 1: Build index ─────────────────────────────────────────

section('PART 1: Real-vault index smoke test');

const samplePath = path.join(__dirname, '..', 'sample');
buildIndex([{ uri: { fsPath: samplePath } }]);

const index      = getIndex();
const fieldsCache = getFieldsCache();
const gen        = getVaultGeneration();

info(`Sample vault: ${samplePath}`);
info(`Nodes indexed: ${index.size}`);
info(`Vault generation: ${gen}`);

if (index.size === 0) {
    fail('Index is empty — sample vault may not have indexed correctly');
    process.exit(1);
} else {
    pass(`${index.size} nodes indexed`);
}

// Build idToType map early — used by graph obs and field inference
const registry = getRegistry();
const idToType  = new Map();
for (const [type, ids] of registry.entries()) {
    for (const id of ids) idToType.set(id, type);
}

// Check every indexed note has a type
let typeless = 0;
for (const [id] of index) {
    const fields = fieldsCache.get(id);
    if (!fields || !fields.type) {
        warn(`Node "${id}" has no type: field`);
        typeless++;
    }
}
if (typeless === 0) pass('All nodes have a type: field');

// Check graph has edges
let totalEdges = 0;
for (const [id] of index) {
    totalEdges += (getEdges(id) || []).length;
}
if (totalEdges === 0) {
    warn('No edges found in graph — wikilinks may not have indexed');
} else {
    pass(`${totalEdges} graph edges indexed`);
}

// Build observed fields once
const observedFields = buildObservedFields(fieldsCache);
pass(`buildObservedFields(): ${observedFields.length} entries`);

// Build graph observations inline (mirrors fieldRoles.js's buildGraphObservations)
function buildGraphObservations(idIndex) {
    const idToTypeLocal = new Map();
    for (const [type, ids] of registry.entries()) {
        for (const id of ids) idToTypeLocal.set(id, type);
    }
    const observations = [];
    for (const sourceId of idIndex.keys()) {
        const edges = getEdgesForGraph(sourceId);
        for (const edge of edges) {
            observations.push({
                field: edge.field,
                sourceType: idToTypeLocal.get(sourceId) || '',
                targetType: idToTypeLocal.get(edge.targetId) || ''
            });
        }
    }
    return observations;
}
const graphObs = buildGraphObservations(index);
pass(`buildGraphObservations(): ${graphObs.length} edge observations`);

// ─── PART 2: Graph noise assessment ──────────────────────────────

section('PART 2: Graph inference noise assessment');
info(`DEFAULT_INFERENCE_CONFIDENCE threshold: ${DEFAULT_INFERENCE_CONFIDENCE}`);
info('Comparing inferFieldRole WITH vs WITHOUT graph observations per field');

const allFieldsToCheck = new Set();
for (const fields of fieldsCache.values()) {
    for (const k of Object.keys(fields || {})) {
        if (k !== 'id' && k !== 'type') allFieldsToCheck.add(k);
    }
}

for (const fieldName of [...allFieldsToCheck].sort()) {
    // Find which note type(s) use this field
    const usedByTypes = new Set();
    for (const fields of fieldsCache.values()) {
        if (fields[fieldName] !== undefined) {
            usedByTypes.add(String(fields.type || '').trim().toLowerCase() || '(untyped)');
        }
    }

    for (const docType of usedByTypes) {
        const withGraph = inferFieldRolePure(normalizeFieldName(fieldName), {
            documentType: docType,
            knownTypes: [...idToType.values()],
            observedFields,
            graphObservations: graphObs,
            idToType,
            dateParser: normaliseDateInput,
            statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
            semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
            inferenceConfidence: DEFAULT_INFERENCE_CONFIDENCE
        });

        const withoutGraph = inferFieldRolePure(normalizeFieldName(fieldName), {
            documentType: docType,
            knownTypes: [...idToType.values()],
            observedFields,
            graphObservations: [],  // no graph signal
            idToType,
            dateParser: normaliseDateInput,
            statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
            semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
            inferenceConfidence: DEFAULT_INFERENCE_CONFIDENCE
        });

        const graphChanged = withGraph.targetType !== withoutGraph.targetType ||
                             withGraph.relational  !== withoutGraph.relational;

        if (!graphChanged) continue;

        // Graph inference fired — assess whether the change makes sense
        graphFires++;
        const change = `"${fieldName}" [${docType}]: without=${withoutGraph.targetType || 'none'} → with=${withGraph.targetType || 'none'}`;

        // Sanity checks for the graph result
        const graphTarget = withGraph.targetType;
        const isKnownType = graphTarget ? idToType.has(graphTarget) || [...idToType.values()].includes(graphTarget) : true;
        const reasonsMakeSense = withGraph.reasons.some(r => r.includes('graph usage'));

        if (graphTarget && !isKnownType) {
            fail(`NOISY graph inference: ${change} — "${graphTarget}" is not a known vault type`);
            graphSuspect++;
        } else if (withoutGraph.targetType && withGraph.targetType && withoutGraph.targetType !== withGraph.targetType) {
            // Graph is OVERRIDING existing inference — this shouldn't happen (graph is only used when !targetType)
            fail(`CONFLICT: graph inference overriding prior signal — ${change}`);
            graphSuspect++;
        } else {
            pass(`Graph adds targetType: ${change}`);
            if (graphTarget) info(`  reason: "${withGraph.reasons.find(r => r.includes('graph')) || withGraph.reasons.slice(-1)[0]}"`);
            graphCorrect++;
        }
    }
}

if (graphFires === 0) {
    info('Graph inference did not fire on any field in this vault.');
    info('This is expected if all fields are already resolved by schema, field-name, or observed-value inference.');
    info('Graph inference is a last-resort signal — silence here is a good sign.');
} else {
    info(`Graph fired on ${graphFires} field/type combination(s): ${graphCorrect} sound, ${graphSuspect} suspect`);
}

// ─── PART 3: Confidence threshold assessment ──────────────────────

section('PART 3: Confidence threshold assessment');
info('Surface thresholds:');
for (const [surface, policy] of Object.entries(SURFACE_POLICY)) {
    info(`  ${surface.padEnd(30)} min=${policy.minimum}  fallback=${policy.fallbackLimit}`);
}
console.log('');

let noteRoleSilent = 0;
let noteRoleVisible = 0;
let noteRoleBoundary = 0;
let suggestionsTotal = 0;
let opportunitiesTotal = 0;
let crashCount = 0;

for (const [nodeId] of index) {
    const nodeFields = fieldsCache.get(nodeId) || {};
    const nodeType   = String(nodeFields.type || '').trim().toLowerCase();

    let noteContext, opportunities, suggestions;

    // Run full intelligence stack — catch any crash
    try {
        noteContext = buildNoteContext(nodeFields, nodeType, {
            observedFields,
            getSchemaForType: getSchema,
            dateParser: normaliseDateInput,
            statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
            semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
        });
    } catch (e) {
        fail(`buildNoteContext crashed on "${nodeId}": ${e.message}`);
        crashCount++;
        continue;
    }

    try {
        opportunities = buildFrontmatterOpportunityModel(nodeFields, {
            nodeId,
            nodeType,
            fieldsCache,
            observedFields,
            noteContext,
            getSchemaTargets,
            getSchemaForType: getSchema,
            getDefaultSortField: () => 'created',
            dateParser: normaliseDateInput,
            statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
            semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
            limit: 4,
            connectionLimit: 4
        });
    } catch (e) {
        fail(`buildFrontmatterOpportunityModel crashed on "${nodeId}": ${e.message}`);
        crashCount++;
        continue;
    }

    try {
        suggestions = computeSuggestionsForNode(nodeId);
    } catch (e) {
        fail(`computeSuggestionsForNode crashed on "${nodeId}": ${e.message}`);
        crashCount++;
        continue;
    }

    // ── Note-role confidence ────────────────────────────────────
    const noteRole = noteContext.noteRole;
    if (noteRole?.noteRole) {
        const conf = noteRole.confidence ?? 0;
        const label = noteRole.roleLabel || noteRole.noteRole;
        const visibleInHover  = shouldSurface(noteRole, 'hover-note-role', { confidenceKey: 'confidence' });
        const visibleInReport = shouldSurface(noteRole, 'report-note-role', { confidenceKey: 'confidence' });
        const BOUNDARY = 0.08; // within this much of a threshold = boundary case

        const hoverThreshold  = SURFACE_POLICY['hover-note-role'].minimum;
        const reportThreshold = SURFACE_POLICY['report-note-role'].minimum;

        const nearHover  = Math.abs(conf - hoverThreshold) <= BOUNDARY;
        const nearReport = Math.abs(conf - reportThreshold) <= BOUNDARY;

        if (visibleInHover) {
            pass(`"${nodeId}" (${nodeType}) → role="${label}" conf=${conf.toFixed(2)} — surfaces in hover + report`);
            noteRoleVisible++;
        } else if (visibleInReport) {
            warn(`"${nodeId}" (${nodeType}) → role="${label}" conf=${conf.toFixed(2)} — surfaces in report only (below hover threshold ${hoverThreshold})`);
            noteRoleBoundary++;
        } else {
            warn(`"${nodeId}" (${nodeType}) → role="${label}" conf=${conf.toFixed(2)} — SILENT on all surfaces (below report threshold ${reportThreshold})`);
            noteRoleSilent++;
        }

        if (nearHover && !visibleInHover) {
            info(`  ↳ boundary: ${(conf - hoverThreshold).toFixed(3)} away from hover threshold`);
        }
        if (noteRole.supportingSignals?.length) {
            info(`  ↳ supporting: ${noteRole.supportingSignals.slice(0, 2).join('; ')}`);
        }
        if (noteRole.conflictingSignals?.length) {
            info(`  ↳ conflicts:  ${noteRole.conflictingSignals.slice(0, 2).join('; ')}`);
        }
    } else {
        info(`"${nodeId}" (${nodeType}) — no note-role inferred`);
    }

    // ── Opportunities ────────────────────────────────────────────
    const hoverOps  = filterItemsForSurface(opportunities.likelyFields, 'hover-opportunities', { scoreScale: 700 });
    const reportOps = filterItemsForSurface(opportunities.likelyFields, 'report-opportunities', { scoreScale: 700 });

    if (opportunities.likelyFields.length > 0) {
        opportunitiesTotal += opportunities.likelyFields.length;
        info(`  ↳ likelyFields: ${opportunities.likelyFields.length} total | hover=${hoverOps.length} | report=${reportOps.length}`);
        if (opportunities.recommendedBundle?.fields?.length) {
            info(`  ↳ bundle: ${opportunities.recommendedBundle.fields.map(h => h.field).join(', ')}`);
        }
    }

    // ── Suggestions ──────────────────────────────────────────────
    if (suggestions.length > 0) {
        suggestionsTotal += suggestions.length;
        info(`  ↳ suggestions: ${suggestions.length} [${suggestions.map(s => s.kind).join(', ')}]`);
    }
}

// ─── Summary ─────────────────────────────────────────────────────

section('PART 4: Synthetic stress assessment');

for (const multiplier of [60, 150]) {
    const syntheticCache = buildSyntheticFieldsCache(multiplier);
    const targetNode = syntheticCache.get('contact-10');
    const observedSynthetic = buildObservedFields(syntheticCache);
    const noteContextSynthetic = buildNoteContext(targetNode, String(targetNode.type || '').trim().toLowerCase(), {
        observedFields: observedSynthetic,
        getSchemaForType: getSchema,
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS
    });

    const t0 = performance.now();
    const model = buildFrontmatterOpportunityModel(targetNode, {
        nodeId: 'contact-10',
        nodeType: String(targetNode.type || '').trim().toLowerCase(),
        fieldsCache: syntheticCache,
        observedFields: observedSynthetic,
        noteContext: noteContextSynthetic,
        getSchemaTargets,
        getSchemaForType: getSchema,
        getDefaultSortField: () => 'created',
        dateParser: normaliseDateInput,
        statusLikeValues: DEFAULT_STATUS_LIKE_VALUES,
        semanticRolePriors: DEFAULT_SEMANTIC_ROLE_PRIORS,
        limit: 4,
        connectionLimit: 4
    });
    const duration = Math.round(performance.now() - t0);

    info(`Synthetic vault (${syntheticCache.size} nodes): frontmatter opportunities in ${duration}ms`);
    info(`  ↳ likelyContexts=${model.likelyContexts.length}, likelyConnections=${model.likelyConnections.length}, surroundingSetups=${model.surroundingSetups.length}`);

    if (duration > 6000) {
        warn(`Synthetic ${syntheticCache.size}-node opportunity pass is still too slow for comfort (${duration}ms)`);
    } else {
        pass(`Synthetic ${syntheticCache.size}-node opportunity pass stayed within the current Carmen comfort band`);
    }
}

section('SUMMARY');

const totalNotes = index.size;
console.log(`  Notes indexed:      ${totalNotes}`);
console.log(`  Graph edges:        ${totalEdges}`);
console.log(`  Graph obs entries:  ${graphObs.length}`);
console.log(`  Graph inference fires: ${graphFires} (${graphCorrect} sound, ${graphSuspect} suspect)`);
console.log('');
console.log(`  Note roles visible (hover):  ${noteRoleVisible}`);
console.log(`  Note roles visible (report): ${noteRoleBoundary}`);
console.log(`  Note roles silent:           ${noteRoleSilent}`);
console.log(`  Total opportunities:         ${opportunitiesTotal}`);
console.log(`  Total suggestions:           ${suggestionsTotal}`);
console.log('');
console.log(`  Crashes: ${crashCount}`);
console.log(`  Warnings: ${warnings}`);
console.log(`  Errors: ${errors}`);

if (crashCount > 0) {
    console.log('\n  STATUS: FAIL — crashes detected in intelligence stack');
    process.exit(1);
} else if (errors > 0) {
    console.log('\n  STATUS: FAIL — errors detected');
    process.exit(1);
} else if (warnings > 0) {
    console.log('\n  STATUS: PASS WITH WARNINGS — review warnings above');
} else {
    console.log('\n  STATUS: CLEAN PASS');
}
