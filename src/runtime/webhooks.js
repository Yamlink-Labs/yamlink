'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { MUTATION_EVENT_TYPES, isKnownMutationEventType } = require('./mutationEventTypes');
const { getMutationEvents } = require('./mutationEventLog');
const { postJsonWebhook } = require('./webhookHttp');

const WEBHOOKS_FILE = 'webhooks.json';

function getHooksPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', WEBHOOKS_FILE);
}

function normalizeEvent(event) {
    return String(event || '').trim();
}

function normalizeNoteType(noteType) {
    const value = String(noteType || '').trim().toLowerCase();
    return value || null;
}

function validateHookUrl(url) {
    const value = String(url || '').trim();
    if (!value) return { ok: false, error: 'Missing param: url' };
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { ok: false, error: 'Webhook URL must use http or https' };
        }
    } catch (_) {
        return { ok: false, error: 'Invalid webhook URL' };
    }
    return { ok: true, url: value };
}

function validateHookEvent(event) {
    const value = normalizeEvent(event);
    if (!value) return { ok: false, error: 'Missing param: event' };
    if (!isKnownMutationEventType(value)) {
        return { ok: false, error: 'Invalid event: ' + value };
    }
    return { ok: true, event: value };
}

function validateHookInput(input = {}) {
    const url = validateHookUrl(input.url);
    if (!url.ok) return { ok: false, field: 'url', error: url.error };
    const event = validateHookEvent(input.event);
    if (!event.ok) return { ok: false, field: 'event', error: event.error };
    return {
        ok: true,
        url: url.url,
        event: event.event,
        noteType: normalizeNoteType(input.noteType)
    };
}

function readHooks(vaultPath) {
    const filePath = getHooksPath(vaultPath);
    if (!fs.existsSync(filePath)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((hook) => hook && typeof hook === 'object')
            .map((hook) => ({
                id: String(hook.id || ''),
                url: String(hook.url || ''),
                event: normalizeEvent(hook.event),
                noteType: normalizeNoteType(hook.noteType),
                createdAt: String(hook.createdAt || ''),
                enabled: hook.enabled !== false
            }))
            .filter((hook) => hook.id && hook.url && hook.event);
    } catch (_) {
        return [];
    }
}

function writeHooks(vaultPath, hooks) {
    const filePath = getHooksPath(vaultPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(hooks || [], null, 2) + '\n', 'utf8');
}

function makeHookId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const nonce = Math.random().toString(36).slice(2, 8);
    return `hook-${stamp}-${nonce}`;
}

function addHook(vaultPath, input) {
    const validation = validateHookInput(input);
    if (!validation.ok) return validation;
    const hooks = readHooks(vaultPath);
    const hook = {
        id: makeHookId(),
        url: validation.url,
        event: validation.event,
        noteType: validation.noteType,
        createdAt: new Date().toISOString(),
        enabled: true
    };
    hooks.push(hook);
    writeHooks(vaultPath, hooks);
    return { ok: true, hook };
}

function removeHook(vaultPath, id) {
    const targetId = String(id || '').trim();
    const hooks = readHooks(vaultPath);
    const next = hooks.filter((hook) => hook.id !== targetId);
    if (next.length === hooks.length) return { ok: false, error: 'Hook not found: ' + targetId };
    writeHooks(vaultPath, next);
    return { ok: true, id: targetId };
}

function patchHook(vaultPath, id, patch = {}) {
    const targetId = String(id || '').trim();
    const hooks = readHooks(vaultPath);
    const hook = hooks.find((entry) => entry.id === targetId);
    if (!hook) return { ok: false, error: 'Hook not found: ' + targetId };
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
        hook.enabled = !!patch.enabled;
    }
    writeHooks(vaultPath, hooks);
    return { ok: true, hook };
}

function matchHook(hook, event) {
    if (!hook || hook.enabled === false || !event) return false;
    if (hook.event !== event.type) return false;
    if (hook.noteType && normalizeNoteType(event.noteType) !== hook.noteType) return false;
    return true;
}

function buildWebhookPayload(event) {
    return {
        event: String(event.type || ''),
        noteId: String(event.noteId || ''),
        noteType: String(event.noteType || ''),
        field: String(event.field || ''),
        newValue: event.newValue == null ? '' : String(event.newValue),
        timestamp: String(event.timestamp || '')
    };
}

function enrichEventNoteType(event, vaultService) {
    if (!event || event.noteType || !vaultService || typeof vaultService.getIndex !== 'function') return event;
    const state = vaultService.getIndex();
    const fields = state && state.fieldsCache && state.fieldsCache.get ? state.fieldsCache.get(event.noteId) : null;
    const noteType = fields && fields.type ? String(fields.type) : '';
    return noteType ? { ...event, noteType } : event;
}

function getEventsSince(timestamp) {
    return getMutationEvents({ since: timestamp || undefined, limit: 10000 })
        .filter((event) => !timestamp || String(event.timestamp || '') > timestamp)
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

function getLatestMutationTimestamp() {
    const events = getMutationEvents({ limit: 1 });
    return events.length ? String(events[events.length - 1].timestamp || '') : new Date().toISOString();
}

/**
 * @param {{ vaultPath?: string, vaultService?: { onRebuild?: Function, getIndex?: Function }, logger?: { warn?: Function } }} [options]
 * @returns {() => void}
 */
function createWebhookDispatcher({ vaultPath, vaultService, logger = console } = {}) {
    if (!vaultPath || !vaultService || typeof vaultService.onRebuild !== 'function') {
        return () => {};
    }
    let lastTimestamp = getLatestMutationTimestamp();
    let running = Promise.resolve();

    const unsubscribe = vaultService.onRebuild(() => {
        running = running.then(async () => {
            const events = getEventsSince(lastTimestamp);
            if (!events.length) {
                lastTimestamp = new Date().toISOString();
                return;
            }
            const hooks = readHooks(vaultPath).filter((hook) => hook.enabled !== false);
            for (const rawEvent of events) {
                const event = enrichEventNoteType(rawEvent, vaultService);
                const payload = buildWebhookPayload(event);
                for (const hook of hooks) {
                    if (!matchHook(hook, event)) continue;
                    const result = await postJsonWebhook(hook.url, payload);
                    if (!result.ok && logger && typeof logger.warn === 'function') {
                        logger.warn(`Yamlink webhook ${hook.id} failed: ${result.error || 'unknown error'}`);
                    }
                }
            }
            lastTimestamp = String(events[events.length - 1].timestamp || new Date().toISOString());
        }).catch((error) => {
            if (logger && typeof logger.warn === 'function') {
                logger.warn('Yamlink webhook dispatch failed: ' + (error && error.message ? error.message : String(error)));
            }
        });
    });

    return unsubscribe;
}

function listKnownEvents() {
    return [...MUTATION_EVENT_TYPES.keys()];
}

module.exports = {
    addHook,
    removeHook,
    patchHook,
    readHooks,
    writeHooks,
    validateHookInput,
    validateHookEvent,
    validateHookUrl,
    matchHook,
    buildWebhookPayload,
    createWebhookDispatcher,
    listKnownEvents
};
