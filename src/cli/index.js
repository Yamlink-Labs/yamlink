'use strict';

const fs = require('fs');
const { parseCliArgs, resolveVaultPath } = require('./args');
const { launchConduit } = require('./conduitLauncher');
const { dispatchCommand } = require('./router');
const { printHelp } = require('./help');
const { emitCliError } = require('./io');
const { failCli, initializeCliMutationRuntime } = require('./runtime');

async function main() {
    const parsed = parseCliArgs(process.argv.slice(2));
    const { args, command, pos, json, quiet } = parsed;

    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }

    if (args.includes('--version') || args.includes('-v')) {
        // Real bug found 2026-08-02: handle version before falling into
        // the no-command Conduit-launch path.
        console.log(require('../../package.json').version);
        return;
    }

    if (!command) {
        await launchConduit(args);
        return;
    }

    if (command === 'completions') {
        require('./commands/completions').run({ shell: pos[1], json });
        return;
    }

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

    initializeCliMutationRuntime(vaultPath);
    await dispatchCommand({ ...parsed, vaultPath });
}

Promise.resolve(main()).catch((error) => {
    emitCliError({
        json: process.argv.includes('--json'),
        error: error && error.message ? error.message : String(error),
        code: 'INTERNAL_ERROR',
        exitCode: 2
    });
});
