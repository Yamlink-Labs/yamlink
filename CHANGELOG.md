# Changelog

## [0.3.1] - "Ace" - 2026-04-06

Hotfix release for the initial Ace publish.

### Fixed

- VSIX packaging now includes runtime dependencies again
- Yamlink commands, Note Report, Calendar, Vault Health, Run Views, and Graph can activate correctly in the Marketplace build

---

## [Unreleased] - 0.4.0 "Carmen"

The focus after Ace is not feature sprawl. Carmen is the scale, polish, and hardening release.

Planned direction:

- improve large-vault performance and refresh behavior
- polish Note Report and Calendar further
- refine tasks into a stronger workflow layer
- improve query-builder / simple-query UX
- broaden date and time flexibility carefully
- keep Yamlink powerful without consuming Atomix's role

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
