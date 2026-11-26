'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { readBody, parseJsonBody } = require('../src/api/http');

/**
 * Minimal real-enough stand-in for an IncomingMessage: a real Readable
 * stream, so chunking/backpressure/'data'/'end'/`.destroyed` semantics are
 * the genuine Node stream ones, not reimplemented.
 * @param {Buffer[]} chunks
 */
function fakeRequest(chunks) {
    return new Readable({
        read() {
            for (const chunk of chunks) this.push(chunk);
            this.push(null);
        }
    });
}

describe('http — readBody', () => {
    test('parses a normal small JSON body', async () => {
        const req = fakeRequest([Buffer.from(JSON.stringify({ hello: 'world' }))]);
        const body = await readBody(req);
        assert.deepEqual(body, { hello: 'world' });
    });

    test('an empty body resolves to {}', async () => {
        const req = fakeRequest([]);
        const body = await readBody(req);
        assert.deepEqual(body, {});
    });

    test('invalid JSON rejects with a plain error, not a PAYLOAD_TOO_LARGE one', async () => {
        const req = fakeRequest([Buffer.from('{not valid json')]);
        await assert.rejects(() => readBody(req), (err) => {
            assert.notEqual(err.code, 'PAYLOAD_TOO_LARGE');
            return true;
        });
    });

    test('a multi-byte UTF-8 character split across two chunks decodes correctly', async () => {
        // "日" (U+65E5) is 3 bytes in UTF-8 (e6 97 a5). Splitting the payload
        // between those bytes reproduces the exact corruption the old
        // `data += chunk` string-concatenation approach was vulnerable to —
        // each chunk's own Buffer#toString('utf8') call replaces an
        // incomplete multi-byte sequence with U+FFFD before the pieces are
        // ever rejoined, so the test would catch a regression back to that
        // pattern even though it isn't the size-limit fix on its own.
        const payload = Buffer.from(JSON.stringify({ label: '日本語' }), 'utf8');
        const splitPoint = payload.indexOf(0xe6) + 1; // land inside the first multi-byte char
        const req = fakeRequest([payload.subarray(0, splitPoint), payload.subarray(splitPoint)]);
        const body = await readBody(req);
        assert.deepEqual(body, { label: '日本語' });
    });

    test('real, confirmed vulnerability reproduction: an oversized body is refused instead of being buffered in full', async () => {
        // Deliberately a size the old, unbounded implementation would have
        // buffered in full with no complaint at all — proves the fix, not
        // just the cap's existence.
        const oversized = Buffer.alloc(26 * 1024 * 1024, 'a'); // 26 MiB > the 25 MiB cap
        const req = fakeRequest([oversized]);
        await assert.rejects(() => readBody(req), (err) => {
            assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
            return true;
        });
        // An earlier version of this fix called req.destroy() on hitting the
        // cap, which turned out to be a real bug (found by direct end-to-end
        // testing against a real server, not assumed): destroying the
        // request mid-upload tears down the whole duplex socket, including
        // the write side the same connection needs to actually deliver a 413
        // response back, surfacing as a raw ECONNRESET on the client instead
        // of a clean error. Simply dropping further chunks (no explicit
        // destroy) is what fixes the unbounded-memory issue without
        // breaking the response path — see the real HTTP-level test in
        // surface.api.test.js that proves the client actually gets a clean
        // 413.
    });

    test('a body exactly at the cap is still accepted — the limit is a ceiling, not an off-by-one trap', async () => {
        const atCap = Buffer.from(JSON.stringify({ padding: 'x'.repeat(1000) }));
        const req = fakeRequest([atCap]);
        const body = await readBody(req);
        assert.equal(body.padding.length, 1000);
    });
});

describe('http — parseJsonBody', () => {
    function fakeRes() {
        const res = { statusCode: null, headers: null, body: null };
        res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
        res.end = (body) => { res.body = body; };
        return res;
    }

    test('an oversized body produces a 413 PAYLOAD_TOO_LARGE response, not a 400', async () => {
        const oversized = Buffer.alloc(26 * 1024 * 1024, 'a');
        const req = fakeRequest([oversized]);
        const res = fakeRes();
        const result = await parseJsonBody(req, res);
        assert.equal(result, null);
        assert.equal(res.statusCode, 413);
        const parsed = JSON.parse(res.body);
        assert.equal(parsed.code, 'PAYLOAD_TOO_LARGE');
    });

    test('invalid JSON still produces the existing 400 INVALID_JSON response', async () => {
        const req = fakeRequest([Buffer.from('not json at all')]);
        const res = fakeRes();
        const result = await parseJsonBody(req, res);
        assert.equal(result, null);
        assert.equal(res.statusCode, 400);
        const parsed = JSON.parse(res.body);
        assert.equal(parsed.code, 'INVALID_JSON');
    });
});
