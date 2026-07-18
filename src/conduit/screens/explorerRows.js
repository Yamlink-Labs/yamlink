'use strict';

// SelectionList row renderers extracted out of Explorer.js's monolith (0.7.4
// monolith-decomposition pass — see TODO.md). Both renderers originally
// closed over component state directly (activePane, mode, splitMode, etc.);
// here that state is passed explicitly as a `ctx` object so these functions
// are plain, testable, dependency-injected code — no behavior changes, the
// call sites in Explorer.js wrap them in a closure that forwards current ctx.

const React = require('react');
const { p, SYM } = require('../palette');
const { truncate, pad } = require('../noteDetail');

/** @param {{type: string, count: number}} item @param {number} _index @param {boolean} isSelected
 *  @param {{ink: object, activePane: string, mode: string, splitMode: boolean, totalNoteCount: number}} ctx */
function renderTypeRow(item, _index, isSelected, ctx) {
    const { ink, activePane, mode, splitMode, totalNoteCount } = ctx;
    const { Text } = ink;
    const active = activePane === 'types' && mode === 'browse';
    const marker = isSelected ? (active ? p.accent(`${SYM.selected} `) : p.secondary(`${SYM.selected} `)) : p.faint('  ');
    if (splitMode) {
        return React.createElement(Text, null,
            marker + pad(truncate(item.type, 10), 10) + ' ' + p.secondary(pad(String(item.count), 3))
        );
    }
    const barWidth = 8;
    const ratio = item.type === 'all' ? 1 : (item.count / totalNoteCount);
    const filled = Math.round(ratio * barWidth);
    const bar = p.accent('▓'.repeat(filled)) + p.faint('░'.repeat(barWidth - filled));
    return React.createElement(Text, null,
        marker + pad(item.type, 12) + ' ' + p.secondary(pad(String(item.count), 3)) + ' ' + bar
    );
}

/** @param {{id: string, type: string, label: string, status: string}} item @param {number} _index @param {boolean} isSelected
 *  @param {{ink: object, activePane: string, mode: string, splitMode: boolean, selectedIdSet: Set<string>, selectedType: {type: string}}} ctx */
function renderNoteRow(item, _index, isSelected, ctx) {
    const { ink, activePane, mode, splitMode, selectedIdSet, selectedType } = ctx;
    const { Text } = ink;
    const active = activePane === 'notes' && (mode === 'browse' || mode === 'filter');
    const selectedMark = selectedIdSet.has(item.id) ? p.warn('■ ') : p.faint('· ');
    const marker = isSelected ? (active ? p.accent(`${SYM.cursor} `) : p.secondary(`${SYM.cursor} `)) : p.faint('  ');
    if (splitMode) {
        const extra = selectedType.type === 'all'
            ? ' ' + p.type(truncate(item.type, 8))
            : (item.status ? ' ' + p.secondary(truncate(item.status, 8)) : '');
        return React.createElement(Text, null,
            marker + selectedMark + p.type(truncate(item.id, 20)) + extra
        );
    }
    const idText = pad(truncate(item.id, 22), 24);
    const labelText = pad(truncate(item.label, 28), 30);
    const extra = selectedType.type === 'all'
        ? p.type(truncate(item.type, 12))
        : (item.status ? p.secondary(truncate(item.status, 12)) : '');
    return React.createElement(Text, null,
        marker + selectedMark + p.type(idText) + ' ' + p.primary(labelText) + extra
    );
}

module.exports = { renderTypeRow, renderNoteRow };
