/**
 * graph-core/schema.js
 *
 * Universal node/edge model — no Yamlink, no Atomix, no browser assumptions.
 * Every domain adapter maps its data into these shapes.
 *
 * @typedef {Object} GraphNode
 * @property {string}      id
 * @property {string}      label
 * @property {string}      kind        - semantic type ("contact", "doc", "block")
 * @property {string}      group       - cluster affiliation (type, section, workspace)
 * @property {number}      weight      - 0–1 normalized importance (hub score)
 * @property {Object}      meta        - adapter-specific metadata, opaque to engine
 * @property {number|null} x
 * @property {number|null} y
 * @property {number}      vx
 * @property {number}      vy
 * @property {number|null} fx          - pinned position (null = free)
 * @property {number|null} fy
 *
 * @typedef {Object} GraphEdge
 * @property {string}                    id
 * @property {string}                    source
 * @property {string}                    target
 * @property {string}                    kind        - relation field name or "mention"/"link"
 * @property {number}                    weight      - 0–1
 * @property {'weak'|'medium'|'strong'}  strength
 * @property {boolean}                   directed
 *
 * @typedef {Object} GraphData
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 * @property {{ centerNodeId?: string, totalVaultNodes?: number, title?: string }} meta
 *
 * @typedef {'cluster'|'node'|'detail'} LODLevel
 */

/** LOD thresholds */
export const LOD_THRESHOLDS = Object.freeze({
  CLUSTER_MAX: 0.25,  // zoom < 0.25 → cluster mode
  NODE_MAX:    0.70,  // 0.25–0.70 → node mode (dots, no labels)
                      // > 0.70    → detail mode (labels, edge labels)
});

/** Worker ↔ main thread message types */
export const WorkerMsg = Object.freeze({
  // Main → Worker
  INIT:   'INIT',
  UPDATE: 'UPDATE',
  PIN:    'PIN',
  UNPIN:  'UNPIN',
  RUN:    'RUN',
  STOP:   'STOP',
  TICK:   'TICK',
  // Worker → Main
  POSITIONS: 'POSITIONS',
  SETTLED:   'SETTLED',
});

/** Yamlink color system — semantic color per node kind */
export const KIND_COLORS = Object.freeze({
  // Yamlink note types
  contact:  0x5ecfbe,   // teal   — people
  person:   0x5ecfbe,
  mission:  0xff429f,   // pink   — events/actions
  project:  0xe7a85a,   // amber  — containers
  source:   0xc49bf0,   // lavender — knowledge
  note:     0xe6e8eb,   // text-primary — generic
  record:   0xe6e8eb,
  // Docs site types
  section:  0xc5ffbf,   // mint   — hub sections
  doc:      0x9ea3aa,   // text-secondary
  glossary: 0x5ecfbe,   // teal
  // Fallback
  unknown:  0x40454c,   // text-faint
});

export const EDGE_COLORS = Object.freeze({
  strong:  0x5ecfbe,   // teal
  medium:  0x666b72,   // text-muted
  weak:    0x2b2d31,   // bg-active
});

/** Semantic layer — edge colour by relation field name */
export const FIELD_CATEGORY_COLORS = Object.freeze({
  // person-type fields
  person:     '#5ecfbe', mentor:    '#5ecfbe', author:    '#5ecfbe',
  contact:    '#5ecfbe', owner:     '#5ecfbe', manager:   '#5ecfbe',
  supervisor: '#5ecfbe', colleague: '#5ecfbe', creator:   '#5ecfbe',
  // container-type fields
  project: '#e7a85a', team:      '#e7a85a', unit:   '#e7a85a',
  parent:  '#e7a85a', workspace: '#e7a85a', group:  '#e7a85a',
  // topic-type fields
  topic: '#c49bf0', theme:    '#c49bf0', area:     '#c49bf0',
  tag:   '#c49bf0', category: '#c49bf0', subject:  '#c49bf0',
  // event-type fields
  event: '#ff429f', session: '#ff429f', mission: '#ff429f', meeting: '#ff429f',
});

/** Health layer — node ring colour by lifecycle state */
export const LIFECYCLE_RING_COLORS = Object.freeze({
  hub:          '#4fc4a0',   // bright teal  — highly connected anchor
  consolidated: '#3fb950',   // green        — healthy, stable
  growing:      '#e7a85a',   // amber        — actively developing
  draft:        '#8899aa',   // muted        — sparse / new
  stale:        '#ff6b6b',   // red          — needs attention
});

/** Health layer — node ring colour by drift state (takes precedence over lifecycle) */
export const DRIFT_RING_COLORS = Object.freeze({
  'minor-drift': '#ffd93d',  // yellow  — slight deviation
  'drifting':    '#ff9a3c',  // orange  — notable structural drift
  'outlier':     '#ff6b6b',  // red     — significant outlier
});
