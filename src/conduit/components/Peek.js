'use strict';

const React = require('react');
const Panel = require('./Panel');
const { p, termWidth } = require('../palette');
const { renderNoteDetail } = require('../noteDetail');

function Peek({ ink, note, nodeDetail, intelligence, bodyLines, onClose, onOpen, onEdit, loading, error }) {
    const { Box, Text, useInput } = ink;

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }
        if (input === 'o') { onOpen(); return; }
        if (input === 'e') { onEdit(); return; }
    });

    const width = Math.min(termWidth() - 4, 88);
    const marginLeft = Math.max(0, Math.floor((termWidth() - width) / 2));

    let content = React.createElement(Text, null, p.muted('  loading...'));
    if (error) content = React.createElement(Text, null, p.err('  ' + error));
    else if (!loading && note) {
        content = React.createElement(
            Box,
            { flexDirection: 'column' },
            renderNoteDetail(ink, note, nodeDetail, intelligence, bodyLines),
            React.createElement(Box, { marginTop: 1 },
                React.createElement(Text, null, p.faint('  [o] open in editor  [e] edit in Explorer  [Esc] close'))
            )
        );
    }

    return React.createElement(
        Box,
        { flexDirection: 'column', marginLeft, marginTop: 1 },
        React.createElement(Text, null, p.faint(' '.repeat(Math.max(0, Math.floor(width / 4))))),
        React.createElement(Panel, {
            ink,
            title: 'Peek',
            width,
            children: content
        })
    );
}

module.exports = Peek;
