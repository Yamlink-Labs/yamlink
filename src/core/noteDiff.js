'use strict';

function stripInternalFields(fields) {
    return Object.fromEntries(
        Object.entries(fields || {}).filter(([key]) => !String(key).startsWith('__'))
    );
}

function diffNoteFields(fromFields, toFields) {
    const left = stripInternalFields(fromFields);
    const right = stripInternalFields(toFields);
    const leftKeys = new Set(Object.keys(left));
    const rightKeys = new Set(Object.keys(right));

    const onlyIn1 = {};
    const onlyIn2 = {};
    const changed = [];

    for (const key of leftKeys) {
        if (!rightKeys.has(key)) {
            onlyIn1[key] = left[key];
            continue;
        }
        if (String(left[key] ?? '') !== String(right[key] ?? '')) {
            changed.push({ field: key, value1: left[key], value2: right[key] });
        }
    }

    for (const key of rightKeys) {
        if (!leftKeys.has(key)) {
            onlyIn2[key] = right[key];
        }
    }

    return {
        onlyIn1,
        onlyIn2,
        changed
    };
}

function buildCliDiff(id1, id2, fromFields, toFields) {
    const diff = diffNoteFields(fromFields, toFields);
    return {
        id1,
        id2,
        onlyIn1: diff.onlyIn1,
        onlyIn2: diff.onlyIn2,
        changed: diff.changed.map((entry) => ({
            field: entry.field,
            value1: entry.value1,
            value2: entry.value2
        }))
    };
}

function buildApiDiff(from, to, fromFields, toFields) {
    const diff = diffNoteFields(fromFields, toFields);
    return {
        from,
        to,
        added: diff.onlyIn2,
        removed: Object.keys(diff.onlyIn1),
        changed: diff.changed.map((entry) => ({
            field: entry.field,
            from: entry.value1,
            to: entry.value2
        }))
    };
}

module.exports = {
    diffNoteFields,
    buildCliDiff,
    buildApiDiff,
    stripInternalFields
};
