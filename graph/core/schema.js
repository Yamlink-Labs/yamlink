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
