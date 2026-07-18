# <img src="./media/icon.png" alt="Yamlink logo" width="30" valign="middle"> Yamlink

Wikilinks, backlinks, knowledge graph, and live query tables — all inside VS Code, all plain Markdown files.

[![CI](https://github.com/Yamlink-Labs/yamlink/actions/workflows/ci.yml/badge.svg)](https://github.com/Yamlink-Labs/yamlink/actions/workflows/ci.yml)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version/yamlink.yamlink.svg)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
[![Installs](https://vsmarketplacebadges.dev/installs/yamlink.yamlink.svg)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
[![Rating](https://vsmarketplacebadges.dev/rating/yamlink.yamlink.svg)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.120.0-blueviolet)

Yamlink turns a folder of Markdown files into a structured knowledge system inside VS Code. Notes get stable `id:` identities that survive renaming. `[[wikilinks]]` become typed graph edges. YAML frontmatter becomes queryable structured data. `!view` blocks run live queries and open editable tables — edit a cell and it writes back to the source file.

No database. No sync. No locked platform. Your files stay plain Markdown and work in any editor.

**0.7.4** adds a real **Time Engine** (reconstruct any note of the whole vault as it looked at any past moment), a vault-wide **Task Center**, a guided **first-run tour**, real **custom hover cards**, and Conduit's own live **spatial graph view** — on top of the full CLI, local API, terminal UI, and LSP server that already take Yamlink beyond the editor.

If you want the practical start, see [GETTING_STARTED.md](./GETTING_STARTED.md).  
Want a real vault to explore immediately? See [Yamlink Sandbox](https://github.com/Yamlink-Labs/yamlink-sandbox).  
For the full query language and usage, see [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md).  
New to Yamlink's terminology? See [GLOSSARY.md](./GLOSSARY.md).  
To understand the intelligence system, what the lightbulbs mean, and how Yamlink learns: see [INTELLIGENCE.md](./INTELLIGENCE.md).

---

## What it looks like

### Live tables

Write a `!view` block. Run it. A live table opens beside your note — editable cells, typed values, per-column filters, sort, search, export. Edits write back directly to frontmatter.

![Live tables](./media/readme/live-table.gif)

### Conduit

Conduit is Yamlink's keyboard-driven terminal workspace. Run `yamlink` and your vault opens in the terminal — nine screens accessible by number key: Briefing, Query, Navigator, Explorer, Health, Search, Graph, Diff, Radar. Browse notes, run live queries, capture, edit frontmatter, and read full notes without leaving the terminal. Press `|` to split into two independent panes sharing one live vault connection. The Graph screen has a live spatial view (`v` to toggle) — a note's connections rendered as a real terminal graph, colored by type with a legend, and it live-updates the moment a relation changes elsewhere in the vault.

![Conduit terminal workspace](./media/readme/conduit.gif)

### Intelligence completion

Yamlink learns your vault's structure and ranks field suggestions from what similar notes look like and which completions you've accepted before. On a relation field, type `[[` and ranked candidates appear filtered to the right type. The Note Report Overview tab shows arc-predicted missing fields — ranked by how often they appear on notes of the same type that yours is missing.

![Intelligence completion and arc prediction](./media/readme/intelligence-completion.gif)

### Note Report and Calendar

Note Report shows where a note sits in the system: its connections, lifecycle state, tasks, and what views make sense next. Calendar surfaces dated activity across the vault without leaving the editor — task due dates, note `date:` fields, and created-note activity all land there.

![Note Report and Calendar](./media/readme/calendar-note-report.gif)

### Graph

Two surfaces in the extension: the sidebar shows the full vault at a glance — note types color-coded, hub notes rising by connection count. Graph Workspace opens a focused explorer centered on the current note.

x-graph is the underlying engine: Canvas2D + D3-force, no third-party graph library. Three layers — base topology, semantic edge coloring by relation type, health rings by lifecycle/drift state. Nodes are draggable with live physics.

**Time-lapse** (both graph surfaces) plays back how the graph actually grew, with notes and connections fading in as they appear rather than the finished graph loading all at once. What it can show depends on the vault:

- **Git-tracked vaults** get the fullest picture — real historical file content at each checkpoint, so both frontmatter relations *and* body-text `[[mentions]]` reconstruct correctly, reaching as far back as the git history does.
- **Vaults with no git history** fall back to Yamlink's own mutation log, which now tracks body-text mentions going forward, not just frontmatter fields. This builds real, complete time-lapse history starting from when you're on this version — it can't retroactively recover edits made before then.

![Graph](./media/readme/graph.gif)

### Vault Health

A full-vault audit in one panel. Broken links, duplicate IDs, schema violations, orphaned notes, and lifecycle drift — all surfaced instantly, with one-click navigation to the offending note. Keep your knowledge base clean as it grows.

**Vault Projections** reconstruct your vauly history (via the **Time Engine**). Growth, Stale, and Structure each get a real 90-day forecast with a genuine fit-quality score, plus a retrospective accuracy check no cloud tool can make — "90 days ago this model projected 42 notes for today; you actually have 42, 98% accurate" — because it requires real reconstructed behavioral history, specific to your vault. A ranked "going stale soonest" list names the actual notes that need attention, not just an aggregate rate.

![Vault Health](./media/readme/vault-health.gif)

### A Yamlink note

<!-- hero screenshot: open sample/yamlink-hero.md in VS Code with Yamlink Apollo Night theme, capture the editor at ~1400px wide, replace hero.png -->

| | |
|---|---|
| **Frontmatter** | Structured YAML at the top of every note. Fields like `platform: [[vs-code]]` are typed graph edges — Yamlink indexes, completes, and renames them vault-wide. |
| **`[[wikilinks]]`** | Every link becomes a graph edge. Ctrl+Click navigates, completions rank by type, broken links surface as diagnostics. Rename a note — every link updates automatically. |
| **Block references** | Every meaningful body element has a stable block ID: `h-{slug}` for headings, `t{n}-{hash}` for tasks, `q{n}-{hash}` for blockquotes, `fn-{id}` for footnotes. Write `note#Heading` to link a section or `note^block-id` to link a specific task, quote, or footnote. Go-to-definition lands on the exact line. |
| **Callouts** | `> [!INFO]` `> [!TIP]` `> [!WARNING]` — body structure signals that feed note-role inference and the Note Report. |
| **Tasks** | `- [ ]` checkboxes extracted from the note body, tracked in the Calendar by due date, surfaced in Home, queryable with `!view open-tasks`, and browsable vault-wide in the sidebar's Task Center — grouped by Overdue/Today/Upcoming/Undated/Done with real native mark-complete checkboxes, no cap on how many show. Write `#urgent`/`#medium`/`#low` in a task line for a real priority signal — a colored dot on the task, sorted to the top of its bucket, and an escalated notification when an urgent task goes overdue. |
| **`!view` block** | A live query written inline in the note. Runs against the vault, opens an editable table beside the editor. Edit a cell — it writes back to the source Markdown file. |
| **Tags** | `#local-first #pkm` — body hashtags and frontmatter tags, both filterable in queries with `where #pkm`. |

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

**Write → link → query → inspect → refine.**

If you do not want to hand-write the query first, run `Yamlink: Query Builder`. It opens a compact visual builder panel for table views, incoming/backlink views, and task presets, while still showing you the exact generated `!view` text before it inserts or replaces anything.

The current builder flow is:

- `View` — choose the query family first
- `Shape` — set type, columns, filters, layout, sort, and optional details with progressive disclosure
- `Preview` — inspect sample rows, warnings, and the exact query before insertion

The panel is built to stay text-first rather than replace the language:

- `Recommended / All fields / Custom` column modes
- collapsible `Result layout`, `Filters`, `Sort & limit`, and `Details` sections
- icon-based layout choices for table, matrix, bar, and scatter
- sample rows rendered like the real result, not raw metadata
- a live preview status line so the panel tells you when the query is ready to insert

---

## 0.7.4 — Platform Depth

- **Time Engine** — reconstruct any note, or the whole vault's graph, as it looked at any past moment. Not a stored snapshot — a live reconstruction from the mutation log (or real git history, when available). Reaches `?at=` on the API, `--at` on `cat`/`report`/`links`/`graph`, and `yamlink story` for a plain-language growth narrative.
- **Vault Projections rebuilt on real historical reconstruction** — Growth, Stale, and Structure each get a genuine 90-day forecast fitted through real reconstructed checkpoints, plus a retrospective accuracy check ("90 days ago this model projected 42 notes for today; you actually have 42, 98% accurate") — a checkable claim no snapshot-free tool can make.
- **Task Center** — a dedicated vault-wide task view in the Yamlink sidebar, grouped into Overdue/Today/Upcoming/Undated/Done, with real native mark-complete checkboxes and `#urgent`/`#medium`/`#low` priority.
- **Guided tour** — a native VS Code walkthrough for first-run users: create a note, link it, run a query, see it as a live table, then tour the wider system.
- **Custom hover cards, for real this time** — (after months of trying) colored `type`/`status` pill badges and clickable relation/body links, entirely inside VS Code's native hover (no more competing/stacked hover widgets).
- **Conduit's Graph screen gained a live spatial view** — a note's connections rendered as a real terminal graph, colored by type with a legend and a label-visibility toggle, live-updating over SSE when a relation changes elsewhere.
- **LSP reached real parity with VS Code** — `workspace/applyEdit`, richer intelligence payloads, and the same colored hover badges, so Zed/Neovim/Helix/Emacs users get the same authoring intelligence, not a stripped-down fallback.
- **The full platform** — a 37-command CLI, a writable local API, Conduit's 9-screen terminal workspace, and a complete LSP server for non-VS Code editors.

For the full release history, see [CHANGELOG.md](./CHANGELOG.md).

---

## Features

### Graph

- canonical `id:` model — stable across renames, renames propagate vault-wide
- body and frontmatter wikilinks in the same graph
- display aliases (`[[id|Label]]`) and vault aliases (`aliases:` in frontmatter)
- embeds (`![[id]]`): dimmed decoration, Ctrl+Click navigation, broken-link diagnostics
- broken `[[links]]` decorated with amber brackets + faded amber text — readable signal, no squiggle
- broken link quick fix walks through the template workflow: pick from existing templates (type-matched floats to top) or let Yamlink scaffold a starter
- broken link and duplicate ID diagnostics with quick-fix actions
- two surfaces, both powered by **x-graph** — Yamlink's custom Canvas2D + D3-force engine, no third-party graph library: the sidebar shows a vault-wide constellation at a glance; Graph Workspace opens a focused explorer centered on the current note, with filters, search, isolate, and minimap
- three independent visual layers that stack: **Base** (nodes sized by hub score, kind-colored, hover dims non-neighbors, click pins focus, drag repositions with live physics), **Semantic** (edges colored by relation type — person/teal, event/amber, topic/purple, container/blue — direction arrowheads, dashed weak links), **Health** (rings encode lifecycle state and structural drift, with the health legend expanding inline)
- **time-lapse** — play back how the graph actually grew, reconstructed from real git history when available or the mutation log otherwise; see [What it looks like](#what-it-looks-like) above for detail


### Query

- `!view` blocks inside Markdown notes
- one-line and multi-line power-user forms, multiple blocks per note
- `where`, `contains`, `sort`, `limit`, `via`, `group by`, `| label`
- `!=`, `is empty`, `exists`, `is not empty`
- cross-field OR: `where status = active or type = contact`
- `#tag` shorthand: `where #crm and status = active`
- date functions: `today()`, `days-from-now(n)`, `days-ago(n)` and more
- **`file.created` / `file.modified`** — virtual fields from the file system; filter notes by when they were created or last touched without adding anything to frontmatter (`where file.created >= 2026-01-01`)
- incoming relation queries: `!view incoming mission via commander`
- shortcut queries: `!view today`, `!view upcoming`, `!view open-tasks`, `!view overdue`

### Tables

- editable cells: text, relation, boolean, dropdown, number, date
- bulk spreadsheet-style paste, row-level revert, undo
- per-column value filters, client-side sort, column hide/show, drag-to-reorder
- **matrix view** — toggle any `!view` table to a two-axis grid: rows = query results, columns = any vault type, cells show connections (●)
- **bar chart** — click **Bar** in the layout toggle to group any result by any field; a **Group by** picker appears in the toolbar. Queries already using `group by` render immediately. Ideal for category distributions: notes per status, missions per outcome, contacts per account.
- **scatter chart** — click **Scatter** to plot results as data points on an X/Y grid. Yamlink auto-selects the first two numeric or date fields as axes; use the axis dropdowns to change them. The button is greyed out when the result has no numeric or date fields.
- task status pills: Done, Not done, Due today, Due soon, Overdue
- export: CSV, JSON, PDF

### Intelligence

- type-filtered relation completion — a `contact:` field only shows `contact` notes
- `New [type]` note creation from relation fields — creates the note, wires both sides
- schema-driven note creation (`yamlink.newNoteFromSchema`)
- note creation priority: Template → Schema → vault inference → bare stub
- vault-derived field bundle suggestions over hardcoded archetypes
- **feedback loop** — the system also learns from completions you accept: accepting a relation suggestion writes a training signal to the mutation log; that history boosts confidence in future predictions for the same field
- **note arc prediction** — shows which fields similar notes typically have that yours doesn't, ranked by vault frequency and your acceptance history
- **emerging patterns → schema proposal** — when enough notes share an identical field shape without a formal schema, Vault Health surfaces the cluster and offers to formalize it in one command (`Yamlink: Propose Schema from Cluster`); accepting creates a real schema note from the observed pattern and offers to back-fill the new fields onto the notes that inspired it — the vault writes its own schema from how you actually use it, not the other way around
- **pre-schema field emergence** — even before a pattern gets formalized into a schema, a new note whose fields match a repeated pattern elsewhere in your vault gets that pattern's fields suggested — not the generic universal starter list every brand-new note used to fall back to
- **suggestion cascade** — accepting a relation-field completion checks whether the note is obviously missing a next field peers of its type typically have, and offers a one-click, non-modal nudge to add it — only at high confidence, never twice for the same note in one session
- **temporal confidence** — fields revised often carry less confidence in classification than fields set once and left alone, mined directly from mutation history
- **natural-language write actions** — the plain-English query box (`Yamlink: Natural Language Query`) understands a first set of write phrasings ("archive all missions with status failed") alongside its existing read-only query generation
- **relationship gravity** — Note Report's connection lists rank your most-reinforced relationships first, weighing how many fields corroborate a connection and how often the vault's own history reinforces it, not arbitrary order; Vault Health surfaces the vault-wide "Most-Reinforced Connections" too
- **Vault Projections** — real trend-fitting for Growth, Stale, and Structure, each reconstructed at real historical checkpoints via the Time Engine and fit with an honest least-squares line, not a rolling-window multiplier. Includes retrospective accuracy scoring (a checkable claim: what the model projected N days ago vs. what actually happened) and a ranked forecast of which specific notes are about to go stale
- lifecycle state: `draft`, `growing`, `consolidated`, `hub`, `stale`
- type consistency: `on track`, `slightly unusual`, `missing structure`, `very unusual`
- `@today`, `@tomorrow`, `@thisweek`, and other date shortcuts in frontmatter
- **quick capture** — `Ctrl+Alt+N` / `Cmd+Alt+N` creates a new note without breaking editor flow; when triggered from inside a Yamlink note, offers to link the new note back to the current one (L3 contextual linking)
- **auto-date stamp** — new notes get `created:` written at creation time; `Yamlink: Add Missing Creation Dates` stamps existing notes from file system birthtime

### Surfaces

- **Custom hover cards** — hover a `[[wikilink]]` and get a real card: colored `type`/`status` badges, a note preview, key fields, and an intelligence hint — all clickable, no VS Code default hover fighting for space
- **Image embeds** — `![[photo.png]]` shows the actual image on hover (filename and size included), reads as a normal resolved link rather than a broken one, and Ctrl+Click opens it — same as any other resolved wikilink
- **Home** — activity feed, vault pulse, continue-working, nudge cards, and operational task groups (overdue, today, upcoming, open / undated)
- **Task Center** — every task in the vault in one sidebar view, grouped into Overdue/Today/Upcoming/Undated/Done, with real native mark-complete checkboxes and `#urgent`/`#medium`/`#low` priority — no cap on how many show
- **Note Report** — Overview, Links, Tasks, Views, History tabs; tab state persists across note switches
- **Calendar** — month, week, day views; keyboard shortcuts `M W D [ ] T`; click-through to notes; task due dates plus note `date:` / `created:` activity
- **Live Note** — synced rendered sidecar for reading a note while still writing in raw Markdown, with direct jumps back to frontmatter, headings, and live view blocks
- **Task notifications** — per-vault VS Code alerts for overdue and due-today tasks, with deduping and quick actions into Calendar or Home
- **Vault Health** — lifecycle distribution, drift score cards, schema conformance coverage, health score, broken link counts (compact status bar: `◈ 31  ⚠ 5`), and real Time-Engine-backed Growth/Stale/Structure forecasts with retrospective accuracy scoring

### Conduit

Yamlink's keyboard-driven terminal workspace — full vault access with no browser and no VS Code required. `yamlink` alone auto-starts the API server and opens it.

- **9 screens**, one keypress each: Briefing (session delta, vault pulse, overdue tasks), Query (type a `!view` clause, see live results), Navigator (type filter + fuzzy search), Explorer (browse/read/edit/create/link with full write capability), Health (schema coverage, drift, emerging patterns), Search (free-text vault search), Graph (traversal + live spatial view), Diff (side-by-side note comparison), Radar (relation radar around the current note)
- **Live spatial graph view** — `v` on the Graph screen toggles a constellation layout: the focused note centered with labeled, type-colored connection lanes, updating live over SSE as relations change elsewhere
- **NoteView** — `v` from Explorer or Navigator opens a full ANSI-rendered Markdown reading view; `j`/`k` scrolls, `]`/`[` jumps headings
- **Explorer write operations** — field editing, note creation, deletion, wikilink building, and multi-select bulk operations (set field, set status, delete) via Space-bar selection
- **Split view** — `|` splits into two independent panes sharing one live SSE connection, so you can run a query while browsing notes, or hold two screens open at once
- **Quick Capture**, **Peek overlay**, **note mutation history**, **graph traversal** (`]`/`[` follows the strongest outbound/inbound link), **Warp** (type any character to fuzzy-search notes, types, and commands from anywhere), and **spatial bookmarks** (`m0`–`m9` / `'0`–`'9`)
- No polling — every screen updates live from `GET /api/events` (SSE) on each vault rebuild

### CLI and platform

Run Yamlink capabilities without VS Code — 37 commands, `--json` everywhere for scripting. Commands that list results (`ls`, `grep`, `find`, `search`, `doctor`, and others) print a real aligned table by default; add `--json` for machine output, or `--quiet` on `ls`/`grep`/`find` for the old plain tab-separated form if you're piping into `awk`/`cut`/`xargs`.

**Vault integrity**

```bash
yamlink build --vault ./vault            # index vault, report broken links / duplicate IDs (exits 1 in CI)
yamlink doctor                           # comprehensive integrity pass: broken links, duplicate ids, malformed
                                          # frontmatter, orphans, schema violations, stale notes, arc gaps
yamlink validate                         # schema + broken-links + duplicate ID checks (exits 1 on failures)
yamlink status                           # compact vault snapshot: notes, types, edges, generation
```

**Query and search**

```bash
yamlink query "where type = contact"     # run a query, print a table or JSON
yamlink search "Johnny Rico"             # fast lookup by ID, name, title, type
yamlink ls --type contact --sort name    # list notes with unix-style filtering and sorting
yamlink grep rough --field unit          # search frontmatter values for matching text
yamlink find --has status --missing owner # structural search by present/missing fields
yamlink cat johnny-rico                  # print a note's frontmatter snapshot and body (--at <date> for a historical snapshot)
yamlink links johnny-rico                # inbound and outbound links for a note (--at <date> for outbound-only history)
yamlink report johnny-rico               # full note report: lifecycle, drift, all links (--at <date> for a historical report)
yamlink diff johnny-rico carl-jenkins    # compare two notes' field sets, or --since for recent changes
yamlink story --since 2026-01-01         # vault growth story: note counts, per-type deltas, and activity since a date
```

**Editing**

```bash
yamlink create contact --field name="Jane Doe"   # create a new note with optional --field pairs
yamlink set johnny-rico status active            # set a frontmatter field (--clear to remove)
yamlink link johnny-rico unit roughnecks         # add a wikilink relation field (--append to keep existing)
yamlink rename old-id new-id                     # vault-wide ID rename — rewrites id: and all [[wikilinks]]
```

**History and automation**

```bash
yamlink mutations                        # recent mutation events from the vault log
yamlink session                          # summarize recent or explicit mutation sessions
yamlink on note_created -- ./sync.sh     # run a script whenever a matching mutation event fires
yamlink watch                            # watch vault for changes and rebuild the index on save
```

**Intelligence**

```bash
yamlink suggest johnny-rico              # fields likely missing from a note
yamlink drift --type contact             # notes structurally drifting from their type's usual shape
yamlink stale                            # notes in a stale lifecycle state
yamlink orphans                          # notes with no inbound or outbound links
yamlink pressure                         # knowledge pressure: load-bearing drafts, stale hubs, orphans
yamlink lenses                           # vault change lenses over mutation history
```

**Schema**

```bash
yamlink schema list                      # list all schema notes and their required fields
yamlink schema check contact             # conformance check for one type — exits 1 on violations
yamlink schema check --all --json        # conformance check across every schema target
```

**Platform**

```bash
yamlink briefing                         # morning summary: pulse, tasks, activity, arc predictions
yamlink health                           # lifecycle, drift, type distribution
yamlink graph --only-types contact,unit  # full vault graph as JSON (nodes + edges)
yamlink graph --at 2026-01-01            # historical vault graph reconstructed as of that date
yamlink export --format csv              # dump vault to JSON or CSV
yamlink env --shell zsh                  # export shell variables for the current vault
yamlink completions bash                 # print a shell completion script (bash, zsh, or fish)
yamlink serve --port 4000                # start a local HTTP API server for the vault
yamlink serve --lsp                      # start the LSP server (Neovim, Zed, Helix, Emacs)
yamlink conduit                          # terminal UI — auto-starts server if not running
yamlink init ~/notes                     # initialize a new Yamlink vault
```

Run `yamlink --help` for the full command and flag reference.

---

## Quick start

**1. Install Yamlink and open a workspace**

Use any normal folder of Markdown notes, or start with the sample vault Yamlink copies into the workspace on first activation.

If you want a standalone guided demo vault, use [Yamlink Sandbox](https://github.com/Yamlink-Labs/yamlink-sandbox).

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

```
!view character
select name, type
sort name
```

Run the view, then open:

- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Graph Workspace`
- expand `Note Outline` in the Yamlink sidebar to navigate long notes by section
- expand `Tasks` in the Yamlink sidebar for a vault-wide task list, grouped and checkable

That is the core Yamlink loop in practice:

**write → link → query → inspect → refine**

---

## Import existing vaults

Yamlink can also start from an existing note system instead of a greenfield vault.

- `Yamlink: Import Obsidian Vault`
  - scans an Obsidian vault before import
  - lets you copy the vault into the current workspace or add it as a workspace folder
  - skips `.obsidian/` config and junk/system directories
  - reports note counts, preserved non-Markdown files, and follow-up migration opportunities
  - can apply safe missing `id:` fields and canonical wikilink rewrite passes after import
- `Yamlink: Import Vault Export`
  - choose **Roam Research**, **Notion**, or **Evernote**
  - Yamlink inspects the selected export before import so you can confirm what it found
  - Yamlink converts the export into Markdown notes shaped for Yamlink indexing
  - each importer opens the same import -> analyze -> review flow
  - external imports now also expose post-import cleanup actions: preview IDs, apply safe missing `id:` fields, rewrite wikilinks, or run the combined cleanup pass
  - imported notes are stamped with origin metadata such as `imported_from:`
  - Notion imports also preserve CSV/database files and generate Yamlink row notes under `_notion_databases/`
  - Notion leaves local image/embed paths intact while rewriting resolvable note links into Yamlink wikilinks
  - Roam imports convert task macros and infer journal notes from date-titled pages
  - Evernote imports preserve attachments under `_attachments/<note-id>/`

This is the fastest way to bring an existing knowledge base into Yamlink without rewriting everything by hand.

For step-by-step import instructions, see [GETTING_STARTED.md](./GETTING_STARTED.md).

> **Import feedback wanted.** These importers cover the common cases but real exports vary — especially Notion (sub-page depth, block types) and Evernote (HTML complexity, attachments). If something came out wrong or you hit an edge case, [open a thread in GitHub Discussions](https://github.com/Yamlink-Labs/yamlink/discussions) with your platform and what you saw. It helps more than you might think.

---

## Install

Search for `Yamlink` in the VS Code Extensions panel, or install from the Marketplace:

[Yamlink on the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)

On first activation, Yamlink copies a sample vault into your workspace so you can explore the model immediately, and offers a guided tour (`Yamlink: Start Guided Tour`) that walks through creating a note, linking it, running a query, and seeing it as a live table. The sample files are plain Markdown.

If you want the standalone public sample vault repo instead, use [Yamlink Sandbox](https://github.com/Yamlink-Labs/yamlink-sandbox).

```bash
git clone https://github.com/Yamlink-Labs/yamlink-sandbox
code yamlink-sandbox
```

Coming from Obsidian? Run `Yamlink: Import Obsidian Vault` from the command palette. Yamlink either copies the vault into your current workspace or adds it as a workspace folder, skips `.obsidian/` config, rebuilds the index, and can open Vault Health so you can see the structural state of your notes immediately. Importing plugin configuration is still in development and testing.

---

## Why it exists

Most tools that give you structure want you to live inside them. Yamlink doesn't need you to.

The work stays in Markdown. The files stay on disk. The editor stays VS Code. Yamlink reads what you already have and makes it linkable, queryable, and operational — your own local knowledge system.

If the structure outgrows what Yamlink can do, the files are still just files.


---

If Yamlink is useful to you, please star the repo on [GitHub](https://github.com/Yamlink-Labs/yamlink) and leave a review on the VS Code Marketplace.
If you want more news and information, please follow us on our new [X account](https://x.com/yamlinklabs)!

---


## Yamlink Theme Family

All screenshots and GIFs in this README use the **Yamlink Theme Family** — a companion VS Code color theme built to match Yamlink's panel aesthetic. Available separately on the Marketplace.

[Install on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink-theme) · [GitHub](https://github.com/Yamlink-Labs/yamlink-theme)

---

## License

MIT. The Yamlink name and logo are part of the Yamlink Labs brand. The MIT License grants permission to use, copy, modify, and distribute this software, but does not grant rights to use the Yamlink name or logo except to reference the software.
