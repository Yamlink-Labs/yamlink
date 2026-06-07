# Yamlink Architecture

Last updated: 2026-06-01

This document is the authoritative engineering reference for the Yamlink codebase. It covers the current stack, layer architecture, webview model, data flow, key design decisions, and the migration directions that are actively in progress.

---

## Current Stack

### Extension host (Node.js)

| Concern | Approach |
|---|---|
| Language | Plain JavaScript (CommonJS) |
| Build step | **None.** Extension runs directly from source. |
| Entry point | `extension.js` — wires all modules, registers all providers |
| Runtime deps | `js-yaml`, `pdfkit` (lazy-loaded), `markdown-it` (lazy-loaded) |
| Test runner | `node:test` (built-in) — no Jest, no Mocha |
| Linter | ESLint flat config (`eslint.config.js`) — `no-undef` + `no-unused-vars` |
| TypeScript | In devDependencies; migration started (see migration plan below) |

**Why no build step for the extension host:** At 110 files / ~26K lines, the extension is large enough to feel the absence of types but small enough that bundling adds complexity without meaningful activation-time or size benefit. The priority is TypeScript first (type safety), bundling later if profiling shows activation cost.

### Webviews

Two models coexist today:

| Panel | Model | File |
|---|---|---|
| Graph Workspace | **External URI** — `Canvas2DRenderer.js` loaded via `localResourceRoots` | `graph/renderer/Canvas2DRenderer.js` |
| Graph Sidebar | **External URI** — same renderer | `graph/renderer/Canvas2DRenderer.js` |
| Table (View Panel) | **Inline blob** — HTML+CSS+JS string built in code | `src/features/view/viewPanelHtml.js` (59 KB) |
| Note Report | **Inline blob** | `src/features/entity/entityHubHtml.js` (21 KB) |
| Vault Health | **Inline blob** | `src/features/health/healthHtml.js` (30 KB) |
| Calendar | **Inline blob** | `src/features/calendarPanelScript.js` (14 KB) |

The external URI model is the correct target for all panels. Migration is on the roadmap (see Platform Optimization below). The inline blob pattern has no IDE support, no syntax checking, no TypeScript, and no testability for the webview-side code.

**No UI framework in webviews.** The Canvas2D graph is a full interactive application in plain JavaScript with no framework. All other panels follow the same principle. Do not introduce React, Vue, or Svelte — they were present in Graph 2.0 (React Flow) and have been removed. The correct answer is vanilla TypeScript compiled by esbuild.

### Graph engine

| Concern | Approach |
|---|---|
| Renderer | Custom Canvas2D — `graph/renderer/Canvas2DRenderer.js` |
| Physics | Inline `SimpleLayout` (no d3-force at extension runtime) |
| Layout stability | Pre-warms 80 ticks synchronously before animation starts; `velocityDecay` 0.65 for smooth settling |
| Layer system | Base / Semantic / Health — additive, independent |
| Worker | `LayoutWorker` available for docs site; extension uses inline layout |
| Adapter | `graph/adapter-yamlink/index.js` converts vault model to universal `{nodes,edges}` |
| Performance | Edge batching, frustum culling, label LOD, ~2000–3000 node ceiling |
| Camera | `resize()` scales camera offset proportionally so sidebar graph never appears blank on first open |

### Color system

The Yamlink Apollo palette is the authoritative color source for all webview surfaces. It is documented at `docs/architecture/YAMLINK-COLOR-PALETTE.md` with hex values for the Night, Dusk, and Dawn variants.

Core semantic roles (Night variant):

| Role | Hex | Used for |
|---|---|---|
| Pink — Flow/Emphasis | `#FF429F` | Primary CTAs, active tab underlines, header logo, welcome title |
| Mint — Connection | `#C5FFBF` | Wikilinks, relations, note_created feed icons, activity feed note names |
| Lavender — Identity | `#C49BF0` | Type labels, ID cells, vault name pill, section chevrons, link cells |
| Amber — Structure | `#E7A85A` | Schema markers, `!view` block, warnings, task status icons |
| Teal — Support | `#5ECFBE` | Hover states, interactive focus, cursor, good health indicators |

All webview surfaces hardcode these values directly rather than deriving from `vscode-textLink-foreground` (which varies by theme). Surfaces must remain readable in both dark and light VS Code themes.

### Runtime dependencies (ships in VSIX)

| Package | Why it's here | Size |
|---|---|---|
| `js-yaml` | Frontmatter parsing (`src/core/frontmatter.js`, `src/core/index.js`, `schemaRegistry.js`) | ~395 KB |
| `pdfkit` | PDF export — lazy-loaded inside `createDocument()`, never parsed at activation | ~8 MB |
| `markdown-it` | Note preview renderer — lazy singleton, never parsed at activation | ~749 KB |

Everything else — `cytoscape`, `reactflow`, `react`, `react-dom`, `elkjs`, `lucide-react`, `pixi.js`, `esbuild`, `d3-force` — has been moved to devDependencies or removed entirely. They were production dependencies that added ~65 MB to every VSIX while serving dead code paths.

### Dev dependencies (not shipped)

| Package | Purpose |
|---|---|
| `typescript` | Type checking and future migration |
| `esbuild` | Graph engine build (`graph/build.mjs`); future webview compilation |
| `d3-force` | Docs site graph engine (`graph/core/InlineLayout.js`) |
| `eslint` | Linting |
| `c8` | Coverage reporting |
| `vite` / `tailwindcss` / `@vitejs/plugin-react` | Docs site build |
| `highlight.js` | Docs site syntax highlighting |
| `@vscode/test-electron` | Extension Host integration tests |

---

## Layer Architecture

```
extension.js                    ← VS Code entry point, wires everything
│
├── src/core/                   ← Data model. Ground truth for all queries and surfaces.
│   ├── index.js                ← Vault scan, idIndex, pathIndex, fieldsCache
│   ├── graph.js                ← Directed edge graph (outboundEdges, inboundEdges)
│   ├── frontmatter.js          ← YAML parse/write utilities
│   ├── id.js                   ← Canonical ID normalization (kebab-case)
│   ├── rename.js               ← Vault-wide wikilink rename propagation
│   ├── writeField.js           ← Surgical frontmatter field updates
│   └── ...
│
├── src/registries/             ← Type and schema registries (typeRegistry, schemaRegistry)
│
├── src/engine/                 ← Pure query engine. No VS Code imports.
│   └── query.js                ← !view parser and executor (766 lines)
│
├── src/intelligence/           ← Pure inference layer. No VS Code imports.
│   ├── fieldCategory.js        ← Multi-signal field classifier
│   ├── fieldPlanner.js         ← Maps confidence → surface action (SILENCE/HINT/QUICKFIX)
│   ├── fieldRolesCore.js       ← Date/status/person/container/topic role inference
│   ├── vaultPriors.js          ← Per-vault statistical maps, generation-keyed cache
│   ├── suggestionCore.js       ← Vault pattern building, field scoring (1011 lines — split planned)
│   ├── lifecycleState.js       ← draft/growing/consolidated/hub/stale
│   ├── driftDetector.js        ← on-track/minor-drift/drifting/outlier vs vault bundles
│   ├── noteRolesCore.js        ← Person/event/artifact/etc role inference
│   ├── gitHistoryImport.js     ← Git commit history → mutation event backfill
│   ├── implicitWeights.js      ← Sticky relation knowledge from mutation log history
│   ├── outcomeCalibration.js   ← Feedback loop: completion_accepted → per-field confidence boost
│   ├── noteArc.js              ← Arc prediction: missing fields ranked by vault frequency + calibration
│   └── nlQuery.js              ← Natural language → !view syntax (16 patterns + vault vocabulary injection)
│
├── src/features/               ← VS Code surface providers and webview panels
│   ├── completion.js           ← Frontmatter + query completion (849 lines — split planned)
│   ├── hover.js                ← Hover cards for wikilinks and !view blocks
│   ├── viewPanel.js            ← Live table webview
│   ├── entityHub.js            ← Note Report sidebar
│   ├── entity/unlinkedRefs.js  ← Unlinked body-text mention detection
│   ├── calendarPanel.js        ← Calendar webview
│   ├── healthPanel.js          ← Vault Health panel
│   ├── homePanel.js            ← Home panel (activity stream, pulse, nudges)
│   ├── home/                   ← Home panel HTML, CSS, browser-side JS
│   ├── graph/                  ← x-graph workspace panel (Canvas2D)
│   └── graph2/                 ← x-graph sidebar panel (same renderer)
│
├── src/actions/                ← Code action providers and view builder
├── src/diagnostics/            ← Broken links, duplicate IDs, schema violations
├── src/runtime/                ← RefreshRouter, performance tracker, mutation log
├── src/export/                 ← PDF export (pdfkit, lazy-loaded)
│
└── graph/                      ← x-graph engine (Canvas2D, used as webview URI)
    ├── renderer/               ← Canvas2DRenderer.js (self-contained, no imports)
    ├── core/                   ← Layout, camera, schema (docs site + extension)
    └── adapter-yamlink/        ← Converts vault model to universal graph format
```

### Layer rules

- `src/engine/` and `src/intelligence/` have **no VS Code imports** and are directly testable with `node --test`.
- `src/core/` is ground truth. Nothing reads `.md` files at runtime except the query engine's body cache and the PDF exporter.
- `src/features/` and `src/actions/` are the only layers that touch VS Code APIs.
- `graph/renderer/Canvas2DRenderer.js` is self-contained — no imports, no framework, no Node.js APIs. It runs in the webview browser context.

---

## Data Flow

```
Vault save / file change
        │
        ▼
src/core/index.js  ──buildIndex() / updateSingleFile()──►  idIndex, pathIndex, fieldsCache
        │                                                    graph edges
        │  vaultGeneration bumped
        ▼
src/runtime/refreshRouter.js  ──fanout──►  completion, hover, diagnostics,
                                            entityHub, calendar, graph panels,
                                            health, views, suggestions
        │
        │  changedId threading: entityHub + calendar skip if irrelevant node
        ▼
Per-surface caches (generation-keyed):
  intelligenceCache.js   ← single vault pattern scan per generation
  queryCache.js          ← LRU 300-entry query result cache
  taskCache.js           ← task extraction cache per note + generation
  vaultPriors.js         ← field/type statistical maps per generation
```

### Invalidation model

- **Phase 1 (done):** coarse — every save invalidates all caches.
- **Phase 2 (done):** `changedId` threading — entityHub and calendar skip refresh when the changed note is irrelevant.
- **Phase 3 (future):** per-cache or per-note fine-grained invalidation.

### Performance budgets (enforced via `performanceTracker.js`)

| Surface | Budget |
|---|---|
| Completion | 30ms |
| Hover | 5ms |
| View query | 50ms |
| Graph payload | 300ms |

Breaches are logged to the Yamlink Performance output channel.

---

## Webview Message Protocol

All panels use `postMessage` / `onDidReceiveMessage`. There is no shared protocol library — each panel defines its own message types. Common patterns:

- `{ type: 'ready' }` — webview signals it has loaded; extension sends pending payload
- `{ type: 'update', payload: { ... } }` — extension sends fresh data
- `{ type: 'openNode', id }` — webview requests opening a note in editor

---

## Mutation Event Log

`src/runtime/mutationEventLog.js` — persisted NDJSON append log at `.yamlink/mutation-log.ndjson`.

Event types: `note_created`, `type_set`, `field_added`, `field_changed`, `field_removed`, `relation_changed`.

- 10,000 event cap with ring-buffer truncation on overflow
- 3-second dedup window prevents save-storm noise
- Filter API: by `noteId`, time range, event type
- Survives extension restarts (reloads from disk on `initMutationLog()`)
- `yamlink.importGitHistory` command backfills from git commit history via `gitHistoryImport.js`

The log is the data source for: History tab in Note Report, lifecycle stale detection, Vault Health "Today's Activity", and the planned vault-wide mutation timeline and rollback hints.

---

## Key Design Decisions

**No build step for extension host.** Extension runs from source. Simple, fast iteration. The graph panels use esbuild for their webview bundles (Canvas2DRenderer is external), which is the right scoped use of a build tool.

**Pure modules in `engine/` and `intelligence/`.** No VS Code imports means these are directly unit-testable with `node --test`, runnable in the CLI, and future-safe for LSP server use.

**`id:` as canonical identity.** Filename is cosmetic. IDs survive renames and moves. All graph edges, queries, and completion targets resolve through `idIndex`.

**Generation-keyed caches.** `vaultGeneration` increments on every mutation. Cache keys include the generation so staleness is structural, not timeout-based.

**Inline type completion is vault-first.** `getKnownTypeCandidates()` returns vault types when any exist; falls back to archetype bootstrap only on a zero-history vault.

**No hardcoded semantic empire.** Intelligence semantics come from vault-derived evidence (field/type/bundle recurrence, co-occurrence, priors). Bootstrap heuristics are explicit fallbacks, not defaults.

---

## Platform Optimization — In Progress

This tracks the active optimization program started 2026-05-26.

### Completed

- [x] **Vendor bundle removal** — `graph2-reactflow.js` (4.8 MB), `cytoscape.min.js` (358 KB) deleted
- [x] **Dead graph stack removed** — Graph 2.0 React Flow + Cytoscape code removed; x-graph Canvas2D is the sole renderer on both surfaces
- [x] **Dead npm packages removed from production deps** — `lucide-react` (33.6 MB), `pixi.js` (12.3 MB), `elkjs` (7.8 MB), `react-dom` (7.1 MB), `cytoscape` (4.3 MB), `react`, `reactflow`, `esbuild`, `d3-force` all moved to devDependencies or removed (~65 MB VSIX reduction)
- [x] **`.vscodeignore` gaps closed** — `media/docs-home/`, `tmp/`, `site-app-dist/`, `graph/build.mjs` added
- [x] **pdfkit lazy-loaded** — no longer parsed at activation; deferred to first PDF export call
- [x] **Dead devDependencies removed** — `mocha` (never used), `@types/react`, `@types/react-dom`
- [x] **Hardcoded type completion removed** — `getKnownTypeCandidates()` now returns vault types first; archetypes only fire on zero-history vaults
- [x] **Test baseline updated** — 1175/1175

### Pending — P1: Webview architecture migration

The inline HTML+JS blob pattern in `viewPanelHtml.js` (59 KB), `entityHubHtml.js` (21 KB), `healthHtml.js` (30 KB), `calendarPanelScript.js` (14 KB) is the main structural debt:

- No syntax checking or IDE support for webview-side JS
- No TypeScript possible without first separating the files
- Hard to debug; no source maps
- The graph panels already do it right (external URI via `localResourceRoots`)

**Migration target:** Each panel gets a source file in `src/webviews/` compiled by esbuild into `dist/webviews/`, served as an external URI. Vanilla TypeScript, no framework. Same pattern as `Canvas2DRenderer.js` today.

Migration order: table panel first (highest complexity, most payoff) → health → entity hub → calendar.

### Pending — P2: TypeScript migration

`typescript` is in devDependencies. Migration path:

1. Add `tsconfig.json` with `checkJs: true` — zero-cost first step, surfaces type errors immediately
2. Migrate `src/engine/query.js` → `.ts` as pilot
3. Migrate `src/intelligence/` (implicit module contracts are the highest-risk area)
4. Migrate `src/core/`, `src/actions/`, `src/diagnostics/`
5. `src/features/` last (VS Code API types add surface area)
6. Webview TypeScript enabled automatically once P1 is complete

### Pending — P3: Monolith splits

- `src/intelligence/suggestionCore.js` (1011 lines) — vault pattern building, field scoring, suggestion assembly, observed-field analysis
- `src/features/completion.js` (849 lines) — already partially split into helpers; finish the decomposition
- `src/engine/query.js` (766 lines) — parser, executor, clause handlers; natural split boundary at parser/executor

### Not planned

- Bundling the extension host — unnecessary at this scale; no build step is a feature
- Adding a UI framework to webviews — Canvas2D graph proves vanilla TypeScript is sufficient
- Switching from `node:test` — it's the right runner
- Replacing pdfkit — correct tool, now lazy-loaded
