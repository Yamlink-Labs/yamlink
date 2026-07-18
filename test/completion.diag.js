'use strict';
/**
 * Diagnose why frontmatter key completion and relation completion
 * produce no/wrong results in VS Code.
 *
 * Run: node test/completion.diag.js
 */

const path   = require('path');
const fs     = require('fs');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache['__diag_vsc__'] = {
    id: '__diag_vsc__', filename: '__diag_vsc__', loaded: true,
    exports: {
        languages: { registerCompletionItemProvider: () => ({ dispose() {} }) },
        window:    { createOutputChannel: () => ({ appendLine() {} }) },
        workspace: {
            workspaceFolders: [],
            onDidChangeTextDocument: () => ({ dispose() {} }),
            onDidCreateFiles:        () => ({ dispose() {} }),
            onDidDeleteFiles:        () => ({ dispose() {} }),
            onDidRenameFiles:        () => ({ dispose() {} })
        },
        EventEmitter: class { fire() {} dispose() {} },
        Uri:          { file: (f) => ({ fsPath: f }) },
        Range:        class { constructor(s, e) { this.start = s; this.end = e; } },
        Position:     class { constructor(l, c) { this.line = l; this.character = c; } },
        CompletionItem: class {
            constructor(l, k) { this.label = l; this.kind = k; this.sortText = ''; this.detail = ''; }
        },
        CompletionItemKind: { Field: 0, Reference: 1, EnumMember: 2, Snippet: 3, Text: 4 },
        CompletionTriggerKind: { Invoke: 0 },
        SnippetString: class { constructor(v) { this.value = v; } }
    }
};
Module._resolveFilename = (req, p, ...r) =>
    req === 'vscode' ? '__diag_vsc__' : originalResolve(req, p, ...r);

const { buildIndex, getIndex } = require('../src/core/index');
const { getSchema } = require('../src/registries/schemaRegistry');
const {
    isPositionInFrontmatter,
    getDocumentType,
    normalizeFrontmatterKey
} = require('../src/intelligence/completionContextHelpers');
const {
    collectObservedFrontmatterFields,
    collectArchetypeFieldSuggestions,
    collectNoteRoleFieldSuggestions,
    collectDriftMissingFieldSuggestions
} = require('../src/intelligence/completionAdaptiveHelpers');
const { scoreFieldSuggestion } = require('../src/intelligence/completionRelationHelpers');
const {
    resolveFrontmatterRelationCandidates
} = require('../src/intelligence/completionRelationHelpers');

const SAMPLE = path.join(__dirname, '..', 'sample');
buildIndex([{ uri: { fsPath: SAMPLE } }]);

const idIndex     = getIndex();
console.log(`\n=== Frontmatter completion diagnostics ===`);
console.log(`Notes indexed: ${idIndex.size}\n`);

// ── Build a mock VS Code document ────────────────────────────────────────────
function makeDoc(filePath, insertBlankAtLine = null) {
    let text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split('\n');
    if (insertBlankAtLine !== null) {
        lines.splice(insertBlankAtLine, 0, '');
        text = lines.join('\n');
    }
    return {
        uri:        { fsPath: filePath },
        getText:    () => text,
        lineAt:     (i) => ({ text: text.split('\n')[i] ?? '' }),
        languageId: 'markdown'
    };
}

// ── DIAG 1: isPositionInFrontmatter ──────────────────────────────────────────
console.log('─── DIAG 1: isPositionInFrontmatter ─────────────────────────────');
const aceFile = path.join(SAMPLE, 'ace-levy.md');
const aceLines = fs.readFileSync(aceFile, 'utf8').split('\n');
console.log('ace-levy.md lines:');
aceLines.forEach((l, i) => console.log(`  ${i}: ${JSON.stringify(l)}`));

// Insert blank at line 5 (between rank: private and closing ---)
const aceDocWithBlank = makeDoc(aceFile, 5);
const blankLineIndex = 5;
const inFM = isPositionInFrontmatter(aceDocWithBlank, blankLineIndex);
console.log(`\n  isPositionInFrontmatter at line ${blankLineIndex}: ${inFM}`);
if (!inFM) {
    console.error('  ❌ FAIL: blank line in frontmatter not detected as frontmatter!');
} else {
    console.log('  ✔ frontmatter detection OK');
}

// ── DIAG 2: getDocumentType ──────────────────────────────────────────────────
console.log('\n─── DIAG 2: getDocumentType ──────────────────────────────────────');
const docType = getDocumentType(aceDocWithBlank);
console.log(`  docType: ${JSON.stringify(docType)}`);
if (docType !== 'character') {
    console.error(`  ❌ FAIL: expected "character", got "${docType}"`);
} else {
    console.log('  ✔ document type detected correctly');
}

// ── DIAG 3: schema fields ────────────────────────────────────────────────────
console.log('\n─── DIAG 3: Schema fields for character ──────────────────────────');
const schema = getSchema(docType);
const schemaFields = Object.entries(schema?.fields || {});
console.log(`  schema fields: ${schemaFields.map(([k,v]) => `${k}(${v.type})`).join(', ')}`);
if (!schemaFields.length) {
    console.error('  ❌ FAIL: no schema fields found for character type!');
} else {
    console.log(`  ✔ ${schemaFields.length} schema fields found`);
}

// ── DIAG 4: drift fields ─────────────────────────────────────────────────────
console.log('\n─── DIAG 4: Drift missing field suggestions ──────────────────────');
let driftFields = [];
try {
    driftFields = collectDriftMissingFieldSuggestions(aceDocWithBlank, docType, idIndex);
    console.log(`  drift fields (${driftFields.length}): ${driftFields.map(e => `${e.key}(score=${e.score})`).join(', ')}`);
    if (!driftFields.some(e => e.key === 'homeworld')) {
        console.error('  ❌ homeworld not in drift suggestions!');
    } else {
        console.log('  ✔ homeworld present in drift suggestions');
    }
} catch (e) {
    console.error(`  ❌ EXCEPTION: ${e.message}`);
    console.error(e.stack);
}

// ── DIAG 5: archetype fields ─────────────────────────────────────────────────
console.log('\n─── DIAG 5: Archetype field suggestions ──────────────────────────');
let archetypeFields = [];
try {
    archetypeFields = collectArchetypeFieldSuggestions(aceDocWithBlank, docType);
    console.log(`  archetype fields (${archetypeFields.length}): ${archetypeFields.slice(0, 5).map(e => e.key).join(', ')}`);
} catch (e) {
    console.error(`  ❌ EXCEPTION: ${e.message}`);
}

// ── DIAG 6: observed fields ──────────────────────────────────────────────────
console.log('\n─── DIAG 6: Observed frontmatter fields ──────────────────────────');
let observedFields = [];
try {
    observedFields = collectObservedFrontmatterFields(docType).map(e => ({ ...e, roleAligned: false }));
    console.log(`  observed fields (${observedFields.length}): ${observedFields.slice(0, 6).map(e => `${e.key}(${e.count})`).join(', ')}`);
} catch (e) {
    console.error(`  ❌ EXCEPTION: ${e.message}`);
}

// ── DIAG 7: note role fields ─────────────────────────────────────────────────
console.log('\n─── DIAG 7: Note role field suggestions ──────────────────────────');
let noteRoleFields = [];
try {
    noteRoleFields = collectNoteRoleFieldSuggestions(aceDocWithBlank, docType, idIndex);
    console.log(`  note role fields (${noteRoleFields.length}): ${noteRoleFields.slice(0, 5).map(e => e.key).join(', ')}`);
} catch (e) {
    console.error(`  ❌ EXCEPTION: ${e.message}`);
}

// ── DIAG 8: build combined + score ───────────────────────────────────────────
console.log('\n─── DIAG 8: Combined completion map (what Ctrl+Space would show) ─');
const combined = new Map();
const partialKey = '';

for (const [key, def] of schemaFields) {
    const label = normalizeFrontmatterKey(key);
    combined.set(label, {
        key: label,
        sortScore: 1400 + (def.required ? 80 : 0),
        detail: `from schema`,
        source: 'schema'
    });
}
for (const entry of driftFields) {
    const existing = combined.get(entry.key);
    if (!existing) {
        combined.set(entry.key, { key: entry.key, sortScore: 1350 + entry.score, detail: entry.driftNote, source: 'drift' });
    } else {
        existing.sortScore += 200 + entry.score;
        existing.detail += `; ${entry.driftNote}`;
    }
}
for (const entry of archetypeFields) {
    const existing = combined.get(entry.key);
    if (!existing) {
        combined.set(entry.key, { key: entry.key, sortScore: 1000 + entry.score, detail: `archetype`, source: 'archetype' });
    } else {
        existing.sortScore += entry.score;
    }
}
for (const entry of observedFields) {
    const existing = combined.get(entry.key);
    if (!existing) {
        combined.set(entry.key, { key: entry.key, sortScore: 500 + entry.count, detail: `observed ${entry.count}x`, source: 'observed' });
    } else {
        existing.sortScore += entry.count;
    }
}

const rankedFields = Array.from(combined.values())
    .map(entry => ({ ...entry, matchScore: scoreFieldSuggestion(entry, partialKey) }))
    .filter(entry => entry.matchScore >= 0)
    .sort((a, b) => b.matchScore - a.matchScore || a.key.localeCompare(b.key));

console.log(`  combined map has ${combined.size} entries, ranked ${rankedFields.length} after filter`);
if (!rankedFields.length) {
    console.error('  ❌ FAIL: rankedFields is empty — Ctrl+Space would show nothing!');
} else {
    console.log('  Top 8 completions:');
    for (const entry of rankedFields.slice(0, 8)) {
        console.log(`    ${entry.key.padEnd(14)} matchScore=${entry.matchScore} source=${entry.source} detail="${entry.detail}"`);
    }
}

// ── DIAG 9: Relation completion for unit: [[ ────────────────────────────────
console.log('\n─── DIAG 9: Relation completion for "unit: [[" ───────────────────');
// Simulate position in a note that has "unit: [[" on a new line
const aceDocUnitLine = {
    uri: { fsPath: aceFile },
    getText: () => `---\nid: ace-levy\ntype: character\nname: Ace Levy\nrank: private\nunit: [[\n---\n`,
    lineAt: (i) => {
        const ls = `---\nid: ace-levy\ntype: character\nname: Ace Levy\nrank: private\nunit: [[\n---\n`.split('\n');
        return { text: ls[i] ?? '' };
    }
};
const pos5 = { line: 5, character: 8 }; // after "unit: [["
try {
    const rel = resolveFrontmatterRelationCandidates(aceDocUnitLine, pos5, idIndex);
    if (!rel) {
        console.error('  ❌ resolveFrontmatterRelationCandidates returned null for "unit: [["');
    } else {
        console.log(`  fieldName: ${rel.fieldName}`);
        console.log(`  hasWiki: ${rel.hasWiki}`);
        console.log(`  targetType: ${rel.targetType}`);
        console.log(`  preferredIds: [${rel.preferredIds.join(', ')}]`);
        console.log(`  candidateIds count: ${rel.candidateIds.length}`);
        if (!rel.preferredIds.includes('roughnecks')) {
            console.error(`  ❌ roughnecks NOT in preferredIds!`);
        } else {
            console.log(`  ✔ roughnecks is a preferred candidate`);
        }
    }
} catch (e) {
    console.error(`  ❌ EXCEPTION: ${e.message}`);
    console.error(e.stack);
}

console.log('\n=== Diagnostics complete ===\n');
Module._resolveFilename = originalResolve;
