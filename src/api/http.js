'use strict';

const { getVaultGeneration } = require('../core/indexService');

const API_VERSION = '1';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Yamlink-Source, X-Yamlink-Session-Id, X-Yamlink-Token',
};

const ERROR_CODES = {
    BAD_REQUEST:        400,
    MISSING_PARAM:      400,
    INVALID_JSON:       400,
    INVALID_PARAM:      400,
    LIMIT_EXCEEDED:     400,
    UNAUTHORIZED:       401,
    NOT_FOUND:          404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT:           409,
    PAYLOAD_TOO_LARGE:  413,
    INTERNAL_ERROR:     500,
};

// Unbounded before this fix: readBody concatenated every chunk with no cap at
// all, so a single request with an arbitrarily large body would be buffered
// in full before JSON.parse ever ran, letting one request exhaust process
// memory. 25 MiB is generous for the largest realistic legitimate body (a
// big POST /api/nodes/bulk batch) while still being a finite, enforced limit.
const MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024;

function json(res, data, status = 200) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type':         'application/json',
        'X-Yamlink-Generation': String(getVaultGeneration()),
        'X-Yamlink-Api-Version': API_VERSION,
        ...CORS_HEADERS,
    });
    res.end(body);
}

function errorJson(res, statusOrCode, message, extra = {}) {
    let status = statusOrCode;
    let code = extra.code;

    if (typeof statusOrCode === 'string') {
        code = statusOrCode;
        status = ERROR_CODES[code] || 500;
    }

    json(res, { error: message, code: code || 'INTERNAL_ERROR', ...extra }, status);
}

function notFound(res, message = 'Not found') {
    errorJson(res, 'NOT_FOUND', message);
}

function badRequest(res, message, code = 'BAD_REQUEST') {
    errorJson(res, code, message);
}

function methodNotAllowed(res) {
    errorJson(res, 'METHOD_NOT_ALLOWED', 'Method not allowed');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let settled = false;

        req.on('data', (chunk) => {
            if (settled) return;
            totalBytes += chunk.length;
            if (totalBytes > MAX_REQUEST_BODY_BYTES) {
                settled = true;
                // Deliberately NOT req.destroy() here: that tears down the
                // whole duplex socket immediately, including the write side
                // this same connection needs to actually deliver the 413
                // response — confirmed by direct testing, where destroying
                // the request mid-upload raced the client's still-in-flight
                // write and surfaced as a raw ECONNRESET instead of a clean
                // error response. Dropping subsequent chunks (the `settled`
                // guard at the top of this handler) already stops the
                // unbounded memory growth; the remaining bytes simply drain
                // off the socket normally while the caller sends back a
                // proper 413.
                /** @type {Error & { code?: string }} */
                const err = new Error('Request body too large');
                err.code = 'PAYLOAD_TOO_LARGE';
                reject(err);
                return;
            }
            // Buffer chunks, not string concatenation: `data += chunk`
            // coerces each Buffer via its own default toString('utf8'),
            // which corrupts a multi-byte UTF-8 character that happens to
            // be split across a TCP chunk boundary. Buffer.concat first,
            // decode once at the end, is correct regardless of where chunk
            // boundaries land.
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            settled = true;
            try {
                const data = Buffer.concat(chunks).toString('utf8');
                resolve(data ? JSON.parse(data) : {});
            } catch (_) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
        });
    });
}

async function parseJsonBody(req, res) {
    try {
        return await readBody(req);
    } catch (err) {
        if (err && err.code === 'PAYLOAD_TOO_LARGE') {
            errorJson(res, 'PAYLOAD_TOO_LARGE', 'Request body too large');
            return null;
        }
        badRequest(res, 'Invalid JSON body', 'INVALID_JSON');
        return null;
    }
}

function hasRequiredValue(body, fieldName) {
    if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, fieldName)) return false;
    const value = body[fieldName];
    // Matches the falsy-check the pre-refactor call sites used (e.g.
    // `String(body.type || '').trim()`), not just a null/undefined check —
    // `false`, `0`, and `NaN` must count as missing the same way an absent
    // field does, or a caller sending `{"type": false}` slips past this
    // check and reaches a write path (writeNoteFile) that has no validation
    // of its own, silently creating a note with an empty `type:`.
    if (!value) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return true;
}

function requireFields(body, res, fieldNames) {
    for (const fieldName of fieldNames || []) {
        if (!hasRequiredValue(body, fieldName)) {
            badRequest(res, 'Missing param: ' + fieldName, 'MISSING_PARAM');
            return false;
        }
    }
    return true;
}

function coercePositiveInt(value, fallback, minimum = 0) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, parsed);
}

function normaliseSearchValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}

module.exports = {
    API_VERSION,
    CORS_HEADERS,
    json,
    errorJson,
    notFound,
    badRequest,
    methodNotAllowed,
    readBody,
    parseJsonBody,
    requireFields,
    coercePositiveInt,
    normaliseSearchValue
};
