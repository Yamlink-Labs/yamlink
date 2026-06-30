'use strict';

const fs = require('fs');
const path = require('path');
const { emitCliError, emitCliSuccess, emitText } = require('../io');

function run({ targetPath, json, quiet, dryRun }) {
    const resolvedPath = path.resolve(targetPath || process.cwd());
    const yamlinkDir = path.join(resolvedPath, '.yamlink');

    if (fs.existsSync(yamlinkDir)) {
        emitCliError({ json, error: `Vault already initialized at ${resolvedPath}`, code: 'ALREADY_INITIALIZED', details: { path: resolvedPath, created: [] }, exitCode: 1 });
        return;
    }

    if (!dryRun) {
        try {
            fs.mkdirSync(resolvedPath, { recursive: true });
            fs.mkdirSync(yamlinkDir, { recursive: true });
            fs.mkdirSync(path.join(resolvedPath, '_templates'), { recursive: true });
            fs.writeFileSync(
                path.join(resolvedPath, 'welcome.md'),
                ['---', 'id: welcome', 'type: note', 'name: Welcome', '---', '', 'Welcome to Yamlink.'].join('\n'),
                'utf8'
            );
        } catch (error) {
            emitCliError({ json, error: 'Failed to initialize vault: ' + error.message, code: 'INTERNAL_ERROR', exitCode: 2 });
            return;
        }
    }

    const created = ['.yamlink/', '_templates/', 'welcome.md'];
    if (json) {
        emitCliSuccess({ path: resolvedPath, created, dryRun: !!dryRun });
        return;
    }

    emitText((quiet ? created.join('\n') : `${dryRun ? 'Would initialize' : 'Initialized'} Yamlink vault at ${resolvedPath}\n${created.map((entry) => '  ' + entry).join('\n')}`) + '\n');
}

module.exports = { run };
