'use strict';

const { createManualSnapshot } = require('../../runtime/mutationEventLog');
const { captureOutput, emitCliError, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function run({ reason, json }) {
    let snapshot;
    try {
        snapshot = createManualSnapshot(reason);
    } catch (error) {
        emitCliError({
            json,
            error: error && error.message ? error.message : String(error),
            code: 'INTERNAL_ERROR',
            exitCode: 2
        });
        return;
    }

    if (json) {
        emitCliSuccess(snapshot);
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Vault Snapshot');
        fmt.row('Timestamp', snapshot.timestamp);
        fmt.row('Notes captured', snapshot.noteCount);
        fmt.row('Snapshot file', snapshot.snapshotPath || '(disabled)');
        if (snapshot.reason) fmt.row('Reason', snapshot.reason);
        fmt.blank();
        console.log('  ' + fmt.ok('Snapshot captured. Use `yamlink restore <timestamp>` to preview it later.'));
    }));
}

module.exports = { run };
