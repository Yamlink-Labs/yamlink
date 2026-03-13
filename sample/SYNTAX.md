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
| **where contains** | `where field contains text` | Substring match (case-insensitive). |
| **sort** | `sort field` | Ascending. |
| **sort desc** | `sort field desc` | Descending. |
| **limit** | `limit 10` | First N rows after sort. |

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

*Full documentation: yamlink.io/docs*
