'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { VaultService } = require('../src/core/vaultService');

function createServiceHarness(options = {}) {
    let generation = 0;
    const state = {
        idIndex: new Map(),
        pathIndex: new Map(),
        fieldsCache: new Map()
    };
    let rebuildCount = 0;

    const service = new VaultService({
        debounceMs: options.debounceMs ?? 25,
        buildIndex() {
            rebuildCount += 1;
            generation += 1;
            if (typeof options.onBuild === 'function') options.onBuild({ state, generation, rebuildCount });
        },
        readIndexState() {
            return {
                idIndex: state.idIndex,
                pathIndex: state.pathIndex,
                fieldsCache: state.fieldsCache,
                generation
            };
        }
    });

    return {
        service,
        state,
        get rebuildCount() { return rebuildCount; }
    };
}

test('VaultService mutate serializes concurrent writes without interleaving', async () => {
    const harness = createServiceHarness();
    await harness.service.initialize('C:\\vault');

    const trace = [];
    const first = harness.service.mutate(async () => {
        trace.push('start-1');
        await new Promise((resolve) => setTimeout(resolve, 30));
        harness.state.idIndex.set('alpha', 'C:\\vault\\alpha.md');
        trace.push('end-1');
    });

    const second = harness.service.mutate(async () => {
        trace.push('start-2');
        harness.state.idIndex.set('bravo', 'C:\\vault\\bravo.md');
        trace.push('end-2');
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(trace, ['start-1', 'end-1', 'start-2', 'end-2']);
    assert.equal(firstResult.generation < secondResult.generation, true);
    assert.equal(harness.service.getIndex().idIndex.has('alpha'), true);
    assert.equal(harness.service.getIndex().idIndex.has('bravo'), true);
});

test('VaultService onRebuild fires after mutate and notifyFileChange rebuilds', async () => {
    const harness = createServiceHarness({ debounceMs: 10 });
    const seen = [];
    const unsubscribe = harness.service.onRebuild((generation) => {
        seen.push(generation);
    });

    await harness.service.initialize('C:\\vault');
    seen.length = 0;

    await harness.service.mutate(async () => {
        harness.state.idIndex.set('alpha', 'C:\\vault\\alpha.md');
    });

    harness.service.notifyFileChange();
    await new Promise((resolve) => setTimeout(resolve, 40));

    unsubscribe();
    assert.equal(seen.length, 2);
    assert.equal(seen[0] < seen[1], true);
});

test('VaultService getIndex returns post-write state after mutate resolves', async () => {
    const harness = createServiceHarness();
    await harness.service.initialize('C:\\vault');

    await harness.service.mutate(async () => {
        harness.state.idIndex.set('johnny-rico', 'C:\\vault\\johnny-rico.md');
        harness.state.fieldsCache.set('johnny-rico', { id: 'johnny-rico', type: 'contact' });
    });

    const indexState = harness.service.getIndex();
    assert.equal(indexState.idIndex.get('johnny-rico'), 'C:\\vault\\johnny-rico.md');
    assert.deepEqual(indexState.fieldsCache.get('johnny-rico'), { id: 'johnny-rico', type: 'contact' });
    assert.equal(indexState.generation, harness.service.generation);
});

test('VaultService notifyFileChange debounces rapid calls into one rebuild', async () => {
    const harness = createServiceHarness({ debounceMs: 15 });
    await harness.service.initialize('C:\\vault');
    const baselineBuilds = harness.rebuildCount;

    harness.service.notifyFileChange();
    harness.service.notifyFileChange();
    harness.service.notifyFileChange();
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(harness.rebuildCount, baselineBuilds + 1);
});

test('VaultService recovers after a mutate writeFn error and continues processing the queue', async () => {
    const harness = createServiceHarness();
    await harness.service.initialize('C:\\vault');

    await assert.rejects(
        harness.service.mutate(async () => {
            throw new Error('boom');
        }),
        /boom/
    );

    const result = await harness.service.mutate(async () => {
        harness.state.idIndex.set('recovered', 'C:\\vault\\recovered.md');
    });

    assert.equal(result.generation, harness.service.generation);
    assert.equal(harness.service.getIndex().idIndex.has('recovered'), true);
});
