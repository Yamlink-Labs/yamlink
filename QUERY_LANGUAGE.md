# Yamlink Query Language

Yamlink tables are powered by a small `!view` query language.

This document defines the current contract clearly.

There are two ways to write queries:

## 1. Simple Query Form

Use this when you want a fast, readable one-line query.

```md
!view contact where status = active sort date desc limit 10
```

Good for:
- quick dashboards
- simple filtered lists
- task/date presets

Supported structure:

```md
!view <type-or-preset> [| label] [via field] [select ...] [where ...] [sort ...] [limit ...]
```

Examples:

```md
!view contact
!view contact where status = active
!view mission where commander = [[johnny-rico]] sort date desc
!view today
!view upcoming
!view incoming meeting via account
```

## 2. Power User Query Form

Use this when you want maximum clarity and fewer parsing surprises.

```md
!view contact | Active contacts
where status = active
select name, account, owner, date
sort date desc
limit 10
```

Good for:
- saved dashboards
- complex views you will refine later
- anything you want to read again in a month

This is the recommended default for serious views.

---

## Type And Preset

Supported heads:

- `!view contact`
- `!view mission`
- `!view *`
- `!view incoming contact`
- `!view tasks`
- `!view today`
- `!view upcoming`
- `!view calendar`
- `!view open-tasks`
- `!view done-tasks`
- `!view overdue`
- `!view undated-tasks`

Notes:
- `*` means all note types
- `incoming` means backlinks to the current note
- task/date presets resolve to task rows

**Important — `!view *` produces many columns.** Because `*` queries every note type at once, and different types have different fields, the auto-generated table includes every field that exists anywhere across all matching notes. Cells for missing fields are empty. If you use `!view *`, always add a `select` clause to control which columns appear:

```md
!view *
select id, type, created
sort created desc
```

---

## Clauses

### `select`

Choose visible columns.

```md
select name, account, status
```

### `where`

Filter rows.

Exact match:

```md
where status = active
where status is active
```

Relation match:

```md
where account = [[wayne-inc]]
where commander is [[johnny-rico]]
```

Contains:

```md
where name contains bruce
where body contains "plasma bugs"
where any contains kyocera
```

Date / ordered comparison:

```md
where date >= 2026-05-01
where date < 2026-06-01
where value > 100
```

Date query functions:

```md
where date >= today()
where date <= tomorrow()
where date >= days-ago(30)
where date <= days-from-now(14)
where date <= add-days(7)
```

Same-field OR:

```md
where status = active or pending
```

Cross-field OR:

```md
where status = active or type = contact
where outcome = victory or commander = [[carl-jenkins]]
```

AND:

```md
where status = active and date >= 2026-05-01
```

Empty / exists:

```md
where close-date is empty
where date exists
where owner is not empty
```

Not equal:

```md
where outcome != victory
where commander != [[johnny-rico]]
```

Tag shorthand:

```md
where #crm
where #research and status = active
```

Important:
- Same-field `or` is supported
- Cross-field `or` is also supported now
- Each `where` line is an `AND` group
- Each `or` inside one `where` line is an `OR` group

So this means:

```md
where outcome = victory or commander = [[carl-jenkins]]
where date exists
```

reads as:

- `(outcome = victory OR commander = [[carl-jenkins]])`
- `AND date exists`

### Virtual fields

Virtual fields are available in any query — no frontmatter required. Yamlink reads or computes them at query time.

- **`file.created`** — the file's creation date (`YYYY-MM-DD`). Falls back to last-modified date on systems that don't preserve birthtime (git clones, some syncs).
- **`file.modified`** — the file's last-modified date (`YYYY-MM-DD`).
- **`_inbound_count`** — how many graph edges point to this note.
- **`_outbound_count`** — how many graph edges this note points to.
- **`_hub_score`** — Yamlink's weighted graph prominence score for the note. It combines inbound/outbound relationship weight, relation variety, connected note types, stronger relation edges, and tags.

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
sort file.modified desc
```

```md
!view character
where _inbound_count > 0
select name, _inbound_count, _outbound_count, _hub_score
sort _hub_score desc
```

These fields support all operators: `=`, `!=`, `>=`, `<=`, `>`, `<`, `contains`, `is empty`, `exists`.

### `group by`

Collapse results into buckets by a field value. Each bucket shows the field value and a count.

```md
!view contact
group by account
```

```md
!view mission
group by outcome
sort count desc
limit 5
```

Notes:
- The table renders one row per group (value + count), not individual notes
- `sort <field> asc|desc` sorts by the group key; `sort count desc` sorts by count
- `limit` applies to the number of groups, not total notes
- Combine with `where` to narrow which notes are grouped

### `sort`

```md
sort date
sort date desc
sort value desc
sort file.modified desc
```

### `limit`

```md
limit 10
```

### `via`

Only for incoming queries.

```md
!view incoming contact
via account
```

### `linked_to` / `linked_from` / `within`

Graph traversal — filters to notes reachable through real outbound edges, not just a field match.

```md
!view * linked_to [[johnny-rico]]
```

Every note with an outbound edge to `johnny-rico` — the reverse of `linked_from`.

```md
!view * linked_from [[mission-klendathu]]
```

Every note `mission-klendathu` itself points to.

Add `within N` to either clause to reach further than one hop — the union of everything reachable across 1 to N hops, not just exactly hop N:

```md
!view * linked_from [[project-x]] within 2
```

Notes `project-x` points to directly, and everything those notes point to. `N` is capped at 5; omitting `within` is a single hop (the default), identical to the plain form above. Combines with `where` and a type filter like any other condition:

```md
!view unit linked_from [[mission-klendathu]] within 2
where status = active
```

`linked_to` and `linked_from` can appear together in one query — they intersect (AND), not union.

Notes:
- Resolved against the plain `[[id]]`, no alias resolution yet
- A cycle in the graph is handled safely — traversal tracks visited ids, never loops or double-counts
- An out-of-range `within` value (outside 1–5) degrades to a single hop with a warning, not an error

### `as of`

Temporal reconstruction — runs the whole query against each note's frontmatter as it stood on a past date, not today.

```md
!view mission as of 2297-08-10
```

```md
!view mission as of 2297-08-10
where outcome = ongoing
```

Accepts the same date vocabulary `where` clauses do — a literal date or a function call:

```md
!view mission as of days-ago(30)
```

Notes:
- Reconstructs frontmatter fields only. Virtual/computed fields (`file.created`, `_inbound_count`, `_hub_score`, etc.) still reflect current values, not historical ones
- Does not combine with `!view incoming` — that form takes a separate code path with its own early return and never reaches `as of` at all
- **Combines with `linked_to`/`linked_from`, but not into a true point-in-time traversal — verify this is what you want before relying on it.** The graph edges `linked_to`/`linked_from` walk are always today's edges (`getBacklinks()`/`getEdges()` read the live graph, not a historical one); `as of` only reconstructs the *field values* shown for whichever notes that live-edge walk already selected. In other words: "notes that currently have an edge to X, with their fields as they stood on the given date" — not "notes that had an edge to X as of that date." No warning is currently shown when you combine them, so the distinction is easy to miss.
- An invalid date degrades to a warning and current-state results, not an error
- Built on the same reconstruction engine `yamlink cat --at`/`yamlink graph --at`/`GET /api/graph?at=` already use — this is the same historical state, surfaced inside the query language itself

---

## Presentation layouts (table / matrix / bar / scatter)

Any query result can be viewed as a table, a two-axis matrix, a bar chart, or a scatter plot — but **this is a toolbar toggle in the View Panel, not a clause you write in the query text.** The same `!view` block always produces the same result set; the layout choice only changes how that result set is rendered, and is remembered per query tab.

- **Table** — the default. One row per note.
- **Matrix** — pick any vault type as the matrix columns; rows are the query results, cells show ● for a connected pair.
- **Bar** — groups rows by a field (via the toolbar's own group-by picker) and renders one bar per group. If the query already uses the `group by` clause above, the bar chart renders immediately using those groups — `group by` is the one query-language clause that feeds this layout directly.
- **Scatter** — plots rows on an X/Y grid. Yamlink auto-selects the first two numeric or date fields in the result as axes; disabled when the result has none.

Switch layouts from the **Layout** toolbar group in the View Panel, or via `Yamlink: Query Builder`'s layout toggle when building a new query.

---

## Current Rules

- `id` is always included as the first column
- if `select` is omitted, Yamlink auto-builds columns from the result set
- power-user multi-line queries are the safest form
- dates work best when stored in canonical `YYYY-MM-DD`
- numeric sorting and comparisons now use numeric behavior when the values are numeric
- `group by <field>` collapses results by field value — returns (value, count) rows, not individual notes
- `where` supports:
  - `=`
  - `!=`
  - `contains`
  - `is empty`
  - `is not empty`
  - `exists`
  - `>=`, `<=`, `>`, `<`
  - same-field `or`
  - cross-field `or`
- `#tag` is shorthand for matching tags
- date query functions currently supported:
  - `today()`
  - `now()`
  - `tomorrow()`
  - `yesterday()`
  - `days-from-now(<n>)`
  - `days-ago(<n>)`
  - `add-days(<n>)`
- date functions resolve to real dates before filtering, but Yamlink preserves the function syntax when rebuilding the query text
- `linked_to [[id]]` / `linked_from [[id]]` filter to notes reachable through real graph edges; add `within N` (capped at 5) to reach more than one hop
- `as of <date>` reconstructs the query's results as of a past date (frontmatter fields only, not computed/virtual fields)

---

## Recommended Patterns

Simple:

```md
!view contact where account = [[wayne-inc]] sort name
```

Power user:

```md
!view contact | Wayne contacts
where account = [[wayne-inc]]
select name, email, phone, status
sort name
```

Incoming:

```md
!view incoming meeting | Meetings linked here
via account
select date, summary
sort date desc
```

Tasks:

```md
!view today
!view open-tasks
!view upcoming
```

Cross-field OR:

```md
!view mission | Missions I should review
where outcome = victory or commander = [[carl-jenkins]]
where date exists
sort date desc
```

Group by:

```md
!view contact | Contacts by account
group by account
sort count desc
limit 10
```

Tag + state:

```md
!view * | CRM research notes
where #crm
where status != archived
sort date desc
```

Empty values:

```md
!view deal | Deals missing close dates
where close-date is empty
sort created desc
```

---

## What To Avoid

- assuming SQL-style parentheses or nested boolean logic
- relying on fuzzy parser guesses
- mixing too many ideas into one one-line query when a multi-line block is clearer
- assuming Yamlink will infer complicated precedence beyond:
  - `OR` inside one `where` group
  - `AND` across separate `where` clauses or explicit `and`

If a query matters, prefer the multi-line power-user form.
