'use strict';

const React = require('react');
const Panel = require('./Panel');
const { p, SYM, termWidth } = require('../palette');

function pad(text, width) {
    const value = String(text ?? '');
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function truncate(text, width) {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, width - 1) + '…';
}

function buildSearchText(item) {
    return [
        item.label,
        item.description,
        item.detail
    ].filter(Boolean).join(' ').toLowerCase();
}

function CommandPalette({ ink, commands, loading, onClose }) {
    const { Box, Text, useInput } = ink;
    const [query, setQuery] = React.useState('');
    const [cursor, setCursor] = React.useState(0);

    const tw = termWidth();
    const paletteWidth = Math.min(tw - 4, 64);
    const marginLeft = Math.max(0, Math.floor((tw - paletteWidth) / 2));
    const labelWidth = 16;
    const descWidth = paletteWidth - labelWidth - 24;

    const filtered = commands.filter((cmd) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return buildSearchText(cmd).includes(q);
    });
    const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }
        if (key.return) {
            const cmd = filtered[safeCursor];
            if (cmd) { cmd.action(); onClose(); }
            return;
        }
        if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
        if (key.downArrow) { setCursor((c) => Math.min(Math.max(0, filtered.length - 1), c + 1)); return; }
        if (key.backspace || key.delete) { setQuery((q) => q.slice(0, -1)); setCursor(0); return; }
        if (input && input.charCodeAt(0) >= 32) { setQuery((q) => q + input); setCursor(0); return; }
    });

    const listItems = filtered.slice(0, 9).map((cmd, i) => {
        const selected = i === safeCursor;
        const marker = selected ? p.accent(`${SYM.cursor} `) : '  ';
        const label = selected ? p.bold(pad(cmd.label, labelWidth)) : p.primary(pad(cmd.label, labelWidth));
        const desc = p.muted(truncate(cmd.description || '', descWidth));
        const detail = cmd.detail ? '  ' + p.type(truncate(cmd.detail, 18)) : '';
        return React.createElement(Text, { key: cmd.id }, marker + label + desc + detail);
    });

    if (filtered.length === 0) {
        listItems.push(React.createElement(Text, { key: 'empty' }, p.faint(loading ? '  loading...' : '  no matching commands')));
    }

    return React.createElement(
        Box,
        { flexDirection: 'column', marginLeft, marginBottom: 1 },
        React.createElement(Panel, {
            ink,
            title: 'Command',
            width: paletteWidth,
            children: React.createElement(
                Box,
                { flexDirection: 'column' },
                React.createElement(Text, null,
                    '  ' + p.faint(':') + ' ' + p.primary(query) + p.accent('█')
                ),
                React.createElement(Text, null, p.faint('  ' + '─'.repeat(paletteWidth - 6))),
                ...listItems,
                React.createElement(Text, null, ''),
                React.createElement(Text, null, p.faint('  [↑↓] navigate  [Enter] run  [Esc] close'))
            )
        })
    );
}

CommandPalette.buildSearchText = buildSearchText;

module.exports = CommandPalette;
