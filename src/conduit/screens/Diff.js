'use strict';

const React = require('react');
const Panel = require('../components/Panel');
const { p, SYM } = require('../palette');
const { truncate, pad } = require('../noteDetail');

const TIME_WINDOWS = [
    { key: 'session', label: 'last session' },
    { key: 'today',   label: 'today' },
    { key: '7d',      label: '7 days' },
    { key: '30d',     label: '30 days' },
];

function windowToSince(key, lastSessionTs) {
    const now = new Date();
    if (key === 'session') {
        return lastSessionTs || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    }
    if (key === 'today') {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }
    if (key === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (key === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

const MAX_VISIBLE_NOTES = 5;
const MAX_FIELDS_PER_NOTE = 3;

function Diff({ ink, getDiff, host, port, lastSessionTs, onNavigate, onQuit, disabled, width, splitMode }) {
    const { Box, Text, useInput } = ink;

    const [windowIdx, setWindowIdx] = React.useState(0);
    const [changes, setChanges] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [cursor, setCursor] = React.useState(0);
    const [since, setSince] = React.useState('');

    const selectedWindow = TIME_WINDOWS[windowIdx];

    React.useEffect(() => {
        const sinceTs = windowToSince(selectedWindow.key, lastSessionTs);
        setSince(sinceTs);
        setLoading(true);
        setError('');
        setCursor(0);
        getDiff({ host, port, since: sinceTs })
            .then((body) => {
                setChanges(Array.isArray(body.changes) ? body.changes : []);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message || 'load failed');
                setLoading(false);
            });
    }, [getDiff, host, port, lastSessionTs, selectedWindow]);

    const safeCursor = Math.max(0, Math.min(cursor, Math.max(0, changes.length - 1)));

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }
        if (input === '1') { onNavigate('briefing'); return; }
        if (input === '2') { onNavigate('query'); return; }
        if (input === '3') { onNavigate('navigator'); return; }
        if (input === '4') { onNavigate('explorer'); return; }
        if (input === '5') { onNavigate('health'); return; }
        if (input === '6') { onNavigate('search'); return; }
        if (input === '7') { onNavigate('graph'); return; }
        if (!splitMode && key.tab) {
            setWindowIdx((i) => (i + 1) % TIME_WINDOWS.length);
            return;
        }
        if (input === 'j' || key.downArrow) {
            setCursor((c) => Math.min(Math.max(0, changes.length - 1), c + 1));
            return;
        }
        if (input === 'k' || key.upArrow) {
            setCursor((c) => Math.max(0, c - 1));
            return;
        }
        if (key.return && changes[safeCursor]) {
            onNavigate('explorer', { noteId: changes[safeCursor].id });
            return;
        }
        if (key.escape || input === 'q') { onNavigate('briefing'); return; }
    }, { isActive: !disabled });

    const windowTabs = TIME_WINDOWS.map((w, i) =>
        i === windowIdx ? p.accent(`[${w.label}]`) : p.faint(`[${w.label}]`)
    ).join('  ');

    const sinceDate = since ? since.slice(0, 10) : '—';

    // Windowed slice of notes centered on cursor
    const winStart = Math.max(0, Math.min(safeCursor - Math.floor(MAX_VISIBLE_NOTES / 2), changes.length - MAX_VISIBLE_NOTES));
    const visibleChanges = changes.slice(winStart, winStart + MAX_VISIBLE_NOTES);

    function renderNoteEntry(entry, absIdx) {
        const isSelected = absIdx === safeCursor;
        const marker = isSelected ? p.accent(`${SYM.cursor} `) : '  ';
        const idText = truncate(entry.id, 24);
        const typeText = entry.type ? p.muted(` (${truncate(entry.type, 12)})`) : '';
        const fieldEntries = Object.entries(entry.fields || {});
        const shown = fieldEntries.slice(0, MAX_FIELDS_PER_NOTE);
        const overflow = fieldEntries.length - shown.length;

        return React.createElement(Box, { key: entry.id, flexDirection: 'column' },
            React.createElement(Text, null,
                marker + (isSelected ? p.bold(idText) : p.type(idText)) + typeText
            ),
            ...shown.map(([field, delta]) => {
                const from = delta.from !== null && delta.from !== undefined ? String(delta.from).slice(0, 22) : '—';
                const to   = delta.to   !== null && delta.to   !== undefined ? String(delta.to).slice(0, 22) : '—';
                return React.createElement(Text, { key: field },
                    '    ' + p.muted(pad(field, 16)) + p.faint(from) + p.muted(' → ') + p.primary(to)
                );
            }),
            overflow > 0
                ? React.createElement(Text, null, '    ' + p.faint(`+ ${overflow} more field${overflow === 1 ? '' : 's'}`))
                : null,
            React.createElement(Text, null, '')
        );
    }

    let body;
    if (loading) {
        body = React.createElement(Text, null, p.muted('  loading...'));
    } else if (error) {
        body = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.err('  ' + error)),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint(!splitMode ? '  [Tab] try a different time window' : '  switch panes with [Tab] · use [1-9] to change screens'))
        );
    } else if (!changes.length) {
        body = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null, p.ok(`  ${SYM.ok} No changes since ${sinceDate}`)),
            React.createElement(Text, null, ''),
            React.createElement(Text, null, p.faint(!splitMode ? '  [Tab] try a different time window' : '  switch panes with [Tab] · use [1-9] to change screens'))
        );
    } else {
        body = React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, null,
                '  ' + p.secondary(`${changes.length} note${changes.length === 1 ? '' : 's'} changed`) +
                p.muted(` since ${sinceDate}`) +
                (changes.length > MAX_VISIBLE_NOTES ? p.faint(`  (${winStart + 1}–${Math.min(winStart + MAX_VISIBLE_NOTES, changes.length)} of ${changes.length})`) : '')
            ),
            React.createElement(Text, null, ''),
            ...visibleChanges.map((entry, i) => renderNoteEntry(entry, winStart + i)),
            React.createElement(Text, null,
                p.faint(!splitMode
                    ? '  [j/k] move  [Enter] open in Explorer  [Tab] time window  [Esc/q] back'
                    : '  [j/k] move  [Enter] open in Explorer  [Esc/q] back')
            )
        );
    }

    return React.createElement(Box, { flexDirection: 'column', width: width || '100%', paddingX: 1 },
        React.createElement(Panel, {
            ink,
            title: 'Vault Diff',
            children: React.createElement(Box, { flexDirection: 'column' },
                React.createElement(Text, null, '  ' + windowTabs + (!splitMode ? p.faint('  [Tab] to switch') : '')),
                React.createElement(Text, null, ''),
                body
            )
        })
    );
}

Diff.TIME_WINDOWS = TIME_WINDOWS;
Diff.windowToSince = windowToSince;

module.exports = Diff;
