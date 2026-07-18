'use strict';

const { getVaultGeneration } = require('../core/indexService');

const API_VERSION = '1';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Yamlink-Source, X-Yamlink-Session-Id',
};

const ERROR_CODES = {
    BAD_REQUEST:        400,
    MISSING_PARAM:      400,
    INVALID_JSON:       400,
    INVALID_PARAM:      400,
    LIMIT_EXCEEDED:     400,
    NOT_FOUND:          404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT:           409,
    INTERNAL_ERROR:     500,
};

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
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (_) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
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
    coercePositiveInt,
    normaliseSearchValue
};
