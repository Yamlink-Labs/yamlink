'use strict';

// Pure, Ink-free graph rendering pipeline for Conduit's Graph screen.
// Splits cleanly into two halves for testability:
//   1. Layout (has randomness on a cold start, via SimpleLayout's seed
//      jitter for nodes with no remembered previous position) — not
//      snapshot-tested for exact values, only smoke-tested.
//   2. Grid projection / collision resolution / rasterization / rendering
//      — fully deterministic given fixed input positions, exactly tested.
//
// This boundary (positions-in, grid-out) is why the render half can be
// tested with exact expected character output despite the layout solver
// itself not being bit-for-bit reproducible run-to-run.

const { SimpleLayout } = require('./simpleLayout');

/**
 * Builds a SimpleLayout-ready {nodes, edges} graph for one note's immediate
 * neighborhood, from the same `_outbound`/`_inbound` composite shapes
 * already fetched by Graph.js (src/api/handlers/nodes.js's
 * buildOutboundComposite/buildInboundComposite: {field, to, toType, toName}
 * and {field, from, fromType, fromName} respectively). A note appearing in
 * both directions (mutual link) is deduped to one node.
 * @param {string} centerNodeId
 * @param {Array<{to: string, toType?: string|null}>} outbound
 * @param {Array<{from: string, fromType?: string|null}>} inbound
 * @returns {{ nodes: Array<{id: string, weight: number, group?: string}>, edges: Array<{source: string, target: string}> }}
 */
function buildNeighborhoodGraph(centerNodeId, outbound, inbound) {
    const nodesById = new Map();
    nodesById.set(centerNodeId, { id: centerNodeId, weight: 1 });

    for (const edge of outbound || []) {
        if (!edge || !edge.to || edge.to === centerNodeId) continue;
        if (!nodesById.has(edge.to)) nodesById.set(edge.to, { id: edge.to, weight: 0.4, group: edge.toType || undefined });
    }
    for (const edge of inbound || []) {
        if (!edge || !edge.from || edge.from === centerNodeId) continue;
        if (!nodesById.has(edge.from)) nodesById.set(edge.from, { id: edge.from, weight: 0.4, group: edge.fromType || undefined });
    }

    const edges = [];
    for (const edge of outbound || []) {
        if (!edge || !edge.to || edge.to === centerNodeId) continue;
        edges.push({ source: centerNodeId, target: edge.to });
    }
    for (const edge of inbound || []) {
        if (!edge || !edge.from || edge.from === centerNodeId) continue;
        edges.push({ source: edge.from, target: centerNodeId });
    }

    return { nodes: [...nodesById.values()], edges };
}

/**
 * Runs the (not-fully-deterministic-on-cold-start) force layout to a
 * settled position set. A fresh SimpleLayout instance per call — Conduit
 * re-derives the neighborhood graph each time the center note changes, so
 * there is no meaningful "previous layout" to carry across calls the way
 * x-graph's live view does.
 * @param {Array<object>} nodes
 * @param {Array<{source: string, target: string}>} edges
 * @returns {Record<string, {x: number, y: number}>}
 */
function computeLayout(nodes, edges) {
    return new SimpleLayout().settleSync(nodes, edges);
}

/**
 * Fits arbitrary-unit layout positions to a terminal character grid,
 * preserving the graph's real proportions rather than independently
 * stretching X and Y to fill the box. `charAspect` corrects for terminal
 * character cells being taller than they are wide (~2:1 height:width is a
 * common approximation) — without it, a circular cluster would render
 * visually stretched tall, since one row of terminal space covers roughly
 * twice the physical height that one column's width covers.
 * @param {Record<string, {x: number, y: number}>} positions
 * @param {{cols: number, rows: number, charAspect?: number}} options
 * @returns {Record<string, {row: number, col: number}>}
 */
function projectPositionsToGrid(positions, { cols, rows, charAspect = 0.5 }) {
    const ids = Object.keys(positions || {});
    if (ids.length === 0) return {};

    const xs = ids.map((id) => positions[id].x);
    const ys = ids.map((id) => positions[id].y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = (maxX - minX) || 1;
    const rangeY = (maxY - minY) || 1;

    const marginCols = 1, marginRows = 1;
    const availCols = Math.max(1, cols - marginCols * 2);
    const availRows = Math.max(1, rows - marginRows * 2);

    // Uniform fit (preserve real shape): pick whichever axis is more
    // constraining, comparing both in the same "visual" unit by folding the
    // character-aspect correction into the vertical comparison.
    const scaleByX = availCols / rangeX;
    const scaleByY = (availRows / charAspect) / rangeY;
    const scale = Math.min(scaleByX, scaleByY);

    const centerCol = cols / 2;
    const centerRow = rows / 2;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    /** @type {Record<string, {row: number, col: number}>} */
    const result = {};
    for (const id of ids) {
        const { x, y } = positions[id];
        const col = Math.round(centerCol + (x - midX) * scale);
        const row = Math.round(centerRow + (y - midY) * scale * charAspect);
        result[id] = {
            row: Math.min(rows - 1, Math.max(0, row)),
            col: Math.min(cols - 1, Math.max(0, col))
        };
    }
    return result;
}

/** @param {number} radius @returns {Array<[number, number]>} */
function spiralOffsets(radius) {
    if (radius === 0) return [[0, 0]];
    /** @type {Array<[number, number]>} */
    const offsets = [];
    for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) === radius) offsets.push([dr, dc]);
        }
    }
    return offsets;
}

/**
 * When two nodes round to the same grid cell (expected at real vault sizes
 * on a small grid), nudges the later one (in insertion order) to the
 * nearest free adjacent cell via a small spiral search, rather than
 * silently overwriting it. Nodes that can't find a free cell within
 * `maxSearchRadius` are reported in `overflowCount`, not dropped silently.
 * @param {Record<string, {row: number, col: number}>} gridPositions
 * @param {{cols: number, rows: number, maxSearchRadius?: number}} options
 * @returns {{ positions: Record<string, {row: number, col: number}>, overflowCount: number }}
 */
function resolveCollisions(gridPositions, { cols, rows, maxSearchRadius = 3 }) {
    const occupied = new Set();
    /** @type {Record<string, {row: number, col: number}>} */
    const resolved = {};
    let overflowCount = 0;

    for (const id of Object.keys(gridPositions || {})) {
        const { row, col } = gridPositions[id];
        let placed = null;
        for (let radius = 0; radius <= maxSearchRadius && !placed; radius++) {
            for (const [dr, dc] of spiralOffsets(radius)) {
                const r = row + dr, c = col + dc;
                if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
                const key = `${r},${c}`;
                if (!occupied.has(key)) {
                    occupied.add(key);
                    placed = { row: r, col: c };
                    break;
                }
            }
        }
        if (placed) resolved[id] = placed;
        else overflowCount += 1;
    }

    return { positions: resolved, overflowCount };
}

/** @param {number} dRow @param {number} dCol @returns {string} */
function pickEdgeChar(dRow, dCol) {
    if (dRow === 0 && dCol === 0) return '·';
    if (Math.abs(dCol) > Math.abs(dRow) * 2) return '─';
    if (Math.abs(dRow) > Math.abs(dCol) * 2) return '│';
    return (dRow > 0) === (dCol > 0) ? '╲' : '╱';
}

/**
 * Bresenham-style grid walk between two cells, picking one directional
 * character for the whole edge from its overall slope (not per-segment —
 * simpler and still legible at terminal resolution). Excludes both
 * endpoints, since nodes are drawn on top of their own cells regardless.
 * @param {{row: number, col: number}} fromCell
 * @param {{row: number, col: number}} toCell
 * @returns {Array<{row: number, col: number, char: string}>}
 */
function rasterizeEdge(fromCell, toCell) {
    const dRow = toCell.row - fromCell.row;
    const dCol = toCell.col - fromCell.col;
    const steps = Math.max(Math.abs(dCol), Math.abs(dRow));
    if (steps === 0) return [];

    const char = pickEdgeChar(dRow, dCol);
    const cells = [];
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        cells.push({
            row: Math.round(fromCell.row + dRow * t),
            col: Math.round(fromCell.col + dCol * t),
            char
        });
    }
    return cells;
}

/**
 * Composes edges and nodes into a final 2D character buffer. Edges are
 * drawn first, nodes drawn on top, so a node is never occluded by its own
 * edge line.
 * @param {{
 *   nodePositions: Record<string, {row: number, col: number}>,
 *   nodeChars: Record<string, string>,
 *   edges: Array<{source: string, target: string}>,
 *   cols: number,
 *   rows: number
 * }} options
 * @returns {{ lines: string[], hitMap: Record<string, string> }} hitMap keys are "row,col"
 */
function renderGraphGrid({ nodePositions, nodeChars, edges, cols, rows }) {
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '));

    for (const edge of edges || []) {
        const from = nodePositions[edge.source];
        const to = nodePositions[edge.target];
        if (!from || !to) continue;
        for (const cell of rasterizeEdge(from, to)) {
            if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) continue;
            grid[cell.row][cell.col] = cell.char;
        }
    }

    /** @type {Record<string, string>} */
    const hitMap = {};
    for (const id of Object.keys(nodePositions || {})) {
        const { row, col } = nodePositions[id];
        if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
        grid[row][col] = (nodeChars && nodeChars[id]) || '●';
        hitMap[`${row},${col}`] = id;
    }

    return { lines: grid.map((row) => row.join('')), hitMap };
}

/** @param {string} text @param {number} maxLen @returns {string} */
function truncateLabel(text, maxLen) {
    const value = String(text || '');
    if (value.length <= maxLen) return value;
    if (maxLen <= 1) return value.slice(0, maxLen);
    return value.slice(0, maxLen - 1) + '…';
}

/**
 * Builds one deduped node record per visible neighbor. If a note appears on
 * both sides of the relationship, the rendered marker becomes mutual instead
 * of drawing two competing labels.
 * @param {Array<any>} outbound
 * @param {Array<any>} inbound
 * @returns {Array<{id: string, type: string, inbound: boolean, outbound: boolean, fields: string[]}>}
 */
function buildNeighborRecords(outbound, inbound) {
    const records = new Map();
    for (const edge of outbound || []) {
        if (!edge || !edge.to) continue;
        const record = records.get(edge.to) || { id: edge.to, type: edge.toType || '', inbound: false, outbound: false, fields: [] };
        record.outbound = true;
        if (edge.toType && !record.type) record.type = edge.toType;
        if (edge.field) record.fields.push(edge.field);
        records.set(edge.to, record);
    }
    for (const edge of inbound || []) {
        if (!edge || !edge.from) continue;
        const record = records.get(edge.from) || { id: edge.from, type: edge.fromType || '', inbound: false, outbound: false, fields: [] };
        record.inbound = true;
        if (edge.fromType && !record.type) record.type = edge.fromType;
        if (edge.field) record.fields.push(edge.field);
        records.set(edge.from, record);
    }
    return [...records.values()].sort((a, b) => {
        const scoreA = Number(a.inbound && a.outbound) * 3 + Number(a.outbound) + Number(a.inbound);
        const scoreB = Number(b.inbound && b.outbound) * 3 + Number(b.outbound) + Number(b.inbound);
        if (scoreA !== scoreB) return scoreB - scoreA;
        const typeDiff = String(a.type || '').localeCompare(String(b.type || ''));
        if (typeDiff !== 0) return typeDiff;
        return a.id.localeCompare(b.id);
    });
}

/**
 * Allocates up to eight readable lanes around the focused note. A terminal
 * graph needs traceable routes more than geometric purity, so every visible
 * neighbor gets a clear row that runs into the center card.
 * @param {number} cols
 * @param {number} rows
 * @param {number} count
 * @returns {Array<{side: string, row: number, labelCol: number, labelWidth: number}>}
 */
function buildConstellationAnchors(cols, rows, count) {
    const labelWidth = Math.max(20, Math.min(34, Math.floor(cols * 0.3)));
    const centerRow = Math.floor(rows / 2);
    const centerCol = Math.floor(cols / 2);
    const leftLabel = Math.max(1, centerCol - labelWidth - 18);
    const rightLabel = Math.min(cols - labelWidth - 1, centerCol + 18);
    const top = Math.max(0, centerRow - 6);
    const upper = Math.max(0, centerRow - 3);
    const lower = Math.min(rows - 2, centerRow + 3);
    const bottom = Math.min(rows - 2, centerRow + 6);

    return [
        { side: 'left', row: top, labelCol: leftLabel, labelWidth },
        { side: 'right', row: top, labelCol: rightLabel, labelWidth },
        { side: 'right', row: upper, labelCol: rightLabel, labelWidth },
        { side: 'right', row: lower, labelCol: rightLabel, labelWidth },
        { side: 'right', row: bottom, labelCol: rightLabel, labelWidth },
        { side: 'left', row: bottom, labelCol: leftLabel, labelWidth },
        { side: 'left', row: lower, labelCol: leftLabel, labelWidth },
        { side: 'left', row: upper, labelCol: leftLabel, labelWidth },
    ].slice(0, count);
}

/** @param {{inbound: boolean, outbound: boolean}} record @returns {string} */
function neighborMarker(record) {
    if (record.inbound && record.outbound) return '↔';
    if (record.inbound) return '←';
    return '→';
}

/** @param {{id: string, type?: string, fields?: string[]}} record @param {number} width @returns {string} */
function neighborLabel(record, width) {
    return truncateLabel(record.id, width);
}

/** @param {string[]} values @returns {string[]} */
function uniqueValues(values) {
    return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

// Same 8-hex rotating palette as VS Code's x-graph (src/features/graph/graphModel.js's
// `palette` array) — duplicated deliberately rather than imported, since Conduit must
// never import Yamlink internals (it only talks to the local API). Keeping the literal
// values identical means the same note type reads as the same color on both surfaces.
const TYPE_PALETTE = ['#58a6ff', '#3fb950', '#ffa657', '#f778ba', '#a371f7', '#39d3f2', '#c4e449', '#db61a2'];

/**
 * Assigns each distinct, non-empty type a color from `TYPE_PALETTE` in
 * first-seen order (wrapping once there are more types than palette
 * entries), matching `graphModel.js`'s exact `palette[typeColors.size % palette.length]`
 * assignment rule.
 * @param {Array<{type?: string}>} records
 * @returns {Map<string, string>}
 */
function assignTypeColors(records) {
    const typeColors = new Map();
    for (const record of records || []) {
        const type = String(record?.type || '').trim();
        if (!type || typeColors.has(type)) continue;
        typeColors.set(type, TYPE_PALETTE[typeColors.size % TYPE_PALETTE.length]);
    }
    return typeColors;
}

/** @param {{id: string, type?: string, fields?: string[]}} record @param {number} width @returns {string} */
function neighborEvidence(record, width) {
    const parts = [];
    if (record.type) parts.push(record.type);
    const fields = uniqueValues(record.fields).slice(0, 3);
    if (fields.length) parts.push(`via ${fields.join(', ')}`);
    return truncateLabel(parts.join(' · ') || 'linked note', width);
}

/** @param {string[]} lines @param {{row: number, col: number, text: string, clear?: boolean}} placement */
function writeText(lines, placement) {
    const grid = lines.map((line) => line.split(''));
    const { row, col, text, clear } = placement;
    if (row < 0 || row >= grid.length) return lines;
    if (clear) {
        for (let i = -1; i <= text.length; i++) {
            const c = col + i;
            if (c >= 0 && c < grid[row].length) grid[row][c] = ' ';
        }
    }
    for (let i = 0; i < text.length; i++) {
        const c = col + i;
        if (c >= 0 && c < grid[row].length) grid[row][c] = text[i];
    }
    return grid.map((rowChars) => rowChars.join(''));
}

/** @param {string[]} lines @param {{row: number, col: number, title: string}} card */
function writeCenterCard(lines, { row, col, title }) {
    const label = ` ${truncateLabel(title, 18)} `;
    const width = label.length + 2;
    const left = Math.max(0, col - Math.floor(width / 2));
    const top = Math.max(0, row - 1);
    let next = lines;
    next = writeText(next, { row: top, col: left, text: `╭${'─'.repeat(label.length)}╮`, clear: true });
    next = writeText(next, { row: top + 1, col: left, text: `│${label}│`, clear: true });
    next = writeText(next, { row: top + 2, col: left, text: `╰${'─'.repeat(label.length)}╯`, clear: true });
    return { lines: next, hitRow: top + 1, hitCol: left + Math.floor(width / 2), left, right: left + width - 1, top, bottom: top + 2 };
}

/** @param {string[]} lines @param {{row: number, fromCol: number, toCol: number, marker: string}} lane */
function writeLane(lines, { row, fromCol, toCol, marker }) {
    const start = Math.min(fromCol, toCol);
    const end = Math.max(fromCol, toCol);
    if (end <= start) return lines;
    const width = end - start + 1;
    const line = '─'.repeat(width);
    let next = writeText(lines, { row, col: start, text: line });
    next = writeText(next, { row, col: fromCol, text: '●' });
    next = writeText(next, { row, col: toCol, text: marker });
    return next;
}

/** @param {string[]} lines @param {{col: number, top: number, bottom: number, junctionRows?: number[], junctionChar?: string}} bus */
function writeBus(lines, { col, top, bottom, junctionRows = [], junctionChar = '┤' }) {
    let next = lines;
    for (let row = top; row <= bottom; row++) {
        next = writeText(next, { row, col, text: '│' });
    }
    for (const row of junctionRows) {
        next = writeText(next, { row, col, text: junctionChar });
    }
    return next;
}

/** @param {string[]} lines @param {{row: number, leftBus: number, cardLeft: number, cardRight: number, rightBus: number, hasLeft?: boolean, hasRight?: boolean}} bridge */
function writeCenterBridge(lines, { row, leftBus, cardLeft, cardRight, rightBus, hasLeft = true, hasRight = true }) {
    let next = lines;
    const leftWidth = Math.max(0, cardLeft - leftBus - 2);
    const rightWidth = Math.max(0, rightBus - cardRight - 2);
    if (hasLeft) next = writeText(next, { row, col: leftBus, text: `├${'─'.repeat(leftWidth)}▶` });
    if (hasRight) next = writeText(next, { row, col: cardRight + 1, text: `◀${'─'.repeat(rightWidth)}┤` });
    return next;
}

/**
 * Terminal-native constellation graph: the focused note stays in the center,
 * neighbor labels live on the perimeter, and edges route through the open
 * middle. This preserves the "graph" feeling without letting labels overlap.
 * @param {{centerNodeId: string, outbound: Array, inbound: Array, cols: number, rows: number}} options
 * @returns {{lines: string[], hitMap: Record<string,string>, overflowCount: number, labeledCount: number, unlabeledCount: number, legend: Array<{type: string, color: string}>, labelColors: Array<{row: number, col: number, length: number, color: string}>}}
 */
function buildConstellationGraphView({ centerNodeId, outbound, inbound, cols, rows }) {
    const safeCols = Math.max(32, cols || 80);
    const safeRows = Math.max(10, rows || 18);
    const center = { row: Math.floor(safeRows / 2), col: Math.floor(safeCols / 2) };
    const records = buildNeighborRecords(outbound, inbound).filter((record) => record.id !== centerNodeId);
    const visualLimit = safeRows >= 14 ? 8 : Math.min(6, Math.max(4, Math.floor(safeRows * 0.35)));
    const anchors = buildConstellationAnchors(safeCols, safeRows, Math.min(records.length, visualLimit));
    const visible = records.slice(0, anchors.length);
    let lines = Array.from({ length: safeRows }, () => ' '.repeat(safeCols));
    /** @type {Record<string, string>} */
    const hitMap = {};

    const centerCard = writeCenterCard(lines, { row: center.row, col: center.col, title: centerNodeId });
    const cardLeft = centerCard.left;
    const cardRight = centerCard.right;
    const leftBus = Math.max(0, cardLeft - 3);
    const rightBus = Math.min(safeCols - 1, cardRight + 3);
    visible.forEach((record, index) => {
        const anchor = anchors[index];
        const leftSide = anchor.side === 'left';
        const labelEdge = leftSide ? anchor.labelCol + anchor.labelWidth + 2 : anchor.labelCol - 4;
        const busEdge = leftSide ? leftBus : rightBus;
        const laneMarker = leftSide ? '▶' : '◀';
        lines = writeLane(lines, { row: anchor.row, fromCol: labelEdge, toCol: busEdge, marker: laneMarker });
        hitMap[`${anchor.row},${anchor.labelCol}`] = record.id;
    });

    if (visible.length > 0) {
        const leftRows = visible.map((_, index) => anchors[index]).filter((anchor) => anchor.side === 'left').map((anchor) => anchor.row);
        const rightRows = visible.map((_, index) => anchors[index]).filter((anchor) => anchor.side === 'right').map((anchor) => anchor.row);
        if (leftRows.length) {
            lines = writeBus(lines, {
                col: leftBus,
                top: Math.min(center.row, ...leftRows),
                bottom: Math.max(center.row, ...leftRows),
                junctionRows: leftRows,
                junctionChar: '┤'
            });
        }
        if (rightRows.length) {
            lines = writeBus(lines, {
                col: rightBus,
                top: Math.min(center.row, ...rightRows),
                bottom: Math.max(center.row, ...rightRows),
                junctionRows: rightRows,
                junctionChar: '├'
            });
        }
        lines = writeCenterBridge(lines, {
            row: center.row,
            leftBus,
            cardLeft,
            cardRight,
            rightBus,
            hasLeft: leftRows.length > 0,
            hasRight: rightRows.length > 0
        });
    }

    const drawnCenterCard = writeCenterCard(lines, { row: center.row, col: center.col, title: centerNodeId });
    lines = drawnCenterCard.lines;
    hitMap[`${drawnCenterCard.hitRow},${drawnCenterCard.hitCol}`] = centerNodeId;

    const typeColors = assignTypeColors(visible);
    const labelColors = [];
    visible.forEach((record, index) => {
        const anchor = anchors[index];
        const prefix = `[${index + 1}] ${neighborMarker(record)} `;
        const name = neighborLabel(record, Math.max(8, anchor.labelWidth - 6));
        const label = prefix + name;
        const evidence = `    ${neighborEvidence(record, Math.max(8, anchor.labelWidth - 4))}`;
        lines = writeText(lines, { row: anchor.row, col: anchor.labelCol, text: label, clear: true });
        lines = writeText(lines, { row: anchor.row + 1, col: anchor.labelCol, text: evidence, clear: true });
        hitMap[`${anchor.row},${anchor.labelCol}`] = record.id;
        hitMap[`${anchor.row + 1},${anchor.labelCol}`] = record.id;

        const color = typeColors.get(String(record.type || '').trim());
        if (color) {
            labelColors.push({ row: anchor.row, col: anchor.labelCol + prefix.length, length: name.length, color });
        }
    });
    const legend = [...typeColors.entries()].map(([type, color]) => ({ type, color }));

    if (records.length === 0) {
        const empty = 'no connections';
        lines = writeText(lines, { row: Math.min(safeRows - 1, center.row + 2), col: Math.max(0, center.col - Math.floor(empty.length / 2)), text: empty });
    }

    const overflowCount = Math.max(0, records.length - visible.length);
    if (overflowCount > 0) {
        const message = `+${overflowCount} more connection${overflowCount === 1 ? '' : 's'} hidden · [v] list shows all`;
        lines = writeText(lines, { row: safeRows - 1, col: Math.max(0, safeCols - message.length), text: message, clear: true });
    }

    return {
        lines: lines.slice(0, safeRows),
        hitMap,
        overflowCount,
        labeledCount: visible.length,
        unlabeledCount: overflowCount,
        legend,
        labelColors
    };
}

/**
 * Places a short text label beside each non-center node — the center is
 * skipped since the screen's own header already names it. Tries the cell
 * two columns to the node's right first (a one-cell gap keeps the label
 * from visually fusing with the node's own marker or an edge passing
 * through it), falling back to the left when the graph runs out of room on
 * the right. A label that can't be placed without overlapping another
 * node's marker or an already-placed label is skipped entirely — the node
 * is still visible and selectable via `hitMap`, just unlabeled — rather
 * than rendering corrupted, overlapping text.
 * @param {Record<string, {row: number, col: number}>} nodePositions
 * @param {Record<string, string>} labels
 * @param {{centerNodeId: string, cols: number, rows: number, maxLabelWidth?: number}} options
 * @returns {Record<string, {row: number, col: number, text: string}>}
 */
function placeLabels(nodePositions, labels, { centerNodeId, cols, rows, maxLabelWidth = 14 }) {
    const occupied = new Set();
    for (const id of Object.keys(nodePositions)) {
        const { row, col } = nodePositions[id];
        occupied.add(`${row},${col}`);
    }

    /** @type {Record<string, {row: number, col: number, text: string}>} */
    const placements = {};
    const center = nodePositions[centerNodeId] || { row: Math.floor(rows / 2), col: Math.floor(cols / 2) };
    for (const id of Object.keys(nodePositions)) {
        if (id === centerNodeId) continue;
        const { row, col } = nodePositions[id];
        if (row < 0 || row >= rows) continue;
        const text = truncateLabel(labels[id] || id, maxLabelWidth);
        if (!text) continue;

        const dRow = row - center.row;
        const dCol = col - center.col;
        const horizontal = Math.abs(dCol) >= Math.abs(dRow);
        const centeredStart = Math.max(0, Math.min(cols - text.length, col - Math.floor(text.length / 2)));
        const candidates = horizontal
            ? [
                { row, col: dCol >= 0 ? col + 2 : col - text.length - 1 },
                { row, col: dCol >= 0 ? col - text.length - 1 : col + 2 },
                { row: row - 1, col: centeredStart },
                { row: row + 1, col: centeredStart }
            ]
            : [
                { row: dRow >= 0 ? row + 1 : row - 1, col: centeredStart },
                { row: dRow >= 0 ? row - 1 : row + 1, col: centeredStart },
                { row, col: dCol >= 0 ? col + 2 : col - text.length - 1 },
                { row, col: dCol >= 0 ? col - text.length - 1 : col + 2 }
            ];

        let placed = null;
        for (const candidate of candidates) {
            if (!candidate || candidate.row < 0 || candidate.row >= rows) continue;
            const startCol = candidate.col;
            if (startCol < 0 || startCol + text.length > cols) continue;
            // Check one cell past each end too (when in bounds) — otherwise
            // two labels can land flush against each other with no gap,
            // which reads as one garbled word instead of two names.
            let fits = true;
            for (let i = -1; i <= text.length; i++) {
                const c = startCol + i;
                if (c < 0 || c >= cols) continue;
                if (occupied.has(`${candidate.row},${c}`)) { fits = false; break; }
            }
            if (fits) { placed = { row: candidate.row, col: startCol, text }; break; }
        }
        if (placed) {
            for (let i = -1; i <= placed.text.length; i++) occupied.add(`${placed.row},${placed.col + i}`);
            placements[id] = placed;
        }
    }
    return placements;
}

/**
 * Overlays placed labels onto an already-rendered grid's lines. Does not
 * mutate the input — `renderGraphGrid`'s own output stays exactly
 * reproducible without labels for callers/tests that don't want them.
 * @param {string[]} lines
 * @param {Record<string, {row: number, col: number, text: string}>} placements
 * @returns {string[]}
 */
function applyLabels(lines, placements) {
    const grid = lines.map((line) => line.split(''));
    for (const id of Object.keys(placements)) {
        const { row, col, text } = placements[id];
        if (row < 0 || row >= grid.length) continue;
        for (let i = 0; i < text.length; i++) {
            const c = col + i;
            if (c < 0 || c >= grid[row].length) continue;
            grid[row][c] = text[i];
        }
    }
    return grid.map((rowChars) => rowChars.join(''));
}

/**
 * Full pipeline, one call: neighborhood graph → layout → grid projection →
 * collision resolution → rendered character grid → node labels. The
 * individual steps above stay independently testable; this is the
 * ergonomic entry point the Ink component actually calls.
 * @param {{centerNodeId: string, outbound: Array, inbound: Array, cols: number, rows: number}} options
 * @returns {{ lines: string[], hitMap: Record<string, string>, overflowCount: number, labeledCount: number, unlabeledCount: number }}
 */
function buildSpatialGraphView({ centerNodeId, outbound, inbound, cols, rows }) {
    return buildConstellationGraphView({ centerNodeId, outbound, inbound, cols, rows });
}

module.exports = {
    buildNeighborhoodGraph,
    computeLayout,
    buildConstellationGraphView,
    assignTypeColors,
    projectPositionsToGrid,
    resolveCollisions,
    rasterizeEdge,
    renderGraphGrid,
    placeLabels,
    applyLabels,
    buildSpatialGraphView
};
