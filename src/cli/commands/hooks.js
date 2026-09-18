'use strict';

const fmt = require('../format');
const { emitCliError, emitCliSuccess, emitText } = require('../io');
const {
    addHook,
    readHooks,
    removeHook,
    validateHookEvent,
    validateHookUrl
} = require('../../runtime/webhooks');

function run({ action, event, url, noteType, id, vaultPath, json, quiet }) {
    if (action === 'add') {
        const eventValidation = validateHookEvent(event);
        if (!eventValidation.ok) {
            emitCliError({ json, error: eventValidation.error, code: 'INVALID_PARAM', exitCode: 1 });
            return;
        }
        const urlValidation = validateHookUrl(url);
        if (!urlValidation.ok) {
            emitCliError({ json, error: urlValidation.error, code: 'INVALID_PARAM', exitCode: 1 });
            return;
        }
        const result = addHook(vaultPath, { event, url, noteType });
        if (!result.ok) {
            emitCliError({ json, error: result.error, code: 'INVALID_PARAM', exitCode: 1 });
            return;
        }
        if (json) {
            emitCliSuccess({ hook: result.hook });
            return;
        }
        if (!quiet) emitText(`Added hook ${result.hook.id} for ${result.hook.event}\n`);
        return;
    }

    if (action === 'list') {
        const hooks = readHooks(vaultPath);
        if (json) {
            emitCliSuccess({ hooks });
            return;
        }
        if (!hooks.length) {
            emitText('  (no hooks)\n');
            return;
        }
        const rows = hooks.map((hook) => ({
            id: hook.id,
            event: hook.event,
            type: hook.noteType || '',
            enabled: hook.enabled ? 'yes' : 'no',
            url: hook.url
        }));
        emitText((() => {
            const originalLog = console.log;
            let buffer = '';
            console.log = (...args) => { buffer += args.map((arg) => String(arg)).join(' ') + '\n'; };
            try {
                fmt.table(rows, [
                    { key: 'id', label: 'id' },
                    { key: 'event', label: 'event' },
                    { key: 'type', label: 'type' },
                    { key: 'enabled', label: 'enabled' },
                    { key: 'url', label: 'url' }
                ]);
            } finally {
                console.log = originalLog;
            }
            return buffer;
        })());
        return;
    }

    if (action === 'remove') {
        const result = removeHook(vaultPath, id);
        if (!result.ok) {
            emitCliError({ json, error: result.error, code: 'NOT_FOUND', exitCode: 1 });
            return;
        }
        if (json) {
            emitCliSuccess({ id: result.id });
            return;
        }
        if (!quiet) emitText(`Removed hook ${result.id}\n`);
        return;
    }

    emitCliError({
        json,
        error: 'Usage: yamlink hooks add <event> <url> [--type <type>] | yamlink hooks list | yamlink hooks remove <id>',
        code: 'USAGE',
        exitCode: 1
    });
}

module.exports = { run };
