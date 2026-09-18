'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const { createVaultService, createWorkspaceFolders, failCli } = require('./runtime');
const {
    makeDaemonId,
    writeDaemonRecord,
    getLogFilePath,
    getDaemonDir
} = require('../runtime/daemonRegistry');

async function dispatchCommand(context) {
    const { command, args, pos, script, vaultPath, json, quiet, flagVal, flagVals } = context;
    if (command === 'create') {
    const noteType = pos[1];
    if (!noteType) { failCli({ json, error: 'Usage: yamlink create <type>', code: 'USAGE', exitCode: 1 }); }
    const createFolders = createWorkspaceFolders(vaultPath);
    const createService = createVaultService(createFolders);
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

const workspaceFolders = createWorkspaceFolders(vaultPath);
const vaultService = createVaultService(workspaceFolders);

if (command === 'on') {
    const onCommands = require('./commands/on');

    // --list / --stop / --stop-all: pure PID-registry operations, no event
    // or script needed, no reason to pay for a full vault index build.
    if (args.includes('--list')) {
        onCommands.runList({ vaultPath, json });
        return;
    }
    if (args.includes('--stop-all')) {
        onCommands.runStop({ vaultPath, json, stopAll: true });
        return;
    }
    const stopId = flagVal('--stop');
    if (stopId) {
        onCommands.runStop({ vaultPath, json, stopId });
        return;
    }

    const event = pos[1];
    if (!event || !script) {
        failCli({ json, error: 'Usage: yamlink on <event> [--type <type>] -- <script> [--daemon]', code: 'USAGE', exitCode: 1 });
    }

    // Internal-only: this process IS the detached supervisor started below
    // by --daemon. Its job is to spawn the real worker (this exact
    // invocation again, without the supervise env var) as its own child,
    // and respawn it with backoff if it exits unexpectedly — the process-
    // crash recovery the watch-level retry inside onCommands.run() can't
    // provide on its own, since that only covers a live process's fs.watch
    // failing, not the process itself dying. Never set this env var by
    // hand; --daemon sets it internally.
    if (process.env.YAMLINK_DAEMON_SUPERVISE === '1') {
        const childArgv = args.filter((a) => a !== '--daemon');
        const supervisor = onCommands.runSupervisedDaemon({ childArgv, logFd: 1, onGiveUp: () => process.exit(1) });
        const stopSupervisor = () => { supervisor.stop(); process.exit(0); };
        process.on('SIGTERM', stopSupervisor);
        process.on('SIGINT', stopSupervisor);
        return;
    }

    // --daemon: spawn a detached supervisor (same args, minus --daemon,
    // plus the internal supervise env var above) so the actual watcher
    // survives this terminal closing AND recovers from the worker process
    // itself dying, not just a live worker's fs.watch failing. The
    // top-level parent's only job is to spawn the supervisor, register its
    // real PID (not the worker's — the worker's PID changes across
    // respawns, the supervisor's doesn't, and `--stop` needs a stable
    // target), and exit immediately.
    if (args.includes('--daemon')) {
        const id = makeDaemonId();
        const daemonDir = getDaemonDir(vaultPath);
        fs.mkdirSync(daemonDir, { recursive: true });
        const logPath = getLogFilePath(vaultPath, id);
        const logFd = fs.openSync(logPath, 'a');
        const childArgs = args.filter((a) => a !== '--daemon');
        const child = spawn(process.execPath, [process.argv[1], ...childArgs], {
            detached: true,
            stdio: ['ignore', logFd, logFd],
            cwd: process.cwd(),
            env: { ...process.env, YAMLINK_DAEMON_SUPERVISE: '1' }
        });
        child.unref();
        writeDaemonRecord(vaultPath, id, {
            pid: child.pid,
            event,
            noteType: flagVal('--type') || null,
            script,
            startedAt: new Date().toISOString()
        });
        if (json) {
            require('./io').emitJson({ ok: true, event: 'daemon_started', id, pid: child.pid, logPath });
        } else if (!quiet) {
            require('./io').emitText(`Started daemon ${id} (pid ${child.pid}). Logs: ${logPath}\nStop it with: yamlink on --stop ${id}\n`);
        }
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
    onCommands.run({
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

if (command === 'hooks') {
    const action = pos[1];
    require('./commands/hooks').run({
        action,
        event: pos[2],
        url: pos[3],
        id: pos[2],
        noteType: flagVal('--type'),
        vaultPath,
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
        json,
        quiet
    });
    break;

case 'cat': {
    const id = pos[1];
    if (!id) { failCli({ json, error: 'Usage: yamlink cat <id>', code: 'USAGE', exitCode: 1 }); }
    require('./commands/cat').run({ id, json, at: flagVal('--at') });
    break;
}

case 'grep': {
    const searchText = pos.slice(1).join(' ').trim();
    if (!searchText) { failCli({ json, error: 'Usage: yamlink grep <text>', code: 'USAGE', exitCode: 1 }); }
    require('./commands/grep').run({
        text: searchText,
        typeFilter: flagVal('--type'),
        field: flagVal('--field'),
        json,
        quiet
    });
    break;
}

case 'find':
    require('./commands/find').run({
        hasFields: flagVals('--has'),
        missingFields: flagVals('--missing'),
        typeFilter: flagVal('--type'),
        json,
        quiet
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

case 'story':
    require('./commands/story').run({ since: flagVal('--since'), quarterly: args.includes('--quarterly'), json, output: flagVal('--output') });
    break;

case 'snapshot':
    require('./commands/snapshot').run({ reason: flagVal('--reason'), json });
    break;

case 'restore':
    require('./commands/restore').run({ timestamp: pos[1], output: flagVal('--output'), vaultPath, json });
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
        renameFile: args.includes('--rename-file'),
        force: args.includes('--force')
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

case 'trends':
    require('./commands/trends').run({ json, output: flagVal('--output') });
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
    require('./commands/report').run({ id, json, output: flagVal('--output'), history: args.includes('--history'), at: flagVal('--at') });
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
    require('./commands/links').run({ id, json, output: flagVal('--output'), at: flagVal('--at') });
    break;
}

case 'graph':
    require('./commands/graph').run({
        output: flagVal('--output'),
        typeFilter: flagVal('--only-types') ? flagVal('--only-types').split(',').map((value) => value.trim()).filter(Boolean) : null,
        at: flagVal('--at'),
        since: flagVal('--since'),
        until: flagVal('--until'),
        points: flagVal('--points'),
        interval: flagVal('--interval')
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
    const id = flagVal('--id');
    const query  = flagVal('--query');
    const output = flagVal('--output');
    require('./commands/export').run({ id, query, format, output, json, quiet });
    break;
}

case 'publish': {
    await require('./commands/publish').run({
        out: flagVal('--out'),
        mode: flagVal('--mode'),
        siteUrl: flagVal('--site-url'),
        webhook: flagVal('--webhook'),
        force: args.includes('--force'),
        json, quiet
    });
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

case 'signature':
    require('./commands/signature').run({ json, output: flagVal('--output') });
    break;

case 'workflow-memory':
    require('./commands/workflowMemory').run({
        typeFilter: flagVal('--type'),
        json,
        output: flagVal('--output')
    });
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
        vaultPath, json, quiet, vaultService,
        dryRun: args.includes('--dry-run'),
        clear:  args.includes('--clear')
    });
    break;
}

case 'bulk-set':
    await require('./commands/bulkSet').run({
        ids: flagVal('--ids'),
        field: flagVal('--field'),
        value: flagVal('--value'),
        add: flagVal('--add'),
        clear: args.includes('--clear'),
        vaultService,
        json,
        quiet,
        dryRun: args.includes('--dry-run')
    });
    break;

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

case 'template': {
    const subcommand = pos[1];
    const templateId = pos[2];
    require('./commands/template').run({
        subcommand, id: templateId,
        vaultPath, json,
        force: args.includes('--force')
    });
    break;
}

case 'glossary': {
    require('./commands/glossary').run({
        types: flagVal('--type'),
        groupByType: !args.includes('--no-group-by-type'),
        showZeroBacklinkTerms: !args.includes('--hide-unreferenced'),
        extraFields: flagVals('--extra-field'),
        sortBy: args.includes('--sort-by-references') ? 'mostReferenced' : 'alphabetical',
        json
    });
    break;
}

case 'block-backlinks': {
    require('./commands/blockBacklinks').run({
        id: pos[1],
        blockId: flagVal('--block'),
        json
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

module.exports = { dispatchCommand };
