'use strict';

function extractLinkedIds(rawValue) {
    if (!rawValue) return [];
    return [...String(rawValue).matchAll(/\[\[([^\]]+)\]\]/g)]
        .map((match) => match[1].split('|')[0].split('#')[0].split('^')[0].trim())
        .filter(Boolean);
}

function buildNoteEvolution(noteId, events) {
    const sorted = [...(events || [])]
        .filter((event) => event && event.noteId === noteId)
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

    const createdEvent = sorted.find((event) => event.type === 'note_created') || null;
    const created = createdEvent ? createdEvent.timestamp || null : null;
    const createdMs = created ? Date.parse(created) : null;
    const fieldStats = new Map();
    const unstable = [];
    const relationsFormed = [];
    let typeSet = null;
    let totalEdits = 0;
    let lastActivity = null;

    for (const event of sorted) {
        if (event.timestamp) lastActivity = event.timestamp;
        const field = String(event.field || '').trim();
        const type = String(event.type || '').trim();

        if (type === 'type_set' && typeSet == null && event.newValue != null) {
            typeSet = String(event.newValue);
        }

        const touchesField = field && (
            type === 'field_added' ||
            type === 'field_changed' ||
            type === 'field_removed' ||
            type === 'relation_added' ||
            type === 'relation_changed' ||
            type === 'relation_removed' ||
            type === 'type_set'
        );
        if (touchesField) totalEdits++;

        if (!touchesField) continue;

        const stat = fieldStats.get(field) || {
            firstSetAt: null,
            firstChangedAfterSet: false,
            changeCount: 0
        };

        if (stat.firstSetAt == null && (type === 'field_added' || type === 'relation_added' || type === 'type_set')) {
            stat.firstSetAt = event.timestamp || null;
        } else if (stat.firstSetAt != null && (type === 'field_changed' || type === 'field_removed' || type === 'relation_changed' || type === 'relation_removed')) {
            stat.firstChangedAfterSet = true;
        }

        if (type === 'field_changed' || type === 'field_removed' || type === 'relation_changed' || type === 'relation_removed') {
            stat.changeCount++;
        }

        fieldStats.set(field, stat);

        if (type === 'relation_added') {
            for (const target of extractLinkedIds(event.newValue)) {
                relationsFormed.push({ field, target });
            }
        }
    }

    const firstFields = [...fieldStats.entries()]
        .filter(([, stat]) => stat.firstSetAt)
        .filter(([, stat]) => {
            if (createdMs == null) return true;
            const firstMs = Date.parse(stat.firstSetAt);
            return !Number.isNaN(firstMs) && (firstMs - createdMs) <= 86400000;
        })
        .map(([field]) => field)
        .sort();

    const stableFields = [...fieldStats.entries()]
        .filter(([, stat]) => stat.firstSetAt && !stat.firstChangedAfterSet)
        .map(([field]) => field)
        .sort();

    for (const [field, stat] of fieldStats.entries()) {
        if (stat.changeCount >= 3) unstable.push({ field, changeCount: stat.changeCount });
    }
    unstable.sort((a, b) => b.changeCount - a.changeCount || a.field.localeCompare(b.field));

    return {
        noteId,
        created,
        typeSet,
        firstFields,
        stableFields,
        unstableFields: unstable,
        relationsFormed,
        totalEdits,
        lastActivity
    };
}

function buildRelationArchaeology(noteId, field, events) {
    const sorted = [...(events || [])]
        .filter((event) => event && event.noteId === noteId && String(event.field || '').trim() === field)
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

    const timelines = new Map();
    let firstSet = null;

    for (const event of sorted) {
        const oldTargets = new Set(extractLinkedIds(event.oldValue));
        const newTargets = new Set(extractLinkedIds(event.newValue));
        if (!firstSet && newTargets.size) firstSet = event.timestamp || null;

        for (const target of newTargets) {
            if (oldTargets.has(target)) continue;
            const list = timelines.get(target) || [];
            list.push({ value: target, setAt: event.timestamp || null, clearedAt: null });
            timelines.set(target, list);
        }

        for (const target of oldTargets) {
            if (newTargets.has(target)) continue;
            const list = timelines.get(target) || [];
            const current = [...list].reverse().find((entry) => entry.clearedAt == null);
            if (current) current.clearedAt = event.timestamp || null;
            timelines.set(target, list);
        }
    }

    const targets = [];
    for (const [, entries] of timelines) targets.push(...entries);
    targets.sort((a, b) => String(a.setAt || '').localeCompare(String(b.setAt || '')) || a.value.localeCompare(b.value));

    return { field, noteId, firstSet, targets };
}

module.exports = { buildNoteEvolution, buildRelationArchaeology };
