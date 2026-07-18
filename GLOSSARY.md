# Yamlink Glossary

Definitions for every term used across Yamlink's surfaces, commands, and documentation.

---

## Vault

**Vault** — the folder (or VS Code workspace) that Yamlink indexes. Every Markdown file at or below the workspace root is a potential vault note. Yamlink builds its graph and intelligence from the vault at activation and after every file change.

**Vault root** — the top-level workspace folder. Relative paths in `.yamlinkignore` and `_templates/` are resolved from here.

---

## Notes and Identity

**Note** — a single Markdown file that Yamlink has indexed. To be a full vault node, a note must have an `id:` field in its frontmatter. Notes without `id:` can still appear in backlinks and body-mention contexts.

**ID (`id:`)** — a stable, canonical identifier for a note. IDs are lowercase, hyphen-delimited (e.g., `johnny-rico`). The filename is cosmetic; the `id:` is the source of truth for graph edges, wikilinks, and rename propagation.

**Canonical ID** — the normalized form of an ID: lowercase, accent-stripped, spaces replaced by hyphens. All ID generation in Yamlink produces canonical IDs.

**Alias** — an alternate name for a note, declared in `aliases: [name1, name2]`. Yamlink registers aliases in the index so `[[alias]]` resolves exactly like `[[id]]` — in completion, navigation, diagnostics, and the graph.

**Type (`type:`)** — a frontmatter field that assigns a semantic category to a note (e.g., `contact`, `mission`, `account`). Yamlink uses `type:` for query filtering, schema binding, completion ranking, and intelligence inference.

**Frontmatter** — the YAML block between `---` markers at the top of a Markdown file. Yamlink reads `id:`, `type:`, `aliases:`, and all other fields from frontmatter to build its structured data model.

---

## Links and Relations

**Wikilink** — a `[[target-id]]` reference anywhere in a note's frontmatter or body. Wikilinks become directed graph edges from the source note to the target note.

**Relation field** — a frontmatter field whose value is one or more wikilinks (e.g., `account: [[acme-corp]]`). Relation fields carry semantic weight: Yamlink treats them as typed edges in the graph and as evidence for intelligence inference.

**Backlink** — a link pointing *to* a note from another note. The backlinks panel and Note Report both show backlinks grouped by relation field.

**Body link** — a `[[target-id]]` that appears in the note body (below the frontmatter), not in a named frontmatter field. Body links create graph edges but carry less semantic weight than relation fields.

**Display alias** — the label part of `[[id|Label]]`. Yamlink renders "Label" as the link text while resolving the graph edge to `id`.

**Embed** — `![[id]]` syntax. Creates a full embed edge in the graph, shows the dimmed `!` decoration, and supports Ctrl+Click navigation and broken-link diagnostics.

**Heading anchor** — `[[id#Section]]` syntax. Resolves to a specific heading in the target note; supported in navigation, completion, and diagnostics.

**Block ref** — `[[id^blockid]]` syntax. Resolves to a specific block in the target note.

---

## Graph

**Graph** — the in-memory directed labeled multigraph Yamlink builds from the vault. Nodes are indexed notes; edges are wikilinks labeled with the source field name (or `body` for body links).

**Outbound edge** — a directed edge from the current note to another note, produced by a wikilink in the current note's frontmatter or body.

**Inbound edge** — a directed edge pointing *to* the current note from another note. The backlinks panel shows inbound edges grouped by relation field.

**Graph workspace** — the full-panel graph view (`Yamlink: Open Graph Workspace`). Centered on the active note or a query result; supports search, type filtering, node drag, node info cards, and two visual layers.

**Sidebar graph** — the ambient mini-graph in the Yamlink sidebar panel, showing a constellation of the current note's immediate neighbors.

**Semantic layer** — a graph overlay that colors edges by source node type and draws direction arrowheads. Enables quick visual identification of note type clusters.

**Health layer** — a graph overlay that draws colored rings around nodes to encode lifecycle state and structural drift.

**Time-lapse** — a play/pause/rewind control in both graph surfaces that animates the vault's graph growing over time, driven by repeated reconstructions from `?at=<timestamp>`-style historical snapshots (see Time Engine). Two reconstruction paths: if the vault is a git repository, checkpoints are read from real historical file content at the nearest commit (frontmatter and body-text mentions both reconstruct); otherwise the mutation log is used, which tracks frontmatter changes always and body-text mention changes going forward from when that tracking shipped (2026-07-15). New nodes and edges fade in rather than appearing instantly; the first frame is always genuinely empty.

---

## Query Language

**View block (`!view`)** — a fenced block in a note's body that defines a live query. Yamlink executes the query and renders the result as an interactive table in the View Panel.

**Query type** — the first token after `!view`, which selects which notes to query (e.g., `!view contact`, `!view *`). The wildcard `*` matches all note types. The keywords `tasks`, `today`, `upcoming`, `calendar`, `overdue`, and `undated-tasks` are preset shortcuts.

**`where` clause** — a filter condition in a query. Supports `=`, `!=`, `contains`, `>=`, `<=`, `>`, `<`, `is empty`, `is not empty`, `exists`, and `#tag` shorthand.

**`select` clause** — controls which fields appear as columns in the result table. Example: `select name, account, created`.

**`sort` clause** — orders results by a field, ascending by default. Append `desc` for descending. Example: `sort created desc`.

**`limit` clause** — caps the number of result rows.

**`group by` clause** — groups results by a field value and shows per-group counts.

**`via` clause** — filters an incoming-relation query to a specific relation field. Example: `!view incoming via account`.

**`incoming`** — a special query type that returns all notes that link *to* the current note. Example: `!view incoming`.

**`file.created`** — implicit query field that resolves to a note's file system birthtime as `YYYY-MM-DD`. Useful for filtering or sorting by file age. Example: `where file.created >= 2026-01-01`.

**`file.modified`** — implicit query field that resolves to a note's last file system modification time as `YYYY-MM-DD`.

---

## Schema

**Schema node** — a note with `type: schema` and `target: <typename>`. Defines the expected field structure for notes of that type. One schema per type is canonical; duplicate schemas generate a diagnostic.

**Schema field** — a field definition inside a schema node's body, specifying the field name, type (`string`, `relation`, `date`, `number`, `boolean`), and whether it's required.

**Schema-first scaffolding** — when creating a new note of a type that has a schema, Yamlink builds the frontmatter from the schema's field definitions instead of inferring from vault patterns.

**Template** — a Markdown file in `_templates/` that serves as a structural model for notes of a specific type. Templates can have an `id:`, `type:`, and any fields; Yamlink fills in the date and ID at creation time.

**Template drift** — a structural mismatch between an existing note and its matching template. Drifted notes show a yellow squiggle on the `type:` line and appear in the Vault Health Template Drift section.

---

## Intelligence

**Adaptive intelligence** — Yamlink's vault-learning system. Observes real field usage, relation patterns, and co-occurrence across the vault to generate context-aware suggestions — without requiring a schema or fixed field list.

**Field role** — a semantic category assigned to a field based on its name and values: `date`, `status`, `person`, `container`, `topic`. Field role drives completion ranking and Note Report display.

**Field category** — a broader classifier that combines schema evidence, hard name patterns, vault priors, wikilink ratio, descriptive patterns, and body corroboration to categorize a field's purpose.

**Confidence band** — how strongly Yamlink believes a suggestion is correct: `high`, `medium`, or `low`. Higher confidence triggers more prominent surfaces (DOCUMENT, QUICKFIX). Lower confidence stays quiet (SILENCE, COMPLETION_ONLY).

**Vault priors** — statistical maps computed from the vault: which field names co-occur with which types, which fields point to which target types, and how ambiguous each field is across types. Updated once per vault mutation, then cached.

**Note role** — a coarse semantic classification of a note from its observed structure: `person`, `event`, `artifact`, `container`, `topic`. Drives adaptive field suggestions and Note Report framing.

**Lifecycle state** — where a note sits in its evolution: `draft` (sparse, new), `growing` (accumulating connections), `consolidated` (stable, well-connected), `hub` (highly linked), or `stale` (inactive). Shown in Note Report, Vault Health, and the graph health layer.

**Structural drift** — how much a note diverges from the vault's learned structural patterns for its type: `on-track`, `minor-drift`, `drifting`, or `outlier`. A drifting note may be missing common fields or have unusually few relations.

**Drift score** — a numeric measure of structural divergence from the learned vault bundle for the note's type. Used to drive the `drifting` / `outlier` lifecycle states and the graph health layer.

**Outcome calibration** — a feedback loop where relation completion acceptances (Enter/Tab on a `[[` candidate) are persisted to the mutation log as `completion_accepted` events. On each vault generation, a per-field acceptance count is computed and fed back into the field classifier as a confidence boost. Fields whose completions you've confirmed before are suggested with slightly higher confidence next time.

**Note arc prediction** — the system's answer to "what does this note need next?". Compares the note's current field set against the canonical field bundle for its type and returns ranked missing fields scored by vault frequency and calibration history. Surfaces in two places: the Note Report Overview tab ("Likely missing" section, each row with a `+` button for one-click insert) and frontmatter field name completion.

**Unlinked references** — body-text mentions of a note's name or ID in other notes' bodies, without a formal `[[wikilink]]`. Detected by word-boundary matching (case-insensitive), with wikilink content stripped before scanning. Surfaced in the Note Report Links tab. Lets you discover organic mentions before formalizing the link — the Roam Research discovery pattern.

**Implicit field weights** — knowledge derived from the mutation log about which fields you've historically used as relations. A field used as a wikilink relation in the past stays classified as relational even if the vault has since been restructured and those links removed. The system's knowledge of field vocabulary is sticky.

**Relationship gravity** — a score for how much weight a specific `(source, field, target)` edge carries, beyond the binary fact that it exists. Combines structural corroboration (how many distinct fields on the source note point at the same target) with decayed mutation-log repetition (how many times, and how recently, that exact relationship was set or reaffirmed). Never gates anything — pure ranking signal. Drives Note Report's relation-list ordering and Vault Health's vault-wide "Most-Reinforced Connections" card, which surfaces only edges with real corroboration, excluding single-instance links.

**Session summary** — a plain-count recap of a set of mutation events (notes created, fields added, relations formed/changed, tasks changed, completions accepted, templates applied). Powers Vault Health's Activity tab "today at a glance" strip and the CLI's `yamlink session` command.

**Workflow burst** — a detected cluster of 3+ notes touched by the same mutation-event type within a 60-second window — a signal for bulk edits, imports, or batch operations rather than steady incremental editing. Surfaced as a callout on Vault Health's Activity tab.

---

## Surfaces

**Note Report (Entity Hub)** — a five-tab sidebar panel showing a focused view of the active note: Overview (scalar fields, role, lifecycle), Links (outbound and inbound grouped by field), Tasks (task lines and timeline), Views (contextual query recipes), and History (mutation event log).

**Vault Health** — a panel showing the structural state of the whole vault: health score, type distribution, orphan notes, lifecycle distribution, template drift, and Today's Activity.

**View Panel** — the interactive table surface that renders `!view` query results. Supports inline cell editing, column sorting, search, type filters, column value filters, pagination (for large result sets), and PDF export.

**Calendar** — a date-aware panel showing notes with `date:`, `created:`, or task due dates in month / week / day views, with keyboard navigation.

**Task Center** — a sidebar tree view (added 2026-07-16, alongside Graph/Note Report/Calendar/Note Outline) listing every task in the vault, grouped into Overdue/Today/Upcoming/Undated/Done. Real native checkboxes mark a task done, writing back to the `- [ ]`/`- [x]` line directly; clicking a task jumps to its exact line. See Task priority, below.

**Task priority** — an explicit, opt-in `#urgent`/`#medium`/`#low` marker written directly in a task line (`#high` and `#medium-priority` also recognized as synonyms). A closed vocabulary, never inferred from task wording. Shown as a colored circle in Task Center (🔴/🟡/⚪) and sorts a task to the top of its status bucket — priority orders *within* a bucket, it never overrides which bucket (Overdue/Today/etc.) a task lands in. An overdue task marked urgent also escalates Yamlink's task notification to VS Code's error level.

**Graph workspace** — see Graph, above.

**Hover card** — a pop-up that appears when hovering over a wikilink. Shows the target note's type, lifecycle state, key fields, and relation count.

**Completion** — VS Code's autocomplete surface. Yamlink populates it with relation candidates (ranked by vault context), frontmatter field names (ranked by type and role), date shortcuts (`@today`, `@tomorrow`, etc.), heading anchors, and query clause tokens.

**Lightbulb (Code Action)** — a VS Code quick-fix icon that appears on fields where Yamlink has a structural suggestion: create a missing linked note, add a missing relation field, backfill frontmatter from a template, or promote a repeated body link to a frontmatter field.

**CodeLens** — a subtle inline action above `!view` blocks offering "Run", "Refine", and "Query Builder" shortcuts.

**Diagnostic** — a squiggle annotation on a note. Yamlink produces diagnostics for broken wikilinks, duplicate IDs, required schema fields that are missing, and notes that drift from their template.

---

## Actions and Commands

**Quick capture (`yamlink.newNote`)** — the unified note-creation command. Pick a type (templates shown first), enter a title, and Yamlink derives the ID and scaffolds the frontmatter from the best available source: template → schema → vault-pattern inference.

- **Keybinding**: `Ctrl+Alt+N` (Windows / Linux), `Cmd+Alt+N` (macOS)
- **L3 contextual linking**: when triggered from inside an existing Yamlink note, offers to add a reverse relation field in the new note, automatically linking it back.

**Daily note (`yamlink.openDailyNote`)** — opens or creates today's journal note (`journal-YYYY-MM-DD.md`). Uses `_templates/journal.md` if present; otherwise creates a stub with `id`, `type: journal`, and `date` pre-filled. Cursor placed after frontmatter for immediate writing. Journal notes are first-class: queryable, linkable, visible in Calendar.

- **Keybinding**: `Ctrl+Alt+J` (Windows / Linux), `Cmd+Alt+J` (macOS)

**Home panel (`yamlink.openHome`)** — a webview panel that serves as the vault's home screen. Shows a vault pulse bar (note count, type count, broken links), activity feed (last 15 mutation events, clickable), continue-working list (5 most recently touched notes), and nudge cards for broken links and untyped notes. Auto-opens once on first vault activation.

**Natural language query (`yamlink.naturalQuery`)** — the "Yamlink: Query in Plain English" command. Accepts a plain-English description and generates the equivalent `!view` block using 16 sentence pattern templates and vault vocabulary injection (types, fields, values, IDs). The generated query is shown in a preview before insertion. The `!view` query language itself is unchanged — this is a generator and learning tool.

**Note splitting (`yamlink.splitNoteBody`)** — "Yamlink: Extract Selection to New Note". Selected body text becomes the body of a new note; the first heading or non-blank line of the selection becomes the title; the original selection is replaced with `![[new-id]]` (an embed); `source: [[original-id]]` is written into the new note's frontmatter. Distinct from `yamlink.newNoteFromSelection`, which uses the selection as the new note's title.

**Add Missing Creation Dates (`yamlink.backfillCreatedDates`)** — scans the vault for notes without a `created:` field and writes the file system birthtime (falling back to mtime) to each. Shows a warning about birthtime reliability before writing.

**Rename propagation** — when a note's `id:` changes, Yamlink updates all `[[wikilinks]]` across the vault that referenced the old ID — in frontmatter relation fields and note bodies.

**Vault-wide rename** — triggered by the VS Code rename symbol command on an `id:` field. Yamlink finds and updates every link to the renamed ID.

**View Builder** — an interactive UI for constructing `!view` queries without writing the query syntax manually. Accessible from the CodeLens above any `!view` block.

**Index** — the in-memory data structure Yamlink maintains: `idIndex` (ID → file path), `pathIndex` (file path → ID), and `fieldsCache` (ID → all frontmatter fields). Rebuilt on workspace open and updated incrementally on file saves.

---

## Files and Conventions

**`.yamlinkignore`** — a file at the workspace root that lists paths to exclude from the vault index, graph, rename propagation, and all intelligence paths. Supports three rule formats:
- `dirname/` — excludes a directory by name (trailing slash)
- `path/to/file.md` — excludes a specific path (contains `/`)
- `filename.md` — excludes all files with that basename

**`_templates/`** — a folder at the vault root containing template files for note creation. Files inside are excluded from the vault index.

**`YYYY-MM-DD`** — canonical date format used by Yamlink throughout: query comparisons, `created:` and `date:` fields, calendar entries, and `file.created`/`file.modified` virtual fields.

**Mutation event log** — a persisted log at `.yamlink/mutation-log.ndjson` that records structural changes to vault notes: `note_created`, `type_set`, `field_added`, `field_changed`, `field_removed`, `relation_changed`. Powers the Note Report History tab and Today's Activity in Vault Health.

---

## Platform

**Conduit** — Yamlink's terminal UI (`yamlink conduit`). A full-screen, stateful, keyboard-driven application — not a pretty wrapper around CLI commands. Think lazygit or k9s. Nine screens switchable with number keys: Briefing `[1]`, Query `[2]`, Navigator `[3]`, Explorer `[4]`, Health `[5]`, Search `[6]`, Graph `[7]`, Diff `[8]`, Radar `[9]`. Talks to the API server over HTTP and receives live vault events via SSE. Does not poll — updates are push-only.

**Briefing** — both a CLI command (`yamlink briefing`) and the Conduit home screen `[1]`. Shows vault pulse (note/edge/type counts), open and overdue tasks, recent mutation activity, arc predictions for recently-touched notes, and a structural drift flag. The morning review surface.

**JUMP TO** — the universal fuzzy finder overlay in Conduit. Opened by pressing any letter on a non-text screen (or `:` / `Ctrl+P` anywhere). Searches across all notes, commands, and types in a single ranked list. `j`/`k` to move, `Enter` to jump, `Esc` to dismiss.

**Split pane** — a Conduit layout mode where two panes share the screen side by side. Explorer's split mode compacts the type and note columns to fit in the left half, keeping the detail panel visible alongside another screen.

**Spatial bookmark** — a named slot (`m0`–`m9`) in Explorer that records the current screen, type filter, and selected note. Jump to any bookmark with `'0`–`'9`. Bookmarks survive restarts, stored in `.yamlink/conduit-bookmarks.json`.

**Saved context** — a named Explorer state (type filter, search text, selected note) saved with `S` and restored with `R`. Contexts survive restarts, stored in `.yamlink/conduit-contexts.json`.

---

## Architecture

**VaultService** — the shared headless rebuild coordinator (`src/core/vaultService.js`). Serializes file writes and post-write rebuilds as one atomic unit via `mutate(writeFn)`. File-watcher rebuilds flow through `notifyFileChange()`. All surfaces — API, LSP, CLI — share the same service so generation bumps, diagnostics publishes, and mutation event fanout happen once per rebuild, not once per consumer.

**Generation** — an integer that increments on every completed vault rebuild. Exposed on every API response as `X-Yamlink-Generation`. All intelligence caches are keyed by generation so stale data is structurally impossible — a cache miss is a generation mismatch, not a timeout. The generation counter is also the invalidation signal for Conduit and SSE clients.

**SSE (Server-Sent Events)** — the live-update transport. `GET /api/events` opens a persistent connection; Yamlink pushes fine-grained mutation events (`note_created`, `field_changed`, `relation_added`, etc.) and a final `{ type: "rebuild", generation }` event after each index rebuild. Conduit subscribes to this stream so all nine screens update live without polling.

---

## CLI

**`yamlink` CLI** — a standalone terminal tool (`npm link` from the project folder) for querying, inspecting, and mutating a vault without VS Code. 37 commands. Every command supports `--vault <path>` (default: current directory) and `--json` for machine-readable output.

| Command | Description |
|---|---|
| `yamlink init [path]` | Scaffold a new vault (creates `.yamlink/`, `_templates/`, `welcome.md`) |
| `yamlink build` | Index vault, report broken links and duplicate IDs; exits 1 in CI if issues found |
| `yamlink briefing` | Morning summary: vault pulse, overdue/today tasks, recent activity, arc predictions, drift flag |
| `yamlink health` | Vault overview: note count, type distribution, broken links, orphan nodes, lifecycle distribution |
| `yamlink validate` | Schema conformance check; exits 1 on required-field violations. `--check schema|broken-links|duplicates` |
| `yamlink doctor` | Deep integrity audit: broken links, duplicates, arc gaps, stale notes, schema violations |
| `yamlink status` | Fast machine-readable vault snapshot for scripts (`{ notes, types, edges, brokenLinks, generation }`) |
| `yamlink ls` | List notes with unix-style filtering (`--type`) and sorting (`--sort`) |
| `yamlink cat <id>` | Frontmatter snapshot + body. `--at <date>` reconstructs historical frontmatter (no body) |
| `yamlink grep <text>` | Search frontmatter values for matching text. `--type`, `--field` to narrow |
| `yamlink find` | Structural search by present/missing fields. `--has`, `--missing`, `--type` |
| `yamlink query "<clause>"` | Run a query using the same language as `!view` blocks; ASCII table or `--json` |
| `yamlink search <query>` | Fast ID/name/title/type lookup. `--type`, `--field` to narrow |
| `yamlink report <id>` | Full note report: type, lifecycle state, drift, and all links. `--at <date>` for a historical report (fields + outbound only) |
| `yamlink links <id>` | Outbound and inbound links, with broken-link markers. `--at <date>` for outbound-only historical links |
| `yamlink diff <id-a> <id-b>` | Compare two notes' frontmatter field sets, or `--since <date>` for vault-wide field changes |
| `yamlink story --since <date>` | Vault growth story via the Time Engine: note/type-count deltas, activity, busiest notes |
| `yamlink mutations` | Show recent mutation events. `--limit`, `--since`, `--type` to filter |
| `yamlink session` | Summarize recent or explicit mutation sessions. `--id` |
| `yamlink lenses` | Vault-wide change lenses over mutation history (most-edited, fastest-growing types) |
| `yamlink suggest <id>` | Field/relation suggestions for a specific note (CLI-side arc/completion parity) |
| `yamlink drift` | Notes structurally drifting from their type's learned bundle. `--type`, `--limit` |
| `yamlink stale` | Notes in a stale lifecycle state. `--type`, `--limit` |
| `yamlink orphans` | Notes with no inbound or outbound links. `--type`, `--limit` |
| `yamlink pressure` | Knowledge pressure: load-bearing drafts, stale hubs, orphans |
| `yamlink set <id> <field> <value>` | Set or remove a frontmatter field. `--clear`, `--dry-run`, emits mutation events |
| `yamlink link <id> <field> <target>` | Add a `[[wikilink]]` relation field. `--append` for multi-value fields |
| `yamlink create <type>` | Create a note non-interactively. `--field key=value` for any frontmatter field |
| `yamlink rename <old> <new>` | Vault-wide ID rename + wikilink rewrite. `--dry-run`, `--rename-file` |
| `yamlink graph` | Export full vault graph as `{ nodes, edges }` JSON. `--only-types` to filter, `--at <date>` for a historical reconstruction |
| `yamlink schema list` | List all schema notes with governed types and note counts |
| `yamlink schema check <type>` | Check schema conformance for all notes of a type. `--all` for every schema |
| `yamlink export` | Export vault as JSON or CSV. `--query` to filter, `--output` to write to file |
| `yamlink env` | Export shell variables for the current vault. `--shell bash|zsh|fish` |
| `yamlink watch` | Persistent watcher — rebuilds on `.md` saves, prints timestamped one-liners |
| `yamlink on <event> -- <script>` | Automation hooks: execute a script on matching mutation events. `--type` to filter |
| `yamlink completions bash\|zsh` | Print shell completion script for tab-completion |
| `yamlink serve` | Local HTTP API server (default port 3000). Full reference: `docs/api/README-API.md`, `CONTRACT.md` |
| `yamlink conduit` | Open the Conduit terminal UI. Requires `yamlink serve` running on the same port |

---

## Time Engine

**Time Engine** — Yamlink's historical-state reconstruction system (`src/core/timeEngine.js`). Since the mutation log only ever records *deltas* (`note_created`/`note_deleted` carry no field snapshot), reconstruction works backward: starting from a note's real current fields, it undoes every recorded mutation newer than a target timestamp using each event's `oldValue`.

**`reconstructNoteAtTime(id, timestamp)`** — reconstructs a single note's fields as of a past moment. Returns `exists`, `fields`, `complete`, and `earliestReconstructableTimestamp`.

**`reconstructVaultAtTime(timestamp)`** — reconstructs every note in the vault at once, including "ghost" entries for notes that existed then but have since been deleted (honestly `fields: null` — deletion never captured a snapshot).

**`buildNoteTimeline` / `buildFieldTimeline`** — the multi-point layer: forward-replays from a known-good anchor state across a note's full mutation history, producing a sequence of checkpoints (e.g. `status: draft (Jan 3) → growing (Feb 1) → consolidated (Mar 15)`).

**`complete` / `earliestReconstructableTimestamp`** — the honesty contract every reconstruction result carries. `complete: true` means the reconstruction is provably exact back to the note's real birth (its creation event is still within the mutation log's 10,000-event retention window). `complete: false` means it's only guaranteed accurate back to `earliestReconstructableTimestamp` — reported rather than silently presenting a partial answer as certain.

**`?at=<timestamp>`** — the API query param exposing time travel on `GET /api/nodes/:id` and `GET /api/graph`.

**`--at <date>`** — the CLI flag exposing the same on `cat`, `report`, `links`, and `graph`. Each command scopes down to what it can actually reconstruct (no note body, no live-vault-priors inferences like lifecycle/drift, outbound-only where inbound would need a full-vault reconstruction).

**`yamlink story --since <date>`** — the CLI's narrative consumer: reconstructs the vault at a past date and reports note/type-count growth, mutation-log activity since then, and the busiest notes by edit count.
