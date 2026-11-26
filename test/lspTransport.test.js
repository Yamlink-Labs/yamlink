'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { startTransport } = require('../src/lsp/transport');

function frame(obj) {
    const json = JSON.stringify(obj);
    return Buffer.from(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`, 'utf8');
}

describe('LSP transport — frame size limit (real exploit reproduction)', () => {
    let originalConsoleError;
    let errorLines;

    afterEach(() => {
        if (originalConsoleError) console.error = originalConsoleError;
        originalConsoleError = null;
        // Remove the 'data' listener startTransport attached so subsequent
        // tests (and the real process) don't accumulate stale handlers on
        // the shared process.stdin object. startTransport also calls
        // process.stdin.resume(), which puts it into flowing mode and keeps
        // the event loop (and therefore this test process) alive
        // indefinitely on its own — pause() undoes that so the test runner
        // can exit normally once every test has finished.
        process.stdin.removeAllListeners('data');
        process.stdin.pause();
    });

    function captureConsoleError() {
        errorLines = [];
        originalConsoleError = console.error;
        console.error = (...args) => { errorLines.push(args.map(String).join(' ')); };
    }

    test('a stream of data with no complete header is capped, not buffered without limit', () => {
        captureConsoleError();
        const received = [];
        startTransport((message) => { received.push(message); });

        // Real, confirmed vulnerability this closes (external security
        // review): before this fix, every incoming chunk was concatenated
        // onto an internal buffer with no size check at all, whether or not
        // a complete `Content-Length` header had ever been seen — a
        // malformed or malicious stream that never sends a real frame would
        // grow that buffer without bound. 60 MiB of header-less junk,
        // deliberately over the 50 MiB cap.
        const junk = Buffer.alloc(60 * 1024 * 1024, 'x');
        process.stdin.emit('data', junk);

        assert.equal(received.length, 0, 'no message should have been parsed from pure junk');
        assert.ok(errorLines.some((line) => line.includes('exceeded') && line.includes('bytes')), 'must log that the cap was hit, not silently swallow it');
    });

    test('a frame whose declared Content-Length exceeds the cap is dropped, not buffered in full', () => {
        captureConsoleError();
        const received = [];
        startTransport((message) => { received.push(message); });

        // A header declaring an oversized length, with only a small amount
        // of real body data following — proves the check fires on the
        // declared length itself, not only after the full oversized body
        // has actually arrived (which would defeat the whole point of a
        // cap: the memory growth already happened by the time that much
        // data arrived).
        const oversizedLen = 100 * 1024 * 1024;
        const header = Buffer.from(`Content-Length: ${oversizedLen}\r\n\r\n`, 'utf8');
        process.stdin.emit('data', header);
        process.stdin.emit('data', Buffer.from('{"partial":true}', 'utf8'));

        assert.equal(received.length, 0);
        assert.ok(errorLines.some((line) => line.includes('declared Content-Length') && line.includes(String(oversizedLen))));
    });

    // onMessage is invoked via a Promise chain (`queue = queue.then(...)`),
    // not synchronously inside the 'data' handler — a real frame's message
    // only shows up in `received` after the microtask queue flushes.
    function flushMicrotasks() {
        return new Promise((resolve) => setImmediate(resolve));
    }

    test('a real, ordinary frame still parses correctly — the cap does not break normal traffic', async () => {
        const received = [];
        startTransport((message) => { received.push(message); });

        process.stdin.emit('data', frame({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }));
        await flushMicrotasks();

        assert.equal(received.length, 1);
        assert.equal(received[0].method, 'initialize');
    });

    test('a real frame right at the boundary still works, and a second frame after a capped one recovers cleanly', async () => {
        captureConsoleError();
        const received = [];
        startTransport((message) => { received.push(message); });

        // First, trigger the cap with bad data...
        process.stdin.emit('data', Buffer.alloc(60 * 1024 * 1024, 'x'));
        await flushMicrotasks();
        assert.equal(received.length, 0);

        // ...then confirm the transport is still usable afterward, not wedged.
        process.stdin.emit('data', frame({ jsonrpc: '2.0', method: 'shutdown', id: 2, params: {} }));
        await flushMicrotasks();
        assert.equal(received.length, 1);
        assert.equal(received[0].method, 'shutdown');
    });
});
