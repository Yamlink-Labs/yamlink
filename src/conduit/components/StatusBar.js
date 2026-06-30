'use strict';

const React = require('react');
const { p, SYM } = require('../palette');

const SCREEN_LABEL = {
    briefing:  '[1] Briefing',
    query:     '[2] Query',
    navigator: '[3] Navigator',
    explorer:  '[4] Explorer',
    health:    '[5] Health',
    search:    '[6] Search',
    graph:     '[7] Graph',
    diff:      '[8] Diff',
    radar:     '[9] Radar',
};

function StatusBar({ ink, noteCount, connState, host, port, screen, splitMode, paneStatus }) {
    const { Box, Text } = ink;

    const liveSegment = connState === 'live'
        ? p.ok(`${SYM.live} live`)
        : connState === 'disconnected'
            ? p.err(`${SYM.idle} disconnected`)
            : p.warn(`${SYM.idle} connecting`);

    const seg = p.faint(` ${SYM.pipe} `);

    const screenLabel = SCREEN_LABEL[screen] || String(screen || '');

    const left = [
        liveSegment,
        seg,
        p.accent(screenLabel),
        splitMode && paneStatus ? seg + p.secondary(paneStatus) : '',
        seg,
        p.muted('vault: ') + p.secondary(`${host}:${port}`),
        seg,
        p.num(String(Number(noteCount) || 0)) + p.muted(' notes'),
    ].join('');

    const right = [
        p.faint('[?] help'),
        p.faint(` ${SYM.pipe} `),
        p.faint('[1-9] screens'),
        splitMode ? p.faint(` ${SYM.pipe} [Tab] pane`) : '',
        p.faint(` ${SYM.pipe} `),
        p.faint('[Ctrl+C] quit'),
    ].join('');

    return React.createElement(
        Box,
        { justifyContent: 'space-between', width: '100%', paddingX: 1 },
        React.createElement(Text, null, left),
        React.createElement(Text, null, right)
    );
}

module.exports = StatusBar;
