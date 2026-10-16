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
│   ├── bulkFieldOperation.js   ← Shared set/add/clear field-operation core (value trim, wikilink-list add with idempotency, scalar-field rejection) — the one implementation `yamlink bulk-set` (CLI), `PATCH /api/nodes/bulk`'s `{ add }` mode, and VS Code's `Yamlink: Bulk Set Field on Selected Notes` all read, not three separate copies
│   ├── noteDiff.js             ← Pure compareNoteFields(id1, id2, fields1, fields2) — shared by CLI diff + API /api/diff
│   ├── timeEngine.js           ← Time Engine: reconstructNoteAtTime/reconstructVaultAtTime (backward-undo from current state via the mutation log), buildNoteTimeline/buildFieldTimeline (multi-point checkpoints), buildHistoricalGraph (shared by API `?at=` and CLI `--at`)
│   ├── vaultService.js         ← Shared headless rebuild coordinator (mutate + notifyFileChange), used by API/CLI/LSP
│   ├── bodyBlocks.js           ← Block identity extraction (headings/tasks/quotes/footnotes) — see Block Identity System below
│   ├── imageEmbed.js           ← Shared `![[image.png]]` embed resolution — one source of truth for hover, diagnostics, decorations, and Ctrl+Click
│   ├── templateRegistry.js     ← Smart Template lookup per type — `getTemplatesForType()` returns every template for a type (plural; multiple templates per type are supported), `getTemplateForType()` stays for single-match call sites; `saveTemplateFile()` takes an optional `templateName` to save alongside an existing template instead of always overwriting `<type>.md`
│   ├── healthSnapshot.js       ← Vault Health data model shared by panel + CLI
│   ├── publish.js              ← 0.7.7 Authoring & Publishing: status-gate (isPublishable), slug/order convention, fence-aware wikilink→relative-URL resolution
│   ├── buildPipeline.js        ← 0.7.7: `runBuild()` — the `yamlink publish` engine (manifest, per-type JSON, asset pass-through, per-note content-hash caching — 0.7.9 fixed a real bug where a generation-counter check made this a no-op after the first CLI invocation — redirect map, pre-publish safety warnings, sitemap/feed/search-index)
│   └── ...
│
├── src/registries/             ← Type and schema registries (typeRegistry, schemaRegistry)
│
├── src/engine/                 ← Pure query engine. No VS Code imports. Split from a single 766-line query.js.
│   ├── query.js                ← Thin entry point (parseAllViewQueries, executeQuery)
│   ├── queryParser.js          ← !view clause parsing, incl. VQL v1 graph traversal (`linked_to`/`linked_from`/`within N`, capped at 5 hops) and temporal (`as of <date>`)
│   ├── queryExecutor.js        ← Clause execution against fieldsCache; `linked_to`/`linked_from` resolved via a cycle-safe BFS (`collectTraversalIds`) over `core/graph.js`; `as of` swaps the row source to a `reconstructVaultAtTime()` snapshot (`core/timeEngine.js`) instead of live fieldsCache — frontmatter fields only, computed/virtual fields stay live
│   ├── queryConditions.js      ← where-clause condition evaluators
│   ├── queryCache.js           ← LRU 300-entry query result cache
│   ├── mathExpr.js / inlineCalc.js / crossNoteCalcResolver.js ← Inline calculation evaluator, scanner, and I/O-backed single-hop `[[note]]^label` resolver
│   └── suggestions.js / suggestionsContext.js / suggestionsExplain.js  ← Query-builder suggestion support
│
├── src/intelligence/           ← Pure inference layer. No VS Code imports. ~38 files; representative map below.
│   ├── fieldCategory.js        ← Multi-signal field classifier
│   ├── fieldPlanner.js         ← Maps confidence → surface action (SILENCE/COMPLETION_ONLY/HINT/DOCUMENT/QUICKFIX) per surface ('completion'/'lightbulb'/'decoration')
│   ├── fieldRolesCore.js / fieldRoles.js  ← Date/status/person/container/topic role inference
│   ├── authoringEngine.js      ← Shared classify→plan wrapper (`classifyFieldForAuthoring`, `evaluateFieldForSurface`) — the contract point both VS Code and LSP call into
│   ├── vaultPriors.js          ← Per-vault statistical maps, generation-keyed cache (typeFieldBundles, fieldTargetTypes, workflowFields, emergentClusters, relationshipGravity, behavioralRelationPriors, ...)
│   ├── formulaPriors.js        ← Vault-learned calc-formula patterns, bucketed by note type, generation-keyed cache — the same "vault teaches the system" idea as vaultPriors.js, applied to inline calc formulas
│   ├── suggestionCore.js       ← Thin entry point; split into suggestionScorer.js, suggestionRelations.js, suggestionNoteIndex.js and the frontmatter* family below
│   ├── frontmatterIntelligence.js, frontmatterFieldFamilies.js, frontmatterRelationLearning.js, frontmatterGapLearning.js, frontmatterAffinitySuggestions.js, frontmatterCompanionSuggestions.js, frontmatterContextSuggestions.js, frontmatterContextBuilders.js, frontmatterNeighborhoodSuggestions.js, frontmatterBodyHints.js  ← the split-out suggestion-building family (was one 1011-line suggestionCore.js)
│   ├── completionContextHelpers.js, completionRelationHelpers.js, completionAdaptiveHelpers.js  ← Duck-typed completion collectors (need only `document.getText()`/`.lineAt()`/`.uri.fsPath`) — shared verbatim by VS Code's `completionProviders.js` and LSP's `handlers/completion.js`. Relocated here from `src/features/` specifically so both surfaces could share them without VS Code imports.
│   ├── hoverBadge.js           ← Pure hover badge SVG/markdown builder, shared by VS Code hover and LSP hover
│   ├── clusterEmergence.js     ← Pre-schema field-signature cluster detection, feeds cold-start arc suggestions
│   ├── relationshipGravity.js  ← Scores (source, field, target) edges by structural corroboration + decayed mutation history
│   ├── structuralSignature.js  ← Structural signatures: macro-level vault shape (dominant types, field-bundle rigidity, hub concentration, recent growth rate) from data already computed elsewhere — no new vault scan, no hardcoded archetype list, every number ships with a plain honest sentence
│   ├── workflowMemory.js       ← Workflow memory v1: field-pair co-occurrence across real authoring sessions, grouped by time window (not `sessionId` — unset on every VS Code write path). Feeds `suggestionCascade.js` as a fallback nudge only when the arc-based suggestion has nothing confident
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
│   ├── viewCodeLens.js         ← CodeLens provider: "Run"/"Close" above `!view` blocks (the sibling block-reference CodeLens, `blockAffordances.js`, was removed in 0.8.1 — unconditional, no setting, redundant with the existing right-click reference commands)
│   ├── entityHub.js / entityHubModel.js  ← Note Report sidebar
│   ├── entity/unlinkedRefs.js  ← Unlinked body-text mention detection
│   ├── calendarPanel.js        ← Calendar webview
│   ├── healthPanel.js          ← Vault Health panel
│   ├── homePanel.js            ← Home panel (activity stream, pulse, nudges)
│   ├── home/                   ← Home panel HTML, CSS, browser-side JS
│   ├── preview/liveNotePanelController.js, liveNoteModel.js, liveNoteStyles.js, previewRenderer.js  ← Live Note rendered sidecar (synced preview beside the editor). 0.7.7: `yamlink.liveNotePreviewUrl` setting lets the panel embed a destination site's own dev server (iframe) for the current note instead of the normal rendered HTML, falling back to the normal render for a note with no resolvable `id:`
│   ├── noteOutline.js          ← Note Outline sidebar (section tree with per-heading metadata)
│   ├── importExternalVaults.js, importObsidian.js  ← Vault import (Obsidian/Notion/Evernote/Roam), split into src/importers/; `src/importers/importTrust.js` builds the per-platform trust profile (what preserves well, what to review, what the export format itself can't carry) surfaced in both the confirmation QuickPick and the generated import report
│   ├── graph/                  ← x-graph workspace panel (Canvas2D)
│   └── graph2/                 ← x-graph sidebar panel (same renderer)
│
├── src/actions/                ← Code action providers and view builder
├── src/diagnostics/            ← Broken links, duplicate IDs, schema violations
├── src/runtime/                ← RefreshRouter, performance tracker, mutation log, webhooks.js, daemonRegistry.js (PID-file-backed registry for `yamlink on --daemon` — real liveness checks via `process.kill(pid, 0)`, self-pruning stale records)
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
| `yamlink signature` | Structural signature: dominant types, field-bundle rigidity, hub concentration, recent growth rate (`intelligence/structuralSignature.js`). |
| `yamlink workflow-memory --type <type>` | Repeated field-pair co-occurrence across real authoring sessions, time-window grouped (`intelligence/workflowMemory.js`). Feeds `suggestionCascade.js`'s nudge as a fallback when arc has nothing confident. |
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
| `yamlink on <event> -- <script>` | Automation hooks — watch loop + script exec on matching mutation events. `--daemon` spawns it as a real detached background process (survives closing the terminal); `--list`/`--stop <id>`/`--stop-all` manage running daemons via `daemonRegistry.js`'s real PID-liveness checks. Watcher itself retries with exponential backoff (up to 5 attempts) on a real `fs.watch` failure instead of dying silently. |
| `yamlink completions bash\|zsh` | Print shell completion script. |
| `yamlink health` | Vault health overview: lifecycle, drift, type distribution. |
| `yamlink schema list\|check <type>` | Schema introspection — list all schema targets or check conformance for a type. |
| `yamlink validate` | Schema conformance check. Exits 1 on required-field violations. |
| `yamlink query "<clause>"` | Run a Yamlink query. Accepts bare clauses (`where type = x`) or full `!view` syntax. ASCII table or JSON. |
| `yamlink report <id>` | Full note report: type, lifecycle, drift, links. `--at <date>` reconstructs a historical report (fields + outbound only — lifecycle/drift/inbound are live-vault inferences with no historical concept). |
| `yamlink links <id>` | Outbound and inbound links for a note. `--at <date>` reconstructs outbound-only historical links (inbound-at-a-point needs whole-vault reconstruction — use `graph --at` for that). |
| `yamlink set <id> <field> <value>` | Set or remove a frontmatter field. `--clear` removes; `--dry-run` previews. Emits mutation events with `source: 'cli'`. Goes through `vaultService.mutate()` (matching `create`/`rename`) — a real fix, this used to write directly via `fs.writeFileSync`, the only write command that didn't. |
| `yamlink bulk-set --ids <a,b,c> --field <name>` | Apply one `--value`/`--add`/`--clear` field change across many notes in a single command. `--add` treats the field as a wikilink-list relation (idempotent, creates the list if absent, fails clearly on a scalar field). Per-note failure isolation — one bad id doesn't abort the batch. `--dry-run`/`--json` supported. |
| `yamlink link <id> <field> <target>` | Add a `[[wikilink]]` relation field. Validates target exists in index. `--append` for multi-value fields. |
| `yamlink mutations` | Show recent mutation events from `.yamlink/mutation-log.ndjson`. `--limit`, `--since`, `--type`. |
| `yamlink graph` | Export full vault graph as `{ nodes, edges }` JSON. `--only-types` to filter. `--at <date>` reconstructs the whole vault's nodes and edges as they existed at that moment (via `timeEngine.js`'s `reconstructVaultAtTime`/`buildHistoricalGraph`). |
| `yamlink serve` | Local HTTP API — see below. |
| `yamlink conduit` | Launch the Ink-based terminal UI that talks to the local API. |
| `yamlink publish --out <dir>` | 0.7.7 Authoring & Publishing: build a static, structured content payload for a site generator (Astro/Next/Eleventy). `--mode preview\|production`, `--site-url` (sitemap/feed), `--webhook`, `--force`. |
| `yamlink export` | Export vault as JSON or CSV. `--id <id> --format html [--output <path>]` (0.7.7): a single note as a standalone, self-contained HTML file — resolved links, resolved `!view` snapshots, callout styling, no VS Code dependency. |
| `yamlink block-backlinks <note-id>` | List every real `[[note-id#heading]]`/`[[note-id^block-id]]` reference pointing at a specific block in this note. `--block <block-id>` narrows to one block. |
| `yamlink glossary` | Vault-wide glossary of terms/values with backlink counts. `--type`, `--no-group-by-type`, `--hide-unreferenced`, `--extra-field <name>`, `--sort-by-references`. |
| `yamlink hooks add\|list\|remove` | Manage webhook registrations (`POST /api/hooks` equivalent) — fires an HTTP callback on a matching mutation event, distinct from `on`'s local script-exec model. `hooks add <event> <url> [--type <noteType>]`, `hooks list`, `hooks remove <id>`. |
| `yamlink restore <timestamp>` | Reconstruct the whole vault as it existed at a point in time via the Time Engine, printed as real Markdown notes (not JSON) — a dry-run preview of an actual restore, not a mutating operation. `--output <dir>` writes the reconstructed notes to disk instead of stdout; incomplete reconstructions (past the mutation-log/snapshot boundary) are flagged per-note. |
| `yamlink snapshot` | Force an immediate vault snapshot to `.yamlink/vault-snapshots.ndjson`, independent of the automatic snapshot-before-prune cycle. `--reason <text>` records why. |
| `yamlink template save <id>` | Save an existing note as a reusable template for its type. `--force` overwrites an existing template of the same name. |
| `yamlink trends` | Vault Projections from the CLI: Growth/Stale/Structure trend lanes with confidence and evidence, reusing `vaultTrends.js`'s real least-squares regression. `--output <path>` writes JSON instead of printing. |

### Local HTTP API (`yamlink serve`)

`yamlink serve` exposes the vault as a local REST API on `127.0.0.1`. Full endpoint-by-endpoint reference (method, path, params, response shape, error codes) at [`CONTRACT.md`](CONTRACT.md).

**Read endpoints:** `GET /api/nodes`, `GET /api/nodes/:id` (`?at=` time travel, `?include=` composite reads, `?minGeneration=` read-your-writes), `GET /api/nodes/:id/outbound`, `GET /api/nodes/:id/inbound`, `GET /api/nodes/:id/neighborhood`, `GET /api/nodes/:id/history`, `GET /api/nodes/:id/evolution`, `GET /api/nodes/:id/archaeology`, `GET /api/search`, `GET /api/schema`, `GET /api/diff` (two-note compare or `?since=` vault-wide changes), `GET /api/query`, `GET /api/graph` (`?at=` for a historical reconstruction), `GET /api/graph/history`, `GET /api/tasks`, `GET /api/mutations`, `GET /api/session/summary`, `GET /api/types`, `GET /api/health`, `GET /api/intelligence/note`, `GET /api/intelligence/arc`, `GET /api/intelligence/fieldCategory`, `GET /api/intelligence/clusters`, `GET /api/intelligence/trends`, `GET /api/intelligence/lenses`, `GET /api/glossary`, `GET /api/hooks`

**Write endpoints:** `POST /api/nodes`, `POST /api/nodes/bulk`, `PATCH /api/nodes/:id`, `PATCH /api/nodes/bulk` (per-field values overwrite by default; `{ add: "value" }` instead of a plain value appends to a wikilink-list relation field, same idempotent/scalar-rejection semantics as `yamlink bulk-set --add` — both read `core/bulkFieldOperation.js`), `DELETE /api/nodes/:id`, `POST /api/hooks`, `PATCH /api/hooks/:id`, `DELETE /api/hooks/:id` (webhook registration CRUD — same underlying registry `yamlink hooks` manages from the CLI)

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

## Inline Calculation Engine

Real arithmetic, evaluated live inside a note's body via an explicit, opt-in inline code-span syntax — `` `=expr` `` for an anonymous calculation, `` `name=expr` `` to also give it a referenceable name. Every calculation, named or not, also gets an automatic Excel-style cell label (`Y1`, `Y2`, `Y3`...) in document order, so a later formula can reference an earlier one without needing an explicit name.

### The problem this solves

A note with a receipt, a budget, or a unit-conversion table previously had no way to show a computed value without the user doing the arithmetic elsewhere and typing in the result by hand — a number with no traceable formula behind it, silently stale the moment an input changes. The calc engine gives a note body real, live, auditable computation, without turning Yamlink into a spreadsheet (no grid, no 2D layout — everything stays plain prose with an explicit marker).

### Evaluator — `src/engine/mathExpr.js`

Pure, dependency-free, no VS Code imports. A hand-rolled recursive-descent parser (`tokenize` → `createParser` → `parsePrimary`/`parseExponent`/`parseUnary`/`parseTerm`/`parseExpression`), not a third-party library — the supported grammar is bounded, and this keeps the whole evaluator auditable in one file, matching the project's "no build step, pure CommonJS" rule.

**Grammar** (precedence low → high): `expression := term (('+' | '-') term)*`, `term := unary (('*' | '/' | '%') unary)*` (also handles implicit multiplication — `2(1+1)`, `2sqrt(9)` — same precedence, left-to-right), `unary := ('-' | '+') unary | exponent`, `exponent := primary ('^' unary)?` (right-associative: `2^3^2` = `2^(3^2)` = 512, not `(2^3)^2`), `primary := number | string | true | false | '(' expression ')' | ident '(' args ')' | ident`, `args := argument (',' argument)*`, `argument := expression | Y<N>:Y<M>` (ranges are valid only in function-call argument slots).

**Functions**: `sqrt`, `abs`, `round`, `floor`, `ceil`, `sum`/`average`/`min`/`max` (variadic), `sin`/`cos`/`tan` (radians), `log` (base 10), `ln` (natural log), `sign`, `exp`.

**Constants**: `pi`, `e` — resolved only as a fallback after checking `env` first, so a user's own same-named variable always shadows the built-in (a physics note's own `e` means what the user typed, not silently Euler's number).

**Value types.** A value is a plain JS `number`, `string`, or `boolean` — `typeof` is the type tag, no wrapper object. String literals (`"..."`/`'...'`, with `\"`/`\'`/`\\` escapes) and the reserved literal keywords `true`/`false` join `number` as the three primary value kinds. `true`/`false` are checked in `parsePrimary()` *before* the `env`/`CONSTANTS` lookup — unlike `pi`/`e`, they can never be shadowed by a same-named cell; `inlineCalc.js` also rejects a cell literally named `true`/`false` outright at definition time (`RESERVED_LITERAL_NAMES`, exported from this module), so there's no path to a confusing silent-shadow. Every arithmetic operator requires number operands and fails with a clear `#VALUE!` otherwise (`assertNumber()`), with one deliberate overload: `+` between two strings concatenates, the one place this evaluator lets `+` mean something besides addition — no other mixed-type coercion exists (`"3" + 3` is a `#VALUE!`, never `"33"` or `NaN`).

**Comparisons and booleans.** `==`/`!=` (`valuesEqual()`) compare across any types and never fail — a different type is simply "not equal," a meaningful answerable question, unlike arithmetic on mismatched types. Ordering (`> < >= <=`, `compareOrdering()`) requires both sides to be the *same* type, and that type must be `number` or `string` — booleans have no ordering (`#VALUE!`, never a guessed `false < true`). Comparisons are deliberately non-chaining: `1 < 2 < 3` parses only `1 < 2`, leaving `< 3` to fail as an honest trailing-token error. `and`/`or`/`not` are keywords, not symbols (`&&`/`||`/`!`) — recognized structurally by parse position via dedicated grammar levels (`parseOr`/`parseAnd`/`parseNot`), the same way `true`/`false` are, so (per `RESERVED_KEYWORD_NAMES`, alongside `if`) a cell can never be named one of them either. `and`/`or` evaluate both operands eagerly — a deliberate, bounded scope cut, not a missed optimization. `if(cond, thenValue, elseValue)` is the one construct that genuinely short-circuits: since this parser evaluates directly as it parses (no separate AST), `parseIfCall()` first does a cheap paren/comma-depth scan over the token stream to locate the three argument spans *without evaluating anything*, then hands only the taken branch's tokens to a fresh sub-parser — the untaken branch's tokens are never parsed at all, so `` `=if(x != 0, 10/x, 0)` `` never divides by zero when `x` is `0`, matching Excel's `IF`, not eager per-argument evaluation like every other function.

`and`/`or`/`not` are ALSO ordinary `FUNCTIONS` entries (`and(a, b)`, `or(a, b)`, `not(a)`) — a pure alias alongside the infix keyword form above, added with zero new parser branches. This works for free because of `parsePrimary()`'s existing dispatch order: an identifier immediately followed by `(` already resolves through the `FUNCTIONS` lookup *before* the `RESERVED_KEYWORD_NAMES` rejection ever runs — confirmed by tracing that order directly before adding this, not assumed. Each local-consts both operands before combining them (`const left = assertBoolean(a, 'and'); const right = assertBoolean(b, 'and'); return left && right;`), for the identical reason `parseAnd()`/`parseOr()` already do: inlining `a && b`/`a || b` directly would let JS's own short-circuit evaluation skip validating the second operand's type whenever the first alone determines the result. Listed in `RAW_ARG_FUNCTIONS` (see below) since their arguments are booleans, not numbers. One real ordering consequence in `inlineCalc.js`: a cell named `and`/`or`/`not` must still be rejected as "is a keyword" (the existing, pre-call-syntax message), not "is a built-in function" — `scanInlineCalcs()` checks `RESERVED_KEYWORD_NAMES` before `isReservedFunctionName()` for exactly this reason, so the more fundamental, longer-standing reason for the rejection still wins over the newer, incidental one.

**Ranges.** A range is `Y<N>:Y<M>` and is only legal as a function-call argument (`sum(Y1:Y5)`, `min(Y1:Y5, 10)`). Both endpoints must be automatic `Y<N>` labels because only those labels have guaranteed document order; named cells do not. The parser expands a valid range directly from `env` before the function receives its arguments. Missing endpoints use the same `NAME` failure shape as any other unknown variable, so `inlineCalc.js` automatically reclassifies `Y5` as `#REF!` when appropriate. Reversed ranges (`Y5:Y1`) are `#VALUE!`.

**Date/time functions — `today()`, `date(y, m, d)`, `days_between(a, b)`, `add_days(date, n)`.** A date is simply a `YYYY-MM-DD` string — the same `ScalarValue` every other value already is, not a new value type — which is also why `compareOrdering()`'s existing string-ordering branch already compares two dates correctly with zero changes: ISO 8601 lexicographic order matches chronological order by construction. These four reuse `src/core/date.js`'s existing ISO-date machinery (`getTodayIsoLocal`, `addDaysIso`, `normaliseDateInput`, and the new `daysBetweenIso`) rather than reimplementing date math here — a precedented dependency, since `queryExecutor.js`/`queryConditions.js` already depend on the same module for `!view`'s `as of`/date-field handling. Deliberately date-only, not date-*time*: there is no time-of-day or timezone convention anywhere else in Yamlink for a clock-time value to integrate with, so adding one here would be a standalone invention rather than a real integration — a documented v1 scope cut.

Three of the four are NOT forced through the universal numeric-argument coercion every other function gets (`date()` takes 3 numbers but validates them itself for a clearer calendar-specific message; `days_between()`/`add_days()` take date strings as their first argument(s)). `RAW_ARG_FUNCTIONS` is the mechanism: a small, explicit `Set` of function names (`'date'`, `'days_between'`, `'add_days'`) that `parsePrimary()`'s function-call branch checks before deciding whether to run `args.map((arg) => assertNumber(arg, name))` — everything NOT in the set still gets that universal coercion exactly as before (so `sqrt`/`abs`/`sum`/etc. are completely unaffected), while these three validate their own argument types internally via the same `fail()` mechanism every other validation in this evaluator already uses. This was chosen over relaxing the default for every function, since forcing numeric args by default is exactly what gives every *other* function its consistent, zero-effort "requires a number" failure.

`date(year, month, day)` builds a canonical string by delegating to `normaliseDateInput(`${y}-${m}-${d}`)` rather than hand-rolling calendar validation — reuses the same battle-tested leap-year/days-in-month check (`toIsoDate()`'s `Date.UTC` round-trip) every other date-input path in Yamlink already relies on, so `date(2026, 2, 30)` fails the same honest way a user typing that date anywhere else in the app already would. `days_between()`/`add_days()` both run their date argument(s) through `normaliseDateInput()` too, so they accept any shape Yamlink's date parsing already understands (slashes, textual months, etc.), not just canonical `YYYY-MM-DD` — consistent with how a frontmatter `date:` field is treated everywhere else, not a stricter dialect invented just for formulas.

One real, worth-documenting gotcha, not a bug: there is no date-literal token anywhere in this grammar. A bare `2099-01-01` written directly in a formula tokenizes as ordinary subtraction (`2099 - 1 - 1`), not a date — a date must come from `date(y, m, d)`, a quoted string literal, or a referenced frontmatter/calc value. This is a direct, inherent consequence of there being no new value type for dates (the whole reason comparisons work for free) — adding a date-literal syntax would require the tokenizer to disambiguate a bare `YYYY-MM-DD` numeric-looking token from ordinary subtraction, which is out of scope for this pass.

**Statistics — `median`, `mode`, `stdev`/`variance` (sample), `stdevp`/`variancep` (population).** All variadic, the exact same shape `sum`/`average`/`min`/`max` already are — no new mechanism, works with a `Y1:Y5`-style range for free since ranges already just expand into the args array before any function sees them. `_sampleVariance(values, name)`/`_populationVariance(values, name)` are small shared helpers (module-level functions, not `FUNCTIONS` entries themselves) backing `stdev`/`variance` and `stdevp`/`variancep` respectively, so the two pairs can never silently drift out of sync with each other. `mode()` returns the first-encountered most-frequent value (a single linear pass tracking the best-so-far, not a sort) — matching Excel's own `MODE`, not an arbitrary tie-break like "smallest value" — and fails honestly, the same way a `NAME`/`VALUE` failure anywhere else does, when nothing actually repeats (there is no mode, not a guessed one). Sample `stdev`/`variance` require at least 2 values (n-1 would otherwise be zero); population `stdevp`/`variancep` accept a single value (population variance of one point is honestly 0).

Two real, deliberately NOT built in this pass, not quietly dropped: `percentile`/`quartile` (Excel's own take a *separate* "which percentile" parameter alongside the data — every other variadic function here is pure data, no secondary parameter, so this needs an argument shape the rest of this evaluator has no precedent for) and `correl`/`covariance` (need two *parallel* series kept distinct — e.g. `correl(Y1:Y3, Y4:Y6)` — but a range expands directly into one flat args array with nothing marking where one series ends and the next begins once expanded, so the two can't be told apart). Both are real architectural gaps specific to this evaluator's flat-range-expansion design, not implementation oversights — doing either honestly would need a genuine array value type this evaluator doesn't have.

**Finance — `fv`, `pv`, `pmt`, `npv`, `irr`.** Deliberately matches Excel's own formulas and sign convention exactly (an outflow and the value it becomes are opposite signs) rather than inventing a friendlier-but-untested convention — reduces real financial-math risk by reusing universally verified identities instead of a one-off reinterpretation. `pv`/`fv`'s trailing optional argument (Excel treats a missing `pv`/`fv` as `0`) needs no new mechanism at all: a formula can simply write fewer arguments than the function has parameters (same as any JS function call), and the function body defaults the missing one internally (`pv = pv === undefined ? 0 : pv`) — the universal numeric-coercion path in `parsePrimary()` only ever validates what was actually supplied, so an omitted trailing argument was already tolerated by every function here, nothing needed changing. Every formula branches explicitly on `rate === 0` (the zero-interest case) rather than letting the general formula's `/rate` divide by zero — the correct zero-rate value (`pv + pmt*nper`, not `Infinity`/`NaN`) is a real mathematical limit, not just a crash-avoidance guard. `npv(rate, cf1, cf2, ...)` discounts its first argument by a full period too, matching Excel's own `NPV` convention exactly (a cash flow happening today is added separately, outside the call — the same well-documented idiom Excel's own help page uses) — a real, intentional asymmetry against `irr()` below, not an inconsistency. `irr(cf0, cf1, ...)` has no closed-form solution in general, so it searches numerically via bounded bisection over -99.9999% to 1000% (generous enough to cover any realistic rate) — `cf0` here **is** period 0, undiscounted, the opposite of `npv()`'s own convention, but exactly Excel's own `IRR`/`NPV` asymmetry, confirmed before implementing rather than assumed. Fails honestly with a clear message — never an unstable or wrong number — when the cash flows never change sign anywhere in that search range, since no real break-even rate exists there.

**Growth — `cagr(beginning, ending, periods)`.** One closed-form identity (`(ending/beginning)^(1/periods) - 1`), requiring a positive beginning value and a positive period count — both checked explicitly and failed with a clear `Math error:`, rather than letting a zero/negative input silently produce `NaN`/`Infinity` and rely on the generic non-finite-result catch further up the call chain.

**Number formatting — `src/engine/inlineCalc.js`, not `mathExpr.js`.** A trailing `` as <format> `` clause on the calc source (`` `=price*qty as currency` ``) is stripped off by `scanInlineCalcs()` before the arithmetic ever reaches the evaluator — `mathExpr.js` has no concept of formatting and never will, the same purity goal that already keeps cross-note syntax and range syntax out of it. The stripped `format` name lands on the block (`InlineCalcBlock.format`), validated against a closed vocabulary (`FORMAT_CLAUSE_RE`/`isValidFormatName()`: `currency`, `percent`, `comma`, or a fixed-decimals pattern like `0.00`) — an unrecognized name is a block-level `#VALUE!`, the same way any other reserved-word misuse is. `"as"` itself is reserved and can't be a cell name, removing any ambiguity between the format clause and a real (if oddly-named) variable reference. Formatting is **display metadata only** — `evalResult.value` is always the real, unformatted number, so a formatted cell still composes correctly in further same-note/cross-note math and query comparisons, exactly like a formatted cell in a real spreadsheet. `formatCalcValue(value, format)`, exported from `inlineCalc.js`, is the one place rendering happens — `decorations.js` (ghost text), `hover.js` (shows the formatted value with the raw number alongside when they differ), and `previewRenderer.js` (Live Note preview) each call it independently, so all three surfaces can never disagree about what a formatted cell looks like. A format clause on a non-numeric (string/boolean) cell is silently ignored at render time, not an error — formatting is cosmetic, not a computation.

**Vault-learned formula suggestions — `src/intelligence/formulaPriors.js`.** The one place calc-formula authoring gets any benefit from the rest of the vault's history, mirroring (at a smaller scale) how `vaultPriors.js` already teaches frontmatter-field completion from real vault usage. `buildFormulaPriors(fieldsCache, idIndex, readBody)` scans every note's body once, collecting every successfully-evaluated, user-*named* calc cell's `{name, expr}` pair (an automatic `Y<N>`-only cell carries no reusable intent and is never counted), tallied by `(type, name, expr)` triple so the same name used with a genuinely different expression across notes is tracked as a separate pattern, not blurred together. Deliberately scoped to literal expression text rather than a more abstract structural shape ("two refs combined with `*`") — frontmatter field names already recur across same-typed notes in practice, so the literal text is already a meaningful, reusable signal, and it keeps the suggestion's explanation completely honest and simple ("used in N other `<type>` notes" is literally, directly true) — the same bar `CLAUDE.md`'s "Elite math & physics for Yamlink" section sets before any intelligence signal ships as a named, user-facing thing. Generation-keyed cache (`getCachedFormulaPriors`), unlike `calcHealth.js`'s deliberately-uncached panel-open scan — this one is a real hot path, consulted on every completion request while typing inside any formula, so a full vault re-scan per keystroke would blow straight through completion's 30ms budget on any vault past trivial size. Consumed by `inlineCalcCompletion.js`'s `buildVaultLearnedFormulaItems()`, scoped to the *current* note's own `type:` (a note with no type gets nothing extra — schema amplifies, never gates) and gated at a minimum count of 2 before a pattern is offered — a single occurrence is just one note's own formula, not yet a real vault-learned pattern. Fires even when the current note has no prior calc cells of its own to reference (unlike same-note reference completion, which needs at least one), since a brand-new, first-ever formula in a note is exactly the moment this benefits the most.

**Frontmatter-valued cells — `inlineCalc.js`'s `buildFrontmatterSeedEnv()`.** A formula can read the note's own frontmatter fields (`` `total=price*quantity` ``), not just other calc cells, via `scanInlineCalcs(text, { frontmatterFields })` — the one new option seeds the scanner's starting `env` instead of the usual empty object, before any block is evaluated. Everything downstream is unchanged: a same-note calc cell that later redefines the same name overwrites `env[name]` exactly the way every other redefinition already does, so it shadows the frontmatter value from that point forward with zero new precedence logic. The seed itself is filtered, not trusted as-is: only `number`/`string`/`boolean` values survive (a list or wikilink relation has no single value a formula could read, so it's simply absent — referencing it fails as an ordinary `#NAME?`, not a crash); only names already shaped like a valid identifier are seeded (a hyphenated field like `unit-price` would otherwise silently mis-tokenize as subtraction the moment it was referenced); and a name colliding with a reserved word or the `Y<N>` label shape is skipped, since an existing note's frontmatter field was never authored as a calc name and silently excluding it is the honest choice. Deliberately same-note only — `crossNoteCalcResolver.js` still reads only a target note's calc cells, not its frontmatter; extending that is a natural follow-on, not required here. Wired into every caller that evaluates a specific note's calc cells (`decorations.js`, `hover.js`, `previewRenderer.js`, and `queryExecutor.js`'s `readInlineCalcVirtualFields`/`readInlineCalcCellMeta`, both of which already have the row's own `fields` in scope during a query sweep) — a purely additive option/parameter everywhere, so every pre-existing caller that omits it behaves exactly as before.

**Live formula diagnostics — `src/diagnostics/diagnostics.js`'s `yamlink.calcFormulaError`.** A failed calc block surfaces proactively in the Problems panel/editor squiggle, not only on hover — `validateDocument()` already runs on `onDidChangeTextDocument` (debounced), so this needed no new live-update plumbing, only a diagnostic rule covering every failure code instead of `REF` alone (the earlier, narrower scope, before "feedback while actively editing a formula" became a confirmed feature in its own right). Range precision depends on how much position survives to the point of failure: `mathExpr.js`'s tokenizer attaches a `start`/`end` offset to every token, and `fail()` threads that through for syntax/name-resolution failures (an unknown variable or function, an unmatched paren, a dangling trailing token, an unterminated string) — the offending token is still directly at hand at the exact point `fail()` is called for these. A type-check failure (`assertNumber`/`assertBoolean`/`addValues`/`compareOrdering`) or division-by-zero has no such position, because by the time one of those runs, sub-expressions have already collapsed down to plain `ScalarValue`s with no memory of where they came from — this parser computes directly as it parses, with no separate AST to carry a position through. A documented, bounded scope cut: those failures fall back to the whole block's range, same as before this feature existed. One more real wrinkle, handled in `inlineCalc.js`: a cross-note reference's `[[note]]^label` → `__xrefN` substitution changes string length, so a reported offset would point at the wrong span once a cross-note reference is present in the expression — `scanInlineCalcs()` strips the offset from the result in that case, falling back to the whole-block range rather than risk a misleading squiggle.

**`evaluateExpression(source, env = {}, options = {})`** never throws — it always returns `{ ok: true, value: ScalarValue }` (`ScalarValue` = `number|string|boolean`) or `{ ok: false, error: string }`, so every caller can render an honest error state instead of a crash or a silently wrong number. `env` is how a bare identifier (a variable reference, `ident` not followed by `(`) resolves — this is the only coupling point between the stateless evaluator and the stateful, per-note reference system built on top of it in `inlineCalc.js`. Every downstream consumer (decorations, hover, the Live Note preview, `!view`'s `cell.*` fields, the View Panel table) already renders a value via plain string interpolation or the existing generic scalar-classification pipeline, so none of them needed a change to support non-numeric cells.

**Resolution trace — `options.collectTrace`, powering hover's step-by-step inspector.** `mathExpr.js` has no separate AST — it's a direct-evaluating recursive-descent parser, computing values as it parses (see this file's own header comment). Rather than building a parallel tree solely to narrate what happened (real rearchitecting risk, and a second representation that could drift from what the real evaluator actually does), `createParser(tokens, env, trace)` takes an optional mutable array and pushes a flat, execution-ordered entry at exactly four points: an identifier resolving against `env` (`{kind:'ref', name, value}`, pushed in `parsePrimary`), a range-argument cell read (`{kind:'ref', ...}`, pushed in `parseRangeArgument` — this is the only way a range's *constituent* cells become visible at all, since `Y1:Y3`'s middle cell, `Y2`, is never a literal token in the source text and `inlineCalc.js`'s own `collectDependencies()` only finds literal identifier tokens), a function call completing (`{kind:'call', name, args, result}`), an `if()` branch resolving (`{kind:'if', condition, branch, result}`), and a comparison (`{kind:'comparison', op, left, right, result}`). Deliberately NOT traced: plain arithmetic (`+ - * / % ^`, unary) and `and`/`or`/`not` composition — a documented v1 scope cut, not an oversight, since the operator and its two operands are already visible side-by-side in the source text; a reference resolving to a value, or several cells folding into one function result, is the part actually worth spelling out. `evaluateSubTokens()` (used by `if()`'s taken-branch sub-parse) threads the *same* trace array through its own `createParser()` call, so a step inside a taken `if()` branch still lands in true execution order in the one combined list — there is deliberately no separate per-branch trace to merge. Trace collection is opt-in (`options.collectTrace`, default off) specifically so `decorations.js`'s hot ghost-text path (re-evaluates on every keystroke, 30ms budget) pays zero cost for data only `hover.js` renders; when requested, the trace is attached to the result (`result.trace`) whether evaluation ultimately succeeds or fails, since a partial trace up to the failure point is still useful context.

### Scanner — `src/engine/inlineCalc.js`

`scanInlineCalcs(text)` is the shared, pure scanning/evaluation pass used by every surface (decorations, hover, completion) — one implementation, so they can never disagree about what a block is or what it evaluates to.

It regex-scans for `` `([A-Za-z_][A-Za-z0-9_]*)?=([^`]+)` `` spans (skipping anything inside a fenced code block), evaluating **top-to-bottom in one running environment**: a name or `Y<N>` label only exists for expressions *after* its own definition — this makes forward references and circular references structurally impossible, rather than something that needs to be detected and rejected after the fact. A failed block's name/label is never added to the environment, so a broken definition can't silently propagate a wrong value to whatever references it.

Each returned block:
```js
{
  start: number, end: number, exprStart: number,   // offsets into the note's raw text
  name: string|null,       // the user-chosen name, if any ("total")
  label: string,           // the automatic cell label ("Y2")
  expr: string,            // the raw expression text
  deps: Array<{ref, value}>, // every other cell this expression reads (not function calls)
  evalResult: {ok: true, value} | {ok: false, code, error, identifier?}
}
```

A name in the `Y<N>` shape (e.g. `` `Y1=5` ``) is rejected at scan time — that label is reserved for automatic numbering, so a user can't accidentally create an ambiguous collision. Lowercase `y1` is unaffected — labels are deliberately uppercase-only so they can never collide with a lowercase name a user picks themselves (common in math/science notes, and variable names are case-sensitive).

**Typed error codes.** A failed `evalResult` carries a `code` — `'DIV0'`, `'NAME'`, or `'VALUE'` — set by `src/engine/mathExpr.js` directly, plus a fourth, `'REF'`, that only `inlineCalc.js` ever assigns. This split is deliberate, not arbitrary: `mathExpr.js`'s own header comment states it "doesn't know anything about notes or naming," so it genuinely can't tell a broken cell reference (`Y5` when there's no fifth cell) from any other unresolved identifier — both surface as `NAME`, with the raw identifier attached in a new `identifier` field so a caller can classify further without re-parsing the human message. `inlineCalc.js`'s `reclassifyAsReferenceError()` is that caller: it upgrades a `NAME` failure to `REF` (and rewords the message to read as a broken reference, e.g. "Y5 does not exist") specifically when the identifier matches the same `CELL_LABEL_RE` (`Y<N>`) check already used for label-collision rejection above — no new heuristic, a reused one. The same `REF` code also covers broken cross-note references. A fifth conventional code, `CYCLE`, is written into `inlineCalc.js`'s exported `ERROR_CODE_LABELS` map for completeness but is never actually assigned: same-note references are top-to-bottom only, and cross-note resolution is deliberately single-hop, so cycles are structurally impossible today.

### Cross-note resolver — `src/engine/crossNoteCalcResolver.js`

I/O-backed resolver for `` [[note-id]]^label `` cross-note calc references. It owns the filesystem/index lookup that `inlineCalc.js` deliberately does not do: find the target note in `getIndex()`, read its body, scan that body once, and return the matching cell's value. It is single-hop by construction — the target note is scanned without a resolver of its own — so a note can read another note's finished cell, but it cannot create an implicit multi-note dependency chain or cycle.

### Surface integrations

**Decorations (`src/features/decorations.js`):** `collectInlineCalcDecorations()` is a thin wrapper mapping the scanner's offsets onto editor `Range`s. The result renders as bold ghost text (`renderOptions.after`) right after the closing backtick — `= 9` on success, `= ?` on failure — never touching the note's actual file content. This is the one place in the whole feature that reads live: the cell label/name/dependency breakdown deliberately does **not** show inline (tried once, removed after direct user feedback that it read as noise) — that detail lives on hover only. It passes the default cross-note resolver, so `` `=[[budget]]^total` `` paints with the real value when the target cell resolves.

**Hover (`src/features/hover.js`):** `_buildInlineCalcHover(document, position)` scans the *whole note* (not just the hovered line, since a reference like `Y1` can only resolve against blocks above it), passing `{ trace: true }` to `scanInlineCalcs()` — the one call site that opts into trace collection, since this is the one surface that renders it. It shows the cell's label, name (if any), a step-by-step "How it resolved" section when `block.trace` has anything in it (built by `_buildCalcTraceLines()`), the expression and result, and a `Uses: total = 3, Y1 = 4.29…` line listing every dependency with the value it held. `_buildCalcTraceLines()` renders the flat trace in order with no grouping logic of its own — a range's constituent `ref` entries naturally precede the `call` entry that folds them, and a taken `if()` branch's own steps naturally precede its `if` entry, simply because that's the order `mathExpr.js` actually produced them in. A trace entry whose name is a synthetic cross-note placeholder (`__xref1`) is displayed using `block.syntheticLabels[name]` instead — the original `[[note]]^label` text the user typed, translated back by `inlineCalc.js`'s `resolveCrossNoteReferences()` at substitution time (display-only; `mathExpr.js` itself never learns about notes or wikilinks, same purity goal as everywhere else in this evaluator). Cross-note references use the same resolver as decorations. On failure, it shows the typed badge (`inlineCalc.js`'s `ERROR_CODE_LABELS` map, e.g. `**#REF!**`) followed by the human message — the editor's own ghost text stays a plain `= ?` regardless of which code it is; the typed reason lives on hover only, by the same design choice that already kept the cell label/dependency breakdown out of the inline decoration.

**Live renumbering on save (`reconcileInlineCalcReferences()` in `decorations.js`):** the one place this feature edits a note's text without the user directly typing it. A module-level `Map<uri, string[]>` (`lastKnownInlineCalcExprs`, capped like `unlinkedRefs.js`'s body cache) remembers each document's last-known ordered list of expression texts. On save, `computeInlineCalcRenumberMap()` diffs the previous list against the current one — matched by exact expression text, in relative order, so identical duplicate expressions pair deterministically — and returns only the cell numbers that actually changed position. If a block moved (e.g. a new calc was inserted earlier in the note), every `Y<N>` token elsewhere in the note that referenced the old number is rewritten to the new one via a single `WorkspaceEdit` (all replacement ranges computed against one document snapshot, so a simultaneous swap like `Y1↔Y2` can never cascade into itself), then the document is saved again. That corrective re-save is trivially idempotent: the second pass diffs against state that already reflects the rewrite, finds nothing moved, and exits without a further edit. The first time this ever happens (tracked in `context.globalState`, survives restarts), a real one-time message explains the mechanism; every occurrence after that is a quiet, self-dismissing status-bar note.

**Reference authoring (`src/features/inlineCalcCompletion.js`):** two ways to build a formula that references a cell without recalling its label from memory. `findEditableCalcContext(document, position)` is the shared core — given a cursor position, it finds the calc block the cursor is inside and every cell defined strictly before it with a successful evaluation (mirroring the evaluator's own no-forward-references rule in what gets *offered*, not just what's *accepted*). Autocomplete registers with no trigger characters and instead force-triggers the suggest widget via the same debounced-signature pattern `completion.js`'s `maybeTriggerFrontmatterSuggest` already uses for frontmatter fields — Markdown doesn't reliably auto-invoke suggestions on plain typing. Inside a formula, `[[` suggests note IDs and `[[note-id]]^` suggests that target note's successful calc cells. The `yamlink.insertCellReference` command opens a `QuickPick` over every same-note cell for browsing/searching instead.

**Live Note preview (`src/features/preview/previewRenderer.js`):** `replaceInlineCalcsWithResults(body)` runs once on the raw body text, *before* `splitSegments()` — deliberately at the raw-text stage rather than per-segment, since calc numbering/references must stay continuous across the whole note even when a `!view` block sits between two calc blocks, and `splitSegments()` never needs to learn calc syntax exists. Each `` `=expr` `` span is replaced with `<span class="yl-calc-result" title="{expr}">{result}</span>` — the preview is a "read this like a finished document" surface, so it shows only the computed value (matching how frontmatter already renders as pills there, not raw YAML), with the original formula available as a hover tooltip via the `title` attribute. A failed expression renders as `?`, same honest-error convention as the editor decoration and hover. Styled in both `liveNoteStyles.js` (dark) and `previewStyles.js` (light) — the two Live Note surfaces have independent stylesheets tuned to their own background, so the color was picked per-surface rather than shared blindly.

**Query engine (`src/engine/queryExecutor.js`):** a note's calc cells are exposed to `!view` as virtual fields under a `cell.<name-or-label>` namespace, parallel to how `file.created`/`file.modified` and `_inbound_count`/`_hub_score` already work — `cell.` was chosen over a `cell:total`-style syntax specifically because every field-name capture regex in `queryConditions.js`/`queryParser.js` uses `[\w.-]+` as its character class (a colon isn't in it and would silently fail to tokenize), while a dot already has real precedent. `isInlineCalcField()` gates a `needsInlineCalc` flag the same opt-in-cost way `needsGraphVirtual` already does, so a query that never references `cell.*` pays nothing extra. Resolving a cell value needs the note's *original-case* body text — the existing `readBody()` LRU cache exists for `body:`/`any:` substring search and deliberately lowercases everything, which would corrupt calc syntax (`Y1` → `y1` mid-expression) — so a sibling cache, `rawBodyCache`/`readRawBody()`, holds the untouched text with the same size/eviction/mtime-check shape. `readInlineCalcVirtualFields(filePath)` runs `scanInlineCalcs()` against that raw body with the cross-note resolver and returns a lowercase-keyed lookup (`cell.<label.toLowerCase()>` and, if named, `cell.<name.toLowerCase()>`) merged into the row/where-field objects at the same two points `readGraphVirtualFields` already uses. **A real, bounded, documented limitation, not a bug:** every query field is lowercased before it reaches execution (true of all fields today, not introduced here), so `cell.Y1` and `cell.total` in a query always resolve case-insensitively — `cell.TOTAL` and `cell.total` match the same cell — while the same-note formula reference (`Y1` vs. `y1`) stays case-sensitive exactly as shipped. A cell that doesn't exist on a note, or failed to evaluate, is simply absent from that row rather than an error.

**`aggregate` clause (`src/engine/queryParser.js`/`queryExecutor.js`) — a general `!view` query-language feature, not calc-specific.** `aggregate <fn>(<field>) as <alias>[, ...]` (`fn` in `sum`/`average`/`min`/`max`/`count`, `avg` accepted as a synonym for `average` and canonicalized on parse) computes a fold over the full where-filtered (and, if present, group-bucketed) row set. It's documented alongside the calc engine here because `cell.<name>` is its most common target, but it works identically over any numeric field — plain frontmatter numbers, `file.created`-style virtuals, or `cell.*`. Parsing adds one term list (`{fn, field, alias}[]`) to the parsed query object; execution is a pure `computeAggregates(terms, rows)` fold in `queryExecutor.js`, reusing the existing `classifyScalarValue` numeric-detection primitive already used by `where`/`sort` comparisons — a value that isn't numeric is silently excluded from that field's fold rather than coerced, and a field with zero numeric values across the whole set resolves to `null`, never a fabricated `0` (the same "honest silence over wrong guesses" convention `cell.<name>` itself already follows). **Aggregates are computed over the full matched/bucketed set independent of `limit`** — a deliberate behavior, not an oversight: `limit` only trims what's *displayed* (mirroring how `group by`'s own `limit` already only trims which groups are shown, never how many rows are counted into a surviving group). Combined with `group by`, each group gets its own `aggregates` object and the result's `columns` array gains one entry per alias — purely additive; with no `aggregate` clause, `columns` stays the exact literal `['<groupField>', 'count']` it always was, verified byte-identical against the pre-existing hardcoded-shape tests. Sorting by an aggregate's alias (`sort total desc`) extends the same `sort count` magic-pseudo-field precedent `group by` already established, with one confirmed, deliberate convention: a `null` aggregate always sorts last, regardless of ascending or descending direction, rather than being treated as the lowest real value.

### Syntax reference

| What you type | What it means |
|---|---|
| `` `=1 + 2` `` | An anonymous calculation — gets an automatic label (`Y1`, `Y2`, ...) but no name |
| `` `total=1 + 2` `` | A named calculation — referenceable as `total` from anywhere later in the same note |
| `` `=total * 3` `` | References an earlier named cell |
| `` `=Y1 + Y2` `` | References earlier cells by their automatic position label |
| `` `=sum(Y1:Y5)` `` | Expands a range of automatic labels inside a function call |
| `` `=[[budget]]^total + 5` `` | References a calculated cell from another note |
| `` `=2(1+1/14)` `` | Implicit multiplication — no `*` required before a parenthesis |
| `` `=sin(pi/2)` `` | Functions and constants compose normally |

### What is not yet implemented

- **Frontmatter cells.** Today, `` `=expr` `` only works in the note body. A computed frontmatter *value* is a structurally different, larger feature — frontmatter is YAML, not prose, and frontmatter fields feed the index (`fieldsCache`), completion, and every query directly; a formula-valued field would need real design work on what gets *stored* (the formula, the last-computed value, or both) and when it recomputes. Not started.

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
- [x] **P3 monolith splits (found during the 0.7.4 pass, not on the original list)** — `src/actions/queryBuilderPanel.js` (1830→298 lines), `src/actions/codeActionsNodeCreationCommands.js` (991→87 lines, handlers split into `nodeCreationHandlers.js`), `src/features/graph/graphClientXGraphScript.js` (996→36 lines, fragments in `xgraphClientBody.js`), `src/features/importExternalVaults.js`/`importObsidian.js` split into `src/importers/{notion,evernote,roam,obsidian,shared}.js`. Structural only — no behavior changes, full suite stayed green throughout each split. **`nodeCreationHandlers.js` (1058 lines) was itself split further (2026-08-15, verified: all 12 handler functions accounted for)** into `nodeCreationCore.js`/`nodeCreationMaintenance.js`/`nodeCreationSchema.js`/`nodeCreationSelection.js`/`nodeCreationTemplates.js`; `src/importers/obsidian.js` split into `obsidianAnalysis.js`/`obsidianFilesystem.js`/`obsidianLinks.js`/`obsidianMigration.js`/`obsidianReports.js` (all 24 functions accounted for); `src/features/health/healthHtml.js` split into `healthHelp.js`/`healthIntelligenceHtml.js`/`healthSchemaHtml.js` (all 7 accounted for); `src/features/home/homePanelHtml.js` split into `homeChartsHtml.js`/`homeIcons.js`/`homeProjectionHtml.js`/`homeSectionsHtml.js` (all 24 accounted for).
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
