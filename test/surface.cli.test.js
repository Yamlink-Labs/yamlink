'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { createVault } = require('./lib/vaultSim');

const BIN = path.resolve('bin/yamlink.js');

function cli(args, vaultPath) {
    const allArgs = vaultPath ? [...args, '--vault', vaultPath] : args;
    return spawnSync('node', [BIN, ...allArgs], {
        encoding: 'utf8',
        cwd: path.resolve('.'),
        timeout: 15000,
    });
}

function cliLive(args, vaultPath) {
    const allArgs = vaultPath ? [...args, '--vault', vaultPath] : args;
    return require('child_process').spawn('node', [BIN, ...allArgs], {
        encoding: 'utf8',
        cwd: path.resolve('.'),
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function parseJson(stdout) {
    return JSON.parse(String(stdout || '').trim());
}

const FIXTURE = {
    'johnny-rico.md': [
        '---', 'id: johnny-rico', 'type: contact',
        'name: Johnny Rico', 'unit: "[[roughnecks]]"', 'status: active',
        '---', '', '- [ ] Submit mission report', '- [x] File debrief paperwork',
    ].join('\n'),
    'carl-jenkins.md': [
        '---', 'id: carl-jenkins', 'type: contact',
        'name: Carl Jenkins', 'unit: "[[roughnecks]]"',
        '---',
    ].join('\n'),
    'roughnecks.md': [
        '---', 'id: roughnecks', 'type: unit', 'name: Roughnecks', '---',
    ].join('\n'),
};

let vault;
let vaultPath;

before(() => {
    vault = createVault(FIXTURE);
    vaultPath = vault.dir;
});

after(() => {
    vault.destroy();
});

test('CLI --help exits 0 with usage text', () => {
    const result = cli(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /briefing/);
    assert.match(result.stdout, /yamlink/);
});

test('CLI unknown command exits 1', () => {
    const result = cli(['frobulate'], vaultPath);
    assert.equal(result.status, 1);
});

test('CLI unknown command --json returns contract error shape', () => {
    const result = cli(['frobulate', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'USAGE');
    assert.equal(body.details.command, 'frobulate');
});

test('CLI missing vault path exits 1', () => {
    const result = cli(['health', '--vault', '/nonexistent/path/xyz']);
    assert.equal(result.status, 1);
});

test('CLI missing vault path --json returns contract error shape', () => {
    const result = cli(['health', '--vault', '/nonexistent/path/xyz', '--json']);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(typeof body.details.vaultPath, 'string');
});

test('CLI briefing exits 0 and human output has expected sections', () => {
    const result = cli(['briefing'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout.toLowerCase(), /notes/);
    assert.match(result.stdout.toLowerCase(), /edges/);
});

test('CLI briefing --json has expected shape', () => {
    const result = cli(['briefing', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(typeof body.pulse, 'object');
    assert.equal(typeof body.pulse.notes, 'number');
    assert.equal(typeof body.pulse.edges, 'number');
    assert.equal(typeof body.pulse.types, 'number');
    assert.equal(typeof body.pulse.brokenLinks, 'number');
    assert.equal(typeof body.tasks, 'object');
    assert.ok(Array.isArray(body.activity));
});

test('CLI ls --quiet prints one note per line, tab-separated, sorted by name', () => {
    const result = cli(['ls', '--sort', 'name', '--quiet'], vaultPath);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^carl-jenkins\tcontact\tCarl Jenkins$/);
    assert.match(lines[1], /^johnny-rico\tcontact\tJohnny Rico$/);
    assert.match(lines[2], /^roughnecks\tunit\tRoughnecks$/);
});

test('CLI ls default output is a real aligned table, not raw tab-separated lines', () => {
    const result = cli(['ls', '--sort', 'name'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /id\s+type\s+name/);
    assert.match(result.stdout, /─+/);
    assert.match(result.stdout, /carl-jenkins\s+contact\s+Carl Jenkins/);
    assert.ok(!result.stdout.includes('\t'), 'table output has no raw tab characters');
});

test('CLI ls --json filters by type and returns array shape', () => {
    const result = cli(['ls', '--type', 'contact', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);
    assert.ok(body.every((entry) => entry.type === 'contact'));
    assert.equal(body[0].id, 'carl-jenkins');
});

test('CLI cat prints frontmatter and body text', () => {
    const result = cli(['cat', 'johnny-rico'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^---/);
    assert.match(result.stdout, /id: johnny-rico/);
    assert.match(result.stdout, /type: contact/);
    assert.match(result.stdout, /- \[ \] Submit mission report/);
});

test('CLI cat --json returns fields plus body', () => {
    const result = cli(['cat', 'johnny-rico', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.id, 'johnny-rico');
    assert.equal(body.type, 'contact');
    assert.equal(typeof body.body, 'string');
    assert.match(body.body, /Submit mission report/);
});

test('CLI cat --at reconstructs frontmatter as of a past timestamp, omitting body', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\nstatus: active\n---\nBody text.\n' });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        const setResult = cli(['set', 'johnny-rico', 'status', 'deployed'], vault.dir);
        assert.equal(setResult.status, 0);

        const result = cli(['cat', 'johnny-rico', '--at', since], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /status: active/);
        assert.doesNotMatch(result.stdout, /Body text/);
    } finally {
        vault.destroy();
    }
});

test('CLI cat --at --json returns reconstructed fields with completeness metadata', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\nstatus: active\n---\n' });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        cli(['set', 'johnny-rico', 'status', 'deployed'], vault.dir);

        const result = cli(['cat', 'johnny-rico', '--at', since, '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.id, 'johnny-rico');
        assert.equal(body.status, 'active');
        assert.equal(typeof body.complete, 'boolean');
    } finally {
        vault.destroy();
    }
});

test('CLI cat --at with an invalid date exits 1 with INVALID_PARAM', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\n---\n' });
    try {
        const result = cli(['cat', 'johnny-rico', '--at', 'not-a-date', '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.code, 'INVALID_PARAM');
    } finally {
        vault.destroy();
    }
});

test('CLI cat --at for an id that never existed at that time exits 1', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\n---\n' });
    try {
        const result = cli(['cat', 'nonexistent-note', '--at', new Date().toISOString(), '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.code, 'NOT_FOUND');
    } finally {
        vault.destroy();
    }
});

test('CLI grep --quiet prints matching frontmatter values, tab-separated', () => {
    const result = cli(['grep', 'rough', '--field', 'unit', '--quiet'], vaultPath);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.ok(lines.includes('johnny-rico\tunit\t[[roughnecks]]'));
    assert.ok(lines.includes('carl-jenkins\tunit\t[[roughnecks]]'));
});

test('CLI grep default output is a real aligned table', () => {
    const result = cli(['grep', 'rough', '--field', 'unit'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /id\s+field\s+value/);
    assert.match(result.stdout, /johnny-rico\s+unit\s+\[\[roughnecks\]\]/);
});

test('CLI grep --json respects type and field filters', () => {
    const result = cli(['grep', 'johnny', '--type', 'contact', '--field', 'name', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].id, 'johnny-rico');
    assert.equal(body[0].field, 'name');
});

test('CLI find --quiet prints notes matching has and missing filters, tab-separated', () => {
    const result = cli(['find', '--type', 'contact', '--has', 'status', '--missing', 'owner', '--quiet'], vaultPath);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(lines, ['johnny-rico\tcontact']);
});

test('CLI find default output is a real aligned table', () => {
    const result = cli(['find', '--type', 'contact', '--has', 'status', '--missing', 'owner'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /id\s+type/);
    assert.match(result.stdout, /johnny-rico\s+contact/);
});

test('CLI find --json returns structural matches as array', () => {
    const result = cli(['find', '--has', 'unit', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);
    assert.deepEqual(body.map((entry) => entry.id), ['carl-jenkins', 'johnny-rico']);
});

test('CLI build exits 0 on clean vault', () => {
    const result = cli(['build'], vaultPath);
    assert.equal(result.status, 0);
});

test('CLI build exits 1 on vault with broken links', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ym-cli-broken-'));
    try {
        fs.writeFileSync(path.join(tmpDir, 'ghost.md'), '---\nid: ghost\ntype: contact\nunit: "[[nonexistent-unit]]"\n---\n', 'utf8');
        const result = cli(['build'], tmpDir);
        assert.equal(result.status, 1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('CLI health exits 0', () => {
    const result = cli(['health'], vaultPath);
    assert.equal(result.status, 0);
});

test('CLI health --json has expected shape', () => {
    const result = cli(['health', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(typeof body.notes, 'number');
    assert.ok(body.notes >= 3);
    assert.equal(typeof body.brokenLinks, 'number');
});

test('CLI trends exits 0 with human projection sections', () => {
    const result = cli(['trends'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Vault Trends/);
    assert.match(result.stdout, /Trend Lines/);
    assert.match(result.stdout, /Retrospective Accuracy/);
    assert.match(result.stdout, /Staleness Forecast/);
});

test('CLI trends --json has expected shape', () => {
    const result = cli(['trends', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.horizonDays, 90);
    assert.equal(typeof body.growth, 'object');
    assert.equal(typeof body.stale, 'object');
    assert.equal(typeof body.structure, 'object');
    assert.ok(Array.isArray(body.stale.upcoming));
});

test('CLI validate exits 0 on schema-free vault', () => {
    const result = cli(['validate'], vaultPath);
    assert.equal(result.status, 0);
});

test('CLI query human output exits 0 and contains results', () => {
    const result = cli(['query', 'where type = contact sort name'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /carl-jenkins/);
    assert.match(result.stdout, /johnny-rico/);
});

test('CLI query --json has expected shape', () => {
    const result = cli(['query', 'where type = contact sort name', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.count, 2);
    assert.ok(Array.isArray(body.rows));
    assert.equal(body.rows.length, 2);
    body.rows.forEach((row) => {
        assert.equal(typeof row.id, 'string');
        assert.equal(typeof row.fields, 'object');
    });
});

test('CLI query with zero results exits 0', () => {
    const result = cli(['query', 'where type = nonexistent'], vaultPath);
    assert.equal(result.status, 0);
});

test('CLI query missing input --json returns contract error shape', () => {
    const result = cli(['query', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'USAGE');
});

test('CLI report <id> exits 0', () => {
    const result = cli(['report', 'johnny-rico'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /johnny-rico/);
});

test('CLI report with unknown id exits 1', () => {
    const result = cli(['report', 'this-id-does-not-exist'], vaultPath);
    assert.equal(result.status, 1);
});

test('CLI report missing id --json returns contract error shape', () => {
    const result = cli(['report', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'USAGE');
});

test('CLI report --json has expected shape', () => {
    const result = cli(['report', 'johnny-rico', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.id, 'johnny-rico');
    assert.equal(body.type, 'contact');
});

test('CLI report --at reconstructs a reduced historical report (no lifecycle/drift/inbound)', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: contact\nstatus: active\nunit: "[[roughnecks]]"\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\n---\n'
    });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        cli(['set', 'johnny-rico', 'status', 'deployed'], vault.dir);

        const result = cli(['report', 'johnny-rico', '--at', since, '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.id, 'johnny-rico');
        assert.equal(body.fields.status, 'active');
        assert.ok(Array.isArray(body.outbound));
        assert.ok(body.outbound.some((edge) => edge.to === 'roughnecks'));
        assert.equal('lifecycle' in body, false);
        assert.equal('inbound' in body, false);
    } finally {
        vault.destroy();
    }
});

test('CLI report --at with an invalid date exits 1 with INVALID_PARAM', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\n---\n' });
    try {
        const result = cli(['report', 'johnny-rico', '--at', 'garbage', '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.code, 'INVALID_PARAM');
    } finally {
        vault.destroy();
    }
});

test('CLI links <id> exits 0', () => {
    const result = cli(['links', 'johnny-rico'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /roughnecks/);
});

test('CLI links --json has expected shape', () => {
    const result = cli(['links', 'johnny-rico', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.outbound));
    assert.ok(body.outbound.some((entry) => entry.to === 'roughnecks'));
    assert.ok(Array.isArray(body.inbound));
});

test('CLI links --at returns outbound-only historical links', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: contact\nunit: "[[roughnecks]]"\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\n---\n'
    });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        cli(['set', 'johnny-rico', 'status', 'deployed'], vault.dir);

        const result = cli(['links', 'johnny-rico', '--at', since, '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.id, 'johnny-rico');
        assert.ok(Array.isArray(body.outbound));
        assert.ok(body.outbound.some((edge) => edge.to === 'roughnecks'));
        assert.equal('inbound' in body, false);
    } finally {
        vault.destroy();
    }
});

test('CLI create exits 0 and writes file to disk', () => {
    const filePath = path.join(vaultPath, 'test-trooper.md');
    const result = cli(['create', 'contact', '--field', 'name=Test Trooper'], vaultPath);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(filePath), true);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.match(content, /id: test-trooper/);
    assert.match(content, /type: contact/);
    fs.unlinkSync(filePath);
});

test('CLI create exits 1 if file already exists', () => {
    const result = cli(['create', 'contact', '--field', 'name=Johnny Rico'], vaultPath);
    assert.equal(result.status, 1);
});

test('CLI create --json returns contract error shape on conflict', () => {
    const result = cli(['create', 'contact', '--field', 'name=Johnny Rico', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'CONFLICT');
});

test('CLI create --dry-run previews creation without writing the file', () => {
    const filePath = path.join(vaultPath, 'dry-run-trooper.md');
    const result = cli(['create', 'contact', '--field', 'name=Dry Run Trooper', '--dry-run'], vaultPath);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(filePath), false);
    assert.match(result.stdout, /Would create/i);
});

test('CLI export --format json exits 0 and stdout is a JSON array', () => {
    const result = cli(['export', '--format', 'json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 3);
    body.forEach((entry) => {
        assert.equal(typeof entry.id, 'string');
    });
});

test('CLI export --format csv exits 0 and stdout is valid CSV', () => {
    const result = cli(['export', '--format', 'csv'], vaultPath);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.match(lines[0] || '', /id/);
    assert.match(result.stdout, /johnny-rico/);
});

test('CLI export --query filters results', () => {
    const result = cli(['export', '--format', 'json', '--query', 'where type = unit'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].id, 'roughnecks');
});

test('CLI export --format html renders one note as standalone HTML with resolved links, view snapshots, and callouts', () => {
    const vault = createVault({
        'mission.md': [
            '---',
            'id: mission-klendathu',
            'type: mission',
            'title: Mission Klendathu',
            'status: published',
            '---',
            '',
            '# Briefing',
            '',
            'Assigned to [[johnny-rico|Rico]] with an unresolved [[missing-contact|Ghost]].',
            '',
            '> [!note] Field note',
            '> Keep this short.',
            '',
            '!view character',
            'select id, name'
        ].join('\n'),
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['export', '--id', 'mission-klendathu', '--format', 'html'], vault.dir);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<!DOCTYPE html>/);
        assert.match(result.stdout, /<title>Mission Klendathu<\/title>/);
        assert.match(result.stdout, /<a href="\/johnny-rico">Rico<\/a>/);
        assert.match(result.stdout, /Ghost/);
        assert.doesNotMatch(result.stdout, /\[\[missing-contact\|Ghost\]\]/);
        assert.match(result.stdout, /<table>/);
        assert.match(result.stdout, /Johnny Rico/);
        assert.doesNotMatch(result.stdout, /!view character/);
        assert.match(result.stdout, /yamlink-callout-note/);
    } finally {
        vault.destroy();
    }
});

test('CLI export --format html requires --id', () => {
    const result = cli(['export', '--format', 'html', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.code, 'USAGE');
    assert.match(body.error, /requires --id/);
});

test('CLI export --format html returns NOT_FOUND for an unknown id', () => {
    const result = cli(['export', '--format', 'html', '--id', 'not-real', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.details.id, 'not-real');
});

test('CLI export --format html --output writes a real file', () => {
    const outPath = path.join(os.tmpdir(), `yamlink-export-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
    try {
        const result = cli(['export', '--format', 'html', '--id', 'johnny-rico', '--output', outPath], vaultPath);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(outPath), true);
        const html = fs.readFileSync(outPath, 'utf8');
        assert.match(html, /<!DOCTYPE html>/);
        assert.match(html, /Johnny Rico/);
    } finally {
        fs.rmSync(outPath, { force: true });
    }
});

test('CLI completions bash exits 0 and prints a script', () => {
    const result = cli(['completions', 'bash']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.length > 100);
    assert.match(result.stdout, /yamlink/);
});

test('CLI completions zsh exits 0 and prints a script', () => {
    const result = cli(['completions', 'zsh']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.length > 100);
    assert.match(result.stdout, /yamlink/);
});

test('CLI completions with unknown shell exits 1', () => {
    const result = cli(['completions', 'fish']);
    assert.equal(result.status, 1);
});

test('CLI completions --json returns machine-readable script payload', () => {
    const result = cli(['completions', 'bash', '--json']);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.shell, 'bash');
    assert.match(body.script, /complete -F _yamlink yamlink/);
});

test('CLI completions invalid shell --json returns contract error shape', () => {
    const result = cli(['completions', 'fish', '--json']);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'USAGE');
});

test('CLI rename updates the id line in the target file', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const result = cli(['rename', 'johnny-rico', 'juan-rico'], vault.dir);
        assert.equal(result.status, 0);
        const rico = fs.readFileSync(path.join(vault.dir, 'rico.md'), 'utf8');
        assert.match(rico, /id: juan-rico/);
    } finally {
        vault.destroy();
    }
});

test('CLI on invalid event --json returns contract error shape', () => {
    const result = cli(['on', 'bogus-event', '--json', '--', 'echo hi'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'USAGE');
});

test('CLI rename rewrites wikilink references in other files', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n',
        'unit.md': 'Supporting note for [[johnny-rico|Johnny Rico]].\n'
    });
    try {
        const result = cli(['rename', 'johnny-rico', 'juan-rico'], vault.dir);
        assert.equal(result.status, 0);
        const mission = fs.readFileSync(path.join(vault.dir, 'mission.md'), 'utf8');
        const unit = fs.readFileSync(path.join(vault.dir, 'unit.md'), 'utf8');
        assert.match(mission, /\[\[juan-rico\]\]/);
        assert.match(unit, /\[\[juan-rico\|Johnny Rico\]\]/);
    } finally {
        vault.destroy();
    }
});

test('CLI rename exits 1 when the old id does not exist', () => {
    const result = cli(['rename', 'ghost-id', 'new-id'], vaultPath);
    assert.equal(result.status, 1);
});

test('CLI rename --json returns contract error shape when the old id is missing', () => {
    const result = cli(['rename', 'ghost-id', 'new-id', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'NOT_FOUND');
});

test('CLI rename --dry-run makes no file changes but prints a summary', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const before = fs.readFileSync(path.join(vault.dir, 'rico.md'), 'utf8');
        const result = cli(['rename', 'johnny-rico', 'juan-rico', '--dry-run'], vault.dir);
        assert.equal(result.status, 0);
        const after = fs.readFileSync(path.join(vault.dir, 'rico.md'), 'utf8');
        assert.equal(after, before);
        assert.match(result.stdout, /Dry run/i);
    } finally {
        vault.destroy();
    }
});

test('CLI rename --json outputs the expected payload', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const result = cli(['rename', 'johnny-rico', 'juan-rico', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.equal(body.oldId, 'johnny-rico');
        assert.equal(body.newId, 'juan-rico');
        assert.ok(Array.isArray(body.filesUpdated));
        assert.equal(body.filesUpdated.length, 2);
    } finally {
        vault.destroy();
    }
});

test('CLI schema list prints a table when schemas exist', () => {
    const vault = createVault({
        'schema-character.md': [
            '---',
            'id: schema-character',
            'type: schema',
            'target: character',
            'fields:',
            '  name:',
            '    type: string',
            '    required: true',
            '  unit:',
            '    type: relation',
            '    target: unit',
            '---'
        ].join('\n'),
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\nunit: "[[roughnecks]]"\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n'
    });
    try {
        const result = cli(['schema', 'list'], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /character/);
        assert.match(result.stdout, /required fields/i);
    } finally {
        vault.destroy();
    }
});

test('CLI schema list prints advisory when no schemas are defined', () => {
    const result = cli(['schema', 'list'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No schemas defined/i);
});

test('CLI schema list --json outputs type, fields, and note count', () => {
    const vault = createVault({
        'schema-contact.md': [
            '---',
            'id: schema-contact',
            'type: schema',
            'target: contact',
            'fields:',
            '  name:',
            '    type: string',
            '    required: true',
            '  status:',
            '    type: string',
            '---'
        ].join('\n'),
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nstatus: active\n---\n'
    });
    try {
        const result = cli(['schema', 'list', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.schemas));
        assert.equal(body.schemas[0].type, 'contact');
        assert.deepEqual(body.schemas[0].requiredFields, ['name']);
        assert.equal(body.schemas[0].noteCount, 1);
    } finally {
        vault.destroy();
    }
});

test('CLI schema check exits 0 for a conformant vault', () => {
    const vault = createVault({
        'schema-contact.md': [
            '---',
            'id: schema-contact',
            'type: schema',
            'target: contact',
            'fields:',
            '  name:',
            '    type: string',
            '    required: true',
            '---'
        ].join('\n'),
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['schema', 'check', 'contact'], vault.dir);
        assert.equal(result.status, 0);
    } finally {
        vault.destroy();
    }
});

test('CLI schema check exits 1 for non-conformant notes and lists missing fields', () => {
    const vault = createVault({
        'schema-contact.md': [
            '---',
            'id: schema-contact',
            'type: schema',
            'target: contact',
            'fields:',
            '  name:',
            '    type: string',
            '    required: true',
            '  owner:',
            '    type: relation',
            '    required: true',
            '    target: character',
            '---'
        ].join('\n'),
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['schema', 'check', 'contact'], vault.dir);
        assert.equal(result.status, 1);
        assert.match(result.stdout, /missing/i);
        assert.match(result.stdout, /owner/);
    } finally {
        vault.destroy();
    }
});

test('CLI schema check exits 0 with advisory when no schema exists for that type', () => {
    const result = cli(['schema', 'check', 'unit'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No schema exists/i);
});

test('CLI graph outputs nodes and edges as JSON', () => {
    const result = cli(['graph'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.nodes));
    assert.ok(Array.isArray(body.edges));
    assert.equal(typeof body.stats.nodes, 'number');
});

test('CLI graph nodes include id, type, label, inbound, and outbound', () => {
    const result = cli(['graph'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    const rico = body.nodes.find((node) => node.id === 'johnny-rico');
    assert.equal(typeof rico.id, 'string');
    assert.equal(typeof rico.type, 'string');
    assert.equal(typeof rico.label, 'string');
    assert.equal(typeof rico.inbound, 'number');
    assert.equal(typeof rico.outbound, 'number');
});

test('CLI graph --only-types filters output to specified types', () => {
    const result = cli(['graph', '--only-types', 'unit'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.ok(body.nodes.length >= 1);
    assert.ok(body.nodes.every((node) => node.type === 'unit'));
    assert.ok(body.edges.every((edge) => body.nodes.some((node) => node.id === edge.source) && body.nodes.some((node) => node.id === edge.target)));
});

test('CLI graph --at reconstructs a historical graph', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: contact\nunit: "[[roughnecks]]"\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\n---\n'
    });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        const createResult = cli(['create', 'contact', '--field', 'name=New Trooper'], vault.dir);
        assert.equal(createResult.status, 0);

        const result = cli(['graph', '--at', since], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.at, since);
        assert.ok(Array.isArray(body.nodes));
        assert.ok(Array.isArray(body.edges));
        assert.equal(typeof body.stats.incomplete, 'number');
        assert.ok(body.edges.some((edge) => edge.from === 'johnny-rico' && edge.to === 'roughnecks'));
    } finally {
        vault.destroy();
    }
});

test('CLI graph --at with an invalid date exits 1 with INVALID_PARAM', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\n---\n' });
    try {
        const result = cli(['graph', '--at', 'not-a-real-date'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.code, 'INVALID_PARAM');
    } finally {
        vault.destroy();
    }
});

test('CLI init scaffolds the correct files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-init-'));
    const target = path.join(dir, 'vault');
    try {
        const result = cli(['init', target]);
        assert.equal(result.status, 0);
        assert.equal(fs.existsSync(path.join(target, '.yamlink')), true);
        assert.equal(fs.existsSync(path.join(target, '_templates')), true);
        assert.equal(fs.existsSync(path.join(target, 'welcome.md')), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI init exits 1 on re-init', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-init-'));
    try {
        assert.equal(cli(['init', dir]).status, 0);
        const result = cli(['init', dir]);
        assert.equal(result.status, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI init --json returns expected shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-init-'));
    try {
        const result = cli(['init', dir, '--json']);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.created));
        assert.ok(body.created.includes('welcome.md'));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI init --dry-run previews scaffolding without creating files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-init-'));
    const target = path.join(dir, 'preview-vault');
    try {
        const result = cli(['init', target, '--dry-run', '--json']);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.equal(body.dryRun, true);
        assert.equal(fs.existsSync(path.join(target, '.yamlink')), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI search finds matches by ID and returns empty cleanly', () => {
    const found = cli(['search', 'rico'], vaultPath);
    assert.equal(found.status, 0);
    assert.match(found.stdout, /johnny-rico/);

    const empty = cli(['search', 'zzzzzzz'], vaultPath);
    assert.equal(empty.status, 0);
    assert.match(empty.stdout, /\(no results\)/);
});

test('CLI search --json returns wrapped success payload', () => {
    const result = cli(['search', 'rico', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(typeof body.query, 'string');
    assert.equal(typeof body.count, 'number');
    assert.ok(Array.isArray(body.results));
});

test('CLI search finds matches by field', () => {
    const result = cli(['search', 'Johnny', '--field', 'name'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /johnny-rico/);
});

test('CLI search --type filter works', () => {
    const result = cli(['search', 'rough', '--type', 'unit'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /roughnecks/);
    assert.doesNotMatch(result.stdout, /johnny-rico/);
});

test('CLI search --json shape is correct', () => {
    const result = cli(['search', 'Johnny Rico', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results[0].id, 'johnny-rico');
    assert.equal(body.results[0].matchedField, 'name');
});

test('CLI search with empty query exits 1', () => {
    const result = cli(['search', ''], vaultPath);
    assert.equal(result.status, 1);
});

test('CLI rename --rename-file renames the markdown file', () => {
    const vault = createVault({
        'johnny-rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const result = cli(['rename', 'johnny-rico', 'juan-rico', '--rename-file'], vault.dir);
        assert.equal(result.status, 0);
        assert.equal(fs.existsSync(path.join(vault.dir, 'johnny-rico.md')), false);
        assert.equal(fs.existsSync(path.join(vault.dir, 'juan-rico.md')), true);
    } finally {
        vault.destroy();
    }
});

test('CLI rename --rename-file warns and skips when filename does not match id', () => {
    const vault = createVault({
        'rico-note.md': '---\nid: johnny-rico\ntype: character\n---\n'
    });
    try {
        const result = cli(['rename', 'johnny-rico', 'juan-rico', '--rename-file'], vault.dir);
        assert.equal(result.status, 0);
        assert.equal(fs.existsSync(path.join(vault.dir, 'rico-note.md')), true);
        assert.match(result.stdout, /Skipped file rename/i);
    } finally {
        vault.destroy();
    }
});

test('CLI validate exits with correct code for broken links only', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ym-cli-validate-'));
    try {
        fs.writeFileSync(path.join(tmpDir, 'ghost.md'), '---\nid: ghost\ntype: contact\nunit: "[[nonexistent-unit]]"\n---\n', 'utf8');
        const result = cli(['validate', '--check', 'broken-links'], tmpDir);
        assert.equal(result.status, 1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('CLI validate exits with correct code for schema violations only', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n    required: true\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['validate', '--check', 'schema'], vault.dir);
        assert.equal(result.status, 1);
    } finally {
        vault.destroy();
    }
});

test('CLI validate --check broken-links skips schema check', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n    required: true\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['validate', '--check', 'broken-links'], vault.dir);
        assert.equal(result.status, 0);
    } finally {
        vault.destroy();
    }
});

test('CLI validate --json shape is correct', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n    required: true\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nfriend: "[[missing-id]]"\n---\n'
    });
    try {
        const result = cli(['validate', '--json'], vault.dir);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, false);
        assert.ok(Array.isArray(body.brokenLinks));
        assert.ok(Array.isArray(body.schemaViolations));
        assert.ok(Array.isArray(body.duplicateIds));
    } finally {
        vault.destroy();
    }
});

test('CLI validate threshold flags fail when quality gates are breached', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n    required: true\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nfriend: "[[missing-id]]"\n---\n'
    });
    try {
        const result = cli([
            'validate',
            '--max-broken-links', '0',
            '--schema-coverage', '100',
            '--min-health-score', '100',
            '--json'
        ], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, false);
        assert.ok(Array.isArray(body.thresholds));
        assert.ok(body.thresholds.some((entry) => entry.check === 'max-broken-links' && entry.passed === false));
        assert.ok(body.thresholds.some((entry) => entry.check === 'schema-coverage' && entry.passed === false));
    } finally {
        vault.destroy();
    }
});

test('CLI validate threshold flags pass on a healthy vault', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n    required: true\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nstatus: active\nunit: "[[roughnecks]]"\n---\n'
    });
    try {
        const result = cli([
            'validate',
            '--schema-coverage', '100',
            '--no-orphans',
            '--max-broken-links', '0',
            '--json'
        ], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.ok(body.thresholds.every((entry) => entry.passed === true));
    } finally {
        vault.destroy();
    }
});

test('CLI schema check --all covers multiple types', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n---\n',
        'schema-unit.md': '---\nid: schema-unit\ntype: schema\ntarget: unit\nfields:\n  name:\n    type: string\n    required: true\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n'
    });
    try {
        const result = cli(['schema', 'check', '--all'], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /contact/);
        assert.match(result.stdout, /unit/);
    } finally {
        vault.destroy();
    }
});

test('CLI schema check --all --json shape is correct', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['schema', 'check', '--all', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.results));
        assert.equal(body.results[0].type, 'contact');
        assert.ok(Array.isArray(body.results[0].violations));
    } finally {
        vault.destroy();
    }
});

test('--output writes query output to file', () => {
    const outFile = path.join(os.tmpdir(), `yamlink-query-${Date.now()}.json`);
    try {
        const result = cli(['query', 'where type = contact', '--json', '--output', outFile], vaultPath);
        assert.equal(result.status, 0);
        const body = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        assert.equal(body.ok, true);
        assert.equal(body.count, 2);
    } finally {
        try { fs.unlinkSync(outFile); } catch (_) {}
    }
});

test('CLI --output writes file-backed results for briefing, query, health, report, links, graph, and export', () => {
    const scenarios = [
        { name: 'briefing', args: ['briefing'] },
        { name: 'query', args: ['query', 'where type = contact'] },
        { name: 'health', args: ['health'] },
        { name: 'report', args: ['report', 'johnny-rico'] },
        { name: 'links', args: ['links', 'johnny-rico'] },
        { name: 'graph', args: ['graph'] },
        { name: 'export', args: ['export', '--format', 'csv'] }
    ];

    for (const scenario of scenarios) {
        const safeName = scenario.name.replace(/\s+/g, '-');
        const outFile = path.join(os.tmpdir(), `yamlink-${safeName}-${Date.now()}-${Math.random().toString(16).slice(2)}.out`);
        try {
            const result = cli([...scenario.args, '--quiet', '--output', outFile], vaultPath);
            assert.equal(result.status, 0, `${scenario.name} exits 0`);
            assert.equal(result.stdout, '', `${scenario.name} writes nothing to stdout`);
            assert.ok(fs.existsSync(outFile), `${scenario.name} creates output file`);
            assert.ok(fs.readFileSync(outFile, 'utf8').trim().length > 0, `${scenario.name} output file is non-empty`);
        } finally {
            try { fs.unlinkSync(outFile); } catch (_) {}
        }
    }
});

test('CLI --output writes file-backed results for schema list and schema check', () => {
    const outputVault = createVault({
        ...FIXTURE,
        'schema-contact.md': [
            '---', 'id: schema-contact', 'type: schema', 'target: contact',
            'fields:',
            '  name:',
            '    type: string',
            '    required: true',
            '---'
        ].join('\n')
    });
    const scenarios = [
        { name: 'schema list', args: ['schema', 'list'] },
        { name: 'schema check', args: ['schema', 'check', 'contact'] }
    ];

    try {
        for (const scenario of scenarios) {
            const safeName = scenario.name.replace(/\s+/g, '-');
            const outFile = path.join(os.tmpdir(), `yamlink-${safeName}-${Date.now()}-${Math.random().toString(16).slice(2)}.out`);
            try {
                const result = cli([...scenario.args, '--quiet', '--output', outFile], outputVault.dir);
                assert.equal(result.status, 0, `${scenario.name} exits 0`);
                assert.equal(result.stdout, '', `${scenario.name} writes nothing to stdout`);
                assert.ok(fs.existsSync(outFile), `${scenario.name} creates output file`);
                assert.ok(fs.readFileSync(outFile, 'utf8').trim().length > 0, `${scenario.name} output file is non-empty`);
            } finally {
                try { fs.unlinkSync(outFile); } catch (_) {}
            }
        }
    } finally {
        outputVault.destroy();
    }
});

test('CLI --output writes file-backed results for the documented command set', () => {
    const scenarios = [
        { name: 'briefing', args: ['briefing'] },
        { name: 'query', args: ['query', 'where type = contact'] },
        { name: 'health', args: ['health'] },
        { name: 'report', args: ['report', 'johnny-rico'] },
        { name: 'links', args: ['links', 'johnny-rico'] },
        { name: 'graph', args: ['graph'] },
        { name: 'export md', args: ['export', 'johnny-rico', '--format', 'md'] },
        { name: 'schema list', args: ['schema', 'list'] },
        { name: 'schema check', args: ['schema', 'check', 'unit'] },
        { name: 'story', args: ['story', '--since', new Date(Date.now() - 1000).toISOString()] }
    ];

    for (const scenario of scenarios) {
        const outFile = path.join(os.tmpdir(), `yamlink-output-contract-${scenario.name.replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}.out`);
        try {
            const result = cli([...scenario.args, '--quiet', '--output', outFile], vaultPath);
            assert.equal(result.status, 0, `${scenario.name} exits 0`);
            assert.equal(result.stdout.trim(), '', `${scenario.name} keeps stdout empty when writing to file`);
            assert.equal(fs.existsSync(outFile), true, `${scenario.name} creates the output file`);
            assert.ok(fs.readFileSync(outFile, 'utf8').trim().length > 0, `${scenario.name} writes non-empty output`);
        } finally {
            try { fs.unlinkSync(outFile); } catch (_) {}
        }
    }
});

test('CLI status exits 0 and human output has expected lines', () => {
    const result = cli(['status'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Notes/);
    assert.match(result.stdout, /Broken links/);
    assert.match(result.stdout, /Generation/);
});

test('CLI status --json shape is correct', () => {
    const result = cli(['status', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(typeof body.notes, 'number');
    assert.equal(typeof body.types, 'number');
    assert.equal(typeof body.edges, 'number');
    assert.equal(typeof body.brokenLinks, 'number');
    assert.equal(typeof body.generation, 'number');
});

test('CLI mutations exits 0', () => {
    const result = cli(['mutations'], vaultPath);
    assert.equal(result.status, 0);
});

test('CLI mutations --json has { ok, count, events }', () => {
    const result = cli(['mutations', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(typeof body.count, 'number');
    assert.ok(Array.isArray(body.events));
});

test('CLI mutations captures note_created events written by create', () => {
    const vault = createVault({
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n'
    });
    try {
        const createResult = cli(['create', 'contact', '--field', 'name=Dizzy Flores'], vault.dir);
        assert.equal(createResult.status, 0);

        const result = cli(['mutations', '--type', 'note_created', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        const createdEvent = body.events.find((event) =>
            event.type === 'note_created' &&
            event.noteId === 'dizzy-flores' &&
            event.source === 'cli' &&
            event.cause === 'cli_create_note'
        );
        assert.ok(createdEvent);
        assert.ok(typeof createdEvent.sessionId === 'string' && createdEvent.sessionId.startsWith('cli-'),
            `expected sessionId to start with "cli-", got: ${createdEvent.sessionId}`);
    } finally {
        vault.destroy();
    }
});

test('CLI mutations captures relation_changed events written by rename', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const renameResult = cli(['rename', 'johnny-rico', 'juan-rico'], vault.dir);
        assert.equal(renameResult.status, 0);

        const result = cli(['mutations', '--type', 'relation_changed', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        const renamedEvent = body.events.find((event) =>
            event.type === 'relation_changed' &&
            event.noteId === 'mission' &&
            event.source === 'cli' &&
            event.cause === 'cli_rename_note'
        );
        assert.ok(renamedEvent);
        assert.ok(typeof renamedEvent.sessionId === 'string' && renamedEvent.sessionId.startsWith('cli-'),
            `expected sessionId to start with "cli-", got: ${renamedEvent.sessionId}`);
    } finally {
        vault.destroy();
    }
});

test('CLI doctor --json returns the expected healthy shape', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n---\n',
        'schema-unit.md': '---\nid: schema-unit\ntype: schema\ntarget: unit\nfields:\n  name:\n    type: string\n    required: true\n---\n',
        'johnny-rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nstatus: active\nunit: "[[roughnecks]]"\n---\n',
        'carl-jenkins.md': '---\nid: carl-jenkins\ntype: contact\nname: Carl Jenkins\nstatus: active\nunit: "[[roughnecks]]"\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n'
    });
    try {
        const result = cli(['doctor', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.healthy, true);
        assert.equal(typeof body.brokenLinks.count, 'number');
        assert.ok(Array.isArray(body.duplicateIds));
        assert.ok(Array.isArray(body.orphans));
        assert.ok(Array.isArray(body.schemaViolations));
        assert.equal(typeof body.staleNotes.count, 'number');
        assert.ok(Array.isArray(body.arcGaps));
    } finally {
        vault.destroy();
    }
});

test('CLI doctor exits 1 and reports issues for an unhealthy vault', () => {
    const vault = createVault({
        'schema-contact.md': '---\nid: schema-contact\ntype: schema\ntarget: contact\nfields:\n  name:\n    type: string\n    required: true\n  status:\n    type: string\n    required: true\n  unit:\n    type: relation\n    target: unit\n---\n',
        'johnny-rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nstatus: active\nunit: "[[roughnecks]]"\n---\n',
        'carl-jenkins.md': '---\nid: carl-jenkins\ntype: contact\nname: Carl Jenkins\n---\n',
        'ghost.md': '---\nid: ghost-contact\ntype: contact\nname: Ghost Contact\nstatus: inactive\nunit: "[[missing-unit]]"\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n',
        'orphan.md': '---\nid: orphan-note\ntype: contact\nname: Orphan Note\nstatus: inactive\n---\n',
        'duplicate-a.md': '---\nid: duplicate-note\ntype: contact\nname: Duplicate A\nstatus: inactive\n---\n',
        'duplicate-b.md': '---\nid: duplicate-note\ntype: contact\nname: Duplicate B\nstatus: inactive\n---\n'
    });
    try {
        const stalePath = path.join(vault.dir, 'orphan.md');
        fs.utimesSync(stalePath, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
        const result = cli(['doctor'], vault.dir);
        assert.equal(result.status, 1);
        assert.match(result.stdout, /Broken links/);
        assert.match(result.stdout, /Duplicate IDs/);
        assert.match(result.stdout, /Schema violations/);
        assert.match(result.stdout, /Stale notes/);
    } finally {
        vault.destroy();
    }
});

test('CLI doctor reports malformed frontmatter with the real file path, not just a console warning', () => {
    const vault = createVault({
        'good.md': '---\nid: good-note\ntype: contact\nname: Good Note\n---\n',
        // Unterminated quoted scalar — invalid YAML, frontmatter fails to parse.
        'bad.md': '---\nid: bad-note\ntype: contact\nsummary: "unterminated\n---\nBody.\n'
    });
    try {
        const result = cli(['doctor', '--json'], vault.dir);
        const body = parseJson(result.stdout);
        assert.equal(body.healthy, false);
        assert.equal(body.malformedFiles.length, 1);
        assert.ok(body.malformedFiles[0].file.endsWith('bad.md'));
        assert.ok(body.malformedFiles[0].message.length > 0);
    } finally {
        vault.destroy();
    }
});

test('CLI commands no longer leak raw build-time console.warn/error noise ahead of the actual report', () => {
    // Real bug: buildIndexQuietly only stubbed console.log, so duplicate-id
    // and malformed-frontmatter warnings (console.warn) still printed raw,
    // unstructured lines before every command's actual formatted output —
    // exactly the noise a user reported seeing ahead of a `yamlink health` run.
    const vault = createVault({
        'dup-a.md': '---\nid: dup-id\ntype: contact\nname: A\n---\n',
        'dup-b.md': '---\nid: dup-id\ntype: contact\nname: B\n---\n',
        'bad.md': '---\nid: bad-note\ntype: contact\nsummary: "unterminated\n---\n'
    });
    try {
        const result = cli(['health'], vault.dir);
        assert.ok(!/Yamlink — Duplicate id/.test(result.stdout + result.stderr), 'no raw duplicate-id warning leaks into output');
        assert.ok(!/Yamlink — Malformed frontmatter/.test(result.stdout + result.stderr), 'no raw malformed-frontmatter warning leaks into output');
        assert.ok(!/Yamlink — Index built/.test(result.stdout + result.stderr), 'no raw index-build summary leaks into output');
        assert.match(result.stdout, /Vault Health/);
    } finally {
        vault.destroy();
    }
});

test('CLI diff shows differences between two notes', () => {
    const result = cli(['diff', 'johnny-rico', 'carl-jenkins'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Only in johnny-rico/);
    assert.match(result.stdout, /status/);
});

test('CLI diff --json returns stable machine shape', () => {
    const result = cli(['diff', 'johnny-rico', 'carl-jenkins', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.id1, 'johnny-rico');
    assert.equal(body.id2, 'carl-jenkins');
    assert.equal(typeof body.onlyIn1, 'object');
    assert.equal(typeof body.onlyIn2, 'object');
    assert.ok(Array.isArray(body.changed));
});

test('CLI diff --since shows changed notes from mutation history', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        const renameResult = cli(['rename', 'johnny-rico', 'juan-rico'], vault.dir);
        assert.equal(renameResult.status, 0);

        const result = cli(['diff', '--since', since], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Diff since/);
        assert.match(result.stdout, /mission/);
    } finally {
        vault.destroy();
    }
});

test('CLI diff --since --json returns time-diff contract shape', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\n---\n',
        'mission.md': 'Commander [[johnny-rico]] led the assault.\n'
    });
    try {
        const since = new Date(Date.now() - 1000).toISOString();
        const renameResult = cli(['rename', 'johnny-rico', 'juan-rico'], vault.dir);
        assert.equal(renameResult.status, 0);

        const result = cli(['diff', '--since', since, '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.since, since);
        assert.equal(typeof body.count, 'number');
        assert.ok(Array.isArray(body.changes));
        assert.ok(body.changes.some((entry) => entry.id === 'mission'));
    } finally {
        vault.destroy();
    }
});

test('CLI story --since with no date exits 1', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const result = cli(['story'], vault.dir);
        assert.equal(result.status, 1);
    } finally {
        vault.destroy();
    }
});

test('CLI snapshot creates a real loadable vault snapshot', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: unit\nname: Roughnecks\n---\n'
    });
    try {
        const result = cli(['snapshot', '--reason', 'test capture', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.equal(body.noteCount, 2);
        assert.equal(body.reason, 'test capture');

        const log = require('../src/runtime/mutationEventLog');
        log.initMutationLog(path.join(vault.dir, '.yamlink', 'mutation-log.ndjson'));
        const snapshots = log.getVaultSnapshots();
        assert.ok(snapshots.some((snapshot) =>
            snapshot.timestamp === body.timestamp &&
            snapshot.notes['johnny-rico'] &&
            snapshot.notes.roughnecks
        ));
    } finally {
        vault.destroy();
    }
});

test('CLI restore without --output does not export markdown files', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n'
    });
    try {
        const before = fs.readdirSync(vault.dir).filter((name) => name !== '.yamlink').sort();
        const result = cli(['restore', new Date().toISOString()], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Writes\s+none/);
        const after = fs.readdirSync(vault.dir).filter((name) => name !== '.yamlink').sort();
        assert.deepEqual(after, before);
    } finally {
        vault.destroy();
    }
});

test('CLI restore --output refuses the live vault root', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n'
    });
    try {
        const result = cli(['restore', new Date().toISOString(), '--output', vault.dir, '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, false);
        assert.equal(body.code, 'REFUSE_LIVE_VAULT');
    } finally {
        vault.destroy();
    }
});

test('CLI restore --output refuses a subdirectory of the live vault, not just the exact root', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n'
    });
    try {
        const nestedOutput = path.join(vault.dir, 'restore-export');
        const result = cli(['restore', new Date().toISOString(), '--output', nestedOutput, '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, false);
        assert.equal(body.code, 'REFUSE_LIVE_VAULT');
        assert.equal(fs.existsSync(nestedOutput), false, 'must not create the export directory before refusing');
    } finally {
        vault.destroy();
    }
});

test('CLI restore reports complete false when reconstruction cannot be proven exact', () => {
    const vault = createVault({
        'rico.md': '---\nid: johnny-rico\ntype: character\nname: Johnny Rico\n---\n'
    });
    try {
        const beforeChange = new Date(Date.now() - 1000).toISOString();
        const setResult = cli(['set', 'johnny-rico', 'rank', 'lieutenant'], vault.dir);
        assert.equal(setResult.status, 0);

        const result = cli(['restore', beforeChange, '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.equal(body.complete, false);
        assert.ok(body.incompleteCount >= 1);
        assert.ok(body.notes.some((note) => note.id === 'johnny-rico' && note.complete === false));
    } finally {
        vault.destroy();
    }
});

test('CLI story --since with an invalid date exits 1 with INVALID_PARAM', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const result = cli(['story', '--since', 'not-a-date', '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, false);
        assert.equal(body.code, 'INVALID_PARAM');
    } finally {
        vault.destroy();
    }
});

test('CLI story --since reports vault growth and activity since the timestamp', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const since = new Date(Date.now() - 1000).toISOString();

        const createResult = cli(['create', 'contact', '--field', 'name=New Trooper'], vault.dir);
        assert.equal(createResult.status, 0);

        const result = cli(['story', '--since', since], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Vault Story/);
        assert.match(result.stdout, /Notes created/);
    } finally {
        vault.destroy();
    }
});

test('CLI story --since --json returns a story contract shape', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const since = new Date(Date.now() - 1000).toISOString();

        const createResult = cli(['create', 'contact', '--field', 'name=New Trooper'], vault.dir);
        assert.equal(createResult.status, 0);

        const result = cli(['story', '--since', since, '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.since, since);
        assert.equal(typeof body.now, 'string');
        assert.equal(typeof body.then.notes, 'number');
        assert.equal(typeof body.current.notes, 'number');
        assert.ok(body.current.notes >= body.then.notes);
        assert.ok(Array.isArray(body.typeDeltas));
        assert.equal(typeof body.activity.notesCreated, 'number');
        assert.ok(body.activity.notesCreated >= 1);
        assert.ok(Array.isArray(body.busiestNotes));
    } finally {
        vault.destroy();
    }
});

test('CLI story --quarterly frames the report as a calendar-quarter review', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const result = cli(['story', '--quarterly'], vault.dir);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Vault Quarterly Review — Q\d 20\d\d/);
    } finally {
        vault.destroy();
    }
});

test('CLI story --quarterly --json includes a quarter label and a since date at the start of the current quarter', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const { getCurrentQuarterInfo } = require('../src/cli/commands/story');
        const expected = getCurrentQuarterInfo();

        const result = cli(['story', '--quarterly', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.quarter, expected.label);
        assert.equal(body.since, expected.sinceIso);
    } finally {
        vault.destroy();
    }
});

test('getCurrentQuarterInfo computes correct calendar-quarter boundaries in UTC', () => {
    const { getCurrentQuarterInfo } = require('../src/cli/commands/story');
    assert.deepEqual(getCurrentQuarterInfo(new Date('2026-02-15T12:00:00.000Z')), { sinceIso: '2026-01-01T00:00:00.000Z', label: 'Q1 2026' });
    assert.deepEqual(getCurrentQuarterInfo(new Date('2026-04-01T00:00:00.000Z')), { sinceIso: '2026-04-01T00:00:00.000Z', label: 'Q2 2026' });
    assert.deepEqual(getCurrentQuarterInfo(new Date('2026-09-30T23:59:59.000Z')), { sinceIso: '2026-07-01T00:00:00.000Z', label: 'Q3 2026' });
    assert.deepEqual(getCurrentQuarterInfo(new Date('2026-12-31T23:59:59.000Z')), { sinceIso: '2026-10-01T00:00:00.000Z', label: 'Q4 2026' });
});

test('CLI story --quarterly together with --since exits 1 as an ambiguous usage error', () => {
    const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: character\n---\n' });
    try {
        const result = cli(['story', '--quarterly', '--since', '2026-01-01', '--json'], vault.dir);
        assert.equal(result.status, 1);
        const body = parseJson(result.stdout);
        assert.equal(body.code, 'USAGE');
    } finally {
        vault.destroy();
    }
});

test('CLI diff with unknown id exits 1 --json has error shape', () => {
    const result = cli(['diff', 'johnny-rico', 'ghost-id', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'NOT_FOUND');
});

test('CLI serve --json emits startup contract payload', async () => {
    await new Promise((resolve, reject) => {
        const child = cliLive(['serve', '--json', '--port', '0'], vaultPath);
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill('SIGINT');
            reject(new Error('Timed out waiting for serve startup payload'));
        }, 4000);

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
            const trimmed = stdout.trim();
            if (!trimmed) return;
            clearTimeout(timeout);
            child.kill('SIGINT');
            try {
                const body = JSON.parse(trimmed);
                assert.equal(body.ok, true);
                assert.equal(body.command, 'serve');
                assert.equal(body.host, '127.0.0.1');
                assert.equal(typeof body.port, 'number');
                assert.equal(typeof body.pid, 'number');
                assert.equal(typeof body.endpoints, 'object');
                resolve();
            } catch (error) {
                reject(error);
            }
        });

        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (stdout.trim()) return;
            clearTimeout(timeout);
            reject(new Error(`serve exited before emitting startup payload: ${code}\n${stderr}`));
        });
    });
});

// ─── Intelligence commands ────────────────────────────────────────────────

test('CLI suggest <id> exits 0 with human output', () => {
    const result = cli(['suggest', 'johnny-rico'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout.toLowerCase(), /suggest/);
    assert.match(result.stdout, /johnny-rico/);
});

test('CLI suggest <id> --json returns expected shape', () => {
    const result = cli(['suggest', 'johnny-rico', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.id, 'johnny-rico');
    assert.ok(Array.isArray(body.missingFields));
    body.missingFields.forEach((f) => {
        assert.equal(typeof f.field, 'string');
        assert.ok(['high', 'medium', 'low'].includes(f.confidenceLabel), `confidenceLabel must be high/medium/low, got ${f.confidenceLabel}`);
        assert.equal(typeof f.score, 'number');
        assert.equal(typeof f.isRelation, 'boolean');
    });
});

test('CLI suggest with unknown id exits 1', () => {
    const result = cli(['suggest', 'ghost-note-xyz'], vaultPath);
    assert.equal(result.status, 1);
});

test('CLI suggest missing id --json returns contract error shape', () => {
    const result = cli(['suggest', '--json'], vaultPath);
    assert.equal(result.status, 1);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'USAGE');
});

test('CLI drift exits 0 with human output', () => {
    const result = cli(['drift'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout.toLowerCase(), /drift/);
});

test('CLI drift --json returns expected shape', () => {
    const result = cli(['drift', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(typeof body.total, 'number');
    assert.equal(typeof body.shown, 'number');
    assert.ok(Array.isArray(body.items));
});

test('CLI drift --type filter returns subset shape', () => {
    const result = cli(['drift', '--type', 'contact', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.typeFilter, 'contact');
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.every((n) => n.type === 'contact'));
});

test('CLI stale exits 0 with human output', () => {
    const result = cli(['stale'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout.toLowerCase(), /stale/);
});

test('CLI stale --json returns expected shape', () => {
    const result = cli(['stale', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(typeof body.total, 'number');
    assert.ok(Array.isArray(body.stale));
    body.stale.forEach((n) => {
        assert.equal(typeof n.id, 'string');
        assert.equal(typeof n.label, 'string');
    });
});

test('CLI orphans exits 0 with human output', () => {
    const result = cli(['orphans'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout.toLowerCase(), /orphan/);
});

test('CLI orphans --json returns expected shape', () => {
    const result = cli(['orphans', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(typeof body.total, 'number');
    assert.ok(Array.isArray(body.orphans));
});

test('CLI orphans detects notes with no links in either direction', () => {
    const vault = createVault({
        // linked-note has an outbound edge — not an orphan
        'linked.md': '---\nid: linked-note\ntype: contact\nunit: "[[target-note]]"\n---\n',
        // target-note has an inbound edge — not an orphan
        'target.md': '---\nid: target-note\ntype: unit\n---\n',
        // isolated-note has zero links in or out — this is the orphan
        'isolated.md': '---\nid: isolated-note\ntype: contact\n---\n',
    });
    try {
        const result = cli(['orphans', '--json'], vault.dir);
        assert.equal(result.status, 0);
        const body = parseJson(result.stdout);
        assert.equal(body.ok, true);
        assert.ok(body.orphans.some((n) => n.id === 'isolated-note'),
            'isolated-note has no links so it should be an orphan');
        assert.ok(!body.orphans.some((n) => n.id === 'linked-note'),
            'linked-note has an outbound edge so it is not an orphan');
        assert.ok(!body.orphans.some((n) => n.id === 'target-note'),
            'target-note has an inbound edge so it is not an orphan');
    } finally {
        vault.destroy();
    }
});

test('CLI pressure exits 0 with human output', () => {
    const result = cli(['pressure'], vaultPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout.toLowerCase(), /pressure/);
});

test('CLI pressure --json returns expected shape', () => {
    const result = cli(['pressure', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.loadBearingDrafts));
    assert.ok(Array.isArray(body.staleHubs));
    assert.ok(Array.isArray(body.orphans));
    assert.equal(typeof body.totals.loadBearingDrafts, 'number');
    assert.equal(typeof body.totals.staleHubs, 'number');
    assert.equal(typeof body.totals.orphans, 'number');
});

test('CLI env --shell bash emits export lines for Yamlink variables', () => {
    const result = cli(['env', '--shell', 'bash'], vaultPath);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.ok(lines.every((line) => line.startsWith('export YAMLINK_')));
    assert.ok(lines.some((line) => line.startsWith(`export YAMLINK_VAULT="${vaultPath}`)));
});

test('CLI env --shell fish emits set -x lines for Yamlink variables', () => {
    const result = cli(['env', '--shell', 'fish'], vaultPath);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.ok(lines.every((line) => line.startsWith('set -x YAMLINK_')));
});

test('CLI env --json returns vault, notes, broken, and health keys', () => {
    const result = cli(['env', '--json'], vaultPath);
    assert.equal(result.status, 0);
    const body = parseJson(result.stdout);
    assert.equal(body.vault, vaultPath);
    assert.equal(typeof body.notes, 'number');
    assert.equal(typeof body.broken, 'number');
    assert.equal(typeof body.health, 'number');
});

test('CLI watch --json emits startup contract payload', async () => {
    await new Promise((resolve, reject) => {
        const child = cliLive(['watch', '--json'], vaultPath);
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill('SIGINT');
            reject(new Error('Timed out waiting for watch startup payload'));
        }, 4000);

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
            const start = stdout.indexOf('{');
            const end = stdout.lastIndexOf('}');
            if (start === -1 || end === -1 || end <= start) return;
            try {
                clearTimeout(timeout);
                child.kill('SIGINT');
                const body = JSON.parse(stdout.slice(start, end + 1));
                assert.equal(body.ok, true);
                assert.equal(body.event, 'watch_started');
                assert.equal(typeof body.pid, 'number');
                assert.equal(typeof body.vaultPath, 'string');
                resolve();
            } catch (error) {
                reject(error);
            }
        });

        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (stdout.trim()) return;
            clearTimeout(timeout);
            reject(new Error(`watch exited before emitting startup payload: ${code}\n${stderr}`));
        });
    });
});

test('CLI watch --stream --json starts without crashing', async () => {
    await new Promise((resolve, reject) => {
        const child = cliLive(['watch', '--stream', '--json'], vaultPath);
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill('SIGINT');
            reject(new Error('Timed out waiting for watch stream startup payload'));
        }, 4000);

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
            const lines = stdout.split(/\r?\n/).filter(Boolean);
            if (!lines.length) return;
            try {
                const body = JSON.parse(lines[0]);
                assert.equal(body.ok, true);
                assert.equal(body.event, 'watch_started');
                clearTimeout(timeout);
                child.kill('SIGINT');
                resolve();
            } catch (_) {}
        });

        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (stdout.trim()) return;
            clearTimeout(timeout);
            reject(new Error(`watch stream exited before startup payload: ${code}\n${stderr}`));
        });
    });
});

test('CLI watch --stream --json emits NDJSON mutation events after a markdown change', async () => {
    await new Promise((resolve, reject) => {
        const child = cliLive(['watch', '--stream', '--json'], vaultPath);
        let stdout = '';
        let stderr = '';
        let started = false;
        const filePath = path.join(vaultPath, 'johnny-rico.md');
        const timeout = setTimeout(() => {
            child.kill('SIGINT');
            reject(new Error('Timed out waiting for streamed mutation event'));
        }, 5000);

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
            const lines = stdout.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                let body = null;
                try { body = JSON.parse(line); } catch (_) { continue; }
                if (!started && body.event === 'watch_started') {
                    started = true;
                    fs.writeFileSync(filePath, [
                        '---',
                        'id: johnny-rico',
                        'type: contact',
                        'name: Johnny Rico',
                        'unit: "[[roughnecks]]"',
                        'status: streamed',
                        '---',
                        '',
                        '- [ ] Submit mission report',
                        '- [x] File debrief paperwork'
                    ].join('\n'), 'utf8');
                    continue;
                }
                if (started && body.type) {
                    assert.equal(typeof body.type, 'string');
                    clearTimeout(timeout);
                    child.kill('SIGINT');
                    resolve();
                    return;
                }
            }
        });

        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (stdout.includes('"type"')) return;
            clearTimeout(timeout);
            reject(new Error(`watch stream exited before NDJSON event: ${code}\n${stderr}`));
        });
    });
});

// ─── startServer — programmatic server lifecycle ──────────────────────────────

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

describe('startServer — programmatic lifecycle', () => {
    test('starts listening and serves /api/types, close() shuts it down', async () => {
        const vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\nname: Johnny Rico\n---\n'
        });
        const { startServer } = require('../src/cli/commands/serve');
        const handle = await startServer({
            port: 0,  // OS assigns a free port
            vaultPath: vault.dir,
            workspaceFolders: [{ uri: { fsPath: vault.dir } }]
        });

        try {
            const { status, body } = await httpGet(`http://${handle.host}:${handle.port}/api/types`);
            assert.equal(status, 200);
            const parsed = JSON.parse(body);
            assert.ok(Array.isArray(parsed.types), 'response should have a types array');
        } finally {
            await handle.close();
            vault.destroy();
        }
    });

    test('close() stops the server — subsequent requests fail', async () => {
        const vault = createVault({
            'rico.md': '---\nid: rico\ntype: contact\n---\n'
        });
        const { startServer } = require('../src/cli/commands/serve');
        const handle = await startServer({
            port: 0,
            vaultPath: vault.dir,
            workspaceFolders: [{ uri: { fsPath: vault.dir } }]
        });
        const { port } = handle;
        await handle.close();
        vault.destroy();

        await assert.rejects(
            () => httpGet(`http://127.0.0.1:${port}/api/types`),
            'expected connection refused after close()'
        );
    });
});

describe('CLI template save', () => {
    test('saves a blank-skeleton template for the note\'s type, keyed off type not filename', () => {
        const vault = createVault({
            'enotria.md': [
                '---', 'id: enotria', 'type: account', 'name: Enotria',
                'contacts:',
                '  - [[theo-theodorou]]',
                '  - [[cesar-gutierrez]]',
                '---', '',
                '## Summary', 'Real prose that should not end up in the template.', ''
            ].join('\n')
        });
        try {
            const result = cli(['template', 'save', 'enotria', '--json'], vault.dir);
            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, true);
            assert.equal(body.type, 'account');

            const templatePath = path.join(vault.dir, '_templates', 'account.md');
            assert.ok(fs.existsSync(templatePath));
            const content = fs.readFileSync(templatePath, 'utf8');
            assert.match(content, /type: account/);
            assert.match(content, /id:\n/);
            assert.match(content, /contacts:\n  - \[\[\]\]/);
            assert.match(content, /## Summary/);
            assert.doesNotMatch(content, /Real prose/);
        } finally {
            vault.destroy();
        }
    });

    test('refuses to overwrite an existing template without --force', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
        });
        try {
            fs.mkdirSync(path.join(vault.dir, '_templates'), { recursive: true });
            fs.writeFileSync(path.join(vault.dir, '_templates', 'contact.md'), '---\nid:\ntype: contact\nhand-authored: true\n---\n', 'utf8');

            const result = cli(['template', 'save', 'johnny-rico', '--json'], vault.dir);
            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, false);
            assert.equal(body.code, 'CONFLICT');

            const untouched = fs.readFileSync(path.join(vault.dir, '_templates', 'contact.md'), 'utf8');
            assert.match(untouched, /hand-authored: true/);
        } finally {
            vault.destroy();
        }
    });

    test('overwrites an existing template when --force is passed', () => {
        const vault = createVault({
            'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\n---\n'
        });
        try {
            fs.mkdirSync(path.join(vault.dir, '_templates'), { recursive: true });
            fs.writeFileSync(path.join(vault.dir, '_templates', 'contact.md'), '---\nid:\ntype: contact\nold-field:\n---\n', 'utf8');

            const result = cli(['template', 'save', 'johnny-rico', '--force', '--json'], vault.dir);
            assert.equal(result.status, 0, result.stderr);

            const updated = fs.readFileSync(path.join(vault.dir, '_templates', 'contact.md'), 'utf8');
            assert.match(updated, /name: /);
            assert.doesNotMatch(updated, /old-field:/);
        } finally {
            vault.destroy();
        }
    });

    test('errors for an unknown note id', () => {
        const vault = createVault({ 'rico.md': '---\nid: johnny-rico\ntype: contact\n---\n' });
        try {
            const result = cli(['template', 'save', 'no-such-note', '--json'], vault.dir);
            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.code, 'NOT_FOUND');
        } finally {
            vault.destroy();
        }
    });

    test('errors for an untyped note', () => {
        const vault = createVault({ 'blank.md': '---\nid: blank-note\n---\n' });
        try {
            const result = cli(['template', 'save', 'blank-note', '--json'], vault.dir);
            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.code, 'USAGE');
        } finally {
            vault.destroy();
        }
    });
});

describe('CLI block-backlinks', () => {
    function createBlockBacklinkVault() {
        return createVault({
            'johnny-rico.md': [
                '---',
                'id: johnny-rico',
                'type: character',
                'name: Johnny Rico',
                '---',
                '',
                '# After Klendathu',
                '',
                '> Review recon logs',
            ].join('\n'),
            'carl-jenkins.md': [
                '---',
                'id: carl-jenkins',
                'type: dossier',
                'name: Carl Jenkins',
                'unit: "[[roughnecks]]"',
                '---',
                '',
                'See [[johnny-rico#After Klendathu]] for the section briefing.',
                'Follow [[johnny-rico^q1-1feuao]] for the exact recon quote.',
            ].join('\n'),
            'roughnecks.md': [
                '---',
                'id: roughnecks',
                'type: unit',
                'name: Roughnecks',
                '---',
            ].join('\n')
        });
    }

    test('returns section and block backlinks as JSON', () => {
        const vault = createBlockBacklinkVault();
        try {
            const result = cli(['block-backlinks', 'johnny-rico', '--json'], vault.dir);
            assert.equal(result.status, 0);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, true);
            assert.equal(body.noteId, 'johnny-rico');
            assert.equal(body.blockId, null);
            assert.equal(body.backlinks.length, 2);
            assert.deepEqual(body.backlinks.map((row) => row.targetBlockId), ['h-after-klendathu', 'q1-1feuao']);
            assert.ok(body.backlinks.some((row) => row.kind === 'section ref' && row.sourceId === 'carl-jenkins' && row.line === 8));
            assert.ok(body.backlinks.some((row) => row.kind === 'block ref' && row.sourceId === 'carl-jenkins' && row.line === 9));
        } finally {
            vault.destroy();
        }
    });

    test('--block filters to one exact block id', () => {
        const vault = createBlockBacklinkVault();
        try {
            const result = cli(['block-backlinks', 'johnny-rico', '--block', 'q1-1feuao', '--json'], vault.dir);
            assert.equal(result.status, 0);
            const body = parseJson(result.stdout);
            assert.equal(body.blockId, 'q1-1feuao');
            assert.equal(body.backlinks.length, 1);
            assert.equal(body.backlinks[0].targetLabel, 'Review recon logs');
        } finally {
            vault.destroy();
        }
    });

    test('human output groups by target block label and source note', () => {
        const vault = createBlockBacklinkVault();
        try {
            const result = cli(['block-backlinks', 'johnny-rico'], vault.dir);
            assert.equal(result.status, 0);
            assert.match(result.stdout, /After Klendathu \(heading\)/);
            assert.match(result.stdout, /Review recon logs \(quote\)/);
            assert.match(result.stdout, /Carl Jenkins \(dossier\), line 8/);
            assert.match(result.stdout, /Carl Jenkins \(dossier\), line 9/);
        } finally {
            vault.destroy();
        }
    });

    test('zero block backlinks succeeds with an empty JSON result', () => {
        const vault = createBlockBacklinkVault();
        try {
            const result = cli(['block-backlinks', 'roughnecks', '--json'], vault.dir);
            assert.equal(result.status, 0);
            const body = parseJson(result.stdout);
            assert.equal(body.noteId, 'roughnecks');
            assert.deepEqual(body.backlinks, []);
        } finally {
            vault.destroy();
        }
    });

    test('unknown note id returns NOT_FOUND', () => {
        const vault = createBlockBacklinkVault();
        try {
            const result = cli(['block-backlinks', 'missing-note', '--json'], vault.dir);
            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, false);
            assert.equal(body.code, 'NOT_FOUND');
            assert.equal(body.details.id, 'missing-note');
        } finally {
            vault.destroy();
        }
    });
});

describe('CLI glossary', () => {
    const GLOSSARY_FIXTURE = {
        'klendathu.md': '---\nid: klendathu\ntype: location\nname: Klendathu\n---\n\nHomeworld of the Arachnid species.\n',
        'roughnecks.md': '---\nid: roughnecks\ntype: faction\nname: Roughnecks\ndefinition: Rasczak\'s Roughnecks.\n---\n',
        'mobile-infantry.md': '---\nid: mobile-infantry\ntype: faction\nname: Mobile Infantry\n---\n',
        'rico.md': '---\nid: johnny-rico\ntype: contact\nname: Johnny Rico\nunit: "[[roughnecks]]"\nhomeworld: "[[klendathu]]"\n---\n'
    };

    test('errors when no --type is given', () => {
        const vault = createVault(GLOSSARY_FIXTURE);
        try {
            const result = cli(['glossary', '--json'], vault.dir);
            assert.equal(result.status, 1);
            const body = parseJson(result.stdout);
            assert.equal(body.code, 'USAGE');
        } finally {
            vault.destroy();
        }
    });

    test('builds an alphabetized glossary grouped by type with definitions and backlinks', () => {
        const vault = createVault(GLOSSARY_FIXTURE);
        try {
            const result = cli(['glossary', '--type', 'faction,location', '--json'], vault.dir);
            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.ok, true);
            assert.equal(body.entryCount, 3);

            const factionGroup = body.groups.find((g) => g.type === 'faction');
            assert.ok(factionGroup);
            const factionTerms = factionGroup.letters.flatMap((l) => l.entries.map((e) => e.term));
            assert.deepEqual(factionTerms, ['Mobile Infantry', 'Roughnecks']);

            const roughnecks = factionGroup.letters.flatMap((l) => l.entries).find((e) => e.id === 'roughnecks');
            assert.equal(roughnecks.definition, 'Rasczak\'s Roughnecks.');
            assert.equal(roughnecks.definitionSource, 'field');
            assert.deepEqual(roughnecks.backlinkIds, ['johnny-rico']);

            const locationGroup = body.groups.find((g) => g.type === 'location');
            const klendathu = locationGroup.letters.flatMap((l) => l.entries)[0];
            assert.equal(klendathu.definitionSource, 'body');
            assert.match(klendathu.definition, /Homeworld of the Arachnid species/);
        } finally {
            vault.destroy();
        }
    });

    test('--no-group-by-type produces a single flat group', () => {
        const vault = createVault(GLOSSARY_FIXTURE);
        try {
            const result = cli(['glossary', '--type', 'faction,location', '--no-group-by-type', '--json'], vault.dir);
            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.groups.length, 1);
            assert.equal(body.groups[0].type, null);
        } finally {
            vault.destroy();
        }
    });

    test('--hide-unreferenced omits terms with no inbound links', () => {
        const vault = createVault(GLOSSARY_FIXTURE);
        try {
            const result = cli(['glossary', '--type', 'faction', '--hide-unreferenced', '--json'], vault.dir);
            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.entryCount, 1);
            const term = body.groups[0].letters[0].entries[0];
            assert.equal(term.id, 'roughnecks');
        } finally {
            vault.destroy();
        }
    });

    test('prints a human-readable listing by default, with a warning when no notes match', () => {
        const vault = createVault(GLOSSARY_FIXTURE);
        try {
            const match = cli(['glossary', '--type', 'faction'], vault.dir);
            assert.equal(match.status, 0, match.stderr);
            assert.match(match.stdout, /Roughnecks/);
            assert.match(match.stdout, /Referenced in: johnny-rico/);

            const noMatch = cli(['glossary', '--type', 'task'], vault.dir);
            assert.equal(noMatch.status, 0);
            assert.match(noMatch.stdout, /No notes found for type\(s\): task/);
        } finally {
            vault.destroy();
        }
    });

    test('--sort-by-references ranks terms by inbound link count, no letter subheadings', () => {
        const vault = createVault(GLOSSARY_FIXTURE);
        try {
            const result = cli(['glossary', '--type', 'faction', '--sort-by-references', '--json'], vault.dir);
            assert.equal(result.status, 0, result.stderr);
            const body = parseJson(result.stdout);
            assert.equal(body.groups[0].letters.length, 1);
            assert.equal(body.groups[0].letters[0].letter, null);
            const terms = body.groups[0].letters[0].entries.map((e) => e.term);
            assert.deepEqual(terms, ['Roughnecks', 'Mobile Infantry']);
        } finally {
            vault.destroy();
        }
    });
});
