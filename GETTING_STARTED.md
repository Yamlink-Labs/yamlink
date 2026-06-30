# Getting Started With Yamlink

Yamlink turns a folder of Markdown files into a structured, local-first knowledge system inside VS Code. Your files stay plain `.md` — no database, no sync, no lock-in.

This guide gets you from zero to a working vault, then covers queries, graph, CLI, and Conduit.

---

## 1. Install and open a workspace

1. Install **Yamlink** from the VS Code marketplace.
2. Open a folder that contains Markdown notes, or open an empty folder and let Yamlink scaffold the sample vault on first activation.
3. Open the command palette and confirm these core commands exist:
   - `Yamlink: Open Note Report`
   - `Yamlink: Open Calendar`
   - `Yamlink: Open Vault Health`
   - `Yamlink: Open Graph Workspace`

---

## 2. Create your first note

Add frontmatter to one note:

```yaml
---
id: johnny-rico
type: character
name: Johnny Rico
unit: [[roughnecks]]
created: 2297-01-15
---
```

Three things matter here:

- `id:` is the stable identity Yamlink uses for renames, graph edges, and queries. Names change; IDs don't.
- `type:` tells Yamlink what family this note belongs to. Powers completions, Note Report, Vault Health, and query filters.
- `[[roughnecks]]` is a real relation, not just text. Yamlink indexes it as a directed graph edge immediately.

---

## 3. Query your vault

### The `!view` block

A `!view` block inside any note becomes a live interactive table:

```text
!view character
select name, unit, created
sort name
```

Run the view (`Yamlink: Run Active Views`) and a live table opens beside the note.

### Query language reference

Full syntax:

```text
!view <type>                        # query by type
select <field>, <field>, ...        # choose columns (omit for all fields)
where <field> = <value>             # exact match
where <field> contains <value>      # substring match
where <field> != <value>            # not equal
where <field> is empty              # missing or blank
where <field> exists                # has any value
where <field> #tag                  # tag shorthand
sort <field> asc|desc               # sort order (default: asc)
limit <n>                           # row cap
group by <field>                    # group results into sections
```

Date operators:

```text
where date = today()
where date > days-ago(7)
where date < days-from-now(14)
```

Date shorthand:

```text
where date = @today
where date = @thisweek
where date = @nextweek
where date = @startofmonth
```

Virtual fields (no frontmatter needed):

```text
file.created    # file system birthtime
file.modified   # file system last-modified
```

Shortcut presets that expand automatically:

```text
!view today         # notes dated today
!view upcoming      # notes dated in the next 7 days
!view calendar      # all dated notes
!view open-tasks    # incomplete task lines across the vault
!view done-tasks    # completed task lines
!view overdue       # past-due task lines
```

### Visual Query Builder

Run `Yamlink: Query Builder` to open a full builder surface:

- choose table, incoming, or task view mode
- select type, columns, filters, sort, limit, and layout
- see the generated `!view` text before writing it
- can replace an existing `!view` block if your cursor is already inside one

### Natural language queries

Run `Yamlink: Query in Plain English` and describe what you want:

```
notes about contacts updated this week
missions without a status field
everything linked to johnny-rico
```

Yamlink maps plain English to `!view` syntax using your vault's own types and fields — no hardcoded domain knowledge.

---

## 4. Explore the graph

### Workspace graph

Run `Yamlink: Open Graph Workspace` for the full vault view.

What you get:

- **Physics layout** — nodes organize by type cluster automatically; clusters settle and stop moving
- **Type filter chips** — click any type chip to isolate that cluster
- **Node inspector** — click a node to see relations, type, and key fields in the sidebar panel
- **Keyboard traversal** — Tab/arrow keys cycle nodes when you need keyboard-only navigation

Navigation controls:

- scroll wheel: zoom
- click + drag background: pan
- click node: open inspector
- double-click node: open the linked note

### Sidebar graph

The **Yamlink Graph** sidebar panel shows the local neighborhood of the currently active note. It updates automatically as you move between notes — no commands needed. Use it for ambient awareness while you write.

### Graph keyboard traversal in Conduit

When using Conduit (the terminal UI), `]` follows the strongest outbound link from the current note, `[` follows the strongest inbound. Esc pops back.

---

## 5. Use Smart Templates

Smart Templates is the frontmatter setup flow. It draws from three sources in order:

- `_templates/<type>.md` — your explicit template file
- schema notes (`type: schema`) — `for:` target type + `fields:` list
- vault-learned field bundles — from similar notes already in the vault

The practical flow:

1. Start a note with at least `id:` and `type:`.
2. Place the cursor on the `type:` line and open the lightbulb.
3. Use the type-aware action: **"Use the character schema from Smart Templates"**.
4. Yamlink inserts the learned frontmatter shape for that note type.
5. Cursor moves to the first unresolved field.
6. Completion can reopen automatically there if the vault has strong evidence.

---

## 6. Reference notes, sections, and blocks precisely

Three distinct reference levels:

| Syntax | What it does |
|---|---|
| `[[johnny-rico]]` | links the whole note |
| `[[johnny-rico#After Klendathu]]` | links a specific heading |
| `[[johnny-rico^block-id]]` | links a specific task, quote, or footnote |

Getting the right reference without memorizing IDs:

- `Yamlink: Copy Section Reference` — pick from headings in the active note
- `Yamlink: Insert Section Reference` — insert directly into the editor
- `Yamlink: Copy Block Reference` — pick from tasks, quotes, footnotes
- `Yamlink: Insert Block Reference` — insert directly

Go-to-definition works on all three: the editor lands on the exact heading or block line.

---

## 7. Learn the core surfaces

### Note Report

Open `Yamlink: Open Note Report` on any note.

- **Overview** — frontmatter, lifecycle state, structural signals, arc-predicted missing fields
- **Links** — incoming and outgoing relations, body links, unlinked references
- **Tasks** — tasks inside the note and tasks elsewhere that mention it
- **Views** — likely next query suggestions for the current note type
- **History** — mutation event log (field changes, links added/removed, note creation)

### Calendar

Open `Yamlink: Open Calendar` for date-driven vault activity.

- task due dates from `- [ ]` lines
- note `date:` fields
- note creation activity
- month, week, and day views

### Vault Health

Open `Yamlink: Open Vault Health` for a vault-wide structural audit.

- broken links and duplicate IDs
- lifecycle distribution across the vault
- drift and consistency signals
- schema coverage and conformance
- Vault Projections: 90-day Growth, Stale Pressure, and Structure Direction forecast
- Emerging Patterns: clusters of notes that share identical field signatures, with schema creation shortcuts

### Note Outline

Expand **Note Outline** in the Yamlink sidebar when working in a long note.

- heading hierarchy with task count, mention count, word count per section
- current-section tracking as you scroll
- search and filter for large notes
- `Ctrl+Alt+↑/↓` to jump to sibling sections

### Home

Open `Yamlink: Open Home` for your vault's activity stream and pulse.

- Vault Pulse: live note, edge, and type counts
- Continue Working: recently touched notes
- Recent Activity: timestamped mutation event feed
- Nudge cards: broken links, untyped notes

### Live Note

Open `Yamlink: Open Live Note` for a rendered sidecar beside the active note.

- live preview of frontmatter, headings, and `!view` results
- click any line to jump back to the exact source line
- stays synced as you type

---

## 8. Get started with the CLI

`yamlink` is a full headless vault interface. Install it from the project folder:

```bash
npm install -g .
# or
npm link
```

**First commands:**

```bash
yamlink health                      # vault-wide health report in the terminal
yamlink query "select name, type sort name"   # run a query and see a table
yamlink briefing                    # morning summary: pulse, tasks, recent mutations
yamlink links --broken              # list all broken wikilinks
```

**Write path:**

```bash
yamlink set johnny-rico status active           # write a frontmatter field
yamlink set johnny-rico status active --dry-run # preview without writing
yamlink link johnny-rico unit roughnecks        # set a relation field
yamlink rename johnny-rico rico                 # vault-wide ID rename
```

**Automation:**

```bash
yamlink on field_changed -- ./scripts/sync.sh  # run a script on every mutation event
yamlink completions bash >> ~/.bashrc           # enable shell tab completions
```

**New vault:**

```bash
yamlink init ~/Documents/MyVault               # scaffold .yamlink/, _templates/, welcome.md
```

**All 24 commands** with `--json`, `--dry-run`, and `--vault <path>` support. Full reference: [docs/cli/README-CLI.md](./docs/cli/README-CLI.md)

---

## 9. Get started with Conduit

Conduit is Yamlink's full terminal UI. No browser, no VS Code required.

### Start it

```bash
yamlink                             # auto-starts the server and opens Conduit (simplest)

# or start separately:
yamlink serve                       # start the API server (port 7420 by default)
yamlink conduit                     # open Conduit in a new terminal
```

### 9 screens

Press a number key to switch screens:

| Key | Screen | What it does |
|---|---|---|
| `1` | Briefing | Session delta, vault pulse, overdue tasks, arc predictions |
| `2` | Query | Type a `!view` query and see live results |
| `3` | Navigator | Keyboard-first note browser |
| `4` | Explorer | Full note management: browse, read, edit, create, link |
| `5` | Health | Live vault health with emerging patterns |
| `6` | Search | Full-text and frontmatter search |
| `7` | Graph | Vault graph visualization in the terminal |
| `8` | Diff | Compare two notes field by field |
| `9` | Radar | Unlinked references and orphan detection |

### Key operations in Explorer

Once you're in Explorer (`4`):

| Key | Action |
|---|---|
| `v` | Open NoteView — full Markdown reading with ANSI styling |
| `e` | Edit a frontmatter field |
| `o` | Open note body in `$EDITOR` |
| `n` | Create a new note |
| `l` | Build a wikilink to another note |
| `D` | Delete note |
| `c` | Quick Capture — 3-step form (id → type → fields) |
| `p` | Peek overlay — full detail without leaving the list |
| `H` | Note history — mutation timeline for selected note |
| `]` | Follow the strongest outbound link |
| `[` | Follow the strongest inbound link |
| Space | Multi-select for bulk operations |
| `S` / `R` | Save / restore Explorer context |

### Split view

Press `|` to split Conduit into two independent panes. Both share one live vault connection.

- `Tab` cycles focus between panes (active pane shows a lit border)
- `q` closes the secondary pane
- Status bar shows `◉ left | ○ right`

### For Obsidian users — Conduit works on your vault right now

You don't need to migrate anything. Obsidian vaults are plain folders of `.md` files with YAML frontmatter — exactly what Yamlink reads.

```bash
yamlink serve --vault ~/Documents/ObsidianVault
yamlink conduit
```

What Yamlink picks up from your Obsidian notes immediately:

- Any note with frontmatter fields — indexed and queryable by type, status, date, etc.
- Wikilinks (`[[note-name]]`) — treated as graph edges
- Tags (`#tag`) — recognized in queries
- Task lines (`- [ ]` / `- [x]`) — surfaced in Calendar and Briefing

What Yamlink ignores (no errors, just skipped):

- `.obsidian/` config folder
- Canvas files (`.canvas`)
- Dataview inline queries — treated as plain text
- `[[note|alias]]` links — the target is indexed, the alias is preserved

**First session with an Obsidian vault:**

1. `yamlink serve --vault ~/Documents/ObsidianVault`
2. `yamlink conduit` — Briefing shows your vault pulse
3. Press `5` for Vault Health — see broken links (links to notes that don't exist yet)
4. Press `4` for Explorer — browse your notes by type
5. Notes without `type:` are fine — intelligence grows as you add types over time

The one thing to know: Yamlink uses `id:` for graph edges and rename propagation. Obsidian uses filenames. When you're ready to unlock full rename propagation and completions, use `Yamlink: Import Obsidian Vault` (section 10 below) to add `id:` fields — or add them manually as you go. Neither is required to start using Conduit.

Full Conduit reference: [docs/tui/README-TUI.md](./docs/tui/README-TUI.md)

---

## 10. Import an existing vault

### From Obsidian

Run `Yamlink: Import Obsidian Vault`.

What happens:

1. Yamlink scans the selected Obsidian vault and shows you what it found.
2. You choose whether to copy the vault into the current workspace or add it as a workspace folder.
3. Yamlink ignores `.obsidian/` and other system directories automatically.
4. Yamlink analyzes the imported structure and offers follow-up cleanup actions.

Follow-up actions available after import:

- open the import report
- open Vault Health
- preview filename-to-`id:` migration
- apply safe missing `id:` fields
- rewrite filename-style wikilinks to canonical Yamlink IDs
- run the combined cleanup pass

### From Notion

Run `Yamlink: Import Vault Export` → **Notion**.

Export from Notion: a Markdown export folder.

What Yamlink does:

- inspects the export before import so you can confirm what Yamlink found
- stamps imported notes with `id:`, `title:`, `imported_from: notion`, `parent:`
- rewrites local Markdown note links into Yamlink `[[wikilinks]]`
- expands CSV databases into Yamlink row notes under `_notion_databases/`

### From Roam Research

Run `Yamlink: Import Vault Export` → **Roam Research**.

Export from Roam: a JSON page export.

What Yamlink does:

- creates Markdown notes for Roam pages with `id:`, `title:`, `imported_from: roam`, `roam_uid:`
- preserves nested bullet structure
- converts `{{[[TODO]]}}` and `{{[[DONE]]}}` into Yamlink task syntax
- detects date-titled pages and imports them as journal notes with `date:`

### From Evernote

Run `Yamlink: Import Vault Export` → **Evernote**.

Export from Evernote: an `.enex` file.

What Yamlink does:

- stamps notes with Yamlink frontmatter
- preserves author, source, tags, and created/updated metadata
- converts Evernote note links into Yamlink `[[wikilinks]]`
- extracts attachments into `_attachments/<note-id>/`

### First checks after any import

1. Open **Vault Health** to inspect structural issues.
2. Open a few representative notes in **Note Report**.
3. Run one simple `!view` query to verify types and relations are landing correctly.
4. If the source system was filename-driven, use the importer follow-up actions to normalize IDs and links.

---

## 11. Ignore notes Yamlink should not index

Add a `.yamlinkignore` file at the vault root. Changes take effect immediately — no restart needed.

```text
scratch.md
archive/
meeting-dump-2024.md
```

Yamlink excludes those files and folders from indexing, graphing, health analysis, and all intelligence surfaces.

---

## 12. Where to go next

- [README.md](./README.md) — full product surface overview
- [docs/cli/README-CLI.md](./docs/cli/README-CLI.md) — complete CLI reference (24 commands)
- [docs/tui/README-TUI.md](./docs/tui/README-TUI.md) — full Conduit reference with key binding tables
- [docs/api/README-API.md](./docs/api/README-API.md) — local HTTP API reference (21 endpoints)

Explore Note Report, Calendar, Graph, and Vault Health on your real notes as early as possible. The intelligence layer learns from your vault — it gets more useful the more notes it has to work with.
