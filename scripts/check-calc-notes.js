#!/usr/bin/env node
'use strict';

// Read-only check of every formula in a folder of notes.
// Usage: node scripts/check-calc-notes.js [folder]   (default: ./sample)
// Never writes to the folder; it only reads .md files.

const fs = require('fs');
const path = require('path');
const { parseFrontmatterDocument } = require('../src/core/frontmatter');
const { scanInlineCalcs } = require('../src/engine/inlineCalc');

const folder = path.resolve(process.argv[2] || path.join(__dirname, '..', 'sample'));

function listMarkdown(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === '_templates' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listMarkdown(full, out);
        else if (entry.name.endsWith('.md')) out.push(full);
    }
    return out;
}

let totalFormulas = 0;
let totalProblems = 0;
const files = listMarkdown(folder).sort();

for (const file of files) {
    const parsed = parseFrontmatterDocument(fs.readFileSync(file, 'utf8'));
    const cells = scanInlineCalcs(parsed.body, { frontmatterFields: parsed.data });
    const viewCount = (parsed.body.match(/^!view\b/gm) || []).length;
    if (cells.length === 0 && viewCount === 0) continue;

    const relative = path.relative(folder, file);
    console.log(`\n${relative}`);
    // Cross-note references and table references (T1.field) both need the
    // live vault index — one to read another note, the other to run a
    // !view query — which this read-only check deliberately never builds
    // (that's what makes it safe to run against a private vault). Cells
    // that depend on either are skipped, not reported as broken; VS Code
    // checks them with the real index.
    const skippedNames = new Set();
    for (const cell of cells) {
        totalFormulas++;
        const label = cell.name ? `${cell.name} (${cell.label})` : cell.label;
        const ev = cell.evalResult;
        const isCrossNote = cell.expr.includes('[[') || /\bT\d+\./.test(cell.expr);
        const dependsOnSkipped = [...skippedNames].some((name) => new RegExp(`\\b${name}\\b`).test(cell.expr));
        if (isCrossNote || dependsOnSkipped) {
            if (cell.name) skippedNames.add(cell.name);
            console.log(`  SKIP   ${label.padEnd(26)} needs the vault index (check in VS Code)  in  ${cell.expr}`);
        } else if (ev && ev.ok) {
            const shown = typeof ev.value === 'number' ? Number(ev.value.toFixed(4)) : ev.value;
            console.log(`  OK     ${label.padEnd(26)} = ${String(shown).padEnd(14)}  from  ${cell.expr}`);
        } else {
            totalProblems++;
            console.log(`  PROBLEM ${label.padEnd(25)} ${ev ? ev.error : 'no result'}  in  ${cell.expr}`);
        }
    }
    if (viewCount) console.log(`  ${viewCount} table/chart block(s) in this note (open the note in VS Code to see them)`);
}

console.log(`\n${totalFormulas} formula(s) checked, ${totalProblems} problem(s) found.`);
process.exitCode = totalProblems > 0 ? 1 : 0;
