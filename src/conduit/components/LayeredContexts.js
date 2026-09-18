'use strict';

const React = require('react');
const { p, SYM } = require('../palette');

function LayeredContexts({ ink, layers }) {
    const { Box, Text } = ink;
    const items = Array.isArray(layers) ? layers.slice(-3) : [];
    if (!items.length) return null;
    return React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 1 },
        React.createElement(Text, null,
            p.faint('contexts ') +
            items.map((layer, index) => {
                const depth = items.length - index;
                return p.faint(`${SYM.pipe} ${'·'.repeat(depth)} ${layer.label || layer.screen}`);
            }).join(' ')
        ),
        React.createElement(Text, null, p.faint('Esc peels back one layer'))
    );
}

module.exports = LayeredContexts;
