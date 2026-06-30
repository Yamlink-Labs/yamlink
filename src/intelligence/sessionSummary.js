'use strict';

function buildSessionSummary(events) {
    const summary = {
        notesCreated: 0,
        fieldsAdded: 0,
        relationsFormed: 0,
        relationsChanged: 0,
        tasksChanged: 0,
        completionsAccepted: 0,
        templateApplied: 0,
        noteIds: []
    };
    const noteIds = new Set();

    for (const event of events || []) {
        if (!event || typeof event !== 'object') continue;
        if (event.noteId) noteIds.add(event.noteId);
        switch (event.type) {
        case 'note_created':
            summary.notesCreated++;
            break;
        case 'field_added':
            summary.fieldsAdded++;
            break;
        case 'relation_added':
            summary.relationsFormed++;
            break;
        case 'relation_changed':
            summary.relationsChanged++;
            break;
        case 'task_state_changed':
        case 'task_status_changed':
            summary.tasksChanged++;
            break;
        case 'completion_accepted':
            summary.completionsAccepted++;
            break;
        case 'template_applied':
            summary.templateApplied++;
            break;
        default:
            break;
        }
    }

    summary.noteIds = [...noteIds].sort();
    return summary;
}

function detectWorkflowBursts(events) {
    const sorted = [...(events || [])]
        .filter((event) => event && event.type && event.timestamp)
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const bursts = [];
    let index = 0;

    while (index < sorted.length) {
        const seed = sorted[index];
        const seedTime = Date.parse(seed.timestamp);
        if (Number.isNaN(seedTime)) {
            index++;
            continue;
        }
        const noteIds = new Set(seed.noteId ? [seed.noteId] : []);
        let end = index + 1;
        let lastTime = seedTime;

        while (end < sorted.length) {
            const next = sorted[end];
            if (next.type !== seed.type) break;
            const nextTime = Date.parse(next.timestamp);
            if (Number.isNaN(nextTime) || (nextTime - seedTime) > 60000) break;
            lastTime = nextTime;
            if (next.noteId) noteIds.add(next.noteId);
            end++;
        }

        if (noteIds.size >= 3) {
            bursts.push({
                type: seed.type,
                count: end - index,
                noteIds: [...noteIds].sort(),
                windowMs: Math.max(0, lastTime - seedTime)
            });
        }
        index = end;
    }

    return bursts;
}

module.exports = { buildSessionSummary, detectWorkflowBursts };
