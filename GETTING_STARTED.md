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

Run the view (`Yamlink: Run Views in Current File`) and a live table opens beside the note. Double-click any cell to edit it directly — the change writes straight back into that note's real frontmatter, no separate save step. Text, relations (with real validation against your vault's ids), booleans, dropdowns, numbers, and dates all edit in place; `Tab`/`Shift+Tab` move between editable cells, and you can paste a whole block of spreadsheet data across multiple cells at once. Every edit is undoable.

The same result set can also be viewed as a **matrix** (pick any type for the columns, ● marks a connected pair), a **bar chart**, a **scatter plot**, a **line chart**, or a **pie chart** — a toolbar toggle in the table itself, not something you write in the query. The layout choice is remembered per query.

- **Bar** and **pie** charts group your notes (for example `group by priority`). By default they count notes per group. Add an `aggregate` clause and the chart's **Value** picker can plot that total or average instead, such as total strength per priority.
- **Scatter** and **line** charts plot two numeric or date fields against each other, such as budget against strength, or strength over time. Line charts sort points by the horizontal axis first, so the line follows the order of dates.

A worked set of these charts is in the sample vault's `calc-charts-gallery` note.

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

Graph traversal:

```text
linked_to [[id]]              # notes with an outbound edge to id
linked_from [[id]]            # every note id itself points to
linked_to [[id]] within 2     # extends either clause transitively, up to 5 hops
linked_from [[id]] within 3   # union of everything reachable in that many hops, not just exactly that hop
```

`!view * linked_from [[project-x]] within 2` reaches everything two links away from `project-x` in one query — the notes it points to directly, and everything those notes point to. Omit `within` for a single hop (the default). Combines with a type filter and other `where` clauses, same as any other condition.

Temporal reconstruction:

```text
!view mission as of 2297-08-10
!view mission as of 2297-08-10 where outcome = ongoing
!view mission as of days-ago(30)
```

Runs the whole query — type filter, `where`, `select`, `sort` — against each note's frontmatter as it stood on that date, not today. Accepts the same date vocabulary `where` clauses do (a literal date, `today()`, `days-ago(N)`, and so on). Computed fields (`_inbound_count`, `file.created`) still reflect current values, not historical ones. Doesn't combine with `!view incoming` at all. It does combine with `linked_to`/`linked_from`, but not into a real point-in-time traversal — the edges walked are always today's, only the field values shown get reconstructed to the past date. See `QUERY_LANGUAGE.md` for the full detail if you're relying on this combination.

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
4. Yamlink inserts the learned frontmatter shape for that note type — relation fields pre-fill with a real value (e.g. `commander: [[johnny-rico]]`) when the vault has strong, consistent evidence for it, instead of an empty stub; fields with no vault evidence still insert blank. Capped at 6 fields per run — a template with more missing fields inserts the first 6 and tells you how many more are available.
5. If more than one field is missing beyond the template's own list, and the vault has one more genuinely relevant suggestion, a separate follow-up message offers to insert it too — a real choice, not applied automatically.
6. Cursor moves to the first unresolved field.
7. Completion can reopen automatically there if the vault has strong evidence.

**More than one template for the same type?** "Save Note as Template" offers to overwrite an existing one or save a new, distinctly-named template alongside it (e.g. `meeting-standup.md` and `meeting-retro.md`, both `type: meeting`) — useful when one type covers a few real sub-patterns. "Add missing template fields" asks which one to use when more than one matches. Template-drift warnings stay silent for a type with more than one template rather than guessing which one applies.

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

**Extract a block to its own note** — `Yamlink: Extract Block to New Note` moves that exact block out of the current note and into a brand-new one, replacing it in place with an embed so it still renders where it was.

**Export** — `Yamlink: Export Active Note to PDF` renders the active note (frontmatter, body, callouts, tasks) to a PDF file.

Go-to-definition works on every section/block reference: the editor lands on the exact heading or block line.

---

## 7. Do live calculations in a note

Write real arithmetic inline in a note body and Yamlink computes it live — no separate spreadsheet, just prose with an explicit marker.

```
The total comes to `=1 + 2(3+4)^2` before tax.
```

That shows `= 99` right after it, updating as you type. Only text inside this exact `` `=...` `` syntax is ever touched — an ordinary code span like `` `npm install` `` is left completely alone.

**Supported math**: `+ - * / ^ %`, implicit multiplication (`2(1+1/14)` needs no `*`), parentheses, and `sqrt`/`abs`/`round`/`floor`/`ceil`/`min`/`max`/`sin`/`cos`/`tan`/`log`/`ln`/`sign`/`exp`, plus the constants `pi`/`e`. A value can be a number, a string (`` `label="in progress"` ``), or a boolean (`` `done=true` ``) — `+` concatenates two strings the same way it adds two numbers.

**Real rules, not just arithmetic**: `> < >= <= == !=`, `and`/`or`/`not`, and `if(condition, then, else)`:

```
Over budget: `over_budget=spent>budget`
Status: `status=if(over_budget, "cut spending", "on track")`
```

`if()` is the one construct that truly skips the side it doesn't take — `` `=if(x != 0, 10/x, 0)` `` never divides by zero when `x` is `0`, because that branch is never evaluated.

`and`, `or`, and `not` also work as function calls, if that reads more naturally to you. Both forms give the same result and can be mixed in one formula:

```
Ready: `ready=and(strength>=10, not(over_budget))`
Same check: `ready_too=strength>=10 and not over_budget`
```

**Reference another calculation from a later one**, two ways that work together:

| Syntax | What it does |
|---|---|
| `` `total=1+2` `` then `` `=total*3` `` | name a calculation, use it by name |
| `` `=Y1+Y2` `` | every calculation also gets an automatic label (`Y1`, `Y2`, ...) in document order — reference it without naming anything |

Insert a new calculation earlier in the note and save: any `Y<N>` reference elsewhere that pointed at a shifted calculation is automatically rewritten to its new number, the same way a spreadsheet updates itself when a row shifts.

**Reference a calculation in another note**: `` `=[[budget]]^total + 25` `` reads another note's calculated cell directly — by name or by its automatic `Y<N>` label. Single-hop by design: that note's own formula can't chain through a third note.

**Ranges**: inside a function call, `Y<N>:Y<M>` expands to every cell in between — `` `=sum(Y1:Y5)` ``, `` `=average(Y1:Y5)` ``.

**Named ranges**: give a run of cells a name, then use the name anywhere a list is expected:

```
prices=Y1:Y8
Typical price: `=median(prices)`
```

**Cross-note ranges**: a range can also come from another note, using the same single-hop rule as single cells: `` `=sum([[budget-2297]]^Y1:Y5)` ``.

**Table ranges**: every `!view` block in a note gets an automatic label — `T1`, `T2`, ... — in the order it appears, the same convention calc cells use for `Y1`, `Y2`. `T1.budget` is the whole `budget` column of the first table, read in the order that table currently displays, so a formula can summarize a table without retyping its data:

```
!view expense select name, budget

Total budget across the table above: `=sum(T1.budget)`
Typical budget: `=median(T1.budget)`
```

For a `group by` table, address the group column by its field name and an aggregate column by its alias: `!view expense group by category aggregate sum(budget) as total` makes `T1.category` and `T1.total` both addressable. Same-note only — a table in another note isn't reachable this way. One current limit: unlike `Y<N>` cell labels, `T<N>` table labels are not yet renumbered automatically if you reorder `!view` blocks in the note — check the formula still points at the table you mean after moving one.

**Conditional totals**: count, add, or average only the cells that match a condition. The criterion is written in quotes:

```
Prices above 40: `=countif(prices, ">40")`
Total of those prices: `=sumif(prices, ">40")`
Average of prices under 40: `=averageif(prices, "<40")`
```

**Formulas can read a note's own frontmatter fields directly**, not just other calculations — `` `total=price*quantity` `` resolves `price`/`quantity` straight from frontmatter if no same-note calculation already defines them.

**Date functions** — `today()`, `date(year, month, day)`, `days_between(date1, date2)`, `add_days(date, days)`:

```
Days until due: `days_left=days_between(today(), due)`
Status: `status=if(due < today(), "overdue", "on track")`
```

A date is just a `YYYY-MM-DD` string (the same format frontmatter date fields already use), which is also why `due < today()` already compares correctly — no new syntax needed for that. One real gotcha: a bare `2099-01-01` typed directly in a formula is subtraction, not a date — write `date(2099, 1, 1)` or a quoted string instead.

**Statistics, finance, and growth**:

```
Typical deal size: `typical=median(Y1:Y10)`
How spread out are deal sizes: `spread=stdev(Y1:Y10)`
Return over 5 years at 8%: `growth_value=fv(0.08, 5, 0, -10000)`
Steady yearly growth rate: `rate=cagr(revenue_2021, revenue_2026, 5)`
```

`median`/`mode`/`stdev`/`variance` (and their population counterparts `stdevp`/`variancep`) work with ranges the same way `sum`/`average` already do. `fv`/`pv`/`pmt`/`npv`/`irr` match Excel's own formulas and sign convention exactly — money going out and the value it becomes are opposite signs. `cagr(beginning, ending, periods)` gives you one steady growth rate across however many periods.

**Display formatting without changing the real value**: a trailing `as <format>` clause controls how a result is *shown*, while the underlying number stays unrounded for further math:

```
Total cost: `=price*qty as currency`        → $1,234.56
Growth rate: `=cagr(3000, 4000, 4) as percent`  → 7.46%
Headcount: `=staff as comma`                 → 1,234
Precise: `=ratio as 0.00`                    → 0.50
```

Use `percent` for rates and growth, `currency` for money, `comma` for large counts, and a decimals pattern like `0.00` when you need a fixed number of places.

Hover any formula to see its label, name, result, and exactly which other cells it reads — plus, for a formula built from a range, a function call, a cross-note reference, a comparison, or `if()`, a step-by-step "How it resolved" breakdown in the exact order Yamlink evaluated it. While typing a new formula, autocomplete opens the instant you type `` ` `` or `=` — lists every earlier calculation in the note, this note's own frontmatter fields, `T<N>.<column>` for any `!view` table already in the note, and (once a note's `type:` has at least 2 other notes with a similar pattern) suggestions learned from the rest of the vault too — or run `Yamlink: Insert Cell Reference` for a searchable picker over all of them.

The Live Note preview sidecar shows only the computed result, not the raw formula — hovering it there still shows the original expression.

**Try it on real examples.** The sample vault includes three guide notes that use everything above:

- `start-here-calc-tour` — a short checklist to work through in order.
- `calc-what-you-can-do` — each formula group explained, with examples you can change.
- `calc-charts-gallery` — bar, pie, scatter, and line charts over the same data.

To check every formula in the sample vault at once, run `node scripts/check-calc-notes.js` from the Yamlink project folder. It prints one line per formula and reports any that fail.

A `!view` query can also select, filter, and sort by a note's calculated cells — `!view expense where cell.total > 100 select name, cell.total`. It can also summarize *across* every matched note — `!view field-report aggregate sum(cell.effective_strength) as total, average(cell.effective_strength) as avg` shows a total and average over the whole result, and combining that with `group by unit` gives you one total per unit instead. Add `when` to fold only the matching notes: `aggregate sum(cell.effective_strength) when priority = high as high_total` totals strength for high-priority notes only. See [FEATURES.md](./FEATURES.md)'s Inline Calculations section for the full syntax, including current limits.

### Function reference

Every function Yamlink's formulas understand, with its arguments in order. Square brackets mark optional arguments. Results shown are what the example produces.

**Math**

| Function | What it does | Example | Result |
|---|---|---|---|
| `sqrt(x)` | Square root | `` `=sqrt(16)` `` | 4 |
| `abs(x)` | Absolute value | `` `=abs(-3)` `` | 3 |
| `round(x)` | Round to the nearest whole number | `` `=round(2.6)` `` | 3 |
| `floor(x)` | Round down | `` `=floor(2.9)` `` | 2 |
| `ceil(x)` | Round up | `` `=ceil(2.1)` `` | 3 |
| `exp(x)` | e raised to the power x | `` `=exp(1)` `` | 2.718 |
| `ln(x)` | Natural logarithm | `` `=ln(e)` `` | 1 |
| `log(x)` | Base-10 logarithm | `` `=log(1000)` `` | 3 |
| `sign(x)` | -1, 0, or 1 depending on the sign of x | `` `=sign(-5)` `` | -1 |
| `sin(x)`, `cos(x)`, `tan(x)` | Trigonometry, in radians | `` `=cos(0)` `` | 1 |

Constants: `pi` (3.14159...) and `e` (2.71828...).

**Totals and statistics**

These take any number of values, or a range such as `Y1:Y8`.

| Function | What it does | Example | Result |
|---|---|---|---|
| `sum(a, b, ...)` | Total | `` `=sum(2,3,5)` `` | 10 |
| `average(a, b, ...)` | Mean | `` `=average(2,3,7)` `` | 4 |
| `min(a, b, ...)` | Smallest value | `` `=min(4,1,9)` `` | 1 |
| `max(a, b, ...)` | Largest value | `` `=max(4,1,9)` `` | 9 |
| `median(a, b, ...)` | Middle value | `` `=median(1,5,3,9)` `` | 4 |
| `mode(a, b, ...)` | Most common value (fails if nothing repeats) | `` `=mode(2,3,3,7)` `` | 3 |
| `stdev(a, b, ...)` | Spread of a sample | `` `=stdev(2,4,4,4,5,5,7,9)` `` | 2.138 |
| `stdevp(a, b, ...)` | Spread of a complete population | `` `=stdevp(2,4,4,4,5,5,7,9)` `` | 2 |
| `variance(a, b, ...)` | Variance of a sample | `` `=variance(2,4,4,4,5,5,7,9)` `` | 4.571 |
| `variancep(a, b, ...)` | Variance of a complete population | `` `=variancep(2,4,4,4,5,5,7,9)` `` | 4 |

**Conditional totals**

These take a range (a `Y1:Y8` run, a named range, or a cross-note range) and a criterion in quotes. The criterion can be `">40"`, `"<=10"`, `"<>0"`, or a plain value such as `"high"`.

| Function | What it does | Example | Result |
|---|---|---|---|
| `countif(range, criterion)` | How many cells match | `` `=countif(prices, ">40")` `` | 6 |
| `sumif(range, criterion, [sum_range])` | Total of matching cells. The optional third range is summed in place of the first. | `` `=sumif(prices, ">40")` `` | 263 |
| `averageif(range, criterion, [average_range])` | Average of matching cells | `` `=averageif(prices, "<40")` `` | 38.5 |

**Finance**

Rates are decimals: 8% is `0.08`. Money you pay out is negative, and money you receive is positive.

| Function | What it does | Example | Result |
|---|---|---|---|
| `fv(rate, periods, payment, [present])` | Future value of regular payments | `` `=fv(0.05, 10, -100)` `` | 1257.79 |
| `pv(rate, periods, payment, [future])` | Present value of regular payments | `` `=pv(0.05, 10, -100)` `` | 772.17 |
| `pmt(rate, periods, present, [future])` | Regular payment that pays off a loan | `` `=pmt(0.005, 60, 10000)` `` | -193.33 |
| `npv(rate, cash1, cash2, ...)` | Value today of future cash flows. The first flow is discounted by one period. | `` `=npv(0.08, 6000, 6000, 6000)` `` | 15462.58 |
| `irr(cash0, cash1, ...)` | Rate of return. The first value is the money paid out now, not discounted. | `` `=irr(-20000, 6000, 6000, 6000, 6000, 6000) as percent` `` | 15.24% |
| `cagr(beginning, ending, periods)` | Steady yearly growth rate | `` `=cagr(3000, 4000, 4) as percent` `` | 7.46% |

To include a cash flow that happens today, add it outside `npv()`, for example `` `=-20000 + npv(0.08, 6000, 6000, 6000)` ``.

**Dates**

A date is written `YYYY-MM-DD`, or built with `date()`.

| Function | What it does | Example | Result |
|---|---|---|---|
| `today()` | Today's date | `` `=today()` `` | the current date |
| `date(year, month, day)` | Builds a date and checks that it exists | `` `=date(2297, 12, 1)` `` | 2297-12-01 |
| `days_between(first, second)` | Days from the first date to the second | `` `=days_between("2297-12-01", "2297-12-15")` `` | 14 |
| `add_days(date, days)` | A date moved forward by some days | `` `=add_days("2297-12-01", 14)` `` | 2297-12-15 |

**Logic**

| Function | What it does | Example | Result |
|---|---|---|---|
| `and(a, b)` | True only when both are true | `` `=and(true, false)` `` | false |
| `or(a, b)` | True when either is true | `` `=or(true, false)` `` | true |
| `not(a)` | Flips true and false | `` `=not(false)` `` | true |
| `if(test, yes, no)` | Returns one of two values. Only the chosen branch is worked out. | `` `=if(3>2, "yes", "no")` `` | yes |

---

## 8. Learn the core surfaces

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

## 9. Get started with the CLI

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
yamlink bulk-set --ids johnny-rico,carl-jenkins,dizzy-flores --field status --value ready  # set one field across many notes at once
yamlink bulk-set --ids meeting-1,meeting-2 --field project --add roughnecks-op            # link many notes to the same target, no duplicates
# Same add semantics over the API: PATCH /api/nodes/bulk with { "updates": [{ "id": "...", "fields": { "project": { "add": "roughnecks-op" } } }] }
# In VS Code: select multiple notes in the Explorer, right-click -> "Yamlink: Bulk Set Field on Selected Notes"
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
yamlink on field_changed --daemon -- ./scripts/sync.sh  # same, but survives closing this terminal
yamlink on --list                               # check what's running, with real live status
yamlink completions bash >> ~/.bashrc           # enable shell tab completions
```

**New vault:**

```bash
yamlink init ~/Documents/MyVault               # scaffold .yamlink/, _templates/, welcome.md
```

**All 49 commands** support `--json`, `--dry-run`, and `--vault <path>`. Run `yamlink --help` for the full command list, or `yamlink <command> --help` for any command's flags.

---

## 10. Get started with Conduit

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

## 11. Import an existing vault

Every import — Obsidian, Notion, Roam, Evernote — shows a one-line trust summary in the confirmation screen before you commit (what that export format preserves well, what to double-check, what it can't fully carry over regardless of how good the importer is), and the same detail as a "What to expect from this import" section in the generated import report. Worth reading before a big import, not just after.

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

Run `Yamlink: Import External Vault Export` → **Notion**.

Export from Notion: a Markdown export folder.

What Yamlink does:

- inspects the export before import so you can confirm what Yamlink found
- stamps imported notes with `id:`, `title:`, `imported_from: notion`, `parent:`
- rewrites local Markdown note links into Yamlink `[[wikilinks]]`
- expands CSV databases into Yamlink row notes under `_notion_databases/`

### From Roam Research

Run `Yamlink: Import External Vault Export` → **Roam Research**.

Export from Roam: a JSON page export.

What Yamlink does:

- creates Markdown notes for Roam pages with `id:`, `title:`, `imported_from: roam`, `roam_uid:`
- preserves nested bullet structure
- converts `{{[[TODO]]}}` and `{{[[DONE]]}}` into Yamlink task syntax
- detects date-titled pages and imports them as journal notes with `date:`

### From Evernote

Run `Yamlink: Import External Vault Export` → **Evernote**.

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

## 12. Ignore notes Yamlink should not index

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

## 13. Publish your vault as a website

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

## 14. Where to go next

- [README.md](./README.md) — full product surface overview
- [FEATURES.md](./FEATURES.md) — complete feature reference across every surface
- [CONTRACT.md](./CONTRACT.md) — the local HTTP API's full method/path/params/error-code reference
- `yamlink --help` / `yamlink <command> --help` — full CLI reference, in the terminal
- `?` inside Conduit — full in-app key-binding reference

Explore Note Report, Calendar, Graph, and Vault Health on your real notes as early as possible. The intelligence layer learns from your vault — it gets more useful the more notes it has to work with.
