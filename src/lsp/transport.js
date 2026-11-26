'use strict';

let responseGuard = null;
let nextRequestId = -1;
const pendingRequests = new Map();
const bufferedResponses = new Map();

// Real, confirmed gap this closes (external security review): the stdin
// handler below concatenated every incoming chunk onto `buffer` with no
// size limit at all, both before a complete `Content-Length` header is seen
// and after one declares a frame length — a malformed or malicious client
// (or just a corrupted stream) could grow this buffer without bound,
// exhausting process memory. Framed as an availability concern rather than
// a remote-exposure one, since this transport is a local stdio pipe between
// the editor and this process, not network-reachable — but the same
// unbounded-buffer mistake already fixed once for the HTTP API (see
// src/api/http.js's MAX_REQUEST_BODY_BYTES) is worth closing here too. 50
// MiB is generous for a single LSP message (a full document sync payload,
// diagnostics for a large file) while still a finite, enforced ceiling.
const MAX_LSP_FRAME_BYTES = 50 * 1024 * 1024;

function _settlePendingRequest(message) {
    const entry = pendingRequests.get(message.id);
    if (!entry) {
        bufferedResponses.set(message.id, message);
        return false;
    }
    pendingRequests.delete(message.id);
    if (message && Object.prototype.hasOwnProperty.call(message, 'error')) {
        const error = new Error(message.error?.message || 'Request failed');
        /** @type {any} */ (error).code = message.error?.code;
        /** @type {any} */ (error).data = message.error?.data;
        entry.reject(error);
        return true;
    }
    entry.resolve(message ? message.result : null);
    return true;
}

function startTransport(onMessage) {
    let buffer = Buffer.alloc(0);
    let queue = Promise.resolve();

    process.stdin.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_LSP_FRAME_BYTES) {
            console.error(`Yamlink LSP — incoming frame exceeded ${MAX_LSP_FRAME_BYTES} bytes before a complete header was seen; dropping buffered data to avoid unbounded memory growth.`);
            buffer = Buffer.alloc(0);
            return;
        }
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;
            const header = buffer.slice(0, headerEnd).toString('ascii');
            const match  = /Content-Length:\s*(\d+)/i.exec(header);
            if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
            const len = parseInt(match[1], 10);
            if (len > MAX_LSP_FRAME_BYTES) {
                console.error(`Yamlink LSP — a frame declared Content-Length: ${len}, exceeding the ${MAX_LSP_FRAME_BYTES}-byte cap; dropping it rather than buffering it in full.`);
                buffer = buffer.slice(headerEnd + 4);
                continue;
            }
            if (buffer.length < headerEnd + 4 + len) break;
            const content = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
            buffer = buffer.slice(headerEnd + 4 + len);
            try {
                const message = JSON.parse(content);
                if (message && message.method == null && message.id !== undefined && message.id !== null) {
                    _settlePendingRequest(message);
                    continue;
                }
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

// A client that never responds to a server-initiated request (unsupported
// capability, dropped dialog, client-side bug) must not hang the request
// forever — the original JSON-RPC request that triggered it would otherwise
// never get a response either. Bounded, not indefinite.
const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.YAMLINK_LSP_REQUEST_TIMEOUT_MS) || 5000;

function request(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const id = nextRequestId--;
        const timer = setTimeout(() => {
            if (pendingRequests.delete(id)) {
                const error = new Error(`Request '${method}' timed out waiting for a client response after ${timeoutMs}ms`);
                /** @type {any} */ (error).code = -32001;
                reject(error);
            }
        }, timeoutMs);
        // Deliberately not unref()'d: this timer existing is exactly what
        // guarantees the original request gets a response even if stdin
        // closes or the process would otherwise have nothing else keeping
        // the event loop alive — the one scenario where the timeout matters
        // most. It's bounded (fires once, self-clears), never indefinite.
        pendingRequests.set(id, {
            resolve: (result) => { clearTimeout(timer); resolve(result); },
            reject: (err) => { clearTimeout(timer); reject(err); }
        });
        send({ jsonrpc: '2.0', id, method, params });
        if (bufferedResponses.has(id)) {
            const buffered = bufferedResponses.get(id);
            bufferedResponses.delete(id);
            _settlePendingRequest(buffered);
        }
    });
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
    request,
    log,
    logToClient,
    setResponseGuard
};
