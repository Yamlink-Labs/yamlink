# Yamlink 0.7.0 — Sugar *(in development)*

Sugar is the platform release. It makes Yamlink usable as a full local data platform — not just a VS Code extension — while deepening the authoring experience inside the editor.

Two directions in parallel:

- **Inside VS Code** — smarter authoring, better templates, live note mode, note outline, bar/scatter chart views, scoped section and block references, tag pills, task notifications, and intelligence that learns from recent behavior rather than only lifetime vault statistics
- **Outside VS Code** — CLI with 24 commands, a full writable REST API, Conduit (a keyboard-driven terminal workspace), and an in-development-LSP server for Neovim, Zed, Helix, and Emacs

---

## What's new in Sugar

### Single-command startup

```bash
yamlink          # launch Conduit — server starts automatically if not already running
yamlink conduit  # same thing, explicit
```

`yamlink` with no arguments now checks whether the API server is listening on the configured port. If not, it starts one in-process, opens Conduit, and stops the server on exit. No more remembering to run `yamlink serve` first.

If you already have a `yamlink serve` running in another terminal, Conduit detects it and connects directly without starting a second server.

### Conduit — terminal workspace

`yamlink conduit` opens a full keyboard-driven workspace over the vault. Nine screens, one keypress each:

| Key | Screen | What you do there |
|---|---|---|
| `1` | Briefing | Vault pulse, open tasks, live activity feed |
| `2` | Query | Live query runner — type any clause, results appear as a table |
| `3` | Navigator | Browse vault by type, fuzzy filter, open notes in `$EDITOR` |
| `4` | Explorer | Full note browser with detail pane, field editing, link building |
| `5` | Health | Broken links, orphans, schema coverage, lifecycle distribution |
| `6` | Search | Full-text search across IDs, names, types |
| `7` | Graph | Keyboard-driven graph traversal with LINKS OUT / LINKS IN panes |
| `8` | Diff | Compare two notes' field sets |
| `9` | Radar | Intelligence snapshot |

Explorer supports field editing (`e`), note creation (`n`), deletion (`D`), wikilink building (`l`), full note reading (`v`), and Space-bar multi-select for bulk operations. Query, Search, and Navigator can all push a note ID into Explorer for detail inspection.

The status bar shows which screen you're on (`[1] Briefing`, `[2] Query`, etc.) so you always know where you are. Conduit runs in alternate screen mode — your terminal history is unaffected.

#### Session context on Briefing

Every time you open Conduit, the Briefing screen tells you what changed since last time:

> *since your last session (14h ago): 3 notes created, 2 missions updated, 1 broken link appeared*

Powered by the existing `GET /api/diff` endpoint scoped to your last session timestamp. First run shows nothing; every subsequent open shows the delta.

#### Bulk operations in Explorer

Space bar toggles a `■` selection mark on any note row. Once you have a selection, Enter opens an action menu:

- **Set field on all** — type a field name and value; writes to all selected notes in one request
- **Set status on all** — the most common bulk edit, one step
- **Delete all** — with a confirmation step

The selection count is visible in the pane header throughout. Esc cancels at any step.

#### Split view — two vault contexts side by side

Press `|` from any screen to split Conduit into two independent panes. Each pane is its own screen instance: left pane might show Explorer while the right pane runs a Query, or you compare two screen states simultaneously.

- `|` — toggle split on/off
- `Tab` — cycle focus between panes (lit border = active)
- Number keys `1`–`9` change the screen in the currently focused pane
- `q` on the secondary pane closes split and returns to single-screen
- Both panes share the same SSE connection and live vault state — no double polling

The status bar shows `◉ left | ○ right` when split is active.

---

#### Intelligence inline in note detail

The note detail pane in Explorer now shows lifecycle, drift, and the top missing field without pressing `p`:

```
lifecycle: growing  drift: on-track  ↑ 4
next: commander  (high)
```

Zero extra round trips — the intelligence call was already happening.

#### Note View (`v`) — read notes in the terminal

Pressing `v` on any note in Explorer or Navigator opens a full-screen reading view rendered entirely in the terminal. The note body is parsed and displayed with ANSI styling:

- Headings colored by level — H1 in pink+bold, H2 in lavender, H3 in secondary
- Wikilinks highlighted in mint, inline code in teal, bold/italic preserved
- Tasks rendered as `☐` (amber, open) or `☑` (muted, done)
- Code fences surrounded with `┌── code` / `└───` borders in teal
- `j`/`k` to scroll, `]`/`[` to jump between headings, `o` to open in your editor, `Esc` to close
- Lifecycle badge and arc gap suggestions shown at the top and bottom of the view

### CLI — 24 commands

Full headless vault access from any terminal:

```bash
yamlink build          # index vault, report broken links (exits 1 in CI)
yamlink briefing       # morning summary: pulse, tasks, activity, arc predictions
yamlink query "…"      # run a query, print ASCII table or JSON
yamlink report <id>    # full note report in the terminal
yamlink links <id>     # inbound + outbound links
yamlink health         # lifecycle, drift, type distribution
yamlink validate       # schema conformance — exits 1 on violations
yamlink status         # compact snapshot: notes, edges, types, generation
yamlink search <q>     # fast lookup by ID, name, title, type
yamlink create <type>  # create a note non-interactively
yamlink set <id> <field> <value>  # set a frontmatter field (--clear to remove)
yamlink link <id> <field> <to>    # add a wikilink relation (--append to multi-link)
yamlink rename <a> <b> # vault-wide ID rename with --dry-run preview
yamlink diff <a> <b>   # compare two notes' frontmatter field sets
yamlink mutations      # recent mutation events from the vault log
yamlink doctor         # vault environment diagnostics
yamlink schema list    # all schema notes with required fields
yamlink schema check   # conformance check for one type
yamlink graph          # full vault graph as { nodes, edges } JSON
yamlink export         # dump vault to JSON or CSV
yamlink watch          # watch vault, rebuild on saves
yamlink on <event> --  # run a script when vault mutation events fire
yamlink serve          # start the local HTTP API server
yamlink init [path]    # scaffold a new vault
```

### Local HTTP API — full read/write

`yamlink serve` exposes the vault as a REST API. All 21 endpoints, writable:

- **`POST /api/nodes`** — create a note from `{ type, fields? }`
- **`PATCH /api/nodes/:id`** — update frontmatter field(s)
- **`PATCH /api/nodes/bulk`** — update up to 50 notes in one request
- **`DELETE /api/nodes/:id`** — remove a note
- **`GET /api/events`** — Server-Sent Events stream; pushes `rebuild` events (and fine-grained mutation events via `eventsBus`) after every vault change
- All existing GET endpoints unchanged

Any website framework (Next.js, Astro, plain scripts) can read and write your vault at build time or runtime. Vault as CMS. Files stay plain Markdown.

### x-graph — world-class graph experience

The x-graph engine (Canvas2D, no third-party graph library) received a full overhaul targeting smooth performance at thousands of nodes, correct cluster shapes, and fluid navigation.

**Cluster shape** — brain graphs no longer look like a massive ring. Cluster anchors are seeded with Fibonacci spiral placement (golden angle, varying radii) and then refined by a 32-iteration topology mini-force that pulls connected clusters toward each other and lets isolated ones drift outward naturally.

**Cluster hulls** — translucent shape overlays appear behind each cluster. Graham scan convex hull, expanded outward from centroid, smoothed with quadratic bezier curves. Each hull is colored by its hub node's type. When you hover a node, its cluster brightens and all others dim.

**Radial depth** — hub nodes are pulled 2.5× stronger toward the graph center; lighter nodes form an outer shell. The field naturally assumes a filled circular shape instead of an exploded ring.

**Smooth zoom** — labels fade in over a 0.05-zoom ramp rather than snapping on. At extreme zoom-out (< 0.10 with > 200 nodes) nodes switch to fast `fillRect` dot rendering; edges are skipped entirely below zoom 0.06.

**No jitter** — the simulation exits as soon as all nodes move < 0.2px/frame, rather than running a fixed number of ticks.

### Intelligence — mutation-aware ranking

The intelligence layer now tracks shorter-horizon behavior on top of lifetime vault statistics. Recent relation edits teach the system:

- which target types a field is being linked to *lately*
- which concrete notes are recurring as relation targets
- how that behavior shifts by note type being modeled this session

Live relation completion can now bias toward recent patterns. Low-history fields can recover relation intent from recent behavioral signals before vault statistics fully accumulate.

The planner threshold fix (Sugar, June 2026) ensures behavioral-prior classifications (`source: 'behavior'`) correctly reach HINT, COMPLETION_ONLY, and QUICKFIX thresholds — they were previously silenced by a missing source weight entry.

### Precise mutation events — `relation_added` / `relation_removed`

`relation_changed` is now split into three semantically distinct events:

- **`relation_added`** — a field links to a note for the first time (forming a link)
- **`relation_removed`** — a field is cleared (removing all targets)
- **`relation_changed`** — a field retargets (old value → new value, a "relink")

All surfaces reflect this: Home activity shows "Linked / Unlinked / Relinked" with distinct colors (mint / muted / purple). The entity History tab labels them accurately. `yamlink on relation_added -- ./hook.sh` now works as expected. The Conduit Explorer shows LINKED / UNLINKED / RELINKED badges.

### Smart Templates — staged authoring flow

`_templates/*.md` files now act as live schema definitions, not one-time scaffolds.

After Yamlink inserts a template, the cursor moves to the first unresolved field and can reopen completion automatically:
- bare relation fields like `unit:` reopen ranked relation candidates even before wikilink brackets are typed
- bare scalar fields like `rank:` reopen learned value vocabularies from similar notes

This turns Smart Templates from a scaffold drop into a continuous authoring flow.

### Scoped block and section references

Section references (`note#Heading`) and block references (`note^block-id`) are now first-class addressable targets:

- go-to-definition lands on the exact heading or block line
- hovering a heading anchor shows that section's content (up to 8 lines)
- separate authoring commands for section references and block references
- block-reference picking no longer mixes headings into the same action

### Visual Query Builder - v0.0.1

`Yamlink: Query Builder` opens a compact `View → Shape → Preview` panel:

- choose table, incoming/backlink, or task preset
- pick type, columns, filters, layout (table / matrix / bar / scatter), sort, limit
- see the exact generated `!view` text live before inserting
- sample rows rendered like the actual result
- opens in replace/refine mode when cursor is already inside a `!view` block

### Live Note mode

`Yamlink: Open Live Note` opens a compact rendered sidecar beside the active note. Stays synced while you keep writing source. Frontmatter fields, headings, and `!view` blocks have source-jump actions. Inherits VS Code backgrounds — behaves like a layer on the editor, not a separate app.

### Note Outline

The **Note Outline** sidebar view (`yamlink.noteOutline`) gives long notes the structure browser they deserve.

Each heading row shows per-section metadata: anchor link count (how many references from other vault notes point to this section), task count (tasks inside the section), wikilink mention count, and approximate word count — at a glance, per heading.

**Current-section tracking** keeps the active heading visible as your cursor moves through a long note. Unrelated branches auto-collapse. Click any row to jump to that line. `Ctrl+Alt+Down` / `Ctrl+Alt+Up` (`Cmd+Alt` on macOS) moves between sibling headings at the same level without touching the mouse.

**Search and filter** — `Yamlink: Search Note Outline` and `Yamlink: Note Outline Filters` narrow the heading tree. Filters preserve parent headings when a child matches so structural hierarchy stays visible.

Section-reference authoring is available from the outline item context menu — create a precise `note#Heading` reference without leaving the outline.

### Chart views — bar and scatter

`!view` blocks and the Query Builder can now render as bar charts, scatter plots, or matrix views — not only tables.

- **Bar chart** — aggregates a numeric field by type or any scalar group-by clause; bars are labeled and colored by the Apollo palette
- **Scatter plot** — two numeric axes; points are labeled with the note name or title field
- **Matrix view** — cross-tabulation: one field as row headers, another as columns, values at intersections

Useful for vaults with numeric fields like `score:`, `priority:`, `duration:`, or financial tracking fields. Select the layout in the Query Builder or set `layout: bar` / `layout: scatter` / `layout: matrix` directly in the `!view` block.

### Tag pill decorations

Hashtag mentions (`#topic`, `#status-open`) in note bodies are now decorated as styled pills in the VS Code editor across all workspaces. Tags are indexed alongside frontmatter `tags:` fields and surface in Note Report, Vault Health, and query completions.

### Task notifications

Yamlink can raise low-noise VS Code notifications for task management without requiring the Calendar panel to be open.

- **Overdue tasks** — notifies when tasks with a past due date exist in the vault
- **Due-today tasks** — notifies when tasks are due on the current date

Notifications are deduped so the same task set does not fire repeatedly on every rebuild. Configurable per vault via `yamlink.taskNotifications.enabled`, `yamlink.taskNotifications.includeOverdue`, `yamlink.taskNotifications.includeDueToday`, and a cooldown window.

### Vault Health — directional indicators

The Broken Links and Orphan Nodes counts in Vault Health now show a trend arrow (↑/↓) comparing today's count against the same count from up to 7 days ago. The direction is derived from a rolling `.yamlink/health-snapshots.ndjson` log written on every vault rebuild. An arrow only appears once enough snapshots have accumulated to show meaningful movement — a fresh vault stays quiet.

### View suggestion suppression

The "view suggestions available — click 💡 to insert" hint has a new option in the lightbulb menu: **Don't suggest views for this note**. Selecting it writes a suppression record to `.yamlink/suppress.json` keyed by note ID. The hint stops appearing for that note permanently, even across restarts. The underlying view builder is still accessible via the Yamlink command palette — suppression only silences the ambient hint.

### Vault projections

Vault Health and Home now include a forward-looking structural forecast across three lanes:

- **Growth** — recent note-creation pace by type, projected 90 days forward
- **Stale Pressure** — whether the vault is drifting toward a higher stale-note share
- **Structure Direction** — improving, steady, or fragile based on drift pressure and mutation behavior

Each lane carries evidence-weighted confidence (sparse vaults stay quiet), a 4-week trend memory, and a scenario layer for "if cleanup pace holds", "if cleanup improves", "if growth pace holds".

### Vault import depth

- Obsidian import strengthened: imported vault analysis now includes preserved non-Markdown files
- New `Yamlink: Import Vault Export` command: choose Roam Research, Notion, or Evernote
  - Roam: JSON page exports → Markdown with `id:`, daily-note detection, task macro conversion
  - Notion: extracted Markdown folder → wikilink rewriting, database row note generation, asset preservation
  - Evernote: ENEX → Markdown with attachment extraction under `_attachments/<note-id>/`
- All three importers: pre-import inspection pass, post-import cleanup actions (ID preview, safe `id:` assignment, wikilink rewrite)

### LSP server

`yamlink serve --lsp --vault <path>` — JSON-RPC 2.0 Language Server over stdio for Neovim, Zed, Helix, Emacs. 25 handlers including completion, hover, definition, rename, references, document symbols, workspace symbols, inlay hints, semantic tokens, formatting, code actions, diagnostics (push + pull), and document links.

---

## Who Sugar is for

**If you live in the terminal** — `yamlink` alone is now the entry point. Conduit gives you the full vault in 9 screens without opening VS Code.

**If you build tools** — `yamlink serve` is a real local database with writable endpoints and a live SSE stream. Any script, dashboard, or website framework can read and write your vault.

**If you manage a real vault** — the mutation event split means Home, Briefing, and Conduit all show accurate link formation vs. removal history. Intelligence now tracks what you're modeling this session, not only what you've done over the vault's lifetime.

**If you're in VS Code** — Smart Templates hand off into ranked follow-up completion. Scoped references are precise. Live Note lets you read while you write. Note Outline makes long notes navigable. Chart views make numeric vaults visual. Vault projections tell you where your vault is heading, not just where it stands.

---

For the previous release, see [CHANGELOG.md — Shujimi (0.6.0)](./CHANGELOG.md#060---shujimi).
