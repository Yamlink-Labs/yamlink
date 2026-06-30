'use strict';

const vscode = require('vscode');

const DEFAULT_IDLE_MS = 20 * 60 * 1000;

function buildSessionId(now = new Date()) {
    const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const nonce = Math.random().toString(36).slice(2, 8);
    return `vs-${stamp}-${nonce}`;
}

function createMutationSessionRuntime(context, options = {}) {
    const idleMs = Math.max(60_000, Number(options.idleMs) || DEFAULT_IDLE_MS);
    let currentSessionId = null;
    let lastTouchedAt = 0;
    let lastReason = 'activate';

    function ensureSession(reason = 'activity') {
        const now = Date.now();
        if (!currentSessionId || (now - lastTouchedAt) > idleMs) {
            currentSessionId = buildSessionId(new Date(now));
        }
        lastTouchedAt = now;
        lastReason = reason || lastReason || 'activity';
        return currentSessionId;
    }

    function touch(reason = 'activity') {
        return ensureSession(reason);
    }

    function getContext() {
        return {
            sessionId: ensureSession('mutation'),
            meta: {
                sessionReason: lastReason
            }
        };
    }

    touch('activate');

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            touch('editor_focus');
        }),
        vscode.window.onDidChangeWindowState((state) => {
            touch(state?.focused ? 'window_focus' : 'window_blur');
        }),
        {
            dispose() {
                currentSessionId = null;
                lastTouchedAt = 0;
                lastReason = 'disposed';
            }
        }
    );

    return {
        touch,
        getContext
    };
}

module.exports = {
    DEFAULT_IDLE_MS,
    buildSessionId,
    createMutationSessionRuntime
};
