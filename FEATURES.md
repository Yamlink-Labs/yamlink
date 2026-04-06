# Yamlink Features Reference

What Yamlink can do today.

Use it as the detailed companion to [README.md](./README.md):

- `README.md` explains the product
- `FEATURES.md` explains the working surface area

---

## Core Model

Yamlink turns Markdown files into a structured graph:

- Markdown files with `id:` become nodes
- `[[wikilinks]]` become graph relationships
- YAML frontmatter becomes structured fields
- `!view` blocks query that graph

### Identity

- Canonical `id:` model
- IDs survive file renames and moves
- Filename is cosmetic, `id:` is the source of truth
- ID generation can normalize accented human input into safe canonical IDs

### Links

- body wikilinks
- frontmatter relation links
- alias links like `[[id|Label]]`
- embeds like `![[id]]`

### Graph awareness

- backlinks
- outgoing relations
- duplicate ID detection
- broken link detection
- orphan awareness

---

## Commands

Current Yamlink command surface includes commands such as:

- `Yamlink: Create Node`
- `Yamlink: New Node from Template`
- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Vault Health`
- `Yamlink: Open View`
- `Yamlink: Run Graph`
- `Yamlink: Run Views in Current File`
- `Yamlink: Insert View Block`
- `Yamlink: Query Builder`
- `Yamlink: Copy Node ID`
- `Yamlink: Export Active Note to PDF`

The exact command list is defined in [`package.json`](./package.json).

---

## Query Language

Yamlink queries live inside notes.

### Basic query

```md
!view mission
```

### Label a query tab

```md
!view mission | Latest missions
```

### Supported clauses

- `select`
- `where`
- `contains`
- `sort`
- `limit`
- `via`

### Example

```md
!view mission | Rico missions
where commander = [[johnny-rico]]
select date, outcome, unit
sort date desc
limit 10
```

### Incoming views

```md
!view incoming mission
via commander
select date, outcome
```

### Shortcut queries

- `!view today`
- `!view upcoming`
- `!view calendar`

These are currently map to task/date-oriented query flows.

---

## Query Builder

Yamlink now has a guided query-builder foundation.

It currently helps build:

- type tables
- incoming/backlink views
- task/calendar presets

This is not the final visual query builder. It is the first stage for a more developed engine.

---

## Tables

Query results now open as live tables.

### Supported table behaviors

- multiple query tabs per note
- sort by column
- search within a result
- filter chips
- column order persistence
- column hide/show controls
- CSV export
- JSON export
- PDF export

### Editable cell types

- text
- relation
- boolean
- dropdown
- number
- date

### Editing features

- double-click to edit
- relation validation
- spreadsheet-style bulk paste
- row-level revert
- undo support
- Tab / Shift+Tab navigation across editable cells

### Table output behavior

- edits write back to source frontmatter
- date rendering stays canonical as `YYYY-MM-DD`
- relation cells open linked nodes

---

## Note Report

The Note Report lives in the "Yamlink sidebar".

It is the structured inspector for the active note.

### Current sections

- summary
- incoming relation groups
- outgoing relation groups
- task sections
- timeline
- suggested views

### Current behavior

- follows the active note
- can be focused explicitly from the editor title or command palette
- supports search within the report
- supports opening related nodes directly

---

## Calendar

The Calendar also lives in the Yamlink sidebar.

It is vault-wide, not note-specific.

### Current modes

- month
- week
- day

### Current data sources

- dated Markdown tasks
- notes with `created:` dates

### Current calendar capabilities

- range switching
- selected-range activity summary
- click-through to related notes

### Important limitation

Much like the newer addition, this is a foundational step, not yet a fully mature task/calendar product.

---

## Tasks

Yamlink has began working on tasks as well. It is very much a work in progress, but something to test out. Feedback is always appreciated.

### Current task functionality

- task extraction from Markdown task lines
- stable task block IDs
- task visibility in Calendar
- task visibility in Note Report
- task-oriented shortcut queries

### Not fully mature yet

- dedicated task dashboards
- richer task editing workflows
- full task status flows
- advanced task filtering and review loops

---

## Graph

The graph is now a real surface, not just a raw canvas.

### Current graph capabilities

- search
- type filtering
- relation filtering
- map key
- node selection
- neighborhood focus
- selected-node inspector
- stronger spacing and layout

### Current graph role

The graph is for understanding structure, not just proving that links exist.

---

## Vault Health

Vault Health gives a vault-wide quality snapshot.

### Current health surface includes

- health score
- node count
- edge count
- broken links
- orphan nodes
- type count
- schema count
- entity type summary

### Role

The idea is that Vault Health isn't just diagnostics. The main purpose is to become the operational quality surface for the vault.

---

## Diagnostics

Yamlink currently surfaces diagnostics for:

- missing `id:`
- duplicate IDs
- broken links
- broken relations
- unknown types
- missing required schema fields
- duplicate schemas
- malformed schema nodes
- query suggestions

Diagnostics appear as hints, warnings, or advisory information depending on severity.

---

## Rename Propagation

When a node ID changes, Yamlink can propagate the rename across the vault.

### Supported rename targets

- `[[id]]`
- `[[id|Label]]`
- `![[id]]`

This is one of Yamlink’s most important correctness features because it protects the knowledge graph as notes evolve.

---

## Frontmatter Intelligence

Yamlink’s autocomplete is not limited to raw ID completion.

### Current intelligence behaviors

- frontmatter field suggestions from schema
- observed-field fallback for schema-less note types
- archetype-based field suggestions
- relation target inference from:
  - schema targets
  - field names
  - observed graph usage
- relation suggestions before typing `[[`
- fallback to all indexed notes when smart inference is weak
- ranked note suggestions, not strict prefix-only behavior

### Examples of heuristic fields

- `account`
- `accounts`
- `account_id`
- `owner`
- `contact`
- `company`

---

## Smart Suggestions

Yamlink can detect repeated graph patterns and suggest useful views.

Example pattern:

- several `mission` notes all link to the current note through `commander`

Yamlink can then suggest a ready-to-insert view for that relation pattern.

Smart suggestions are currently surfaced through:

- diagnostics
- code actions
- Note Report suggested views

---

## Schemas and Templates

### Schemas

Yamlink supports `type: schema` notes.

Current schema behavior includes:

- required field enforcement
- relation target definition
- duplicate schema detection
- malformed schema diagnostics
- schema-aware field completion

### Templates

Yamlink supports `_templates/`-based note creation workflows.

Current template support includes:

- create node from template
- type-based template flows
- sample/template-aware note generation

---

## Export

### Current export support

- CSV from live views
- JSON from live views
- PDF from live views
- PDF from active notes

### Active note PDF export includes

- summary/frontmatter
- note body
- embedded `!view` results

This makes Yamlink useful for reporting, CRM-style summaries, and operational handoff documents.

---

## Sample Files

Yamlink ships with repeatable sample files for demos and manual testing:

- [dashboard.md](./sample/dashboard.md)
- [query-shortcuts.md](./sample/query-shortcuts.md)
- [table-types.md](./sample/table-types.md)
- [note-report.md](./sample/note-report.md)
- [tasks-calendar.md](./sample/tasks-calendar.md)

---

## Testing

Recommended commands:

```powershell
npm run test
npm run test:index
npm run test:date
npm run test:calendar
npm run test:rename
npm run test:runtime
npm run test:all
npm run test:ace
```

Recommended release gate:

1. `npm run test:all`
2. `npm run test:ace`
3. manual Extension Host smoke check

---

## Product Boundary

Yamlink is becoming very powerful, but it should remain disciplined.

### Yamlink should own

- local-first structured Markdown workflows
- graph identity and safety
- live query tables
- side-panel operational context
- export/reporting
- practical tasks/calendar support

### Atomix should own

- the deeper workspace shell
- heavier block-native workflows
- the more ambitious operating-system layer
- the richer hybrid editor experience

That boundary matters for roadmap discipline.
