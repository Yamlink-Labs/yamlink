'use strict';

const path = require('path');

const coreIndex = require('./index');

class VaultService {
    constructor(options = {}) {
        this._buildIndex = options.buildIndex || coreIndex.buildIndex;
        this._readIndexState = options.readIndexState || (() => ({
            idIndex: coreIndex.getIndex(),
            pathIndex: coreIndex.getPathIndex(),
            fieldsCache: coreIndex.getFieldsCache(),
            generation: coreIndex.getVaultGeneration()
        }));
        this._workspaceFolders = Array.isArray(options.workspaceFolders) ? options.workspaceFolders : null;
        this._debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 300;

        this._vaultPath = null;
        this._generation = 0;
        this._indexState = {
            idIndex: new Map(),
            pathIndex: new Map(),
            fieldsCache: new Map(),
            generation: 0
        };
        this._listeners = [];
        this._queueTail = Promise.resolve();
        this._initializePromise = null;
        this._watchTimer = null;
        this._pendingWatchPromise = null;
    }

    get generation() {
        return this._generation;
    }

    getIndex() {
        return this._indexState;
    }

    onRebuild(cb) {
        if (typeof cb !== 'function') return () => {};
        this._listeners.push(cb);
        return () => {
            const index = this._listeners.indexOf(cb);
            if (index !== -1) this._listeners.splice(index, 1);
        };
    }

    async initialize(vaultPath) {
        if (vaultPath) this._vaultPath = path.resolve(vaultPath);
        if (!this._vaultPath) throw new Error('Vault path is required.');
        if (!this._workspaceFolders) {
            this._workspaceFolders = [{
                uri: { fsPath: this._vaultPath },
                name: path.basename(this._vaultPath)
            }];
        }
        if (!this._initializePromise) {
            // Call _rebuild() without await — it has no yield points, so all sync
            // code (buildIndex, snapshotState, fireRebuild) runs immediately before
            // this function yields. LSP requests that arrive in concurrent microtasks
            // will see a fully populated index when they run.
            const rebuildResult = this._rebuild();
            this._queueTail = rebuildResult.then(() => undefined, () => undefined);
            this._initializePromise = rebuildResult;
        }
        return this._initializePromise;
    }

    async mutate(writeFn) {
        if (typeof writeFn !== 'function') {
            throw new Error('mutate(writeFn) requires a function.');
        }
        await this._requireInitialized();
        return this._enqueue(async () => {
            await writeFn();
            return this._rebuild();
        });
    }

    notifyFileChange() {
        if (!this._vaultPath) return Promise.resolve({ generation: this._generation });
        if (this._watchTimer) clearTimeout(this._watchTimer);
        if (!this._pendingWatchPromise) {
            this._pendingWatchPromise = {};
            this._pendingWatchPromise.promise = new Promise((resolve, reject) => {
                this._pendingWatchPromise.resolve = resolve;
                this._pendingWatchPromise.reject = reject;
            });
        }
        this._watchTimer = setTimeout(() => {
            this._watchTimer = null;
            const pending = this._pendingWatchPromise;
            this._pendingWatchPromise = null;
            this._enqueue(() => this._rebuild())
                .then((value) => {
                    if (pending && typeof pending.resolve === 'function') pending.resolve(value);
                })
                .catch((error) => {
                    if (pending && typeof pending.reject === 'function') pending.reject(error);
                });
        }, this._debounceMs);
        return this._pendingWatchPromise.promise;
    }

    async _requireInitialized() {
        if (!this._initializePromise) {
            throw new Error('VaultService.initialize(vaultPath) must complete before use.');
        }
        await this._initializePromise;
    }

    _enqueue(task) {
        const runTask = async () => task();
        const next = this._queueTail.then(runTask, runTask);
        this._queueTail = next.then(() => undefined, () => undefined);
        return next;
    }

    _snapshotState() {
        const nextState = this._readIndexState() || {};
        this._generation = Number(nextState.generation || 0);
        this._indexState = {
            idIndex: nextState.idIndex || new Map(),
            pathIndex: nextState.pathIndex || new Map(),
            fieldsCache: nextState.fieldsCache || new Map(),
            generation: this._generation
        };
    }

    _fireRebuild() {
        for (const listener of [...this._listeners]) {
            listener(this._generation);
        }
    }

    async _rebuild() {
        this._buildIndex(this._workspaceFolders);
        this._snapshotState();
        this._fireRebuild();
        return { generation: this._generation };
    }
}

module.exports = { VaultService };
