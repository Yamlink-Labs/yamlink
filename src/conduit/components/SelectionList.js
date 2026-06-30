'use strict';

const React = require('react');

function computeWindow(items, cursor, maxVisible = 12) {
    const total = Array.isArray(items) ? items.length : 0;
    const limit = Math.max(1, Number(maxVisible) || 12);
    if (!total) {
        return { start: 0, end: 0, items: [] };
    }
    if (total <= limit) {
        return { start: 0, end: total, items: items.slice(0, total) };
    }

    const safeCursor = Math.max(0, Math.min(Number(cursor) || 0, total - 1));
    const half = Math.floor(limit / 2);
    let start = Math.max(0, safeCursor - half);
    let end = start + limit;

    if (end > total) {
        end = total;
        start = Math.max(0, end - limit);
    }

    return { start, end, items: items.slice(start, end) };
}

function SelectionList({ ink, items, cursor, maxVisible = 12, renderItem, emptyText = '(empty)' }) {
    const { Box, Text } = ink;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
        return React.createElement(Text, null, String(emptyText));
    }

    const windowed = computeWindow(list, cursor, maxVisible);
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        windowed.items.map((item, offset) => {
            const index = windowed.start + offset;
            const isSelected = index === Math.max(0, Math.min(Number(cursor) || 0, list.length - 1));
            return React.createElement(Box, { key: `selection-row-${index}`, flexDirection: 'row' }, renderItem(item, index, isSelected));
        })
    );
}

SelectionList.computeWindow = computeWindow;

module.exports = SelectionList;
