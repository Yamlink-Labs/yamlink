# <img src="./media/icon.png" alt="Yamlink logo" width="30" valign="middle"> Yamlink

Structured knowledge for Markdown, inside VS Code.

[![CI](https://github.com/Yamlink-Labs/yamlink/actions/workflows/ci.yml/badge.svg)](https://github.com/Yamlink-Labs/yamlink/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yamlink.yamlink?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
![Version](https://img.shields.io/badge/version-0.5.0--Zim-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blueviolet)

Yamlink turns a folder of Markdown files into a local-first knowledge system:

- notes get stable `id:` identities that survive renames and moves
- `[[wikilinks]]` become graph edges
- YAML frontmatter becomes structured, queryable data
- `!view` blocks run live queries and open editable tables
- side panels give the vault an operational command structure

No database. No sync. No locked platform. The files stay plain Markdown.

If you want the practical start, see [GETTING_STARTED.md](./GETTING_STARTED.md).  
For the full query contract, see [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md).

---

## What it looks like

### Live tables

Write a `!view` block. Run it. A live table opens beside your note — editable cells, typed values, per-column filters, sort, search, export. Edits write back directly to frontmatter.

![Live tables](./media/readme/live-table.gif)

### Note Report and Calendar

Note Report shows where a note sits in the system: its connections, lifecycle state, tasks, and what views make sense next. Calendar surfaces dated activity across the vault without leaving the editor.

![Note Report and Calendar](./media/readme/calendar-note-report.gif)

### Graph

Two surfaces. The sidebar shows full vault visible at a glance — note types color-coded, hub notes rising by connection count. Graph Workspace opens a focused explorer centered on the current note, a query result, or any custom note set.

![Graph](./media/readme/graph.gif)

---

## The model

Three things. One loop.

**Identity** — every note that matters gets a stable `id:`:

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

**Relations** — frontmatter links and body wikilinks feed the same graph:

```yaml
---
id: mission-klendathu
type: mission
date: 2297-08-01
commander: [[johnny-rico]]
unit: [[roughnecks]]
casualties: high
outcome: catastrophic-failure
---
```

**Queries** — `!view` blocks inside your notes run against the live graph:

```
!view mission | Rico's missions
where commander = [[johnny-rico]]
select date, unit, outcome
sort date desc
```

Run the view. A table opens beside the note. Edit a cell. It writes back to the source file.

**The loop: write → link → query → inspect → refine.**

---

## Zim 0.5.0

Zim turns Yamlink into a fuller workspace: a rebuilt graph with both a sidebar constellation and a focused Graph Workspace, smarter frontmatter help, improved table controls and aesthetics, Note Report and Vault Health with lifecycle and type-consistency signals, and a stronger query language with `!=`, empty checks, `#tag` shorthand, cross-field `or`, date functions, and `group by`.

The full release notes are in [WHATS_NEW.md](./WHATS_NEW.md).

---

## Features

### Graph

- canonical `id:` model — stable across renames, renames propagate vault-wide
- body and frontmatter wikilinks in the same graph
- display aliases (`[[id|Label]]`) and vault aliases (`aliases:` in frontmatter)
- embeds (`![[id]]`): dimmed decoration, Ctrl+Click navigation, broken-link diagnostics
- broken link and duplicate ID diagnostics with quick-fix actions
- Graph 2.0: sidebar constellation + Graph Workspace with filters, search, isolate, and minimap

### Query

- `!view` blocks inside Markdown notes
- one-line and multi-line power-user forms, multiple blocks per note
- `where`, `contains`, `sort`, `limit`, `via`, `group by`, `| label`
- `!=`, `is empty`, `exists`, `is not empty`
- cross-field OR: `where status = active or type = contact`
- `#tag` shorthand: `where #crm and status = active`
- date functions: `today()`, `days-from-now(n)`, `days-ago(n)` and more
- incoming relation queries: `!view incoming mission via commander`
- shortcut queries: `!view today`, `!view upcoming`, `!view open-tasks`, `!view overdue`

### Tables

- editable cells: text, relation, boolean, dropdown, number, date
- bulk spreadsheet-style paste, row-level revert, undo
- per-column value filters, client-side sort, column hide/show, drag-to-reorder
- task status pills: Done, Not done, Overdue
- export: CSV, JSON, PDF

### Intelligence

- type-filtered relation completion — a `contact:` field only shows `contact` notes
- `New [type]` note creation from relation fields — creates the note, wires both sides
- schema-driven note creation (`yamlink.newNoteFromSchema`)
- note creation priority: Template → Schema → vault inference → bare stub
- vault-derived field bundle suggestions over hardcoded archetypes
- lifecycle state: `draft`, `growing`, `established`, `hub`, `stale`
- type consistency: `on track`, `slightly unusual`, `missing structure`, `very unusual`
- `@today`, `@tomorrow`, `@thisweek`, and other date shortcuts in frontmatter

### Surfaces

- **Note Report** — Overview, Links, Tasks, Views tabs; tab state persists across note switches
- **Calendar** — month, week, day views; keyboard shortcuts `M W D [ ] T`; click-through to notes
- **Vault Health** — lifecycle distribution, drift score cards, health score, broken link counts
- **Graph** — sidebar constellation and Graph Workspace

### Integrations

- PDF export for active notes and live table views
- first-pass Obsidian import (`yamlink.importObsidianVault`)
- `.yamlinkignore` — exclude files and folders from the entire Yamlink system
- public extension API: `getIndex()`, `getFieldsCache()`, `query()`, `onVaultChange()`

These are active Yamlink capabilities today. They are not all new in Zim, but they are part of the current product surface.

---

## Quick start

**1. Install Yamlink and open a workspace**

Use any normal folder of Markdown notes, or start with the sample vault Yamlink copies into the workspace on first activation.

**2. Give one note an `id:`**

Add a small frontmatter block:

```yaml
---
id: johnny-rico
type: character
name: Johnny Rico
---
```

**3. Add one real link**

In another note, point to it with frontmatter or a body wikilink:

```yaml
commander: [[johnny-rico]]
```

**4. Run one view**

```md
!view character
select name, type
sort name
```

Run the view, then open:

- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Graph Workspace`

That is the core Yamlink loop in practice:

**write → link → query → inspect → refine**

---

## Install

Search for `Yamlink` in the VS Code Extensions panel, or install from the Marketplace:

[Yamlink on the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)

On first activation, Yamlink copies a sample vault into your workspace so you can explore the model immediately. The sample files are plain Markdown — delete them whenever you want.

Coming from Obsidian? Run `Yamlink: Import Obsidian Vault` from the command palette. Yamlink either copies the vault into your current workspace or adds it as a workspace folder, skips `.obsidian/` config, rebuilds the index, and can open Vault Health so you can see the structural state of your notes immediately.

---

## Why it exists

Most tools that give you structure want you to live inside them. Yamlink makes no such demand.

The work stays in Markdown. The files stay on disk. The editor stays VS Code. Yamlink reads what you already have and makes it linkable, queryable, and operational — without a database, without a server, without a lock-in.

If the structure outgrows what Yamlink can do, the files are still just files.


---

If Yamlink is useful to you, please star the repo on [GitHub](https://github.com/Yamlink-Labs/yamlink) and leave a review on the VS Code Marketplace.

---

## License

MIT. The Yamlink name and logo are part of the Yamlink Labs brand. The MIT License grants permission to use, copy, modify, and distribute this software, but does not grant rights to use the Yamlink name or logo except to reference the software.
