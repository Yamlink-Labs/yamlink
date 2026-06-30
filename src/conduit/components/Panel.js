'use strict';

const React = require('react');
const { p } = require('../palette');

function Panel({ ink, title, children, width, flexGrow, height, marginRight, marginLeft, paddingBottom }) {
    const { Box, Text } = ink;

    return React.createElement(
        Box,
        {
            borderStyle: 'single',
            flexDirection: 'column',
            width,
            flexGrow,
            height,
            marginRight,
            marginLeft,
            paddingX: 1,
            paddingBottom: paddingBottom || 0,
        },
        title
            ? React.createElement(
                Box,
                { marginTop: -1 },
                React.createElement(Text, null, ' ' + p.accent('▸') + ' ' + p.header(title) + ' ')
            )
            : null,
        children
    );
}

module.exports = Panel;
