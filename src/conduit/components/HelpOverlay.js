'use strict';

const React = require('react');
const { p } = require('../palette');

function pad(text, width) {
    const value = String(text ?? '');
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function HelpOverlay({ ink, bindings, title = 'KEYBOARD SHORTCUTS' }) {
    const { Box, Text } = ink;
    const rows = Array.isArray(bindings) ? bindings : [];
    const keyWidth = rows.reduce((max, row) => Math.max(max, String(row?.key || '').length), 10);

    return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center', marginTop: 1 },
        React.createElement(
            Box,
            { borderStyle: 'single', flexDirection: 'column', paddingX: 2, paddingY: 1, minWidth: 56 },
            React.createElement(Text, null, p.header(title)),
            React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
                rows.map((row, index) => React.createElement(
                    Box,
                    { key: `help-row-${index}`, flexDirection: 'row' },
                    React.createElement(Text, null, p.accent(pad(row.key, keyWidth + 2))),
                    React.createElement(Text, null, p.primary(row.action))
                ))
            ),
            React.createElement(Box, { marginTop: 1 },
                React.createElement(Text, null, p.faint('[?] close'))
            )
        )
    );
}

module.exports = HelpOverlay;
