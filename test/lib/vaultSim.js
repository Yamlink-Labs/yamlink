'use strict';
/**
 * vaultSim — Vault Simulation Harness
 *
 * Builds a real Yamlink index from temp files on disk and exercises the
 * real (non-mocked) implementations of every pure surface: query, health
 * stats, note report, graph payload, hover, intelligence, lifecycle, drift.
 *
 * VS Code API is stubbed once at load time so webview-adjacent modules can
 * be required without crashing. Each VaultInstance fully rebuilds the
 * shared in-memory index from its temp directory, so tests get clean state.
 *
 * Usage:
 *   const { createVault } = require('./lib/vaultSim');
 *   const vault = createVault({ 'rico.md': '---\nid: rico\ntype: character\n---' });
 *   const stats = vault.healthStats();
 *   vault.destroy();
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const Module = require('module');

// ─── VS Code stub (installed once, before any real require) ──────────────────

const _originalResolve = Module._resolveFilename.bind(Module);

const _vscodeStub = {
    MarkdownString: class MarkdownString {
        constructor(v = '') { this.value = v; this.isTrusted = false; this.supportHtml = false; }
        appendMarkdown(t) { this.value += t; return this; }
        appendText(t)     { this.value += t; return this; }
    },
    Uri: {
        file: fsPath => ({ fsPath, scheme: 'file', path: fsPath }),
        joinPath: (base, ...parts) => {
            const basePath = String(base?.fsPath ?? base?.path ?? base ?? '').replace(/[\\/]+$/, '');
            return { fsPath: [basePath, ...parts].join('/'), scheme: 'file' };
        }
    },
    window: {
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, clear: () => {}, dispose: () => {} }),
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
        showWarningMessage:          async () => undefined,
        showInformationMessage:      async () => undefined,
        showErrorMessage:            async () => undefined
    },
    workspace: {
        textDocuments: [],
        applyEdit:                  async () => true,
        onDidChangeTextDocument:    () => ({ dispose: () => {} }),
        onDidSaveTextDocument:      () => ({ dispose: () => {} }),
        onDidCreateFiles:           () => ({ dispose: () => {} }),
        onDidDeleteFiles:           () => ({ dispose: () => {} }),
        onDidRenameFiles:           () => ({ dispose: () => {} })
    },
    languages: {
        createDiagnosticCollection: () => ({
            set:     () => {},
            delete:  () => {},
            clear:   () => {},
            forEach: () => {},
            get:     () => [],
            has:     () => false,
            dispose: () => {}
        })
    },
    Range: class Range {
        constructor(s, e) { this.start = s; this.end = e; }
    },
    Position: class Position {
        constructor(l, c) { this.line = l; this.character = c; }
    },
    Selection: class Selection {
        constructor(a, b) { this.anchor = a; this.active = b; }
    },
    WorkspaceEdit: class WorkspaceEdit {
        constructor() { this._edits = []; }
        replace(uri, range, text) { this._edits.push({ uri, range, text }); }
        insert(uri, pos, text)    { this._edits.push({ uri, pos, text }); }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Diagnostic: class Diagnostic {
        constructor(range, message, severity = 0) {
            this.range = range; this.message = message; this.severity = severity;
        }
    },
    CodeAction: class CodeAction {
        constructor(title, kind) { this.title = title; this.kind = kind; }
    },
    CodeActionKind: {
        QuickFix:        'quickfix',
        Refactor:        'refactor',
        RefactorRewrite: 'refactor.rewrite',
        Source:          'source'
    },
    EventEmitter: class EventEmitter {
        constructor() { this._listeners = []; }
        get event() { return cb => { this._listeners.push(cb); return { dispose: () => {} }; }; }
        fire(data)   { this._listeners.forEach(cb => cb(data)); }
        dispose()    { this._listeners = []; }
    },
    ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
    ThemeIcon:  class ThemeIcon  { constructor(id) { this.id = id; } }
};

require.cache.__vs_vaultSim__ = {
    id: '__vs_vaultSim__', filename: '__vs_vaultSim__', loaded: true,
    exports: _vscodeStub
};

Module._resolveFilename = (request, parent, ...rest) => {
    if (request === 'vscode') return '__vs_vaultSim__';
    return _originalResolve(request, parent, ...rest);
};

// ─── Load real implementations ───────────────────────────────────────────────

const indexMod       = require('../../src/core/index');
const healthMod      = require('../../src/features/health/healthStats');
const entityMod      = require('../../src/features/entityHubModel');
const queryMod       = require('../../src/engine/query');
const graph2PayMod   = require('../../src/features/graph2/graph2Payload');
const graph2State    = require('../../src/features/graph2/graph2State');
const hoverMod       = require('../../src/features/hover');
const fieldCatMod    = require('../../src/intelligence/fieldCategory');
const lifecycleMod   = require('../../src/intelligence/lifecycleState');
const driftMod       = require('../../src/intelligence/driftDetector');
const vaultPriorsMod = require('../../src/intelligence/vaultPriors');
const noteRolesMod   = require('../../src/intelligence/noteRolesCore');
const frontmatterIntMod = require('../../src/intelligence/frontmatterIntelligence');
const { buildObservedFields, buildObservedNoteIndex, resetObservedNoteIndexCache } = require('../../src/intelligence/suggestionCore');
const { clearIntelligenceCache } = require('../../src/intelligence/intelligenceCache');
const schemaRegistryMod = require('../../src/registries/schemaRegistry');
require('../../src/features/view/viewPanelHtml');

// Restore resolver after all modules are cached
Module._resolveFilename = _originalResolve;

// ─── VaultInstance ────────────────────────────────────────────────────────────

class VaultInstance {
    constructor(dir) {
        this.dir = dir;
        this._rebuild();
    }

    _rebuild() {
        // Reset all generation-keyed module caches before rebuilding so that
        // consecutive vaults within the same test process start from clean state,
        // regardless of the vault generation counter's current value.
        resetObservedNoteIndexCache();
        vaultPriorsMod.resetVaultPriorsCache();
        clearIntelligenceCache();
        indexMod.buildIndex([{ uri: { fsPath: this.dir } }]);
    }

    // ── Raw index accessors ───────────────────────────────────────────────────
    get idIndex()     { return indexMod.getIndex(); }
    get fieldsCache() { return indexMod.getFieldsCache(); }
    get pathIndex()   { return indexMod.getPathIndex(); }

    // ── Query ─────────────────────────────────────────────────────────────────
    query(text, today = '2026-01-01') {
        const parsed = queryMod.parseViewQuery(text);
        if (!parsed) return { success: false, rows: [], columns: [], warnings: ['parse failed'] };
        return queryMod.runQuery(parsed, today);
    }

    queryAll(text, today = '2026-01-01') {
        const queries = queryMod.parseAllViewQueries(text);
        if (!queries || queries.length === 0) return [];
        return queries.map(q => queryMod.runQuery(q, today));
    }

    // ── Health ────────────────────────────────────────────────────────────────
    healthStats() { return healthMod.collectHealthStats(); }
    healthScore() { return healthMod.computeHealthScore(this.healthStats()); }

    // ── Note Report ───────────────────────────────────────────────────────────
    noteReport(nodeId) {
        return entityMod.buildEntityHubModel(nodeId, this.idIndex, this.fieldsCache);
    }

    // ── Graph2 payload ────────────────────────────────────────────────────────
    graph2(nodeId, opts = {}) {
        const state = graph2State.normalizeGraph2State(
            {
                scope: opts.scope || graph2State.GRAPH2_SCOPES.LOCAL,
                depth: opts.depth || 2,
                nodeCap: opts.nodeCap || 150,
                filters: opts.filters || {}
            },
            nodeId
        );
        return graph2PayMod.buildGraph2Payload(state, () => nodeId);
    }

    // ── Hover ─────────────────────────────────────────────────────────────────
    hover(nodeId) {
        const filePath = path.join(this.dir, nodeId + '.md');
        let content = '';
        try { content = fs.readFileSync(filePath, 'utf8'); } catch { /* missing file */ }
        return hoverMod.buildHoverContent(nodeId, content, filePath);
    }

    // ── Intelligence ──────────────────────────────────────────────────────────
    fieldCategory(nodeId, fieldName) {
        const fields = this.fieldsCache.get(nodeId) || {};
        const noteType = String(fields.type || '').trim().toLowerCase();
        const priors = vaultPriorsMod.getCachedPriors(this.fieldsCache, indexMod.getVaultGeneration());
        const schema = schemaRegistryMod.getSchema(noteType);
        return fieldCatMod.classifyField(fieldName, {
            fieldsCache:      this.fieldsCache,
            noteFields:       fields,
            noteType,
            fieldTargetTypes: priors.fieldTargetTypes,
            typeFieldBundles: priors.typeFieldBundles,
            fieldAmbiguity:   priors.fieldAmbiguity,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            schemaFieldDef:   schema?.fields?.[fieldName] || null
        });
    }

    noteRole(nodeId) {
        const fields = this.fieldsCache.get(nodeId) || {};
        return noteRolesMod.inferNoteRole(fields, {});
    }

    lifecycleState(nodeId) {
        const fields = this.fieldsCache.get(nodeId) || {};
        const priors = vaultPriorsMod.getCachedPriors(this.fieldsCache, indexMod.getVaultGeneration());
        return lifecycleMod.inferLifecycleState(nodeId, fields, {
            idIndex:            this.idIndex,
            fieldsCache:        this.fieldsCache,
            fieldTargetTypes:   priors.fieldTargetTypes,
            typeFieldBundles:   priors.typeFieldBundles,
            noteRoleTypePriors: priors.noteRoleTypePriors,
            noteRole:           this.noteRole(nodeId),
            noteType:           String(fields.type || '').trim().toLowerCase(),
            inboundCount:       this._inboundCount(nodeId),
            avgInbound:         this._avgInbound()
        });
    }

    driftScore(nodeId) {
        const priors = vaultPriorsMod.getCachedPriors(this.fieldsCache, indexMod.getVaultGeneration());
        const vaultDrift = driftMod.computeVaultDrift(this.fieldsCache, priors);
        return vaultDrift.find(d => d.noteId === nodeId) || { noteId: nodeId, driftScore: 0, driftLabel: 'on-track' };
    }

    // ── Completion intelligence ───────────────────────────────────────────────
    completionOpportunities(nodeId, content = '') {
        const fields = this.fieldsCache.get(nodeId) || {};
        const nodeType = String(fields.type || '').trim().toLowerCase();
        // Pass observedFields explicitly so buildObservedNoteIndex bypasses its
        // module-level generation-keyed cache (which may be stale from prior tests).
        const observedFields = buildObservedFields(this.fieldsCache);
        const observedIndex  = buildObservedNoteIndex(this.fieldsCache, { observedFields });
        return frontmatterIntMod.buildFrontmatterOpportunityModel(fields, {
            nodeId,
            nodeType,
            content,
            fieldsCache:   this.fieldsCache,
            observedFields,
            observedIndex
        });
    }

    completionGuidance(nodeId, content = '') {
        const model = this.completionOpportunities(nodeId, content);
        return frontmatterIntMod.buildFrontmatterGuidanceSummary(model);
    }

    // ── Vault mutations (rebuild after each) ──────────────────────────────────
    addNote(filename, content) {
        fs.writeFileSync(path.join(this.dir, filename), content, 'utf8');
        this._rebuild();
    }

    updateNote(filename, content) {
        fs.writeFileSync(path.join(this.dir, filename), content, 'utf8');
        this._rebuild();
    }

    removeNote(filename) {
        fs.unlinkSync(path.join(this.dir, filename));
        this._rebuild();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    destroy() {
        try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    _inboundCount(targetId) {
        let count = 0;
        for (const fields of this.fieldsCache.values()) {
            for (const rawValue of Object.values(fields || {})) {
                const text = String(rawValue || '');
                for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
                    const t = m[1].trim().split('|')[0].split('#')[0].split('^')[0].trim();
                    if (t === targetId) count++;
                }
            }
        }
        return count;
    }

    _avgInbound() {
        const ids = this.idIndex;
        if (ids.size === 0) return 0;
        let total = 0;
        for (const id of ids.keys()) total += this._inboundCount(id);
        return total / ids.size;
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * createVault(files) → VaultInstance
 *
 * @param {Record<string, string>} files  filename → markdown content
 * @returns {VaultInstance}
 *
 * Call .destroy() when done to remove the temp directory.
 */
function createVault(files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-sim-'));
    for (const [name, content] of Object.entries(files)) {
        const filePath = path.join(dir, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
    }
    return new VaultInstance(dir);
}

module.exports = { createVault, VaultInstance };
