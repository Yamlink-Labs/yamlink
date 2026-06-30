'use strict';

const fs = require('fs');

const { getIndex } = require('../../core/indexService');
const { getGraphStats } = require('../../core/graph');
const { getMutationEvents } = require('../../runtime/mutationEventLog');
const { emitCliError, emitJson, emitText } = require('../io');

function timeStamp() {
    return new Date().toTimeString().slice(0, 8);
}

function run({ vaultPath, vaultService, json, quiet, stream }) {
    let watcher = null;
    let lastEmittedTimestamp = null;

    const emitMutationStream = () => {
        if (!stream || !json) return;
        const events = getMutationEvents({ since: lastEmittedTimestamp, limit: 50 })
            .filter((event) => !lastEmittedTimestamp || event.timestamp > lastEmittedTimestamp);
        if (!events.length) {
            const graphStats = getGraphStats();
            process.stdout.write(JSON.stringify({
                type: 'rebuilt',
                timestamp: new Date().toISOString(),
                notes: getIndex().size,
                edges: graphStats?.totalEdges ?? 0
            }) + '\n');
            return;
        }
        for (const event of events) {
            process.stdout.write(JSON.stringify(event) + '\n');
            lastEmittedTimestamp = event.timestamp;
        }
    };

    const unsubscribe = vaultService && vaultService.onRebuild(() => {
        const graphStats = getGraphStats();
        if (json && !stream) {
            emitJson({
                ok: true,
                event: 'rebuilt',
                timestamp: new Date().toISOString(),
                notes: getIndex().size,
                edges: graphStats?.totalEdges ?? 0
            });
        } else if (json && stream) {
            emitMutationStream();
        } else if (!quiet) {
            emitText(`[${timeStamp()}] Rebuilt - ${getIndex().size} notes, ${graphStats?.totalEdges ?? 0} edges.\n`);
        }
    });

    try {
        watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
            // filename can be null on some platforms with recursive watching — trigger rebuild conservatively
            if (filename !== null && filename !== undefined && !String(filename).endsWith('.md')) return;
            vaultService.notifyFileChange();
        });
    } catch (err) {
        emitCliError({ json, error: 'Watch failed: ' + err.message, code: 'INTERNAL_ERROR', exitCode: 2 });
    }

    if (json && stream) {
        process.stdout.write(JSON.stringify({ ok: true, event: 'watch_started', vaultPath, pid: process.pid }) + '\n');
    } else if (json) {
        emitJson({ ok: true, event: 'watch_started', vaultPath, pid: process.pid });
    } else if (!quiet) {
        emitText(`Watching ${vaultPath} for changes... (Ctrl+C to stop)\n`);
    }

    process.on('SIGINT', () => {
        if (typeof unsubscribe === 'function') unsubscribe();
        if (watcher && typeof watcher.close === 'function') watcher.close();
        if (!json && !quiet) emitText('Stopped.\n');
        process.exit(0);
    });
}

module.exports = { run };
