'use strict';
/**
 * check-test-count.js
 *
 * Runs `npm test` and asserts the total test count has not dropped below the
 * recorded baseline. Exits 1 if count < baseline or if any test fails.
 *
 * Usage:
 *   node scripts/check-test-count.js
 *
 * Update the baseline after intentionally removing tests:
 *   node scripts/check-test-count.js --update
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const BASELINE_FILE = path.join(__dirname, 'test-count-baseline.json');
const UPDATE_MODE   = process.argv.includes('--update');

// ── Run the test suite ────────────────────────────────────────────────────────

let output = '';
let exitCode = 0;

try {
    output = execSync('npm test 2>&1', {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
} catch (err) {
    output   = err.stdout || '';
    exitCode = err.status || 1;
}

// ── Parse counts ──────────────────────────────────────────────────────────────

function parseLine(label) {
    const m = output.match(new RegExp(`^ℹ ${label} (\\d+)`, 'm'));
    return m ? parseInt(m[1], 10) : null;
}

const total  = parseLine('tests');
const passed = parseLine('pass');
const failed = parseLine('fail');

if (total === null) {
    console.error('check-test-count: could not parse test output');
    console.error(output.slice(-2000));
    process.exit(1);
}

console.log(`Tests: ${total} total, ${passed} pass, ${failed} fail`);

// ── Enforce zero failures ─────────────────────────────────────────────────────

if (failed > 0 || exitCode !== 0) {
    console.error(`\ncheck-test-count: ${failed} test(s) failed — suite must be green.`);
    process.exit(1);
}

// ── Enforce baseline count ────────────────────────────────────────────────────

if (UPDATE_MODE) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ baseline: total }, null, 2) + '\n');
    console.log(`Baseline updated to ${total}.`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`check-test-count: baseline file missing. Run with --update to create it.`);
    process.exit(1);
}

const { baseline } = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

if (total < baseline) {
    console.error(
        `\ncheck-test-count: test count dropped from ${baseline} to ${total}.\n` +
        `  If tests were intentionally removed, run: node scripts/check-test-count.js --update`
    );
    process.exit(1);
}

if (total > baseline) {
    console.log(`\nTest count grew: ${baseline} → ${total}. Run --update to lock in the new baseline.`);
}

console.log(`Baseline check passed (${total} >= ${baseline}).`);
