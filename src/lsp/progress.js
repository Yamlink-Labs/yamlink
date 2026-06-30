'use strict';

const { notify } = require('./transport');

function beginWorkDone(token, title, message, percentage) {
    if (token == null) return;
    notify('$/progress', {
        token,
        value: {
            kind: 'begin',
            title,
            cancellable: true,
            ...(message ? { message } : {}),
            ...(typeof percentage === 'number' ? { percentage } : {})
        }
    });
}

function reportWorkDone(token, message, percentage) {
    if (token == null) return;
    notify('$/progress', {
        token,
        value: {
            kind: 'report',
            ...(message ? { message } : {}),
            ...(typeof percentage === 'number' ? { percentage } : {})
        }
    });
}

function endWorkDone(token, message) {
    if (token == null) return;
    notify('$/progress', {
        token,
        value: {
            kind: 'end',
            ...(message ? { message } : {})
        }
    });
}

function reportPartialResult(token, value) {
    if (token == null) return;
    notify('$/progress', { token, value });
}

module.exports = {
    beginWorkDone,
    reportWorkDone,
    endWorkDone,
    reportPartialResult
};
