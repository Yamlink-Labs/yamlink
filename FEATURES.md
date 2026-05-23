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
- **Note aliases** — add `aliases: [victoria, vic]` to any note's frontmatter; Yamlink registers each alias in the index so `[[victoria]]` resolves to the note, appears in completion, and navigates on Ctrl+Click — exactly like the canonical ID

### Links

- body wikilinks
- frontmatter relation links
- **display aliases** — `[[id|Label]]` renders "Label" as the link text while the graph edge resolves to `id`
- **vault aliases** — `[[victoria]]` resolves to the note that declares `aliases: [victoria]`
- **embeds** — `![[id]]` is a full embed link: dimmed `!` decoration, Ctrl+Click navigation, broken-link diagnostics
- heading anchors — `[[id#Section]]`
- block refs — `[[id^blockid]]`
- body/frontmatter link targets are canonicalized before graph indexing, so casing, spacing, aliases, and heading/block suffixes do not silently break graph edges

### Callouts

Yamlink supports Obsidian-compatible callout syntax in the note body:

```md
> [!SOURCE] LuthorCorp Q2 memo
> LuthorCorp is expanding its meta-human research division into Gotham.

> [!EVIDENCE]
> Three field reports corroborate this.

> [!NOTE] For reference
> Cross-check against the Wayne Enterprises intel note.

> [!WARNING] Potentially outdated
> This was accurate as of April 2026.
```

- `[!SOURCE]`, `[!EVIDENCE]`, `[!QUOTE]`, `[!REFERENCE]` — amber decoration
- `[!NOTE]`, `[!INFO]`, `[!TIP]`, `[!ABSTRACT]` — blue decoration
- `[!WARNING]`, `[!CAUTION]` — orange decoration
- `[!DANGER]`, `[!BUG]`, `[!FAILURE]` — red decoration
- callout types feed into note-role inference: `[!SOURCE]` and `[!EVIDENCE]` push the note toward a source/evidence role; `[!WARNING]` toward a warning signal
- titles after the type marker are optional: `> [!NOTE]` and `> [!NOTE] My title` both work

### Adaptive intelligence

Yamlink learns from your vault as you use it — it doesn't rely on a fixed list of expected field names or a hardcoded idea of what your notes should look like.

What it picks up on:
- frontmatter fields and their values
- wikilinks in frontmatter and note bodies
- schema definitions, if present
- how fields are used across similar notes in the vault

What you get from it:
- field suggestions drawn from real patterns in your vault, not just generic defaults
- works even when your vault uses non-standard names like `account` instead of `company`, or `followup` instead of `date`
- completion, Note Report guidance, and lightbulb actions share the same model — consistent across surfaces
- confidence-aware: weak signals stay quiet; clear patterns surface prominently
- lifecycle state detection:
  - `draft`
  - `growing`
  - `established`
  - `hub`
  - `stale`
- type-consistency detection:
  - `on-track`
  - `slightly unusual`
  - `missing structure`
  - `very unusual`

### Frontmatter intelligence

- field suggestions work even for notes that aren't fully typed or structured yet
- Yamlink infers likely fields from how similar notes in your vault are already built
- suggestions show up in completion, Note Report guidance, and lightbulb actions

### Intelligence direction

- Yamlink intelligence stays visible, predictable, and non-intrusive
- lifecycle and type-consistency are the current dedicated intelligence surfaces

### Graph awareness

- backlinks
- outgoing relations
- duplicate ID detection
- broken link detection
- orphan awareness

---

## Vault Control

### `.yamlinkignore`

Place a `.yamlinkignore` file at the workspace root to exclude Markdown files from Yamlink without removing them from disk.

Supported patterns:

- folders with a trailing slash: `scratch/`
- exact relative file paths: `notes/legacy.md`
- plain filenames: `legacy-note.md`

Ignored files are excluded from indexing, graph edges, diagnostics, Note Report, Vault Health, Calendar analysis, inference, and rename propagation.

This is the right escape hatch for archives, generated content, or mixed-use repos where not every Markdown file belongs in the Yamlink system. Changes to `.yamlinkignore` take effect immediately — no restart required.

---

## Commands

Yamlink registers the following commands in the VS Code command palette:

- `Yamlink: Create Note`
- `Yamlink: New Note from Template`
- `Yamlink: New Note from Schema`
- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Vault Health`
- `Yamlink: Import Obsidian Vault`
- `Yamlink: Open View`
- `Yamlink: Open Graph Workspace` — opens centered on the active note
- `Yamlink: Open Vault Graph` — opens in vault-wide constellation mode
- `Yamlink: Open Graph` — opens the sidebar graph panel
- `Yamlink: Run Views in Current File`
- `Yamlink: Insert View Block`
- `Yamlink: Refine View Block`
- `Yamlink: Query Builder`
- `Yamlink: Copy Note ID`
- `Yamlink: Export Active Note to PDF`

The exact command list is defined in [`package.json`](./package.json).

### First-pass Obsidian import

A narrow but useful Obsidian bridge:

- pick an Obsidian vault folder from the command palette
- either copy it into the current workspace or add it as a workspace folder
- `.obsidian/` is ignored on the copy path so Yamlink brings in the content, not the editor config
- the index rebuilds immediately
- Yamlink then offers to open Vault Health so you can inspect the imported vault right away

This is intentionally not a full migration. It is a quick way to get an existing Obsidian vault under Yamlink so the structural surfaces can start working on it.

---

## Query Language

Yamlink queries live inside notes.

There are now two official forms:

- simple one-line form
- multi-line power-user form

### Basic query

```md
!view mission
```

### Simple one-line query

```md
!view contact where status = active sort date desc limit 10
```

### Power-user query

```md
!view contact | Active contacts
where status = active
select name, account, owner, date
sort date desc
limit 10
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

### Where operators

- Equality: `where status = active`
- Not-equal: `where status != archived`, `where commander != [[johnny-rico]]`
- OR (same field): `where status = active or done`
- Cross-field OR: `where status = active or type = contact`
- Contains: `where body contains keyword`, `where any contains luthorcorp`
- Empty / exists: `where close-date is empty`, `where owner exists`, `where date is not empty`
- Tag filter: `where #crm`, `where #research and status = active`
- Comparison: `where date >= 2026-01-01`, `where deadline < 2026-05-01`
- Date functions: `where date >= today()`, `where date <= days-from-now(14)`, `where date >= days-ago(30)`
- Combined across lines (AND): `where status = open` + `where date >= 2026-04-01`

For the full contract, use [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md).

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

These map to task/date-oriented query flows.

---

## Query Builder

Yamlink has a guided query builder built into the editor.

It helps you build:

- type tables
- incoming/backlink views
- task and calendar views
- query suggestions from Note Report context
- refinements to existing `!view` blocks

It's editor-native: you stay in VS Code, work in plain text, and the builder helps with structure rather than replacing it.

### Current query-builder behavior

- guided starters when inserting a new `!view` block — suggestions based on the active note's context
- quick presets for common patterns: type tables, task views, incoming/backlinks
- contextual query recipes inside Note Report
- **Open Yamlink Query Builder** lightbulb action on `!view` blocks
- **Refine this view** action for existing queries
- query warnings suggest specific repairs for common mistakes (mistyped field, unknown type, etc.)
- one-step smart repairs for simple fixable problems
- falls back to direct editing when that's the fastest fix
- runs the updated view automatically after inserting or refining

---

## Tables

Query results now open as live tables.

### Supported table behaviors

- multiple query tabs per note
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

### Layout

The Note Report uses a four-tab layout to avoid excessive scrolling:

- **Overview** — summary rows and vault position (note type, link counts vs. vault average, inferred note role)
- **Links** — outgoing and incoming relation tables grouped by field
- **Tasks** — Markdown task sections and timeline rows
- **Views** — contextual query recipe suggestions

Tab selection persists across note switches via localStorage.

### Current behavior

- follows the active note
- can be focused explicitly from the editor title or command palette
- supports search within the report (scoped to the active tab)
- supports opening related notes directly
- vault position section leads with quantitative facts (counts vs. vault average) before intelligence signals
- overview now includes the active note's lifecycle summary

### Suggested view intelligence

The Views tab suggests queries that are likely useful from the current note.

- incoming backlinks on the same field suggest a view for that relation
- schema-defined relation fields can trigger suggestions even before backlinks exist
- the current note's outgoing relations can surface related views in connected contexts

Examples:
- a contact linked to an account → surfaces meetings for that account
- a product linked to a concept → surfaces other related product and concept views
- a task-like note linked to a project → surfaces the task thread for that project

---

## Calendar

The Calendar also lives in the Yamlink sidebar.

It is vault-wide, not note-specific.

### Modes

- month
- week
- day

### Data sources

- dated Markdown tasks
- notes with `date:` or `created:` dates

### Capabilities

- range switching
- selected-range activity summary
- click-through to related notes
- keyboard shortcuts:
  - `M` / `W` / `D` for month, week, and day mode
  - `[` and `]` to move backward and forward through the current range
  - `T` to jump to today

---

## Tasks

Tasks are a real workflow surface in Yamlink.

### Task functionality

- task extraction from Markdown task lines
- stable task block IDs
- task visibility in Calendar
- task visibility in Note Report
- task-oriented shortcut queries
- broader date handling in task and note text such as:
  - `Mar 26th 2026`
  - `26th Mar 2026`
  - `Mar 26`
  - `26 Mar`
  - `by Friday`
  - `due next Tue`
- natural-language date extraction in task text such as:
  - `tomorrow`
  - `Friday`
  - `next Monday`
  - `end of month`
  - `in 3 days`
  - `in 2 weeks`
  - `this weekend`
  - `next weekend`

---

## Graph

Graph 2.0 is the primary graph engine, with two distinct surfaces serving different use cases.

### How to open the surfaces

**Sidebar graph** — ambient, always visible:
- `Yamlink: Open Graph` opens the sidebar panel
- Shows a vault constellation by default (all notes as dots)
- Switches to local scope when you click "Explore →" on a note

**Graph Workspace** — deliberate exploration panel:
- `Yamlink: Open Graph Workspace` opens centered on the active note (Focus mode)
- `Yamlink: Open Vault Graph` opens in vault-wide Explore mode

The legacy Cytoscape graph is still present on disk for emergency recovery, but it is no longer exposed as a user-facing command.

### Sidebar graph

- **Vault scope** (default) — every note in the vault rendered as a dot; size encodes hub score
- **Local scope** — direct connections of the current note (1 hop)
- **Toolbar:** scope buttons, ◎ center-on-current, ⊙ fit all notes, note count badge
- **Selection bar** — clicking a note shows a strip with the note label plus:
  - **Explore →** switches to local scope centered on that note
  - **Open** opens the note in the editor
  - **✕** dismisses the bar
- **Type-colored convex hulls** drawn behind dots for any type with ≥ 3 nodes
- Vault scope stays stable when the active editor changes — use ◎ to manually recenter

### Graph Workspace

**Source:**
- Current note — graph built from the active Markdown note
- Query-defined — graph built from a type query
- Custom — manual note list via chip input, then refined with filters

**Modes:**
- Focus — current note and its strongest direct connections
- Explore — broader vault-wide constellation

**Controls:**
- Search
- Show more connections in Focus mode
- Note cap in Explore mode
- Advanced Filters: type / relation / tag facets, active filter chips, Reset
- Fit canvas / Current note / Reset filters toolbar actions

**Canvas:**
- Note cards for neighborhood/local; dot notes for vault/domain
- Custom bezier edges with boundary-intersection entry/exit points
- Multi-edge parallel offset — multiple edges between the same pair fan out as distinct arcs
- Edges always rendered above note layer (never covered by cards)
- Hover: highlights the hovered note and its neighbors; non-neighbors dim
- Double-click note: opens note in editor
- edge labels appear on the most important visible links

**Right panel:**
- Selection card with label, type, outgoing count, incoming count, signal score, hidden-neighbor count, strongest link, connected types, and tags
- **Isolate** — show only the selected note + its 1-hop neighbors
- **Hide unrelated** — show only notes reachable from the selected note via any path (BFS)
- **Show all** — restore full view
- Cluster chips, minimap

### Graph stats and reading model

- **Notes** — notes currently visible in the graph
- **Edges** — visible connections between those notes
- **Types** — distinct `type:` values visible in the current slice
- **Largest cluster** — size of the biggest connected group in the current view
- **Signal** — weighted connection strength for the selected note in the current graph
- **Hidden neighbors** — notes connected to the selected note that are not currently shown in the tighter Focus slice

### Graph role

The graph is for understanding structure. The sidebar gives ambient structural awareness. The workspace is for deliberate, scoped exploration with filters.

---

## Vault Health

Vault Health gives a vault-wide quality snapshot.

### Current health surface includes

- health score
- note count
- edge count
- broken links
- orphan nodes
- type count
- schema count
- entity type summary
- lifecycle distribution
- type-consistency score cards
- need-attention drift pills for the most divergent notes

### What the main numbers mean

- **Health score** — a simple 0–100 cleanliness score based on broken links and isolated notes
- **Nodes** — how many Yamlink notes are currently indexed
- **Edges** — how many note-to-note connections exist
- **Broken links** — links that point to missing IDs
- **Orphan nodes** — notes with no inbound or outbound connections
- **Types** — how many different note categories the vault uses
- **Schemas** — how many formal type-definition notes exist

Hover any Vault Health card to see a short tooltip that explains the stat in plain language.

### Lifecycle states in plain language

- **Draft** — barely started
- **Growing** — taking shape
- **Established** — looks complete for its kind
- **Hub** — many other notes point to it
- **Stale** — likely needs review because it has not moved recently

### Type consistency in plain language

- **On Track** — this note looks normal for its type
- **Slightly unusual** — something looks a bit off for this note type, but it's not alarming
- **Missing structure** — probably missing expected structure
- **Very unusual** — very different from the rest of its type

### Role

Vault Health is the operational quality surface for the vault — not just diagnostics, but a structural snapshot that makes health trends visible over time.

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

- field suggestions from schema, when one is defined for the note type
- field suggestions from observed vault patterns when no schema exists
- if you mention `[[x]]` twice or more in the note body and it's not yet a frontmatter field, Yamlink offers "Add as field" in the lightbulb
- relation completion starts before you type `[[` — suggestions appear based on the field name
- relation suggestions are ranked by vault relevance, not just alphabetical order
- smart starter actions for likely next steps when Yamlink has enough signal about the current note

---

## Writer Ergonomics

- bottom status-bar writing metrics for Markdown notes
- body-only word count
- body-only character count
- counts ignore frontmatter so longform notes are measured more honestly

---

## Smart Suggestions

Yamlink can detect structured graph patterns and suggest useful views.

Smart suggestions are currently surfaced through:

- diagnostics
- code actions
- Note Report suggested views
- status bar hinting

### Current suggestion intelligence

Suggestions can come from several signals:

- notes that repeatedly link here through the same relation field
- schema-defined relation fields targeting the current note type
- the current note's own outgoing relations pointing to shared hubs
- patterns from similar notes already in the vault
- an explanation when nothing qualifies yet — silence is never mysterious

Examples:

- several `mission` notes link here through `commander`
- a `contact` schema and a `meeting` schema both define `account` as a relation to the current note type
- multiple note types link here through the same field, making a wildcard incoming view useful

Suggestions are designed to be useful across many vault styles: CRM, fiction and worldbuilding, programming and project tracking, research.

### Direction

Yamlink learns from your vault rather than enforcing a fixed structure. The same shared model powers completion, suggestions, hover, and Note Report — guidance stays consistent no matter which surface you're working from.

---

## Schemas and Templates

### Schemas

Yamlink supports `type: schema` notes.

A schema note defines the field shape for a target type:

```yaml
---
id: schema-contact
type: schema
target: contact
fields:
  name:
    type: string
    required: true
  account:
    type: relation
    required: true
    target: account
  status:
    type: string
  owner:
    type: relation
    target: person
---
```

Current schema behavior includes:

- required field enforcement with diagnostics
- relation target definition for completion and diagnostics
- duplicate schema detection
- malformed schema diagnostics
- schema-aware field completion
- **schema-driven note creation** — `yamlink.newNoteFromSchema` generates a structured note directly from the schema's field definitions (no template file required). Required fields come first; `relation`-typed fields get `[[]]` as a placeholder; string/number fields start empty.

### Note creation priority chain

When creating a new note with `yamlink.createNote` or `yamlink.newNoteFromSchema`, Yamlink uses the first applicable source:

1. **Template** — `_templates/<type>.md` exists → use it
2. **Schema** — a `type: schema` note exists for the chosen type → generate frontmatter from schema fields
3. **Vault inference** — no template or schema → infer likely fields from observed vault patterns
4. **Bare stub** — no signal → `id:` + `created:` only

### Templates

Yamlink supports `_templates/`-based note creation workflows.

Current template support includes:

- create node from template via `yamlink.newNodeFromTemplate`
- type-matched template at creation time — `yamlink.createNote` checks `_templates/<type>.md` automatically
- sample/template-aware note generation
- **`date:` auto-fill** — if the template has an empty `date:` field, Yamlink fills it with today's date at creation time (same behavior as `created:`)

### Schemas vs. templates

Use templates when the **body layout** matters — they carry prose structure, section headers, and arbitrary Markdown content that schemas cannot express.

Use schemas when **field correctness** matters — they enforce required fields, relation targets, and generate frontmatter programmatically via `yamlink.newNoteFromSchema`.

Templates and schemas are complementary. If both exist for a type, the template always wins (priority chain above).

---

## Export

### Current export support

- CSV from live views
- JSON from live views
- PDF from live views
- PDF from active notes through `Yamlink: Export Active Note to PDF`

### Active note PDF export includes

- summary/frontmatter
- note body
- embedded `!view` results

This makes Yamlink useful for reporting, CRM-style summaries, handoff documents, and clean exports of structured Markdown without leaving VS Code.

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

### North star

Yamlink should aim to be the best structured Markdown extension for VS Code:

- powerful for note-takers who want systems, not just pages
- powerful for coders who want structure without leaving the editor
- writer- and researcher-friendly without becoming a separate app shell

That means Yamlink should win through:

- editor-native workflows
- local-first structured Markdown
- trust, safety, and integrity
- intelligent guidance without forcing users into one ontology
- fast, practical utility in daily note and coding workflows

### Yamlink should own

- local-first structured Markdown workflows
- graph identity and safety
- live query tables
- side-panel operational context
- export/reporting
- practical tasks/calendar support
- adaptive intelligence across notes, links, fields, and queries
- strong hover, codelens, completion, diagnostics, and quick-fix UX
- template and system bootstrapping for real vaults
- developer-native knowledge workflows inside VS Code
- support for writing and longform workflows without taking over the editor UI

### Atomix should own

- the deeper workspace shell
- heavier block-native workflows
- the more ambitious operating-system layer
- the richer hybrid editor experience
- the more advanced visual query-builder experience
- assistant/chat surfaces and deeper command-center concepts
- broader workspace-level orchestration beyond the extension model

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

### Visual polish direction

Active visual polish includes:

- tighter Calendar and Note Report polish
- a more refined Graph visual finish
- investigation into what Yamlink can realistically improve around note live preview without overreaching past VS Code's own preview surface
- Monaco-adjacent UX improvements where Yamlink actually controls the experience:
  - completion detail text
  - codelens / lightbulb / inline affordances

The important boundary is that Yamlink should improve the editor experience around Monaco, not pretend it can fully retheme VS Code's editor chrome.
