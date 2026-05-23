import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
    Background,
    BaseEdge,
    Controls,
    EdgeLabelRenderer,
    Handle,
    MarkerType,
    Position,
    ReactFlowProvider,
    useNodes,
    useReactFlow,
    useViewport
} from 'reactflow';
import ELK from 'elkjs/lib/elk.bundled.js';
import 'reactflow/dist/style.css';
import canvasModelModule from './graph2CanvasModel.js';

const { buildGraph2CanvasModel } = canvasModelModule;
const elk = new ELK();

// ── Geometry utilities ───────────────────────────────────────────────────────

function circleBorderPoint(cx, cy, r, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return { x: cx + r, y: cy };
    return { x: cx + dx * r / dist, y: cy + dy * r / dist };
}

function normalFromCenter(cx, cy, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return { x: 1, y: 0 };
    return { x: dx / dist, y: dy / dist };
}

// Point where the line from (cx,cy) toward (tx,ty) exits the rectangle
// with half-extents (w/2, h/2) centered at (cx,cy).
function rectBorderPoint(cx, cy, w, h, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < 0.01 && ady < 0.01) return { x: cx, y: cy };
    const hw = w / 2;
    const hh = h / 2;
    const tX = adx > 0 ? hw / adx : Infinity;
    const tY = ady > 0 ? hh / ady : Infinity;
    const t = Math.min(tX, tY);
    return { x: cx + dx * t, y: cy + dy * t };
}

// Outward unit normal at the boundary point computed above.
function rectBorderNormal(cx, cy, w, h, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const hw = w / 2;
    const hh = h / 2;
    const tX = adx > 0 ? hw / adx : Infinity;
    const tY = ady > 0 ? hh / ady : Infinity;
    if (tX <= tY) return { x: dx >= 0 ? 1 : -1, y: 0 };
    return { x: 0, y: dy >= 0 ? 1 : -1 };
}

// ── Hull geometry (item 11) ──────────────────────────────────────────────────

function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    const pivot = pts.reduce((b, p) => (p.y < b.y || (p.y === b.y && p.x < b.x)) ? p : b);
    const sorted = pts.filter(p => p !== pivot).sort((a, b) => {
        const da = Math.atan2(a.y - pivot.y, a.x - pivot.x);
        const db = Math.atan2(b.y - pivot.y, b.x - pivot.x);
        return da !== db ? da - db
            : Math.hypot(a.x - pivot.x, a.y - pivot.y) - Math.hypot(b.x - pivot.x, b.y - pivot.y);
    });
    const stack = [pivot, sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        while (stack.length > 1) {
            const a = stack[stack.length - 2], b = stack[stack.length - 1], c = sorted[i];
            if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 0) stack.pop();
            else break;
        }
        stack.push(sorted[i]);
    }
    return stack;
}

function inflateHull(hull, padding) {
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
    return hull.map(p => {
        const d = Math.max(Math.hypot(p.x - cx, p.y - cy), 0.01);
        return { x: p.x + ((p.x - cx) / d) * padding, y: p.y + ((p.y - cy) / d) * padding };
    });
}

function hullToPath(pts) {
    if (!pts.length) return '';
    const n = pts.length;
    const mids = pts.map((p, i) => {
        const q = pts[(i + 1) % n];
        return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    });
    let d = `M ${mids[0].x} ${mids[0].y}`;
    for (let i = 0; i < n; i++) {
        const ctrl = pts[(i + 1) % n];
        const end = mids[(i + 1) % n];
        d += ` Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`;
    }
    return d + ' Z';
}

// ── YamlinkNode ──────────────────────────────────────────────────────────────

const HIDDEN_HANDLE = {
    opacity: 0,
    width: 1,
    height: 1,
    minWidth: 0,
    minHeight: 0,
    border: 'none',
    background: 'transparent'
};

function YamlinkNode({ data }) {
    const tier = data.tier || 'secondary';
    const isPrimary = tier === 'primary';
    const isMinor = tier === 'minor';
    const selRole = data.selectionRole || 'peripheral';
    const isCenter = data.isCenter;
    const isSelected = selRole === 'selected';
    const isNeighbor = selRole === 'neighbor';
    const isPeripheral = !isCenter && !isSelected && !isNeighbor;

    const borderWidth = (isCenter || isSelected) ? 2 : 1;

    const borderColor = isCenter
        ? '#f1d08a'
        : isSelected
            ? '#7cc7ff'
            : isNeighbor
                ? 'rgba(124,199,255,.32)'
                : 'rgba(255,255,255,.06)';

    const bg = isCenter
        ? 'linear-gradient(145deg,#21303f,#263244)'
        : isSelected
            ? 'linear-gradient(145deg,#142030,#192840)'
            : '#111820';

    const shadow = isCenter
        ? '0 0 0 1px rgba(241,208,138,.18), 0 6px 22px rgba(241,208,138,.14)'
        : isSelected
            ? '0 0 0 1px rgba(124,199,255,.16), 0 6px 18px rgba(124,199,255,.12)'
            : isNeighbor
                ? '0 2px 10px rgba(0,0,0,.28)'
                : '0 2px 6px rgba(0,0,0,.2)';

    const labelColor = isCenter
        ? '#f1d08a'
        : isSelected
            ? '#a6d4f8'
            : '#d2dde8';

    const typeColor = isCenter
        ? 'rgba(241,208,138,.5)'
        : isSelected
            ? 'rgba(124,199,255,.55)'
            : 'rgba(149,161,172,.5)';

    const opacity = isPeripheral ? 0.58 : 1;
    const borderRadius = isMinor ? 999 : isPrimary ? 16 : 12;
    const padding = isMinor ? '5px 10px' : isPrimary ? '10px 14px' : '7px 11px';
    const width = data.width;
    const height = data.height;

    return (
        <div style={{
            width,
            height,
            boxSizing: 'border-box',
            padding,
            borderRadius,
            border: `${borderWidth}px solid ${borderColor}`,
            background: bg,
            boxShadow: shadow,
            opacity,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            textAlign: 'center',
            transition: 'opacity 0.18s'
        }}>
            <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
            <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
            {!isMinor && (
                <div style={{
                    fontSize: 9,
                    color: typeColor,
                    textTransform: 'lowercase',
                    letterSpacing: '0.05em',
                    lineHeight: 1
                }}>
                    {data.type}
                </div>
            )}
            <div style={{
                fontSize: isPrimary ? 13 : isMinor ? 10 : 11,
                fontWeight: isPrimary ? 700 : 600,
                lineHeight: 1.2,
                color: labelColor,
                width: '100%',
                ...(isMinor
                    ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                    : { wordBreak: 'break-word' }
                )
            }}>
                {data.label}
            </div>
            {isCenter && data.hiddenNeighborCount > 0 && (
                <button
                    style={{
                        fontSize: 9,
                        color: 'rgba(241,208,138,0.6)',
                        marginTop: 3,
                        lineHeight: 1,
                        letterSpacing: '0.03em',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                        textUnderlineOffset: '2px'
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        window.__graph2post?.('showMoreWorkspace');
                    }}
                >
                    +{data.hiddenNeighborCount} more
                </button>
            )}
        </div>
    );
}

// ── VaultDotNode — small circle dot for vault/domain scope ───────────────────

function VaultDotNode({ data }) {
    const tier = data.tier || 'minor';
    const uiMode = data.uiMode || 'workspace';
    const isSidebarConstellation = uiMode === 'sidebar';
    const isPrimary = tier === 'primary';
    const isSecondary = tier === 'secondary';
    const selRole = data.selectionRole || 'peripheral';
    const isCenter = data.isCenter;
    const isSelected = selRole === 'selected';
    const isNeighbor = selRole === 'neighbor';
    const isPeripheral = !isCenter && !isSelected && !isNeighbor;

    const dotSize = data.dotSize || (isPrimary ? 24 : isSecondary ? 15 : 9);
    const color = data.color || '#79c0ff';

    const glow = isCenter
        ? `0 0 10px ${color}99, 0 0 20px ${color}44`
        : isSelected
            ? `0 0 7px ${color}77`
            : isNeighbor
                ? `0 0 5px ${color}44`
                : isSidebarConstellation && isPrimary
                    ? `0 0 8px ${color}44`
                    : 'none';

    const bg = isCenter
        ? `radial-gradient(circle, ${color}ff 0%, ${color}cc 55%, ${color}77 100%)`
        : `radial-gradient(circle, ${color}ee 0%, ${color}88 100%)`;

    const border = (isCenter || isSelected)
        ? `1.5px solid ${color}`
        : isNeighbor
            ? `1px solid ${color}66`
            : 'none';

    const opacity = isSidebarConstellation
        ? (isPeripheral ? 0.88 : 1)
        : (isPeripheral ? 0.38 : 1);
    const showLabel = isSidebarConstellation
        ? (isPrimary || isSelected || isCenter)
        : (isPrimary || isSelected || isCenter);
    const showSubLabel = isSidebarConstellation
        ? (isSecondary && !isPeripheral && !showLabel)
        : (isSecondary && !isPeripheral);

    return (
        <div style={{ position: 'relative', width: dotSize, height: dotSize }}>
            <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
            <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
            <div style={{
                width: dotSize,
                height: dotSize,
                borderRadius: '50%',
                background: bg,
                boxShadow: glow,
                border,
                opacity,
                transition: 'opacity 0.18s, box-shadow 0.18s'
            }} />
            {showLabel && (
                <div style={{
                    position: 'absolute',
                    top: dotSize + 4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: isSidebarConstellation
                        ? (isPrimary || isCenter ? 10 : 9)
                        : (isPrimary || isCenter ? 10 : 9),
                    fontWeight: isCenter || (isSidebarConstellation && isPrimary) ? 700 : 500,
                    color: isCenter ? color : isSidebarConstellation ? 'rgba(226,236,246,0.92)' : 'rgba(210,221,232,0.82)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    lineHeight: 1,
                    textShadow: isSidebarConstellation
                        ? '0 1px 6px rgba(0,0,0,0.98)'
                        : '0 1px 4px rgba(0,0,0,0.9)'
                }}>
                    {data.label}
                </div>
            )}
            {showSubLabel && !showLabel && (
                <div style={{
                    position: 'absolute',
                    top: dotSize + 3,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 8,
                    color: 'rgba(180,195,210,0.55)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    lineHeight: 1,
                    textShadow: '0 1px 3px rgba(0,0,0,0.9)'
                }}>
                    {data.label}
                </div>
            )}
        </div>
    );
}

// ── TypeHullLayer — type-colored convex hulls (item 11) ─────────────────────
// Rendered as an absolutely-positioned SVG overlay below nodes (z-index:2).
// Uses useViewport() so the SVG transform tracks pan/zoom without React state updates.

function TypeHullLayer({ nodes, isVaultScope }) {
    const { x: vpX, y: vpY, zoom } = useViewport();
    if (!isVaultScope || !nodes.length) return null;
    const isSidebarConstellation = nodes[0]?.data?.uiMode === 'sidebar';

    const byType = new Map();
    for (const node of nodes) {
        const t = node.data?.type;
        if (!t) continue;
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t).push(node);
    }

    const hulls = [];
    for (const [type, typeNodes] of byType) {
        if (typeNodes.length < 3) continue;
        const color = typeNodes[0].data?.color || '#79c0ff';
        const pts = typeNodes.map(n => ({
            x: n.position.x + (n.width || 9) / 2,
            y: n.position.y + (n.height || 9) / 2
        }));
        const hull = convexHull(pts);
        if (hull.length < 3) continue;
        const inflated = inflateHull(hull, isSidebarConstellation ? 34 : 28);
        hulls.push({ type, color, path: hullToPath(inflated) });
    }
    if (!hulls.length) return null;

    return (
        <svg style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 2, overflow: 'visible'
        }}>
            <g transform={`translate(${vpX},${vpY}) scale(${zoom})`}>
                {hulls.map(({ type, color, path }) => (
                    <path key={type} d={path}
                        fill={isSidebarConstellation ? `${color}1d` : `${color}14`}
                        stroke={isSidebarConstellation ? `${color}66` : `${color}44`}
                        strokeWidth={(isSidebarConstellation ? 1.8 : 1.5) / zoom}
                        strokeLinejoin="round"
                    />
                ))}
            </g>
        </svg>
    );
}

// ── YamlinkEdge — floating, bounding-box intersection ───────────────────────
//
// Each edge computes its own entry/exit points by intersecting the straight
// line between node centers with the source and target node rectangles.
// This distributes edges naturally across the node face regardless of how
// many share the same source or target.

function YamlinkEdge({ id, source, target, data, markerEnd }) {
    const nodes = useNodes();
    const sourceNode = nodes.find(n => n.id === source);
    const targetNode = nodes.find(n => n.id === target);
    if (!sourceNode || !targetNode) return null;

    const sw = sourceNode.width || 156;
    const sh = sourceNode.height || 64;
    const tw = targetNode.width || 156;
    const th = targetNode.height || 64;

    // Node origins are top-left (nodeOrigin default [0,0]).
    const scx = sourceNode.position.x + sw / 2;
    const scy = sourceNode.position.y + sh / 2;
    const tcx = targetNode.position.x + tw / 2;
    const tcy = targetNode.position.y + th / 2;

    const isSourceCircle = sourceNode.data?.nodeShape === 'circle';
    const isTargetCircle = targetNode.data?.nodeShape === 'circle';

    const exit  = isSourceCircle
        ? circleBorderPoint(scx, scy, sw / 2, tcx, tcy)
        : rectBorderPoint(scx, scy, sw, sh, tcx, tcy);
    const entry = isTargetCircle
        ? circleBorderPoint(tcx, tcy, tw / 2, scx, scy)
        : rectBorderPoint(tcx, tcy, tw, th, scx, scy);
    const exitN  = isSourceCircle
        ? normalFromCenter(scx, scy, tcx, tcy)
        : rectBorderNormal(scx, scy, sw, sh, tcx, tcy);
    const entryN = isTargetCircle
        ? normalFromCenter(tcx, tcy, scx, scy)
        : rectBorderNormal(tcx, tcy, tw, th, scx, scy);

    const isVault = data.isVaultScope;
    const isSidebarConstellation = data.uiMode === 'sidebar';
    // Bezier tension: proportional to distance, capped for long edges. Reduced for vault dots.
    const dist = Math.hypot(entry.x - exit.x, entry.y - exit.y);
    const tension = isVault
        ? Math.max(12, Math.min(40, dist * 0.18))
        : Math.max(32, Math.min(90, dist * 0.3));

    let cx1 = exit.x + exitN.x * tension;
    let cy1 = exit.y + exitN.y * tension;
    let cx2 = entry.x + entryN.x * tension;
    let cy2 = entry.y + entryN.y * tension;

    // Parallel offset for multiple edges sharing the same source-target pair (item 12).
    const sibCount = data.edgeSiblingCount || 1;
    if (sibCount > 1) {
        const offsetAmount = (data.edgeIndex - (sibCount - 1) / 2) * (isVault ? 6 : 15);
        const ex = entry.x - exit.x;
        const ey = entry.y - exit.y;
        const edgeLen = Math.max(Math.hypot(ex, ey), 1);
        const perpX = -ey / edgeLen;
        const perpY = ex / edgeLen;
        cx1 += perpX * offsetAmount;
        cy1 += perpY * offsetAmount;
        cx2 += perpX * offsetAmount;
        cy2 += perpY * offsetAmount;
    }

    const path = `M ${exit.x} ${exit.y} C ${cx1} ${cy1} ${cx2} ${cy2} ${entry.x} ${entry.y}`;

    const isActive = data.isActivePath;
    const isCenterEdge = data.isCenterEdge;
    const color = data.color || '#79c0ff';

    const strokeWidth = isVault
        ? (isSidebarConstellation
            ? (isActive ? 2.0 : isCenterEdge ? 1.55 : 1.15)
            : (isActive ? 1.8 : isCenterEdge ? 1.3 : 1.0))
        : (isActive ? 2.2 : isCenterEdge ? 1.5 : 1);
    const opacity = isVault
        ? (isSidebarConstellation
            ? (isActive ? 1.0 : isCenterEdge ? 0.82 : 0.68)
            : (isActive ? 1.0 : isCenterEdge ? 0.75 : 0.55))
        : (isActive ? 0.9 : isCenterEdge ? 0.4 : 0.15);

    // Cubic bezier midpoint at t=0.5
    const mx = 0.125 * exit.x + 0.375 * cx1 + 0.375 * cx2 + 0.125 * entry.x;
    const my = 0.125 * exit.y + 0.375 * cy1 + 0.375 * cy2 + 0.125 * entry.y;

    // Tangent at t=0.5 → perpendicular offset so overlapping labels separate.
    // T(0.5) = 0.75*(P3 + P2 - P1 - P0) in component form:
    const tLen = Math.hypot(
        0.75 * (entry.x + cx2 - cx1 - exit.x),
        0.75 * (entry.y + cy2 - cy1 - exit.y)
    );
    const perpX = tLen > 0 ? -0.75 * (entry.y + cy2 - cy1 - exit.y) / tLen : 0;
    const perpY = tLen > 0 ?  0.75 * (entry.x + cx2 - cx1 - exit.x) / tLen : 0;
    const lx = mx + perpX * 13;
    const ly = my + perpY * 13;

    return (
        <>
            <BaseEdge
                path={path}
                markerEnd={markerEnd}
                style={{
                    stroke: color,
                    strokeWidth,
                    opacity,
                    filter: isActive ? `drop-shadow(0 0 3px ${color}55)` : 'none',
                    strokeLinecap: 'round'
                }}
            />
            {!isVault && isActive && data.label && (
                <EdgeLabelRenderer>
                    <div
                        className="nodrag nopan"
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
                            pointerEvents: 'none',
                            background: 'rgba(11,16,22,.88)',
                            border: `1px solid ${color}44`,
                            borderRadius: 5,
                            padding: '2px 6px',
                            fontSize: 10,
                            color: color,
                            letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.4
                        }}
                    >
                        {data.label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

// ── Node / edge type registries (defined outside component for stable refs) ──

const NODE_TYPES = { yamlinkNode: YamlinkNode, vaultDotNode: VaultDotNode };
const EDGE_TYPES = { yamlinkEdge: YamlinkEdge };

// ── Selection role (computed reactively, no round-trip) ──────────────────────

function computeSelectionRole(nodeId, centerId, selectedId, adjacency, hoveredId = null) {
    if (nodeId === centerId) return 'center';
    if (nodeId === selectedId) return 'selected';
    if (hoveredId && nodeId === hoveredId) return 'selected';
    const focusId = selectedId || hoveredId || centerId;
    if (focusId && (adjacency.get(focusId) || new Set()).has(nodeId)) return 'neighbor';
    return 'peripheral';
}

// ── Graph2Renderer ────────────────────────────────────────────────────────────

// Fingerprint of the structural parts of a payload — node/edge identity,
// center, scope. Changes here trigger re-layout; selectedNodeId does not.
function structureKey(payload) {
    const elements = payload?.model?.elements;
    if (!elements) return '';
    const nodeIds = elements
        .filter(e => e?.data?.id && !e?.data?.source)
        .map(e => e.data.id)
        .sort()
        .join('\x00');
    const edgeIds = elements
        .filter(e => e?.data?.source)
        .map(e => `${e.data.source}>${e.data.target}`)
        .sort()
        .join('\x00');
    return `${payload?.centerNodeId}|${payload?.scope}|${payload?.source}|${nodeIds}|${edgeIds}`;
}

function Graph2Renderer({ payload, externalSelectedId, onNodeSelect, onNodeOpen, onSceneChange, fitNonce }) {
    const rf = useReactFlow();
    const [renderModel, setRenderModel] = useState({ nodes: [], edges: [] });
    const [clickedId, setClickedId] = useState(null);
    const [hoveredId, setHoveredId] = useState(null);
    const scope = payload?.scope || 'neighborhood';
    const isVaultScope = scope === 'vault' || scope === 'domain';

    const payloadSelectedId = payload?.selectedNodeId || (!isVaultScope ? payload?.centerNodeId : null) || null;
    // Priority: external selection (Focus button) > direct click > payload
    const selectedId = externalSelectedId !== null && externalSelectedId !== undefined
        ? externalSelectedId
        : (clickedId !== null ? clickedId : payloadSelectedId);

    // Memoize on structural fingerprint so selectedNodeId changes don't re-layout.
    const layoutKey = useMemo(() => structureKey(payload), [payload]);
    const canvasModel = useMemo(
        () => buildGraph2CanvasModel(payload || { model: { elements: [] } }),
        [layoutKey] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Reset click selection when structure changes (new center/scope).
    useEffect(() => { setClickedId(null); }, [layoutKey]);
    // Also clear stale click-selection when the payload no longer carries a selected node.
    useEffect(() => {
        if (payload?.selectedNodeId) return;
        setClickedId(null);
    }, [payload?.selectedNodeId]);

    // Layout runs only when structure changes (canvasModel), not on selection.
    useEffect(() => {
        let cancelled = false;
        layoutCanvasModel(canvasModel, payload).then(next => {
            if (cancelled) return;
            setRenderModel(next);
            queueMicrotask(() => {
                try { rf.fitView({ padding: 0.14, duration: 160, maxZoom: 0.88 }); } catch (_) {}
            });
        });
        return () => { cancelled = true; };
    }, [canvasModel, rf]);

    useEffect(() => {
        if (!fitNonce) return;
        queueMicrotask(() => {
            try { rf.fitView({ padding: 0.14, duration: 200, maxZoom: 0.88 }); } catch (_) {}
        });
    }, [fitNonce, rf]);

    useEffect(() => {
        if (!onSceneChange) return;
        onSceneChange({
            nodes: renderModel.nodes,
            edges: renderModel.edges,
            selectedId,
            centerId: canvasModel.centerId
        });
    }, [renderModel, selectedId, canvasModel.centerId, onSceneChange]);

    const handleNodeSelect = useCallback((nodeId, nodeData) => {
        setClickedId(nodeId);
        if (onNodeSelect) onNodeSelect(nodeId, nodeData);
    }, [onNodeSelect]);

    // Recompute selection roles reactively from selectedId/hoveredId — no layout rerun.
    const nodes = useMemo(() => renderModel.nodes.map(node => ({
        ...node,
        selected: node.id === selectedId,
        type: node.type || 'yamlinkNode',
        draggable: false,
        selectable: true,
        data: {
            ...node.data,
            selectionRole: computeSelectionRole(
                node.id,
                isVaultScope ? null : canvasModel.centerId,
                selectedId,
                canvasModel.adjacency,
                hoveredId
            )
        }
    })), [renderModel.nodes, selectedId, hoveredId, canvasModel, isVaultScope]);

    const edges = useMemo(() => renderModel.edges.map(edge => ({
        ...edge,
        type: 'yamlinkEdge',
        markerEnd: isVaultScope ? {
            type: MarkerType.ArrowClosed,
            color: edge.data.color,
            width: 5,
            height: 5
        } : {
            type: MarkerType.ArrowClosed,
            color: edge.data.color,
            width: 13,
            height: 13
        },
        data: {
            ...edge.data,
            isActivePath: Boolean(
                selectedId
                    ? (edge.source === selectedId || edge.target === selectedId)
                    : hoveredId
                        ? (edge.source === hoveredId || edge.target === hoveredId)
                        : (!isVaultScope && (edge.source === canvasModel.centerId || edge.target === canvasModel.centerId))
            ),
            isCenterEdge: Boolean(
                !isVaultScope && (edge.source === canvasModel.centerId || edge.target === canvasModel.centerId)
            )
        }
    })), [renderModel.edges, selectedId, hoveredId, canvasModel.centerId, isVaultScope]);

    return (
        <>
            {/* Elevate the SVG edge layer above the HTML node layer so edges are never
                hidden by node cards. pointer-events:none preserves node interactions. */}
            <style>{'.react-flow__edges{z-index:500!important;pointer-events:none!important}'}</style>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={(_, node) => handleNodeSelect(node.id, node.data)}
                onNodeDoubleClick={(_, node) => onNodeOpen && onNodeOpen(node.id)}
                onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
                onNodeMouseLeave={() => setHoveredId(null)}
                proOptions={{ hideAttribution: true }}
                minZoom={0.06}
                maxZoom={1.6}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
            >
                <Background color="#1b2530" gap={28} size={1} />
                <Controls position="bottom-left" showInteractive={false} />
            </ReactFlow>
        </>
    );
}

// ── mount ────────────────────────────────────────────────────────────────────

function mount(container, options = {}) {
    const root = createRoot(container);
    const state = {
        payload: null,
        fitNonce: 0,
        externalSelectedId: null,
        callbacks: {
            onNodeSelect: options.onNodeSelect || null,
            onNodeOpen: options.onNodeOpen || null,
            onSceneChange: options.onSceneChange || null
        }
    };

    function render() {
        root.render(
            <React.StrictMode>
                <ReactFlowProvider>
                    <Graph2Renderer
                        payload={state.payload}
                        externalSelectedId={state.externalSelectedId}
                        fitNonce={state.fitNonce}
                        onNodeSelect={state.callbacks.onNodeSelect}
                        onNodeOpen={state.callbacks.onNodeOpen}
                        onSceneChange={state.callbacks.onSceneChange}
                    />
                </ReactFlowProvider>
            </React.StrictMode>
        );
    }

    return {
        update(payload) {
            state.payload = payload;
            state.externalSelectedId = null; // structural update resets external selection
            render();
        },
        // Select a node without triggering re-layout. Used by the Focus button.
        selectNode(nodeId) {
            state.externalSelectedId = nodeId;
            render();
        },
        fit() {
            state.fitNonce += 1;
            render();
        },
        setCallbacks(callbacks = {}) {
            if (callbacks.onNodeSelect) state.callbacks.onNodeSelect = callbacks.onNodeSelect;
            if (callbacks.onNodeOpen)   state.callbacks.onNodeOpen   = callbacks.onNodeOpen;
            if (callbacks.onSceneChange) state.callbacks.onSceneChange = callbacks.onSceneChange;
        },
        destroy() {
            root.unmount();
        }
    };
}

// ── Layout ───────────────────────────────────────────────────────────────────

async function layoutCanvasModel(model, payload) {
    const scope = payload?.scope || 'neighborhood';
    const isQuerySource = payload?.source === 'query';
    const useFocused = (scope === 'local' || scope === 'neighborhood') && !isQuerySource;
    const useVaultForce = (scope === 'vault' || scope === 'domain') && !isQuerySource;

    if (useFocused) return layoutFocusedNeighborhood(model);
    if (useVaultForce) return layoutVaultForce(model);
    return layoutBroadLayered(model, payload);
}

// Vault/domain: pure JS force simulation — all nodes participate uniformly,
// eliminating the ring artifact that appeared when isolated nodes were packed separately.
// Golden angle spiral seeds initial positions so nodes spread without clustering.
async function layoutVaultForce(model) {
    if (!model.nodes.length) return model;

    const N = model.nodes.length;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.399 rad, golden angle
    const spread = Math.max(180, Math.sqrt(N) * 90);
    const ITERS = Math.min(120, Math.max(30, Math.round(6000 / N)));
    const REPULSION = 2400;
    const SPRING_K = 0.016;
    const SPRING_LEN = Math.max(80, Math.min(200, Math.round(8000 / Math.max(1, N))));
    const GRAVITY = 0.014;

    // Golden angle spiral for initial positions — uniform, no center clustering.
    const pos = model.nodes.map((n, i) => {
        const r = spread * Math.sqrt((i + 0.5) / N);
        const a = i * GOLDEN;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });

    // Node-to-index map for spring lookup.
    const nodeIdx = new Map(model.nodes.map((n, i) => [n.id, i]));
    const springs = model.edges
        .map(e => ({ i: nodeIdx.get(e.source), j: nodeIdx.get(e.target) }))
        .filter(s => s.i !== undefined && s.j !== undefined);

    // Approximate dot radii for minimum repulsion distance.
    const radii = model.nodes.map(n => Math.max((n.data?.dotSize || 9) / 2, 5));

    const vel = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
    let damping = 0.82;

    for (let iter = 0; iter < ITERS; iter++) {
        const force = Array.from({ length: N }, () => ({ x: 0, y: 0 }));

        // Pairwise repulsion.
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const dx = pos[j].x - pos[i].x;
                const dy = pos[j].y - pos[i].y;
                const minD = radii[i] + radii[j] + 18;
                const d = Math.max(Math.hypot(dx, dy), minD);
                const f = REPULSION / (d * d);
                const nx = dx / d, ny = dy / d;
                force[i].x -= f * nx; force[i].y -= f * ny;
                force[j].x += f * nx; force[j].y += f * ny;
            }
        }

        // Edge spring attraction.
        for (const { i, j } of springs) {
            const dx = pos[j].x - pos[i].x;
            const dy = pos[j].y - pos[i].y;
            const d = Math.max(Math.hypot(dx, dy), 1);
            const f = SPRING_K * (d - SPRING_LEN);
            const nx = dx / d, ny = dy / d;
            force[i].x += f * nx; force[i].y += f * ny;
            force[j].x -= f * nx; force[j].y -= f * ny;
        }

        // Gravity toward origin.
        for (let i = 0; i < N; i++) {
            force[i].x -= GRAVITY * pos[i].x;
            force[i].y -= GRAVITY * pos[i].y;
        }

        // Integrate with damping.
        for (let i = 0; i < N; i++) {
            vel[i].x = (vel[i].x + force[i].x) * damping;
            vel[i].y = (vel[i].y + force[i].y) * damping;
            pos[i].x += vel[i].x;
            pos[i].y += vel[i].y;
        }
        damping = Math.max(0.62, damping - 0.002);
    }

    return {
        nodes: model.nodes.map((n, i) => ({ ...n, position: { x: pos[i].x, y: pos[i].y } })),
        edges: model.edges
    };
}

// Focused neighborhood: center at origin, direct neighbors in a circle at R1,
// depth-2 in an outer ring at R2, disconnected periphery below.
function layoutFocusedNeighborhood(model) {
    const centerId = model.centerId || model.nodes[0]?.id || null;
    if (!centerId || !model.nodes.length) return withCollisionAvoidance(model);

    const directNeighborIds = new Set();
    for (const edge of model.edges) {
        if (edge.target === centerId) directNeighborIds.add(edge.source);
        else if (edge.source === centerId) directNeighborIds.add(edge.target);
    }

    const depth2Ids = new Set();
    for (const node of model.nodes) {
        if (node.id === centerId || directNeighborIds.has(node.id)) continue;
        for (const edge of model.edges) {
            const nid = edge.source === node.id ? edge.target
                      : edge.target === node.id ? edge.source : null;
            if (nid && directNeighborIds.has(nid)) { depth2Ids.add(node.id); break; }
        }
    }

    const positionById = new Map();
    const centerNode = model.nodes.find(n => n.id === centerId);
    const cw = centerNode?.width || 172;
    const ch = centerNode?.height || 72;
    positionById.set(centerId, { x: -cw / 2, y: -ch / 2 });

    const R1 = 280;
    const directArr = [...directNeighborIds]
        .map(id => model.nodes.find(n => n.id === id))
        .filter(Boolean)
        .sort((a, b) => nodePriority(b) - nodePriority(a));
    const n1 = directArr.length;
    directArr.forEach((node, i) => {
        const angle = (2 * Math.PI * i / Math.max(1, n1)) - Math.PI / 2;
        positionById.set(node.id, {
            x: R1 * Math.cos(angle) - (node.width || 136) / 2,
            y: R1 * Math.sin(angle) - (node.height || 54) / 2
        });
    });

    const R2 = 480;
    const depth2Arr = [...depth2Ids]
        .map(id => model.nodes.find(n => n.id === id))
        .filter(Boolean)
        .sort((a, b) => nodePriority(b) - nodePriority(a));
    const n2 = depth2Arr.length;
    depth2Arr.forEach((node, i) => {
        const angle = (2 * Math.PI * i / Math.max(1, n2)) - Math.PI / 2;
        positionById.set(node.id, {
            x: R2 * Math.cos(angle) - (node.width || 100) / 2,
            y: R2 * Math.sin(angle) - (node.height || 40) / 2
        });
    });

    const peripheralIds = model.nodes
        .filter(n => n.id !== centerId && !directNeighborIds.has(n.id) && !depth2Ids.has(n.id))
        .map(n => n.id);
    placePeriphery(peripheralIds, positionById, model, 0, R2 + 140, 220, 80);

    return withCollisionAvoidance({
        nodes: model.nodes.map(node => ({
            ...node,
            position: positionById.get(node.id) || node.position || { x: 0, y: 0 }
        })),
        edges: model.edges
    });
}

function placePeriphery(ids, positionById, model, startX, startY, gapX, gapY) {
    const ordered = ids
        .map(id => model.nodes.find(n => n.id === id))
        .filter(Boolean)
        .sort((a, b) => nodePriority(b) - nodePriority(a));
    const cols = Math.min(4, ordered.length);
    ordered.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positionById.set(node.id, {
            x: startX + (col - (cols - 1) / 2) * gapX,
            y: startY + row * gapY
        });
    });
}

function nodePriority(node) {
    return Math.max(Number(node?.data?.hubScore || 0), Number(node?.data?.weightedDegree || 0));
}

// Broad layout (vault/domain/custom/query): ELK layered with fallback.
async function layoutBroadLayered(model, payload) {
    const centerId = model.centerId || payload?.centerNodeId || model.nodes[0]?.id || null;
    const typeOrder = buildTypeOrder(model.nodes, centerId);

    const graph = {
        id: 'yamlink-graph2-broad',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.edgeRouting': 'SPLINES',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.nodePlacement.favorStraightEdges': 'true',
            'elk.spacing.nodeNode': '28',
            'elk.layered.spacing.nodeNodeBetweenLayers': '72',
            'elk.padding': '[top=22,left=22,bottom=22,right=22]'
        },
        children: model.nodes.map(node => ({
            id: node.id,
            width: node.width || 156,
            height: node.height || 64,
            layoutOptions: {
                'elk.layered.priority': String(Math.max(1, 10 - (typeOrder.get(node.data.type || '') ?? 9))),
                ...(node.id === centerId ? { 'elk.layered.layerConstraint': 'FIRST' } : {})
            }
        })),
        edges: model.edges.map(edge => ({
            id: edge.id,
            sources: [edge.source],
            targets: [edge.target]
        }))
    };

    try {
        const layout = await elk.layout(graph);
        const posById = new Map((layout.children || []).map(c => [c.id, { x: c.x || 0, y: c.y || 0 }]));
        return withCollisionAvoidance({
            nodes: model.nodes.map(node => ({
                ...node,
                position: posById.get(node.id) || node.position || { x: 0, y: 0 }
            })),
            edges: model.edges
        });
    } catch (_) {
        return withCollisionAvoidance(layoutBroadFallback(model, centerId));
    }
}

function buildTypeOrder(nodes, centerId) {
    const counts = new Map();
    for (const node of nodes) {
        const t = node.data.type || '';
        counts.set(t, (counts.get(t) || 0) + 1);
    }
    const centerType = nodes.find(n => n.id === centerId)?.data?.type || null;
    const ordered = [...counts.entries()].sort((a, b) => {
        if (a[0] === centerType) return -1;
        if (b[0] === centerType) return 1;
        return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    return new Map(ordered.map(([type], i) => [type, i]));
}

function layoutBroadFallback(model, centerId) {
    const byType = new Map();
    for (const node of model.nodes) {
        const t = node.data.type || 'unknown';
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t).push(node);
    }
    const centerType = model.nodes.find(n => n.id === centerId)?.data?.type || null;
    const typeOrder = [...byType.entries()].sort((a, b) => {
        if (a[0] === centerType) return -1;
        if (b[0] === centerType) return 1;
        return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    });
    const positioned = [];
    typeOrder.forEach(([, group], colIdx) => {
        const ordered = [...group].sort((a, b) => {
            if (a.id === centerId) return -1;
            if (b.id === centerId) return 1;
            return nodePriority(b) - nodePriority(a);
        });
        ordered.forEach((node, rowIdx) => {
            positioned.push({
                ...node,
                position: { x: colIdx * 260, y: rowIdx * 112 - ((ordered.length - 1) * 56) }
            });
        });
    });
    return { nodes: positioned, edges: model.edges };
}

// ── Collision avoidance ───────────────────────────────────────────────────────
// Iterative pairwise push. Compares node CENTERS, not top-left corners.

function withCollisionAvoidance(model, iterations = 10) {
    const nodes = model.nodes.map(n => ({
        ...n,
        position: { ...(n.position || { x: 0, y: 0 }) }
    }));
    const GAP_X = 32;
    const GAP_Y = 22;

    for (let iter = 0; iter < iterations; iter++) {
        let moved = false;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                const aw = a.width || 136, ah = a.height || 54;
                const bw = b.width || 136, bh = b.height || 54;
                // Compare centers
                const acx = a.position.x + aw / 2;
                const acy = a.position.y + ah / 2;
                const bcx = b.position.x + bw / 2;
                const bcy = b.position.y + bh / 2;
                const dx = bcx - acx;
                const dy = bcy - acy;
                const minDx = (aw + bw) / 2 + GAP_X;
                const minDy = (ah + bh) / 2 + GAP_Y;
                if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
                    // Push along the dominant axis
                    if (Math.abs(dx) >= Math.abs(dy)) {
                        const push = (minDx - Math.abs(dx)) / 2;
                        const dir = dx >= 0 ? 1 : -1;
                        b.position.x += push * dir;
                        a.position.x -= push * dir;
                    } else {
                        const push = (minDy - Math.abs(dy)) / 2;
                        const dir = dy >= 0 ? 1 : -1;
                        b.position.y += push * dir;
                        a.position.y -= push * dir;
                    }
                    moved = true;
                }
            }
        }
        if (!moved) break;
    }
    return { nodes, edges: model.edges };
}

// ── Export ────────────────────────────────────────────────────────────────────

window.YamlinkGraph2Renderer = { mount };
