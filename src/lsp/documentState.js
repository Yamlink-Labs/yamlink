'use strict';

const { readTextFileSafe, uriToPath } = require('./utils');

const CONTENT_MODIFIED = -32801;

function getDocumentVersion(state, uri) {
    if (!state || !uri || !state.openDocVersions || !state.openDocVersions.has(uri)) return null;
    return state.openDocVersions.get(uri);
}

function getRequestedVersion(value) {
    return Number.isFinite(value) ? value : null;
}

function isStaleDocumentRequest(state, uri, requestedVersion) {
    const expectedVersion = getRequestedVersion(requestedVersion);
    if (expectedVersion == null) return false;
    const currentVersion = getDocumentVersion(state, uri);
    if (currentVersion == null) return false;
    return currentVersion !== expectedVersion;
}

function getDocumentText(state, uri) {
    if (!uri) return '';
    if (state?.openDocs?.has(uri)) {
        return state.openDocs.get(uri) || '';
    }
    const filePath = state?.uriToPath ? state.uriToPath(uri) : uriToPath(uri);
    return readTextFileSafe(filePath) || '';
}

module.exports = {
    CONTENT_MODIFIED,
    getDocumentVersion,
    isStaleDocumentRequest,
    getDocumentText
};
