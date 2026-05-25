# Changelog


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
- **Note Report** now leads with clearer factual signals before inference
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
