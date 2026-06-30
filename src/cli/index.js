'use strict';

const path = require('path');
const fs   = require('fs');
const http = require('http');
const { emitCliError } = require('./io');
const { VaultService } = require('../core/vaultService');
const { buildIndex } = require('../core/index');

function resolveVaultPath(args) {
    const i = args.indexOf('--vault');
    if (i !== -1 && args[i + 1]) return path.resolve(args[i + 1]);
    return process.cwd();
}

function printHelp() {
    console.log([
        '',
        'Usage: yamlink [command] [options]',
        '',
        '  yamlink                         Launch Conduit (starts server automatically if needed)',
        '',
        'Commands:',
        '  build                   Index vault and report broken links / duplicate IDs (CI-safe: exits 1 on issues)',
        '  briefing                Vault pulse, tasks due today/overdue, recent activity',
        '  ls                      List notes with unix-style filtering and sorting',
        '  cat <id>                Print a note frontmatter snapshot and body',
        '  grep <text>             Search frontmatter values for matching text',
        '  find                    Structural note search by present/missing fields',
        '  create <type>           Create a new note with optional --field pairs',
        '  diff <id1> <id2>        Compare frontmatter fields between two notes, or use --since for recent changes',
        '  doctor                  Comprehensive vault health and integrity pass',
        '  init [path]             Initialize a new Yamlink vault',
        '  rename <old-id> <new-id> Rename a note id and rewrite wikilinks vault-wide',
        '  search <query>          Search notes by id, name, title, or type',
        '  status                  Fast vault snapshot for scripts and health checks',
        '  health                  Vault health overview — lifecycle, drift, type distribution',
        '  mutations               Browse vault mutation history',
        '  session                 Summarize recent or explicit mutation sessions',
        '  on <event>              Watch vault and exec a script on matching mutation events',
        '  schema list|check <type> Schema introspection',
        '  validate                Schema conformance check — required fields, dangling relations (exits 1 on failures)',
        '  query "<query>"         Run a Yamlink query and print results',
        '  report <id>             Note report — type, lifecycle, drift, links for a given ID',
        '  links <id>              Inbound and outbound links for a note',
        '  graph                   Export the vault graph as JSON',
        '  serve                   Start a local HTTP API server for the vault (--lsp for LSP mode)',
        '  watch                   Watch vault for changes and rebuild index on save',
        '  suggest <id>            Intelligence — suggest fields likely missing from a note',
        '  drift                   Intelligence — notes structurally drifting from their type bundle',
        '  stale                   Intelligence — notes in stale lifecycle state',
        '  orphans                 Intelligence — notes with no inbound or outbound links',
        '  pressure                Intelligence — knowledge pressure: load-bearing drafts, stale hubs, orphans',
        '  set <id> <field> <value> Set a frontmatter field on a note (use --clear to remove)',
        '  link <id> <field> <to>  Add a wikilink relation field on a note (--append to keep existing)',
        '  lenses                  Intelligence — vault change lenses over mutation history',
        '  conduit                 Open Yamlink Conduit in the terminal UI',
        '  completions <shell>     Print shell completion script (bash or zsh)',
        '  export                  Export vault notes as JSON or CSV',
        '  env                     Export shell variables for the current vault',
        '',
        'Options:',
        '  --vault <path>          Vault path (default: current directory)',
        '  --json                  Output as JSON',
        '  --host <host>           Host for Conduit/API commands (default: 127.0.0.1)',
        '  --port <n>              Port for serve command (default: 3000)',
        '  --limit <n>             Result limit for supported commands',
        '  --check <list>          Validation checks: schema,broken-links,duplicates',
        '  --all                   Run schema check across every schema target',
        '  --dry-run               Preview changes without writing files',
        '  --quiet                 Suppress advisory or non-essential output',
        '  --rename-file           Rename the owning markdown file when it matches the old id',
        '  --format json|csv       Output format for export command (default: json)',
        '  --query "<query>"       Query string for export command',
        '  --output <file>         Write output to file instead of stdout',
        '  --field <key=value>     Field pair for create command (repeatable)',
        '  --sort name|date|type   Sort order for ls command',
        '  --has <field>           Require a field to be present (repeatable)',
        '  --missing <field>       Require a field to be absent (repeatable)',
        '  --only-types <a,b>      Limit graph export to specific note types',
        '  --type <type>           Type filter for on command',
        '  --shell bash|zsh|fish   Shell format for env command',
        '  --stream                Stream live NDJSON output where supported',
        '  --help, -h              Show this help',
        '',
        'Examples:',
        '  yamlink build --vault ~/vault',
        '  yamlink briefing --vault ~/vault',
        '  yamlink ls --type contact --sort name',
        '  yamlink cat johnny-rico',
        '  yamlink grep rough --field unit',
        '  yamlink find --type contact --has status --missing owner',
        '  yamlink create contact --field name="Jane Doe"',
        '  yamlink doctor --json',
        '  yamlink diff johnny-rico carl-jenkins --json',
        '  yamlink diff --since 2026-06-01T00:00:00.000Z',
        '  yamlink init ~/notes',
        '  yamlink rename old-id new-id --dry-run --rename-file',
        '  yamlink search "rico" --type contact',
        '  yamlink status --json',
        '  yamlink on note_created --type contact -- ./sync.sh',
        '  yamlink on field_changed --type task -- node ./notify.js',
        '  yamlink health',
        '  yamlink schema list',
        '  yamlink schema check contact',
        '  yamlink schema check --all --json',
        '  yamlink validate',
        '  yamlink query "where type = contact"',
        '  yamlink query "!view contact select id, name, status"',
        '  yamlink report johnny-rico',
        '  yamlink links johnny-rico --json',
        '  yamlink graph --only-types contact,unit',
        '  yamlink serve --port 4000',
        '  yamlink serve --lsp --vault ~/notes',
        '  yamlink watch --vault ~/vault',
        '  yamlink                         Launch Conduit (auto-starts server)',
        '  yamlink conduit --port 3000 --host 127.0.0.1',
        '  yamlink completions bash >> ~/.bash_completion',
        '  eval "$(yamlink completions zsh)"',
        '  yamlink export --format csv --output notes.csv',
        '  yamlink export --query "where type = contact" --format json',
        '  eval "$(yamlink env --shell zsh)"',
        '  yamlink suggest johnny-rico',
        '  yamlink drift --type contact',
        '  yamlink stale --json',
        '  yamlink orphans --type task',
        '  yamlink pressure',
        '  yamlink session',
        '  yamlink lenses --json',
        '  yamlink set johnny-rico rank "Captain"',
        '  yamlink set johnny-rico status --clear',
        '  yamlink link johnny-rico unit roughnecks',
        '  yamlink link johnny-rico unit roughnecks --append',
        '',
    ].join('\n'));
}

function buildIndexQuietly(workspaceFolders) {
    const originalLog = console.log;
    console.log = () => {};
    try {
        buildIndex(workspaceFolders);
    } finally {
        console.log = originalLog;
    }
}

/**
 * @param {{
 *   json: boolean,
 *   error: unknown,
 *   code?: string,
 *   exitCode?: number,
 *   details?: any
 * }} options
 */
function failCli({ json, error, code = 'USER_ERROR', exitCode = 1, details }) {
    emitCliError({ json, error, code, exitCode, details });
}

/**
 * Returns true if something is already listening on host:port.
 * Times out after 800ms so startup isn't blocked for long.
 */
function probeServer(host, port) {
    return new Promise((resolve) => {
        const req = http.get(`http://${host}:${port}/api/types`, { timeout: 800 }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

/**
 * Launch Conduit, starting the API server in-process if none is already running.
 * Called both from the no-args path and from `yamlink conduit`.
 */
async function launchConduit(args) {
    const flagVal = (flag) => {
        const i = args.indexOf(flag);
        return i !== -1 && args[i + 1] ? args[i + 1] : null;
    };
    const host = flagVal('--host') || '127.0.0.1';
    const port = parseInt(flagVal('--port') || '3000', 10);
    const vaultPath = resolveVaultPath(args);

    const alreadyRunning = await probeServer(host, port);
    let ownedServer = null;

    if (!alreadyRunning) {
        if (!fs.existsSync(vaultPath)) {
            process.stderr.write(`yamlink: vault not found at ${vaultPath}\n`);
            process.exit(1);
            return;
        }
        process.stderr.write(`Starting server on http://${host}:${port}...\n`);
        try {
            const { startServer } = require('./commands/serve');
            ownedServer = await startServer({
                port,
                vaultPath,
                workspaceFolders: [{ uri: { fsPath: vaultPath } }]
            });
        } catch (err) {
            process.stderr.write(`yamlink: failed to start server — ${err && err.message ? err.message : String(err)}\n`);
            process.exit(2);
            return;
        }
    }

    try {
        await require('../conduit').run({ host, port });
    } finally {
        if (ownedServer) {
            await ownedServer.close().catch(() => {});
        }
    }
}

async function main() {
    const args    = process.argv.slice(2);
    const command = args.find(a => !a.startsWith('-'));
    const ddIdx = args.indexOf('--');
    const script = ddIdx !== -1 ? args.slice(ddIdx + 1).join(' ') : null;

    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }

    if (!command) {
        // No subcommand → launch Conduit, auto-starting the server if needed.
        await launchConduit(args);
        return;
    }

    const json = args.includes('--json');
    const quiet = args.includes('--quiet');

    // Positional args — strip flags and their values
    const pos = [];
    for (let i = 0; i < args.length && (ddIdx === -1 || i < ddIdx); i++) {
        if (args[i] === '--vault' || args[i] === '--port' || args[i] === '--host' || args[i] === '--format' ||
            args[i] === '--output' || args[i] === '--query' || args[i] === '--field' || args[i] === '--type' ||
            args[i] === '--only-types' || args[i] === '--check' || args[i] === '--since' ||
            args[i] === '--limit' || args[i] === '--id' || args[i] === '--sort' ||
            args[i] === '--has' || args[i] === '--missing' || args[i] === '--max-broken-links' ||
            args[i] === '--schema-coverage' || args[i] === '--max-stale-days' ||
            args[i] === '--min-health-score' || args[i] === '--shell') { i++; continue; }
        if (args[i].startsWith('--')) continue;
        pos.push(args[i]);
    }

    if (command === 'completions') {
        const shell = pos[1];
        require('./commands/completions').run({ shell, json });
        return;
    }

    const flagVal = (flag) => {
        const i = args.indexOf(flag);
        return i !== -1 && args[i + 1] ? args[i + 1] : null;
    };
    const flagVals = (flag) => {
        const values = [];
        for (let i = 0; i < args.length; i++) {
            if (args[i] === flag && args[i + 1]) values.push(args[i + 1]);
        }
        return values;
    };

    if (command === 'conduit') {
        await launchConduit(args);
        return;
    }

    if (command === 'init') {
        require('./commands/init').run({ targetPath: pos[1], json, quiet, dryRun: args.includes('--dry-run') });
        return;
    }

    const vaultPath = resolveVaultPath(args);

    if (!fs.existsSync(vaultPath)) {
        failCli({
            json,
            error: 'Vault path not found: ' + vaultPath,
            code: 'NOT_FOUND',
            exitCode: 1,
            details: { vaultPath }
        });
    }

    try {
        const mutLog = require('../runtime/mutationEventLog');
        mutLog.initMutationLog(path.join(vaultPath, '.yamlink', 'mutation-log.ndjson'));
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const nonce = Math.random().toString(36).slice(2, 8);
        const cliSessionId = `cli-${stamp}-${nonce}`;
        mutLog.setDefaultMutationContextProvider(() => ({ sessionId: cliSessionId, source: 'cli' }));
    } catch (_) {}

    if (command === 'create') {
        const noteType = pos[1];
        if (!noteType) { failCli({ json, error: 'Usage: yamlink create <type>', code: 'USAGE', exitCode: 1 }); }
        const createWorkspaceFolders = [{ uri: { fsPath: vaultPath }, name: path.basename(vaultPath) }];
        const createService = new VaultService({
            workspaceFolders: createWorkspaceFolders,
            buildIndex: () => buildIndexQuietly(createWorkspaceFolders)
        });
        try {
            await createService.initialize(vaultPath);
        } catch (err) {
            failCli({
                json,
                error: 'Failed to index vault at ' + vaultPath + ': ' + err.message,
                code: 'INTERNAL_ERROR',
                exitCode: 2
            });
        }
        await require('./commands/create').run({ noteType, rawArgs: args, vaultPath, json, quiet, dryRun: args.includes('--dry-run'), vaultService: createService });
        return;
    }

    const workspaceFolders = [{ uri: { fsPath: vaultPath }, name: path.basename(vaultPath) }];
    const vaultService = new VaultService({
        workspaceFolders,
        buildIndex: () => buildIndexQuietly(workspaceFolders)
    });

    if (command === 'on') {
        const event = pos[1];
        if (!event || !script) {
            failCli({ json, error: 'Usage: yamlink on <event> [--type <type>] -- <script>', code: 'USAGE', exitCode: 1 });
        }
        try {
            await vaultService.initialize(vaultPath);
        } catch (err) {
            failCli({
                json,
                error: 'Failed to index vault at ' + vaultPath + ': ' + err.message,
                code: 'INTERNAL_ERROR',
                exitCode: 2
            });
        }
        require('./commands/on').run({
            event,
            noteType: flagVal('--type'),
            script,
            vaultPath,
            vaultService,
            json,
            quiet
        });
        return;
    }

    // LSP mode owns its own index lifecycle — skip the pre-bootstrap so the
    // server doesn't build the index twice (here + handleInitialize).
    if (command === 'serve' && args.includes('--lsp')) {
        require('../lsp/server').run({ vaultPath });
        return;
    }

    try {
        await vaultService.initialize(vaultPath);
    } catch (err) {
        failCli({
            json,
            error: 'Failed to index vault at ' + vaultPath + ': ' + err.message,
            code: 'INTERNAL_ERROR',
            exitCode: 2
        });
    }

    switch (command) {
    case 'build':
        require('./commands/build').run({ json, vaultPath });
        break;

    case 'ls':
        require('./commands/ls').run({
            typeFilter: flagVal('--type'),
            sortBy: flagVal('--sort'),
            json
        });
        break;

    case 'cat': {
        const id = pos[1];
        if (!id) { failCli({ json, error: 'Usage: yamlink cat <id>', code: 'USAGE', exitCode: 1 }); }
        require('./commands/cat').run({ id, json });
        break;
    }

    case 'grep': {
        const searchText = pos.slice(1).join(' ').trim();
        if (!searchText) { failCli({ json, error: 'Usage: yamlink grep <text>', code: 'USAGE', exitCode: 1 }); }
        require('./commands/grep').run({
            text: searchText,
            typeFilter: flagVal('--type'),
            field: flagVal('--field'),
            json
        });
        break;
    }

    case 'find':
        require('./commands/find').run({
            hasFields: flagVals('--has'),
            missingFields: flagVals('--missing'),
            typeFilter: flagVal('--type'),
            json
        });
        break;

    case 'briefing':
        require('./commands/briefing').run({ json, vaultPath, output: flagVal('--output') });
        break;

    case 'doctor':
        require('./commands/doctor').run({ json, output: flagVal('--output') });
        break;

    case 'diff':
        require('./commands/diff').run({ id1: pos[1], id2: pos[2], since: flagVal('--since'), json, quiet, output: flagVal('--output') });
        break;

    case 'rename':
        await require('./commands/rename').run({
            oldId: pos[1],
            newId: pos[2],
            vaultPath,
            vaultService,
            json,
            quiet,
            dryRun: args.includes('--dry-run'),
            renameFile: args.includes('--rename-file')
        });
        break;

    case 'search': {
        const searchQuery = pos.slice(1).join(' ').trim();
        require('./commands/search').run({
            query: searchQuery,
            typeFilter: flagVal('--type'),
            field: flagVal('--field'),
            json,
            quiet
        });
        break;
    }

    case 'status':
        require('./commands/status').run({ json });
        break;

    case 'health':
        require('./commands/health').run({ json, output: flagVal('--output') });
        break;

    case 'mutations':
        require('./commands/mutations').run({
            eventType: flagVal('--type'),
            noteId: flagVal('--id'),
            since: flagVal('--since'),
            limit: parseInt(flagVal('--limit') || '50', 10),
            json,
            quiet
        });
        break;

    case 'session':
        require('./commands/session').run({
            sessionId: flagVal('--id') || null,
            json
        });
        break;

    case 'schema':
        require('./commands/schema').run({
            action: pos[1],
            noteType: pos[2],
            json,
            all: args.includes('--all'),
            output: flagVal('--output')
        });
        break;

    case 'validate':
        require('./commands/validate').run({
            json,
            checks: flagVal('--check'),
            output: flagVal('--output'),
            maxBrokenLinks: flagVal('--max-broken-links'),
            schemaCoverage: flagVal('--schema-coverage'),
            noOrphans: args.includes('--no-orphans'),
            maxStaleDays: flagVal('--max-stale-days'),
            minHealthScore: flagVal('--min-health-score')
        });
        break;

    case 'report': {
        const id = pos[1];
        if (!id) { failCli({ json, error: 'Usage: yamlink report <id>', code: 'USAGE', exitCode: 1 }); }
        require('./commands/report').run({ id, json, output: flagVal('--output'), history: args.includes('--history') });
        break;
    }

    case 'query': {
        const queryArg = pos.slice(1).join(' ').trim();
        if (!queryArg) { failCli({ json, error: 'Usage: yamlink query "<query text>"', code: 'USAGE', exitCode: 1 }); }
        require('./commands/query').run({ query: queryArg, json, quiet, output: flagVal('--output') });
        break;
    }

    case 'links': {
        const id = pos[1];
        if (!id) { failCli({ json, error: 'Usage: yamlink links <id>', code: 'USAGE', exitCode: 1 }); }
        require('./commands/links').run({ id, json, output: flagVal('--output') });
        break;
    }

    case 'graph':
        require('./commands/graph').run({
            output: flagVal('--output'),
            typeFilter: flagVal('--only-types') ? flagVal('--only-types').split(',').map((value) => value.trim()).filter(Boolean) : null
        });
        break;

    case 'serve': {
        const port = parseInt(flagVal('--port') || '3000', 10);
        await require('./commands/serve').run({ port, vaultPath, workspaceFolders, vaultService, json, quiet });
        break;
    }

    case 'watch':
        require('./commands/watch').run({ vaultPath, vaultService, json, quiet, stream: args.includes('--stream') });
        break;

    case 'export': {
        const format = flagVal('--format') || (json ? 'json' : 'json');
        const query  = flagVal('--query');
        const output = flagVal('--output');
        require('./commands/export').run({ query, format, output, json, quiet });
        break;
    }

    case 'env':
        require('./commands/env').run({ vaultPath, shell: flagVal('--shell'), json });
        break;

    case 'suggest': {
        const id = pos[1];
        if (!id) { failCli({ json, error: 'Usage: yamlink suggest <id>', code: 'USAGE', exitCode: 1 }); }
        require('./commands/suggest').run({ id, json, output: flagVal('--output') });
        break;
    }

    case 'drift':
        require('./commands/drift').run({
            typeFilter: flagVal('--type'),
            limit: parseInt(flagVal('--limit') || '50', 10),
            json,
            output: flagVal('--output')
        });
        break;

    case 'stale':
        require('./commands/stale').run({
            typeFilter: flagVal('--type'),
            limit: parseInt(flagVal('--limit') || '50', 10),
            json,
            output: flagVal('--output')
        });
        break;

    case 'orphans':
        require('./commands/orphans').run({
            typeFilter: flagVal('--type'),
            limit: parseInt(flagVal('--limit') || '50', 10),
            json,
            output: flagVal('--output')
        });
        break;

    case 'pressure':
        require('./commands/pressure').run({ json, output: flagVal('--output') });
        break;

    case 'lenses':
        require('./commands/lenses').run({ json });
        break;

    case 'set': {
        const setId    = pos[1];
        const setField = pos[2];
        const setValue = pos[3];
        await require('./commands/set').run({
            id: setId, field: setField, value: setValue,
            vaultPath, json, quiet,
            dryRun: args.includes('--dry-run'),
            clear:  args.includes('--clear')
        });
        break;
    }

    case 'link': {
        const linkId       = pos[1];
        const linkField    = pos[2];
        const linkTargetId = pos[3];
        await require('./commands/link').run({
            id: linkId, field: linkField, targetId: linkTargetId,
            vaultPath, json, quiet,
            dryRun:  args.includes('--dry-run'),
            append:  args.includes('--append')
        });
        break;
    }

    default:
        failCli({
            json,
            error: 'Unknown command: ' + command,
            code: 'USAGE',
            exitCode: 1,
            details: { command }
        });
    }
}

Promise.resolve(main()).catch((error) => {
    emitCliError({
        json: process.argv.includes('--json'),
        error: error && error.message ? error.message : String(error),
        code: 'INTERNAL_ERROR',
        exitCode: 2
    });
});
