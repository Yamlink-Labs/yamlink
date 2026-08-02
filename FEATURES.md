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
- **heading anchors** — `[[id#Section]]`: Ctrl+Click navigates to the exact heading line; hovering shows the section content (heading + up to 8 lines). Pipe-aliased anchors (`[[id#Section|Label]]`) work correctly.
- block refs — `[[id^blockid]]`
- body/frontmatter link targets are canonicalized before graph indexing, so casing, spacing, aliases, and heading/block suffixes do not silently break graph edges
- **hover cards** — hovering a `[[wikilink]]` shows the target note's `type` and `status` as colored pill badges inside VS Code's native hover widget, plus relation-field values and body `[[mentions]]` as real clickable links rather than literal bracket text

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

| Family | Types | Color |
|---|---|---|
| Amber — Structure | `[!SOURCE]`, `[!EVIDENCE]`, `[!QUOTE]`, `[!REFERENCE]` | `#E7A85A` |
| Teal — Support | `[!NOTE]`, `[!INFO]`, `[!TIP]`, `[!ABSTRACT]` | `#5ECFBE` |
| Orange — Caution | `[!WARNING]`, `[!CAUTION]` | `#E67D61` |
| Red — Danger | `[!DANGER]`, `[!BUG]`, `[!FAILURE]` | `#FF4A6A` |

Colors are sourced from the Yamlink Apollo Night palette.

- Titles after the type marker are optional: `> [!NOTE]` and `> [!NOTE] My title` both work.
- Callout types feed into note-role inference: `[!SOURCE]` and `[!EVIDENCE]` push toward a source/evidence role; `[!WARNING]` toward a warning signal.
- **Note preview** — callout blocks render as styled panels with a colored left bar, type label, and body. The same Yamlink palette colors apply.
- **PDF export** — callout blocks render as styled boxes with accent bar, type label, and body. Plain text is never shown for callout syntax.

### Adaptive intelligence

For a full explanation of what each lightbulb does, how completion ranking works, and how the system learns, see [INTELLIGENCE.md](INTELLIGENCE.md).

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
  - `consolidated`
  - `hub`
  - `stale`
- type-consistency detection:
  - `on track`
  - `slightly unusual`
  - `missing structure`
  - `very unusual`

### Frontmatter intelligence

- field suggestions work even for notes that aren't fully typed or structured yet
- Yamlink infers likely fields from how similar notes in your vault are already built
- suggestions show up in completion, Note Report guidance, and lightbulb actions

### Smart Templates

`_templates/*.md` files act as live schema definitions for their `type:` — not one-time scaffolds.

- **Drift detection** — when a note's `type:` has a matching template and the note is missing any of its field keys, a yellow warning squiggle appears on the `type:` line. The lightbulb action reads: `Yamlink: Add missing "character" fields (faction, homeworld)` — the type and exact missing fields are named.
- **Vault-wide propagation** — saving a template notifies: `"Template 'character' has new fields. Apply to N notes?"`. **Apply** inserts the missing fields into every note of that type in the vault — open notes via VS Code's workspace edit, closed files directly on disk.
- **Vault Health** — the Template Drift section lists all drifted notes by type with the specific fields they're missing.
- **Template folder** — `_templates/` is excluded from vault indexing so templates never appear as graph nodes.
- **Type-line schema action** — once a note has a meaningful `type:`, the lightbulb can surface an explicit type-aware setup action such as:
  - `Use the character schema from Smart Templates`
  - this is intentionally more specific than a generic "fill usual fields" action so the user can see Yamlink recognized the note family
- **Smart follow-up handoff** — after Yamlink inserts the learned schema, the cursor moves to the first unresolved frontmatter field and can reopen completion automatically when the vault already provides strong evidence
  - bare relation fields such as `unit:` can reopen ranked relation candidates even before `[[` is typed
  - bare scalar fields such as `rank:` can reopen learned value vocabularies from similar notes
  - this turns Smart Templates into a staged authoring flow instead of a one-shot scaffold drop
- **Save as Template** — turn any real, already-filled-in note into a new `_templates/<type>.md` file in one step: `yamlink template save <id>` from the CLI, or "Yamlink: Save Note as Template" from the Command Palette or the editor's right-click menu on any Markdown note.
  - every frontmatter key is preserved, every value is blanked except `type:` (templates are keyed by it)
  - a YAML block-list relation field (e.g. `contacts:` with several `[[...]]` entries) collapses to one blank placeholder item instead of repeating every real link
  - the body keeps only its heading structure — real prose is dropped, since it's note-specific
  - the result is a normal template file: it immediately works with drift detection, "New Note from Template", and everything else above — no separate format
  - refuses to overwrite an existing template for that type unless you pass `--force` (CLI) or confirm an overwrite prompt (VS Code)

### Vault Glossary

An alphabetized, live glossary of a vault's own concept/term notes — useful for a worldbuilding, research, or technical vault with real definitional notes; not much use on a pure CRM/entity vault. **Nothing is ever written to disk** — both the CLI command and the VS Code panel compute the view fresh from the current vault every time they're opened, the same way Vault Health does.

- **Access:** `yamlink glossary --type <a,b>` (CLI) or Command Palette → "Yamlink: Open Vault Glossary" (VS Code).
- **The one required setting** — which note type(s) count as glossary terms (`yamlink.glossaryTypes` in VS Code Settings, `--type` per-run on the CLI). Yamlink can't guess which of your types are conceptual versus entity records, so with nothing configured it asks rather than guesses — an empty-state screen with a direct link to the setting, not a blank or wrong glossary.
- **Each entry shows:**
  - a **definition** — an explicit `definition:`/`summary:` field if present, else the note's own first body paragraph, verbatim (never invented text); any `[[wikilink]]` inside that text renders as a real clickable link (or, if the target doesn't resolve, as plain text in a distinct error color — never a dead-looking link)
  - **Referenced in** — every note that links to it, the same backlink data Note Report's Links tab already reads one note at a time, gathered across every term at once
- **Four settings, all defaulted so none are required, and all also changeable from the VS Code panel's own toolbar (not just Settings):**
  - `yamlink.glossaryGroupByType` (default on) — a section per note type instead of one mixed A–Z list
  - `yamlink.glossaryShowZeroBacklinkTerms` (default on) — show a term nothing links to yet, marked *(not yet referenced)*, instead of silently hiding it
  - `yamlink.glossarySortBy` (default `alphabetical`) — or `mostReferenced` to rank terms by inbound link count instead of alphabetizing (a ranked list has no letter sections, since order itself is the signal)
  - `yamlink.glossaryExtraFields` — extra frontmatter field names shown under each entry, if present on that note
  - CLI equivalents: `--no-group-by-type`, `--hide-unreferenced`, `--sort-by-references`, `--extra-field <name>` (repeatable)
- **VS Code panel specifics:**
  - a toolbar with live checkboxes/dropdown for group-by-type, hide-unreferenced, and sort order — toggling any of them updates the underlying setting directly, no Settings trip needed
  - clicking a term or a backlink jumps straight to that note
  - collapsible type sections — click a type heading to fold/unfold it
  - a live search box filters the list client-side as you type, with ↑/↓ keyboard navigation between visible results and Enter to open the focused one
  - a **Copy as Markdown** button copies whatever's currently visible (respecting an active search filter) as plain Markdown text
  - a persistent **Settings** button in the header is always one click away, whether the panel is showing the empty state or real data
  - the panel re-renders automatically both when the vault changes and when any glossary setting changes (including toolbar toggles)

### Smart Paste

When you paste clearly structured clipboard content into a Markdown note, Yamlink can offer a safer structured conversion instead of dumping raw markup.

- **Tables** — tab-separated spreadsheet content or a plain Markdown table can become a `!view` scaffold using the detected column names, or N new Markdown notes where each row becomes frontmatter. Yamlink previews the inferred note IDs before creating files and refuses to overwrite existing notes.
- **JSON** — a top-level JSON object can become YAML frontmatter directly.
- **Lists** — a bulleted or numbered list can become Yamlink-compatible Markdown tasks (`- [ ] ...`), preserving markers such as `#urgent`, `#medium`, and `#low`.
- **Conservative by design** — if the pasted content is ambiguous plain text, Yamlink stays out of the way and normal paste continues.

### Intelligence direction

Yamlink's intelligence layer is fully vault-derived — the vault teaches the system, not the other way round.

**Field classification** works in this order: schema (authoritative) → direct typed link in current value → vault-wide link patterns → observed wikilink ratio → mutation log history → vault-detected workflow fields → soft name patterns as last resort. Field names are never the primary signal. A field called `status` with wikilink values is classified RELATION. A field called `disposition` with `active/standby/complete` values is detected as WORKFLOW from your actual vocabulary.

**Note role inference** is structural: what does the field bundle look like? A type with 3 relation fields and low inbound is a person-type. A type that many notes link to is a container. Works for any domain vocabulary — `fighter`, `starship`, `kampf` — no prior type-name knowledge required.

**Cold-start:** A 3-note vault with one typed wikilink gets meaningful completion and lightbulb suggestions on the first note. Vault maturity (0–1) scales confidence thresholds — new vaults get lower bars, established vaults get full bars.

**Sticky knowledge:** The mutation log tracks every wikilink assignment. Fields used as relations in the past stay known as relational even after vault restructuring.

**Recent behavior memory:** The mutation engine now also tracks shorter-horizon relation behavior. Recent structural edits teach Yamlink:
- which target types a field is being linked to lately
- which concrete notes are recurring as relation targets
- how that behavior changes by note type

That memory now feeds live relation completion and sparse-field recovery, so ranking can reflect what the vault is actively modeling now, not only lifetime aggregates.

**Honest silence:** When the vault has no evidence for something, the system stays quiet rather than guessing from a global template table.

**Outcome calibration (feedback loop):** Every relation completion accepted with Enter/Tab writes a `completion_accepted` event to the mutation log. A `calibration` map is built from these events on every vault generation and fed back into the classifier. A field confirmed as a relation previously gets a confidence boost on the next suggestion — the system learns from what you actually do.

**Note arc prediction:** The system answers "what does this note need next?" — a trajectory question. `buildNoteArc` compares the current note's fields against the canonical field bundle for its type and returns ranked missing fields. Surfaces in two places: the Note Report Overview tab ("Likely missing" section, each row with a `+` button for one-click insert) and frontmatter field key completion (arc fields appear with a "in N% of type notes · likely missing" badge).

### Graph awareness

- backlinks
- outgoing relations
- duplicate ID detection
- broken link detection
- orphan awareness

---

## Vault Control

### `.yamlinkignore`

Place a `.yamlinkignore` file at a workspace root to exclude Markdown files from Yamlink without removing them from disk.

Supported patterns:

- folders with a trailing slash: `scratch/`
- exact relative file paths: `notes/legacy.md`
- plain filenames: `legacy-note.md`
- wildcards (`*`, `**`, `?`): `*.tmp.md` (any file ending in `.tmp.md`, at any depth), `drafts/*.md` (only files directly inside `drafts/`), `logs*/` (any folder starting with `logs`, at any depth), `**/` (everything under this root)

A pattern with a `/` in it is anchored to this root (matches only that exact path, same as a plain folder or file-path rule); a pattern with no `/` is checked at every depth, same as a plain filename rule.

Ignored files are excluded from indexing, graph edges, diagnostics, Note Report, Vault Health, Calendar analysis, inference, and rename propagation.

This is the right escape hatch for archives, generated content, or mixed-use repos where not every Markdown file belongs in the Yamlink system. Changes to `.yamlinkignore` take effect immediately — no restart required.

**Multi-root workspaces:** `.yamlinkignore` is read separately for each folder in the workspace, and only governs the folder it's placed in — a `.yamlinkignore` in one folder has no effect on another. To exclude an entire second folder (for example, a sample vault or reference repo added alongside your real notes), place a `.yamlinkignore` containing a single `*` line at that folder's own root.

---

## Yamlink CLI

Run Yamlink capabilities from a terminal, CI pipeline, or build script — no VS Code required.

```bash
yamlink build [--vault <path>]                  # index vault, report broken links / duplicate IDs
yamlink briefing [--vault <path>] [--json]      # vault pulse, overdue tasks, activity, arc predictions
yamlink create <type> [--field key=value...]    # create a note non-interactively
yamlink cat <id> [--at <date>] [--json]         # frontmatter snapshot + body (--at: historical, frontmatter only)
yamlink ls [--type] [--sort] [--json]           # list notes with unix-style filtering and sorting
yamlink grep <text> [--type] [--field] [--json] # search frontmatter values for matching text
yamlink find [--has] [--missing] [--type]       # structural search by present/missing fields
yamlink set <id> <field> <value> [--clear]      # set or remove a frontmatter field
yamlink link <id> <field> <target> [--append]   # add a wikilink relation field
yamlink search <query> [--type] [--json]        # search by id, name, title, or type
yamlink status [--vault <path>] [--json]        # compact vault snapshot (notes, edges, broken links)
yamlink health [--vault <path>] [--json]        # lifecycle, drift, type distribution
yamlink validate [--vault <path>] [--json]      # schema conformance (exits 1 if required fields missing)
yamlink query "<query>" [--json]                # run a query, output ASCII table or JSON
yamlink report <note-id> [--at <date>] [--json] # note report in terminal (--at: historical, no lifecycle/drift/inbound)
yamlink links <note-id> [--at <date>] [--json]  # inbound + outbound links for a note (--at: outbound-only historical)
yamlink diff <id1> <id2> | --since <date>       # compare two notes' fields, or vault-wide changes since a date
yamlink story --since <date> [--json]           # vault growth story: note/type deltas, activity, busiest notes
yamlink snapshot [--reason <text>] [--json]     # capture a real, on-demand vault checkpoint right now
yamlink restore <date> [--output <path>]        # preview (default) or export a reconstructed vault as .md files
yamlink rename <old-id> <new-id> [--dry-run]    # vault-wide ID rename
yamlink schema list|check <type> [--json]       # schema introspection and conformance
yamlink graph [--only-types <types>] [--at <date>] [--json]  # export vault graph as JSON (--at: historical reconstruction)
yamlink suggest <id> [--json]                   # fields likely missing from a note
yamlink drift [--type] [--limit] [--json]       # notes structurally drifting from their type bundle
yamlink stale [--type] [--limit] [--json]       # notes in a stale lifecycle state
yamlink orphans [--type] [--limit] [--json]     # notes with no inbound or outbound links
yamlink pressure [--json]                       # knowledge pressure: load-bearing drafts, stale hubs, orphans
yamlink lenses [--json]                         # vault change lenses over mutation history
yamlink session [--id] [--json]                 # summarize recent or explicit mutation sessions
yamlink mutations [--limit] [--since] [--type]  # recent mutation events from the vault log
yamlink doctor [--vault <path>] [--json]        # comprehensive integrity pass
yamlink serve [--port 3000]                     # local HTTP API server
yamlink serve --lsp --vault <path>              # JSON-RPC 2.0 LSP server over stdio
yamlink export [--format json|csv]              # dump vault to JSON or CSV
yamlink publish --out <dir> [--mode preview|production] [--site-url] [--webhook] [--force]  # build a static, structured content payload for a site generator
yamlink env [--shell bash|zsh|fish]             # export shell variables for the current vault
yamlink watch [--vault <path>]                  # watch vault, rebuild on .md changes
yamlink on <event> [--type <type>] -- <script>  # run a script on vault mutation events
yamlink conduit                                 # terminal UI — auto-starts server if not already running
yamlink init [path]                             # scaffold a new Yamlink vault
yamlink completions bash|zsh                    # print shell completion script
```

44 commands total. All commands accept `--vault <path>` (defaults to current directory). Most accept `--json` for machine-readable output. `ls`/`grep`/`find` print a real aligned table by default; `--quiet` on those three restores the old plain tab-separated form for shell pipelines.

`yamlink serve --lsp` runs the [LSP server](#lsp-server) — a persistent JSON-RPC 2.0 process for Neovim, Zed, Helix, and Emacs. See the LSP section below.

**Time Engine on the CLI:** `yamlink story --since <date>` narrates vault growth from a past date to now. `--at <date>` reconstructs historical state directly on `cat`, `report`, `links`, and `graph` — each scopes down honestly to what's actually reconstructable (no note body, no live-vault-priors inferences like lifecycle/drift, outbound-only where inbound would need a full-vault reconstruction). Run any command with `--help` for its full flag list.

### serve endpoints

`yamlink serve` starts a local HTTP server (default port 3000) that exposes the live vault index as a REST API. Full method/path/params/error-code reference: [`CONTRACT.md`](CONTRACT.md).

| Endpoint | Description |
|---|---|
| `GET /api/nodes` | All notes as JSON; `?type=` filter, `?page=`/`?limit=` pagination |
| `GET /api/nodes/:id` | Single note with `_inbound`, `_outbound`, `_filePath`. `?include=outbound,inbound,intelligence,history,body,timestamps,blockBacklinks` for composite reads (`body` adds the raw body text; `timestamps` adds real filesystem created/modified dates; `blockBacklinks` adds which notes link to a specific task/quote/heading/footnote inside this note); `?minGeneration=N` to wait for a generation before answering; `?at=<timestamp>` for a Time Engine historical reconstruction |
| `GET /api/nodes/:id/outbound` \| `/inbound` \| `/neighborhood` | Graph traversal — resolved outbound/inbound edges, or a multi-hop neighborhood (`?depth=1-3`) |
| `GET /api/nodes/:id/history` \| `/evolution` \| `/archaeology?field=` | Mutation history, change-pattern summary, and per-field relation timeline for a note |
| `POST /api/nodes` | Create a new note from `{ type, fields? }` — returns `{ ok, id, filePath }` (201) |
| `POST /api/nodes/bulk` \| `PATCH /api/nodes/bulk` | Batch create/update up to 50 notes in one call — `207` on partial failure |
| `PATCH /api/nodes/:id` | Update frontmatter field(s); pass `null`/`""` to delete a field |
| `DELETE /api/nodes/:id` | Remove the note file from disk and index |
| `GET /api/query?q=<query>` | Run any Yamlink query, returns rows + columns |
| `GET /api/graph` | All nodes and edges as `{ nodes, edges }`. `?at=<timestamp>` for a historical graph reconstruction |
| `GET /api/diff` | `?from=`+`?to=` compares two notes' fields; `?since=<timestamp>` reports vault-wide field changes |
| `GET /api/search` \| `/schema` \| `/types` | Vault search, schema introspection, type distribution |
| `GET /api/health` | Broken link count + schema conformance |
| `GET /api/tasks` | All vault tasks; filter by `?done=`, `?today=`, `?overdue=`, `?note=`, `?limit=` |
| `PATCH /api/tasks` | Toggle one task's checkbox — `{ noteId, line, done }`, same write path VS Code's live tables use |
| `GET /api/glossary?types=` | Term definitions + full backlink lists — same data the CLI/VS Code Vault Glossary compute; `?groupByType=`, `?sortBy=`, `?hideUnreferenced=`, `?extraFields=` |
| `GET /api/mutations` \| `/session/summary` | Recent mutation events (`?limit=`, `?since=`, `?type=`), or a summarized session |
| `GET /api/events` | Server-Sent Events stream (filterable via `?note=`/`?noteType=`/`?type=`); pushes mutation events, `rebuild` after every vault change, and `intelligence_changed` (reactive push when derived intelligence — lifecycle/drift/arc/priors — is recomputed) |
| `GET /api/intelligence/arc?id=` | Arc prediction — likely missing fields for a note |
| `GET /api/intelligence/fieldCategory?id=&field=` | Field classification: category, confidence, source, reasons |
| `GET /api/intelligence/note?id=` \| `/clusters` \| `/lenses` | Combined note intelligence snapshot; detected pre-schema field clusters; vault-wide change lenses |
| `GET /api/intelligence/trends` | Growth/Stale/Structure forecast and retrospective accuracy — the same data `yamlink trends` and Vault Health's Projections card show |

All responses include `X-Yamlink-Generation` (vault version integer) and `X-Yamlink-Api-Version` headers. CORS is enabled for all origins (`*`) — no authentication by default, since anything reachable at `127.0.0.1` is otherwise trusted; set `YAMLINK_API_TOKEN` before starting `yamlink serve` to require a matching `X-Yamlink-Token` header on every request. Full method/path/params/error-code reference: [`CONTRACT.md`](CONTRACT.md).

### Plugin API for third-party field evidence

A VS Code extension can register a read-only evidence source that contributes one extra, small, explainable signal to Yamlink's own field classification — `registerFieldEvidenceSource(fn)`, reached via `vscode.extensions.getExtension('<publisher>.yamlink').exports`. Deliberately narrow: no vault writes, no visibility into other registered plugins, every signal must carry a stated reason or it's discarded, and the effect on any single field's confidence is capped small so no plugin can dominate a classification Yamlink's own evidence already made. VS-Code-only — the LSP server has no third-party extension-loading mechanism to expose this through.

### CI use case

```yaml
- run: yamlink build           # exits 1 on broken links or duplicate IDs
- run: yamlink validate        # exits 1 if required schema fields are missing
```

### build vs validate

- `build` catches structural errors (broken links, duplicate IDs) — always meaningful regardless of schemas
- `validate` catches data quality issues (missing required fields per schema) — only meaningful when schemas exist

### Authoring & Publishing (0.7.7, in progress)

`yamlink publish --out <dir>` turns the vault into a static, structured content payload a site generator (Astro, Next.js, Eleventy, or anything else that reads JSON) can build a real website from. The vault stays the source of truth — this is a read-only projection of it, not a second content model.

```bash
yamlink publish --out ./site-content
yamlink publish --out ./site-content --mode preview
yamlink publish --out ./site-content --site-url https://example.com --webhook https://example.com/deploy
```

- **`status: draft/published/archived` is a real gate**, not a decorative label — a production build excludes drafts by default; `--mode preview` includes them. Nothing about `!view`, completions, hover, or diagnostics changes — a vault that never sets this field sees no difference anywhere.
- **`[[wikilinks]]` resolve to relative site URLs**, in both frontmatter and body text; `!view` blocks resolve to a static Markdown table snapshot as of the build.
- **`order:`** (a numeric frontmatter field) controls manual ordering in the output manifest — chapters, changelog entries, any fixed sequence.
- **`previous_ids:`** on a note generates a redirect map, so a rename doesn't 404 an old published URL.
- **A pre-publish safety gate** warns (without failing the build) on a published note linking to a draft/archived note, or a link that doesn't resolve — ignoring fenced-code documentation examples.
- Referenced images are copied into the output automatically; builds are incremental (unchanged notes aren't rewritten); a search index is generated every time; `--site-url` also generates `sitemap.xml` and an RSS feed; `--webhook` notifies the destination site to redeploy.

**`yamlink export --id <id> --format html [--output <path>]`** — one note (resolved links, resolved `!view` blocks, callout styling) as a standalone HTML file, no VS Code dependency, lighter than the PDF exporter.

**Live Note preview target** — `yamlink.liveNotePreviewUrl` (a URL template, e.g. `http://localhost:4321/{slug}`) makes Live Note embed the destination site's own running dev server for the current note in an iframe instead of Yamlink's generic rendering, staying in sync as the active note changes. A note with no resolvable `id:` falls back to the normal rendered preview.

---

## LSP Server

`yamlink serve --lsp --vault <path>` starts a persistent JSON-RPC 2.0 Language Server Protocol server over stdio, enabling any LSP-capable editor — Neovim, Zed, Helix, Emacs — to use Yamlink intelligence without VS Code.

The server is the headless Yamlink engine with a stdio shell around it. No build step. No third-party dependencies beyond the engine itself.

### Capabilities

| Method | What it does |
|---|---|
| `textDocument/completion` | `[[` → wikilink completions ranked by vault priors (up to 50); frontmatter keys ranked by type bundle; frontmatter values for `type:` and workflow fields |
| `textDocument/hover` | Note card for `[[id]]` links: name, type, status, summary, inbound count |
| `textDocument/definition` | Go-to-definition for `[[id]]` wikilinks |
| `textDocument/prepareRename` | Validate rename position; returns current ID as placeholder (required by Zed, Helix) |
| `textDocument/rename` | Vault-wide ID rename as `WorkspaceEdit`; rewrites `id:` and all `[[id]]`, `[[id\|alias]]`, `![[id]]` |
| `textDocument/references` | All `[[id]]` occurrences vault-wide; optional declaration location |
| `textDocument/documentSymbols` | Frontmatter fields (kind=8) + headings (kind=15) |
| `textDocument/codeAction` | Quickfix: create stub note for broken `[[id]]` links |
| `workspace/symbol` | Vault-wide ID/name/type search (up to 100 results) |

### Server → client

- `textDocument/publishDiagnostics` — broken wikilinks as severity=2 Warnings, pushed after every vault rebuild
- `client/registerCapability` — registers `**/*.md` file watcher after `initialized`
- `window/logMessage` — index rebuild notifications (note count, errors)

### Transport

```
Content-Length: <byte-length>\r\n\r\n{"jsonrpc":"2.0",...}
```

stdin → editor messages · stdout → server messages · stderr → internal debug logs

### Quick connect (Neovim)

```lua
configs.yamlink = {
  default_config = {
    cmd       = { 'yamlink', 'serve', '--lsp', '--vault', vim.fn.getcwd() },
    filetypes = { 'markdown' },
    root_dir  = lspconfig.util.root_pattern('.yamlinkignore', '.git'),
  },
}
lspconfig.yamlink.setup({})
```

---

## Activity Stream (Home Panel)

`yamlink.openHome` — opens the Home panel. Yamlink's home screen for your vault. Shows:

- **Vault pulse** — note count, type count, and broken link count (highlighted in warning color when > 0)
- **Quick-action buttons** — "New note" (primary), "Today" (daily note), and per-vault type buttons for your top types (up to 4)
- **Activity feed** — last 15 mutation events as a human-readable timeline, most recent first, each entry clickable to open the note
- **Continue working** — your 5 most recently touched notes, clickable
- **Task groups** — overdue, today, upcoming, and open / undated work pulled from the shared task engine
- **Nudge cards** — broken links card (opens Problems panel), untyped notes card (opens a `!view where type is empty` query)
- **Projection Snapshot** — a compact forecast card that summarizes where the vault seems to be heading next and links into full Vault Health detail

The Home panel is the first operational task surface in Yamlink. It is where vault pressure should be visible before you even open Calendar or a note report.

Auto-opens on first vault activation (once per vault, keyed by root path). Cold-start state: when a vault has fewer than 5 notes, the two-column body is replaced with an onboarding welcome screen showing 3 quick-start steps.

**Quick access:** the `$(home)` button in the status bar (immediately right of the vault-health indicator) opens the Home panel from any file with a single click — no command palette needed.

### Task notifications

Yamlink can raise low-noise VS Code task notifications as a secondary signal layer:

- overdue tasks trigger warning popups
- due-today tasks trigger information popups
- alerts are deduped by vault state so the same set does not keep re-firing on every refresh
- popup actions let you review the first task, open Calendar, or open Home

Per-vault settings:

- `yamlink.taskNotifications.enabled`
- `yamlink.taskNotifications.includeOverdue`
- `yamlink.taskNotifications.includeDueToday`
- `yamlink.taskNotifications.maxItemsPerAlert`
- `yamlink.taskNotifications.reminderCooldownMinutes`

---

## Commands

Yamlink registers the following commands in the VS Code command palette:

- `Yamlink: Open Home` — opens the Home activity stream panel (see above)
- `Yamlink: New Note` — unified quick-create: pick a type, enter a title, get a scaffolded note. Type list shows templates first (with their field signatures), then vault types, then free-form. Scaffold priority: matching `_templates/` file → schema node → observed vault patterns.
  - **Keybinding**: `Ctrl+Alt+N` (Windows / Linux), `Cmd+Alt+N` (macOS)
  - **L3 contextual linking**: when triggered from inside an existing Yamlink note, offers to add a reverse relation field in the new note pointing back to the current one. Useful for keeping links bidirectional without manually editing both files.
- `Yamlink: Open Daily Note` — opens or creates today's journal note (`journal-YYYY-MM-DD.md`) at the vault root. Uses `_templates/journal.md` if present; otherwise creates a minimal stub with `id`, `type: journal`, and `date` pre-filled. Cursor placed after frontmatter for immediate writing.
  - **Keybinding**: `Ctrl+Alt+J` (Windows / Linux), `Cmd+Alt+J` (macOS)
  - Journal notes are first-class notes: queryable (`!view journal sort date desc limit 7`), linkable (show as incoming on linked notes), graphable, and visible in the calendar.
- `Yamlink: New Note from Selection` — selected text in the editor becomes the title of a new linked note; the selection is replaced with `[[new-id]]`
- `Yamlink: Extract Selection to New Note` (`yamlink.splitNoteBody`) — selected body text becomes the body of a new note; the selection is replaced with `![[new-id]]` (embed); `source: [[original-id]]` is written into the new note's frontmatter. Both commands appear in the editor right-click menu when text is selected in a Markdown file.
- `Yamlink: Query in Plain English` (`yamlink.naturalQuery`) — type a plain-English description; Yamlink generates the `!view` syntax using 16 sentence templates and 100% vault vocabulary injection. Works for any domain. The generated query is shown in a preview QuickPick before insertion. Standard `!view` syntax is unchanged — this is a learning and discovery tool.
- `Yamlink: New Note from Template` — pick a specific `_templates/` file directly
- `Yamlink: New Note from Schema`
- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Vault Health`
- `Yamlink: Import Obsidian Vault`
- `Yamlink: Import Git History` — one-time command for git-tracked vaults; backfills the mutation event log with real commit history
- `Yamlink: Open View`
- `Yamlink: Open Graph Workspace` — opens centered on the active note
- `Yamlink: Open Vault Graph` — opens in vault-wide constellation mode
- `Yamlink: Open Graph` — opens the sidebar graph panel
- `Yamlink: Add Missing Creation Dates` — scans the vault for notes missing a `created:` field and writes the file system birthtime (falling back to mtime) into each. Shows a reliability warning before writing: birthtime is not preserved across git clones, drive migrations, or syncs. Safe to run; skips notes that already have `created:`.
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
- `group by`

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

### Virtual file-stat fields

Two implicit fields are available in any query without adding them to frontmatter:

- **`file.created`** — the file system birthtime of the note, as `YYYY-MM-DD`. Falls back to mtime on systems that don't preserve birthtime (git clones, some syncs).
- **`file.modified`** — the file system last-modified time of the note, as `YYYY-MM-DD`.

```md
!view contact
where file.created >= 2026-01-01
select name, status, file.created
sort file.created desc
```

```md
!view *
where file.modified >= today()
select id, type, file.modified
```

Both fields support all standard operators: `=`, `!=`, `>=`, `<=`, `>`, `<`, `contains`, `is empty`, `exists`.

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

Yamlink has a real visual query builder built into the editor.

It helps you build:

- type tables
- incoming/backlink views
- task and calendar views
- query suggestions from Note Report context
- refinements to existing `!view` blocks
- grouped views with `group by`
- live preview of the exact generated `!view` text before writing

It's editor-native: you stay in VS Code, work in plain text, and the builder helps with structure rather than replacing it.

### Current query-builder behavior

- `Yamlink: Query Builder` opens a dedicated side panel
- uses a real `View -> Shape -> Preview` flow instead of a loose prompt chain
- choose the view kind visually: table, incoming, or task preset
- compact shaping flow for type, columns, layout, grouping, sorting, and limits
- `Recommended / All fields / Custom` column modes for table queries
- progressive disclosure via collapsible sections:
  - `Result layout`
  - `Filters`
  - `Sort & limit`
  - `Details`
- layout modes shown with Yamlink iconography:
  - Table
  - Matrix
  - Bar
  - Scatter
- live result summary and sample rows before insertion
- sample rows rendered like actual result rows instead of raw field blobs
- exact generated `!view` text shown in the panel at all times
- preview status line reports when the query is ready to insert or needs review
- if your cursor is already inside a `!view` block, the builder opens in replace/refine mode instead of only inserting a new block
- contextual query recipes inside Note Report
- **Open Yamlink Query Builder** lightbulb action on `!view` blocks
- **Refine this view** action for existing queries
- query warnings suggest specific repairs for common mistakes (mistyped field, unknown type, etc.)
- one-step smart repairs for simple fixable problems
- falls back to direct editing when that's the fastest fix
- runs the updated view automatically after inserting or refining
- **plain-language query explanation** — the preview panel states the result in a real sentence built from the actual query and result, not a static description: "This will show 9 character notes, sorted by hub score (highest first), with name/status/unit columns."
- **Fast starts** — one-click preset buttons in the Shape step that set a real where/sort combination for the current type: **Most connected** (sort by hub score), **No incoming links** (find notes nothing else links to), **Recently modified**, **Recently created**. Each just fills in the same filter/sort fields you could set by hand — no separate code path, no new query syntax.
- **computed fields in the field picker** — `_inbound_count`, `_outbound_count`, and `_hub_score` (see "Computed fields" below) appear alongside real frontmatter fields in every field dropdown and the custom column list, each with an inline description so it's clear they're vault-computed rather than something you wrote (e.g. "_hub_score — how connected this note is; higher means more central to the vault").

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
- virtual rendering for large result sets — panels with 500+ rows render only the current page server-side; search, filter, and pagination route through the extension host rather than manipulating hundreds of DOM rows
- **matrix view** — toolbar toggle (Table | Matrix) on any `!view` result; column type picker selects what appears as matrix columns; rows = query results, columns = all vault notes of the chosen type, cells show ● for connected pairs; bidirectional edge detection; 100 × 50 grid cap with truncation note; column and row headers click-through to notes
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

### Task status chips

The task table `done` column shows five distinct states:

| State | Color | Condition |
|---|---|---|
| Done | teal | `done: true` |
| Due today | yellow/gold | task date equals today |
| Due soon | amber | task date is 1–3 days from now |
| Overdue | red | task date is in the past |
| Not done | muted | no date, or date is 4+ days out |

### Chart views

Any `!view` result or Query Builder query can be rendered as a bar chart or scatter plot — not only as a table. Switch layouts using the toolbar toggle on any live result without changing the underlying query.

- **Bar chart** — set `layout: bar` in the `!view` block, or click **Bar** in the Query Builder layout toggle. A **Group by** picker appears to select which field aggregates the bars. Queries already using `group by` render immediately. Bars are labeled and colored by the Apollo palette. Useful for category distributions: notes per status, missions per outcome, contacts per account, scores by type.
- **Scatter plot** — set `layout: scatter` or click **Scatter**. Yamlink auto-selects the first two numeric or date fields as X/Y axes; axis dropdowns let you change them. The Scatter option is greyed out when the result set has no numeric or date fields.
- **Matrix** — set `layout: matrix` or use the Table | Matrix toolbar toggle. A column type picker selects which vault note type populates the matrix columns; rows = query results, cells show ● for connected pairs. See supported table behaviors above.

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

The Note Report uses a five-tab layout to avoid excessive scrolling:

- **Overview** — frontmatter briefing, vault signals, and signal details
- **Links** — outgoing and incoming relation tables grouped by field, plus body-mention rows
- **Tasks** — Markdown task sections and a date-sorted timeline
- **Views** — contextual query recipe suggestions and intelligent next-view cards
- **History** — mutation event log showing how this note has changed over time

Tab selection persists across note switches via localStorage.

### Overview tab

**Briefing section** — scalar (non-relation) frontmatter fields. Priority fields (`title`, `name`, `status`, `owner`, `date`, `due`, `priority`) appear first. Fields beyond 8 are collapsed under "other fields".

**Signals section** — quantitative vault-position facts for the active note:
- note type
- structured inbound link count vs. vault average
- structured outbound link count vs. vault average
- lifecycle state (`draft` / `growing` / `consolidated` / `hub` / `stale`)
- inferred note role (when Yamlink is confident enough to surface it)
- next suggested view (when a strong suggestion exists)

**Signal details section** — diagnostic breakdown, collapsed by default:
- total inbound and outbound link row counts
- body-mention counts (in and out)
- which fields link to this note, and how many via each
- which fields this note links out through
- which note types link to this note, and which this note links to
- body evidence (repeated body wikilinks that reinforce intelligence signals)

### Links tab

- **Outgoing relations** — relation tables grouped by field; reads from the live graph edge layer so body wikilinks also appear as outbound edges, not only frontmatter fields
- **Incoming relations** — notes that reference this note through structured frontmatter fields
- **Body mentions from this note** — wikilinks found in the note body that point to other notes
- **Body mentions to this note** — wikilinks from other note bodies that point here
- **Unlinked mentions** — notes whose body text mentions this note's name or id without a formal `[[wikilink]]`. Word-boundary matched, case-insensitive, wikilinks stripped before scanning. Sorted by occurrence count. This is the Roam Research discovery pattern: organic mentions surface before the user formalises the link. Clicking any entry opens that note.

All relation tables collapse empty columns automatically.

### Tasks tab

- tasks extracted from Markdown task lines (`- [ ]` / `- [x]`) inside this note
- timeline: sorted date entries from the note's own `date:` field plus task due dates

### Views tab

Contextual query recipes generated from the active note's graph position and intelligence model:

- "Backlinks to this note" — all structured backlinks
- Incoming type-specific views — focused on the 1–2 most common inbound note types
- "More [type] notes" — browse other notes of the same type
- "Related thread" views — from the intelligence model's relation-view projection
- "Surrounding setup" views — from shared-neighborhood suggestion patterns

Schema-defined fields can seed suggestions before any backlinks exist.

### History tab

Shows how this note has changed structurally over time.

**Structural arc** — a vertical milestone spine at the top of the tab. Each phase that fired for this note is shown in sequence with a relative timestamp ("3w ago", "yesterday"). Each phase has a distinct Lucide icon and semantic color:

- **Note created** (FilePlus, mint) — when the note first appeared (from the event log or the one-time mtime backfill)
- **Type established** (Tag, lavender) — when `type:` was first set, with the type name as detail
- **First link** (Link, mint) — when the first outbound `[[wikilink]]` was added to frontmatter, with the linked ID as detail
- **Last activity** (Clock, amber) — the most recent structural change not already shown above

**Event log** — full mutation timeline below the arc, grouped by time bucket (Today / Yesterday / This week / Month Year), newest first within each group:

- `note_created` — green
- `type_set` — purple, shows the new type value
- `field_added` — blue, shows field name and new value (wikilinks unwrapped to bare IDs)
- `field_changed` — amber, shows field name, old value strikethrough, and new value
- `field_removed` — grey, shows field name
- `relation_added` — mint, shows relation field and the new target ("Linked")
- `relation_changed` — purple, shows relation field, old target strikethrough, and new target ("Relinked")
- `relation_removed` — muted, shows relation field and the cleared target ("Unlinked")

Events are written to `.yamlink/mutation-log.ndjson` at the vault root and survive extension restarts (up to 200 events shown per note; 10,000 total across the vault). The `.yamlink/` folder is gitignored automatically.

On first activation, existing notes receive a one-time backfill `note_created` event anchored to file mtime, so the arc is not empty for notes predating the extension install. The backfill runs once and is guarded by a `.yamlink/history-backfill.done` marker.

**Git history import (`yamlink.importGitHistory`):** For vaults tracked in git, run this command once to reconstruct the full structural evolution of every note from commit history. Yamlink walks each `.md` file with `git log --follow`, reads frontmatter at each commit snapshot, and emits accurate `note_created`, `type_set`, `field_added`, `field_changed`, `field_removed`, and `relation_changed` events with real commit timestamps. After import, the History arc and event log show the note's actual evolution going back to the first commit, not just from the extension install date. Guarded by `.yamlink/git-history-import.done` — re-run by deleting that file. The History tab works for all users without git; the git import is an opt-in power-user enhancement.

### General behavior

- follows the active note automatically
- can be focused explicitly from the editor title or command palette
- supports search within the report (scoped to the active tab)
- supports opening related notes directly from any relation table
- outbound links read from the graph edge layer, not frontmatter-only scanning, so body wikilinks count as real outbound connections

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

This means Calendar is already both a task surface and an activity surface:

- a task with a due date appears on its due date
- a note with `date:` appears as dated note activity
- a note with only `created:` appears as created-note activity

### Capabilities

- range switching
- selected-range activity summary
- click-through to related notes
- keyboard shortcuts:
  - `M` / `W` / `D` for month, week, and day mode
  - `[` and `]` to move backward and forward through the current range
  - `T` to jump to today

---

## Note Outline

The Note Outline panel lives in the Yamlink sidebar (`yamlink.noteOutline` view). It shows the structural outline of the active Markdown note — headings with per-section metadata that VS Code's native Outline panel does not surface.

### What it shows

Each heading row displays:
- **Heading text** and level with section-aware icons (active section, task-heavy section, linked section, and structural parent sections each get a different icon treatment)
- **Anchor link count** — how many other notes link to this note at this specific heading (`[[id#section]]`) — e.g. `2 links`
- **Task count** — how many `- [ ]` or `- [x]` task lines are inside this section — e.g. `3 tasks`
- **Body mention count** — how many wikilink mentions appear inside that section body
- **Word count** — approximate body word count between this heading and the next — e.g. `~240w`
- **Section preview** — tooltip preview of the first meaningful line in the section

Description line example: `now · 2l · 3t · 4m · ~240w`

### Behavior

- Follows the active editor automatically — refreshes on tab switch and on document change
- Tracks cursor movement and marks the current section in the outline
- Sticky current-section behavior keeps the active heading visible in the tree while you move through long notes
- Only activates for Markdown files
- Preserves heading hierarchy for long notes instead of flattening every heading into one list
- Auto-collapses unrelated branches so the current section path stays expanded and easier to scan in large documents
- Click any heading row to navigate to that line in the editor (`yamlink.revealOutlineLine`)
- Jump between same-level sections with:
  - `Yamlink: Next Sibling Section`
  - `Yamlink: Previous Sibling Section`
  - Default keys: `Ctrl+Alt+Down` / `Ctrl+Alt+Up` (`Cmd+Alt+Down` / `Cmd+Alt+Up` on macOS)
- Search and filter controls are available from the Note Outline view title and command palette:
  - search icon in the Note Outline title
  - filter icon in the Note Outline title
  - `Yamlink: Search Note Outline`
  - `Yamlink: Note Outline Filters`
  - `Yamlink: Clear Outline Filters`
- Filters preserve parent headings when a child section matches, so search results stay readable instead of flattening the note structure
- Sections with no metadata show only the heading name (no clutter on short or untitled sections)

This panel is intentionally richer than VS Code's native Outline: task and anchor data are vault-derived signals, not just syntactic heading positions.

---

## Tasks

Tasks are a real workflow surface in Yamlink.

### Task functionality

- task extraction from Markdown task lines
- stable task block IDs
- task visibility in Calendar
- task visibility in Note Report
- task visibility in the Home panel
- optional VS Code notifications for overdue and due-today tasks
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

### Task Center

A dedicated "Tasks" view in the Yamlink sidebar (alongside Graph, Note Report, Calendar, and Note Outline) — a real place to work with every task in the vault, not just a glanceable preview.

- Every task grouped into Overdue / Today / Upcoming / Undated / Done, with no hard cap per bucket — except Undated, which shows the first 5 by default and collapses the rest behind a "Show N more" row so a large untriaged backlog doesn't dominate the view
- Native checkboxes mark a task done or open directly from the sidebar — the file's `- [ ]`/`- [x]` line updates immediately, no need to open the note
- Clicking a task jumps to its exact line, not just the note
- **Priority markers** — write `#urgent`, `#medium`, or `#low` in a task line (`#high` and `#medium-priority` also recognized) and Task Center picks it up automatically: shown as a colored dot on the task, urgent/medium tasks sort to the top of their status bucket, and the tag itself renders in a matching color in the editor (red/amber/gray) instead of the generic tag color. A closed, explicit vocabulary — priority is never inferred from wording, only from a marker you actually typed.
- Overdue tasks marked `#urgent` escalate to VS Code's error-level notification instead of the usual warning

---

## Graph

Yamlink uses x-graph — a custom Canvas2D engine built from scratch. No Cytoscape.js. No Pixi.js. The entire third-party graph stack was removed in the Shujimi optimization pass.

---

### x-graph engine

x-graph is a custom Canvas2D renderer combined with D3-force physics, designed as a layered visualization system. It lives in `graph/` and is built via esbuild into a standalone bundle (`dist/graph-engine.js` + `dist/graph-layout-worker.js`).

#### Architecture

- **Canvas2D renderer** — single `<canvas>` element, `requestAnimationFrame` loop, no WebGL dependency
- **D3-force physics** — `forceSimulation` with link, charge, center, and collide forces
- **Layout options** — `InlineLayout` (main thread, CORS-free) or `LayoutWorker` (Web Worker, non-blocking)
- **Adapter layer** — `adaptYamlinkModel()` converts the VS Code extension's graph model; `adaptDocsGraph()` converts the docs site's build-time JSON. Both output the same universal `{ nodes, edges }` format.

#### Layer system

Three independent visual channels that stack additively:

**Layer 1 — Base** (always on)
- Node circles sized by hub score (connection weight)
- Kind-colored nodes: person/teal, event/amber, artifact/mint, schema/purple, task/pink, container/blue
- Hover: node + direct connections highlight; non-connected notes dim
- Selection: click pins focus; click again deselects
- Hub accent: white center dot on nodes with weight > 0.6

**Layer 2 — Semantic** (toggle)
- Edges colored by source node type, with field-name overrides for named relation types (person/contact edges → teal, project/container edges → amber, topic/tag edges → purple, event/session edges → pink)
- Triangle arrowheads on directed edges
- Dashed lines for weak-strength links
- Inline legend expands when active, showing edge color key

**Layer 3 — Health** (toggle)
- Colored ring drawn around each node from lifecycle state: hub (#4fc4a0 teal), consolidated (#3fb950 green), growing (#e7a85a amber), draft (#8899aa gray), stale (#ff6b6b red)
- Drift state overrides lifecycle ring: minor-drift (#ffd93d yellow), drifting (#ff9a3c orange), outlier (#ff6b6b red)
- For extension use: lifecycle from `lifecycleState.js`, drift from `driftDetector.js`
- For docs site: lifecycle inferred from link count (hub ≥ 12, consolidated ≥ 6, growing ≥ 2, draft ≥ 1, stale = 0)
- Inline legend expands when active, with separate keys for lifecycle and drift

#### Interaction

- **Pan** — click and drag on empty canvas
- **Zoom** — scroll wheel, centered on cursor position; range 0.05× – 8×
- **Fit** — double-click canvas or press the Fit button
- **Node drag** — click and drag a node to reposition it; the node is pinned via D3-force `fx`/`fy` during drag, connected nodes respond through live physics, releasing unpins the node so it settles naturally
- **Hover** — shows node info card (label, section/type, lifecycle badge, link count); connected nodes highlight, non-connected nodes dim
- **Click** — pins the focus on the selected node
- **Search** — substring match on node labels, 120ms debounce; non-matching nodes dim, matching nodes get a yellow ring
- **Filter** — type filter chips pass exact vault type strings to `setFilter(Set<string>)` (e.g. `'contact'`, `'mission'`); only matching nodes are shown, edges to hidden nodes disappear

#### Cluster shape and physics

The layout engine produces a filled field of nodes with readable subclusters, not a ring:

- **Fibonacci spiral seed** — cluster anchors start at golden-angle-spaced positions with varying radii; breaks radial symmetry before the simulation begins
- **Topology mini-force** — a 32-iteration inter-cluster simulation runs after BFS: connected clusters pull toward each other, isolated ones drift outward, producing organic grouping
- **Weight-aware center pull** — hub nodes are attracted 2.5× more strongly toward origin, creating a natural radial depth gradient; lighter peripheral notes form the outer shell
- **Convergence detection** — the animation loop exits as soon as all nodes move < 0.2px/frame, preventing perpetual micro-jitter on settled layouts

#### Cluster hull rendering

Translucent shape overlays appear behind each cluster (zoom 0.12–1.80):

- Graham scan convex hull computed for each cluster's node positions; vertices expanded 26 units outward from centroid
- Smoothed via quadratic bezier curves (hull points as control points, edge midpoints as path endpoints) — produces rounded, organic shapes
- Fill at 6% alpha, stroke at 13% alpha, both in the hub node's type color
- **Focus-aware** — hovered/selected cluster brightens (10%/22%); all others dim (2.5%/6%)

#### Performance architecture

The renderer is built to stay fast as vault size grows:

- **Edge batching** — edges are bucketed by style (color, line width, dash pattern) and drawn with a single `stroke()` call per bucket. Base mode: 2 stroke calls per frame regardless of edge count. Semantic mode: ~6–12 buckets per frame.
- **Frustum culling** — nodes and edges outside the current viewport are skipped entirely in every pass (draw loop, label pass, hit test prep)
- **Dot mode** — at zoom < 0.10 with > 200 nodes, node arcs are replaced with color-bucketed `fillRect` calls (~10× faster); hovered/selected nodes still get a proper circle
- **Edge cutoff** — the entire edge pass is skipped below zoom 0.06 (nodes are sub-pixel; edges are invisible)
- **Label LOD + fade** — label density adapts to zoom; labels fade in over a 0.05-zoom ramp instead of snapping on at the threshold
- **Web Worker layout** — the force simulation runs in a Web Worker (`LayoutWorker`) so physics never blocks the main thread

**Current practical ceiling**: ~2,000–3,000 nodes at 60fps. At ~5,000 nodes performance begins to degrade.

**Roadmap optimizations**:
- **Spatial grid for hit testing** — replace the current O(n) linear hit test scan with a grid-partitioned lookup → constant-time hover detection regardless of node count
- **Float32Array positions** — replace per-tick position object allocation with typed arrays → eliminates GC pressure during D3 ticks
- **WebGL renderer** — Canvas2D ceiling is ~3–5k nodes. A WebGL render path (raw WebGL or `regl`) can handle 50k+ nodes. This is the next major engineering milestone for x-graph, planned post-Shujimi.

#### API

```js
import { createGraph, adaptYamlinkModel, adaptDocsGraph } from './graph/index.js';

const g = createGraph({
  container,        // HTMLElement
  workerUrl,        // omit to use InlineLayout (file:// safe)
  width, height,
  onNodeClick,      // (id, node) => void
  onNodeHover,      // (id, node) => void
  onSettled,        // () => void
});

g.load(adaptYamlinkModel(model));   // or adaptDocsGraph(docsData)
g.setLayer('semantic', true);
g.setLayer('health', true);
g.setFilter(new Set(['person', 'event']));
g.setSearch('rico');
g.fitView();
g.resize(w, h);
g.destroy();
```

---

### Graph surfaces (both powered by x-graph)

**Sidebar graph** — ambient, always visible:
- `Yamlink: Open Graph` opens the sidebar panel
- Shows a vault constellation by default (all notes as dots)
- Switches to local scope when you click "Explore →" on a note
- Vault scope: every note as a dot, size encodes hub score
- Local scope: direct connections of the current note (1 hop)
- Type-colored convex hulls drawn behind dots for any type with ≥ 3 nodes

**Graph Workspace** — deliberate exploration panel:
- `Yamlink: Open Graph Workspace` opens centered on the active note (Focus mode)
- `Yamlink: Open Vault Graph` opens in vault-wide Explore mode
- Source: current note / query-defined / custom note list
- Modes: Focus (current note + strongest connections) / Explore (vault-wide)
- Advanced filters: type / relation / tag facets, active filter chips, reset
- Selection card: label, type, outgoing/incoming counts, signal score, hidden neighbors, strongest link, connected types, tags
- Isolate, Hide unrelated, Show all actions
- Cluster chips, minimap

### Graph role

The sidebar gives ambient structural awareness. The workspace is for deliberate, scoped exploration. Both surfaces use x-graph: Canvas2D + D3-force, semantic and health layers, draggable nodes with live physics.

### Time-lapse

Both graph surfaces have a toolbar toggle that opens a play/pause/scrub bar, playing back how the vault's knowledge graph grew over time:

- **Git-backed reconstruction** — if the vault is a git repository, each checkpoint is reconstructed from real historical file content at the nearest commit, including body-text `[[mentions]]`, not just frontmatter relations.
- **Mutation-log fallback** — non-git vaults fall back to `.yamlink/mutation-log.ndjson`, which tracks body-text mention changes as well as frontmatter changes.
- **Stable playback** — one fixed, pre-settled layout is solved once for the vault's current state; historical frames only reveal or hide a subset of that layout via alpha fade, so node positions never shift during playback.
- The same reconstruction engine backs the `?at=` API parameter and the CLI's `--at`/`story --since` time-travel commands (see the "Time Engine on the CLI" note under [Yamlink CLI](#yamlink-cli)).

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
- **vault projections** — a first-pass forward forecast across:
  - growth by note type
  - stale-note pressure
  - structural direction (improving / steady / fragile)
  - evidence-weighted confidence per lane
  - type-specific leaders for stale pressure and structural fragility when the vault has enough data
  - a recent 4-week trend memory layered over the same signals
  - a scenario layer for “if cleanup pace holds”, “if cleanup improves”, and “if growth pace holds”
- **schema conformance** — per-type coverage (% of notes with all required fields), list of non-conformant notes with their missing fields, advisories for types that have notes but no schema (only surfaces when ≥1 schema exists — schema amplifies, never gates), dangling relation warnings (schema references a target type with no vault notes)

### Navigation

Vault Health sections are organized into tabs so you navigate directly to the section you want rather than scrolling:

| Tab | Content |
|---|---|
| Activity | Today's notes with mutations, click-through to Note Report |
| Lifecycle | Draft / Growing / Consolidated / Hub / Stale distribution cards |
| Consistency | Type-consistency score cards and drift pills for divergent notes |
| Schema | Per-type conformance coverage, non-conformant notes, dangling relation warnings |
| Templates | Notes drifted from their `_templates/` definition (conditional — only when drift exists) |
| Intelligence | Projection lanes for growth, stale pressure, and structure direction |
| Types | Full entity type catalog with expandable note lists and View buttons |
| Orphans | Unlinked notes (conditional — only when orphans exist) |

Clicking the Nodes, Types, Schema, or Orphans cards in the stats strip jumps directly to the matching tab.

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
- **Consolidated** — looks complete for its kind
- **Hub** — many other notes point to it
- **Stale** — likely needs review because it has not moved recently

### Type consistency in plain language

- **On Track** — this note looks normal for its type
- **Slightly unusual** — something looks a bit off for this note type, but it's not alarming
- **Missing structure** — probably missing expected structure
- **Very unusual** — very different from the rest of its type

### Role

Vault Health is the operational quality surface for the vault — not just diagnostics, but a structural snapshot that makes health trends visible over time.

### Vault projections

Vault Projections are built on the Time Engine: `src/intelligence/vaultTrends.js` reconstructs the vault at real historical checkpoints (via `reconstructVaultAtTime()`) and fits an actual least-squares trend line through real per-type note counts, rather than extrapolating from a single rolling mutation-log window.

Three lanes, each with a real historical trajectory:

- **Growth** — `growth.trend` (rising/steady/falling) with a 4-week line chart and a 90-day projection per leading type
- **Stale** — `stale.pressure` (low/medium/high), plus a "going stale soonest" list of specific notes ranked by real days-remaining
- **Structure** — `structure.direction` (improving/steady/fragile), naming the actual missing fields driving drift for that type

Every projection reports a genuine fit-quality signal (R²) instead of a hand-tuned confidence score, and never fabricates continuity before the earliest reconstructable event. **Retrospective accuracy scoring** makes the claim falsifiable: it reconstructs the vault as of 90 days ago, runs the same trend-fit on that trailing history, and compares what it would have projected for "today" against what actually happened.

Shown in both Vault Health's Projections tab and the Home panel's compact snapshot strip, from one shared rendering (`buildVaultProjectionsCardHtml()`) so both surfaces stay in sync.

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
- near-duplicate scalar frontmatter values (see note below, this one's still an experiment)

Diagnostics appear as hints, warnings, or advisory information depending on severity.

**Near-duplicate scalar value hint — experimenting with, not a committed feature yet** — while editing a plain frontmatter value (not a wikilink relation), Yamlink checks whether it's a near-duplicate of a value already used on the same field by another note of the same type — same casing/spacing difference (`Buenos Aires` vs `buenos aires`) or a close typo (`activ` vs `active`). Fires as a Hint, same severity tier as the missing-`id:` hint — never an automatic rewrite, just a nudge toward vault-wide consistency. Available identically on VS Code and the LSP server.

This is deliberately a small first slice, not the end state: it only compares values already sitting in your vault, one field at a time, with no cross-note "canonical value" concept and no way yet to tell Yamlink two values should always be treated as the same. What it's aimed at, concretely — a CRM vault where `Acme Inc.` and `Acme, Inc` silently split one account's activity across two spellings and no report ever catches it; a worldbuilding vault where a location name drifts across a hundred notes, three slightly different ways, without anyone noticing; a research vault where an author's name formatting varies note to note, quietly breaking "show me everything by this person." If this proves genuinely useful in real vaults, the natural next steps are a one-click "use the existing value instead" quickfix and, further out, a real canonicalization/alias layer for scalar values (something like `aliases:` already does for note identity, but for plain field values) — neither exists yet.

**Tag pill decorations** — `#hashtag` tokens in the note body and values in `tags:` / `labels:` frontmatter fields are highlighted with a purple pill (background fill + rounded border). Works across all Markdown language mode variants (`markdown`, `markdown-extended`, etc.).

**Broken link styling** — broken `[[wikilinks]]` in the editor are decorated with amber brackets and faded amber text instead of a yellow squiggle, keeping the reading experience intact while still making dead references visible. The diagnostic is downgraded to Hint severity; broken links remain visible in the Problems panel and in the Home panel nudge count.

**Broken link quick fix — template-guided creation** — the "Create note" lightbulb on a broken `[[wikilink]]` guides you through the template workflow before creating the note:

- No `_templates/` folder → offers to create the folder and write a starter template scaffolded from vault field patterns. The template opens for editing; trigger the quick fix again once it's ready.
- `_templates/` exists but empty → offers to create a starter template for the inferred type.
- `_templates/` has templates → shows a QuickPick of all available templates. If one matches the inferred type, it floats to the top labeled "Suggested". Pick a template (or "Create without template") and the note is scaffolded immediately. Escape cancels without creating anything.

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
- Smart Templates can now hand off directly into ranked follow-up completion on the first empty field after schema insertion
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

## CLI

The `yamlink` command provides full headless vault access. All commands support `--vault <path>` (default: current directory) and most support `--json` for machine-readable output.

### Setup

```bash
# In the yamlink project folder — makes `yamlink` available globally in your terminal
npm link
```

### Commands

| Command | What it does |
|---|---|
| `yamlink build` | Index vault, report broken links / duplicate IDs (exits 1 on issues) |
| `yamlink doctor` | Comprehensive integrity pass: broken links, duplicate ids, malformed frontmatter, orphans, schema violations, stale notes, arc gaps |
| `yamlink validate` | Schema conformance — exits 1 on required-field violations |
| `yamlink status` | Compact vault snapshot: notes, edges, types, broken links, generation |
| `yamlink briefing` | Vault pulse, overdue tasks, recent activity, arc predictions for today's notes |
| `yamlink query "<clause>"` | Run a query using the same language as `!view` blocks; outputs an ASCII table |
| `yamlink search <query>` | Fast lookup by id, name, title, or type; `--type` narrows results |
| `yamlink ls` | List notes with unix-style filtering and sorting (`--type`, `--sort`) |
| `yamlink grep <text>` | Search frontmatter values for matching text (`--field` narrows to one field) |
| `yamlink find` | Structural search by present/missing fields (`--has`, `--missing`) |
| `yamlink cat <id>` | Print a note's frontmatter snapshot and body; `--at <date>` for a historical snapshot |
| `yamlink links <id>` | Outbound and inbound links for a note, with broken-link markers; `--at <date>` for outbound-only history |
| `yamlink report <id>` | Full note report: type, lifecycle, drift, and links by field; `--at <date>` for a historical report |
| `yamlink diff <a> <b>` | Compare two notes' field sets, or `--since <date>` for recent vault-wide changes |
| `yamlink story --since <date>` | Vault growth story: note counts, per-type deltas, and activity since a date |
| `yamlink restore <timestamp>` | Preview a reconstructed vault as of a past date; `--output <path>` exports as `.md` files (never into the live vault) |
| `yamlink snapshot` | Capture a checkpoint now, for restoring further back later once the mutation log's retention window can't reach that far alone |
| `yamlink trends` | Growth/Stale/Structure forecast and retrospective accuracy — the same data Vault Health's Projections card shows |
| `yamlink create <type>` | Create a note non-interactively; accepts any number of `--field key=value` pairs |
| `yamlink set <id> <field> <value>` | Write a frontmatter field on a note; `--clear` removes the field; emits mutation events |
| `yamlink link <id> <field> <target>` | Add a `[[target]]` wikilink relation; `--append` adds to an existing multi-value field |
| `yamlink rename <old> <new>` | Vault-wide ID rename; `--dry-run` previews changes without writing |
| `yamlink template save <id>` | Save an existing note as a blank-skeleton `_templates/<type>.md` template; `--force` to overwrite an existing one |
| `yamlink glossary --type <a,b>` | Live alphabetized glossary of every note of the given type(s), with definitions and backlinks; nothing written to disk |
| `yamlink block-backlinks <id>` | Notes linking to a specific task/quote/heading/footnote inside the given note; `--block <block-id>` filters to one exact block |
| `yamlink mutations` | Recent mutation events from the vault log |
| `yamlink session` | Summarize recent or explicit mutation sessions |
| `yamlink on <event> -- <script>` | Run a shell script when matching mutation events fire |
| `yamlink watch` | Watch vault for `.md` changes, rebuild on every save |
| `yamlink suggest <id>` | Fields likely missing from a note |
| `yamlink drift` | Notes structurally drifting from their type's usual shape (`--type` narrows) |
| `yamlink stale` | Notes in a stale lifecycle state |
| `yamlink orphans` | Notes with no inbound or outbound links |
| `yamlink pressure` | Knowledge pressure: load-bearing drafts, stale hubs, orphans |
| `yamlink lenses` | Vault change lenses over mutation history |
| `yamlink schema list` | All schema notes: type, required fields, note count |
| `yamlink schema check <type>` | Conformance check for all notes of a type against its schema |
| `yamlink graph` | Export vault graph as `{ nodes, edges }` JSON; `--only-types` to filter; `--at <date>` for a historical reconstruction |
| `yamlink export` | Dump vault to JSON or CSV; `--format json\|csv` |
| `yamlink env` | Export shell variables for the current vault |
| `yamlink serve` | Local HTTP API server (default port 3000) |
| `yamlink serve --lsp` | JSON-RPC 2.0 LSP server over stdio for Neovim, Zed, Helix, Emacs |
| `yamlink conduit` | Terminal UI — 10 screens; auto-starts the API server if not already running |
| `yamlink init [path]` | Scaffold a new vault with `.yamlink/`, `_templates/`, and `welcome.md` |
| `yamlink completions bash\|zsh` | Print shell completion script; pipe into `.bashrc` / `.zshrc` |

### Examples

```bash
yamlink briefing --vault ~/my-vault
yamlink report johnny-rico --vault sample
yamlink query "where type = character" --vault sample
yamlink query "!view mission select id, date, outcome sort date desc" --vault sample
yamlink links johnny-rico --vault sample --json | jq '.inbound'
yamlink on field_added --type contact -- ./scripts/notify.sh
yamlink rename johnny-rico rico --dry-run
```

### Query syntax

The query command accepts bare clauses (auto-prefixed with `!view *`) or full `!view` format:

```bash
yamlink query "where type = contact and status = active"
yamlink query "!view contact select id, name, status where status = active sort name"
yamlink query "where date >= today()"
```

Space-separated `select` fields are normalized to comma-separated automatically, so `"select id name status"` and `"select id, name, status"` behave identically.

### Use cases

- **Scripting** — query vault data in shell pipelines, `jq` post-processing, or cron jobs
- **CI/CD** — validate vault health in a CI step (`yamlink health --json`)
- **Quick lookup** — check links or field data on any note without opening VS Code
- **Export pipelines** — pipe `--json` output to downstream tools

---

## Conduit (Terminal UI)

`yamlink conduit` (or bare `yamlink`) opens the terminal UI. Conduit auto-starts the API server if nothing is listening on the configured port — no separate `yamlink serve` needed.

### Screens

| Key | Screen | What it shows |
|---|---|---|
| `1` | Briefing | Vault pulse, overdue tasks, recent mutation activity |
| `2` | Query | Live query runner — type a `!view` clause, see results as an ASCII table |
| `3` | Navigator | Type filter + fuzzy search across all notes; `Enter` opens in `$EDITOR` |
| `4` | Explorer | Two-pane browser (types → notes) with intelligence preview; full write capability |
| `5` | Health | Schema coverage bars, advisories, dangling relations, vault health score |
| `6` | Search | Free-text vault search |
| `7` | Graph | Vault graph navigator; `v` toggles a live spatial "constellation" layout |
| `8` | Diff | Side-by-side note diff |
| `9` | Radar | Relation radar — connections radiating from the current note |
| `0` | Trends | Vault projections — growth, stale, structure, and staleness forecast |

### Global key bindings

| Key | Action |
|---|---|
| `1`–`9`, `0` | Switch to screen by number (applies to focused pane in split mode) |
| `\|` | Toggle split view — two independent screens side by side |
| `Tab` | Cycle panes in split mode (lit border = active) |
| `?` | Open help overlay |
| `:` | Open command palette |
| `Esc` | Go back / close overlay |
| `Ctrl+C` | Quit |

### Explorer key bindings

| Key | Action |
|---|---|
| `Tab` | Cycle panes (types ↔ notes) |
| `j` / `k` | Move cursor (also arrow keys) |
| `Enter` | Open note in `$EDITOR` |
| `v` | **View note** — full Markdown reading view (NoteView) |
| `p` | Peek note detail overlay |
| `e` | Edit a frontmatter field in-place |
| `n` | Create a new note (3-step form) |
| `D` | Delete note (with confirmation) |
| `l` | Create a link from a field to another note |
| `/` | Filter notes by text |
| `H` | Note mutation history |
| `r` | Open Radar centered on selected note |
| `g` | Open Graph focused on selected note |
| `o` | Open note in `$EDITOR` |
| `Space` | Toggle multi-select on current note |
| `S` / `R` | Save / restore operational context |

### Split view

Press `|` from any screen to split Conduit horizontally. Each pane is an independent screen instance with its own navigation state. Both panes share the same SSE connection and vault data — no double polling. `Tab` cycles focus; `q` on the secondary pane closes split. The status bar shows the pane indicator when split is active.

### Briefing — session context

Every Conduit open shows what changed since your last session at the top of Briefing:

> *since your last session (14h ago): 3 notes created, 2 missions updated, 1 broken link appeared*

Powered by `GET /api/diff` scoped to the last-session timestamp in `.yamlink/conduit-last-session.json`. First run: no delta. Every subsequent open: the delta since you left.

### Graph — live spatial view

Press `v` on the Graph screen to switch from the list-based traversal view to a spatial "constellation" layout: the focused note centered in a card with branching, numbered lanes to each connection, labeled and colored by note type with a legend, honestly paginated ("+N more connections hidden") rather than overcrowding the terminal. Updates live over SSE as relations change while the view is open — no manual refresh needed.

### Explorer — bulk operations

Space bar places a `■` selection mark on a note. Build a multi-selection, then press Enter to open the bulk action menu:

| Action | What it does |
|---|---|
| Set field on all | Write `{ field: value }` to all selected notes via `PATCH /api/nodes/bulk` |
| Set status on all | Shorthand for the most common bulk edit |
| Delete all | Remove all selected notes (with confirmation step) |

Selection count is shown in the notes pane header throughout. Esc cancels at any step.

### Explorer — intelligence in note detail

The note detail pane (bottom of Explorer) shows lifecycle state, drift label, and top arc prediction inline — no `p` keypress required:

```
lifecycle: growing  drift: on-track  ↑ 4
next: commander  (high)
```

### Note View (`v` key)

Pressing `v` on any selected note in Explorer or Navigator opens the **NoteView** overlay — a full-screen Markdown reading experience rendered entirely in ANSI terminal output.

- **Headings** — H1 in pink+bold with underline bar, H2 in lavender with `▸`, H3 in secondary with `›`
- **Inline** — wikilinks in mint, backtick code in teal, bold/italic preserved
- **Tasks** — `- [ ] …` as amber `☐`; `- [x] …` as muted `☑`
- **Lists, blockquotes, code fences** — rendered with appropriate borders and colors
- **Scroll** — `j`/`k` line-by-line, pageDown/pageUp half-page; scroll percentage in footer
- **Heading navigation** — `]` next heading, `[` previous heading
- **Intelligence footer** — lifecycle badge in header; high/medium arc gaps shown as `⚑ missing: …`
- **Editor handoff** — `o` opens in `$EDITOR`; `Esc` returns to the previous screen

---

## Export

### Current export support

- CSV from live views
- JSON from live views
- PDF from live views
- PDF from active notes through `Yamlink: Export Active Note to PDF`
- JSON and text from the CLI (`yamlink query --json`, `yamlink report --json`)

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

### Guided tour

A first-run VS Code walkthrough (Command Palette → "Get Started") covers Home, Calendar, Vault Health, Graph, and Task Center, and walks through creating a first note and linking a second one.

---

## Platform Engineering

### Type safety

Yamlink uses `checkJs: true` in `tsconfig.json` to get TypeScript-quality type checking across the entire codebase with no build step and no `.ts` renames. Every exported function in `src/engine/`, `src/intelligence/`, `src/core/`, and the key `src/features/` modules carries JSDoc `@typedef`, `@param`, and `@returns` annotations. Running `npm run typecheck` must produce 0 errors — this is a release gate alongside lint and test count.

Key typedefs that cross module boundaries:

| Typedef | Module | Shape |
|---|---|---|
| `MutationEvent` | `src/core/index.js` | `{ timestamp, type, noteId, field, oldValue, newValue }` |
| `UpdateResult` | `src/core/index.js` | `{ changed, needsFull, changedId, mutationEvents }` |
| `FrontmatterDoc` | `src/core/frontmatter.js` | `{ hasFrontmatter, data, body, originalOrder }` |
| `TaskRow` | `src/core/tasks.js` | full task row with `id`, `fileId`, `line`, `done`, `date`, `links`, `fields` |
| `HealthStats` | `src/features/health/healthStats.js` | aggregate vault health snapshot |
| `WorkspaceFolderLike` | `src/core/workspace.js` | `{ uri: { fsPath: string } }` — structural substitute that works for both VS Code folders and CLI test harness objects |

The webview HTML blob files (`viewPanelHtml.js`, `entityHubHtml.js`, `healthHtml.js`, `calendarPanelScript.js`) are intentionally outside tsconfig scope — they will gain full coverage once the P1 webview architecture migration moves them to `src/webviews/` as compiled source.

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

Yamlink has a formalized color system — the **Yamlink Apollo palette** — applied consistently across all webview surfaces. Three variants ship (Night, Dusk, Dawn) with the VS Code theme family.

### Palette semantic roles

| Color | Semantic role | Used for |
|---|---|---|
| Pink `#FF429F` | Flow / Emphasis | Primary CTAs, active states, header brand |
| Mint `#C5FFBF` | Connection | Wikilinks, relation cells, note-created events |
| Lavender `#C49BF0` | Identity / Definition | Type labels, ID display, link targets |
| Amber `#E7A85A` | Structure / Schema | `!view` blocks, schema markers, warnings |
| Teal `#5ECFBE` | Support / Navigation | Hover states, interactive focus, healthy states |

All extension panels hardcode these values directly — they do not derive from `vscode-textLink-foreground`, which varies by theme and was the source of inconsistent blue accent colors in earlier releases.

### Icon family

All icons across Yamlink surfaces use **Lucide** — the same family used in the site app. No emoji or custom unicode glyphs. In plain-HTML webviews, Lucide icons are embedded as inline SVGs with `stroke="currentColor"` so they inherit semantic color from CSS.

### Theme safety

Surfaces must remain readable in both dark and light VS Code setups, regardless of which VS Code color theme is active. The Yamlink Apollo theme unlocks the full syntax-highlighted editor experience; the extension surfaces work without it.

### Editor experience

The Yamlink Apollo VS Code theme (`yamlink-apollo.json`) handles all editor-level color tokens:
- `yamlink.id` → lavender
- `yamlink.link` → mint
- `yamlink.schema.key` → pink
- `yamlink.date` → orange
- `yamlink.view.block` → amber bold
- `yamlink.query.keyword` → amber

These tokens require the Yamlink theme to be active. Extension-side editor decorations (broken link squiggles, codelens) use VS Code `ThemeColor` references so they adapt to any theme.
