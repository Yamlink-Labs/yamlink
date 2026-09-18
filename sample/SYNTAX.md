---
id: syntax-reference
type: dashboard
---

# Yamlink — Query Language Quick Reference

A one-page cheat sheet. Open `dashboard.md` to see these in action.

---

## !view block structure

```
!view <type>                   All nodes of this type
!view *                        All typed nodes (adds a Type column)
!view <type> | <Tab Label>     Sets the tab name in the view panel
```

Every clause below is optional and order-independent after the `!view` line.
End a block with a blank line.

---

## Clauses

| Clause | Syntax | Notes |
|--------|--------|-------|
| **select** | `select field1, field2` | Columns shown, in order. Omit for all fields. |
| **where =** | `where field = value` | Exact match. Use `[[id]]` for relation fields. |
| **where !=** | `where field != value` | Not equal. |
| **where contains** | `where field contains text` | Substring match (case-insensitive). |
| **where is empty** | `where field is empty` | Missing or blank. |
| **where exists** | `where field exists` | Has any value. |
| **where #tag** | `where #tag` | Tag shorthand. |
| **sort** | `sort field` | Ascending. |
| **sort desc** | `sort field desc` | Descending. |
| **limit** | `limit 10` | First N rows after sort. |
| **group by** | `group by field` | Groups results into sections instead of one flat table. |
| **via** | `via field` (with `incoming`, below) | Which field to reverse-lookup through. |
| **linked_to** | `linked_to [[id]]` | Notes with an outbound edge to `id`. |
| **linked_from** | `linked_from [[id]]` | Every note `id` itself points to. |
| **within** | `linked_to [[id]] within 2` | Extends either clause transitively, up to 5 hops (default 1). |
| **as of** | `as of 2297-08-10` | Reconstructs the whole query against each note's frontmatter as of that date, not today. Accepts the same date vocabulary as `where` (literal date, `today()`, `days-ago(N)`). |

Date operators (for date-shaped fields):

```
where date = today()
where date > days-ago(7)
where date < days-from-now(14)
```

Date shorthand:

```
where date = @today
where date = @thisweek
where date = @nextweek
where date = @startofmonth
```

Virtual fields (computed, no frontmatter needed):

```
file.created         file system birthtime
file.modified        file system last-modified
_inbound_count        inbound link count
_outbound_count       outbound link count
_hub_score             computed connectivity score
```

---

## Incoming views (reverse lookup)

```
!view incoming mission
via commander
select date, outcome
```

Finds every `mission` note that links to the *current* note through its `commander` field — the reverse direction from a normal `!view`.

---

## Examples

```
!view character
select name, rank, unit
where unit = [[roughnecks]]
sort rank
```

```
!view mission | Recent Missions
select date, commander, outcome
sort date desc
limit 5
```

```
!view mission | Notes mentioning bugs
select date, commander
where notes contains arachnid
```

```
!view *
select type, name
sort type
```

---

## Shortcut queries

Expand automatically — no `select`/`where` needed:

```
!view today          notes dated today
!view upcoming        notes dated in the next 7 days
!view calendar         all dated notes
!view open-tasks       incomplete task lines across the vault
!view done-tasks       completed task lines
!view overdue           past-due task lines
!view undated-tasks     tasks with no date
```

---

## ID Rules

```
johnny-rico          ✓   letters, numbers, hyphens, underscores
mission_klendathu    ✓
Johnny Rico          ✗   no spaces
note#1               ✗   no special characters
```

Same rule applies to frontmatter field names.

---

## Wikilink syntax

```yaml
# Scalar relation
commander: [[johnny-rico]]

# List relation
squad:
  - [[dizzy-flores]]
  - [[ace-levy]]
```

Body links (prose mentions) are tracked as `body` edges.
They appear in backlinks and the entity hub but are weaker than frontmatter relations.

---

*Full documentation: https://github.com/Yamlink-Labs/yamlink*
