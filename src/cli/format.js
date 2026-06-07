'use strict';

const tty = process.stdout.isTTY;

const c = {
    bold:   s => tty ? `\x1b[1m${s}\x1b[0m`  : s,
    dim:    s => tty ? `\x1b[2m${s}\x1b[0m`  : s,
    green:  s => tty ? `\x1b[32m${s}\x1b[0m` : s,
    yellow: s => tty ? `\x1b[33m${s}\x1b[0m` : s,
    red:    s => tty ? `\x1b[31m${s}\x1b[0m` : s,
    cyan:   s => tty ? `\x1b[36m${s}\x1b[0m` : s,
};

function header(title) {
    console.log('');
    console.log(c.bold(title));
    console.log(c.dim('─'.repeat(Math.min(title.length + 2, 48))));
}

function subheader(title) {
    console.log(c.cyan(title));
}

function row(label, value) {
    const pad = 22;
    const labelStr = String(label);
    const spaces = ' '.repeat(Math.max(1, pad - labelStr.length));
    console.log('  ' + c.dim(labelStr) + spaces + String(value));
}

function blank() {
    console.log('');
}

function ok(s)   { return c.green(s); }
function warn(s) { return c.yellow(s); }
function err(s)  { return c.red(s); }

function table(rows, columns) {
    if (!rows.length) { console.log(c.dim('  (no results)')); return; }
    const widths = columns.map(col =>
        Math.max(col.label.length, ...rows.map(r => String(r[col.key] ?? '').length))
    );
    const head = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ');
    console.log('  ' + c.bold(head));
    console.log('  ' + c.dim(widths.map(w => '─'.repeat(w)).join('  ')));
    for (const r of rows) {
        console.log('  ' + columns.map((col, i) => String(r[col.key] ?? '').padEnd(widths[i])).join('  '));
    }
}

module.exports = { header, subheader, row, blank, table, ok, warn, err, c };
