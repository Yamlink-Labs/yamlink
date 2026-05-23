/**
 * adapter-yamlink — normalizes Yamlink's internal graph model to the universal schema.
 *
 * Two entry points:
 *   adaptYamlinkModel(model)  — from graphModel.js buildGraphModel() output (VS Code runtime)
 *   adaptDocsGraph(docsData)  — from docs site build-time JSON (yamlink.dev)
 *
 * @module graph/adapter-yamlink
 */

/**
 * Converts buildGraphModel() output → universal GraphData.
 *
 * @param {{
 *   elements: Array<{data: object}>,
 *   nodeDetails: Map<string, object>,
 *   summary: object,
 * }} model  - from src/features/graph/graphModel.js
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function adaptYamlinkModel(model) {
  const { elements } = model;

  const nodes = [];
  const edges = [];

  for (const el of elements) {
    const d = el.data;

    if (d.source !== undefined) {
      // It's an edge
      edges.push({
        id:       d.id ?? `${d.source}->${d.target}`,
        source:   d.source,
        target:   d.target,
        field:    d.field ?? null,
        weight:   d.weight ?? 0.5,
        strength: d.strength ?? 'medium',
      });
    } else {
      // It's a node
      const weight     = _normalizeWeight(d.hubScore ?? 0, d.weightedDegree ?? 0);
      const kind       = _inferKind(d.type, d.label);
      const group      = d.type ?? 'default';

      nodes.push({
        id:       d.id,
        label:    d.label ?? d.id,
        kind,
        group,
        type:     d.type ?? null,
        weight,
        isOrphan: d.isOrphan ?? false,
        // carry through for the edge connectivity check in NodeLayer
        edges:    [], // populated below
      });
    }
  }

  // Attach edge refs to nodes for fast connectivity lookup
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    nodeById.get(e.source)?.edges.push({ source: e.source, target: e.target });
    nodeById.get(e.target)?.edges.push({ source: e.source, target: e.target });
  }

  return { nodes, edges };
}

/**
 * Converts docs site build-time graph JSON → universal GraphData.
 *
 * Input format produced by site/build.mjs:
 *   { nodes: [{id, label, section, route, linkCount}], edges: [{source, target, field}] }
 *
 * @param {{ nodes: object[], edges: object[] }} docsData
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function adaptDocsGraph(docsData) {
  const maxLinks = Math.max(1, ...docsData.nodes.map(n => n.linkCount ?? 0));

  const nodes = docsData.nodes.map(n => ({
    id:       n.id,
    label:    n.label ?? n.id,
    kind:     _sectionToKind(n.section),
    group:    n.section ?? 'default',
    type:     n.type ?? null,
    weight:   (n.linkCount ?? 0) / maxLinks,
    isOrphan: (n.linkCount ?? 0) === 0,
    edges:    [],
  }));

  const edges = docsData.edges.map((e, i) => ({
    id:       e.id ?? `e${i}`,
    source:   e.source,
    target:   e.target,
    field:    e.field ?? null,
    weight:   0.5,
    strength: 'medium',
  }));

  // Attach edge refs for connectivity lookup
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    nodeById.get(e.source)?.edges.push({ source: e.source, target: e.target });
    nodeById.get(e.target)?.edges.push({ source: e.source, target: e.target });
  }

  return { nodes, edges };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const HUB_SCORE_WEIGHT    = 0.6;
const DEGREE_WEIGHT       = 0.4;
const DEGREE_SCALE        = 20; // normalizes raw degree to 0-1

function _normalizeWeight(hubScore, weightedDegree) {
  const hs = Math.min(1, hubScore);
  const dw = Math.min(1, weightedDegree / DEGREE_SCALE);
  return hs * HUB_SCORE_WEIGHT + dw * DEGREE_WEIGHT;
}

const TYPE_KIND_MAP = {
  person:    'person',
  contact:   'person',
  character: 'person',
  mission:   'event',
  event:     'event',
  session:   'event',
  note:      'artifact',
  source:    'artifact',
  document:  'artifact',
  schema:    'schema',
  task:      'task',
  project:   'container',
  unit:      'container',
};

function _inferKind(type, label) {
  if (!type) return 'default';
  const lower = type.toLowerCase();
  return TYPE_KIND_MAP[lower] ?? 'default';
}

const SECTION_KIND_MAP = {
  'getting-started': 'artifact',
  'core-concepts':   'schema',
  'templates':       'container',
  'queries-views':   'event',
  'glossary':        'artifact',
  'changelog':       'task',
};

function _sectionToKind(section) {
  if (!section) return 'default';
  return SECTION_KIND_MAP[section] ?? 'default';
}
