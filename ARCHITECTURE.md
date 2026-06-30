# Yamlink Architecture

Last updated: 2026-06-26

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
| `ink ^7.0.5` | Conduit terminal UI (`src/conduit/`) — React-based TTY renderer | ~1.2 MB |
| `ink-text-input ^6.0.0` | Text input component for Conduit screens | ~20 KB |

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
│   ├── noteDiff.js             ← Pure compareNoteFields(id1, id2, fields1, fields2) — shared by CLI diff + API /api/diff
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
│   ├── liveNote.js             ← Live Note rendered sidecar (synced preview beside the editor)
│   ├── noteOutline.js          ← Note Outline sidebar (section tree with per-heading metadata)
│   ├── graph/                  ← x-graph workspace panel (Canvas2D)
│   └── graph2/                 ← x-graph sidebar panel (same renderer)
│
├── src/actions/                ← Code action providers and view builder
├── src/diagnostics/            ← Broken links, duplicate IDs, schema violations
├── src/runtime/                ← RefreshRouter, performance tracker, mutation log
├── src/export/                 ← PDF export (pdfkit, lazy-loaded)
│
├── src/cli/                    ← Headless CLI + local API launcher (no VS Code imports)
│   ├── index.js                ← Entry point: arg parsing, bootstrap, command dispatch
│   ├── format.js               ← Terminal formatting helpers (header, row, table, colors)
│   ├── io.js                   ← Shared I/O contract: emitCliError, emitCliSuccess, emitText, captureOutput
│   └── commands/
│       ├── serve.js            ← Local HTTP API: GET/POST/PATCH/DELETE + SSE events
│       ├── briefing.js         ← Morning summary: pulse, tasks, activity, arc predictions, drift flag
│       ├── create.js           ← Non-interactive note creation (runs before index bootstrap)
│       ├── diff.js             ← Frontmatter field diff between two notes (uses noteDiff.js)
│       ├── doctor.js           ← Deep integrity pass: broken links, duplicates, arc gaps, stale notes
│       ├── init.js             ← Initialize a new Yamlink vault directory
│       ├── rename.js           ← Vault-wide ID rename + wikilink rewrite (--dry-run, --rename-file)
│       ├── search.js           ← Search notes by id/name/title/type (--type, --field, --json, --quiet)
│       ├── status.js           ← Fast machine-readable vault snapshot
│       ├── watch.js            ← Persistent vault watcher with debounced rebuild
│       ├── on.js               ← Automation hooks: watch + script exec on matching mutation events
│       ├── completions.js      ← Shell completion scripts (bash / zsh)
│       ├── build.js            ← Index vault, report broken links / duplicate IDs (CI-safe)
│       ├── health.js           ← Vault health overview
│       ├── validate.js         ← Schema conformance check (exits 1 on failures)
│       ├── query.js            ← Run a query; accepts bare clauses or full !view syntax; ASCII table or JSON
│       ├── report.js           ← Note report for a given ID
│       ├── links.js            ← Inbound / outbound links for a note
│       └── export.js           ← Export vault as JSON or CSV
│
├── src/api/                    ← HTTP contract layer used by `yamlink serve`
│   ├── router.js               ← Stable route surface; imported by tests
│   ├── handlers/               ← Endpoint handlers (`nodes`, `search`, `schema`, `diff`, etc.)
│   ├── eventsBus.js            ← SSE client registry + rebuild / mutation fanout
│   ├── write.js                ← CLI-safe file write bridge for API mutations
│   └── http.js                 ← Shared headers, JSON helpers, error contract
│
├── src/conduit/                ← Ink-based terminal UI; reads only from the local API
│   ├── index.js                ← `yamlink conduit` entry
│   ├── App.js                  ← Screen router + global key model
│   ├── useApi.js               ← HTTP + SSE client helpers
│   └── screens/                ← 9 screens: Briefing, Query, Navigator, Explorer, Health, Search, Graph, Diff, Radar
│
├── src/lsp/                    ← Editor-agnostic LSP server over stdio
│   ├── server.js               ← `yamlink serve --lsp` — route() + run(), wiring only
│   ├── transport.js            ← JSON-RPC framing (Content-Length, stdin/stdout, send/respond/notify)
│   ├── utils.js                ← URI helpers, WIKILINK_RE, wikilinkAtPosition, collectMdFiles, inFrontmatter
│   ├── vaultService.js         ← rebuildIndex, push + pull diagnostics collectors
│   └── handlers/               ← One module per LSP method group
│       ├── lifecycle.js        ← initialize, initialized, cancelRequest
│       ├── sync.js             ← didOpen, didChange, didClose, didChangeWatchedFiles
│       ├── completion.js       ← wikilink + frontmatter key/value completion
│       ├── hover.js            ← hover card
│       ├── navigation.js       ← definition, references
│       ├── rename.js           ← prepareRename, rename
│       ├── symbols.js          ← documentSymbols, workspaceSymbol
│       ├── codeAction.js       ← broken-link quickfix
│       ├── diagnostics.js      ← textDocument/diagnostic, workspace/diagnostic
│       └── executeCommand.js   ← note intelligence, note arc, field-category snapshots
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
- `src/cli/` has **no VS Code imports**. It imports only from `src/core/`, `src/engine/`, `src/intelligence/`, `src/registries/`, and `src/runtime/mutationEventLog.js`. The one exception is `serve.js`'s lazy `require` of `healthStats.js` — which itself has no VS Code imports.
- `graph/renderer/Canvas2DRenderer.js` is self-contained — no imports, no framework, no Node.js APIs. It runs in the webview browser context.

---

## CLI and Local API

`src/cli/` is the headless engine layer. It shares the same core (`src/core/`, `src/engine/`, `src/intelligence/`) as the VS Code extension but has no VS Code runtime dependency.

### Commands

| Command | Description |
|---|---|
| `yamlink build` | Index vault, report broken links and duplicate IDs. Exits 1 on issues — CI-safe. |
| `yamlink briefing` | Morning summary: vault pulse, overdue/today tasks, recent activity, arc predictions, drift flag. |
| `yamlink create <type>` | Create a note non-interactively. Runs before index bootstrap. |
| `yamlink diff <id1> <id2>` | Compare two notes' frontmatter field sets. Human diff or JSON contract. |
| `yamlink doctor` | Deep vault audit: broken links, duplicate IDs, schema violations, stale notes, arc gaps. |
| `yamlink init [path]` | Initialize a new Yamlink vault (creates `.yamlink/` directory and stub config). |
| `yamlink rename <old-id> <new-id>` | Rename a note ID and rewrite all `[[wikilinks]]` vault-wide. `--dry-run`, `--rename-file`. |
| `yamlink search <query>` | Search notes by id, name, title, or type. `--type`, `--field`, `--json`, `--quiet`. |
| `yamlink status` | Fast machine-readable vault snapshot for scripts and checks. |
| `yamlink watch` | Persistent watcher — rebuilds on `.md` saves, prints a timestamped one-liner. |
| `yamlink on <event> -- <script>` | Automation hooks — watch loop + script exec on matching mutation events. |
| `yamlink completions bash\|zsh` | Print shell completion script. |
| `yamlink health` | Vault health overview: lifecycle, drift, type distribution. |
| `yamlink schema list\|check <type>` | Schema introspection — list all schema targets or check conformance for a type. |
| `yamlink validate` | Schema conformance check. Exits 1 on required-field violations. |
| `yamlink query "<clause>"` | Run a Yamlink query. Accepts bare clauses (`where type = x`) or full `!view` syntax. ASCII table or JSON. |
| `yamlink report <id>` | Full note report: type, lifecycle, drift, links. |
| `yamlink links <id>` | Outbound and inbound links for a note. |
| `yamlink set <id> <field> <value>` | Set or remove a frontmatter field. `--clear` removes; `--dry-run` previews. Emits mutation events with `source: 'cli'`. |
| `yamlink link <id> <field> <target>` | Add a `[[wikilink]]` relation field. Validates target exists in index. `--append` for multi-value fields. |
| `yamlink mutations` | Show recent mutation events from `.yamlink/mutation-log.ndjson`. `--limit`, `--since`, `--type`. |
| `yamlink graph` | Export full vault graph as `{ nodes, edges }` JSON. `--only-types` to filter. |
| `yamlink serve` | Local HTTP API — see below. |
| `yamlink conduit` | Launch the Ink-based terminal UI that talks to the local API. |
| `yamlink export` | Export vault as JSON or CSV. |

### Local HTTP API (`yamlink serve`)

`yamlink serve` exposes the vault as a local REST API on `127.0.0.1`. Full documentation at [`docs/api/README-API.md`](docs/api/README-API.md).

**Read endpoints:** `GET /api/nodes`, `GET /api/nodes/:id`, `GET /api/search`, `GET /api/schema`, `GET /api/diff`, `GET /api/query`, `GET /api/graph`, `GET /api/tasks`, `GET /api/mutations`, `GET /api/types`, `GET /api/health`, `GET /api/intelligence/note`, `GET /api/intelligence/arc`, `GET /api/intelligence/fieldCategory`

**Write endpoints:** `POST /api/nodes`, `POST /api/nodes/bulk`, `PATCH /api/nodes/:id`, `PATCH /api/nodes/bulk`, `DELETE /api/nodes/:id`

**Pagination contract:** `/api/nodes`, `/api/search`, and `/api/schema` return wrapper objects with `meta: { total, page, limit, pages }`. Search is capped at `200`, schema at `100`, node listing at `500`.

**Event stream:** `GET /api/events` — Server-Sent Events. Pushes `connected`, fine-grained mutation events (`note_created`, `note_deleted`, `note_touched`, `type_set`, `field_added`, `field_changed`, `field_removed`, `relation_added`, `relation_changed`, `relation_removed`, `completion_accepted`), and a final `{ type: 'rebuild', generation }` after each rebuild.

**Generation header:** Every response includes `X-Yamlink-Generation: <n>` — an integer that increments on every completed rebuild. Clients use this to detect stale cached data.

**Stability policy:** The v1 contract is documented in [`docs/api/STABILITY.md`](docs/api/STABILITY.md).

**Write model:** headless surfaces now share a single `VaultService` (`src/core/vaultService.js`). API writes go to disk through the CLI-safe write layer inside `vaultService.mutate(writeFn)`, which serializes the write and the post-write rebuild as one atomic unit. Mutation events are appended to `.yamlink/mutation-log.ndjson` and fanned out immediately; when the rebuild completes, a final rebuild event is emitted and the generation header advances. File-watcher rebuilds also flow through the same service via `notifyFileChange()`.

### Conduit and LSP

- **Conduit** (`yamlink conduit`, or simply `yamlink`) is a long-running terminal interface built with Ink. Nine screens (Briefing, Query, Navigator, Explorer, Health, Search, Graph, Diff, Radar), each a single keypress away. Conduit talks only to the local HTTP API and SSE stream — it imports no Yamlink internals directly. Running `yamlink` with no arguments auto-starts the API server in-process if one is not already listening on the configured port, then shuts it down on exit.
- **LSP** (`yamlink serve --lsp`) is the editor-agnostic protocol face of the same engine. It runs over stdio, not HTTP, and is the portability layer for Zed, Helix, Neovim, Emacs, and future editor integrations.
- The practical contract goal is simple: CLI, API, Conduit, and LSP all sit on the same vault engine, so portability work should happen in shared core/intelligence layers first, not in editor-specific glue.

---

## Data Flow

```
Headless write / file change
        │
        ▼
src/core/vaultService.js  ──serialize mutate() / debounce notifyFileChange()──►  rebuild completed
        │
        ├──► src/core/index.js  ──buildIndex()──►  idIndex, pathIndex, fieldsCache, graph edges
        │
        ├──► src/api/eventsBus.js  ──fanout──►  SSE mutation events + rebuild events
        │
        └──► src/lsp/vaultService.js  ──fanout──►  publishDiagnostics for open docs

VS Code save / file change
        │
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

Event types: `note_created`, `note_deleted`, `note_touched`, `type_set`, `field_added`, `field_changed`, `field_removed`, `relation_added`, `relation_changed`, `relation_removed`, `completion_accepted`.

- 10,000 event cap with ring-buffer truncation on overflow
- 3-second dedup window prevents save-storm noise
- Filter API: by `noteId`, time range, event type
- Survives extension restarts (reloads from disk on `initMutationLog()`)
- `yamlink.importGitHistory` command backfills from git commit history via `gitHistoryImport.js`

The log is the data source for: Note Report history/timelines, Conduit recent activity, lifecycle stale detection, Vault Health activity views, API `/api/mutations`, API/SSE mutation fanout, and future external automation subscribers.

---

## Block Identity System

Yamlink assigns stable, typed IDs to every meaningful element inside a note body, not just to notes themselves. This is the foundation for sub-note-level linking: `note#Heading` for sections and `note^block-id` for tasks, quotes, and footnotes.

### The problem this solves

A wikilink resolves to a note. But a note is not always the right target. A task you want to reference lives on line 47 of a 300-line note. A specific blockquote is evidence for a claim in another note. A footnote contains source attribution that three other notes want to cite. Without block IDs, the only option is a note-level link that lands at the top of the file. Block IDs give every meaningful element its own stable address.

### Block extraction — `src/core/bodyBlocks.js`

`extractMeaningfulBodyBlocks(content)` is the pure extraction function. It parses raw Markdown content and returns an ordered array of `BodyBlock` records — one per addressable element. The function skips the frontmatter preamble (detects the `---` fence), then walks every body line once.

**Four block types are extracted:**

| Type | Pattern | Block ID scheme | Stability |
|---|---|---|---|
| `heading` | `# Heading text` (any depth H1–H6) | `h-{slug}` or `h-{slug}-{n}` for duplicates | Deterministic — heading text is the key. Survives note reordering. |
| `task` | `- [ ]` or `- [x]` checklist items | `t{n}-{hash6}` | Content-hash stable. ID changes only if the task text changes, not if other tasks are added above. |
| `quote` | `> ...` blockquote/callout blocks | `q{n}-{hash6}` | Content-hash stable. Multi-line quotes are collapsed to a single record. |
| `footnote` | `[^id]: ...` footnote definitions | `fn-{normalized-id}` | Deterministic from the footnote marker `[^source]` → `fn-source`. |

**The hash function** is djb2 (`h = ((h << 5) + h) ^ charCode`), producing a 6-character base36 string. The position counter (`n`) is a secondary key — it means `t1-abc123` and `t2-abc123` are distinct even if two tasks have identical text.

**Heading deduplication** uses a counter map: `h-results` gets `h-results` on first occurrence and `h-results-2` on second. This mirrors the anchor generation behavior of standard Markdown renderers.

**`BodyBlock` record:**

```js
{
  blockId: string,          // e.g. "h-methods", "t1-3f2a1b", "fn-source"
  type: 'heading' | 'task' | 'quote' | 'footnote',
  line: number,             // 0-indexed source line of the first line
  endLine: number,          // 0-indexed source line of the last line (multi-line blocks)
  label: string,            // human-readable: heading text, task text, first quote line, footnote marker
  text: string              // full normalized text of the block
}
```

**Helper functions:**

| Function | Purpose |
|---|---|
| `findBlockLine(blockIndex, noteId, blockId)` | Looks up the source line of a block by note ID + block ID. Returns `-1` if not found. Used by go-to-definition. |
| `findBodyBlockInLineRange(blocks, startLine, endLine)` | Finds the most tightly-scoped block overlapping a line range. Used to resolve the block at the current cursor position. Ties broken by smallest span, then earliest start line. |
| `formatBlockReference(noteId, block)` | Formats a copyable wikilink reference string: `noteId#Heading` for headings (section anchor), `noteId^block-id` for everything else (block sigil). |
| `normalizeAnchorText(value)` | Lowercases and slugifies heading text for ID generation. Matches standard anchor conventions. |

### Block index — `src/core/index.js`

The block index is a two-level map built inside `buildIndex()`:

```
blockIndex: Map<noteId, Map<blockId, BodyBlock>>
```

Every time a note is indexed, `extractMeaningfulBodyBlocks(content)` runs and the results are stored keyed first by note ID, then by block ID. This allows O(1) block lookup: `blockIndex.get(noteId)?.get(blockId)`. The index is cleared completely on rebuild (`blockIndex.clear()`) and is never persisted to disk.

Three access points:
- **`getBodyBlockIndex()`** — returns the full two-level map. Used by definition, hover, completion, Note Report, and LSP handlers.
- **Incremental update in `updateSingleNote()`** — when a single file saves, its block entries are replaced without clearing the full index.
- **Delete in `removeNote()`** — `blockIndex.delete(id)` cleans up removed notes.

### Wikilink parsing — `src/core/id.js`

`parseWikilink(raw)` returns `{ raw, target, label, anchor, blockId }`. It detects three modes:
- bare note link — `anchor` and `blockId` are empty
- section link (`note#Heading`) — `anchor` = `"Heading"`, `blockId` = `""`
- block link (`note^block-id`) — `blockId` = `"block-id"`, `anchor` = `""`

The `^` sigil is the block sigil (mirrored from Obsidian's convention). `#` is the anchor/section sigil. Both are parsed in a single pass.

### Surface integrations

**Go-to-definition (`src/features/definition.js`):**
When Ctrl+Click on a `note^t1-abc` block reference is triggered, `definition.js` resolves the note ID, then calls `findBlockLine(getBodyBlockIndex(), resolvedId, parts.blockId)` to get the exact 0-indexed line. The VS Code position is `new vscode.Position(blockLine, 0)`. The result is a single-character selection at the start of the block's line — the user lands exactly where the content is. Identical logic in `src/lsp/handlers/navigation.js` gives the same precision for LSP clients.

**Hover preview (`src/features/hover.js`):**
`buildBlockHoverContent(content, blockId)` runs `extractMeaningfulBodyBlocks` on the note content, finds the matching block, and returns its text for display in the hover card. For a task block, the hover shows the task text. For a heading, it shows the heading. For a quote, it shows the first line of the blockquote. This works without the block index — it re-extracts on demand to avoid coupling hover timing to index state.

**Completion (`src/features/completionItemBuilders.js`):**
After the user types the `^` sigil inside a wikilink, completion calls `extractMeaningfulBodyBlocks` on the target note's content, filters blocks whose `blockId` starts with the partial text already typed, and presents each as a `CompletionItem` with:
- `label` = `blockId`
- `detail` = `"Line {n} · {type}"` or `"Line {n} · section link"` for headings
- `filterText` keyed to the full wikilink prefix so the picker filters as you type

**Note Report (`src/features/entityHubModel.js`):**
When building the outbound links section of the Note Report, the model resolves block references in outbound links to their target label. If a block reference pointing to task `t1-abc` resolves to a task with label `"Deploy the patch"`, the Note Report shows `"Deploy the patch"` instead of the raw block ID. This makes outbound block reference lists readable.

**Block reference commands (`src/actions/blockReferenceCommands.js`):**
Six VS Code commands give cursor-aware single-keystroke access to block references:

| Command | Behavior |
|---|---|
| `yamlink.copyBlockReference` | Copies `note^block-id` to clipboard. Shows a QuickPick picker filtered to tasks, quotes, footnotes. If cursor is already on a block, skips the picker. |
| `yamlink.insertBlockReference` | Same as above, inserts at cursor instead of copying. Emits `block_reference_created` to mutation log. |
| `yamlink.copySectionReference` | Copies `note#Heading` to clipboard. Filtered to headings only. Can be triggered from the Note Outline sidebar with a preferred heading pre-selected. |
| `yamlink.insertSectionReference` | Inserts `note#Heading` at cursor. |
| `yamlink.copyScopedReference` | Detects the block under the cursor (any type) and copies the appropriate format — heading gets `#`, everything else gets `^`. |
| `yamlink.insertScopedReference` | Same as above, inserts. |

The cursor-detection path: `findCurrentAddressableBlock()` calls `findBodyBlockInLineRange(blocks, selection.start.line, selection.end.line)`. If a block is found, it is used directly — no QuickPick appears. If no block is found at the cursor, the QuickPick opens with all addressable blocks in the note.

**Mutation log:**
Insert commands write a `block_reference_created` event to `.yamlink/mutation-log.ndjson` with `{ type: 'block_reference_created', noteId, field: 'block_reference' | 'section_reference', newValue: reference, meta: { targetNoteId, blockType, blockId } }`. This event type is not yet surfaced in the activity feed or Note Report History tab — it is logged for future calibration and intelligence use.

**LSP (`src/lsp/handlers/`):**
- `navigation.js` (`textDocument/definition`, `textDocument/references`): calls `findBlockLine()` for block references. `textDocument/references` matches only references with the same `blockId` as the current position. References without an anchor or block ID are not returned when the current target is a block.
- `hover.js` (`textDocument/hover`): includes the block ID in the hover note info line when hovering a block reference.

### Syntax reference

| What you type | What it means |
|---|---|
| `note-id` (bare wikilink) | Link to a note |
| `note-id#Background` | Link to the "Background" heading in that note |
| `note-id^t1-3f2a1b` | Link to the first task whose text hashes to `3f2a1b` |
| `note-id^q2-77d3ca` | Link to the second blockquote in that note |
| `note-id^fn-source` | Link to the `[^source]` footnote in that note |

All three forms are written inside wikilink delimiters in body text and frontmatter values. The query engine does not yet filter by block reference — `!view where references note^block-id` is a planned future clause.

### What is not yet implemented

These are the natural next depths for the block ID system:

- **Broken block reference diagnostics** — currently, a `note^bad-id` reference resolves to the note root without an error. The diagnostic layer should flag unresolvable block IDs the same way it flags unresolvable note IDs.
- **Heading rename propagation** — if a heading text changes, all `note#Old Heading` references silently break. The rename propagation in `src/core/rename.js` covers note IDs; it needs a parallel path for heading anchors.
- **Block transclusion** — an embed syntax (e.g. `!note^block-id`) to inline a specific block's live content into another note. The block index already provides the source material; the rendering layer (Live Note sidecar + hover) would display it.
- **Block-level graph edges** — currently, a `note^block-id` block reference creates a note-to-note graph edge (the block part is discarded at graph-build time). A richer model would create an edge to the specific block, enabling "which notes reference this specific task" queries.
- **`!view` block query clauses** — `where references note^block-id` and `count-block-refs`.
- **Written stable IDs** — hash-based IDs for tasks and quotes change if the block content changes. Long-term, users may want to write explicit stable IDs in the Markdown (`^custom-id` at the end of a paragraph, Obsidian-style). Yamlink could support both: computed IDs for quick references, written IDs for durable ones.
- **Block-level backlinks panel** — the Note Report Relations tab shows inbound note-level links; it could also show "4 notes reference this specific task" at the block level.
- **API exposure** — `GET /api/nodes/:id` does not currently include the block index. A `?include=blocks` parameter would expose `{ blocks: [{ blockId, type, line, label }] }` for external tooling.

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
- [x] **Test baseline updated** — 1938/1938

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
