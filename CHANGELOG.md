# Changelog

## 0.7.6

0.7.6 is a quick follow-up release, mainly to fix real problems that shipped in 0.7.5 and should have been caught before it went out: the in-editor "What's New" notice still showed 0.7.4's release notes to every updating user, block IDs silently stopped working entirely on any note saved with Windows line endings, and a multi-value relation field could render with corrupted, missing brackets in the hover card. Alongside those fixes, block-level backlinks — knowing which notes link to a specific task, quote, heading, or footnote inside a note — are now reachable outside VS Code too, via a new CLI command and API parameter.

### CLI

- **`yamlink block-backlinks <note-id> [--block <block-id>]`** — shows every note linking to a specific task, quote, heading, or footnote inside the given note, not just which notes link to the note as a whole. Without `--block`, lists backlinks to every addressable block in the note; with it, filters to one exact block.

### API

- **`GET /api/nodes/:id?include=blockBacklinks`** — the same data as the CLI command above, over HTTP, as `_blockBacklinks: [{ targetBlockId, targetLabel, targetKind, sourceId, sourceLabel, sourceType, kind, line }]`. Composes with the other `include` values (`?include=body,blockBacklinks`, etc.).

### Fixed

- A note saved with Windows CRLF line endings got **zero** block IDs at all — no headings, tasks, quotes, or footnotes were recognized, silently disabling hover, completion, go-to-definition, and block backlinks for that note entirely. Caused by splitting body text on a bare `\n`, which left a trailing `\r` on every line that the block-detection patterns could never match past. Fixed; block IDs now compute correctly regardless of line-ending style.
- A multi-value relation field (a YAML list like `contacts:` with several entries, which the frontmatter parser flattens into one comma-joined string) rendered in the hover card with the first and last entries silently corrupted — missing their leading or trailing brackets — while entries in the middle were unaffected. Caused by a check meant to detect "this value is a single wikilink" that also matched a multi-value string by accident, then stripped only the outermost two characters on each end. Fixed; every entry in a multi-value field now renders correctly and, when resolvable, as its own clickable link.
- The in-editor "What's New" notice shown after updating still described 0.7.4, not 0.7.5 — every user who updated saw the wrong release notes. Fixed.

## 0.7.5

0.7.5 is about Yamlink working outside the editor as potently as it does inside it. The local API can now read a note's raw text and its real file dates, mark a task done or reopen it, and hand over the vault's glossary — the same things you can already do by hand in VS Code, now scriptable. It also has its first way to "lock the door": an optional token, since until now anything on your machine could read or write your vault through it with no login at all. A new plugin API lets another VS Code extension contribute its own small, explainable opinion to Yamlink's field-guessing, without being able to touch your notes directly.

Inside the editor, the same Growth/Stale/Structure forecasting Vault Health already showed is now available everywhere — CLI, API, and a new Conduit screen — instead of being stuck in one panel. Two new graph-derived numbers (`_inbound_count`, `_outbound_count`) and a prominence score (`_hub_score`) can be used directly in queries without declaring anything. And a round of polish: Query Builder explains its own queries in plain language, Task Center's backlog view stops dominating the screen, and Yamlink's link suggestions show you *why* it's suggesting something instead of a cramped, cut-off line of text.

Three more capabilities round out the release. `yamlink snapshot` and `yamlink restore` give the vault a real backup / point-in-time-recovery pair — take a checkpoint on demand, or preview (and optionally export) what the vault looked like at any past moment, without ever touching the live files. Turning any filled-in note into a reusable blank template for its type is now one CLI command, one Command Palette entry, or one right-click away. And Smart Paste notices when what you're pasting into a note is actually structured — a spreadsheet range, a Markdown table, a JSON object, a task list — and offers to convert it instead of dumping raw text into the note.

### CLI

- **`yamlink snapshot [--reason <text>]`** — takes an on-demand snapshot of the vault's current state, the same underlying mechanism the Time Engine already uses internally whenever the mutation log fills up. Useful as a manual checkpoint before a risky bulk edit.
- **`yamlink restore <timestamp> [--output <path>]`** — reconstructs the vault as it looked at a past point in time. Preview-only by default (reports what would come back, writes nothing); `--output <path>` writes the reconstructed notes to a separate directory — it will never write into your live vault.
- **`yamlink trends`** — the same Growth/Stale/Structure forecasting Vault Health already shows, now readable from the terminal: current trend, retrospective accuracy (did last quarter's projection actually hold up), and which notes are closest to going stale.
- **`yamlink template save <id>`** — turns any existing, filled-in note into a reusable blank template for its type. Refuses to overwrite an existing template for that type unless you pass `--force`.
- **`yamlink glossary --type <a,b>`** — an always-current, alphabetized glossary of your vault's own concept/term notes: each entry's real definition (from a `definition:`/`summary:` field, or its own first paragraph if neither exists) plus every note that links to it. Nothing is ever written to disk — it's computed fresh from the vault every time you run it.

### API

- **`GET /api/intelligence/trends`** — the same forecasting data as `yamlink trends`, for scripting or a custom dashboard.
- **`GET /api/glossary?types=<a,b>`** — the same glossary data as the CLI command above, over HTTP. `types` is required (Yamlink won't guess which note types count as terms); optional `groupByType`, `sortBy`, `hideUnreferenced`, and `extraFields` params match the CLI's own flags.
- **`PATCH /api/tasks`** — toggles one task's checkbox from outside the editor: `{ noteId, line, done }`. Uses the exact same write path as VS Code's own live tables, so a task flipped through the API shows up identically in the vault's history.
- **`GET /api/nodes/:id?include=body`** — returns a note's raw, verbatim body text alongside its frontmatter fields, opt-in so it doesn't bloat every response by default.
- **`GET /api/nodes/:id?include=timestamps`** — returns a note's real filesystem creation and modified dates, not just what's written in its frontmatter.
- **`POST /api/query`** — run a `!view` query whose text is too long or awkward to put in a URL. Failed queries also now explain *why* they failed instead of a generic error.
- **Optional authentication** — the API has always accepted any request with no login of any kind, which is fine for a purely local tool but means any other program on your machine (including a browser tab) could reach it. Set `YAMLINK_API_TOKEN` before running `yamlink serve` to require a matching `X-Yamlink-Token` header on every request going forward. This is entirely optional — leave it unset and nothing changes from before. When it's left unset, `yamlink serve` now prints a visible reminder on startup so the choice is a conscious one, not an accident.

### Plugin API (new)

A VS Code extension can now register its own function to contribute a small extra opinion to Yamlink's own guesswork about a frontmatter field — for example, "I think this field is a relation, here's why." This is intentionally narrow: a registered function can only read, never write to your vault; it can't see what any other registered plugin is doing; and every opinion it gives must come with a stated reason, or Yamlink discards it — the same "always explain yourself" rule every one of Yamlink's own built-in signals already follows. Its effect on any single decision is also capped, so no one plugin can override what Yamlink's own evidence already concluded. This is a first version aimed at VS Code specifically; the LSP server (used by other editors) has no equivalent third-party extension mechanism to hang this on.

### VS Code

- **Query Builder polish & QOL** — the builder now explains the query it's building in a plain sentence ("This will show 9 character notes, sorted by hub score, with name/status/unit columns"), offers one-click "Fast Starts" for common queries (Most connected, No incoming links, Recently modified, Recently created), and includes the new computed fields (`_inbound_count`, `_outbound_count`, `_hub_score` — see "Query engine" below) in its field picker.
- **Task Center polish & QOL** — shorter bucket labels, and the Undated bucket (often the largest and least useful to see in full) is now collapsed by default with a "Show more" option, so a big untriaged backlog doesn't push everything else off-screen.
- **Save a note as a template** — via the Command Palette or right-click on an open note, in addition to the CLI command above.
- **Vault Glossary panel** — Create a glossary for your most frequented vault terms, concepts, etc. The same glossary as the CLI command above, as a dedicated VS Code panel with live search, sorting, collapsible sections, and a copy-as-Markdown button.
- **Richer completion suggestions** — when Yamlink suggests a note to link, the suggestion now shows that note's type and status as small colored badges, plus how many other notes already link to it — replacing what used to be a single line of grey text that could get cut off entirely once there was enough to say.

### Query engine

- **Computed fields** — `_inbound_count`, `_outbound_count`, and `_hub_score` (the same graph-prominence score that already sizes nodes in the graph view) can now be used directly in any `!view` query's `where`, `select`, or `sort` clause, with no frontmatter declaration required — the same way `file.created`/`file.modified` already work.

### Editing

- **Smart paste** — pasting a spreadsheet-style table, a Markdown table, a JSON object, or a bulleted/numbered list into a note now offers to convert it instead of pasting raw text: a `!view` query, a batch of new notes (with an ID preview before anything is created), a frontmatter block, or real task lines.

### Fixed

- The empty-field quick-fix (lightbulb) never appeared for a relation field on a vault with no schema notes — and when it did appear, it could suggest a value that isn't a real note at all. Both fixed on VS Code and the LSP server; suggestions now always resolve to a real note.
- Creating a note from a broken link could silently fill in a guessed link back to where it came from, even with no real evidence for which field was right. Now only filled in automatically when the vault has real evidence for it; a weaker guess is offered as a one-click confirmation on VS Code instead of being applied silently, and the LSP server (which never had this at all) now has the evidence-backed version.
- On a small vault where several fields are used equally often, some could be silently left out of "expected fields" suggestions (including the empty-field lightbulb) purely because of alphabetical order.
- Emptying a relation field could show every suggestion twice in the completion list.
- `.yamlinkignore` had no wildcard support at all — `*`, `**`, and `?` were matched as literal characters, not patterns. Reported from a multi-root workspace where a folder couldn't be excluded without listing every path exactly; fixed for single-root vaults too. Note that `.yamlinkignore` still only governs the folder it's placed in — a multi-root workspace needs one per folder you want covered.
- "Ignore this suggestion here" never appeared for a broken-link diagnostic on body text (only inside frontmatter) — so a false positive in ordinary prose (documentation explaining `[[wikilink]]` syntax, for example) had no way to be dismissed. Worse, even where the ignore quick fix did exist, dismissing it never actually changed how the text looked: the faded/muted styling was computed entirely separately from the diagnostic it was based on, with no awareness of what had been dismissed. Both fixed — the quick fix now appears for body-text broken links too, and ignoring one now un-mutes the text immediately, not just the diagnostic.
- The LSP server could answer a `textDocument/completion` request with a stale index right after a file was created or changed on disk: a watched-file notification schedules a debounced rebuild rather than rebuilding immediately, and completion requests weren't waiting for it. Fixed by having completion flush any in-flight rebuild first, so it always reflects the latest change.


## [0.7.4] — Platform Depth

The Time Engine reaches every surface, Vault Projections rebuilt on real historical reconstruction, Task Center, a guided tour, custom hover cards, Conduit's new live spatial graph view, and an Intelligence Engine depth pass — plus a monolith-decomposition pass across Conduit, actions, and importers.

### Time Engine

- **`?at=<timestamp>` time travel** — `GET /api/nodes/:id` and `GET /api/graph` reconstruct any note, or the whole vault graph, as it looked at a past moment from the mutation log, not a stored snapshot. Responses report `complete: true`/`false` honestly when reconstruction can't be proven back to a note's real birth, and a note that existed at the target time but was later deleted returns `exists: true, fields: null` rather than a guess.
- **`--at <date>` on `cat`, `report`, `links`, `graph`**, and a new **`story --since <date>`** — the CLI's everyday inspection commands now reach into vault history. `story` reports growth since a date: note counts then vs. now, fastest-growing types, activity in the window, busiest notes by edit count.
- **x-graph time-lapse** — play back vault growth in both graph surfaces (workspace panel and sidebar). Reconstructs each checkpoint from real git history when the vault is a git repo, including body-text mentions; falls back to the mutation log otherwise, which now also tracks body-text mention changes going forward. Playback holds one fixed, pre-settled layout and only reveals/hides nodes and edges over it, so positions never move during playback.
- **Vault Projections rebuilt on real historical reconstruction.** Replaces the old rolling 4-week-window linear multiplier with `src/intelligence/vaultTrends.js`: reconstructs the vault at real historical checkpoints and fits a genuine least-squares trend line (reporting R²) across all three lanes — Growth, Stale, Structure. Adds retrospective accuracy scoring (what the model would have projected 90 days ago, compared to what actually happened) and per-note staleness forecasting (which specific notes go stale soonest, ranked by days remaining).

### Conduit

- **Live spatial graph view** — press `v` on the Graph screen for a constellation layout: the focused note centered with branching, numbered lanes to each connection, labeled and colored by note type with a legend, honestly paginated past a connection-count cap. Updates live over SSE as relations change.

### Intelligence

- **Temporal confidence from mutation volatility** — fields revised often carry a small confidence penalty in classification; fields set once and never touched again get a small boost.
- **Suggestion cascade** — accepting a relation-field completion offers a one-click nudge for the note's next likely-missing field, when the arc model is confident.
- **Natural-language write actions** — the plain-English query box recognizes write-intent phrasings ("archive all missions with status failed") alongside its existing read-only `!view` generation.
- **Schema-proposal action closes its own loop** — creating a schema note from a detected cluster now offers to back-fill the new fields onto the cluster's own member notes.
- **Pre-schema field emergence** — completions on an untyped or pattern-less note favor a real repeated field pattern already present in the vault over the old generic starter list.
- **Relationship gravity** — Note Report's relation lists rank by corroboration (multiple fields pointing at the same note, reinforced over time) instead of index build order.

### VS Code

- **Custom hover cards** — `type`/`status` render as Apollo-colored pill badges inside VS Code's native hover; relation and body wikilinks are clickable rather than literal bracket text.
- **`![[image.png]]`-style embeds** resolve consistently across hover, link styling, and Ctrl+Click.
- **Task Center** — a dedicated sidebar view listing every vault task grouped into Overdue/Today/Upcoming/Undated/Done, with native checkboxes and jump-to-line. Supports `#urgent`/`#medium`/`#low` priority markers, shown as a colored dot, used for in-bucket sort order and escalated notifications.
- **Guided tour** — a first-run walkthrough covering Home, Calendar, Vault Health, Graph, and Task Center.
- **Vault Health depth pass** — Emerging Patterns also shown on the Schema tab; a new Most-Reinforced Connections list on the Intelligence tab; the Activity tab opens with a plain-count summary and workflow-burst detection.
- **Vault Health terminology explainers** — every jargon term and tab now has a "?" with a plain-language definition.
- **Graph console** — a Labels control (Auto/All/Off), "?" explainers for Signal/Themes/Relations/Semantic/Health, real inline icons in place of emoji transport controls, a longer and more visible time-lapse fade-in, and a true off-black canvas background matching the rest of the product.
- **Editor topbar and right-click menu reorganized** — Live Note takes the topbar slot the older Preview panel used to occupy; Export to PDF is now also a right-click action; all 9 right-click note/reference actions are grouped under one "Yamlink" submenu.

### API

- **`CONTRACT.md`** — a flat method/path/params/response/error-code reference for every endpoint, generated from the real route table. Documents two previously-unwritten capabilities: `intelligence_changed` SSE events and composite reads (`?include=outbound,inbound,intelligence,history`).

### CLI

- **`ls`/`grep`/`find` print a real aligned table by default**, matching the convention already used by `search`/`doctor`/`build`/`schema`/`links`/`mutations`/`briefing`/`validate`. The old plain/tab-separated form is preserved behind `--quiet` for shell pipelines.
- **`doctor` reports malformed frontmatter** as a structured table (file + YAML error) instead of an unstructured console warning.

### LSP

- **Hover reaches parity with VS Code** — the same colored `type`/`status` badges and clickable relation/body links, via standard markdown syntax so it works the same across editors.
- **`workspace/applyEdit` support** — `addMissingFields`, `scaffoldIdentity`, and two newly-exposed commands (`normalizeFrontmatter`, `convertRelations`) can now write back through any LSP client.
- **Richer `noteIntelligence` payloads** — time-in-current-lifecycle-state, mutation velocity, and cross-note pattern matches, matching VS Code's Note Report depth.

### Fixed

- Note Report's Tasks tab empty state described a feature that doesn't exist ("mention this node from another task"); rewritten to describe what the tab actually shows.
- Conduit's own API server could die within milliseconds of starting fresh — `run()` never awaited Ink's exit promise, so the CLI tore the server down while the UI was still using it. Now awaits `waitUntilExit()`.
- `yamlink`/`yamlink conduit` could silently attach to the wrong vault's already-running server. `probeServer()` now confirms the target vault via `/api/health`'s `vaultPath` before reusing a server; any mismatch or unidentifiable server gets its own fresh instance on a free port instead.
- `.yamlinkignore` rules starting with a leading `/` matched nothing, since scanned paths are never given a leading slash. Leading slashes are now stripped the same way `./` already was.
- CLI commands leaked raw build-time `console.warn`/`console.error` diagnostics ahead of their actual output. `buildIndexQuietly()` now stubs all three console methods during a quiet rebuild.
- Graph Workspace: disconnected or low-weight components could drift arbitrarily far from the main cluster. Added a hard per-tick position clamp in `SimpleLayout`.
- Vault Health's "Create schema from cluster" button double-fired a spurious `openView` message alongside the real action.
- LSP could hang a command forever if the editor never answered an `applyEdit` request. Added a 5s timeout to the transport's request layer.
- LSP diagnostics could miss a rebuild triggered by an external file change, or answer a pull request with stale pre-rebuild data during the debounce window. Both now wait for any in-flight rebuild.
- Images in Live Note and Preview didn't render if indented, and `![[embed.png]]` never rendered as an image at all. Fixed dedenting, embed-vs-wikilink detection, and webview image URI handling.
- A follow-up fix was needed for Windows: the first fix's `file://` URIs contained backslash-mangled paths, and markdown-it's link validator blocks `file:` URIs by default. Both resolved; standard `![alt](relative/path.png)` syntax now also resolves against the note's directory.
- PDF export had no image support at all since the command was first built. Both `![alt](path)` and `![[embed.png]]` now resolve and embed via pdfkit, falling back to a placeholder line for unsupported formats.
- Two Stats-tab charts (Link Density, Note Growth) had no hover tooltips, unlike the rest of the tab.
- Two Home-panel tests were silently failing, undetected because the test file was never wired into `package.json`'s test scripts.
- A new, unresolved entry typed into an existing YAML list-shaped relation field (e.g. adding a fourth `[[...]]` under a `contacts:` block list that already has several) only ever offered the generic "Create note" quick-fix and completion suggestion, never a type-aware one like "Create contact note" — even when the vault had abundant same-field evidence. Two causes, both fixed: field-name resolution in the quick-fix (VS Code and LSP) and the live `[[` completion dropdown was single-line-only and never recognized that a bare list-item line belongs to the `key:` field declared above it; and relation-type confidence scoring undercounted every list-shaped field to a single occurrence regardless of real list length, since such lists are cached internally as one joined string rather than a real array.

### Changed (structural only — no behavior changes)

- `src/actions/queryBuilderPanel.js` split 1830→298 lines; webview HTML/CSS/JS extracted to `src/actions/queryBuilder/queryBuilderHtml.js`.
- `src/features/importExternalVaults.js` / `src/features/importObsidian.js` split into `src/importers/{notion,evernote,roam,obsidian,shared}.js` — pure parsing modules, zero VS Code imports.
- `src/actions/codeActionsNodeCreationCommands.js` split 991→87 lines; all 11 command handlers extracted to `src/actions/nodeCreationHandlers.js`.
- `src/features/graph/graphClientXGraphScript.js` split 996→36 lines; the x-graph webview client script extracted to `src/features/graph/xgraphClientBody.js` as 6 concern-grouped fragments.
- `graph/renderer/Canvas2DRenderer.js` evaluated for a split and declined — already well-sectioned, and no bundler exists in this repo to support split-source/single-file-output without contradicting the "no build step" principle.
- `src/conduit/screens/Explorer.js` split 1086→426 lines. Extracted the keyboard handler (`explorerInput.js`), detail-panel builder (`explorerDetail.js`), formatting helpers (`explorerFormat.js`), and row renderers (`explorerRows.js`) into pure, dependency-injected modules with 14 new behavioral tests covering mode transitions and detail output that had zero prior coverage.

---

## [0.7.3] — Hotfix

- **Sample-vault race condition** — installing the extension while multiple VS Code project windows were already open could activate it in all of them near-simultaneously; a check-then-set race on a machine-wide first-run flag meant every open project could get the sample vault's Markdown files silently copied in. Replaced with a per-workspace, opt-in prompt ("Add a sample Yamlink vault here to explore its features?") — nothing is written to disk without explicit consent, and the check is now scoped per workspace so it can't race across windows.
- **Graph renderer fixes** — `_isConnectedTo` (used for hover/focus dimming) was an O(edges-per-node) array scan; now an O(1) adjacency-set lookup. Pan-and-release momentum decay was frame-rate dependent (decayed twice as fast at 120Hz vs. 60Hz); now normalized to real elapsed time between frames. A cached hit-test target for the zoomed-out cluster-bubble view could go stale under certain zoom transitions; now invalidated every frame it isn't in use. Cluster boundary hull outlines — a Sugar-era visual feature that had been fully implemented but had its call site dropped in a later refactor — are wired back in, visible in semantic layer mode.
- Sample "sandbox" content removed from this repo; now maintained in its own separate repository.

---

## [0.7.2] — Hotfix

- Fixed the `rootUri` helper generating an incorrect four-slash file URI on Linux.
- Replaced the activity bar icon with an SVG for correct rendering across themes.

---

## [0.7.1] — Hotfix

- Fixed CI `lint-and-test` failing on `npm run typecheck` after the Sugar push — ~70 latent JSDoc/type errors had accumulated because typecheck wasn't wired into local dev scripts. Annotated types across 15 files. Three were genuine production bugs caught in the process: `entityHub.js` was silently dropping `historySessions`/`historyEvolution`/`blockBacklinks` from the Note Report panel; `vaultPriors.js`'s structural cache type never declared `noteRoleNamePriors`/`noteRoleFieldHints`; `intelligenceSnapshots.js` checked a nonexistent `arc.coldStart` property instead of deriving it from `arc.missingFields`.

---

## [0.7.0] — "Sugar" *(shipped)*

### Conduit

- **Split view** — press `|` to split Conduit into two independent panes. `Tab` cycles focus (lit border = active); `q` closes the secondary pane. Both panes share one SSE connection and live vault state — no double polling. Status bar shows `◉ left | ○ right` when split is active.
- **9 screens** — Briefing [1], Query [2], Navigator [3], Explorer [4], Health [5], Search [6], Graph [7], Diff [8], Radar [9]. Number keys switch screens in the focused pane.
- **Single-command startup** — `yamlink` (no arguments) auto-starts the API server and opens Conduit. No separate `yamlink serve` needed.
- **Session context on Briefing** — every open shows a compact delta from your last session: "3 notes created, 2 missions updated, 1 broken link appeared."
- **Explorer write operations** — field editing (`e`), note creation (`n`), deletion (`D`), wikilink building (`l`), multi-select bulk ops (Space bar → Enter → bulk menu: set field, set status, delete all).
- **NoteView** — `v` from Explorer or Navigator opens a full Markdown reading view rendered in the terminal. Headings, wikilinks, tasks, and code fences are all ANSI-styled. `j`/`k` scrolls, `]`/`[` jumps headings, `o` opens in `$EDITOR`.
- **Intelligence inline in Explorer** — lifecycle state, drift label, and top arc-predicted missing field appear directly in the note detail pane without pressing `p`.
- **Body editing via `$EDITOR`** — `o` from Explorer opens the note body in your configured editor. The help overlay and the note detail panel footer both show this clearly.
- **Quick Capture** — `c` from any screen opens a 3-step form (id → type → arc-suggested fields) without leaving the terminal.
- **Peek overlay** — `p` shows full note detail without leaving the current screen.
- **Note history** — `H` in Explorer shows the mutation timeline for the selected note.
- **Graph traversal** — `]` follows the strongest outbound link, `[` follows the strongest inbound. `Esc` pops the stack.
- **Warp navigation** — type any character from a non-text screen to trigger live ranked search across notes, types, and commands.
- **Spatial bookmarks** — `m0`–`m9` sets, `'0`–`'9` jumps. Persisted across sessions.
- **Saved contexts** — `S`/`R` saves and restores Explorer state.

### Intelligence

- **Behavioral priors → live inference** — the mutation log now feeds relation completion and field classification in real time. Recent relation edits bias candidate ranking toward current modeling behavior; fields first used as relations stay known as relational even after vault restructuring.
- **Cluster emergence detection** — Vault Health shows an "Emerging Patterns" section when groups of notes share identical field signatures. Confidence levels: low (4–6 notes), medium (7–12), high (13+). Each cluster has a "Create schema from cluster →" button.
- **`yamlink.proposeSchema`** — "Yamlink: Propose Schema from Cluster" in the Command Palette. Detects medium/high-confidence clusters and presents them in a QuickPick; creates a schema note on selection. Falls back to a manual type-name prompt if no clusters exist.
- **Intelligence hardening** — note-role priors are now vault-derived (start empty, accumulate from structure). All static archetype tables removed from active inference paths. On a zero-evidence vault: honest silence.
- **Outcome calibration** — every accepted relation completion writes a `completion_accepted` event. The classifier learns from this history and applies a confidence boost to calibrated fields on subsequent interactions.
- **Note arc prediction** — "what does this note need next?" Compares the note's current fields against same-type vault notes and surfaces likely-missing fields in Note Report Overview and field-key completion.
- **Planner threshold fix** — field classifications with `source: 'behavior'` now correctly reach HINT, COMPLETION_ONLY, and QUICKFIX plan actions.

### VS Code-side

- **Live Note mode** — `Yamlink: Open Live Note` opens a compact rendered sidecar that stays synced with the active Markdown note while you write in source. Frontmatter, headings, and `!view` blocks are clickable back to their source line.
- **Visual Query Builder** — `Yamlink: Query Builder` opens a builder surface with type, column, filter, sort, limit, and layout controls. Shows the generated `!view` text and a live preview before writing.
- **Vault Projections** — Vault Health and Home now include a 90-day structural forecast: Growth, Stale Pressure, and Structure Direction lanes with type-family breakdowns and a 4-week trend memory. Scenario layer: current pace, improved cleanup, current growth.
- **Note Outline panel** — per-heading metadata (anchor link count, task count, body mention count, word count), current-section tracking, click-to-navigate, sibling section jump (`Ctrl+Alt+↑/↓`), search and filter.
- **Block and section references** — every meaningful body element in a note — headings, tasks, blockquotes/callouts, and footnote definitions — now has a computed stable block ID. Two syntaxes: `note#Heading Text` for sections, `note^block-id` for tasks, quotes, and footnotes. The block ID scheme is prefix-typed: `h-{slug}` for headings (deterministic, survives sibling reordering), `t{n}-{hash6}` for tasks (content-hash stable across minor edits), `q{n}-{hash6}` for blockquotes, `fn-{id}` for footnotes. Six commands (`yamlink.copyBlockReference`, `yamlink.insertBlockReference`, `yamlink.copySectionReference`, `yamlink.insertSectionReference`, `yamlink.copyScopedReference`, `yamlink.insertScopedReference`) give cursor-aware single-keystroke access — if the cursor is on a block, no picker is needed. Go-to-definition lands on the exact source line. Hover shows the block's content in the preview card. `note^` completion surfaces the full block index for a note with type labels and line numbers. Note Report outbound links resolve block references to their target label. The block index is rebuilt on every `buildIndex()` cycle alongside the graph and field cache. Block reference creations write `block_reference_created` events to the mutation log. The LSP server honors block reference navigation (`goto definition`, `find references`) via `findBlockLine()`, so Zed and Neovim users get the same exact-line precision.
- **Chart views** — any `!view` result can be visualised as a bar chart (with group-by field picker) or scatter plot (auto-selects first two numeric/date fields as axes).
- **Home panel** — vault pulse, activity feed (last 15 mutations), continue-working notes, nudge cards (broken links, untyped notes), and task groups (Overdue / Today / Upcoming / Open).
- **Task notifications** — VS Code popups for overdue and due-today tasks, deduped by vault state. Per-vault settings for type, frequency, and item count.
- **Smart Templates follow-up** — after a schema insertion, empty relation fields with vault evidence and empty scalar fields with vault vocabularies now reopen completion automatically.
- **Frontmatter suggestion dismissal** — "Ignore this suggestion here" quick fix permanently silences a specific Yamlink diagnostic for a note.
- **View suggestion suppression** — "Don't suggest views for this note" code action writes a per-note suppression to `.yamlink/suppress.json`. Survives restarts.
- **Natural language queries** — "Yamlink: Query in Plain English" maps plain-English descriptions to `!view` syntax using 16 sentence templates and full vault vocabulary injection.
- **Vault Health trend arrows** — Broken Links and Orphan Nodes stat cells now show ↑/↓ trend arrows comparing today's count to up to 7 days ago.
- **Note history from body edits** — content-only saves now produce a `note_touched` event, so the History tab no longer appears frozen when you edit note body text without changing frontmatter.
- **Click-to-add from arc section** — each "Likely missing" field row in Note Report Overview has a `+` button. Clicking it inserts a field stub and triggers completion immediately.

### CLI

`yamlink` now has 24 commands covering the full headless vault loop.

- **`yamlink set <id> <field> <value>`** — write a frontmatter field directly. `--clear` removes it, `--dry-run` previews. Emits mutation events attributed `source: 'cli'`.
- **`yamlink link <id> <field> <target-id>`** — set a relation field to `[[target-id]]`. Validates the target exists. `--append` for multi-value fields.
- **`yamlink on <event> -- <script>`** — automation hooks. Fires a shell script for each matching mutation event. Env vars: `YAMLINK_EVENT`, `YAMLINK_NOTE_ID`, `YAMLINK_TYPE`, `YAMLINK_FIELD`, `YAMLINK_VALUE`.
- **`yamlink completions bash|zsh`** — shell completion script for all commands and flags.
- **`yamlink briefing`** — morning summary: vault pulse, overdue/today tasks, recent mutations, arc predictions, drift flag.
- **`yamlink diff <id-a> <id-b>`** — compare two notes' frontmatter field sets: `+` added, `-` missing, `~` changed.
- **`yamlink mutations`** — query the mutation log with `--limit`, `--since`, `--type` filters.
- **`yamlink init [path]`** — scaffold a fresh vault with `.yamlink/`, `_templates/`, and `welcome.md`.
- **`yamlink rename <old> <new>`** — vault-wide ID rename including all `[[wikilink]]` references. `--dry-run` previews.
- **`yamlink doctor`** — vault environment diagnostic: `.yamlink/` presence, `.yamlinkignore` errors, schema conflicts, duplicate IDs.
- **`yamlink graph`** — output the vault graph as `{ nodes, edges }` JSON for external tools.
- **`yamlink schema list`** — list all schema notes with type, required fields, and note count.
- **`yamlink schema check <type>`** — conformance check reporting notes missing required fields.
- All commands: `--json` outputs clean JSON only, exit codes 0/1/2, `--dry-run` on mutating commands, `--quiet`, `--vault <path>`.

### API

`yamlink serve` is now a full writable local REST API (21 endpoints).

- **Write endpoints** — `POST /api/nodes` (create), `PATCH /api/nodes/:id` (update fields), `DELETE /api/nodes/:id` (remove). Bulk variants: `POST /api/nodes/bulk`, `PATCH /api/nodes/bulk`.
- **`GET /api/events`** — Server-Sent Events stream. Pushes individual mutation events (`field_changed`, `relation_changed`, `note_created`, etc.) before the coarse `rebuild` signal, enabling fine-grained reactive clients.
- **`GET /api/diff`** — field-level structural diff between two notes or since a timestamp.
- **`GET /api/intelligence/note`** — full note-intelligence snapshot: role, lifecycle, drift, arc, classifier context.
- **`GET /api/mutations`** — queryable mutation log with type, note, field, and time-range filters.
- **`GET /api/tasks`** — all vault tasks extracted from note bodies. Filters: done, overdue, today, note, limit.
- **`X-Yamlink-Api-Version: 1`** on all responses. Stable contract: v1 endpoints do not break without a version bump.

### Imports

- **`yamlink.importVaultExport`** — external import command for Roam Research, Notion, and Evernote. Each source has a purpose-built importer: ID stamping, wikilink rewriting, relation normalization, and attachment handling. Pre-import inspection summary and post-import cleanup lane for all three.
- **Obsidian import strengthened** — import report now counts preserved non-Markdown files. Post-import cleanup covers filename-to-`id:` preview, safe missing-`id:` assignment, and canonical wikilink rewrite.

### LSP

`yamlink serve --lsp` is a complete LSP server (25 handlers). Stable and frozen — no new work.

Capabilities: completion, hover, go-to-definition, diagnostics, rename, references, documentSymbols, workspaceSymbol, inlay hints, semantic tokens, pull diagnostics, codeAction, formatting, documentLink, documentHighlight. `workspace/executeCommand` exposes five intelligence commands to any LSP client.

### x-graph

- **Physics overhaul** — Fibonacci spiral seed, inter-cluster topology mini-force, weight-aware center pull, convergence detection. Eliminates the "ring of clusters" layout and perpetual micro-jitter.
- **Cluster hull rendering** — translucent convex-hull overlays (Graham scan + bezier smoothing) behind each cluster. Focus-aware dimming when hovering or selecting a node.
- **Label fade transitions** — labels fade in over a 0.05-zoom ramp instead of snapping.
- **Dot mode and edge cutoff** — at extreme zoom-out, nodes become color-bucketed rectangles (~10× faster); edge pass skipped entirely below zoom 0.06.
- **Keyboard traversal** — Tab/arrow keys cycle nodes in both the sidebar and workspace graph panels.

### Fixed

- Graph node click: every click was treated as a drag release, so clicking a node never opened the linked note. Fixed by checking pointer displacement — < 4 px is a click.
- Graph type filter chips: vault types were mapped through a fixed kind table before filtering, so most types had no effect. Now passes exact vault type strings.
- Graph alias-based wikilinks: `[[Alias Name]]` links were dropping valid edges because alias resolution happened after graph indexing. Aliases are now collected before edges are registered.
- Related-note creation: the reverse relation could be missed when the new note was generated through the template path. Now backfilled before the index sync.
- Live Note panel: was reading too blue and too tall. Now inherits VS Code surface/background variables with Yamlink color only in accents.

---

## [0.6.2] — Hotfix

Fixed runtime dependencies (`js-yaml`, `markdown-it`, `pdfkit`) being stripped from the VSIX by a blanket `node_modules/**` ignore rule. The extension failed to activate with `Cannot find module 'js-yaml'`.

---

## [0.6.0] — "Shujimi"

Shujimi shipped the CLI, a four-phase intelligence overhaul, the Home panel, Conduit v1, and a set of high-value authoring features.

### Added

- **CLI** — `yamlink` command for headless vault access: `health`, `report`, `query`, `links`, `build`, `serve`, `export`, `validate`. `--json` on every command. `--vault <path>` override. Installable via `npm link`.
- **Four-phase intelligence overhaul** — vault-first classification: link topology wins over field names; vault maturity scales confidence bars; implicit interaction history from the mutation log; structural type-role inference from field bundle topology; global archetype tables removed.
- **Outcome calibration** — accepted relation completions write `completion_accepted` events; the classifier applies a confidence boost to calibrated fields on subsequent interactions.
- **Note arc prediction** — "Likely missing" section in Note Report Overview. Arc-predicted fields appear in field-key completion with frequency badges.
- **Unlinked references** — Note Report Links tab shows body-text mentions without a formal wikilink. Generation-cached.
- **Home panel** — activity stream, vault pulse, continue-working notes, nudge cards. Auto-opens once on first vault activation.
- **Daily Notes** — `Ctrl+Alt+J` opens or creates today's journal note. Uses `_templates/journal.md` if present.
- **Natural language queries** — `yamlink.naturalQuery` maps plain-English descriptions to `!view` syntax using 16 templates and vault vocabulary injection.
- **Smart Templates** — `_templates/*.md` files act as live schema definitions. Saved changes prompt: "Template 'X' has new fields — apply to N notes?" Drifted notes get a lightbulb action and Vault Health advisory.
- **Quick Note** — `Ctrl+Alt+N` creates a note by type, scaffolding frontmatter from the matching template, schema, or vault patterns.
- **Auto-stamp `created:`** — all notes created through any Yamlink command receive a `created: YYYY-MM-DD` field automatically.
- **`file.created` and `file.modified` query fields** — virtual fields resolved from the file system; available in `where`, `select`, and `sort` without adding frontmatter.
- **`yamlink.backfillCreatedDates`** — stamps existing notes with file system birthtime (reliability warning shown before writing).
- **Git history import** — `yamlink.importGitHistory` reconstructs full structural evolution from commit history. Runs once; guarded by a `.done` marker.
- **Table virtual rendering** — result sets > 500 rows render only the current page. Smaller sets use the client-side path unchanged.
- **Table density and due-state pass** — tighter spacing throughout; four due-state chips: Overdue (red), Due today (gold), Due soon (amber), Done (teal).
- **Click-to-add from arc section** — `+` button on each "Likely missing" row inserts a field stub and triggers completion.
- **Extract Selection to New Note** — selected body text becomes a new note's body; the selection is replaced with `![[new-id]]`; `source: [[original-id]]` is written into the new note.
- **Anchor go-to-definition** — `note#Heading` links navigate to the exact heading line. Anchor hover shows that section's content instead of the full note card.
- **Tag pill decorations** — `#hashtag` tokens decorated in all workspace Markdown language mode variants.
- **Compact status bar** — `◈ 31  ⚠ 104` format.
- **Template-guided note creation** — "Create note" quick fix presents a QuickPick of templates with a type-matched suggestion at the top.
- **Vault palette** — all panels now use the Apollo palette hardcoded: lavender for identity/links, teal for interactive states, amber for warnings, pink for primary actions.
- **Vault Health: Today's Activity** — notes with mutations today, sorted by event count, clickable.

### Changed

- **Vault Health tab navigation** — six tabs: Activity, Lifecycle, Consistency, Schema, Types, and conditional Templates/Orphans.
- **Home panel visual redesign** — Yamlink logo in header, vault name as a lavender pill, activity feed with clock-time timestamps.
- **Lucide icon family** — all unicode glyphs and emoji icons replaced with inline Lucide SVGs across all panels.
- **Graph blank-on-open eliminated** — camera offset now scales proportionally when dimensions change.
- **Graph jitter eliminated** — simulation pre-warms 80 ticks before the animation loop starts.
- **`relation_added` / `relation_removed` event split** — `relation_changed` is now three distinct events: `relation_added` (mint), `relation_removed` (muted), `relation_changed` (purple). All surfaces updated.

### Fixed

- Callout blocks (`> [!SOURCE]`) now render correctly in note preview and PDF export.
- Note preview font updated to Inter.
- Sample vault now ships in the VSIX.

---

## [0.5.2] — "Zim" Patch

- Restored consistent wikilink resolution across diagnostics and ctrl-click navigation.
- Fixed vault-wide rename propagation skipping files during bulk ID changes.

## [0.5.1] — "Zim" Patch

- Restored clickable markdown wikilinks (Yamlink's `configurationDefaults` was disabling native markdown link behavior).

---

## [0.5.0] — "Zim"

Zim made Yamlink a more complete workspace: a rebuilt graph, a stronger query language, smarter frontmatter intelligence, and release discipline.

### Added

- **Graph 2.0** — sidebar graph for ambient vault awareness; Graph Workspace for focused exploration.
- **Query language** — `!=`, `is empty`, `exists`, `is not empty`, cross-field `or`, `#tag` shorthand, date functions (`today()`, `tomorrow()`, `days-ago(n)`, `days-from-now(n)`).
- **Date shortcuts** — `@today`, `@tomorrow`, `@yesterday`, `@thisweek`, `@nextweek`, `@startofmonth`, `@endofmonth`.
- **Relation completion** — human-readable labels, type-filtered candidates, faster `New [type]` creation.
- **Lifecycle and drift signals** — draft/growing/consolidated/hub/stale states and structural drift scores in Vault Health and Note Report.
- **Note Report History tab** — persisted mutation event log. Survives restarts.
- **Body-aware signals** — tags, callouts, embeds, footnotes, repeated body links as supporting evidence.
- **Aliases** — `aliases:` in frontmatter; resolves in hover, navigation, completion, decorations.
- **Schema-first note creation** — `yamlink.newNoteFromSchema`; schema fallback in standard creation.
- **Public extension API** — `getIndex`, `getFieldsCache`, `getPathIndex`, `getSchema`, `query`, `onVaultChange`.
- **GitHub Actions CI** — lint + test + `vsce package` on every push/PR.

### Changed

- Note Report is now a five-tab panel: Overview, Links, Tasks, Views, History.
- Tables: cleaner shell, stronger sorting, column value filters.
- Completion and lightbulbs: weaker signals stay quieter, stronger signals surface more clearly.

### Fixed

- Relation completion, alias resolution, body link handling, date shortcuts, templates, `.yamlinkignore` rebuild-on-change.

---

## [0.4.0] — "Carmen"

Carmen hardened the intelligence layer and rebuilt the graph after an unexpected VS Code webview break.

### Added

- Query OR logic and date-range operators.
- Body wikilink → frontmatter suggestion (2+ body mentions without a frontmatter field).
- Note-context-aware query builder starters.
- Template system (`_templates/` based note creation).
- Bottom-bar writing stats (word count, character count).

### Changed

- Graph rebuilt on a boot-once webview architecture. Local mode follows the current note; Vault mode is the broader view.
- Intelligence layer split into clear module boundaries.
- Suggestion explanations are shorter and plainer.

### Fixed

- Date parsing broadened (textual months, `by Friday`, `due next Tue`).
- Same-flow graph/report hints now stay aligned with the visible suggestion.
- Note Report opportunity model uses live note body context.

---

## [0.3.5] — "Ace+"

Addressed intelligence trust issues and polished the authoring experience.

### Added

- Adaptive intelligence foundation: shared field-role inference, first note-role inference layer.
- Schema-backed relation suggestions, mixed-type relation awareness, peer-relation suggestions.
- Task shortcuts: `!view open-tasks`, `!view done-tasks`, `!view overdue`, `!view undated-tasks`.
- Graph and Calendar keyboard shortcuts.

### Changed

- Query refinement returns users directly to the live result.
- Status bar styling tightened.

### Fixed

- Wikilink canonicalization before graph indexing.
- Relation autocomplete no longer hides the vault when a likely target type is inferred.
- Calendar now recognizes `date:` fields.

---

## [0.3.1] — "Ace" Hotfix

Fixed VSIX packaging to include runtime dependencies. Extension now activates correctly in Marketplace builds.

---

## [0.3.0] — "Ace"

Yamlink became a real local-first structured workspace layer inside VS Code.

### Added

- Yamlink sidebar with Note Report, Calendar, and Vault Health.
- Calendar: month, week, and day views with task and note activity.
- Query shorthand presets: `!view calendar`, `!view today`, `!view upcoming`.
- Guided query-builder foundation.
- PDF export for live views and active notes.
- Vault-wide graph with search, filter chips, node inspector.
- Completion improvements: relation suggestions before `[[`, observed-field fallback, archetype-driven frontmatter keys.

### Changed

- Tables: safer YAML serialization, no auto-open on `!view`, typed cell editing (text, relation, boolean, dropdown, number, date).
- Note Report and Calendar moved to Yamlink's dedicated sidebar.
- Vault Health received a major visual reset.

### Fixed

- Stale table refresh after edits.
- Rename propagation for `[[id]]`, `[[id|Label]]`, `![[id]]`.
- Malformed schema nodes now surface a diagnostic.

---

## [0.2.0] — "Dizzie"

Yamlink became queryable, not just navigable.

### Added

- `!view` blocks: live interactive tables, multiple tabs, inline cell editing, filter chips, column sorting.
- Query language: `select`, `where =`, `where contains`, `sort`, `limit`, `| label`, multi-line blocks, `!view *`.
- Entity Hub: full backlink view grouped by relation field.
- Vault Health: health score, graph statistics, orphan detection, type distribution.
- Schema nodes, required field validation, relation target enforcement, duplicate schema detection.

---

## [0.1.0] — "Apollo"

The identity release.

- Canonical `id:` identity model.
- Rename propagation.
- Backlinks, hover previews, definition navigation, wikilink autocomplete.
- Broken-link diagnostics, duplicate ID detection.
- Quick fixes for missing frontmatter and broken links.
- Status bar vault summary.
