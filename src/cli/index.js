'use strict';

const path = require('path');
const fs   = require('fs');

function resolveVaultPath(args) {
    const i = args.indexOf('--vault');
    if (i !== -1 && args[i + 1]) return path.resolve(args[i + 1]);
    return process.cwd();
}

function printHelp() {
    console.log([
        '',
        'Usage: yamlink <command> [options]',
        '',
        'Commands:',
        '  build                   Index vault and report broken links / duplicate IDs (CI-safe: exits 1 on issues)',
        '  health                  Vault health overview — lifecycle, drift, type distribution',
        '  validate                Schema conformance check — required fields, dangling relations (exits 1 on failures)',
        '  query "<query>"         Run a Yamlink query and print results',
        '  report <id>             Note report — type, lifecycle, drift, links for a given ID',
        '  links <id>              Inbound and outbound links for a note',
        '  serve                   Start a local HTTP API server for the vault',
        '  export                  Export vault notes as JSON or CSV',
        '',
        'Options:',
        '  --vault <path>          Vault path (default: current directory)',
        '  --json                  Output as JSON',
        '  --port <n>              Port for serve command (default: 3000)',
        '  --format json|csv       Output format for export command (default: json)',
        '  --query "<query>"       Query string for export command',
        '  --output <file>         Write output to file instead of stdout',
        '  --help, -h              Show this help',
        '',
        'Examples:',
        '  yamlink build --vault ~/vault',
        '  yamlink health',
        '  yamlink validate',
        '  yamlink query "where type = contact"',
        '  yamlink query "!view contact select id, name, status"',
        '  yamlink report johnny-rico',
        '  yamlink links johnny-rico --json',
        '  yamlink serve --port 4000',
        '  yamlink export --format csv --output notes.csv',
        '  yamlink export --query "where type = contact" --format json',
        '',
    ].join('\n'));
}

function main() {
    const args    = process.argv.slice(2);
    const command = args.find(a => !a.startsWith('-'));

    if (!command || args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }

    const json      = args.includes('--json');
    const vaultPath = resolveVaultPath(args);

    if (!fs.existsSync(vaultPath)) {
        console.error('Error: vault path not found: ' + vaultPath);
        process.exit(1);
    }

    // Bootstrap index
    const { buildIndex } = require('../core/index');
    const workspaceFolders = [{ uri: { fsPath: vaultPath }, name: path.basename(vaultPath) }];
    try {
        buildIndex(workspaceFolders);
    } catch (err) {
        console.error('Error: failed to index vault at ' + vaultPath);
        console.error(err.message);
        process.exit(1);
    }

    // Positional args — strip flags and their values
    const pos = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--vault' || args[i] === '--port' || args[i] === '--format' ||
            args[i] === '--output' || args[i] === '--query') { i++; continue; }
        if (args[i].startsWith('--')) continue;
        pos.push(args[i]);
    }

    const flagVal = (flag) => {
        const i = args.indexOf(flag);
        return i !== -1 && args[i + 1] ? args[i + 1] : null;
    };

    switch (command) {
    case 'build':
        require('./commands/build').run({ json, vaultPath });
        break;

    case 'health':
        require('./commands/health').run({ json });
        break;

    case 'validate':
        require('./commands/validate').run({ json });
        break;

    case 'report': {
        const id = pos[1];
        if (!id) { console.error('Usage: yamlink report <id>'); process.exit(1); }
        require('./commands/report').run({ id, json });
        break;
    }

    case 'query': {
        const queryArg = pos.slice(1).join(' ').trim();
        if (!queryArg) { console.error('Usage: yamlink query "<query text>"'); process.exit(1); }
        require('./commands/query').run({ query: queryArg, json });
        break;
    }

    case 'links': {
        const id = pos[1];
        if (!id) { console.error('Usage: yamlink links <id>'); process.exit(1); }
        require('./commands/links').run({ id, json });
        break;
    }

    case 'serve': {
        const port = parseInt(flagVal('--port') || '3000', 10);
        require('./commands/serve').run({ port, vaultPath, workspaceFolders });
        break;
    }

    case 'export': {
        const format = flagVal('--format') || (json ? 'json' : 'json');
        const query  = flagVal('--query');
        const output = flagVal('--output');
        require('./commands/export').run({ query, format, output, json });
        break;
    }

    default:
        console.error('Unknown command: ' + command);
        printHelp();
        process.exit(1);
    }
}

main();
