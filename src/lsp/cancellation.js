'use strict';

class RequestCancelledError extends Error {
    constructor(id) {
        super('Request cancelled');
        this.name = 'RequestCancelledError';
        this.requestId = id;
    }
}

function isRequestCancelled(state, id) {
    if (id === undefined || id === null) return false;
    return !!(state && state.cancelledIds && state.cancelledIds.has(id));
}

async function cancellationCheckpoint(state, id) {
    if (isRequestCancelled(state, id)) {
        throw new RequestCancelledError(id);
    }
    await new Promise((resolve) => setImmediate(resolve));
    if (isRequestCancelled(state, id)) {
        throw new RequestCancelledError(id);
    }
}

module.exports = {
    RequestCancelledError,
    isRequestCancelled,
    cancellationCheckpoint
};
