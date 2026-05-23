---
id: welcome
type: dashboard
created: 2026-03-01
---

# Welcome to Yamlink

You're looking at a Yamlink note. This file has an `id:` in the frontmatter above — that's what makes it part of the system. Every file with an `id:` becomes a first-class note in your knowledge graph.

The sample vault below is already wired up. Click **▶ Run views** in the status bar at the bottom of the screen to see it in action.

---

## Your knowledge graph, in one picture

```
Markdown files  →  add id: fields  →  Notes
Notes           →  add [[links]]   →  Relations
Relations       →  form a          →  Graph
Graph           →  queried by      →  !view blocks
!view blocks    →  render as       →  Live tables
```

You stop at any level. Use only notes and links and you get a backlinks panel and rename-safe references. Add `!view` queries and you get a live database. Add schemas and you get validation. The system rewards investment but never requires it.

---

## The five things to know

**1. Every note needs an `id:`**

```yaml
---
id: my-first-note
type: note
---
```

That `id` is permanent. Rename the file, move it to a subfolder — every `[[my-first-note]]` link still resolves.

**2. `[[wikilinks]]` are your edges**

Type `[[` anywhere to trigger autocomplete. In the document body, links are mentions. In frontmatter, they are typed relations — named edges in the graph.

```yaml
unit: [[roughnecks]]
commander: [[johnny-rico]]
```

**3. The backlinks panel shows who points to you**

Open any note. The **Yamlink Backlinks** panel in the sidebar shows every other note that links to this one, labeled by which field the link came from.

**4. `!view` turns your graph into tables**

Write a `!view` block in any file and click **▶ Run views** in the status bar:

```
!view character
select rank, unit
where unit = [[roughnecks]]
sort rank
```

The view panel opens beside your editor with a live, sortable, editable table. It updates on every save.

**5. Broken links become new notes**

Write `[[a-note-that-doesnt-exist]]` and save. A warning appears. Press `Ctrl+.` for a Quick Fix: Yamlink creates the file for you, inferring the type from context.

---

## Explore the sample vault

This workspace includes a small sample vault based on the 1997 film *Starship Troopers*. It demonstrates every major Yamlink feature with real data.

Open `dashboard.md` and click **▶ Run views** to see live queries. Open `johnny-rico.md` and click the status bar to open Note Report. Browse any character file — the backlinks panel shows their connections.

**Files in this sample:**

| File | What it demonstrates |
|------|---------------------|
| `johnny-rico.md` | Character note with relations, Note Report |
| `dizzy-flores.md` | Contact-style note, backlinks |
| `roughnecks.md` | Unit note, hub with many members |
| `mission-klendathu.md` | Event note, multi-value relations |
| `mission-planet-p.md` | Linked event, sort by date |
| `dashboard.md` | Multiple `!view` blocks, query language |
| `schema-character.md` | Schema for character notes — drives validation and `New Note from Schema` |
| `schema-mission.md` | Schema for mission notes — required fields enforced |
| `_templates/character.md` | Body template for new character notes (used alongside the schema) |

---

## When you're ready to build your own vault

Delete the sample files (or start a new folder) and create your first real note:

1. Run `Yamlink: Create Note` from the Command Palette (`Ctrl+Shift+P`)
2. Enter an ID — something like `my-project` or `client-name`
3. Pick a type or create a new one
4. Start writing

The rest of the structure will emerge as you link notes together.

---

## Learn more

- Full documentation and tutorials: [Yamlink on GitHub](https://github.com/Yamlink-Labs/yamlink)
- Query language reference: see [../QUERY_LANGUAGE.md](../QUERY_LANGUAGE.md)
- Report issues: [github.com/Yamlink-Labs/yamlink/issues](https://github.com/Yamlink-Labs/yamlink/issues)

---

*Yamlink 0.5.0 — Zim*
