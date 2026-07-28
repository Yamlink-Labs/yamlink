# <img src="./media/icon.png" alt="Yamlink logo" width="30" valign="middle"> Yamlink

Turn plain Markdown notes into editable live tables, a knowledge graph, a calendar, and a terminal workspace — all reading the same local files. Create a living system off your Markdown.

[![CI](https://github.com/Yamlink-Labs/yamlink/actions/workflows/ci.yml/badge.svg)](https://github.com/Yamlink-Labs/yamlink/actions/workflows/ci.yml)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version/yamlink.yamlink.svg)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
[![Installs](https://vsmarketplacebadges.dev/installs/yamlink.yamlink.svg)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
[![Rating](https://vsmarketplacebadges.dev/rating/yamlink.yamlink.svg)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.120.0-blueviolet)

Write a `!view` block in any note and it opens as a live, editable table — change a cell, it writes straight back to the file. The same notes also feed a knowledge graph (`[[wikilinks]]` become typed edges), a calendar, and a terminal workspace, all from plain Markdown with a stable `id:` in the frontmatter.

No database. No sync. 

Start with the guided sample vault: [Yamlink Sandbox](https://github.com/Yamlink-Labs/yamlink-sandbox) · [Getting Started](./GETTING_STARTED.md)

---

## What it looks like

### Live tables

Write a `!view` block on your note. Run it. A live table opens beside your note — editable cells, typed values, per-column filters, sort, search, export. Edits write back directly to frontmatter.

![Live tables](./media/readme/live-table.gif)

### Conduit

Conduit is Yamlink's keyboard-driven terminal workspace. Run `yamlink` and your vault opens in the terminal — ten screens accessible by number key: Briefing, Query, Navigator, Explorer, Health, Search, Graph, Diff, Radar, Trends. Browse notes, run live queries, capture, edit frontmatter, and read full notes without leaving the terminal. Press `|` to split into two independent panes sharing one live vault connection. The Graph screen has a live spatial view (`v` to toggle) — a note's connections rendered as a real terminal graph, colored by type with a legend, and it live-updates the moment a relation changes elsewhere in the vault.

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

**Vault Projections** reconstruct your vault history (via the **Time Engine**). Growth, Stale, and Structure each get a real 90-day forecast with a genuine fit-quality score, plus a retrospective accuracy check no cloud tool can make — "90 days ago this model projected 42 notes for today; you actually have 42, 98% accurate" — because it requires real reconstructed behavioral history, specific to your vault. A ranked "going stale soonest" list names the actual notes that need attention, not just an aggregate rate.

![Vault Health](./media/readme/vault-health.gif)

### A Yamlink note

<!-- hero screenshot: open sample/yamlink-hero.md in VS Code with Yamlink Apollo Night theme, capture the editor at ~1400px wide, replace hero.png -->

| | |
|---|---|
| **Frontmatter** | Structured YAML at the top of every note. Fields like `platform: [[vs-code]]` are typed graph edges — Yamlink indexes, completes, and renames them vault-wide. |
| **`[[wikilinks]]`** | Every link becomes a graph edge. Ctrl+Click navigates, completions rank by type, broken links surface as diagnostics. Rename a note — every link updates automatically. |
| **Block references** | Every meaningful body element has a stable block ID: `h-{slug}` for headings, `t{n}-{hash}` for tasks, `q{n}-{hash}` for blockquotes, `fn-{id}` for footnotes. Write `note#Heading` to link a section or `note^block-id` to link a specific task, quote, or footnote. Go-to-definition lands on the exact line. |
| **Callouts** | `> [!INFO]` `> [!TIP]` `> [!WARNING]` — body structure signals that feed note-role inference and the Note Report. |
| **Tasks** | `- [ ]` checkboxes extracted from the note body, tracked in the Calendar by due date, surfaced in Home, queryable with `!view open-tasks`, and browsable vault-wide in the sidebar's Task Center — grouped by Overdue/Today/Upcoming/Undated/Done with real native mark-complete checkboxes. Every bucket shows every task with no cap, except Undated: past 5, it collapses to a "Show N more" row so a large untriaged backlog doesn't dominate the view. Write `#urgent`/`#medium`/`#low` in a task line for a real priority signal — a colored dot on the task, sorted to the top of its bucket, and an escalated notification when an urgent task goes overdue. |
| **`!view` block** | A live query written inline in the note. Runs against the vault, opens an editable table beside the editor. Edit a cell — it writes back to the source Markdown file. |
| **Tags** | `#local-first #pkm` — body hashtags and frontmatter tags, both filterable in queries with `where #pkm`. |

### The model

Three things, one loop:

- **Identity** — every note that matters gets a stable `id:` (`id: johnny-rico`, `type: character`) that survives renaming.
- **Relations** — frontmatter fields and body wikilinks both become graph edges (`commander: [[johnny-rico]]`).
- **Queries** — a `!view` block runs against the live graph and opens as an editable table beside the note.

**Write → link → query → inspect → refine.**

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

### Block references

Every meaningful body element gets a stable ID, not just headings — Yamlink can link to a specific task, quote, or footnote, not only a whole note or section.

- **Headings** (`h-{slug}`), **tasks** (`t{n}-{hash}`), **blockquotes/callouts** (`q{n}-{hash}`), and **footnotes** (`fn-{id}`) all get a stable block ID automatically, computed on every index rebuild.
- `[[note#Heading]]` links a section; `[[note^block-id]]` links a specific task, quote, or footnote. Go-to-definition lands on the exact line either way — not just the top of the note.
- Hovering a scoped reference previews the actual heading or block content, not just the note's frontmatter.
- Completion suggests real headings/blocks as you type `#` or `^` inside a wikilink.
- **Copy/insert commands** — `Yamlink: Copy Scoped Reference` (pick any heading, task, quote, or footnote — the general picker), `Yamlink: Copy Section Reference` (headings only), `Yamlink: Copy Block Reference` (tasks/quotes/footnotes only), plus `Insert` variants of all three that write directly into the editor instead of the clipboard.
- **Note Report surfaces block-level backlinks** — not just "which notes link here," but which notes link to *this exact task or quote*.

### Query

- `!view` blocks inside Markdown notes
- one-line and multi-line power-user forms, multiple blocks per note
- `where`, `contains`, `sort`, `limit`, `via`, `group by`, `| label`
- `!=`, `is empty`, `exists`, `is not empty`
- cross-field OR: `where status = active or type = contact`
- `#tag` shorthand: `where #crm and status = active`
- date functions: `today()`, `days-from-now(n)`, `days-ago(n)` and more
- **`file.created` / `file.modified`** — virtual fields from the file system; filter notes by when they were created or last touched without adding anything to frontmatter (`where file.created >= 2026-01-01`)
- **`_inbound_count` / `_outbound_count` / `_hub_score`** — computed graph fields, no frontmatter required: edge counts and Yamlink's own graph-prominence score, queryable in `where`, `select`, and `sort` (`!view character sort _hub_score desc`)
- incoming relation queries: `!view incoming mission via commander`
- shortcut queries: `!view today`, `!view upcoming`, `!view open-tasks`, `!view overdue`
- **Query Builder** (`Yamlink: Query Builder`) — don't want to hand-write a query? A compact visual panel builds it for you across three steps (`View` → `Shape` → `Preview`), always showing the exact `!view` text before it inserts anything. Recommended/All/Custom column modes, icon-based layout choice (table, matrix, bar, scatter), one-click Fast Starts (Most connected, No incoming links, Recently modified, Recently created), and a plain-language explanation of the query you've built.

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
- **Task Center** — every task in the vault in one sidebar view, grouped into Overdue/Today/Upcoming/Undated/Done, with real native mark-complete checkboxes and `#urgent`/`#medium`/`#low` priority — every bucket shows every task, except Undated, which collapses past 5 into a "Show N more" row to keep a large untriaged backlog from dominating the view
- **Note Report** — Overview, Links, Tasks, Views, History tabs; tab state persists across note switches
- **Calendar** — month, week, day views; keyboard shortcuts `M W D [ ] T`; click-through to notes; task due dates plus note `date:` / `created:` activity
- **Live Note** — synced rendered sidecar for reading a note while still writing in raw Markdown, with direct jumps back to frontmatter, headings, and live view blocks
- **Task notifications** — per-vault VS Code alerts for overdue and due-today tasks, with deduping and quick actions into Calendar or Home
- **Vault Health** — lifecycle distribution, drift score cards, schema conformance coverage, health score, broken link counts (compact status bar: `◈ 31  ⚠ 5`), and real Time-Engine-backed Growth/Stale/Structure forecasts with retrospective accuracy scoring

### Smart paste

When you paste clipboard content into a note, Yamlink checks whether it's structured before falling back to a plain-text paste, and offers to convert it instead of dumping raw markup into the note.

- **A spreadsheet range** (Excel, Google Sheets, LibreOffice) copies as tab-separated text — paste it and Yamlink offers to turn it into a `!view *` table scaffold using the column headers as fields, or into one new note per row with each column as a frontmatter field. Plain comma-separated `.csv` *text* is not detected — the check is specifically for tab characters, matching what spreadsheet apps put on the clipboard, not delimiter-separated text in general.
- **A real Markdown table** (`| col | col |` with a `---|---` separator row) copied from another note, a GitHub PR description, or an exported doc — same two conversion choices as above.
- **A JSON object** copied from an API response or a config snippet — pastes directly as YAML frontmatter, one field per key.
- **A bulleted or numbered list** copied from Slack, email, or a planning doc — converts to real Yamlink tasks (`- [ ] ...`), preserving `#urgent`/`#medium`/`#low` markers already in the text. A list where every line is already a `- [ ]` checkbox is left as a normal paste, since it's already in task form.
- **Conservative by design** — a single plain string (a copied page title, a sentence, a name) doesn't match any of the above, so Smart Paste does nothing and the paste behaves exactly as it always has. It only ever fires on structured clipboard content, not plain text — that's a separate, not-yet-built idea (clipboard-aware relation completion while typing `[[`), not this feature.

### Save a note as a template

Turn any real, already-filled-in note into a reusable blank template for its `type:` — three ways to trigger it, same result:

- **CLI:** `yamlink template save <id>` — writes `_templates/<type>.md`. Pass `--force` to overwrite a template that already exists for that type; without it, an existing template is left untouched and the command errors instead of clobbering it.
- **Command Palette:** open the note in the editor, `Ctrl+Shift+P` / `Cmd+Shift+P` → **"Yamlink: Save Note as Template"**.
- **Right-click:** right-click anywhere in an open Markdown note → **Yamlink** submenu → **Save Note as Template**. If a template for that type already exists, VS Code shows a confirm dialog before overwriting it.

What it does to the note's content:

- `type:` is kept exactly as-is — templates are looked up by this value, so it has to survive.
- `id:` and every other scalar value are blanked (`name: Johnny Rico` → `name:`).
- A single-line relation value blanks to `[[]]` (`account: [[acme-inc]]` → `account: [[]]`).
- A YAML block-list relation field — several `- [[link]]` lines under one field, like a `contacts:` list with six entries — collapses to a **single** blank `- [[]]` placeholder, not six blank ones, so the template still reads as "this is a list" without carrying over which specific notes it used to point to.
- The body keeps its heading structure (`## Summary`, `## Next Steps`, …) but drops everything written under each heading, since that's specific to the one note you started from.

The result is a completely normal template file — it shows up in `_templates/` and immediately works with everything Smart Templates already does above: "New Note from Template" offers it, and template-drift detection starts flagging any note of that type missing one of its fields.

### Vault Glossary

An alphabetized, always-current glossary of your vault's own concept/term notes — useful for a worldbuilding, research, or technical vault with real definitional notes (factions, locations, jargon); not much use on a pure CRM/entity vault, where nothing needs "defining." **Nothing is ever written to disk** — it's a live view, computed fresh from the vault every time you open it, the same way Vault Health is:

```bash
yamlink glossary --type faction,location
```

or, in VS Code, Command Palette → **"Yamlink: Open Vault Glossary"**.

**The one thing you configure:** which note type(s) count as glossary terms — Yamlink can't guess this, so with nothing set it asks rather than guesses. In VS Code, set `yamlink.glossaryTypes` in Settings (`Ctrl+,`, search "yamlink glossary") to something like `["faction", "location"]`; from the CLI, pass `--type` each time.

**What each entry shows, with zero manual upkeep:**
- The term's own **definition** — an explicit `definition:`/`summary:` field if you wrote one, otherwise the note's own first body paragraph, verbatim. Yamlink never invents text.
- **Referenced in** — every note that links to it, the same backlink data Note Report's Links tab already shows one note at a time, just gathered across every term at once.

**In the VS Code panel — a real toolbar, not just a static list:**
- **Group by type** / **Hide unreferenced** checkboxes right in the panel header — toggling either updates your settings immediately, no trip to Settings required.
- **Sort** dropdown — Alphabetical (default) or **Most referenced**, ranking terms by inbound link count instead of A–Z.
- **Collapsible type sections** — click a type heading (e.g. "FACTION") to fold it, useful once a glossary has several types with many terms each.
- **Live search** filters the list as you type, with keyboard navigation (↑/↓ to move between visible results, Enter to open the focused one).
- **Copy as Markdown** — copies whatever's currently visible (respecting an active search filter) as plain Markdown, for pasting elsewhere.
- Click a term or a backlink to jump straight to that note; wikilinks inside a definition itself (e.g. `[[carmen-ibanez]]` pulled from a note's own body) render as real clickable links too, not literal brackets.
- A **Settings** button in the header always jumps you back to `yamlink.glossaryTypes` — no need to remember where the setting lives.

**Settings, all defaulted so none are required to touch, and all changeable from the panel toolbar itself:**
- `yamlink.glossaryGroupByType` (default on) — a section per type instead of one mixed A–Z list.
- `yamlink.glossaryShowZeroBacklinkTerms` (default on) — show a term nothing links to yet, marked *(not yet referenced)*, instead of hiding it.
- `yamlink.glossarySortBy` (default `alphabetical`) — or `mostReferenced` to rank by inbound link count.
- `yamlink.glossaryExtraFields` — extra frontmatter fields (e.g. `region`) to show under each entry.

CLI equivalents: `--no-group-by-type`, `--hide-unreferenced`, `--sort-by-references`, `--extra-field <name>` (repeatable), `--json` for machine output.

### Conduit

Yamlink's keyboard-driven terminal workspace — full vault access with no browser and no VS Code required. `yamlink` alone auto-starts the API server and opens it.

- **10 screens**, one keypress each: Briefing (session delta, vault pulse, overdue tasks), Query (type a `!view` clause, see live results), Navigator (type filter + fuzzy search), Explorer (browse/read/edit/create/link with full write capability), Health (schema coverage, drift, emerging patterns), Search (free-text vault search), Graph (traversal + live spatial view), Diff (side-by-side note comparison), Radar (relation radar around the current note), and Trends (growth, stale, and structure projections, key `0`)
- **Live spatial graph view** — `v` on the Graph screen toggles a constellation layout: the focused note centered with labeled, type-colored connection lanes, updating live over SSE as relations change elsewhere
- **NoteView** — `v` from Explorer or Navigator opens a full ANSI-rendered Markdown reading view; `j`/`k` scrolls, `]`/`[` jumps headings
- **Explorer write operations** — field editing, note creation, deletion, wikilink building, and multi-select bulk operations (set field, set status, delete) via Space-bar selection
- **Split view** — `|` splits into two independent panes sharing one live SSE connection, so you can run a query while browsing notes, or hold two screens open at once
- **Quick Capture**, **Peek overlay**, **note mutation history**, **graph traversal** (`]`/`[` follows the strongest outbound/inbound link), **Warp** (type any character to fuzzy-search notes, types, and commands from anywhere), and **spatial bookmarks** (`m0`–`m9` / `'0`–`'9`)
- No polling — every screen updates live from `GET /api/events` (SSE) on each vault rebuild

### CLI and platform

Run Yamlink capabilities without VS Code — 41 commands, `--json` everywhere for scripting. Commands that list results (`ls`, `grep`, `find`, `search`, `doctor`, and others) print a real aligned table by default; add `--json` for machine output, or `--quiet` on `ls`/`grep`/`find` for the old plain tab-separated form if you're piping into `awk`/`cut`/`xargs`.

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
yamlink restore 2026-01-01               # preview a reconstructed vault (--output <path> to export as .md files, never into the live vault)
yamlink snapshot                         # capture a checkpoint now, for restoring further back later (see below)
yamlink trends                           # Growth/Stale/Structure forecast and retrospective accuracy
```

`restore` reconstructs from the mutation log alone for any recent-enough date — **no snapshot required.** A snapshot only matters once you need to restore further back than the mutation log's 10,000-event retention window can reach on its own; `restore` checks for one automatically when needed. Run `snapshot` as occasional insurance before a big change, not as a routine step before every `restore`.

**Editing**

```bash
yamlink create contact --field name="Jane Doe"   # create a new note with optional --field pairs
yamlink set johnny-rico status active            # set a frontmatter field (--clear to remove)
yamlink link johnny-rico unit roughnecks         # add a wikilink relation field (--append to keep existing)
yamlink rename old-id new-id                     # vault-wide ID rename — rewrites id: and all [[wikilinks]]
yamlink template save johnny-rico                # save a note as a blank-skeleton template for its type (--force to overwrite)
yamlink glossary --type faction,location         # live alphabetized glossary of every note of these types
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

For the full walkthrough, see [GETTING_STARTED.md](./GETTING_STARTED.md). For the full query language, see [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md). New to Yamlink's terminology? See [GLOSSARY.md](./GLOSSARY.md). To understand how the intelligence system learns, see [INTELLIGENCE.md](./INTELLIGENCE.md).

### Import existing vaults

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

This is the fastest way to bring an existing knowledge base into Yamlink without rewriting everything by hand. For step-by-step import instructions, see [GETTING_STARTED.md](./GETTING_STARTED.md).

> **Import feedback wanted.** These importers cover the common cases but real exports vary — especially Notion (sub-page depth, block types) and Evernote (HTML complexity, attachments). If something came out wrong or you hit an edge case, [open a thread in GitHub Discussions](https://github.com/Yamlink-Labs/yamlink/discussions) with your platform and what you saw. It helps more than you might think.

---

## Latest release — 0.7.6

0.7.6 is a quick follow-up mainly fixing real problems from 0.7.5: the in-editor "What's New" notice was still showing 0.7.4's release notes to every updating user, block IDs (used for hover, completion, go-to-definition, and block-level backlinks) silently stopped working entirely on any note saved with Windows line endings, and a multi-value relation field could render with corrupted, missing brackets in the hover card. Alongside those fixes, block-level backlinks — knowing which notes link to a specific task, quote, heading, or footnote inside a note, not just the note as a whole — are now reachable outside VS Code too, via `yamlink block-backlinks` and `GET /api/nodes/:id?include=blockBacklinks`.

## 0.7.5

- **The API reaches further outside the editor** — `GET /api/nodes/:id?include=body` returns a note's raw text, `?include=timestamps` returns its real filesystem dates, `PATCH /api/tasks` toggles a task's checkbox, and `GET /api/glossary` hands over the vault's glossary — all things you could already do by hand in VS Code, now scriptable.
- **Optional API authentication** — set `YAMLINK_API_TOKEN` before running `yamlink serve` to require a matching `X-Yamlink-Token` header on every request. Off by default with a visible startup reminder when it's unset, since until now anything on your machine could read or write your vault through the API with no login at all.
- **Plugin API for third-party field evidence** — another VS Code extension can register a function contributing its own small, explainable opinion to Yamlink's field-guessing (`registerFieldEvidenceSource`). Read-only, capped influence, discarded outright if it doesn't come with a stated reason.
- **Vault Trends reaches every surface** — the Growth/Stale/Structure forecasting engine behind Vault Health's Projections card is no longer VS Code-only. `GET /api/intelligence/trends`, `yamlink trends`, and a new Conduit "Trends" screen (`0`) all return the exact same reconstructed trend data and retrospective accuracy scoring the extension panel already shows — not a second, separate model.
- **Computed fields, Tier 1** — three read-only virtual fields, queryable in any `!view` block with no frontmatter required: `_inbound_count`, `_outbound_count`, `_hub_score` (Yamlink's own graph-prominence score, the same one that already sizes nodes in x-graph). Works in `where`, `select`, and `sort` — `!view character sort _hub_score desc` surfaces your most-connected notes without ever declaring the field.
- **Vault snapshot/restore CLI pair**, **smart paste** — see [What it looks like](#what-it-looks-like) above and the CLI section below for detail.
- **Save as Template** — turn any real, filled-in note into a reusable blank template for its type, from the CLI, the Command Palette, or a right-click. See [Save a note as a template](#save-a-note-as-a-template) below.
- **Vault Glossary** — a live, always-current A–Z glossary of your vault's concept/term notes (their own definitions plus backlinks), computed fresh every time, nothing written to disk. See [Vault Glossary](#vault-glossary) below.
- **Query Builder polish** — the visual builder now explains itself: a plain-language result summary, one-click Fast Starts (Most connected, No incoming links, Recently modified, Recently created), and the three new computed fields available in every field picker with inline explanations.
- **Reverse-link auto-fill made honest** — creating a note from a broken link only auto-fills the link back to where it came from when the vault has real evidence for which field is right; a weaker guess is now offered as a one-click confirmation instead of being applied silently.

For the full release history, see [CHANGELOG.md](./CHANGELOG.md).

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

## Yamlink Theme Family

All screenshots and GIFs in this README use the **Yamlink Theme Family** — a companion VS Code color theme built to match Yamlink's panel aesthetic. Available separately on the Marketplace.

[Install on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink-theme) · [GitHub](https://github.com/Yamlink-Labs/yamlink-theme)

---

If Yamlink is useful to you, please star the repo on [GitHub](https://github.com/Yamlink-Labs/yamlink) and leave a review on the VS Code Marketplace.
If you want more news and information, please follow us on our new [X account](https://x.com/yamlinklabs)!

---

## License

MIT. The Yamlink name and logo are part of the Yamlink Labs brand. The MIT License grants permission to use, copy, modify, and distribute this software, but does not grant rights to use the Yamlink name or logo except to reference the software.
