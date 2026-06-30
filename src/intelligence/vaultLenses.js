'use strict';

function buildVaultLenses(events, _idIndex) {
    const sorted = [...(events || [])]
        .filter((event) => event && event.timestamp)
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

    const mostEditedCounts = new Map();
    const perFieldChanges = new Map();
    const createdByType = new Map();
    const createdEvents = new Map();
    const recurringCounts = new Map();
    const now = Date.now();
    const cutoff = now - (30 * 86400000);

    for (const event of sorted) {
        const eventMs = Date.parse(event.timestamp);
        if (['field_added', 'field_changed', 'relation_added', 'relation_changed', 'relation_removed'].includes(event.type)) {
            mostEditedCounts.set(event.noteId, (mostEditedCounts.get(event.noteId) || 0) + 1);
        }

        if (event.field && event.noteId && event.type === 'field_changed') {
            const key = `${event.noteId}\x00${event.field}`;
            perFieldChanges.set(key, (perFieldChanges.get(key) || 0) + 1);
        }

        if (event.type === 'note_created' && !Number.isNaN(eventMs)) {
            createdEvents.set(event.noteId, eventMs);
        }
        if (event.type === 'type_set' && !Number.isNaN(eventMs) && event.newValue != null) {
            const createdMs = createdEvents.get(event.noteId);
            if (createdMs != null && eventMs >= cutoff && (eventMs - createdMs) <= 60000) {
                const type = String(event.newValue).trim().toLowerCase();
                if (type) createdByType.set(type, (createdByType.get(type) || 0) + 1);
            }
        }
    }

    const unstableAggregate = new Map();
    for (const [key, changeCount] of perFieldChanges.entries()) {
        if (changeCount < 3) continue;
        const field = key.split('\x00')[1];
        unstableAggregate.set(field, (unstableAggregate.get(field) || 0) + 1);
    }

    for (const [noteId, createdMs] of createdEvents.entries()) {
        if (createdMs < cutoff) continue;
        const windowEvents = sorted.filter((event) => {
            if (event.noteId !== noteId) return false;
            const eventMs = Date.parse(event.timestamp);
            return !Number.isNaN(eventMs) && eventMs >= createdMs && (eventMs - createdMs) <= 120000;
        });
        const hasTypeSet = windowEvents.some((event) => event.type === 'type_set');
        const fieldAdds = windowEvents.filter((event) => event.type === 'field_added').length;
        if (hasTypeSet && fieldAdds >= 3) {
            const pattern = 'note_created -> type_set -> field_added x3+';
            recurringCounts.set(pattern, (recurringCounts.get(pattern) || 0) + 1);
        }
    }

    return {
        mostEdited: [...mostEditedCounts.entries()]
            .map(([noteId, editCount]) => ({ noteId, editCount }))
            .sort((a, b) => b.editCount - a.editCount || a.noteId.localeCompare(b.noteId))
            .slice(0, 10),
        fastestGrowingTypes: [...createdByType.entries()]
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
        unstableFields: [...unstableAggregate.entries()]
            .filter(([, reversalCount]) => reversalCount >= 1)
            .map(([field, reversalCount]) => ({ field, reversalCount }))
            .sort((a, b) => b.reversalCount - a.reversalCount || a.field.localeCompare(b.field)),
        recurringPatterns: [...recurringCounts.entries()]
            .map(([pattern, count]) => ({ pattern, count }))
            .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
    };
}

module.exports = { buildVaultLenses };
