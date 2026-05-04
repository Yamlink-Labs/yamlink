# Yamlink

Structured knowledge for Markdown, inside VS Code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yamlink.yamlink?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
![Version](https://img.shields.io/badge/version-0.4.0--Carmen-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blueviolet)

Yamlink turns a folder of Markdown files into a local-first knowledge system:

- notes get stable `id:`
- `[[wikilinks]]` become graph relationships
- YAML frontmatter becomes structured data
- `!view` blocks become live, editable tables
- side panels turn the vault into an operational workspace

Yamlink is built for people who want their notes to stay plain-text, Git-friendly, queryable, and local.

If you want the practical start, use [GETTING_STARTED.md](./GETTING_STARTED.md).

If Yamlink is useful to you, please star the repo on [GitHub](https://github.com/javierigaciorm/yamlink)  and leave a review on the VS Code Marketplace. All input helps moving forward.

---

## New in Carmen

Carmen is the hardening and intelligence release.

It strengthens the parts of Yamlink that matter most day to day:

- smarter next-step guidance across completion, hover, Note Report, and suggestions
- stronger frontmatter and body-link intelligence
- a rebuilt graph experience after the old webview path broke under a VS Code update
- broader date handling
- better writer ergonomics
- deeper codebase hardening across graph, tables, health, Note Report, and intelligence

### Adaptive intelligence

Yamlink is now built around one shared adaptive-intelligence model. It learns from:

- frontmatter structure
- body and frontmatter wikilinks
- schema relation definitions
- observed field usage across the vault
- graph patterns

That shows up in practical ways:

- likely next fields
- likely next links
- note-role inference
- same-flow guidance
- better setup hints
- simpler, more direct explanations

### Smarter suggestions and completions

Smart suggestions are no longer just repeated-backlink prompts.

Carmen pushes them further toward:

- schema-backed suggestions even before repeated backlinks exist
- mixed-type relation awareness
- current-note relation context
- smarter note analysis for better next-step suggestions

Autocomplete also got stronger:

- frontmatter relation completion no longer hides the rest of the vault
- likely targets still rise first, but broader candidates stay visible
- query `where ... = [[` completion now follows the same target-preference model
- completion text is cleaner and more direct

### Graph and link truth

Body/frontmatter wikilinks are now normalized more reliably before indexing.

That means links with:

- aliases
- block refs
- casing or spacing differences

The graph itself also changed a lot:

- local graph now follows the active note
- vault graph is now the broader view
- local depth is now shown as 1, 2, or 3 layers of linked notes
- graph controls are now simpler and easier to understand

### Dates and writing

Carmen also broadens the practical side of daily use:

- broader date usage
- better task/date interpretation
- body-only word count in the status bar
- body-only character count in the status bar

---

## What Yamlink Looks Like

### Live tables

Editable query tables are now strong enough for real operational work. You can update typed cells, paste from spreadsheets, revert rows, and export views without leaving the editor.

![Live tables](./media/readme/live-table.gif)

### Note Report and Calendar

The Yamlink sidebar now gives the vault a real operational hub. Note Report helps you understand where a note sits in the system, and Calendar lets you review dated activity across the vault.

![Note Report and Calendar](./media/readme/calendar-note-report.gif)

### Graph

The graph is now easier to read and easier to drive. It gives you a local note view, a broader vault view, type filtering, node inspection, and simpler controls.

![Graph](./media/readme/graph.gif)

---

## Why It Matters

In my daily workflow, I don't want to work separately with:

- freeform writing
- structured databases - crm functionalities
- graph relationships
- local ownership

So Yamlink tries to collapse those into one workflow inside the editor people already use.

With Yamlink, you can:

- write normal Markdown notes
- give notes stable identities with `id:`
- connect them with `[[wikilinks]]`
- query the vault with `!view`
- edit data inline in live tables
- inspect a note through Note Report
- track dated activity across the vault
- export notes and views to PDF

---

## Quick Start

### 1. Give a note an identity

```yaml
---
id: johnny-rico
type: character
name: Johnny Rico
unit: [[roughnecks]]
rank: lieutenant
created: 2297-01-15
---
```

### 2. Link notes together

```yaml
---
id: mission-klendathu
type: mission
date: 2297-08-01
commander: [[johnny-rico]]
unit: [[roughnecks]]
outcome: catastrophic-failure
---
```

### 3. Query the vault

```md
!view mission | Rico missions
where commander = [[johnny-rico]]
select date, unit, outcome
sort date desc
```

Run the view and Yamlink opens a live table beside your editor.

### 4. Open the side surfaces

Use the Yamlink sidebar to inspect:

- Note Report
- Calendar
- Vault Health

---

## Feature Highlights

### Core graph and identity

- Canonical `id:` model for Markdown notes
- Wikilinks in body text and frontmatter relations
- Backlinks and outgoing relation tracking
- Broken link diagnostics
- Duplicate ID diagnostics
- Rename propagation across the vault
- Multi-root workspace support

### Query system

- `!view` blocks inside Markdown
- Multiple query blocks in one note
- Type filters, `where`, `contains`, `sort`, `limit`
- Query labels with `| Name`
- Incoming relation queries
- Shortcut queries:
  - `!view today`
  - `!view upcoming`
  - `!view calendar`
- Guided query-builder foundation
- Smart query suggestions based on graph patterns
- Smarter note-aware query starters from the active note context

### Live tables

- Inline editable query tables
- Typed cells:
  - text
  - relation
  - boolean
  - dropdown
  - number
  - date
- Bulk spreadsheet-style paste
- Row-level revert
- Tab / Shift+Tab navigation
- Column controls and persistence
- Search, sort, and filter chips
- Export:
  - CSV
  - JSON
  - PDF

### Sidebar surfaces

- Note Report
- Vault-wide Calendar
- Vault Health
- Graph / relationship map

### Carmen intelligence

- Shared field-role intelligence core
- Note-role inference with supporting and conflicting signals
- Smarter suggestion generation from:
  - schema relations
  - mixed relation patterns
  - current-note relation context
  - repeated body-link evidence
- "Cleaner explanations" when suggestions are absent or weak
- Query-side relation completion aligned with frontmatter relation completion
- More transparent completion to easier understand likely targets and field-role reasoning

### Tasks and date activity

- Stable task block IDs
- Task extraction from Markdown task lines
- Calendar month / week / day views
- Created-note activity in calendar
- Timeline context inside Note Report
- Broader date parsing:
  - textual months
  - ordinal dates
  - month/day without a year
  - phrases like `by Friday` and `due next Tue`

### Writer ergonomics

- Bottom-bar word count for Markdown note bodies
- Bottom-bar character count for Markdown note bodies
- Frontmatter is excluded from those writing counts

### Export and sharing

- Export active note to PDF
- Export live table views to PDF
- Embed `!view` results into note PDF output

For the fuller capability reference, see [FEATURES.md](./FEATURES.md).
For setup guidance and recommended vault structures, see [GETTING_STARTED.md](./GETTING_STARTED.md).

---

## Install

Install from the VS Code Marketplace:

[Yamlink on the Marketplace](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)

Or search for `Yamlink` inside VS Code.

On first activation, Yamlink can copy a sample vault into your workspace so you can explore the model immediately.

If Yamlink is useful to you, please star the repo on [GitHub](https://github.com/javierigaciorm/yamlink) and leave a review on the VS Code Marketplace.

---

## Philosophy

Yamlink is trying to prove that structured work does not have to begin in a locked platform.

It can begin in:

- Markdown
- YAML
- Git
- VS Code

And from there, grow only when the user is ready.

---

## License

MIT
