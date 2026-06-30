'use strict';

const React = require('react');
const { p, SYM } = require('../palette');

const SCREEN_LABEL = {
    briefing: 'Briefing',
    query: 'Query',
    navigator: 'Navigator',
    explorer: 'Explorer',
    health: 'Health',
    search: 'Search',
    graph: 'Graph',
    diff: 'Diff',
    radar: 'Radar',
};

function SplitPane({ ink, pane, isActive, paneIndex, width, children }) {
    const { Box, Text } = ink;
    const label = SCREEN_LABEL[pane?.screen] || String(pane?.screen || 'Pane');
    const side = paneIndex === 0 ? 'L' : 'R';
    return React.createElement(
        Box,
        {
            flexDirection: 'column',
            width,
            borderStyle: isActive ? 'double' : 'single',
            borderColor: isActive ? 'green' : 'gray',
            paddingX: 1
        },
        React.createElement(
            Box,
            { marginBottom: 1 },
            React.createElement(
                Text,
                null,
                isActive
                    ? p.accent(`◉ ${side}  ${label}`) + p.faint(`  ${SYM.pipe} [Tab] switch`)
                    : p.secondary(`○ ${side}  ${label}`)
            )
        ),
        children
    );
}

module.exports = SplitPane;
