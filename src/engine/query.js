'use strict';

// Thin re-export shim — all callers import from this module unchanged.
// Parser logic lives in queryParser.js; execution logic in queryExecutor.js.

const {
    parseSingleViewLine,
    parseSingleViewBlock,
    parseAllViewQueries,
    parseViewQuery,
    buildQueryString
} = require('./queryParser');

const { runQuery, clearBodyCache } = require('./queryExecutor');

module.exports = {
    parseSingleViewLine,
    parseSingleViewBlock,
    parseAllViewQueries,
    parseViewQuery,
    buildQueryString,
    runQuery,
    clearBodyCache
};
