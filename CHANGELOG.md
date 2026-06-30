# Changelog

---

## [0.7.0] — "Sugar" *(in progress)*

### Conduit

- **Split view** — press `|` to split Conduit into two independent panes. `Tab` cycles focus (lit border = active); `q` closes the secondary pane. Both panes share one SSE connection and live vault state — no double polling. Status bar shows `◉ left | ○ right` when split is active.
- **9 screens** — Briefing [1], Query [2], Navigator [3], Explorer [4], Health [5], Search [6], Graph [7], Diff [8], Radar [9]. Number keys switch screens in the focused pane.
- **Single-command startup** — `yamlink` (no arguments) auto-starts the API server and opens Conduit. No separate `yamlink serve` needed.
- **Session context on Briefing** — every open shows a compact delta from your last session: "3 notes created, 2 missions updated, 1 broken link appeared."
- **Explorer write operations** — field editing (`e`), note creation (`n`), deletion (`D`), wikilink building (`l`), multi-select bulk ops (Space bar → Enter → bulk menu: set field, set status, delete all).
- **NoteView** — `v` from Explorer or Navigator opens a full Markdown reading view rendered in the terminal. Headings, wikilinks, tasks, and code fences are all ANSI-styled. `j`/`k` scrolls, `]`/`[` jumps headings, `o` opens in `$EDITOR`.
- **Intelligence inline in Explorer** — lifecycle state, drift label, and top arc-predicted missing field appear directly in the note detail pane without pressing `p`.
- **Body editing via `$EDITOR`** — `o` from Explorer opens the note body in your configured editor. The help overlay and the note detail panel footer both show this clearly.
- **Quick Capture** — `c` from any screen opens a 3-step form (id → type → arc-suggested fields) without leaving the terminal.
- **Peek overlay** — `p` shows full note detail without leaving the current screen.
- **Note history** — `H` in Explorer shows the mutation timeline for the selected note.
- **Graph traversal** — `]` follows the strongest outbound link, `[` follows the strongest inbound. `Esc` pops the stack.
- **Warp navigation** — type any character from a non-text screen to trigger live ranked search across notes, types, and commands.
- **Spatial bookmarks** — `m0`–`m9` sets, `'0`–`'9` jumps. Persisted across sessions.
- **Saved contexts** — `S`/`R` saves and restores Explorer state.

### Intelligence

- **Behavioral priors → live inference** — the mutation log now feeds relation completion and field classification in real time. Recent relation edits bias candidate ranking toward current modeling behavior; fields first used as relations stay known as relational even after vault restructuring.
- **Cluster emergence detection** — Vault Health shows an "Emerging Patterns" section when groups of notes share identical field signatures. Confidence levels: low (4–6 notes), medium (7–12), high (13+). Each cluster has a "Create schema from cluster →" button.
- **`yamlink.proposeSchema`** — "Yamlink: Propose Schema from Cluster" in the Command Palette. Detects medium/high-confidence clusters and presents them in a QuickPick; creates a schema note on selection. Falls back to a manual type-name prompt if no clusters exist.
- **Intelligence hardening** — note-role priors are now vault-derived (start empty, accumulate from structure). All static archetype tables removed from active inference paths. On a zero-evidence vault: honest silence.
- **Outcome calibration** — every accepted relation completion writes a `completion_accepted` event. The classifier learns from this history and applies a confidence boost to calibrated fields on subsequent interactions.
- **Note arc prediction** — "what does this note need next?" Compares the note's current fields against same-type vault notes and surfaces likely-missing fields in Note Report Overview and field-key completion.
- **Planner threshold fix** — field classifications with `source: 'behavior'` now correctly reach HINT, COMPLETION_ONLY, and QUICKFIX plan actions.

### VS Code-side

- **Live Note mode** — `Yamlink: Open Live Note` opens a compact rendered sidecar that stays synced with the active Markdown note while you write in source. Frontmatter, headings, and `!view` blocks are clickable back to their source line.
- **Visual Query Builder** — `Yamlink: Query Builder` opens a builder surface with type, column, filter, sort, limit, and layout controls. Shows the generated `!view` text and a live preview before writing.
- **Vault Projections** — Vault Health and Home now include a 90-day structural forecast: Growth, Stale Pressure, and Structure Direction lanes with type-family breakdowns and a 4-week trend memory. Scenario layer: current pace, improved cleanup, current growth.
- **Note Outline panel** — per-heading metadata (anchor link count, task count, body mention count, word count), current-section tracking, click-to-navigate, sibling section jump (`Ctrl+Alt+↑/↓`), search and filter.
- **Block and section references** — every meaningful body element in a note — headings, tasks, blockquotes/callouts, and footnote definitions — now has a computed stable block ID. Two syntaxes: `note#Heading Text` for sections, `note^block-id` for tasks, quotes, and footnotes. The block ID scheme is prefix-typed: `h-{slug}` for headings (deterministic, survives sibling reordering), `t{n}-{hash6}` for tasks (content-hash stable across minor edits), `q{n}-{hash6}` for blockquotes, `fn-{id}` for footnotes. Six commands (`yamlink.copyBlockReference`, `yamlink.insertBlockReference`, `yamlink.copySectionReference`, `yamlink.insertSectionReference`, `yamlink.copyScopedReference`, `yamlink.insertScopedReference`) give cursor-aware single-keystroke access — if the cursor is on a block, no picker is needed. Go-to-definition lands on the exact source line. Hover shows the block's content in the preview card. `note^` completion surfaces the full block index for a note with type labels and line numbers. Note Report outbound links resolve block references to their target label. The block index is rebuilt on every `buildIndex()` cycle alongside the graph and field cache. Block reference creations write `block_reference_created` events to the mutation log. The LSP server honors block reference navigation (`goto definition`, `find references`) via `findBlockLine()`, so Zed and Neovim users get the same exact-line precision.
- **Chart views** — any `!view` result can be visualised as a bar chart (with group-by field picker) or scatter plot (auto-selects first two numeric/date fields as axes).
- **Home panel** — vault pulse, activity feed (last 15 mutations), continue-working notes, nudge cards (broken links, untyped notes), and task groups (Overdue / Today / Upcoming / Open).
- **Task notifications** — VS Code popups for overdue and due-today tasks, deduped by vault state. Per-vault settings for type, frequency, and item count.
- **Smart Templates follow-up** — after a schema insertion, empty relation fields with vault evidence and empty scalar fields with vault vocabularies now reopen completion automatically.
- **Frontmatter suggestion dismissal** — "Ignore this suggestion here" quick fix permanently silences a specific Yamlink diagnostic for a note.
- **View suggestion suppression** — "Don't suggest views for this note" code action writes a per-note suppression to `.yamlink/suppress.json`. Survives restarts.
- **Natural language queries** — "Yamlink: Query in Plain English" maps plain-English descriptions to `!view` syntax using 16 sentence templates and full vault vocabulary injection.
- **Vault Health trend arrows** — Broken Links and Orphan Nodes stat cells now show ↑/↓ trend arrows comparing today's count to up to 7 days ago.
- **Note history from body edits** — content-only saves now produce a `note_touched` event, so the History tab no longer appears frozen when you edit note body text without changing frontmatter.
- **Click-to-add from arc section** — each "Likely missing" field row in Note Report Overview has a `+` button. Clicking it inserts a field stub and triggers completion immediately.

### CLI

`yamlink` now has 24 commands covering the full headless vault loop.

- **`yamlink set <id> <field> <value>`** — write a frontmatter field directly. `--clear` removes it, `--dry-run` previews. Emits mutation events attributed `source: 'cli'`.
- **`yamlink link <id> <field> <target-id>`** — set a relation field to `[[target-id]]`. Validates the target exists. `--append` for multi-value fields.
- **`yamlink on <event> -- <script>`** — automation hooks. Fires a shell script for each matching mutation event. Env vars: `YAMLINK_EVENT`, `YAMLINK_NOTE_ID`, `YAMLINK_TYPE`, `YAMLINK_FIELD`, `YAMLINK_VALUE`.
- **`yamlink completions bash|zsh`** — shell completion script for all commands and flags.
- **`yamlink briefing`** — morning summary: vault pulse, overdue/today tasks, recent mutations, arc predictions, drift flag.
- **`yamlink diff <id-a> <id-b>`** — compare two notes' frontmatter field sets: `+` added, `-` missing, `~` changed.
- **`yamlink mutations`** — query the mutation log with `--limit`, `--since`, `--type` filters.
- **`yamlink init [path]`** — scaffold a fresh vault with `.yamlink/`, `_templates/`, and `welcome.md`.
- **`yamlink rename <old> <new>`** — vault-wide ID rename including all `[[wikilink]]` references. `--dry-run` previews.
- **`yamlink doctor`** — vault environment diagnostic: `.yamlink/` presence, `.yamlinkignore` errors, schema conflicts, duplicate IDs.
- **`yamlink graph`** — output the vault graph as `{ nodes, edges }` JSON for external tools.
- **`yamlink schema list`** — list all schema notes with type, required fields, and note count.
- **`yamlink schema check <type>`** — conformance check reporting notes missing required fields.
- All commands: `--json` outputs clean JSON only, exit codes 0/1/2, `--dry-run` on mutating commands, `--quiet`, `--vault <path>`.

### API

`yamlink serve` is now a full writable local REST API (21 endpoints).

- **Write endpoints** — `POST /api/nodes` (create), `PATCH /api/nodes/:id` (update fields), `DELETE /api/nodes/:id` (remove). Bulk variants: `POST /api/nodes/bulk`, `PATCH /api/nodes/bulk`.
- **`GET /api/events`** — Server-Sent Events stream. Pushes individual mutation events (`field_changed`, `relation_changed`, `note_created`, etc.) before the coarse `rebuild` signal, enabling fine-grained reactive clients.
- **`GET /api/diff`** — field-level structural diff between two notes or since a timestamp.
- **`GET /api/intelligence/note`** — full note-intelligence snapshot: role, lifecycle, drift, arc, classifier context.
- **`GET /api/mutations`** — queryable mutation log with type, note, field, and time-range filters.
- **`GET /api/tasks`** — all vault tasks extracted from note bodies. Filters: done, overdue, today, note, limit.
- **`X-Yamlink-Api-Version: 1`** on all responses. Stable contract: v1 endpoints do not break without a version bump.

### Imports

- **`yamlink.importVaultExport`** — external import command for Roam Research, Notion, and Evernote. Each source has a purpose-built importer: ID stamping, wikilink rewriting, relation normalization, and attachment handling. Pre-import inspection summary and post-import cleanup lane for all three.
- **Obsidian import strengthened** — import report now counts preserved non-Markdown files. Post-import cleanup covers filename-to-`id:` preview, safe missing-`id:` assignment, and canonical wikilink rewrite.

### LSP

`yamlink serve --lsp` is a complete LSP server (25 handlers). Stable and frozen — no new work.

Capabilities: completion, hover, go-to-definition, diagnostics, rename, references, documentSymbols, workspaceSymbol, inlay hints, semantic tokens, pull diagnostics, codeAction, formatting, documentLink, documentHighlight. `workspace/executeCommand` exposes five intelligence commands to any LSP client.

### x-graph

- **Physics overhaul** — Fibonacci spiral seed, inter-cluster topology mini-force, weight-aware center pull, convergence detection. Eliminates the "ring of clusters" layout and perpetual micro-jitter.
- **Cluster hull rendering** — translucent convex-hull overlays (Graham scan + bezier smoothing) behind each cluster. Focus-aware dimming when hovering or selecting a node.
- **Label fade transitions** — labels fade in over a 0.05-zoom ramp instead of snapping.
- **Dot mode and edge cutoff** — at extreme zoom-out, nodes become color-bucketed rectangles (~10× faster); edge pass skipped entirely below zoom 0.06.
- **Keyboard traversal** — Tab/arrow keys cycle nodes in both the sidebar and workspace graph panels.

### Fixed

- Graph node click: every click was treated as a drag release, so clicking a node never opened the linked note. Fixed by checking pointer displacement — < 4 px is a click.
- Graph type filter chips: vault types were mapped through a fixed kind table before filtering, so most types had no effect. Now passes exact vault type strings.
- Graph alias-based wikilinks: `[[Alias Name]]` links were dropping valid edges because alias resolution happened after graph indexing. Aliases are now collected before edges are registered.
- Related-note creation: the reverse relation could be missed when the new note was generated through the template path. Now backfilled before the index sync.
- Live Note panel: was reading too blue and too tall. Now inherits VS Code surface/background variables with Yamlink color only in accents.

---

## [0.6.2] — Hotfix

Fixed runtime dependencies (`js-yaml`, `markdown-it`, `pdfkit`) being stripped from the VSIX by a blanket `node_modules/**` ignore rule. The extension failed to activate with `Cannot find module 'js-yaml'`.

---

## [0.6.0] — "Shujimi"

Shujimi shipped the CLI, a four-phase intelligence overhaul, the Home panel, Conduit v1, and a set of high-value authoring features.

### Added

- **CLI** — `yamlink` command for headless vault access: `health`, `report`, `query`, `links`, `build`, `serve`, `export`, `validate`. `--json` on every command. `--vault <path>` override. Installable via `npm link`.
- **Four-phase intelligence overhaul** — vault-first classification: link topology wins over field names; vault maturity scales confidence bars; implicit interaction history from the mutation log; structural type-role inference from field bundle topology; global archetype tables removed.
- **Outcome calibration** — accepted relation completions write `completion_accepted` events; the classifier applies a confidence boost to calibrated fields on subsequent interactions.
- **Note arc prediction** — "Likely missing" section in Note Report Overview. Arc-predicted fields appear in field-key completion with frequency badges.
- **Unlinked references** — Note Report Links tab shows body-text mentions without a formal wikilink. Generation-cached.
- **Home panel** — activity stream, vault pulse, continue-working notes, nudge cards. Auto-opens once on first vault activation.
- **Daily Notes** — `Ctrl+Alt+J` opens or creates today's journal note. Uses `_templates/journal.md` if present.
- **Natural language queries** — `yamlink.naturalQuery` maps plain-English descriptions to `!view` syntax using 16 templates and vault vocabulary injection.
- **Smart Templates** — `_templates/*.md` files act as live schema definitions. Saved changes prompt: "Template 'X' has new fields — apply to N notes?" Drifted notes get a lightbulb action and Vault Health advisory.
- **Quick Note** — `Ctrl+Alt+N` creates a note by type, scaffolding frontmatter from the matching template, schema, or vault patterns.
- **Auto-stamp `created:`** — all notes created through any Yamlink command receive a `created: YYYY-MM-DD` field automatically.
- **`file.created` and `file.modified` query fields** — virtual fields resolved from the file system; available in `where`, `select`, and `sort` without adding frontmatter.
- **`yamlink.backfillCreatedDates`** — stamps existing notes with file system birthtime (reliability warning shown before writing).
- **Git history import** — `yamlink.importGitHistory` reconstructs full structural evolution from commit history. Runs once; guarded by a `.done` marker.
- **Table virtual rendering** — result sets > 500 rows render only the current page. Smaller sets use the client-side path unchanged.
- **Table density and due-state pass** — tighter spacing throughout; four due-state chips: Overdue (red), Due today (gold), Due soon (amber), Done (teal).
- **Click-to-add from arc section** — `+` button on each "Likely missing" row inserts a field stub and triggers completion.
- **Extract Selection to New Note** — selected body text becomes a new note's body; the selection is replaced with `![[new-id]]`; `source: [[original-id]]` is written into the new note.
- **Anchor go-to-definition** — `note#Heading` links navigate to the exact heading line. Anchor hover shows that section's content instead of the full note card.
- **Tag pill decorations** — `#hashtag` tokens decorated in all workspace Markdown language mode variants.
- **Compact status bar** — `◈ 31  ⚠ 104` format.
- **Template-guided note creation** — "Create note" quick fix presents a QuickPick of templates with a type-matched suggestion at the top.
- **Vault palette** — all panels now use the Apollo palette hardcoded: lavender for identity/links, teal for interactive states, amber for warnings, pink for primary actions.
- **Vault Health: Today's Activity** — notes with mutations today, sorted by event count, clickable.

### Changed

- **Vault Health tab navigation** — six tabs: Activity, Lifecycle, Consistency, Schema, Types, and conditional Templates/Orphans.
- **Home panel visual redesign** — Yamlink logo in header, vault name as a lavender pill, activity feed with clock-time timestamps.
- **Lucide icon family** — all unicode glyphs and emoji icons replaced with inline Lucide SVGs across all panels.
- **Graph blank-on-open eliminated** — camera offset now scales proportionally when dimensions change.
- **Graph jitter eliminated** — simulation pre-warms 80 ticks before the animation loop starts.
- **`relation_added` / `relation_removed` event split** — `relation_changed` is now three distinct events: `relation_added` (mint), `relation_removed` (muted), `relation_changed` (purple). All surfaces updated.

### Fixed

- Callout blocks (`> [!SOURCE]`) now render correctly in note preview and PDF export.
- Note preview font updated to Inter.
- Sample vault now ships in the VSIX.

---

## [0.5.2] — "Zim" Patch

- Restored consistent wikilink resolution across diagnostics and ctrl-click navigation.
- Fixed vault-wide rename propagation skipping files during bulk ID changes.

## [0.5.1] — "Zim" Patch

- Restored clickable markdown wikilinks (Yamlink's `configurationDefaults` was disabling native markdown link behavior).

---

## [0.5.0] — "Zim"

Zim made Yamlink a more complete workspace: a rebuilt graph, a stronger query language, smarter frontmatter intelligence, and release discipline.

### Added

- **Graph 2.0** — sidebar graph for ambient vault awareness; Graph Workspace for focused exploration.
- **Query language** — `!=`, `is empty`, `exists`, `is not empty`, cross-field `or`, `#tag` shorthand, date functions (`today()`, `tomorrow()`, `days-ago(n)`, `days-from-now(n)`).
- **Date shortcuts** — `@today`, `@tomorrow`, `@yesterday`, `@thisweek`, `@nextweek`, `@startofmonth`, `@endofmonth`.
- **Relation completion** — human-readable labels, type-filtered candidates, faster `New [type]` creation.
- **Lifecycle and drift signals** — draft/growing/consolidated/hub/stale states and structural drift scores in Vault Health and Note Report.
- **Note Report History tab** — persisted mutation event log. Survives restarts.
- **Body-aware signals** — tags, callouts, embeds, footnotes, repeated body links as supporting evidence.
- **Aliases** — `aliases:` in frontmatter; resolves in hover, navigation, completion, decorations.
- **Schema-first note creation** — `yamlink.newNoteFromSchema`; schema fallback in standard creation.
- **Public extension API** — `getIndex`, `getFieldsCache`, `getPathIndex`, `getSchema`, `query`, `onVaultChange`.
- **GitHub Actions CI** — lint + test + `vsce package` on every push/PR.

### Changed

- Note Report is now a five-tab panel: Overview, Links, Tasks, Views, History.
- Tables: cleaner shell, stronger sorting, column value filters.
- Completion and lightbulbs: weaker signals stay quieter, stronger signals surface more clearly.

### Fixed

- Relation completion, alias resolution, body link handling, date shortcuts, templates, `.yamlinkignore` rebuild-on-change.

---

## [0.4.0] — "Carmen"

Carmen hardened the intelligence layer and rebuilt the graph after an unexpected VS Code webview break.

### Added

- Query OR logic and date-range operators.
- Body wikilink → frontmatter suggestion (2+ body mentions without a frontmatter field).
- Note-context-aware query builder starters.
- Template system (`_templates/` based note creation).
- Bottom-bar writing stats (word count, character count).

### Changed

- Graph rebuilt on a boot-once webview architecture. Local mode follows the current note; Vault mode is the broader view.
- Intelligence layer split into clear module boundaries.
- Suggestion explanations are shorter and plainer.

### Fixed

- Date parsing broadened (textual months, `by Friday`, `due next Tue`).
- Same-flow graph/report hints now stay aligned with the visible suggestion.
- Note Report opportunity model uses live note body context.

---

## [0.3.5] — "Ace+"

Addressed intelligence trust issues and polished the authoring experience.

### Added

- Adaptive intelligence foundation: shared field-role inference, first note-role inference layer.
- Schema-backed relation suggestions, mixed-type relation awareness, peer-relation suggestions.
- Task shortcuts: `!view open-tasks`, `!view done-tasks`, `!view overdue`, `!view undated-tasks`.
- Graph and Calendar keyboard shortcuts.

### Changed

- Query refinement returns users directly to the live result.
- Status bar styling tightened.

### Fixed

- Wikilink canonicalization before graph indexing.
- Relation autocomplete no longer hides the vault when a likely target type is inferred.
- Calendar now recognizes `date:` fields.

---

## [0.3.1] — "Ace" Hotfix

Fixed VSIX packaging to include runtime dependencies. Extension now activates correctly in Marketplace builds.

---

## [0.3.0] — "Ace"

Yamlink became a real local-first structured workspace layer inside VS Code.

### Added

- Yamlink sidebar with Note Report, Calendar, and Vault Health.
- Calendar: month, week, and day views with task and note activity.
- Query shorthand presets: `!view calendar`, `!view today`, `!view upcoming`.
- Guided query-builder foundation.
- PDF export for live views and active notes.
- Vault-wide graph with search, filter chips, node inspector.
- Completion improvements: relation suggestions before `[[`, observed-field fallback, archetype-driven frontmatter keys.

### Changed

- Tables: safer YAML serialization, no auto-open on `!view`, typed cell editing (text, relation, boolean, dropdown, number, date).
- Note Report and Calendar moved to Yamlink's dedicated sidebar.
- Vault Health received a major visual reset.

### Fixed

- Stale table refresh after edits.
- Rename propagation for `[[id]]`, `[[id|Label]]`, `![[id]]`.
- Malformed schema nodes now surface a diagnostic.

---

## [0.2.0] — "Dizzie"

Yamlink became queryable, not just navigable.

### Added

- `!view` blocks: live interactive tables, multiple tabs, inline cell editing, filter chips, column sorting.
- Query language: `select`, `where =`, `where contains`, `sort`, `limit`, `| label`, multi-line blocks, `!view *`.
- Entity Hub: full backlink view grouped by relation field.
- Vault Health: health score, graph statistics, orphan detection, type distribution.
- Schema nodes, required field validation, relation target enforcement, duplicate schema detection.

---

## [0.1.0] — "Apollo"

The identity release.

- Canonical `id:` identity model.
- Rename propagation.
- Backlinks, hover previews, definition navigation, wikilink autocomplete.
- Broken-link diagnostics, duplicate ID detection.
- Quick fixes for missing frontmatter and broken links.
- Status bar vault summary.
