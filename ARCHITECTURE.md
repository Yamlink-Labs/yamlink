# Yamlink Architecture

Last updated: 2026-07-07

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
| Adapter | `src/features/graph2/graph2Payload.js` converts vault model to universal `{nodes,edges}`. `graph/adapter-yamlink/` and `graph/core/` are empty leftover directories — removed 2026-07-07, the logic lives inline in `src/features/graph/` and `graph2/` now, not in those paths. |
| Performance | Edge batching, frustum culling, label LOD, ~2000–3000 node ceiling |
| Camera | `resize()` scales camera offset proportionally so sidebar graph never appears blank on first open |

### Color system

The Yamlink Apollo palette is the authoritative color source for all webview surfaces.

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
| `d3-force` | DevDependency only — not used by the extension at runtime (inline `SimpleLayout` replaces it there, per the Graph engine table above); confirm current docs-site usage before citing a specific file path, `graph/core/` no longer exists |
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
│   ├── indexService.js         ← Shared index/generation accessors used by headless surfaces
│   ├── graph.js                ← Directed edge graph (outboundEdges, inboundEdges)
│   ├── frontmatter.js          ← YAML parse/write utilities
│   ├── id.js                   ← Canonical ID normalization (kebab-case)
│   ├── rename.js               ← Vault-wide wikilink rename propagation
│   ├── writeField.js           ← Surgical frontmatter field updates
│   ├── noteDiff.js             ← Pure compareNoteFields(id1, id2, fields1, fields2) — shared by CLI diff + API /api/diff
│   ├── timeEngine.js           ← Time Engine: reconstructNoteAtTime/reconstructVaultAtTime (backward-undo from current state via the mutation log), buildNoteTimeline/buildFieldTimeline (multi-point checkpoints), buildHistoricalGraph (shared by API `?at=` and CLI `--at`)
│   ├── vaultService.js         ← Shared headless rebuild coordinator (mutate + notifyFileChange), used by API/CLI/LSP
│   ├── bodyBlocks.js           ← Block identity extraction (headings/tasks/quotes/footnotes) — see Block Identity System below
│   ├── imageEmbed.js           ← Shared `![[image.png]]` embed resolution — one source of truth for hover, diagnostics, decorations, and Ctrl+Click
│   ├── templateRegistry.js     ← Smart Template lookup per type
│   ├── healthSnapshot.js       ← Vault Health data model shared by panel + CLI
│   ├── publish.js              ← 0.7.7 Authoring & Publishing: status-gate (isPublishable), slug/order convention, fence-aware wikilink→relative-URL resolution
│   ├── buildPipeline.js        ← 0.7.7: `runBuild()` — the `yamlink publish` engine (manifest, per-type JSON, asset pass-through, per-note content-hash caching — 0.7.9 fixed a real bug where a generation-counter check made this a no-op after the first CLI invocation — redirect map, pre-publish safety warnings, sitemap/feed/search-index)
│   └── ...
│
├── src/registries/             ← Type and schema registries (typeRegistry, schemaRegistry)
│
├── src/engine/                 ← Pure query engine. No VS Code imports. Split from a single 766-line query.js.
│   ├── query.js                ← Thin entry point (parseAllViewQueries, executeQuery)
│   ├── queryParser.js          ← !view clause parsing
│   ├── queryExecutor.js        ← Clause execution against fieldsCache
│   ├── queryConditions.js      ← where-clause condition evaluators
│   ├── queryCache.js           ← LRU 300-entry query result cache
│   └── suggestions.js / suggestionsContext.js / suggestionsExplain.js  ← Query-builder suggestion support
│
├── src/intelligence/           ← Pure inference layer. No VS Code imports. ~38 files; representative map below.
│   ├── fieldCategory.js        ← Multi-signal field classifier
│   ├── fieldPlanner.js         ← Maps confidence → surface action (SILENCE/COMPLETION_ONLY/HINT/DOCUMENT/QUICKFIX) per surface ('completion'/'lightbulb'/'decoration')
│   ├── fieldRolesCore.js / fieldRoles.js  ← Date/status/person/container/topic role inference
│   ├── authoringEngine.js      ← Shared classify→plan wrapper (`classifyFieldForAuthoring`, `evaluateFieldForSurface`) — the contract point both VS Code and LSP call into
│   ├── vaultPriors.js          ← Per-vault statistical maps, generation-keyed cache (typeFieldBundles, fieldTargetTypes, workflowFields, emergentClusters, relationshipGravity, behavioralRelationPriors, ...)
│   ├── suggestionCore.js       ← Thin entry point; split into suggestionScorer.js, suggestionRelations.js, suggestionNoteIndex.js and the frontmatter* family below
│   ├── frontmatterIntelligence.js, frontmatterFieldFamilies.js, frontmatterRelationLearning.js, frontmatterGapLearning.js, frontmatterAffinitySuggestions.js, frontmatterCompanionSuggestions.js, frontmatterContextSuggestions.js, frontmatterContextBuilders.js, frontmatterNeighborhoodSuggestions.js, frontmatterBodyHints.js  ← the split-out suggestion-building family (was one 1011-line suggestionCore.js)
│   ├── completionContextHelpers.js, completionRelationHelpers.js, completionAdaptiveHelpers.js  ← Duck-typed completion collectors (need only `document.getText()`/`.lineAt()`/`.uri.fsPath`) — shared verbatim by VS Code's `completionProviders.js` and LSP's `handlers/completion.js`. Relocated here from `src/features/` specifically so both surfaces could share them without VS Code imports.
│   ├── hoverBadge.js           ← Pure hover badge SVG/markdown builder, shared by VS Code hover and LSP hover
│   ├── clusterEmergence.js     ← Pre-schema field-signature cluster detection, feeds cold-start arc suggestions
│   ├── relationshipGravity.js  ← Scores (source, field, target) edges by structural corroboration + decayed mutation history
│   ├── lifecycleState.js       ← draft/growing/consolidated/hub/stale
│   ├── driftDetector.js        ← on-track/minor-drift/drifting/outlier vs vault bundles
│   ├── noteRolesCore.js        ← Person/event/artifact/etc role inference
│   ├── gitHistoryImport.js     ← Git commit history → mutation event backfill
│   ├── implicitWeights.js      ← Sticky relation knowledge from mutation log history + field volatility
│   ├── outcomeCalibration.js   ← Feedback loop: completion_accepted → per-field confidence boost
│   ├── noteArc.js              ← Arc prediction: missing fields ranked by vault frequency + calibration + emergent clusters
│   ├── intelligenceSnapshots.js ← Planner-gated note intelligence snapshot, consumed by LSP's executeCommand and VS Code
│   └── nlQuery.js              ← Natural language → !view syntax (16 patterns + vault vocabulary injection)
│
├── src/features/               ← VS Code surface providers and webview panels
│   ├── completion.js, completionCore.js, completionItemBuilders.js, completionProviders.js, completionTracker.js  ← Frontmatter + query completion, split from a single 849-line completion.js
│   ├── hover.js                ← Hover cards for wikilinks and !view blocks
│   ├── viewLightbulb.js, lightbulbUtils.js  ← Code action / lightbulb providers, including the adaptive-frontmatter suggestion system (largely VS-Code-only — see LSP handlers note below)
│   ├── suggestionCascade.js    ← Post-completion-acceptance field-cascade nudge
│   ├── viewPanel.js            ← Live table webview
│   ├── entityHub.js / entityHubModel.js  ← Note Report sidebar
│   ├── entity/unlinkedRefs.js  ← Unlinked body-text mention detection
│   ├── calendarPanel.js        ← Calendar webview
│   ├── healthPanel.js          ← Vault Health panel
│   ├── homePanel.js            ← Home panel (activity stream, pulse, nudges)
│   ├── home/                   ← Home panel HTML, CSS, browser-side JS
│   ├── preview/liveNotePanelController.js, liveNoteModel.js, liveNoteStyles.js, previewRenderer.js  ← Live Note rendered sidecar (synced preview beside the editor). 0.7.7: `yamlink.liveNotePreviewUrl` setting lets the panel embed a destination site's own dev server (iframe) for the current note instead of the normal rendered HTML, falling back to the normal render for a note with no resolvable `id:`
│   ├── noteOutline.js          ← Note Outline sidebar (section tree with per-heading metadata)
│   ├── importExternalVaults.js, importObsidian.js  ← Vault import (Obsidian/Notion/Evernote/Roam), split into src/importers/
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
│       ├── cat.js               ← Frontmatter snapshot + body for a note (--at <date> for a reconstructed historical snapshot, frontmatter only)
│       ├── report.js           ← Note report for a given ID (--at <date> for a historical report: fields + outbound only, no lifecycle/drift/inbound)
│       ├── links.js            ← Inbound / outbound links for a note (--at <date> for outbound-only historical links)
│       ├── graph.js            ← Export full vault graph as JSON (--at <date> for a historical graph reconstruction, via timeEngine.js's buildHistoricalGraph)
│       ├── story.js            ← Vault growth story: reconstructs the vault at --since <date> and reports note-count/type deltas, mutation-log activity, and busiest notes
│       └── export.js           ← Export vault as JSON or CSV
│
├── src/api/                    ← HTTP contract layer used by `yamlink serve`
│   ├── router.js               ← Declarative route table (`routeDefs`: `{ method, path, handler }`, `:param` paths compiled to regex, matched by one loop) — replaced a hand-wired if/else chain 2026-07-11, behavior-preserving
│   ├── handlers/               ← Endpoint handlers (`nodes`, `search`, `schema`, `diff`, `graph-traversal`, `history`, etc.)
│   ├── eventsBus.js            ← SSE client registry + rebuild / mutation fanout
│   ├── write.js                ← CLI-safe file write bridge for API mutations
│   └── http.js                 ← Shared headers, JSON helpers, error contract
│
├── src/conduit/                ← Ink-based terminal UI; reads only from the local API
│   ├── index.js                ← `yamlink conduit` entry
│   ├── App.js                  ← Screen router + global key model
│   ├── useApi.js               ← HTTP + SSE client helpers
│   └── screens/                ← 10 screens: Briefing, Query, Navigator, Explorer, Health, Search, Graph, Diff, Radar, Trends
│
├── src/lsp/                    ← Editor-agnostic LSP server over stdio. Active development track (Zed reopened as a target).
│   ├── server.js               ← `yamlink serve --lsp` — route() + run(), wiring only
│   ├── transport.js            ← JSON-RPC framing (Content-Length, stdin/stdout, send/respond/notify, bounded server-initiated request timeout)
│   ├── utils.js                ← URI helpers, WIKILINK_RE, wikilinkAtPosition, collectMdFiles, inFrontmatter
│   ├── documentState.js        ← Open-document text/version tracking, stale-request (`content-modified`) detection
│   ├── documentHelpers.js      ← Edit builders shared across handlers (scaffold identity, create note, replace/insert fields, convert relation fields, formatted frontmatter)
│   ├── documentStructure.js    ← Shared frontmatter/heading structure builder (selectionRange/foldingRange/symbols)
│   ├── vaultService.js         ← rebuildIndex, push + pull diagnostics collectors, `flushPendingRebuild()` for race-free exit/pull-diagnostics
│   └── handlers/               ← 15 modules, 30+ JSON-RPC methods — one module per method group
│       ├── lifecycle.js        ← initialize, initialized, cancelRequest
│       ├── sync.js             ← didOpen, didChange, didClose, didChangeWatchedFiles
│       ├── completion.js       ← wikilink + frontmatter key/value completion, implicit relation-value completion (planner-gated), all 6 VS-Code-parity key-suggestion signal sources + schema fields
│       ├── hover.js            ← hover card — shares `hoverBadge.js`'s colored badges with VS Code, plus clickable relation/body file:// links
│       ├── navigation.js       ← definition, references (including block-reference precision via `findBlockLine()`)
│       ├── rename.js           ← prepareRename, rename (with $/progress streaming)
│       ├── symbols.js          ← documentSymbols, workspaceSymbol
│       ├── structure.js        ← selectionRange, foldingRange
│       ├── codeAction.js       ← broken-link/duplicate-id/schema-repair/missing-field quickfixes, refactor.rewrite (normalize frontmatter, convert relation fields), and the planner-gated empty-field "Use X for field?" quickfix (`buildEmptyFieldQuickfixes`)
│       ├── diagnostics.js      ← textDocument/diagnostic, workspace/diagnostic (pull + push)
│       ├── inlayHint.js        ← Positioned relation hints, planner-gated via `authoringEngine.js`
│       ├── semanticTokens.js   ← textDocument/semanticTokens/full
│       ├── formatting.js       ← Frontmatter normalization edits
│       ├── callHierarchy.js    ← prepareCallHierarchy, incomingCalls, outgoingCalls
│       └── executeCommand.js   ← noteIntelligence, noteArc, fieldCategory, addMissingFields, scaffoldIdentity, normalizeFrontmatter, convertRelations — richer payloads via `intelligenceSnapshots.js` (timeInState, mutationVelocity, crossNotePatterns), bidirectional `workspace/applyEdit`
│
└── graph/                      ← x-graph engine (Canvas2D, used as webview URI)
    └── renderer/               ← Canvas2DRenderer.js (self-contained, no imports)
        (graph/core/ and graph/adapter-yamlink/ were empty leftover directories,
         removed 2026-07-07 — the layout/adapter logic they once held now lives
         inline in src/features/graph/ and src/features/graph2/)
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
| `yamlink ls` | List notes. `--type`, `--sort`. |
| `yamlink cat <id>` | Print a single note's resolved content. `--at <date>` reconstructs frontmatter as of that date (no body — the mutation log has no body-text concept). |
| `yamlink grep <text>` | Full-text search across note bodies. `--type`, `--field`. |
| `yamlink find` | Find notes by field presence/absence. `--has`, `--missing`, `--type`. |
| `yamlink suggest <id>` | Field/relation suggestions for a specific note (CLI-side arc/completion parity). |
| `yamlink drift` | List notes ranked by drift from their type's learned bundle. `--type`, `--limit`. |
| `yamlink stale` | List notes ranked by staleness (lifecycle). `--type`, `--limit`. |
| `yamlink orphans` | List notes with no inbound or outbound links. `--type`, `--limit`. |
| `yamlink pressure` | Vault-wide "knowledge pressure" summary (where the vault most needs attention). |
| `yamlink lenses` | Saved/derived vault lenses (curated views). |
| `yamlink session` | Session activity summary from the mutation log. `--id`. |
| `yamlink env` | Print/generate shell environment integration (`--shell`). |
| `yamlink briefing` | Morning summary: vault pulse, overdue/today tasks, recent activity, arc predictions, drift flag. |
| `yamlink create <type>` | Create a note non-interactively. Runs before index bootstrap. |
| `yamlink diff <id1> <id2>` | Compare two notes' frontmatter field sets. Human diff or JSON contract. `--since <date>` compares field changes across the whole vault instead. |
| `yamlink story --since <date>` | Vault growth story via the Time Engine: note-count/type deltas, mutation-log activity, and busiest notes between `<date>` and now. |
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
| `yamlink report <id>` | Full note report: type, lifecycle, drift, links. `--at <date>` reconstructs a historical report (fields + outbound only — lifecycle/drift/inbound are live-vault inferences with no historical concept). |
| `yamlink links <id>` | Outbound and inbound links for a note. `--at <date>` reconstructs outbound-only historical links (inbound-at-a-point needs whole-vault reconstruction — use `graph --at` for that). |
| `yamlink set <id> <field> <value>` | Set or remove a frontmatter field. `--clear` removes; `--dry-run` previews. Emits mutation events with `source: 'cli'`. |
| `yamlink link <id> <field> <target>` | Add a `[[wikilink]]` relation field. Validates target exists in index. `--append` for multi-value fields. |
| `yamlink mutations` | Show recent mutation events from `.yamlink/mutation-log.ndjson`. `--limit`, `--since`, `--type`. |
| `yamlink graph` | Export full vault graph as `{ nodes, edges }` JSON. `--only-types` to filter. `--at <date>` reconstructs the whole vault's nodes and edges as they existed at that moment (via `timeEngine.js`'s `reconstructVaultAtTime`/`buildHistoricalGraph`). |
| `yamlink serve` | Local HTTP API — see below. |
| `yamlink conduit` | Launch the Ink-based terminal UI that talks to the local API. |
| `yamlink publish --out <dir>` | 0.7.7 Authoring & Publishing: build a static, structured content payload for a site generator (Astro/Next/Eleventy). `--mode preview\|production`, `--site-url` (sitemap/feed), `--webhook`, `--force`. |
| `yamlink export` | Export vault as JSON or CSV. `--id <id> --format html [--output <path>]` (0.7.7): a single note as a standalone, self-contained HTML file — resolved links, resolved `!view` snapshots, callout styling, no VS Code dependency. |

### Local HTTP API (`yamlink serve`)

`yamlink serve` exposes the vault as a local REST API on `127.0.0.1`. Full endpoint-by-endpoint reference (method, path, params, response shape, error codes) at [`CONTRACT.md`](CONTRACT.md).

**Read endpoints:** `GET /api/nodes`, `GET /api/nodes/:id` (`?at=` time travel, `?include=` composite reads, `?minGeneration=` read-your-writes), `GET /api/nodes/:id/outbound`, `GET /api/nodes/:id/inbound`, `GET /api/nodes/:id/neighborhood`, `GET /api/nodes/:id/history`, `GET /api/nodes/:id/evolution`, `GET /api/nodes/:id/archaeology`, `GET /api/search`, `GET /api/schema`, `GET /api/diff` (two-note compare or `?since=` vault-wide changes), `GET /api/query`, `GET /api/graph` (`?at=` for a historical reconstruction), `GET /api/tasks`, `GET /api/mutations`, `GET /api/session/summary`, `GET /api/types`, `GET /api/health`, `GET /api/intelligence/note`, `GET /api/intelligence/arc`, `GET /api/intelligence/fieldCategory`, `GET /api/intelligence/clusters`, `GET /api/intelligence/lenses`

**Write endpoints:** `POST /api/nodes`, `POST /api/nodes/bulk`, `PATCH /api/nodes/:id`, `PATCH /api/nodes/bulk`, `DELETE /api/nodes/:id`

**Pagination contract:** `/api/nodes`, `/api/search`, and `/api/schema` return wrapper objects with `meta: { total, page, limit, pages }`. Search is capped at `200`, schema at `100`, node listing at `500`.

**Event stream:** `GET /api/events` — Server-Sent Events, filterable via `?note=`/`?noteType=`/`?type=`. Pushes `connected`, fine-grained mutation events (`note_created`, `note_deleted`, `note_touched`, `type_set`, `field_added`, `field_changed`, `field_removed`, `relation_added`, `relation_changed`, `relation_removed`, `completion_accepted`), and after each rebuild a `{ type: 'rebuild', generation }` followed by `{ type: 'intelligence_changed', generation, changedId }` — the reactive signal for recomputed derived intelligence (lifecycle/drift/arc/priors), distinct from `rebuild`'s raw-field-invalidation signal.

**Generation header:** Every response includes `X-Yamlink-Generation: <n>` — an integer that increments on every completed rebuild. Clients use this to detect stale cached data.

**Stability policy:** the v1 route/response contract is documented in [`CONTRACT.md`](./CONTRACT.md); breaking changes to an existing route are avoided in favor of new `include=`/query params.

**Write model:** headless surfaces now share a single `VaultService` (`src/core/vaultService.js`). API writes go to disk through the CLI-safe write layer inside `vaultService.mutate(writeFn)`, which serializes the write and the post-write rebuild as one atomic unit. Mutation events are appended to `.yamlink/mutation-log.ndjson` and fanned out immediately; when the rebuild completes, a final rebuild event is emitted and the generation header advances. File-watcher rebuilds also flow through the same service via `notifyFileChange()`.

### Conduit and LSP

- **Conduit** (`yamlink conduit`, or simply `yamlink`) is a long-running terminal interface built with Ink. Ten screens (Briefing, Query, Navigator, Explorer, Health, Search, Graph, Diff, Radar, Trends), each a single keypress away. Conduit talks only to the local HTTP API and SSE stream — it imports no Yamlink internals directly. Running `yamlink` with no arguments auto-starts the API server in-process if one is not already listening on the configured port, then shuts it down on exit.
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

`src/runtime/mutationEventLog.js` — persisted NDJSON append log at `.yamlink/mutation-log.ndjson`. Event types are centrally registered in `src/runtime/mutationEventTypes.js`. The Time Engine (`src/core/timeEngine.js`) reconstructs historical note/vault state by undoing these events backward from the current state.

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

**Authoring Engine convergence — shared duck-typed collectors, not shared UI.** VS Code and LSP must never re-derive the same inference logic independently — that's how the two surfaces drift (the hover-badge duplication and the LSP frontmatter-completion note-id/type-detection bug, both found and fixed 2026-07-06/07, were exactly this failure mode). The fix is not to make VS Code depend on the LSP protocol, or vice versa — VS Code's native extension API (webviews, tree views, decorations) is strictly richer than LSP, so that direction would be a regression. Instead, every collector/classifier function that both surfaces need lives in `src/intelligence/` and is written duck-typed: it calls only `document.getText()`, `document.lineAt(n)`, and `document.uri.fsPath` — never a real `vscode.TextDocument`. A plain object literal (`{ getText, lineAt, uri }`) stands in for the LSP side. `src/intelligence/authoringEngine.js`'s `classifyFieldForAuthoring`/`evaluateFieldForSurface` is the shared contract point: both VS Code (`'completion'`/`'lightbulb'`/`'decoration'` surfaces) and LSP call the same classify→plan pipeline and get the same confidence gating. What does *not* converge: presentation. VS Code's Note Report, Graph, Health, and Calendar panels are webviews with no LSP equivalent, and that's correct — LSP should only ever gain features that map onto real LSP protocol methods (`textDocument/completion`, `textDocument/codeAction`, etc.), not attempt to replicate VS Code's UI surfaces.

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
- [x] **Test baseline updated** — see `scripts/test-count-baseline.json` for the current number (grows every session; do not hardcode it here)
- [x] **P3 monolith splits (original 3) — all done**: `src/engine/query.js` (766 → 24 lines; split into `queryParser.js`/`queryExecutor.js`/`queryConditions.js`/`queryCache.js`/`suggestions*.js`), `src/intelligence/suggestionCore.js` (1011 → 64 lines; split into the `frontmatter*`/`suggestion*` family), `src/features/completion.js` (849 → 201 lines; split into `completionCore.js`/`completionItemBuilders.js`/`completionProviders.js`/`completionTracker.js`)
- [x] **P3 monolith splits (found during the 0.7.4 pass, not on the original list)** — `src/actions/queryBuilderPanel.js` (1830→298 lines), `src/actions/codeActionsNodeCreationCommands.js` (991→87 lines, handlers split into `nodeCreationHandlers.js`), `src/features/graph/graphClientXGraphScript.js` (996→36 lines, fragments in `xgraphClientBody.js`), `src/features/importExternalVaults.js`/`importObsidian.js` split into `src/importers/{notion,evernote,roam,obsidian,shared}.js`. Structural only — no behavior changes, full suite stayed green throughout each split.
- [ ] **`src/conduit/screens/Explorer.js`** (1086 lines) — deliberately deferred, not done. Stateful React/Ink component, not a mechanical split; needs custom-hook extraction with real state-ownership decisions and has no test coverage to catch mistakes. Needs its own dedicated pass.

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

1. [x] Add `tsconfig.json` with `checkJs: true` — done. JSDoc type annotations now enforced across 15+ files as part of CI (caught 3 real bugs during the 0.6.29f typecheck pass).
2. Migrate `src/engine/query.js` → `.ts` as pilot — not started
3. Migrate `src/intelligence/` (implicit module contracts are the highest-risk area) — not started
4. Migrate `src/core/`, `src/actions/`, `src/diagnostics/` — not started
5. `src/features/` last (VS Code API types add surface area) — not started
6. Webview TypeScript enabled automatically once P1 is complete

### Not planned

- Bundling the extension host — unnecessary at this scale; no build step is a feature
- Adding a UI framework to webviews — Canvas2D graph proves vanilla TypeScript is sufficient
- Switching from `node:test` — it's the right runner
- Replacing pdfkit — correct tool, now lazy-loaded
