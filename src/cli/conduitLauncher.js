'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { resolveVaultPath } = require('./args');

function probeServer(host, port) {
    return new Promise((resolve) => {
        const req = http.get(`http://${host}:${port}/api/health`, { timeout: 800 }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    resolve({ vaultPath: typeof body.vaultPath === 'string' ? body.vaultPath : null });
                } catch (_) {
                    resolve({ vaultPath: null });
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

async function launchConduit(args) {
    const flagVal = (flag) => {
        const i = args.indexOf(flag);
        return i !== -1 && args[i + 1] ? args[i + 1] : null;
    };
    const host = flagVal('--host') || '127.0.0.1';
    const requestedPort = parseInt(flagVal('--port') || '3000', 10);
    const vaultPath = resolveVaultPath(args);

    if (!fs.existsSync(vaultPath)) {
        process.stderr.write(`yamlink: vault not found at ${vaultPath}\n`);
        process.exit(1);
        return;
    }

    const running = await probeServer(host, requestedPort);
    const sameVault = running && running.vaultPath && path.resolve(running.vaultPath) === vaultPath;

    let port = requestedPort;
    let ownedServer = null;

    if (running && !sameVault) {
        process.stderr.write(
            running.vaultPath
                ? `yamlink: ${host}:${requestedPort} is already serving a different vault (${running.vaultPath}) — starting a separate server for this one instead.\n`
                : `yamlink: something is already answering on ${host}:${requestedPort} but couldn't identify which vault it's serving — starting a separate server for this one instead.\n`
        );
        port = 0; // OS-assigned free port; startServer() reports back whichever one it actually bound.
    }

    if (!running || !sameVault) {
        process.stderr.write(`Starting server for ${vaultPath}...\n`);
        try {
            const { startServer } = require('./commands/serve');
            ownedServer = await startServer({
                port,
                vaultPath,
                workspaceFolders: [{ uri: { fsPath: vaultPath } }]
            });
            port = ownedServer.port;
            process.stderr.write(`Serving on http://${host}:${port}\n`);
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

module.exports = { launchConduit, probeServer };
