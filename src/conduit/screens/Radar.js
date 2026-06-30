'use strict';

const React = require('react');
const { p, SYM, termWidth } = require('../palette');

const ASPECT = 0.5;    // y-radius = x-radius * ASPECT (corrects for tall terminal chars)
const CANVAS_H = 18;   // fixed canvas height in rows
const MAX_INNER = 10;  // max nodes on inner ring
const MAX_OUTER = 14;  // max nodes on outer ring

function trunc(text, w) {
    const s = String(text || '');
    return s.length <= w ? s : s.slice(0, w - 1) + '…';
}

// BFS from centerId to assign depth to each node in the neighborhood
function buildDepthMap(centerId, edges) {
    const depths = new Map([[centerId, 0]]);
    const queue = [centerId];
    while (queue.length) {
        const curr = queue.shift();
        const d = depths.get(curr);
        if (d >= 2) continue;
        for (const e of edges) {
            const neighbor = e.from === curr ? e.to : (e.to === curr ? e.from : null);
            if (neighbor && !depths.has(neighbor)) {
                depths.set(neighbor, d + 1);
                queue.push(neighbor);
            }
        }
    }
    return depths;
}

// True if centerId has an outbound edge to nodeId
function isOutbound(centerId, edges, nodeId) {
    return edges.some((e) => e.from === centerId && e.to === nodeId);
}

// Arrange nodes on a ring segment. outbound→right half, inbound→left half.
function arrangeInnerRing(centerId, nodes, edges) {
    const out = nodes.filter((n) => isOutbound(centerId, edges, n.id));
    const inn = nodes.filter((n) => !isOutbound(centerId, edges, n.id));

    const positioned = [];

    // Outbound: right half, -π/2 to π/2 (top → bottom clockwise)
    for (let i = 0; i < out.length; i++) {
        const angle = out.length === 1
            ? 0
            : (-Math.PI / 2) + (Math.PI * i) / (out.length - 1);
        positioned.push({ ...out[i], angle, dir: 'out' });
    }

    // Inbound: left half, π/2 to 3π/2 (bottom → top clockwise)
    for (let i = 0; i < inn.length; i++) {
        const angle = inn.length === 1
            ? Math.PI
            : (Math.PI / 2) + (Math.PI * i) / (inn.length - 1);
        positioned.push({ ...inn[i], angle, dir: 'in' });
    }

    return positioned;
}

// Arrange outer ring evenly spaced
function arrangeOuterRing(nodes) {
    return nodes.map((node, i) => {
        const angle = (2 * Math.PI * i) / Math.max(1, nodes.length) - Math.PI / 2;
        return { ...node, angle, dir: 'any' };
    });
}

// Render the radial canvas as an array of row strings with embedded ANSI
function renderCanvas(centerId, layout, ringFocus, safeCursor) {
    const w = termWidth();
    const h = CANVAS_H;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const R1 = Math.min(12, Math.floor(w / 7));
    const R2 = Math.min(24, Math.floor(w / 3.5));

    // Grid of {char, color} cells
    const grid = Array.from({ length: h }, () =>
        Array.from({ length: w }, () => ({ char: ' ', color: null }))
    );

    // Draw a dot-line from (x0,y0) to (x1,y1) — only fills empty cells
    const drawLine = (x0, y0, x1, y1) => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        if (steps <= 1) return;
        for (let i = 1; i < steps; i++) {
            const lx = Math.round(x0 + dx * i / steps);
            const ly = Math.round(y0 + dy * i / steps);
            if (ly >= 0 && ly < h && lx >= 0 && lx < w && grid[ly][lx].char === ' ') {
                grid[ly][lx] = { char: '·', color: 'faint' };
            }
        }
    };

    // Place text centered at (x,y), clamped to grid bounds
    const placeText = (x, y, text, color) => {
        if (y < 0 || y >= h) return;
        const startX = Math.max(0, Math.min(x - Math.floor(text.length / 2), w - text.length));
        for (let i = 0; i < text.length && startX + i < w; i++) {
            grid[y][startX + i] = { char: text[i], color };
        }
    };

    // 1. Draw spoke lines first (nodes will paint over them)
    if (layout) {
        for (const node of layout.inner) {
            const nx = Math.round(cx + R1 * Math.cos(node.angle));
            const ny = Math.round(cy + R1 * ASPECT * Math.sin(node.angle));
            drawLine(cx, cy, nx, ny);
        }
        for (const node of layout.outer) {
            const nx = Math.round(cx + R2 * Math.cos(node.angle));
            const ny = Math.round(cy + R2 * ASPECT * Math.sin(node.angle));
            drawLine(cx, cy, nx, ny);
        }
    }

    // 2. Place center node
    const centerText = '◉ ' + trunc(centerId, 16);
    placeText(cx, cy, centerText, 'accent');

    // 3. Place inner ring nodes
    if (layout) {
        for (let i = 0; i < layout.inner.length; i++) {
            const node = layout.inner[i];
            const nx = Math.round(cx + R1 * Math.cos(node.angle));
            const ny = Math.round(cy + R1 * ASPECT * Math.sin(node.angle));
            const isSel = ringFocus === 'inner' && i === safeCursor;
            const dirSym = node.dir === 'out' ? '→' : '←';
            const sym = isSel ? SYM.selected + ' ' : dirSym + ' ';
            const label = sym + trunc(node.id, 12);
            placeText(nx, ny, label, isSel ? 'accent' : (node.dir === 'out' ? 'ok' : 'type'));
        }

        // 4. Place outer ring nodes
        for (let i = 0; i < layout.outer.length; i++) {
            const node = layout.outer[i];
            const nx = Math.round(cx + R2 * Math.cos(node.angle));
            const ny = Math.round(cy + R2 * ASPECT * Math.sin(node.angle));
            const isSel = ringFocus === 'outer' && i === safeCursor;
            const label = (isSel ? SYM.selected + ' ' : '· ') + trunc(node.id, 10);
            placeText(nx, ny, label, isSel ? 'accent' : 'muted');
        }
    }

    // 5. Convert grid rows to colored strings
    const rows = [];
    for (let y = 0; y < h; y++) {
        let rowStr = '';
        let runColor = null;
        let runText = '';

        const flush = () => {
            if (!runText) return;
            if (runColor === 'accent') rowStr += p.accent(runText);
            else if (runColor === 'ok')     rowStr += p.ok(runText);
            else if (runColor === 'type')   rowStr += p.type(runText);
            else if (runColor === 'muted')  rowStr += p.muted(runText);
            else if (runColor === 'faint')  rowStr += p.faint(runText);
            else rowStr += runText;
            runText = '';
        };

        for (const cell of grid[y]) {
            if (cell.color !== runColor) {
                flush();
                runColor = cell.color;
            }
            runText += cell.char;
        }
        flush();
        rows.push(rowStr);
    }
    return rows;
}

function Radar({ ink, host, port, centerId, getNeighborhood, onNavigate, onQuit, disabled, width }) {
    const { Box, Text, useInput } = ink;

    const [data, setData] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const [ringFocus, setRingFocus] = React.useState('inner');
    const [cursor, setCursor] = React.useState(0);

    React.useEffect(() => {
        if (!centerId) {
            setLoadError('no note selected — launch Radar from Explorer with [r]');
            setLoading(false);
            return;
        }
        setLoading(true);
        setLoadError('');
        getNeighborhood({ host, port, id: centerId, depth: 2 })
            .then((result) => { setData(result); setLoading(false); })
            .catch((err) => { setLoadError(err.message || String(err)); setLoading(false); });
    }, [centerId, getNeighborhood, host, port]);

    const layout = React.useMemo(() => {
        if (!data) return null;
        const { nodes = [], edges = [] } = data;
        const depths = buildDepthMap(centerId, edges);

        const inner = nodes
            .filter((n) => n.id !== centerId && depths.get(n.id) === 1)
            .slice(0, MAX_INNER);
        const outer = nodes
            .filter((n) => n.id !== centerId && depths.get(n.id) === 2)
            .slice(0, MAX_OUTER);

        return {
            inner: arrangeInnerRing(centerId, inner, edges),
            outer: arrangeOuterRing(outer),
            edges
        };
    }, [data, centerId]);

    const innerRing = layout?.inner || [];
    const outerRing = layout?.outer || [];
    const ringNodes = ringFocus === 'inner' ? innerRing : outerRing;
    const safeCursor = ringNodes.length > 0 ? Math.max(0, Math.min(cursor, ringNodes.length - 1)) : 0;
    const selectedNode = ringNodes[safeCursor] || null;

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }
        if (key.escape || input === 'q') {
            if (centerId) onNavigate('explorer', { noteId: centerId });
            else onNavigate('briefing');
            return;
        }
        if (input === 'h' || key.leftArrow) {
            if (ringNodes.length > 0) setCursor((c) => (c === 0 ? ringNodes.length - 1 : c - 1));
            return;
        }
        if (input === 'l' || key.rightArrow) {
            if (ringNodes.length > 0) setCursor((c) => (c + 1) % ringNodes.length);
            return;
        }
        if (input === 'j' || key.downArrow) {
            setRingFocus((f) => f === 'inner' ? 'outer' : 'inner');
            setCursor(0);
            return;
        }
        if (input === 'k' || key.upArrow) {
            setRingFocus((f) => f === 'inner' ? 'outer' : 'inner');
            setCursor(0);
            return;
        }
        if (key.return && selectedNode) {
            onNavigate('explorer', { noteId: selectedNode.id });
            return;
        }
        if (input === '1') { onNavigate('briefing'); return; }
        if (input === '2') { onNavigate('query'); return; }
        if (input === '3') { onNavigate('navigator'); return; }
        if (input === '4') { onNavigate('explorer'); return; }
        if (input === '5') { onNavigate('health'); return; }
        if (input === '6') { onNavigate('search'); return; }
        if (input === '7') { onNavigate('graph'); return; }
        if (input === '8') { onNavigate('diff'); return; }
    }, { isActive: !disabled });

    // Title
    const titleNote = centerId ? p.accent(trunc(centerId, 28)) : p.faint('—');
    const titleCounts = layout
        ? p.faint(`  ${innerRing.length} direct · ${outerRing.length} nearby`)
        : '';
    const titleLine = p.muted('RADAR') + '  ' + titleNote + titleCounts;

    // Status line
    let statusLine;
    if (!selectedNode || !layout) {
        statusLine = p.faint('[h/l] rotate ring  [j/k] switch ring  [↵] open note  [Esc/q] back');
    } else {
        const dir = selectedNode.dir === 'out' ? p.ok('→ outbound') : (selectedNode.dir === 'in' ? p.type('← inbound') : p.muted('· nearby'));
        const ring = ringFocus === 'inner' ? p.secondary('inner') : p.muted('outer');
        const type = selectedNode.type ? '  ' + p.type(selectedNode.type) : '';
        statusLine = p.accent(trunc(selectedNode.id, 22)) + type + '  ' + dir + '  ' + ring + '  ' + p.faint('[h/l] rotate  [j/k] ring  [↵] open  [Esc/q] back');
    }

    // Content
    let content;
    if (loading) {
        content = [React.createElement(Text, { key: 'load' }, p.muted(`  ${SYM.idle}  loading...`))];
    } else if (loadError) {
        content = [React.createElement(Text, { key: 'err' }, p.err(`  ${SYM.err}  ${loadError}`))];
    } else if (!layout || (innerRing.length === 0 && outerRing.length === 0)) {
        content = [React.createElement(Text, { key: 'iso' }, p.faint(`  ○  ${centerId || '—'} has no connections`))];
    } else {
        const canvasRows = renderCanvas(centerId, layout, ringFocus, safeCursor);
        content = canvasRows.map((row, i) => React.createElement(Text, { key: `r${i}` }, row));
    }

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1 },
        React.createElement(Text, null, titleLine),
        React.createElement(Text, null, ''),
        React.createElement(Box, { flexDirection: 'column' }, ...content),
        React.createElement(Text, null, ''),
        React.createElement(Text, null, statusLine)
    );
}

// Export pure functions for testing
Radar.buildDepthMap = buildDepthMap;
Radar.isOutbound = isOutbound;
Radar.arrangeInnerRing = arrangeInnerRing;
Radar.arrangeOuterRing = arrangeOuterRing;

module.exports = Radar;
