# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Session Start

Read **[TODO.md](./TODO.md)** first — it has the current release state, the ordered work list, and the uncommitted file inventory. Then read this file.

## Companion Docs

Read these alongside this file:

- [CODEX.md](./CODEX.md)
- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ROADMAP.md](./ROADMAP.md)
- [SESSION_LOG.md](./SESSION_LOG.md)

For repeat debugging and release workflows, see:

- [docs/runbooks/webview-debugging.md](./docs/runbooks/webview-debugging.md)
- [docs/runbooks/graph-debugging.md](./docs/runbooks/graph-debugging.md)
- [docs/runbooks/extension-host-debugging.md](./docs/runbooks/extension-host-debugging.md)
- [docs/runbooks/release-checklist.md](./docs/runbooks/release-checklist.md)

## What This Is

Yamlink is a VS Code extension that turns Markdown files into a structured knowledge graph. Notes get stable `id:` identities, `[[wikilinks]]` become graph edges, YAML frontmatter becomes structured data, and `!view` blocks become live editable tables.

### Product identity

- **Local-first, plain Markdown** — no database, no sync, no lock-in. Files stay `.md` and work in any editor.
- **The core loop:** write a note with `id:` + `type:` → link with `[[wikilinks]]` → query with `!view` → inspect in Note Report / Graph / Vault Health.
- **Live editable tables** — `!view` blocks render as interactive tables. Edit a cell and it writes back to frontmatter. This is the killer differentiator vs. Obsidian Bases (read-only) and Dataview.
- **Intelligence is vault-first** — no hardcoded field lists, no global archetypes. The vault teaches the system. Schema amplifies, never gates: every feature works on zero-schema vaults.
- **No build step** — extension runs directly from source. Pure CommonJS. `src/engine/`, `src/intelligence/`, `src/core/` have zero VS Code imports and are testable with `node --test`.
- **x-graph** — custom Canvas2D + D3-force graph engine. Replaced entire React Flow + Cytoscape stack in the Shujimi optimization pass. No third-party graph library.
- **CLI** — `yamlink` command gives full headless vault access (build, health, validate, query, report, links, serve, export). The CLI is the foundation for multi-editor support (LSP next).

### Key release history

| Release | Codename | What it introduced |
|---|---|---|
| 0.1.0 | Apollo | `id:` identity model, rename propagation, wikilinks, hover, diagnostics |
| 0.2.0 | Dizzie | `!view` query language, live editable tables, Entity Hub |
| 0.3.0–0.3.5 | Ace / Ace+ | Sidebar panels, Calendar, Vault Health, adaptive intelligence foundation |
| 0.4.0 | Carmen | Intelligence depth, graph rebuild, Note Report five-tab layout |
| 0.5.x | Zim | x-graph, query upgrades (`!=`, empty, `#tag`, `group by`, date functions), lifecycle/drift detection, mutation event log, CI |
| **0.6.0** | **Shujimi** | **CLI, four-phase intelligence overhaul, Home panel, natural language queries, daily notes, Smart Templates, matrix view, schema conformance, arc prediction, outcome calibration, unlinked references** |

### Product philosophy

- **Schema amplifies, never gates.** Every feature must work fully on a vault with zero schema notes.
- **Honest silence over wrong guesses.** When the vault has no evidence, the system stays quiet.
- **Editor-native, not app-shell.** If a feature would feel at home as a standalone desktop app, it belongs in Atomix, not Yamlink.
- **The vault trains the system.** Accepted completions, created notes, and mutation history are all training signals. No cloud, no model calls.
- **`id:` is the source of truth.** Filenames are cosmetic. Graph edges, rename propagation, and all intelligence flow through canonical IDs.

## Project Slash Commands

These are available as `/command` shortcuts in Codex (stored in `.Codex/commands/`):

| Command | What it does |
|---|---|
| `/test` | Run `npm test`, diagnose failures, fix source |
| `/test-all` | Run `npm run test:all`, enforce 1502/1502 baseline |
| `/test-subsystem <name>` | Run tests for a specific subsystem (query, hover, intelligence, etc.) |
| `/check-hot-paths` | Grep hot paths for new disk reads or vault scans (performance regressions) |
| `/pre-release` | Full pre-release checklist: code checks + doc truth + EDH checklist |
| `/contract-check` | Verify the working tree against CODEX.md layer/data/invalidation/confidence contracts |
| `/session-end` | Close out the session: update TODO.md + SESSION_LOG.md, verify tests and lint |

## Commands

### Linting

```bash
npm run lint                    # ESLint: no-undef + no-unused-vars across node/browser/test environments
```

### Running tests

```bash
npm test                        # 1502 tests — full suite
npm run test:all                # same list, explicit alias
npm run test:count              # run suite + assert count >= baseline (1502); use before release
npm run test:count:update       # update the baseline after intentionally adding/removing tests
node --test test/query.test.js  # run a single test file
```

Tests use Node's built-in `node:test` runner — no Jest or Mocha. There is no build step; the extension runs directly from source.

### Testing contract (enforced)

These rules apply to every change — both human and AI authors:

1. **`npm run test:count` must exit 0** before any release. It fails if any test fails OR if total count drops below the recorded baseline (`scripts/test-count-baseline.json`).
2. **New file in `src/intelligence/`, `src/engine/`, or `src/core/`** → add tests to the corresponding pure-module test file (or create one). Update the capability matrix in `TESTING.md`.
3. **New user-facing surface** (hover, completion, graph, health, note report) → add a `test/surface.*.test.js` scenario using `createVault()` from `test/lib/vaultSim.js`.
   **New platform API surface** (CLI commands, HTTP endpoints, LSP handlers) → add contract tests to the corresponding `test/surface.*.test.js` file. API contract tests live in `test/surface.api.test.js` — they spin up a real `http.Server` via `createRouter` from `src/cli/commands/serve.js` and make real HTTP calls. No mocking.
4. **Never call `buildObservedNoteIndex` or `getCachedPriors` in a pure unit test without passing `observedFields` explicitly** — the module-level generation-keyed caches will otherwise use stale state from earlier calls. Use `resetObservedNoteIndexCache()` / `resetVaultPriorsCache()` in `beforeEach` hooks instead.
5. **After adding tests**, run `npm run test:count:update` to lock in the new baseline.

### Vault simulation harness

`test/lib/vaultSim.js` is the shared end-to-end test harness. It creates real temp directories, runs the actual `buildIndex()` pipeline, and exposes the full surface API without any mocking. VS Code API is stubbed once at load time.

```js
const { createVault } = require('./lib/vaultSim');
const vault = createVault({ 'rico.md': '---\nid: rico\ntype: contact\n---\n' });
const model = vault.completionOpportunities('rico');
vault.destroy();
```

`_rebuild()` resets all generation-keyed module caches (`suggestionCore`, `vaultPriors`, `intelligenceCache`) before rebuilding, ensuring clean state between consecutive vaults in the same test process.

### Manual / integration testing

```bash
node test/ace.local.js          # local smoke test harness (not part of CI)
```

To test the extension inside VS Code, press **F5** in VS Code with `.vscode/launch.json` configured (already present). The sample vault in `sample/` is the canonical manual testing surface.

## Architecture

### Extension entry point

`extension.js` is the VS Code extension entry point. It wires all modules together on activation: builds the index, registers providers (completion, hover, diagnostics, code actions, decorations, rename, codelens), opens side panels (entity hub, calendar, graph, health), and sets up the refresh router.

### Core data layer (`src/core/`)

| File | Role |
|---|---|
| `index.js` | Scans all `.md` files, parses frontmatter, builds `idIndex` and `pathIndex`. Entry point for the data model. |
| `graph.js` | In-memory directed labeled edge graph (`outboundEdges`, `inboundEdges`). Rebuilt from `index.js` on every `buildIndex()`. |
| `frontmatter.js` | Frontmatter parsing utilities. |
| `id.js` | Canonical ID extraction and normalization (kebab-case). |
| `ignore.js` | `.yamlinkignore` parser and path-matching engine. `loadIgnoreRules()` reads the file; `isIgnoredPath()` tests any vault path against the loaded rules. Three rule types: `dir` (trailing slash), `path` (contains `/`), `name` (plain basename). |
| `rename.js` | Vault-wide wikilink rename propagation. |
| `workspace.js` | Multi-root workspace folder resolution. |
| `writeField.js` | Writes or updates individual frontmatter fields in `.md` files. |
| `tasks.js` | Extracts Markdown task lines and builds task rows. |
| `date.js` | Date parsing and normalization (canonical: `YYYY-MM-DD`). |

### Registries (`src/registries/`)

- **`typeRegistry.js`** — tracks every `type:` value seen across the vault.
- **`schemaRegistry.js`** — indexes schema nodes (`type: schema`) that define field shapes for a target type. One schema per target type is canonical; duplicates are diagnostics.

### Query engine (`src/engine/`)

- **`query.js`** — pure query engine (no VS Code, no file writes). Parses and executes `!view` blocks. Supports `select`, `where =`, `where contains`, `sort`, `limit`, `via`, shortcut queries (`today`, `upcoming`, `calendar`), and incoming-relation queries.
- **`suggestions.js`** — query and view suggestion generation.

### Intelligence layer (`src/intelligence/`)

The intelligence layer is the vault-aware inference system introduced in Ace+. All modules are pure (no VS Code imports).

| File | Role |
|---|---|
| `fieldRolesCore.js` | Core field-role inference: `date`, `status`, `person`, `container`, `topic`. Contains semantic priors and normalization logic. |
| `fieldRoles.js` | Public wrapper around `fieldRolesCore`. |
| `fieldCategory.js` | Multi-signal field classifier. Priority-ordered evidence chain: schema → hard name patterns → vault priors → observed wikilink ratio → descriptive name patterns → same-note context → body corroboration → note-role proxy fallback. Returns category, confidence, source, reasons, and relation strength (WEAK/LIKELY/CERTAIN). |
| `fieldPlanner.js` | Action planner between classifier and every surface. Maps effective confidence (raw × source weight) to SILENCE/COMPLETION_ONLY/HINT/DOCUMENT/QUICKFIX. Relation strength gates: WEAK cannot reach QUICKFIX or trigger createNote. |
| `vaultPriors.js` | Per-vault statistical maps (`fieldTargetTypes`, `typeFieldBundles`, `fieldAmbiguity`, `noteRoleTypePriors`) with a generation-keyed cache. Rebuilt once per vault mutation. |
| `noteRolesCore.js` | Note-level role inference (person, event, artifact, etc.) from field patterns. |
| `lifecycleState.js` | Classifies notes as `draft`, `growing`, `consolidated`, `hub`, or `stale` from current vault structure. |
| `driftDetector.js` | Compares notes against learned vault bundles; classifies structural health as `on-track`, `minor-drift`, `drifting`, or `outlier`. |
| `suggestionCore.js` | Builds observed-field patterns and adaptive field hints from the live vault. |
| `frontmatterIntelligence.js` | Builds opportunity models and guidance summaries for frontmatter completion. |
| `intelligenceCache.js` | `getVaultPatterns()` — single shared vault scan result per generation. Used by completion, hover, and Note Report. |
| `bodySignals.js` | Extracts structural signals from note body: headings, callouts, embeds, hashtags, footnotes. Feeds note-role inference. |
| `tagSignals.js` | Tag extraction from body `#hashtag` notation and frontmatter `tags:` field. |
| `confidence.js` | Filters suggestions by confidence threshold for a given surface. |
| `queryDiagnostics.js` | Fuzzy field matching and query warnings for typos in `!view` clause fields. |
| `implicitWeights.js` | Builds per-field relation weights from mutation log history. Fields used as relations in the past stay known as relational even after vault restructuring. |
| `outcomeCalibration.js` | Builds per-field acceptance counts from `completion_accepted` events. Feeds a confidence boost (step 4.7) into the field classifier. |
| `noteArc.js` | `buildNoteArc()` — compares note's current fields against vault type bundle, returning ranked missing fields. Surfaces in Note Report "Likely missing" and field key completion. |
| `nlQuery.js` | `parseNaturalQuery()` — maps plain English to `!view` syntax via 16 sentence templates + full vault vocabulary injection. No hardcoded domain knowledge. |
| `gitHistoryImport.js` | Backfills mutation event log from git commit history. One-time command, guarded by `.yamlink/git-history-import.done`. |

### Features (`src/features/`)

VS Code provider registrations and webview panels:

| File | Role |
|---|---|
| `completion.js` | Frontmatter relation completion and query clause completion. Uses the intelligence layer for ranked target suggestions. |
| `hover.js` | Hover cards for wikilinks and `!view` block previews. |
| `viewLightbulb.js` | Code action lightbulb for `!view` blocks. |
| `viewCodeLens.js` | CodeLens above `!view` blocks. |
| `viewPanel.js` | Live table webview panel (the main interactive table surface). |
| `entityHub.js` | Note Report sidebar webview — shows relations, tasks, timeline, suggested views. |
| `entityHubModel.js` | Data model builder for the Note Report. |
| `entity/unlinkedRefs.js` | Detects body-text mentions of a note's id/name without a formal wikilink. Generation-cached. |
| `graphPanel.js` | Graph webview panel (full workspace). |
| `calendarPanel.js` | Calendar webview (sidebar and full panel). |
| `healthPanel.js` | Vault Health webview panel. |
| `homePanel.js` | Home panel — activity stream, vault pulse, continue-working, nudge cards. |
| `home/` | Home panel HTML builder, CSS, browser-side script. |
| `graph/` | x-graph full workspace panel (Canvas2D). |
| `graph2/` | x-graph sidebar panel (same Canvas2D renderer). |
| `decorations.js` | Editor decorations for wikilinks and broken links. |
| `definition.js` | Go-to-definition for wikilinks. |

### Runtime (`src/runtime/`)

| File | Role |
|---|---|
| `refreshRouter.js` | Central refresh coordinator. `refreshForIndexMutation()` fans out dirty signals to all surfaces. All panels listen to this instead of directly watching the index. |
| `activeViewRuntime.js` | Manages running/re-running `!view` blocks for the active document. |
| `statusRuntime.js` | Status bar item management. |
| `performanceTracker.js` | Timing instrumentation with per-surface budget enforcement. Breaches logged to the Yamlink Performance output channel. Budgets: completion 30ms, hover 5ms, view query 50ms, graph payload 300ms. |
| `mutationEventLog.js` | Persistent NDJSON append log (`.yamlink/mutation-log.ndjson`) for structured mutation events: `note_created`, `type_set`, `field_added`, `field_changed`, `field_removed`, `relation_changed`. 10k cap, 3s dedup window, filter API. Survives restarts. |

### Actions (`src/actions/`)

- **`codeActions.js`** — VS Code code action provider (lightbulb fixes).
- **`viewBuilder.js`** — Query builder UI action.

### Diagnostics (`src/diagnostics/`)

- **`diagnostics.js`** — Broken link detection, duplicate ID detection, schema violation surfacing. Uses VS Code `DiagnosticCollection`.

## Platform direction

Yamlink is a **local knowledge graph engine with multiple clients**. The VS Code extension is the richest client; the engine is the product. This shapes every architectural decision.

| Release | Focus |
|---|---|
| **0.7.0 — Shujimi+** | Engine (monolith splits, friction audit, lifecycle schemas, CLI depth) + Platform (writable API, LSP server, TUI v1) + Authoring (Document tab, wikilink concealment, document assembly) + QOL |
| **0.8.0** | TUI v2, publishing pipeline, email enrichment adapter, schema library (not CRM-first — serves writers, researchers, developers, journalers equally) |

The Platform track items (writable API + LSP + TUI v1) are treated as a unit — all three together tell the complete "Yamlink without VS Code" story. They are non-negotiable in 0.7.0. See [ROADMAP.md](./ROADMAP.md) for full detail.

## Key Conventions

- **No build step.** The extension runs directly from source. `extension.js` is the entry point.
- **Pure modules.** Everything under `src/engine/` and `src/intelligence/` has no VS Code imports and is directly testable with `node --test`.
- **Platform purity.** `src/core/`, `src/engine/`, and `src/intelligence/` must never acquire VS Code imports. These are the portable engine layer. Any feature that would require a VS Code import belongs in `src/features/`, `src/runtime/`, or `extension.js`.
- **Index is ground truth.** All queries, completions, hover, diagnostics, and panels read from `idIndex`/`pathIndex`/`fieldsCache` in `src/core/index.js`. Nothing reads `.md` files at runtime except the query engine's body cache and the PDF exporter.
- **Graph is rebuilt, never persisted.** `src/core/graph.js` is cleared and rebuilt on every `buildIndex()`.
- **`_templates/` is excluded from indexing.** Files inside `_templates/` are skipped during vault scan.
- **`.yamlinkignore` excludes user-defined paths.** A `.yamlinkignore` file at the workspace root excludes files and folders from the index, graph, rename scan, and all intelligence paths. Supports `dir/`, `path/to/file.md`, and bare `filename.md` rules. Watched at runtime — changes trigger an immediate full rebuild.
- **Canonical IDs are kebab-case.** IDs should be lowercase, letters/numbers/hyphens. The `id.js` module normalizes accented input.
- **Dates are `YYYY-MM-DD`.** All date storage and query comparisons use ISO-style canonical dates.
- **API platform fields use single underscore prefix.** Fields added by the API layer (not from user frontmatter) use `_` prefix: `_filePath`, `_outbound`, `_inbound`. Double-underscore `__` is reserved for internal index fields that are always stripped from API responses. Single-underscore platform fields are intentionally exposed.
- **Lint is a gate.** `npm run lint` must pass clean before any commit. Rules: `no-undef` and `no-unused-vars` (catch vars and `_`-prefixed variables exempted). Config: `eslint.config.js` (flat config, three environment groups: node/browser/test).
