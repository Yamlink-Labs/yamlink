'use strict';

let responseGuard = null;

function startTransport(onMessage) {
    let buffer = Buffer.alloc(0);
    let queue = Promise.resolve();

    process.stdin.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;
            const header = buffer.slice(0, headerEnd).toString('ascii');
            const match  = /Content-Length:\s*(\d+)/i.exec(header);
            if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
            const len = parseInt(match[1], 10);
            if (buffer.length < headerEnd + 4 + len) break;
            const content = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
            buffer = buffer.slice(headerEnd + 4 + len);
            try {
                const message = JSON.parse(content);
                if (message && message.method === '$/cancelRequest') {
                    Promise.resolve(onMessage(message)).catch(() => {});
                    continue;
                }
                queue = queue.then(() => Promise.resolve(onMessage(message))).catch(() => {});
            } catch (_) {}
        }
    });

    process.stdin.resume();
}

function send(msg) {
    const json   = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    process.stdout.write(header + json);
}

function shouldSuppressResponse(id) {
    if (id === undefined || id === null || typeof responseGuard !== 'function') return false;
    try {
        return !!responseGuard(id);
    } catch (_) {
        return false;
    }
}

function setResponseGuard(guard) {
    responseGuard = typeof guard === 'function' ? guard : null;
}

function respond(id, result) {
    setImmediate(() => {
        if (shouldSuppressResponse(id)) return;
        send({ jsonrpc: '2.0', id, result });
    });
}

function respondImmediate(id, result) {
    if (shouldSuppressResponse(id)) return;
    send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
    setImmediate(() => {
        if (shouldSuppressResponse(id)) return;
        send({ jsonrpc: '2.0', id, error: { code, message } });
    });
}

function respondErrorImmediate(id, code, message) {
    if (shouldSuppressResponse(id)) return;
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

function notify(method, params) {
    send({ jsonrpc: '2.0', method, params });
}

function log(msg) {
    process.stderr.write('[yamlink-lsp] ' + msg + '\n');
}

/** Send window/logMessage to the client. type: 1=Error 2=Warning 3=Info 4=Log */
function logToClient(message, type = 4) {
    notify('window/logMessage', { type, message });
}

module.exports = {
    startTransport,
    send,
    respond,
    respondImmediate,
    respondError,
    respondErrorImmediate,
    notify,
    log,
    logToClient,
    setResponseGuard
};
