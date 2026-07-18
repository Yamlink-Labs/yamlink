'use strict';

const TTY = process.stdout.isTTY;

const C = {
    mint: '#C5FFBF',
    pink: '#FF429F',
    lavender: '#C49BF0',
    amber: '#E7A85A',
    teal: '#5ECFBE',
    orange: '#E67D61',
    error: '#FF4A6A',
    primary: '#E6E8EB',
    secondary: '#9EA3AA',
    muted: '#666B72',
    faint: '#40454C',
    bgBase: '#151617',
    bgActive: '#2B2D31',
};

function hexToRgb(hex) {
    const normalized = String(hex || '').replace('#', '').trim();
    if (normalized.length !== 6) return [255, 255, 255];
    return [
        Number.parseInt(normalized.slice(0, 2), 16),
        Number.parseInt(normalized.slice(2, 4), 16),
        Number.parseInt(normalized.slice(4, 6), 16)
    ];
}

function colorize(hex, text, options = {}) {
    const value = String(text ?? '');
    if (!TTY) return value;
    const [r, g, b] = hexToRgb(hex);
    const prefix = options.bold ? '\x1b[1m' : '';
    return `${prefix}\x1b[38;2;${r};${g};${b}m${value}\x1b[0m`;
}

const p = {
    accent: (t) => colorize(C.mint, t),
    em: (t) => colorize(C.pink, t),
    type: (t) => colorize(C.lavender, t),
    warn: (t) => colorize(C.amber, t),
    ok: (t) => colorize(C.teal, t),
    date: (t) => colorize(C.orange, t),
    err: (t) => colorize(C.error, t),
    primary: (t) => colorize(C.primary, t),
    secondary: (t) => colorize(C.secondary, t),
    muted: (t) => colorize(C.muted, t),
    faint: (t) => colorize(C.faint, t),
    header: (t) => colorize(C.secondary, String(t ?? '').toUpperCase()),
    bold: (t) => colorize(C.primary, t, { bold: true }),
    section: (t) => colorize(C.mint, '▸ ') + colorize(C.secondary, String(t ?? '').toUpperCase()),
    num: (t) => colorize(C.primary, t, { bold: true }),
    hex: (color, t) => colorize(color, t),
};

function eventTone(type) {
    switch (String(type || '')) {
    case 'note_created': return p.ok;
    case 'note_deleted': return p.err;
    case 'field_added': return p.ok;
    case 'field_changed': return p.warn;
    case 'field_removed': return p.err;
    case 'relation_added': return p.ok;
    case 'relation_changed': return p.type;
    case 'relation_removed': return p.muted;
    case 'type_set': return p.date;
    case 'task_status_changed': return p.accent;
    case 'rebuild': return p.muted;
    default: return p.secondary;
    }
}

function termWidth() {
    return Math.min(process.stdout.columns || 80, 120);
}

const SYM = {
    live: '◉',
    idle: '○',
    ok: '✓',
    err: '✗',
    warn: '⚠',
    collapsed: '▸',
    expanded: '▾',
    relation: '→',
    selected: '▶',
    cursor: '›',
    dot: '·',
    pipe: '│',
};

const BOX = {
    h: '─', v: '│',
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    ml: '├', mr: '┤', mt: '┬', mb: '┴',
    cross: '┼',
    divider: (width) => '─'.repeat(width || termWidth()),
};

module.exports = { C, p, SYM, BOX, eventTone, termWidth };
