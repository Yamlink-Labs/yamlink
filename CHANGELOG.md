# Changelog

## 0.8.3

### Fixes

- The "What's New" webview shown on update (`media/whats-new.html`) still wrongly showed the 0.8.0 release briefing to users updating to 0.8.2 — the real 0.8.2 content existed but was never copied into the shipped file. Now updated.

## 0.8.2

### New

- **Inline calculations in note bodies, with Excel-style references.** See [FEATURES.md — Inline Calculations](./FEATURES.md#inline-calculations) for full syntax and examples.
  - Real arithmetic inline with `` `=...` ``, computed live as you type — operators, functions, `pi`/`e`, and string/boolean values alongside numbers.
  - Reference an earlier calculation by name or automatic `Y1`/`Y2` label; references renumber automatically when a block shifts, the same way Excel rewrites formulas when rows move.
  - Ranges (`Y1:Y5`), named ranges (`prices=Y1:Y8`), and conditional totals (`countif`/`sumif`/`averageif`) with a quoted criterion.
  - Cross-note references (`` `=[[note]]^total` ``) and cross-note ranges, both single-hop by design.
  - Table ranges — `` `=sum(T1.budget)` `` reads a whole `!view` table's column, including `group by` tables, without a second query.
  - Comparisons and boolean logic (`> < >= <= == !=`, `and`/`or`/`not` as keywords or functions, `if()`), with real short-circuiting in `if()`.
  - Date functions: `today()`, `date()`, `days_between()`, `add_days()`.
  - Statistics, finance, and growth functions (`median`, `stdev`, `fv`/`pv`/`pmt`/`npv`/`irr`, `cagr`), matching Excel's own formulas and sign conventions.
  - Reads this note's own frontmatter fields directly — no re-typing a value that's already on the note.
  - Display formatting (`as currency`/`as percent`/`as comma`/fixed-decimals) without changing the underlying value.
  - Autocomplete opens the instant you type `` ` `` or `=`, offering same-note cells, this note's frontmatter fields, table columns, and vault-learned formula patterns from other notes of the same type.
  - Hover any formula for a step-by-step trace; a failed formula shows a real typed error (`#REF!`, `#DIV/0!`, `#NAME?`, `#VALUE!`) on hover and live as you type, not just a flat `= ?`.
- **`!view` query language gains calculated-cell awareness.** See [FEATURES.md — Querying calculated cells](./FEATURES.md#querying-calculated-cells) and [Summarizing across notes with `aggregate`](./FEATURES.md#summarizing-across-notes-with-aggregate).
  - `cell.<name-or-label>` selects, filters, and sorts by a note's calculated cells in any `!view` query.
  - `aggregate sum()/average()/min()/max()/count` computes totals and counts over a matched set, standalone or per `group by` bucket.
  - A `when` condition folds only the matching notes into one aggregate term, independent of every other term in the same clause.
- **Line and pie chart layouts for `!view` results**, alongside the existing Table/Matrix/Bar/Scatter toggle. Bar and Pie can now plot an `aggregate` value instead of row count via a new Value picker. See [FEATURES.md — Chart views](./FEATURES.md#chart-views).
- **The Live Note preview sidecar now shows just the computed result** (e.g. `9`), not the raw `` `=expr` `` syntax — hovering it there still shows the original formula.

### Fixes

- `!view` `group by` on a field holding a single wikilink (e.g. `unit: "[[roughnecks]]"`) now groups and labels by the target name, not the raw `[[...]]` text. Aliased links group under the target too.
- Frontmatter values are stored as text in the index, so formulas and `cell.*` query fields silently failed on numbers and booleans written in frontmatter. Both now resolve correctly, matching how `!view` comparisons already treat them.
- An already-closed empty wikilink placeholder (`ramo: [[ ]]`) is now recognized as a relation field by the schema-less suggestion fallback, instead of being ignored.
- The "Link this node to another…" quickfix now writes into the field it was actually invoked from, instead of a hardcoded `related:` field.
- `!view`'s `sort <field> asc` now parses correctly — writing `asc` explicitly used to silently drop the entire clause.
- Accepting a frontmatter relation completion no longer immediately nudges you to add the same field you just filled in (the vault's field cache was stale until save).
- Dragging a node in the x-graph no longer shakes the whole graph. Two separate causes, both fixed: the simulation reheated to a flat energy level regardless of how brief the drag was, and every force was computed for every node in the vault rather than just the dragged one's neighbors.
- Dragging in the main Graph Workspace panel no longer leaves nodes permanently frozen after a few drags — a pin-release step the sidebar already had was missing there.
- The x-graph's cluster layout now looks organic instead of crystalline — a continuous "orbit snap" force pulling every node back to a fixed point every tick is gone, in favor of repulsion and springs alone, closer to how Obsidian's own graph behaves.
- Hovering a `[[note#heading]]` reference now matches accent-insensitively (`Monopólio`/`Monopolio`), and falls back to a body-text mention of the term before the generic note summary.
- The x-graph now assigns a real, stable color to every type in the vault, not just 11 hardcoded names — previously any other type rendered gray.
- A formula can now wrap a comparison or boolean sub-expression in parentheses, e.g. `` `=(total > 1000) and (count < 5)` `` — previously only plain arithmetic could be grouped.
- The x-graph's "N notes · N links" counts now say so honestly when capped (e.g. "128 of 340 notes"), in both the sidebar and the main panel; the Local/Neighborhood scope badge also now shows when hidden neighbors exist.
- Calendar now tracks a note with no `date:`/`created:` frontmatter field, falling back to its `note_created` mutation-log timestamp instead of leaving it invisible regardless of when it was actually written. An explicit frontmatter date still always wins.
- Calendar's Month/Week/Day views now always default to the current month and day, instead of jumping to wherever the vault's earliest (or only) explicitly-dated note happened to be.
- Calendar's Week view now shows each day's actual notes and tasks directly, not just an item count; Week and Day views gained real ‹ › navigation buttons (previously keyboard-only); the date picker is now a proper in-page month/day calendar grid instead of the native OS date-input dropdown.

