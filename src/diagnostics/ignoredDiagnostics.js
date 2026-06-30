'use strict';

const STORAGE_KEY = 'yamlink.ignoredFrontmatterDiagnostics';

let workspaceState = null;
let ignoredKeys = new Set();

function normalizeFsPath(fsPath) {
    return String(fsPath || '').replace(/\//g, '\\').toLowerCase();
}

function getDiagnosticCode(diagnostic) {
    return /** @type {any} */ (diagnostic?.code)?.value ?? diagnostic?.code ?? '';
}

function buildIgnoredDiagnosticKey(document, diagnostic) {
    if (!document?.uri?.fsPath || !diagnostic?.range) return null;
    const code = String(getDiagnosticCode(diagnostic) || '').trim();
    if (!code) return null;
    const start = diagnostic.range.start || { line: 0, character: 0 };
    const end = diagnostic.range.end || start;
    const message = String(diagnostic.message || '').trim();
    return [
        normalizeFsPath(document.uri.fsPath),
        code,
        `${start.line}:${start.character}-${end.line}:${end.character}`,
        message
    ].join('::');
}

function initializeIgnoredDiagnostics(context) {
    workspaceState = context?.workspaceState || null;
    const stored = workspaceState?.get?.(STORAGE_KEY, []) || [];
    ignoredKeys = new Set(Array.isArray(stored) ? stored : []);
}

async function persistIgnoredDiagnostics() {
    if (!workspaceState?.update) return;
    await workspaceState.update(STORAGE_KEY, [...ignoredKeys]);
}

function isDiagnosticIgnored(document, diagnostic) {
    const key = buildIgnoredDiagnosticKey(document, diagnostic);
    return Boolean(key && ignoredKeys.has(key));
}

async function ignoreDiagnostic(document, diagnostic) {
    const key = buildIgnoredDiagnosticKey(document, diagnostic);
    if (!key) return false;
    ignoredKeys.add(key);
    await persistIgnoredDiagnostics();
    return true;
}

module.exports = {
    initializeIgnoredDiagnostics,
    isDiagnosticIgnored,
    ignoreDiagnostic,
    buildIgnoredDiagnosticKey
};
