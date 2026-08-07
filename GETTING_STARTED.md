# Getting Started With Yamlink

Yamlink turns a folder of Markdown files into a structured, local-first knowledge system inside VS Code. Your files stay plain `.md` — no database, no sync, no lock-in.

This guide gets you from zero to a working vault, then covers queries, graph, CLI, and Conduit.

---

## 1. Install and open a workspace

1. Install **Yamlink** from the VS Code marketplace.
2. Open a folder that contains Markdown notes — or an empty folder, and don't worry about having real notes yet (see the sample vault below).
3. Open the command palette and confirm these core commands exist:
   - `Yamlink: Open Note Report`
   - `Yamlink: Open Calendar`
   - `Yamlink: Open Vault Health`
   - `Yamlink: Open Graph Workspace`
4. Run `Yamlink: Start Guided Tour` for an interactive walkthrough covering Home, Calendar, Vault Health, Graph, and Task Center — this doc covers the same ground in more depth. Worth doing first if you'd rather click through a live tour than read.

### No notes yet? Add the sample vault

Run `Yamlink: Add Sample Vault` from the Command Palette at any time — it copies a real, populated sample vault (characters, missions, tasks, relations, the works) into your current workspace, so every feature in this guide has real data to try against immediately instead of an empty folder. Safe to run on a workspace that already has notes too — it only adds files, never touches anything of yours.

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

Hover any `[[wikilink]]` to see the target note's `type` and `status` as colored badges, plus clickable links for its own relations and body mentions.

---

## 3. Query your vault

### The `!view` block

A `!view` block inside any note becomes a live, **editable** table — not a read-only report:

```text
!view character
select name, unit, created
sort name
```

Run the view (`Yamlink: Run Active Views`) and a live table opens beside the note. Double-click any cell to edit it directly — the change writes straight back into that note's real frontmatter, no separate save step. Text, relations (with real validation against your vault's ids), booleans, dropdowns, numbers, and dates all edit in place; `Tab`/`Shift+Tab` move between editable cells, and you can paste a whole block of spreadsheet data across multiple cells at once. Every edit is undoable.

The same result set can also be viewed as a **matrix** (pick any type for the columns, ● marks a connected pair), a **bar chart**, or a **scatter plot** — a toolbar toggle in the table itself, not something you write in the query. The layout choice is remembered per query. Bar charts and scatter plots will only work if your notes' connections and structure allows it.

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
- **Type filter chips** — click a type chip to toggle it in/out of the filter; click more than one to show several types together, not just isolate a single one
- **Node inspector** — click a node to see relations, type, and key fields in the sidebar panel
- **Keyboard traversal** — Tab/arrow keys cycle nodes when you need keyboard-only navigation

Navigation controls:

- scroll wheel: zoom
- click + drag background: pan
- click node: select it, show it in the inspector, **and open the note in the editor**
- double-click node: zoom the camera in on that node (doesn't open anything)
- select a node, then press `Enter`: open its note — same as clicking, useful after arrow-key/Tab navigation
- right-click a node: context menu with an explicit **Open** action

**Watch your vault grow** — click the **Time-lapse** button to play back how the graph formed over time, one historical checkpoint at a time. Reconstructed from real git history when your vault is a git repo (this also catches body-text mentions, not just frontmatter relations); falls back to the mutation log otherwise. The layout stays fixed the whole time — playback only reveals and hides nodes/edges over it, so nothing jumps around while you watch.

### Sidebar graph

The **Yamlink Graph** sidebar panel opens showing your **whole vault** by default — the same physics layout as the Workspace graph, just docked in the sidebar instead of a full panel. Switch its scope to **Neighborhood** (or Local/Domain) to narrow it down to just the currently active note's own connections instead of the full vault. Press the recenter button (◎) to snap back to whatever note you have open.

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

Two body elements worth writing on purpose, since Yamlink treats them as real structure, not just text:

- **Blockquotes** — a plain `> some text` line. Yamlink gives it a stable block ID (`q1-a3f9c2`) automatically, so it's referenceable and linkable like a heading or a task (see the table below).
- **Callouts** — `> [!INFO] optional title`, `> [!TIP] ...`, `> [!WARNING] ...`, plus `> [!QUOTE]`, `> [!SOURCE]`, `> [!EVIDENCE]`, `> [!REFERENCE]`, `> [!NOTE]`, and `> [!DANGER]`. These render with type-specific styling and feed real signals into note-role inference and the Note Report — a `SOURCE`/`EVIDENCE`/`REFERENCE` callout nudges a note toward being read as source material, `QUOTE` toward a quoted excerpt, `WARNING`/`DANGER` toward a caution note. Not decoration — Yamlink reads what type you chose.

Footnotes (`[^name]: the definition` at the bottom of a note, referenced inline as `[^name]`) get the same treatment: a stable `fn-{name}` block ID, referenceable and linkable.

Three distinct reference levels:

| Syntax | What it does |
|---|---|
| `[[johnny-rico]]` | links the whole note |
| `[[johnny-rico#After Klendathu]]` | links a specific heading |
| `[[johnny-rico^block-id]]` | links a specific task, quote, or footnote |

Right-click anywhere in a Markdown note (or open the Command Palette) to reach all of these under **Yamlink** — grouped into four sections in the order they appear:

**Note actions** — work on the whole note, not a specific reference:

| Command | What it does |
|---|---|
| `Yamlink: Copy Note ID` | copies `[[note-id]]` for the whole active note — the fastest way to link back to it from anywhere |
| `Yamlink: Extract Selection to New Note` | select some text first — it becomes the seed/title for a brand-new note (goes through the normal Template → Schema → vault-inference flow), and the original selection is replaced with a plain `[[new-id]]` link |
| `Yamlink: Split Note Body` | select some text first — it's moved verbatim into a new note's body (with `source: [[original-note]]` auto-set), and the original selection is replaced with an embed `![[new-id]]` so it still renders inline. Use this over "Extract Selection" when you want the moved content to keep showing in place, not just link to it |

Smart Paste also helps when content starts outside Yamlink. Paste a clear spreadsheet-style table, Markdown table, JSON object, or bulleted/numbered list into a Markdown note and Yamlink asks whether to keep plain text or convert it into structured Yamlink content: a `!view` scaffold, new notes with frontmatter, a frontmatter block, or real task lines.

**Copy a reference** — puts the reference on your clipboard to paste wherever you need it:

| Command | What it does |
|---|---|
| `Yamlink: Copy Scoped Reference` | pick *any* heading, task, quote, or footnote from the active note — the general-purpose picker, figures out the right reference format for whatever you choose |
| `Yamlink: Copy Section Reference` | pick from headings only |
| `Yamlink: Copy Block Reference` | pick from tasks, quotes, footnotes only (no headings) |

**Insert a reference** — same three pickers, but insert directly into the editor at your cursor instead of the clipboard: `Yamlink: Insert Scoped Reference`, `Yamlink: Insert Section Reference`, `Yamlink: Insert Block Reference`.

**Export** — `Yamlink: Export Active Note to PDF` renders the active note (frontmatter, body, callouts, tasks) to a PDF file.

Go-to-definition works on every section/block reference: the editor lands on the exact heading or block line.

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

Open `Yamlink: Open Vault Health` for a vault-wide structural audit — a health checkup for the whole vault, not just one note. It's organized into tabs, each answering a different question. Hover the small **?** next to any section title in the panel itself for a one-line reminder of what it means; here's the fuller picture.

- **Activity** — what happened today: notes created, fields added, relations formed, plus a "session memory" recap that groups your recent edits into plain-language sentences ("Added 3 fields to `mission-briefing`, then linked it to 2 contacts"). If you touch 3+ notes the same way within a minute, you'll also see a workflow-burst callout — a sign you just did a batch edit or import.
- **Lifecycle** — every note gets bucketed into where it is in its life: **Draft** (barely started), **Growing** (taking shape but not done), **Established** (looks complete and typical for its type), **Hub** (a lot of other notes link to it), or **Stale** (hasn't been touched in a while and may need a look). This isn't a judgment — a Draft note isn't "bad," it's just new.
- **Consistency** — compares each note against others of the same `type:` and flags ones that look structurally unusual, most often because they're missing a field that similar notes almost always have. Needs at least 3 notes of a type before it has enough to compare against.
- **Schema** — if you've defined any `type: schema` notes, this shows how many matching notes actually have every field the schema expects, plus which note types don't have a schema yet. This is also where Emerging Patterns lives (see below).
- **Intelligence** — a status readout of Yamlink's own suggestion engine: how much real vault data it has to learn from right now, and how confident it currently is in lifecycle/drift/missing-field predictions. It gets sharper the more you use the vault and accept its suggestions — this tab is where you can watch that happen. Also shows **Most-Reinforced Connections**: the links in your vault with the strongest evidence behind them, either because more than one field points at the same note, or because you've set that same relationship more than once over time.
- **Projections** (once there's enough history) — where your vault is likely headed over the next 90 days: growth pace, stale-note pressure, and structural direction, all extrapolated from your own vault's real trend, not a generic guess.
- **Templates** (if you use `_templates/`) — notes created from a template that are missing one or more fields the template defines.
- **Types** — every note category in your vault and how many notes use it, one click away from a full list.
- **Orphans** (if any exist) — notes with no incoming or outgoing links at all. Not necessarily wrong, but usually worth a look — either they should be connected to something, or they're safe to ignore.

#### Emerging Patterns — the vault writes its own schema

You never have to declare a schema before you start writing. If you create enough notes that happen to share the same fields — say, 15 notes that all ended up with `id`, `type`, `status`, `owner`, and `due_date` even though nobody ever defined a `mission` type — Yamlink notices. That's what the **Emerging Patterns** section is: clusters of notes sharing an identical field shape, ranked by confidence (low: 4–6 matching notes, medium: 7–12, high: 13+).

When a cluster reaches medium or high confidence, a **"Create schema from cluster →"** button appears. The same flow is also reachable from the Command Palette as **Yamlink: Propose Schema from Cluster**, which works even without opening Vault Health — it lists any detected clusters in a picker, or lets you name a type manually if none exist yet.

Choosing a cluster does two things:

1. **Creates a real schema note** (`schema-<type>.md`) capturing the field pattern you've actually been using — not a guess, the fields your own notes already share.
2. **Offers to back-fill those fields onto the notes that inspired it.** If some cluster members are missing one or two of the newly-formalized fields, you'll get a prompt — *"Also add the '`<type>`' schema's fields to the N notes that inspired it?"* — before anything is written. Nothing happens without that confirmation; declining leaves every note untouched.

This is the full loop: the vault teaches the system through how you actually write, and once a pattern is real enough to trust, one command turns it into a durable, reusable schema — and closes the loop by making sure the notes that earned that schema actually have it.

### Note Outline

Expand **Note Outline** in the Yamlink sidebar when working in a long note.

- heading hierarchy with task count, mention count, word count per section
- current-section tracking as you scroll
- search and filter for large notes
- `Ctrl+Alt+↑/↓` to jump to sibling sections

### Task Center

Expand **Tasks** in the Yamlink sidebar for every task in the vault in one place, not just a per-note preview.

- grouped into Overdue / Today / Upcoming / Undated / Done, with no cap on how many show per bucket
- native checkboxes mark a task done or open right from the sidebar — the file's `- [ ]`/`- [x]` line updates immediately
- clicking a task jumps straight to its exact line
- write `#urgent`, `#medium`, or `#low` in a task line for a real priority signal — a colored dot on the task, sorted to the top of its bucket, and an escalated notification when an urgent task goes overdue

### Home

Open `Yamlink: Open Home` for your vault's activity stream and pulse.

- Vault Pulse: live note, edge, and type counts
- Continue Working: recently touched notes
- Recent Activity: timestamped mutation event feed
- Nudge cards: broken links, untyped notes
- Projections tab: the same Growth/Stale/Structure forecasting Vault Health shows, at full width — where the vault's trend is headed over the next 90 days, based on its own real history

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
yamlink template save johnny-rico               # save a note as a blank-skeleton template (--force to overwrite)
yamlink glossary --type faction,location        # live alphabetized glossary of these note types
```

**Everyday inspection:**

```bash
yamlink ls                          # every note, real aligned table by default
yamlink grep "quarterly"            # full-text search across note bodies
yamlink find --type contact         # filter by type/field
yamlink ls --quiet                  # revert to plain tab-separated output for shell pipelines
```

**Time travel:**

```bash
yamlink cat johnny-rico --at 2026-01-01     # reconstructed frontmatter as of that date
yamlink story --since 2026-01-01            # vault growth story: then vs. now, fastest-growing types
yamlink restore 2026-01-01                  # preview what the vault looked like then (writes nothing by default)
yamlink restore 2026-01-01 --output ./export  # export reconstructed notes as real .md files into a separate folder
yamlink snapshot                            # capture a checkpoint now, for restoring further back later (see below)
```

`--at` is also supported on `report`, `links`, and `graph`. `restore` never writes into the live vault — only a separate output directory you choose.

**How `restore` actually works — read this before relying on it:** `restore <date>` reconstructs the vault by undoing recorded changes backward from right now, using the mutation log (`.yamlink/mutation-log.ndjson`). **This works for any recent-enough date with no snapshot required at all.** A snapshot only matters for a date *older* than the mutation log can reach on its own — the log caps at 10,000 events, and once older history is pruned past that cap, restoring that far back would normally be impossible unless a snapshot exists at or before it. `restore` automatically checks any stored snapshots and uses one if it helps — you never manually pick which snapshot to use, and you don't need to run `yamlink snapshot` before every `restore`. Run `yamlink snapshot` when you specifically want to guarantee you can restore back to *today* at some point far in the future (e.g. before a big reorganization), not as a routine step before every restore.

**Automation:**

```bash
yamlink on field_changed -- ./scripts/sync.sh  # run a script on every mutation event
yamlink completions bash >> ~/.bashrc           # enable shell tab completions
```

**New vault:**

```bash
yamlink init ~/Documents/MyVault               # scaffold .yamlink/, _templates/, welcome.md
```

**All 41 commands** support `--json`, `--dry-run`, and `--vault <path>`. Run `yamlink --help` for the full command list, or `yamlink <command> --help` for any command's flags.

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

### 10 screens

Press a number key to switch screens:

| Key | Screen | What it does |
|---|---|---|
| `1` | Briefing | Session delta, vault pulse, overdue tasks, arc predictions |
| `2` | Query | Type a `!view` query and see live results |
| `3` | Navigator | Keyboard-first note browser |
| `4` | Explorer | Full note management: browse, read, edit, create, link |
| `5` | Health | Live vault health with emerging patterns |
| `6` | Search | Full-text and frontmatter search |
| `7` | Graph | Vault graph visualization in the terminal — press `v` to toggle a live spatial "constellation" layout: the focused note centered with labeled, type-colored connection lanes, updating live as relations change |
| `8` | Diff | Compare two notes field by field |
| `9` | Radar | Unlinked references and orphan detection |
| `0` | Trends | Growth, stale, and structure projections from the Time Engine |

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

Press `?` inside Conduit at any time for the full in-app key-binding reference.

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
*.tmp.md
logs*/
```

Plain names and folders match exactly; `*`, `**`, and `?` also work as wildcards — see [FEATURES.md](./FEATURES.md#yamlinkignore) for the full pattern reference. Yamlink excludes those files and folders from indexing, graphing, health analysis, and all intelligence surfaces.

**Multiple folders open at once (a multi-root workspace)?** `.yamlinkignore` only governs the one folder it's placed in — it does not reach into other folders in the same workspace. To exclude an entire second folder (a sample vault you added alongside your real notes, for example), give that folder its own `.yamlinkignore` with a single `*` line.

---

## 12. Publish your vault as a website

**0.7.7** `yamlink publish` turns your vault into a static, structured content payload a real site generator (Astro, Next.js, Eleventy — anything that reads JSON) can build a website from. Your notes stay the source of truth; this is a read-only projection of them, not a second content model to maintain.

### Run your first build

From inside your vault:

```bash
yamlink publish --out ./site-content
```

Against the sample vault, this looks like:

```
Published 25 note(s) to ./site-content
  written: 25, unchanged: 0, removed: 0
```

Look at what it wrote:

```
site-content/
  manifest.json              # every published note's id, slug, type, title, order
  notes/mission/mission-klendathu.json
  notes/character/johnny-rico.json
  ...
  search-index.json          # id/slug/type/title/excerpt for every note
```

Open one of the per-note files — `[[wikilinks]]` in both frontmatter and body text are already resolved to relative site paths (`[[johnny-rico]]` becomes `[johnny-rico](/johnny-rico)`), and any `!view` block in the body has been resolved to a plain Markdown table snapshot, since the destination site has no Yamlink query engine of its own to run it live.

### Keep some notes out of the build

Add `status: draft` to a note's frontmatter and rebuild — it's excluded automatically:

```yaml
---
id: unfinished-post
type: article
status: draft
---
```

```bash
yamlink publish --out ./site-content              # excludes draft notes
yamlink publish --out ./site-content --mode preview # includes them, for your own preview
```

Nothing else changes — `!view`, completions, hover, and diagnostics never look at `status:`. It only matters at publish time.

### Control the order of a sequence

For chapters, changelog entries, or anything with a fixed narrative order, add a numeric `order:` field:

```yaml
---
id: chapter-3
type: chapter
order: 3
---
```

`manifest.json`'s note list sorts by it automatically; notes without an `order:` trail after every ordered note.

### Rename a note without breaking old links

Declare where a note used to live before you renamed it:

```yaml
---
id: new-post-name
previous_ids: old-post-name
---
```

The next build writes `redirects.json` mapping `old-post-name` → `new-post-name`, so your site generator can serve a real redirect instead of a 404.

### Check the build's own warnings

Every build reports (without failing) anything a published site shouldn't silently ship — a link to a note that's still a draft, or a link that doesn't resolve at all:

```
4 pre-publish warning(s):
    welcome → a-note-that-doesnt-exist (broken-link)
```

A tutorial note's fenced-code example showing `[[wikilink]]` syntax is never flagged — only real references outside a code block are checked.

### Generate a sitemap, feed, and trigger a redeploy

```bash
yamlink publish --out ./site-content --site-url https://example.com --webhook https://example.com/deploy
```

`--site-url` adds `sitemap.xml` and an RSS `feed.xml` (from notes with a `date`/`created`/`published_at` field) to the output. `--webhook` POSTs a small JSON payload to that URL once the build succeeds — a good place to trigger your host's own redeploy.

### Rebuilding is cheap

Only the notes whose actual content changed since the last build get rewritten — everything else is left alone. Safe to run `yamlink publish` in a loop, a pre-commit hook, or CI without worrying about redundant writes, and it correctly picks up real changes (edits, new/removed notes, a `.yamlinkignore` change) every time, even across separate runs. `--force` rewrites every note regardless of whether its content changed, if you ever want a guaranteed full rebuild.

---

## 13. Where to go next

- [README.md](./README.md) — full product surface overview
- [FEATURES.md](./FEATURES.md) — complete feature reference across every surface
- [CONTRACT.md](./CONTRACT.md) — the local HTTP API's full method/path/params/error-code reference
- `yamlink --help` / `yamlink <command> --help` — full CLI reference, in the terminal
- `?` inside Conduit — full in-app key-binding reference

Explore Note Report, Calendar, Graph, and Vault Health on your real notes as early as possible. The intelligence layer learns from your vault — it gets more useful the more notes it has to work with.
