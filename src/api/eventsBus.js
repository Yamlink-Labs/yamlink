'use strict';

const { getFieldsCache, getVaultGeneration } = require('../core/indexService');

function normalizeMutationEvent(event) {
    const id = event.noteId || event.id || '';
    return {
        type: String(event.type || 'event'),
        id,
        field: event.field ?? null,
        from: event.oldValue ?? null,
        to: event.newValue ?? null,
        timestamp: event.timestamp || new Date().toISOString(),
        source: event.source ?? null,
        cause: event.cause ?? null,
        sessionId: event.sessionId ?? null,
        ...(event.meta && typeof event.meta === 'object' ? { meta: event.meta } : {})
    };
}

function createEventBus() {
    const clients = new Set();
    const rebuildWaiters = new Set();
    let pendingChangedId = null;

    function passesFilters(payload, filters) {
        if (!filters) return true;
        if (payload.type === 'connected' || payload.type === 'rebuild') return true;

        if (payload.type === 'intelligence_changed') {
            if (filters.type && String(payload.type || '') !== filters.type) return false;
            if (filters.note) {
                const changedId = payload.changedId === null || payload.changedId === undefined
                    ? null
                    : String(payload.changedId);
                if (changedId !== null && changedId !== filters.note) return false;
            }
            return true;
        }

        const noteId = String(payload.id || payload.noteId || '');
        if (filters.note && noteId !== filters.note) return false;

        if (filters.type && String(payload.type || '') !== filters.type) return false;

        if (filters.noteType) {
            if (!noteId) return false;
            const noteFields = getFieldsCache().get(noteId) || {};
            const noteType = String(noteFields.type || '').toLowerCase();
            if (noteType !== filters.noteType) return false;
        }

        return true;
    }

    function emit(payload) {
        const message = JSON.stringify(payload);
        for (const client of clients) {
            try {
                if (!passesFilters(payload, client.filters)) continue;
                client.write(`data: ${message}\n\n`);
            } catch (_) {
                clients.delete(client);
            }
        }
    }

    function register(res, req, filters = null) {
        res.write(`data: ${JSON.stringify({ type: 'connected', generation: getVaultGeneration() })}\n\n`);
        const client = { write: res.write.bind(res), filters, res };
        clients.add(client);
        req.on('close', () => clients.delete(client));
    }

    function emitMutationEvents(events = []) {
        for (const event of events) {
            emit(normalizeMutationEvent(event));
        }
    }

    function emitRebuild(generation) {
        for (const waiter of [...rebuildWaiters]) {
            try {
                waiter(Number(generation || getVaultGeneration()));
            } catch (_) {}
        }
        rebuildWaiters.clear();
        emit({
            type: 'rebuild',
            generation: Number(generation || getVaultGeneration()),
            timestamp: new Date().toISOString(),
        });
        emit({
            type: 'intelligence_changed',
            generation: Number(generation || getVaultGeneration()),
            changedId: pendingChangedId,
            timestamp: new Date().toISOString()
        });
        pendingChangedId = null;
    }

    function waitForGeneration(targetGeneration, timeoutMs = 3000) {
        const target = Number(targetGeneration || 0);
        if (getVaultGeneration() >= target) return Promise.resolve(getVaultGeneration());
        return new Promise((resolve) => {
            let settled = false;
            let timeout = null;
            const listener = (generation) => {
                if (settled) return;
                if (generation < target) return;
                settled = true;
                rebuildWaiters.delete(listener);
                if (timeout) clearTimeout(timeout);
                resolve(generation);
            };
            rebuildWaiters.add(listener);
            timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                rebuildWaiters.delete(listener);
                resolve(getVaultGeneration());
            }, timeoutMs);
        });
    }

    function setPendingChangedId(changedId) {
        pendingChangedId = changedId === null || changedId === undefined ? null : String(changedId);
    }

    return {
        emit,
        emitRebuild,
        emitMutationEvents,
        register,
        waitForGeneration,
        setPendingChangedId
    };
}

module.exports = { createEventBus, normalizeMutationEvent };
