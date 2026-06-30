'use strict';

const { buildSessionSummary, detectWorkflowBursts } = require('../../intelligence/sessionSummary');
const { getMutationEvents, getSessionEvents } = require('../../runtime/mutationEventLog');
const { captureOutput, emitCliSuccess, emitText } = require('../io');
const fmt = require('../format');

function run({ sessionId, json }) {
    const events = sessionId
        ? getSessionEvents(sessionId)
        : getMutationEvents({ since: new Date(Date.now() - 30 * 60000).toISOString(), limit: 500 })
            .filter((event) => event.source === 'cli');
    const summary = buildSessionSummary(events);
    const bursts = detectWorkflowBursts(events);

    if (json) {
        emitCliSuccess({ sessionId: sessionId || null, summary, bursts, events });
        return;
    }

    emitText(captureOutput(() => {
        fmt.header('Session Summary');
        fmt.row('Events', events.length);
        fmt.row('Notes created', summary.notesCreated);
        fmt.row('Fields added', summary.fieldsAdded);
        fmt.row('Relations formed', summary.relationsFormed);
        fmt.row('Relations changed', summary.relationsChanged);
        fmt.row('Tasks changed', summary.tasksChanged);
        fmt.row('Completions accepted', summary.completionsAccepted);
        fmt.row('Templates applied', summary.templateApplied);
        fmt.row('Notes touched', summary.noteIds.join(', ') || 'none');
        if (bursts.length) {
            fmt.blank();
            fmt.subheader('Workflow bursts');
            for (const burst of bursts) {
                fmt.row(`  ${burst.type}`, `${burst.count} events · ${burst.noteIds.join(', ')}`);
            }
        }
        fmt.blank();
    }));
}

module.exports = { run };
