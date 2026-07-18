# Yamlink 0.7.4 — Platform Depth

0.7.4 is the release that deepens everything Sugar (0.7.0) launched. Sugar made Yamlink a real platform — CLI, writable API, Conduit, LSP — outside the editor. 0.7.4 makes the intelligence layer genuinely smarter, gives the vault a real memory of its own history, and closes real gaps across every surface: VS Code, Conduit, and the LSP server other editors connect through.

---

## What's new in 0.7.4

### Time Engine — your vault remembers its own history

Ever wonder what a note looked like last month, or how much your vault has actually grown lately? 0.7.4 now let's you ask any note, or the whole vault, what it looked like at any point in the past, and get a real, reconstructed answer — not a guess.

Use it however you already work:

- **Watch it** — in the Graph panel, hit play on the new time-lapse control and watch your vault's connections form over time, the same way they actually did.
- **Ask it from the terminal** — add `--at 2026-01-01` to everyday commands like `cat`, `report`, `links`, or `graph` to see a historical snapshot instead of the current one. Or run `yamlink story --since <date>` (or the shortcut `--quarterly`) for a plain-English recap of what changed and how much you've grown.
- **Build on it** — if you're scripting against the API, `?at=<timestamp>` on the note or graph endpoints returns the same reconstruction programmatically.

*How it works, briefly*: Yamlink keeps a running log of every change your vault makes (and reads real git history too, if your vault happens to be a git repo). Asking "what did this look like on this date" takes the current version and undoes changes backward until it reaches that point — closer to rewinding a recording than digging up an old backup.

One honest limit worth knowing: that log doesn't go back forever, and a note that's since been deleted has no stored field history at all. So Yamlink always tells you plainly how far back it can actually prove its answer is correct, instead of quietly guessing and presenting it as fact.

### Vault Projections — real trend-fitting, not a rolling-window guess

The old projection model was a 4-week mutation-log window fed into a single `rate × 90` multiplier. Rebuilt from the ground up on the **Time Engine**:

- **Real trend-fitting** — Growth, Stale, and Structure are each reconstructed at real historical checkpoints and fit with an honest least-squares line, reporting a genuine fit-quality score (R²) instead of a hand-tuned heuristic.
- **Retrospective accuracy scoring** — a checkable claim no snapshot-free tool can make: "90 days ago this vault was on pace for ~42 `character` notes today; you actually have 42 — 98% accurate."
- **Per-note staleness forecasting** — not just an aggregate stale rate, but which *specific* notes will cross into stale soonest, ranked by real days-remaining.

All three lanes are wired into both the Vault Health panel and the Home panel's Projections tab — one shared rendering, so projections improve in one place and both surfaces benefit.

### Task Center

A real, dedicated place to work with tasks across the whole vault — not just a glanceable Home-panel preview. New "Tasks" view in the Yamlink sidebar, listing every task grouped into Overdue / Today / Upcoming / Undated / Done, with no cap on how many show. Real native checkboxes mark a task done directly from the sidebar; clicking a task jumps straight to its exact line.

Write `#urgent`, `#medium`, or `#low` in a task line and Task Center picks it up automatically — shown as a colored dot (the same `ThemeIcon` idiom VS Code's own Problems panel uses, not an emoji), sorted to the top of its bucket. The `#urgent`/`#medium`/`#low` tag itself is colored right in the editor too. An overdue task marked urgent escalates its notification to VS Code's error level.

### Guided tour

A native VS Code walkthrough (`Yamlink: Start Guided Tour`) for first-run users — create a note with a suggested `id:`, link a second note, write a `!view` query, see it become a live table, then a tour of the wider system (Home, Calendar, Vault Health, Graph, Task Center). Offered once, automatically, the first time you open a workspace with Yamlink installed.

### Custom hover cards, for real this time

Every past attempt at a richer, branded hover card ended up rendering as a second card stacked alongside VS Code's own native hover instead of replacing it. Root cause: those attempts used a separate Webview overlay, which can never replace the native hover widget, only coexist with it. Fixed by staying entirely within the one legitimate channel:

- `type` and `status` render as real Apollo-palette-colored pill badges (lavender / teal), not plain backtick text.
- Relation-field wikilinks and body `[[mentions]]` are clickable — Ctrl+Click opens the target note directly from the hover card.
- `![[image.png]]`-style image embeds now show the actual image on hover (filename and size included), read as a normal resolved link instead of a broken one, and Ctrl+Click opens the image — same as any other resolved wikilink. All four surfaces (hover, diagnostics, decorations, go-to-definition) now share one resolution path, so they can't drift out of agreement with each other again.
- LSP hover reaches the same parity — Zed, Neovim, and any other LSP-connected editor get the same colored badges and clickable links, via standard markdown syntax rather than anything VS Code-specific.

### Conduit's Graph screen gets a live spatial view

Previously list-only. Press `v` on the Graph screen and a note's connections render as a real terminal graph — centered focus note, branching connection lanes, numbered and direction-marked, honestly paginated ("+N more connections hidden") rather than cramming everything onto one small grid. Each neighbor is colored by note type with a legend underneath. It live-updates over the same SSE stream Conduit already uses — edit a linked note elsewhere and the graph redraws on its own.

A new Labels control (cycling Auto → All → Off, in both graph surfaces — Conduit and VS Code's own x-graph) puts label density under your own control instead of leaving it entirely automatic. Graph terminology that was previously unexplained anywhere — Signal, Themes, Relations, Semantic, Health — now has small "?" badges with real, specific explanations right where you'd look for them.

### Intelligence Engine depth

- **Pre-schema field emergence** — a brand-new note used to fall back to a hardcoded universal field list regardless of what your vault actually looks like. If your fields already match a repeated pattern elsewhere in the vault — even one never formalized as a schema — completions now suggest that pattern's fields instead, clearly labeled as a vault-pattern match.
- **Suggestion cascade** — accepting a relation-field completion now checks whether the note is obviously missing a next field peers of its type typically have, and offers a one-click, non-modal nudge — only at high confidence, never twice per note per session.
- **Temporal confidence from mutation volatility** — fields that get revised often carry a small confidence penalty in classification; fields set once and left alone get a small boost. Feeds every existing consumer (hover, completion, lightbulb) with no call-site changes needed.
- **Relationship gravity** — Note Report's connection lists, and now Vault Health's vault-wide "Most-Reinforced Connections" card, rank by how many fields corroborate a connection plus how often the vault's own history reinforces it — not arbitrary insertion order.
- **Natural-language write actions** — the plain-English query box recognizes a first set of write phrasings ("archive all missions with status failed") alongside its existing read-only query generation.
- **Schema-proposal loop closes** — proposing a schema from a detected cluster can now also back-fill the new fields onto the notes that inspired it, on explicit opt-in — the second half of "the vault writes its own schema."

### LSP reaches real parity with VS Code

- **`workspace/applyEdit`** — commands that write back to a document (`yamlink.addMissingFields`, `yamlink.scaffoldIdentity`, plus two newly-exposed commands, `yamlink.normalizeFrontmatter` and `yamlink.convertRelations`) now work through any LSP client, not just VS Code.
- **Richer intelligence payloads** — `yamlink.noteIntelligence` now also returns time-in-current-lifecycle-state, recent mutation velocity, and cross-note pattern matches — the same depth VS Code's Note Report shows.
- **Reliability hardening** — a server-initiated request that an editor never answers now times out gracefully instead of hanging a command forever; diagnostics correctly wait for an in-flight rebuild before answering rather than serving stale data.

### Vault Health depth pass

- **Most-Reinforced Connections** — the Intelligence tab now shows a ranked list of the vault's most-corroborated edges, vault-wide, not just per note.
- **Today at a glance** — the Activity tab opens with a plain-count summary of the day's real activity, plus a workflow-burst callout when 3+ notes were touched by the same action within 60 seconds.
- **Terminology, actually explained** — small "?" badges next to every jargon term (Lifecycle States, Type Consistency, Schema Coverage, and more), with friendly, concrete definitions instead of assuming you already know Yamlink's intelligence vocabulary.

### API maturity pass

A declarative route table replaced a 39-entry hand-wired if/else chain. A new [`docs/api/CONTRACT.md`](./docs/api/CONTRACT.md) documents every endpoint's method, path, params, response shape, and error codes in one place — and in writing it, surfaced three capabilities that were already fully built and tested but never documented anywhere (`intelligence_changed` reactive SSE push, composite reads via `?include=`, read-your-writes via `?minGeneration=`).

### Smaller fixes worth knowing about

- x-graph's canvas background had a subtle blue tint (`#0d0d14`) that didn't match the surrounding panel's own background — now a true off-black matching the rest of the product's palette.
- `yamlink`/`yamlink conduit` could silently attach to the wrong vault if another server was already running on the same port — now refuses and starts a separate server for the vault you actually asked for, unless it can positively confirm the same vault.
- `.yamlinkignore` rules starting with a leading `/` (a common `.gitignore` habit) silently matched nothing — fixed.
- The guided tour's second step could complete before you'd actually made a second note or link, from a shared completion trigger with step one — fixed with a real, distinct signal.

---

For the previous release, see [CHANGELOG.md — Sugar (0.7.0)](./CHANGELOG.md#070---sugar-shipped).
