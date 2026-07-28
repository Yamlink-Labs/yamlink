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

// Shared between diagnostics.js (which builds the real Diagnostic) and
// decorations.js (which needs to check ignore state for the exact same
// range without constructing a real vscode.Diagnostic) — both must derive
// identical code/message for a given id, or the ignore key built from each
// side will never match and "ignore this suggestion" will silently fail to
// un-mute the decoration.
function describeBrokenLink(id, isInFrontmatter) {
    return {
        code: isInFrontmatter ? 'yamlink.brokenRelation' : 'yamlink.brokenLink',
        message: isInFrontmatter
            ? `Yamlink: Relation "${id}" does not exist.`
            : `Yamlink: ID "${id}" does not exist.`
    };
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
    buildIgnoredDiagnosticKey,
    describeBrokenLink
};
