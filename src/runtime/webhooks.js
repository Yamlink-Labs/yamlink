'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const { MUTATION_EVENT_TYPES, isKnownMutationEventType } = require('./mutationEventTypes');
const { getMutationEvents } = require('./mutationEventLog');
const { postJsonWebhook } = require('./webhookHttp');
const { isLiteralIpBlocked, coerceAllowLocal } = require('./ssrfGuard');
const { ensureContainedDir } = require('../core/pathSafety');

const WEBHOOKS_FILE = 'webhooks.json';
const WEBHOOKS_ORIGIN_FILE = 'webhooks-origin.json';

function getHooksPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', WEBHOOKS_FILE);
}

function getWebhooksOriginPath(vaultPath) {
    return path.join(vaultPath, '.yamlink', WEBHOOKS_ORIGIN_FILE);
}

/**
 * Records, the first time this function is ever called for a vault, whether
 * `webhooks.json` already existed with real entries (`'inherited'`) or not
 * (`'native'`) — then returns that same answer on every later call, idempotent.
 *
 * Why this exists: a webhook silently forwards real vault data to an external
 * URL the moment something starts dispatching events (`yamlink serve` /
 * Conduit's auto-started server). A vault opened directly rather than created
 * by hand — downloaded, cloned, handed over by someone else — can already
 * contain a `webhooks.json` nobody using this install ever configured, and
 * until now that was indistinguishable from a hook the current user added
 * themselves. The distinction only needs to be captured once, at the exact
 * moment this install first touches the vault's webhook config: if
 * `webhooks.json` is already there with entries at that moment, it must have
 * arrived with the vault, not been typed in through `addHook`. Called from
 * both `addHook()` (so a vault with no hooks yet is marked `'native'` the
 * instant the user adds their own first one, before any dispatcher has even
 * started) and `createWebhookDispatcher()`'s startup (so a vault whose hooks
 * were never touched via `addHook` at all — just opened and immediately
 * served — still gets classified correctly).
 * @param {string} vaultPath
 * @returns {{ origin: 'native'|'inherited', firstSeenAt: string }}
 */
function ensureWebhooksOriginMarker(vaultPath) {
    const markerPath = getWebhooksOriginPath(vaultPath);
    try {
        const existing = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        if (existing && (existing.origin === 'native' || existing.origin === 'inherited')) return existing;
    } catch (_) { /* no marker yet — determine and write one below */ }

    const existingHooks = readHooks(vaultPath);
    /** @type {{ origin: 'native'|'inherited', firstSeenAt: string }} */
    const marker = {
        origin: existingHooks.length > 0 ? 'inherited' : 'native',
        firstSeenAt: new Date().toISOString()
    };
    try {
        ensureContainedDir(path.dirname(markerPath), vaultPath);
        const temporary = path.join(path.dirname(markerPath), `.${WEBHOOKS_ORIGIN_FILE}.${crypto.randomBytes(8).toString('hex')}.tmp`);
        try {
            fs.writeFileSync(temporary, JSON.stringify(marker, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
            fs.renameSync(temporary, markerPath);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    } catch (_) { /* best-effort — a failure here just means this gets re-derived (and re-written) next call */ }
    return marker;
}

/**
 * The actual caution check: are there webhooks right now, in a vault whose
 * very first contact with this install already had them present? Requiring
 * `enabled` hooks to still exist means the warning naturally stops once the
 * user reviews and removes (or disables) the inherited ones — no separate
 * "acknowledged" bookkeeping needed.
 * @param {string} vaultPath
 * @returns {{ inherited: boolean, hooks: Array<object> }}
 */
function checkInheritedWebhooks(vaultPath) {
    const marker = ensureWebhooksOriginMarker(vaultPath);
    if (marker.origin !== 'inherited') return { inherited: false, hooks: [] };
    const hooks = readHooks(vaultPath).filter((hook) => hook.enabled !== false);
    return { inherited: hooks.length > 0, hooks };
}

function normalizeEvent(event) {
    return String(event || '').trim();
}

function normalizeNoteType(noteType) {
    const value = String(noteType || '').trim().toLowerCase();
    return value || null;
}

/**
 * Fast, synchronous rejection of the obvious cases (an IP literal, or the
 * `localhost` name) so a bad webhook URL gets immediate feedback at
 * registration time. This is a convenience, not the real defense — a
 * hostname that resolves to a private address can't be caught here without
 * an async DNS lookup, and a hostname validated here could still be
 * re-pointed via DNS rebinding before the webhook ever actually fires. The
 * authoritative checks are `ssrfGuard.isLiteralIpBlocked` (for an IP literal
 * — the one Node's own `lookup` hook can never cover, since there's nothing
 * to resolve) and `ssrfGuard.safeLookup` (for a hostname, including
 * DNS-rebinding protection), both applied again at actual delivery time in
 * `webhookHttp.js`, which covers every case including ones already
 * persisted to `.yamlink/webhooks.json` before this fix shipped.
 *
 * `allowLocal` is a deliberate, explicit per-hook opt-in (never a default) —
 * see `src/runtime/ssrfGuard.js`'s module header for why loopback
 * specifically, and only loopback, is eligible to be re-admitted this way.
 * @param {string} url
 * @param {{ allowLocal?: boolean }} [options]
 */
function validateHookUrl(url, options = {}) {
    const allowLocal = coerceAllowLocal(options.allowLocal);
    const value = String(url || '').trim();
    if (!value) return { ok: false, error: 'Missing param: url' };
    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        return { ok: false, error: 'Invalid webhook URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Webhook URL must use http or https' };
    }
    const hostname = parsed.hostname.toLowerCase();
    const isLocalhostName = hostname === 'localhost' || hostname === '0.0.0.0' || hostname.endsWith('.localhost');
    if (isLocalhostName && !allowLocal) {
        return { ok: false, error: 'Webhook URL must not point to a local/internal address (pass --allow-local to allow your own machine)' };
    }
    if (isLiteralIpBlocked(hostname, { allowLocal })) {
        return { ok: false, error: 'Webhook URL must not point to a local/internal address (pass --allow-local to allow your own machine)' };
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
    const allowLocal = coerceAllowLocal(input.allowLocal);
    const url = validateHookUrl(input.url, { allowLocal });
    if (!url.ok) return { ok: false, field: 'url', error: url.error };
    const event = validateHookEvent(input.event);
    if (!event.ok) return { ok: false, field: 'event', error: event.error };
    return {
        ok: true,
        url: url.url,
        event: event.event,
        noteType: normalizeNoteType(input.noteType),
        allowLocal
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
                enabled: hook.enabled !== false,
                allowLocal: coerceAllowLocal(hook.allowLocal)
            }))
            .filter((hook) => hook.id && hook.url && hook.event);
    } catch (_) {
        return [];
    }
}

function writeHooks(vaultPath, hooks) {
    const filePath = getHooksPath(vaultPath);
    // Real, confirmed vulnerabilities this closes (external security review,
    // independently reproduced), the same two classes already fixed for the
    // API token / mutation log / vault .gitignore: (1) a plain
    // `fs.mkdirSync(..., { recursive: true })` is a silent no-op if
    // `.yamlink` already exists — including as a symlink or directory
    // junction planted there before the vault was ever opened, redirecting
    // this write outside the vault entirely; ensureContainedDir() verifies
    // containment via realpath and throws instead. (2) writing straight to
    // `filePath` with a plain fs.writeFileSync opens and truncates whatever
    // inode is already there — if webhooks.json is a hardlink to some other
    // real file (planted the same way), the write would silently corrupt
    // that file. Writing to a new, randomly-named temp file and renaming it
    // into place replaces the directory entry atomically instead, leaving
    // whatever inode was previously there untouched either way.
    ensureContainedDir(path.dirname(filePath), vaultPath);
    const temporary = path.join(path.dirname(filePath), `.${WEBHOOKS_FILE}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(temporary, JSON.stringify(hooks || [], null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporary, filePath);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function makeHookId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const nonce = Math.random().toString(36).slice(2, 8);
    return `hook-${stamp}-${nonce}`;
}

// writeHooks() now throws (via ensureContainedDir) when `.yamlink` turns out
// to be a symlink/junction redirecting outside the vault — deliberately,
// since this is an explicit user action, not an opportunistic background
// write, and failing loudly is correct. But neither the CLI (src/cli/
// commands/hooks.js, a plain synchronous function with no top-level catch)
// nor the API (src/api/router.js's handleRequest has no catch-all either,
// confirmed by reading it) would turn an uncaught throw here into a clean
// error response — the CLI would crash and the API request would simply
// hang. Caught here instead, at the one shared choke point, and turned into
// the same { ok: false, error } shape every other validation failure in this
// file already returns, so callers don't need their own handling.
function writeHooksSafely(vaultPath, hooks) {
    try {
        writeHooks(vaultPath, hooks);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message || 'Failed to write webhook configuration' };
    }
}

function addHook(vaultPath, input) {
    const validation = validateHookInput(input);
    if (!validation.ok) return validation;
    // Snapshot the origin marker before this add changes webhooks.json's
    // contents — see ensureWebhooksOriginMarker's doc comment. This is what
    // correctly marks a vault 'native' the instant its first-ever hook is
    // added through this function, before any pre-existing-entries check
    // could otherwise misread it as inherited.
    ensureWebhooksOriginMarker(vaultPath);
    const hooks = readHooks(vaultPath);
    const hook = {
        id: makeHookId(),
        url: validation.url,
        event: validation.event,
        noteType: validation.noteType,
        createdAt: new Date().toISOString(),
        enabled: true,
        allowLocal: validation.allowLocal
    };
    hooks.push(hook);
    const written = writeHooksSafely(vaultPath, hooks);
    if (!written.ok) return written;
    return { ok: true, hook };
}

function removeHook(vaultPath, id) {
    const targetId = String(id || '').trim();
    const hooks = readHooks(vaultPath);
    const next = hooks.filter((hook) => hook.id !== targetId);
    if (next.length === hooks.length) return { ok: false, error: 'Hook not found: ' + targetId };
    const written = writeHooksSafely(vaultPath, next);
    if (!written.ok) return written;
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
    const written = writeHooksSafely(vaultPath, hooks);
    if (!written.ok) return written;
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

    // Caution banner, built in deliberately (not a bug fix): the first time
    // this install ever starts dispatching webhooks for this vault, warn if
    // any enabled hook was already sitting in webhooks.json before this
    // install ever touched it — a vault opened directly (downloaded, cloned,
    // handed over) rather than configured by hand here. Printed every start,
    // the same way the API token itself is re-announced on every start,
    // deliberately not a one-time dismissal — and it naturally stops once
    // the user reviews and removes/disables the inherited hooks, since the
    // check requires at least one still being enabled.
    const inheritedCheck = checkInheritedWebhooks(vaultPath);
    if (inheritedCheck.inherited && logger && typeof logger.warn === 'function') {
        const urls = inheritedCheck.hooks.map((hook) => `  - ${hook.id}: ${hook.url}`).join('\n');
        logger.warn(
            `Yamlink: this vault already had ${inheritedCheck.hooks.length} webhook(s) configured before this install ever opened it — review them before trusting this vault:\n${urls}\nRemove one with: yamlink hooks remove <id>`
        );
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
                    const result = await postJsonWebhook(hook.url, payload, { allowLocal: hook.allowLocal });
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
    listKnownEvents,
    ensureWebhooksOriginMarker,
    checkInheritedWebhooks
};
