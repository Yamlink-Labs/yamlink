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

### `sort`

```md
sort date
sort date desc
sort value desc
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

---

## Current Rules

- `id` is always included as the first column
- if `select` is omitted, Yamlink auto-builds columns from the result set
- power-user multi-line queries are the safest form
- dates work best when stored in canonical `YYYY-MM-DD`
- numeric sorting and comparisons now use numeric behavior when the values are numeric
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
