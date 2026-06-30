'use strict';

const React = require('react');
const { p } = require('../palette');

// Braille canvas renderer
// Each braille char = 2px wide × 4px tall
// Dot bit layout:
//   col 0  col 1
//   0x01   0x08  (row 0)
//   0x02   0x10  (row 1)
//   0x04   0x20  (row 2)
//   0x40   0x80  (row 3)
const DOT_BITS = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
];

function makeBrailleCanvas(W, H) {
    const pixW = W * 2;
    const pixH = H * 4;
    const grid = Array.from({ length: pixH }, () => new Uint8Array(pixW));

    const set = (x, y) => {
        if (x >= 0 && x < pixW && y >= 0 && y < pixH) grid[y][x] = 1;
    };

    const line = (x0, y0, x1, y1, nodes) => {
        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = x0 < x1 ? 1 : -1;
        let sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        let cx = x0;
        let cy = y0;
        while (true) {
            const skip = nodes && nodes.some((n) => {
                const dist = Math.sqrt((cx - n.x) ** 2 + (cy - n.y) ** 2);
                return dist < n.r - 0.5;
            });
            if (!skip) set(cx, cy);
            if (cx === x1 && cy === y1) break;
            const e2 = err * 2;
            if (e2 > -dy) { err -= dy; cx += sx; }
            if (e2 < dx) { err += dx; cy += sy; }
        }
    };

    const circle = (cx, cy, r) => {
        let x = r;
        let y = 0;
        let p2 = 1 - r;
        while (x >= y) {
            set(cx + x, cy + y); set(cx - x, cy + y);
            set(cx + x, cy - y); set(cx - x, cy - y);
            set(cx + y, cy + x); set(cx - y, cy + x);
            set(cx + y, cy - x); set(cx - y, cy - x);
            y++;
            if (p2 <= 0) { p2 += 2 * y + 1; }
            else { x--; p2 += 2 * y - 2 * x + 1; }
        }
    };

    const render = () => {
        const rows = [];
        for (let charY = 0; charY < H; charY++) {
            let s = '';
            for (let charX = 0; charX < W; charX++) {
                let bits = 0;
                for (let ry = 0; ry < 4; ry++) {
                    for (let rx = 0; rx < 2; rx++) {
                        if (grid[charY * 4 + ry][charX * 2 + rx]) {
                            bits |= DOT_BITS[ry][rx];
                        }
                    }
                }
                s += String.fromCodePoint(0x2800 + bits);
            }
            rows.push(s);
        }
        return rows;
    };

    return { set, line, circle, render };
}

// Generate the Yamlink logo as braille lines.
// Canvas: 8 chars wide × 5 chars tall = 16px × 20px
// Matches real logo: hollow top node, bottom-left node higher than bottom-right
function generateLogo() {
    const canvas = makeBrailleCanvas(8, 5);

    const nodes = [
        { x: 8, y: 2, r: 2 },   // top-center
        { x: 2, y: 13, r: 2 },  // bottom-left (higher)
        { x: 13, y: 17, r: 2 }, // bottom-right (lower)
    ];

    // Draw connecting lines (skip interior of each circle)
    canvas.line(nodes[0].x, nodes[0].y, nodes[1].x, nodes[1].y, nodes);
    canvas.line(nodes[0].x, nodes[0].y, nodes[2].x, nodes[2].y, nodes);
    canvas.line(nodes[1].x, nodes[1].y, nodes[2].x, nodes[2].y, nodes);

    // Draw hollow circles on top
    for (const n of nodes) canvas.circle(n.x, n.y, n.r);

    return canvas.render();
}

const LOGO = generateLogo();

function Logo({ ink }) {
    const { Box, Text } = ink;
    return React.createElement(
        Box,
        { flexDirection: 'column', marginRight: 2 },
        ...LOGO.map((line, i) => React.createElement(Text, { key: `logo-${i}` }, p.accent(line)))
    );
}

function LogoInline({ ink }) {
    const { Text } = ink;
    return React.createElement(Text, null, p.accent(LOGO[2] || ''));
}

module.exports = { Logo, LogoInline, LOGO };
