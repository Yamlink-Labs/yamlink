'use strict';

const MAX_EVENTS = 1000;
let _events = [];

function appendMutationEvents(events = []) {
    for (const event of events) {
        if (!event || !event.type || !event.noteId) continue;
        _events.push({
            timestamp: event.timestamp || new Date().toISOString(),
            type: event.type,
            noteId: event.noteId,
            field: event.field ?? null,
            oldValue: event.oldValue ?? null,
            newValue: event.newValue ?? null
        });
    }
    if (_events.length > MAX_EVENTS) {
        _events = _events.slice(_events.length - MAX_EVENTS);
    }
}

function getMutationEvents(limit = MAX_EVENTS) {
    return _events.slice(Math.max(0, _events.length - limit));
}

function clearMutationEvents() {
    _events = [];
}

module.exports = {
    appendMutationEvents,
    getMutationEvents,
    clearMutationEvents
};
