# Changelog
## [0.6.2] - Hotfix

### Fixed

- Runtime dependencies (`js-yaml`, `markdown-it`, `pdfkit` and their transitive packages) were excluded from the published VSIX due to a blanket `node_modules/**` ignore rule. The extension failed to activate with `Cannot find module 'js-yaml'`. Fixed by explicitly re-including the 26 runtime packages in `.vscodeignore`.

## [0.6.0] - "Shujimi"

### Added

- **CLI: `yamlink` command** — a standalone terminal tool that queries and inspects your vault without VS Code. Install globally with `npm link` from the project folder.
  - **`yamlink health`** — vault overview: note count, type breakdown, broken links, orphan nodes, and lifecycle distribution
  - **`yamlink report <id>`** — full note report: type, lifecycle state, structural drift, and all outbound/inbound links grouped by relation field
  - **`yamlink query "<clause>"`** — run a query using the same language as `!view` blocks. Bare clauses like `"where type = contact"` are auto-wrapped; space-separated `select` fields are normalized to comma-separated automatically
  - **`yamlink links <id>`** — outbound links (with ⚠ for broken targets) and inbound links in formatted tables
  - **`--json`** on any command switches to machine-readable JSON — pipe to `jq`, feed into scripts, power export pipelines
  - **`--vault <path>`** on any command overrides the vault directory (default: current working directory)
- **x-graph: layer system** — the x-graph engine (Canvas2D + D3-force, no Cytoscape/Pixi.js dependency) gains two independent visual channels that stack on top of the base graph:
  - **Semantic layer** — edges are colored by source node type (person/teal, event/amber, artifact/mint, schema/purple, task/pink, container/blue), with direction arrowheads on directed edges and dashed lines for weak-strength links. Legend expands inline when the layer is active.
  - **Health layer** — colored rings drawn around nodes encode lifecycle state (hub → consolidated → growing → draft → stale) and structural drift (minor-drift → drifting → outlier, takes visual precedence over lifecycle). Legend expands inline when the layer is active.
  - Both layers are additive and independent — either or both can be on simultaneously without interfering.
- **x-graph: node dragging** — click and drag any node to reposition it. During drag the node is pinned via D3-force `fx`/`fy`; connected nodes respond to the new position in real time through the live physics simulation. Releasing a node unpins it and lets it settle naturally. Works with both `InlineLayout` (main thread) and `LayoutWorker` (web worker).
- **x-graph: rich node info card** — hovering or clicking a node shows a bottom-center card with the node label, section/type tag, lifecycle state badge (color-coded), and link count.
- **x-graph: renderer performance optimizations**:
  - **Edge batching** — edges are bucketed by style (color, line width, dash pattern) and drawn with a single `stroke()` call per bucket. Base mode uses 2 stroke calls regardless of edge count; semantic mode uses ~6–12 buckets instead of one call per edge.
  - **Frustum culling** — nodes and edges outside the viewport are skipped entirely in the draw loop and label pass.
  - **Label LOD** — label density adjusts with zoom level: all labels visible when zoomed in close, only hub/selected nodes labeled at medium zoom, only selected at low zoom.
- **History tab: structural arc** — a vertical milestone spine at the top of the History tab traces each note's lifecycle: `◆ Note created` → `◈ Type established` (with type name) → `⬡ First link` (with linked ID) → `● Last activity`. Each phase shows a relative timestamp ("3w ago", "yesterday") anchored to the actual mutation event.
- **History tab: before/after diffs** — `field_changed` and `relation_changed` events now show the old value with strikethrough next to the new value. Wikilink values are unwrapped to bare IDs. Plain values are truncated cleanly at 32 characters.
- **Vault Health: Today's Activity** — the first section in Vault Health lists notes with mutations today, sorted by event count, with click-through to the Note Report. Shows up to 12 notes.
- **Lifecycle stale detection uses mutation timestamps** — `inferLifecycleState` now considers the most recent mutation event timestamp alongside file mtime. Notes last edited in Yamlink are not incorrectly classified as stale after a git checkout or rsync that resets mtime.
- **One-time history backfill** — on first activation, existing notes with no event log history receive a synthetic `note_created` event anchored to file mtime, so the History arc and event log are not empty for notes predating the extension install. Guarded by a `.yamlink/history-backfill.done` marker.
- **Smart Templates** — `_templates/*.md` files now act as live schema definitions for their `type:`. Changes to a template are detected and propagated:
  - When a template is saved with new fields, Yamlink scans the entire vault for notes of that type and shows: `"Template 'X' has new fields. Apply to N notes?"`. Clicking **Apply** inserts the missing fields into every affected note — open tabs via VS Code's workspace edit, closed files directly on disk.
  - Notes drifted from their template show a yellow warning squiggle on the `type:` line with a lightbulb action: `Yamlink: Add missing "character" fields (faction, homeworld)`.
  - Vault Health shows a **Template Drift** section listing all drifted notes by type with the missing fields.
- **Quick Note (`yamlink.newNote`)** — QOL command for fast note creation. Pick a type (templates shown first with their field list), enter a title, and Yamlink derives the ID and scaffolds the frontmatter automatically: from the matching `_templates/` file if one exists, from a schema node if present, or from observed field patterns in the vault.
  - **Keybinding** — `Ctrl+Alt+N` (Windows / Linux) and `Cmd+Alt+N` (macOS) now trigger `yamlink.newNote` directly from any context.
  - **L3 contextual linking** — when triggered from inside an existing Yamlink note, a new prompt asks if you want to link the new note back to the current one. Confirm and enter the relation field name; Yamlink writes the reverse wikilink into the new note's frontmatter automatically.
- **Auto-stamp `created:` date** — all notes created through any Yamlink command (`yamlink.newNote`, `yamlink.createNote`, `yamlink.newNodeFromTemplate`, `yamlink.newNoteFromSchema`, `yamlink.addFrontmatter`) receive a `created: YYYY-MM-DD` field automatically on creation.
- **Add Missing Creation Dates (`yamlink.backfillCreatedDates`)** — scans the vault for notes without a `created:` field and writes the file system birthtime (falling back to last-modified time) to each. Shows a modal warning about birthtime reliability before writing — file system timestamps may not be accurate after git clones, drive migrations, or rsyncs.
- **`file.created` and `file.modified` query fields** — implicit virtual fields available in any `!view` query. Resolved from the file system at query time; no frontmatter field required.
  - `where file.created >= 2026-01-01` — filter notes whose file was created on or after a date
  - `where file.modified < 2026-05-01` — filter notes not recently modified
  - `select file.created, file.modified` — include file dates as table columns
  - `sort file.modified desc` — sort by recency
- **Daily Notes (`yamlink.openDailyNote`)** — opens or creates today's journal note (`journal-YYYY-MM-DD.md`) with a single command or keybinding (`Ctrl+Alt+J` / `Cmd+Alt+J`). Uses `_templates/journal.md` if it exists; otherwise creates a minimal stub with `id`, `type: journal`, and `date` pre-filled. Cursor is placed after frontmatter for immediate writing. Journal notes are first-class notes: queryable, linkable, graphable. Links you add to a journal note appear as incoming relations on the linked note, creating a per-note activity timeline automatically.
- **Unlinked References** — the Note Report Links tab now shows an "Unlinked mentions" section: other notes in your vault that mention this note's name or id in their body text without a formal `[[wikilink]]`. Detection uses word-boundary matching (case-insensitive) and strips wikilink content before scanning, so `[[rico]]` is not counted as a plain mention of `rico`. Results sorted by occurrence count, generation-cached so repeated panel opens are free. This is the Roam Research discovery pattern: organic mentions surface before the user formalises the link.
- **Intelligence overhaul (four phases)** — the intelligence layer is now fundamentally vault-first. No static field-name lists. No hardcoded type-name lookups. No global archetype tables. The vault teaches the system.
  - **Phase 1: Cold-start and vault maturity** — field classification now starts with the link topology, not the field name. A field containing `[[some-typed-note]]` is classified RELATION immediately (one typed link, no vault history required). Vault maturity (0–1) scales all planner confidence bars — a 3-note vault gets lower bars, a 200-note vault gets full bars.
  - **Phase 2: Implicit interaction history** — the mutation log records every wikilink assignment. Fields used as relations in the past stay known as relational even after vault restructuring. The system's knowledge is sticky.
  - **Phase 3: Vault-first classification** — `RE_DATE` and `RE_WORKFLOW` name patterns moved from Step 2 (conclusive) to Step 5 (soft fallback). Only `id` and `type` remain as hard patterns — they are Yamlink's own structural fields. Everything else: vault evidence wins. `status: [[rico]]` → RELATION. `disposition` with values `active/standby/complete` → WORKFLOW (detected from your own vocabulary, not a global list).
  - **Phase 3: Structural type-role inference** — note roles (person, container, event, task…) are now inferred from field bundle topology, not from hardcoded type-name lists. `fighter` with 3 relation fields and low inbound → person. `squadron` receiving links from 8 fighters → container. Works for any domain vocabulary.
  - **Phase 4: Global list removal** — `FRONTMATTER_ARCHETYPES`, `NOTE_ROLE_FIELD_PRIORS`, `DEFAULT_STATUS_LIKE_VALUES`, `DEFAULT_SEMANTIC_ROLE_PRIORS` removed from all active surface paths. Field suggestions, role alignment, semantic classification, and status completion now use vault-derived data exclusively. On a zero-evidence vault: honest silence instead of wrong guesses.
- **Intelligence feedback loop (outcome calibration)** — the classifier now learns from user behavior, not just vault structure.

  Every time a relation completion is accepted (Enter/Tab on a `[[` candidate in frontmatter), a `completion_accepted` event is written to the mutation log with the field name, target, and the system's confidence/source at prediction time.

  A new `outcomeCalibration` map is built from these events on every vault generation. A field that has been accepted as a relation suggestion before gets a small confidence boost (step 4.7 in the classification chain) — enough to cross lightbulb and hint thresholds sooner on the next interaction.

  The boost scales with acceptance count (1 acceptance → +0.07, cap at +0.15 after 6+). Day one: no effect. The system learns as the vault is used.

  New source tier `calibration` sits at `0.83` weight in `fieldPlanner.js` — between `usage` (current vault state) and `implicit` (mutation log history).

  Infrastructure also added for `lightbulb_applied` outcome tracking — wiring to specific lightbulb actions comes next.

- **Note arc prediction** — the system now answers "what does this note need next?" — a trajectory question, not just a field classification.

  A new `buildNoteArc` module compares a note's current field set against the canonical field bundle for its type, returning the fields that appear on N%+ of same-type vault notes but are absent from this note. Two evidence sources combine: vault frequency (how often does this field appear on similar notes?) and user feedback (how often has the system's suggestion for this field been accepted?).

  **Note Report — Overview tab:** a new "likely missing" section shows up to 5 ranked missing fields. Each row shows the field name, what percentage of same-type notes have it, a "relation" badge for relational fields, and an accepted-count badge when calibration history exists.

  **Frontmatter field key completion:** arc-predicted fields appear in the field name suggestion list with a "in N% of type notes · likely missing" detail badge, ranked alongside vault-pattern and schema suggestions.

  Both surfaces are advisory only — the user chooses whether to add the suggested fields. Untyped notes are not yet supported (requires type inference integration, deferred).

- **INTELLIGENCE.md — user-facing intelligence reference**

  Complete rewrite of `INTELLIGENCE.md` as a commercial user-facing document. The previous version was a technical reference predating outcome calibration and arc prediction — it no longer described the real system.

  New document covers: all three evidence sources, the complete lightbulb catalog (exact action text for all trigger contexts), relation completion mechanics, field suggestion source table, Note Report arc section explanation, calibration and how the system learns from use, Vault Health panel guide, schema philosophy, and what Yamlink deliberately does not do.

  Internal engineering reference moved to `docs/product/intelligence-technical.md`: full classification chain with confidence values, source weights, planner thresholds, outcomeCalibration/implicitWeights/noteArc specs, surface integration, performance budgets, mutation event log schema, known limitations.

- **Glossary (`GLOSSARY.md`)** — comprehensive vocabulary reference covering every term used across Yamlink's surfaces, commands, query language, intelligence layer, schema system, and CLI. Linked from the GitHub repository for new users onboarding on Shujimi.
- **Git history import (`yamlink.importGitHistory`)** — for git-tracked vaults, reconstructs the full structural evolution of every note from commit history. Walks each `.md` file with `git log --follow`, reads frontmatter at each commit snapshot, and emits `note_created`, `type_set`, `field_added`, `field_changed`, `field_removed`, and `relation_changed` events with real commit timestamps. Runs once; guarded by `.yamlink/git-history-import.done`. The History tab is then populated with accurate per-field history going back to the first commit, not just the extension install date.
- **Table virtual rendering** — panels with more than 500 rows now render only the current page server-side. Search, type filter, column filters, and pagination are applied on the extension host; the webview sends a `requestRerender` message (with full saved state) instead of showing or hiding hundreds of DOM rows. Result sets under the threshold continue to use the existing client-side path unchanged.
- **Table density pass** — row cell padding reduced (8 px → 5 px), tab buttons tightened (10 px → 7 px), toolbar groups narrowed (8 px → 6 px), and task-done cells compacted (10 px → 7 px). The table is noticeably more information-dense without losing legibility.
- **Task table due-state chips** — the task status column now distinguishes four states instead of three. `Due today` (yellow/gold) appears when the task's `date:` matches today. `Due soon` (amber) appears when the date is 1–3 days out. The existing `Overdue` (red) and `Done` (teal) states are unchanged. `Not done` covers everything beyond three days. All five states have distinct visual styling.

- **TypeScript-quality type coverage** — `tsconfig.json` with `checkJs: true` and `strict: true` added to the project. All exported functions across `src/engine/`, `src/intelligence/`, `src/core/`, and key `src/features/` modules are now annotated with JSDoc `@typedef`, `@param`, and `@returns`. Catch-all typedefs added: `MutationEvent`, `UpdateResult`, `RemoveResult` (index), `FrontmatterDoc` (frontmatter), `TaskRow` (tasks), `HealthStats` (health), `WorkspaceFolderLike` (workspace — structural substitute for `vscode.WorkspaceFolder` that lets the CLI test harness pass without needing `index: number`). Achieves zero TypeScript errors with no build step, no `.ts` renames, and no changes to the extension's runtime behavior.

- **Activity stream — Home panel (`yamlink.openHome`)** — a new webview panel that serves as Yamlink's home screen. Auto-opens once on first vault activation (keyed by vault root path in global state), then on demand via command or `Yamlink: Open Home`. Shows:
  - **Pulse bar** — note count, type count, and broken link count (highlighted in warning color when > 0)
  - **Quick actions** — "New note" (primary), "Today" (daily note), and per-vault type buttons for the top 4 types in the vault
  - **Activity feed** — last 15 mutation events as a human-readable timeline, most recent first; each entry is clickable to open that note in the editor
  - **Continue working** — the 5 most recently touched notes from the mutation log, clickable
  - **Nudge cards** — broken links (→ Problems panel) and untyped notes (→ `!view where type is empty`)
  - **Cold-start state** — vaults with fewer than 5 notes show an onboarding welcome with 3 quick-start steps instead of the activity feed

- **Compact status bar** — the Yamlink vault-health status bar item is now significantly shorter. Previous format: `Yamlink  ⚠ 31 nodes · 104 broken`. New format: `◈ 31  ⚠ 104` (broken) / `◈ 31` (healthy). The tooltip carries the full label. Nothing is lost — the icon already identifies the extension, and the warning icon + rose color already signal the problem.
- **Home quick-access button** — a permanent `$(home)` button now sits in the status bar immediately to the right of the vault-health item, always visible. One click opens the Home panel from any file. Previously Home was only reachable via the command palette.
- **Template-guided note creation from broken wikilinks** — the "Create note" quick fix (lightbulb on a broken `[[wikilink]]`) now guides users through the template workflow before creating the note:
  - If `_templates/` doesn't exist: offers to create the folder and write a starter template scaffolded from vault field patterns. The starter opens for editing; the user creates the note again afterward.
  - If `_templates/` exists but is empty: offers to create a starter template for the inferred type.
  - If `_templates/` contains templates: shows a QuickPick list of all templates, with a type-matched template bubbled to the top and labeled "Suggested". The user picks a template (or "Create without template") and the note is scaffolded immediately. Escape cancels without creating anything.
- **Extract Selection to New Note (`yamlink.splitNoteBody`)** — a second note-creation command in the editor right-click context menu (appears alongside "Yamlink: New Note from Selection" when text is selected in any Markdown file). Selected body text becomes the body of a new note; the first heading or non-blank line of the selection becomes an editable title prompt; the original selection is replaced with `![[new-id]]` (an embed); `source: [[original-id]]` is written into the new note's frontmatter automatically. Both commands are distinct: "New Note from Selection" turns the selected text into a title + `[[link]]`; "Extract Selection to New Note" turns it into a body + `![[embed]]`.

- **Natural language queries (`yamlink.naturalQuery`)** — "Yamlink: Query in Plain English" in the command palette. Type a plain-English description of what you want to find; Yamlink generates the `!view` syntax using 16 sentence pattern templates and 100% vault vocabulary injection (types, fields, workflow values, note IDs all drawn from the live vault). Works for any domain — "deployed starships", "stale kommandants", "missions linked to johnny-rico". The generated query is shown in a preview QuickPick before insertion; "Edit before inserting" lets you adjust it first. Confirmed queries are inserted at the cursor and run automatically. Standard `!view` syntax is completely unchanged — NL is a generator and learning tool, not a replacement. 33 tests covering `matchVocab`, all 16 pattern types, date filters, relation filters, field filters, grouping, and `exampleQueries`.

- **Click-to-add from arc section** — each field row in the Note Report "Likely missing" section now has a `+` button. Clicking it inserts a field stub at the end of the note's frontmatter (`field: [[` for relation fields, `field: ` for scalars), positions the cursor there, and triggers VS Code completion so you can immediately pick the target. Also wires the `lightbulb_applied` outcome event for the first time — arc-section click-to-adds now feed back into the outcome calibration chain alongside `completion_accepted` events.

### Changed

- **Yamlink palette applied across all webview surfaces** — all panels (home, health, note report, view table, graph sidebar, graph workspace, calendar) now use the Yamlink Apollo palette hardcoded rather than deriving from `vscode-textLink-foreground`, which resolves to blue in non-Yamlink themes. Lavender (`#C49BF0`) for identity and link surfaces, teal (`#5ECFBE`) for support/interactive states, amber (`#E7A85A`) for warnings and schema structure, pink (`#FF429F`) for primary actions and emphasis. The Yamlink color palette reference is documented at `docs/architecture/YAMLINK-COLOR-PALETTE.md`.

- **Home panel visual redesign**:
  - The Yamlink logo (`media/icon.png`) now appears in the header next to the title; the vault name renders as a lavender-tinted pill (hardcoded palette, not VS Code badge colors)
  - "Welcome to Yamlink" moves from the panel bottom to the top — it now acts as a proper hero section with a subtle pink gradient wash rather than a footnote
  - Primary "New Note" button uses Yamlink pink; action chip hover borders show a pink tint
  - Activity feed timestamps replaced with actual clock time: today's events show `HH:MM`; yesterday shows `Yesterday`; within the week shows the weekday; older shows `Jun 1`; relative time moves to the hover tooltip
  - Type badges in "Continue Working" column use lavender palette

- **Vault Health tab navigation** — the content area is now organized into six tabs (Activity / Lifecycle / Consistency / Schema / Types + conditional Templates and Orphans) so sections are accessed directly rather than scrolled. Stat-strip cards for Types, Schema, and Orphans switch to the matching tab on click. Templates tab appears only when template drift data exists; Orphans tab only when orphan nodes exist. Active tab is underlined in Yamlink pink.

- **Lucide icon family rolled out across all surfaces** — all unicode glyph and emoji icons replaced with inline Lucide SVG icons for visual consistency with the icon family used elsewhere in the product:
  - Graph sidebar toolbar: `◎` → Crosshair, `⊙` → Maximize2, `✕` → X
  - Entity hub (Note Report) section chevrons: `▸` → ChevronRight
  - Entity hub structural arc timeline: `◆ ◈ ⬡ ●` → FilePlus, Tag, Link, Clock
  - Health panel type accordion: `▸` → ChevronRight
  - Home panel action buttons: `＋` → Plus (Lucide), `📅` → Calendar (Lucide)

- **Graph sidebar blank-on-open eliminated** — when the sidebar webview first resolves, the container often has zero width before layout paint, causing the camera to initialize at the wrong centre position (x=450 on a 250px-wide sidebar). The first rendered frames showed a blank dark canvas. Fix: `Canvas2DRenderer.resize()` now scales the camera offset proportionally (`cam.x = cam.x × newW / oldW`) so the view centres correctly when dimensions change, regardless of when the first paint happens.

- **Graph jitter eliminated** — the `SimpleLayout` physics engine started each session with `alpha=1` (maximum force) and `velocityDecay=0.82` (only 18% damping per step), causing the first 30–60 rendered frames to show nodes flying across the canvas. Both the sidebar and full graph panel now pre-warm the simulation synchronously (up to 80 ticks until `alpha < 0.4`) before starting the animation loop. The first visible frame is already in a stable, mostly-settled layout. Velocity damping also increased from `0.82` → `0.65` and charge reduced from `2400` → `1800` for calmer settling in subsequent frames.

### Fixed

- Mutation event log was always persisted to `.yamlink/mutation-log.ndjson`; prior changelog and docs incorrectly described it as "per-session in-memory".
- **Callout blocks render correctly in the note preview and PDF export** — `> [!SOURCE]`, `> [!EVIDENCE]`, `> [!QUOTE]`, and all Yamlink callout types previously appeared as raw `[!TYPE]` text in both the note preview panel and PDF exports. A shared markdown-it plugin (`src/export/markdownItCallouts.js`) now transforms callout blockquotes into styled blocks at render time. The plugin handles multi-line callouts (title + body in the same inline token), unknown callout types (default to teal), and nested content. Wired into the note preview renderer (`previewRenderer.js`) and PDF body segment parser (`pdf.js`). Callout colors use the Yamlink Apollo Night palette: Amber `#E7A85A` for SOURCE/EVIDENCE/QUOTE/REFERENCE, Teal `#5ECFBE` for NOTE/INFO/TIP/ABSTRACT, Orange `#E67D61` for WARNING/CAUTION, Error `#FF4A6A` for DANGER/BUG/FAILURE. VS Code's built-in Markdown preview integration is wired (`extendMarkdownIt` + `markdown.markdownItPlugins`) but deferred to 0.7.0 for verification.
- **Note preview font updated to Inter** — the note preview panel (`yamlink.openNotePreview`) and its print/PDF path now use `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` instead of `Georgia, serif`. VS Code webviews block external font requests, so Inter loads from the system font stack when installed and falls back to system UI fonts otherwise.
- **Sample vault ships in the VSIX** — `sample/**` was excluded from `.vscodeignore`, silently breaking the first-run sample copy for all Marketplace installs. The sample vault now ships in the VSIX and is copied to the user's workspace on first activation as documented. Internal test files removed (`test-extraction.md`); internal test filenames cleaned up (`test.md` → `orphan-demo.md`, `test-character.md` → `rasczak-memorial.md`); schema files removed from the sample vault (schema is a premium surface, not a first-run demo concept).

---

## [0.5.2] - "Zim"

Patch release for the Zim line.

### Fixed

- Restored consistent wikilink resolution across diagnostics and ctrl-click navigation, including canonicalized targets, aliases, heading refs, and block refs.
- Fixed vault-wide rename propagation so wikilink updates do not skip affected files during bulk ID changes.

## [0.5.1] - "Zim"

Patch release for the Zim line.

### Fixed

- Restored clickable markdown wikilinks in VS Code by no longer disabling native markdown link behavior through Yamlink's markdown configuration defaults.

---

## [0.5.0] - "Zim"

Zim turns Yamlink into a more complete workspace release.

It makes the product easier to trust and easier to use:

- a rebuilt graph with both an ambient sidebar constellation and a deliberate Graph Workspace
- a stronger query language with more real-world filtering and date support
- smarter frontmatter and relation help that is more readable and more context-aware
- clearer Note Report and Vault Health surfaces
- better longform/body awareness through tags, quotes, footnotes, embeds, and callouts
- stronger release discipline through better caching, testing, linting, and CI

### Added

- **Graph 2.0** with two distinct surfaces:
  - **Sidebar graph** for ambient vault awareness
  - **Graph Workspace** for focused exploration around the current note, a query result, or a custom note set
- **Stronger query language**:
  - `!=`
  - `is empty`
  - `exists`
  - `is not empty`
  - cross-field `or`
  - `#tag` shorthand
  - date functions such as `today()`, `tomorrow()`, `days-ago(n)`, and `days-from-now(n)`
- **Smarter relation completion**:
  - human-readable labels instead of raw IDs
  - type-filtered candidates when Yamlink can infer the target note type
  - faster `New [type]` creation from relation fields
  - better body `[[` completion labels
- **Lifecycle and type-consistency signals** in Vault Health and Note Report
- **Note Report History tab** — persisted mutation event log (`.yamlink/mutation-log.ndjson`) showing `note_created`, `type_set`, `field_added`, `field_changed`, `field_removed`, and `relation_changed` events, grouped by Today / Yesterday / This week / older, with color-coded dots per event type. Events survive extension restarts.
- **Date shortcuts** with `@today`, `@tomorrow`, `@yesterday`, `@thisweek`, `@nextweek`, `@startofmonth`, and `@endofmonth`
- **Body-aware signals**:
  - body tags
  - callouts
  - embeds
  - footnotes
  - repeated body links as supporting evidence
- **Vault-wide aliases** through `aliases:` in frontmatter
- **Schema-first note creation improvements**:
  - `Yamlink: New Note from Schema`
  - schema fallback in normal note creation
  - template `date:` auto-fill
- **Public extension API** for reading the live index and running Yamlink queries
- **Developer tooling baseline**:
  - ESLint
  - GitHub Actions CI

### Changed

- **Graph became a clearer product surface**:
  - the old graph path is no longer the active user-facing experience
  - the workspace graph opens with a stronger focus model around the current note
  - the vault-wide graph now has its own broader constellation mode
  - graph controls and iconography were simplified and cleaned up
- **Completion and lightbulbs are more disciplined**:
  - weaker signals stay quieter
  - stronger signals surface more clearly
  - field actions behave more locally and avoid duplicate noise
- **Field and relation suggestions now learn more from the vault** instead of leaning so heavily on hardcoded fallbacks
- **Note Report** is now a five-tab panel (Overview, Links, Tasks, Views, History):
  - **Overview** leads with the "Briefing" section (scalar frontmatter), then "Signals" (vault-position counts vs. average, lifecycle state, note role), then "Signal details" (diagnostic link/field/type breakdown, collapsed by default)
  - **Links** separates structured frontmatter relations from body-mention rows; outbound links now read from the graph edge layer rather than frontmatter-only scanning, so body wikilinks correctly count as outbound connections
  - **Tasks** shows markdown task lines plus a date-sorted timeline across the note's `date:` field and task due dates
  - **Views** shows contextual query recipes (backlinks, type-specific incoming, "more [type]", relation-thread views, surrounding-setup views) generated from the note's live graph position and intelligence model
  - **History** shows the session-scoped mutation event log for this note, grouped by time bucket
- **Tables** now feel more operational:
  - cleaner shell
  - stronger sorting behavior
  - column value filters
  - corrected task status language
- **Aliases, embeds, and callouts** now behave more like first-class Yamlink signals instead of edge cases

### Fixed

- relation completion now behaves more like a real guided workflow instead of a raw ID picker
- ambiguous fields no longer get overconfident relation treatment
- body links no longer overpower stronger vault signals
- graph and Note Report suggestions stay better aligned with the actual visible context
- date shortcuts and date parsing are broader and safer
- templates and schema creation are more consistent
- `.yamlinkignore` now behaves like a true vault-control surface and rebuilds immediately when changed

### Reliability

- stronger caching across tasks, queries, intelligence, lifecycle, and drift
- more targeted surface refreshes when unrelated files change
- broader automated testing and safer release discipline

---

## [0.4.0] - "Carmen"

Carmen is the hardening and intelligence release.

It turns the post-Ace+ adaptive work into a cleaner, stronger baseline:

- much deeper frontmatter and note-context intelligence
- cleaner, more direct user-facing language across suggestions, hover, and Note Report
- broader date handling
- improvement in writer ergonomics
- a more maintainable codebase, reworking graph, table, health, note report, and intelligence files
- a rebuilt graph architecture after an unexpected VS Code webview break which forced a reset of the old rendering path

### Added

- **Query OR logic** — `where status = open or done` matches any value in the list
- **Query date-range operators** — `where date >= 2026-01-01`, `where deadline < 2026-05-01`; comparison uses ISO date ordering so `YYYY-MM-DD` sorts correctly
- **Body wikilink → frontmatter suggestion** — if `[[x]]` appears 2+ times in the note body and is not already a frontmatter field, Yamlink surfaces "Add as field" in the lightbulb
- **Note-context-aware query builder** — smart starters now lead the insert flow when Yamlink already understands the active note's surrounding structure
- **Scroll preservation in Note Report** — scroll position now survives file saves and re-renders when the same note stays active
- **Template system** — `_templates/`-based note creation with `yamlink.newNodeFromTemplate` and smart frontmatter generation
- **Activation cache** — vault-generation-keyed LRU cache eliminates redundant `buildFrontmatterOpportunityModel` calls on hover and lightbulb triggers
- **Bottom-bar writing stats** — Markdown notes now show body-only word count and character count in the status bar
- **Body-aware Note Report intelligence** — repeated body wikilinks can now reinforce adaptive report guidance and surface quiet `body links` hints
- **Body-aware adaptive frontmatter suggestions** — repeated body wikilinks now count as supporting evidence for likely next fields and links

### Changed

- **Graph is simpler to read and use** — in Carmen:
  - local graph now follows the current note
  - vault graph is now the broader view
  - local depth is now shown as 1, 2, or 3 layers of linked notes
  - graph controls are now simpler and easier to understand
- **Graph experience rebuilt** — the graph now runs on a cleaner, boot-once webview architecture with two clearer modes:
  - `Run Graph` opens a local graph centered on the active note
  - `Vault Graph` opens explorer mode for the broader vault
- **Graph controls simplified** — the rebuilt graph now centers on:
  - Local / Explorer mode switching
  - depth control for local graph link layers
  - search
  - type filtering
  - selected-node inspection
- **Graph codebase split** — graph host, state, payload building, boot HTML, client runtime, styling, and interaction logic are now separated into focused modules
- **Table/view codebase split** — table host, HTML shell, state runtime, value runtime, edit runtime, and UI runtime are now separated into focused modules
- **Health panel split** — panel host, health stats, and render shell are now separate modules
- **Note Report split** — render shell, sections, and model logic are now separated
- **Intelligence layer split** — field families, relation learning, gap learning, context building, neighborhood suggestions, affinity suggestions, body-link hints, and explanation surfaces now have clear module boundaries
- **Completion surface tightened** — adaptive field/gap suggestions and starter actions now suppress weaker matches more aggressively
- **Suggestion explanations tightened** — reasons are shorter, plainer, and more direct across suggestions, hover, and Note Report

### Intelligence

- Adaptive field learning now weighs:
  - shared frontmatter content/structure
  - note-role alignment
  - shared relation fields
  - shared linked IDs
  - repeated body wikilinks as supporting evidence
- Note Report, hover, suggestions, and frontmatter actions now share a much more consistent intelligence model instead of drifting apart
- Same-flow relation suggestions are more precise because they now track the matched relation field instead of leaking unrelated candidate fields
- Completion starter actions are deduped and ranked more cleanly
- Repeated body links can now influence:
  - adaptive frontmatter suggestions
  - Note Report hints

### Fixed

- Date "flexible" — string dates like "April 15, 2025" or "15/04/2025" normalize to `YYYY-MM-DD` in `fieldsCache`; queries like `where date = 2025-04-15` no longer silently return zero results
- Graph inference path was live but never ran against real vault data due to `new Map()` fallback — now correctly calls `getIndex()`
- **Date parsing is broader and safer** — now handles:
  - abbreviated textual months
  - elements like `26th`
  - month/day formats without using the reference year
  - terms like `by Friday` and `due next Tue`
- **Same-flow graph/report hints were corrected** — matched relation fields now stay aligned with the visible suggestion instead of drifting to an unrelated candidate field
- **Note Report opportunity model now uses live note body context**, not only frontmatter/index content
- **Graph controls now match the rebuilt runtime** — the older keyboard-heavy graph behavior was replaced by a simpler local/explorer model with explicit focus, expand, and active-note actions

### Reliability

- Structural hotspots across graph, tables, health, Note Report, actions, completions, and intelligence were split into smaller modules to reduce blast radius and make debugging safer

---

## [0.3.5] - "Ace+" - 2026-04-10

The Ace+ release line addresses major "trust issues" we failed to recognize before releasing Ace. From the "intelligence" standpoint, we had several issues either unpolished or unadressed.


### Added

- "Adaptive intelligence" foundation:
  - shared field-role inference core
  - first note-role inference layer
  - clearer explanation paths when suggestions are absent
- Broader suggestion intelligence:
  - schema-backed relation suggestions before repeated backlinks exist
  - mixed-type relation awareness
  - peer-relation suggestions from the current note's own structured fields
  - relation-context suggestions across note types sharing the same linked context
- Stronger task/query shortcuts:
  - `!view open-tasks`
  - `!view done-tasks`
  - `!view overdue`
  - `!view undated-tasks`
- `GETTING_STARTED.md` onboarding guide with:
  - CRM setup ideas
  - programmer/project setup ideas
  - commands, keybindings, and query examples
- Graph keyboard shortcuts:
  - `/`
  - `Esc`
  - `F`
  - `R`
  - `L`
  - `N`
  - `O`
- Calendar keyboard shortcuts:
  - `M`
  - `W`
  - `D`
  - `[`
  - `]`
  - `T`

### Changed

- Query refinement now returns users directly to the live result instead of only changing the source block
- Query/table workflows are much tighter from inside the table surface itself
- Graph layout, spacing, hierarchy, inspector model, and controls were substantially refined
- Calendar, Note Report, Graph, and Vault Health received responsiveness and consistency passes
- Status-bar styling was tightened so it feels more Yamlink and less like a generic alert slab
- Smart suggestions, completions, and report surfaces now move toward one adaptive-intelligence model instead of isolated heuristics
- Query-side relation autocomplete now follows the same target-preference model as frontmatter relation autocomplete

### Fixed

- Body and frontmatter wikilinks now canonicalize targets more reliably before graph indexing
- Smart suggestions no longer depend only on narrow repeated-backlink patterns to feel alive
- Relation autocomplete no longer hides the rest of the vault when inference finds a likely target type
- Query `where ... = [[` relation completion is no longer significantly weaker than frontmatter relation completion
- Calendar now recognizes note-level `date:` fields instead of only `created:`
- Table reset now restores hidden columns and resized column widths properly
- Table undo/revert now scopes correctly to the right rendered table context
- Resizing columns no longer risks accidental header sorting

### Reliability

- Full local suite remains the release gate
- Current full baseline after the post-release audit: `285/285`

---

## [0.3.1] - "Ace" - 2026-04-06

Hotfix release for the initial Ace publish.

### Fixed

- VSIX packaging now includes runtime dependencies again
- Yamlink commands, Note Report, Calendar, Vault Health, Run Views, and Graph can activate correctly in the Marketplace build

---

## [0.3.0] - "Ace" - 2026-04-06

The stabilization and shaping release. Yamlink is now a real local-first structured workspace layer inside VS Code.

### Added

- Yamlink sidebar container with:
  - Note Report
  - Calendar
  - Vault Health
- Vault-wide calendar foundation with:
  - month view
  - week view
  - day view
  - task activity
  - created-note activity
- Stable task block IDs
- Query shorthand presets:
  - `!view calendar`
  - `!view today`
  - `!view upcoming`
- Guided query-builder foundation
- Bulk spreadsheet-style paste in query tables
- Stronger typed table editing:
  - text
  - relation
  - boolean
  - dropdown
  - number
  - date
- Row-level revert for table edits
- Tab / Shift+Tab keyboard navigation across editable cells
- Smart suggestions surfaced again inside the product
- PDF export for:
  - live views
  - active notes with embedded view results
- Vault-wide graph upgraded into a stronger product surface with:
  - search
  - filter chips
  - map key
  - node inspector
  - stronger layout and styling
- Completion intelligence improvements:
  - relation suggestions before `[[`
  - observed-field fallback
  - archetype-driven frontmatter keys
  - broader relation fallback to all notes
- Dedicated sample files for repeatable manual testing

### Changed

- Multi-root workspace handling is now part of the core flow
- Frontmatter editing now uses safer YAML-aware serialization
- Query tables no longer auto-open just because a note contains `!view`
- Note Report and Calendar now live in Yamlink's dedicated sidebar surface
- Note Report was repositioned away from the status bar as a primary destination
- Vault Health received a major visual reset
- Table date rendering was normalized toward canonical display
- Non-editor mono-heavy UI styling was reduced significantly
- README, roadmap, and project log were restructured to reflect the current product honestly

### Fixed

- `yaml.dump is not a function` test failure in the index suite
- stale table refresh after edits caused by cache/index timing
- sidebar command focus issues for Note Report and Calendar
- Note Report runtime regression: `suggestions is not defined`
- graph/calendar runtime crashes from missing `esc`
- date display regression where canonical dates rendered as long timezone strings
- rename propagation now handles:
  - `[[id]]`
  - `[[id|Label]]`
  - `![[id]]`
- `[[id|Label]]` parsing now resolves the target ID correctly across indexing and diagnostics
- malformed schema nodes now surface a diagnostic instead of failing quietly
- frontmatter ID generation now normalizes filenames/titles into safer canonical IDs

### Reliability

- Full local release gate now includes:
  - `npm run test`
  - `npm run test:index`
  - `npm run test:date`
  - `npm run test:calendar`
  - `npm run test:rename`
  - `npm run test:runtime`
  - `npm run test:all`
  - `npm run test:ace`

---

## [0.2.0] - "Dizzie" - 2026

The query release. Yamlink became queryable, not just navigable.

### Added

#### View Panel

- `!view <type>` blocks render live, interactive tables inside VS Code
- Multiple `!view` blocks in one file become tabs in the panel
- Tab state persists across re-renders
- `Run views` status bar action
- Inline cell editing
- Relation cell editing with known-ID validation
- Filter chips with live count updates
- Column sorting per tab

#### Query Language

- `select <fields>`
- `where <field> = <value>`
- `where <field> contains <text>`
- `sort <field>` / `sort <field> desc`
- `limit N`
- `| <label>` query labels
- Multi-line query blocks
- `!view *` wildcard

#### Entity Hub

- Full backlink view for a focused node, grouped by relation field
- Sortable table sections
- Global search
- Collapse / expand sections

#### Vault Health

- Health score
- graph statistics
- orphan detection
- type distribution

#### Code Actions and Suggestions

- query suggestion insertion based on repeated backlink patterns
- `yamlink.insertViewBlock`

#### Schemas and Completions

- schema nodes
- required field validation
- relation target enforcement
- duplicate schema detection
- YAML field name completions inside frontmatter

### Changed

- Body links in Entity Hub sorted last and start collapsed
- Hover preview now expands relation fields inline

### Fixed

- Edge deduplication key now includes the field name
- several code action and chip-count regressions

---

## [0.1.0] - "Apollo" - 2025

The identity release. Yamlink established the foundation:

- canonical `id:` identity model
- rename propagation
- backlinks
- hover previews
- definition navigation
- wikilink autocomplete
- broken-link diagnostics
- duplicate ID detection
- quick fixes for missing frontmatter and broken links
- status bar vault summary
