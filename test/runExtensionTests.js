'use strict';

const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const workspacePath = path.resolve(__dirname, 'fixtures', 'ext-host-workspace');

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspacePath,
                '--disable-extensions'
            ]
        });
    } catch (error) {
        console.error('Extension host tests failed');
        console.error(error);
        process.exit(1);
    }
}

main();
