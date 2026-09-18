'use strict';

const path = require('path');

const VALUE_FLAGS = new Set([
    '--vault', '--port', '--host', '--format', '--output', '--query', '--field', '--type',
    '--only-types', '--check', '--since', '--until', '--points', '--interval', '--at', '--limit', '--id', '--sort', '--has',
    '--missing', '--max-broken-links', '--schema-coverage', '--max-stale-days',
    '--min-health-score', '--shell', '--reason', '--block', '--ids', '--value', '--add'
]);

function resolveVaultPath(args) {
    const i = args.indexOf('--vault');
    if (i !== -1 && args[i + 1]) return path.resolve(args[i + 1]);
    return process.cwd();
}

function flagVal(args, flag) {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function flagVals(args, flag) {
    const values = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === flag && args[i + 1]) values.push(args[i + 1]);
    }
    return values;
}

function parseCliArgs(argv = process.argv.slice(2)) {
    const args = [...argv];
    const command = args.find(a => !a.startsWith('-'));
    const ddIdx = args.indexOf('--');
    const script = ddIdx !== -1 ? args.slice(ddIdx + 1).join(' ') : null;
    const pos = [];
    for (let i = 0; i < args.length && (ddIdx === -1 || i < ddIdx); i++) {
        if (VALUE_FLAGS.has(args[i])) { i++; continue; }
        if (args[i].startsWith('--')) continue;
        pos.push(args[i]);
    }
    return {
        args,
        command,
        ddIdx,
        script,
        pos,
        json: args.includes('--json'),
        quiet: args.includes('--quiet'),
        flagVal: (flag) => flagVal(args, flag),
        flagVals: (flag) => flagVals(args, flag)
    };
}

module.exports = {
    parseCliArgs,
    resolveVaultPath,
    flagVal,
    flagVals
};
