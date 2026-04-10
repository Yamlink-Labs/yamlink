# Yamlink Features Reference

What Yamlink can do today.

Use it as the detailed companion to [README.md](./README.md):

- `README.md` explains the product
- `FEATURES.md` explains the working surface area
- `GETTING_STARTED.md` explains how to set up and use Yamlink in real vaults

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
- body/frontmatter link targets are canonicalized before graph indexing, so casing, spacing, aliases, and heading/block suffixes do not silently break graph edges

### Adaptive intelligence

- Yamlink is now moving toward one shared adaptive-intelligence model instead of isolated per-surface heuristics
- intelligence currently draws from:
  - frontmatter structure
  - body/frontmatter wikilinks
  - schema relation definitions
  - observed field values across the vault
  - graph usage patterns
- field-role inference now treats small core semantics as foundational:
  - relation-like
  - date-like
  - status-like
  - person-like
  - container-like
  - topic-like
- the rest of the system is being pushed toward user-adaptive behavior instead of one hardcoded ontology
- the current Ace+ direction is:
  - shared field-role intelligence core
  - note-role inference
  - smarter suggestions
  - smarter autocomplete
  - clearer explainability when intelligence is weak
  - more transparent reasoning inside completions so likely matches and inferred field roles are not opaque
  - query relation autocomplete now uses the same target-preference model as frontmatter relation autocomplete

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
- `!view open-tasks`
- `!view done-tasks`
- `!view overdue`
- `!view undated-tasks`

These are currently map to task/date-oriented query flows.

---

## Query Builder

Yamlink now has a guided query-builder foundation.

It currently helps build:

- type tables
- incoming/backlink views
- task/calendar presets
- recipe-driven views from Note Report context
- refinement of existing `!view` blocks

This is not the final visual query builder. It is the first stage for a more developed engine.

### Current query-builder behavior

- quick presets before deeper custom flows
- contextual query recipes inside Note Report
- `Open Yamlink Query Builder` lightbulb action on `!view` blocks
- `Refine this view` action for existing queries
- insert/refine flows now run the updated view automatically so users see the result immediately

---

## Tables

Query results now open as live tables.

### Supported table behaviors

- multiple query tabs per note
- sort by column
- search within a result
- filter chips
- visible-row count vs total rows
- active state summary for search / filter / sort
- reset view action
- column order persistence
- drag-and-drop column reordering
- resizable columns
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
- refine the source query directly from the table toolbar
- resize and reorder columns directly from the table header

### Table output behavior

- edits write back to source frontmatter
- date rendering stays canonical as `YYYY-MM-DD`
- relation cells open linked nodes
- sparse state is clearer when search/filter hides all rows
- relation/task tables in Note Report omit columns that are empty across all rows

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
- suggested views now explain more clearly when Yamlink has not yet inferred enough structure to propose a view confidently

### Suggested view intelligence

- repeated backlink patterns still matter
- schema-backed relation fields can trigger view suggestions before backlinks exist
- mixed-type backlinks on the same field can trigger broader incoming suggestions
- current-note relation fields can now suggest adjacent views across types when the vault schema says they share the same linked context
- examples:
  - a contact linked to an account can surface meetings for that same account
  - a product linked to a concept can surface other product/concept views that share the same structured relation

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
- notes with `date:` or `created:` dates

### Current calendar capabilities

- range switching
- selected-range activity summary
- click-through to related notes
- keyboard shortcuts:
  - `M` / `W` / `D` for month, week, and day mode
  - `[` and `]` to move backward and forward through the current range
  - `T` to jump to today

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
- natural-language date extraction in task text such as:
  - `tomorrow`
  - `Friday`
  - `next Monday`
  - `end of month`
  - `in 3 days`
  - `in 2 weeks`
  - `this weekend`
  - `next weekend`

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
- keyboard shortcuts:
  - `/` to focus graph search
  - `F` to fit the visible graph
  - `R` to reset graph state
  - `L` to toggle edge labels
  - `N` to focus the active note
  - `O` to open the selected node's note
  - `Esc` to clear the current graph state

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
- adaptive field-role inference is now starting to power completion from shared signals:
  - schema evidence
  - observed wikilink values
  - graph usage
  - soft field-name priors
  - observed value shapes like date-like and status-like patterns
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

Yamlink can detect structured graph patterns and suggest useful views.

Smart suggestions are currently surfaced through:

- diagnostics
- code actions
- Note Report suggested views
- frontmatter hover cards
- status bar hinting

### Current suggestion intelligence

Suggestions can now come from multiple signals:

- repeated incoming backlink patterns
- schema-aware relation fields targeting the current note type
- mixed-type backlinks that converge on the same relation field
- peer-relation logic from the current note's own structured fields
- explanation when nothing qualifies yet

Examples:

- several `mission` notes link here through `commander`
- a `contact` schema and a `meeting` schema both define `account` as a relation to the current `partner` note type
- multiple note types link here through the same field, making a wildcard incoming view useful

The goal is to make suggestions useful across:

- CRM vaults
- fiction / worldbuilding vaults
- programmer / project-tracking vaults
- research-oriented note systems

### Direction

Ace+ is now moving toward a shared adaptive-intelligence core.

The goal is not to hardcode users into one ontology. The goal is:

- small foundational semantics
- vault-adaptive field-role inference
- smarter completion, suggestions, and report logic built on the same reasoning layer

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

For a more practical walkthrough, including recommended CRM and programmer setups, see [GETTING_STARTED.md](./GETTING_STARTED.md).

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

---

## Design Direction

Yamlink now has a recognizable visual direction inside the extension, but the palette is still being formalized.

### Current state

- Yamlink surfaces now share a clearer product identity than they did in Ace
- graph, health, report, and table work are converging toward a common visual language
- theme safety matters:
  - surfaces should read clearly in dark themes
  - surfaces should also hold up in light themes

### Working direction

- Yamlink should eventually have a real companion theme family
- that theme work should be design-system-first, not just color experimentation
- Tokyo Night is a useful benchmark here because it shows:
  - restraint
  - contrast discipline
  - strong dark/light adaptation

### Important rule

Yamlink UI improvements should stay theme-agnostic whenever possible.

The goal is not to make the extension look good only under one preferred dark theme. The goal is to make it feel intentional across both dark and light VS Code setups.
