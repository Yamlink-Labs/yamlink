'use strict';

const App = require('./App');
const { getNodes } = require('./useApi');
const { resolveVaultPath } = require('./storage');

function renderConnectionError(host, port) {
    console.error('Yamlink Conduit');
    console.error('');
    console.error(`Cannot connect to yamlink serve on http://${host}:${port}. Is it running?`);
}

async function run({ host = '127.0.0.1', port = 3000 }) {
    const normalizedHost = String(host || '127.0.0.1').trim() || '127.0.0.1';
    const normalizedPort = Number.parseInt(String(port || '3000'), 10) || 3000;

    try {
        var nodes = await getNodes({ host: normalizedHost, port: normalizedPort, type: 'any' });
    } catch (_) {
        renderConnectionError(normalizedHost, normalizedPort);
        process.exit(1);
        return;
    }

    const initialData = await App.fetchBriefingData(normalizedHost, normalizedPort);
    const vaultPath = resolveVaultPath({ cwd: process.cwd(), nodes });
    const React = require('react');
    const ink = await import('ink');
    const { default: TextInput } = await import('ink-text-input');
    const instance = ink.render(React.createElement(App, {
        ink,
        TextInput,
        host: normalizedHost,
        port: normalizedPort,
        initialData,
        vaultPath
    }), { alternateScreen: true });
    // Without this, run() resolves the instant ink.render() returns — before
    // the user has even seen the screen — which lets launchConduit()'s
    // `finally { ownedServer.close() }` tear down the API server it just
    // started while Conduit is still on screen and depending on it (App.js's
    // own `exit` comes from Ink's useApp(), which unmounts and resolves this
    // promise — so this correctly waits for a real quit, not a fixed delay).
    await instance.waitUntilExit();
}

module.exports = { run };
