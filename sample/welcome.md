---
id: welcome
type: dashboard
created: 2026-03-01
---

# Welcome to Yamlink

You're looking at a Yamlink note. This file has an `id:` in the frontmatter above — that's what makes it part of the system. Every file with an `id:` becomes a first-class note in your knowledge graph.

Click **▶ Run views** in the status bar at the bottom of the screen to see the `!view` blocks in this vault in action.

---

## Your knowledge graph, in one picture

```
Markdown files  →  add id: fields  →  Notes
Notes           →  add [[links]]   →  Relations
Relations       →  form a          →  Graph
Graph           →  queried by      →  !view blocks
!view blocks    →  render as       →  Live tables
```

You stop at any level. Use only notes and links and you get Note Report, Graph, and rename-safe references. Add `!view` queries and you get a live database. The system rewards investment but never requires it.

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

**3. Note Report shows how a note connects**

Open any note. **Note Report** in the Yamlink sidebar shows the note's structured links, body mentions, tasks, history arc, and the next view that makes the most sense from that note.

**4. `!view` turns your graph into tables**

Write a `!view` block in any file and click **▶ Run views** in the status bar:

```
!view character
select rank, unit
where unit = [[roughnecks]]
sort rank
```

The view panel opens beside your editor with a live, sortable, editable table. It updates on every save. Toggle to **Matrix** view in the toolbar to see a two-axis connection grid.

**5. Broken links become new notes**

Write `[[a-note-that-doesnt-exist]]` and save. A warning appears. Press `Ctrl+.` for a Quick Fix: Yamlink creates the file for you, inferring the type from context.

---

## What's new in 0.6.0

- **Home panel** — opens automatically on first activation. Vault pulse, activity feed, and quick actions in one place. Reopen anytime: `Yamlink: Open Home` or the `⌂` button in the status bar.
- **Quick Note** — `Ctrl+Alt+N` creates a new note without leaving the keyboard. If you're inside an existing note, Yamlink offers to link the new note back automatically.
- **Daily notes** — `Ctrl+Alt+J` opens or creates today's journal note.
- **Query in plain English** — `Yamlink: Query in Plain English` from the command palette. Describe what you want, get a `!view` block ready to run.

---

## Explore the sample vault

This workspace includes a sample vault based on the 1997 film *Starship Troopers*. It demonstrates every major Yamlink feature with real data.

Open `dashboard.md` and click **▶ Run views** to see live queries. Open `johnny-rico.md` and run `Yamlink: Open Note Report`. Open `brain-bug-intelligence.md` to see callouts, footnotes, and body signals in action.

**Files in this sample:**

| File | What it demonstrates |
|------|---------------------|
| `johnny-rico.md` | Character note — relations, Note Report, inline tasks, `!view` block |
| `carl-jenkins.md` | Character — callout, footnote, embedded tasks |
| `carmen-ibanez.md` | Character — minimal structure, good for arc prediction |
| `lt-rasczak.md` | Character — alias usage (`aliases: [rasczak]`) |
| `ace-levy.md` | Character — additional graph node |
| `dizzy-flores.md` | Character — additional graph node |
| `zander-barcalow.md` | Character — additional graph node |
| `rasczak-memorial.md` | Sparse character — demonstrates arc prediction in Note Report |
| `roughnecks.md` | Unit note — hub with many members, incoming-relation views |
| `federations-fleet.md` | Unit note — additional graph cluster |
| `mission-klendathu.md` | Mission event — multi-value relations, date-sorted queries |
| `mission-planet-p.md` | Mission event — linked events, sort by date |
| `mission-tango-urilla.md` | Mission event — callouts and footnotes |
| `brain-bug-intelligence.md` | Research note — callouts, blockquotes, footnotes, source evidence |
| `dashboard.md` | Multiple `!view` blocks — all major query patterns |
| `query-shortcuts.md` | Every shortcut query type — `!view today`, `!view open-tasks`, etc. |
| `tasks-calendar.md` | Task and calendar testing — open Calendar to see dated tasks |
| `note-report.md` | Note Report testing — relations, tasks, timeline |
| `table-types.md` | Table cell type testing — boolean, number, date, relation cells |
| `SYNTAX.md` | Query language quick reference — all operators and clause forms |
| `orphan-demo.md` | A note with no links — demonstrates Orphan Nodes in Vault Health |
| `journal-2026-05-31.md` | Sample journal note — demonstrates daily notes and Calendar |
| `_templates/character.md` | Body template for new character notes |
| `_templates/journal.md` | Journal template for `Ctrl+Alt+J` daily notes |

---

## When you're ready to build your own vault

Delete the sample files (or start a new folder) and create your first real note:

1. Run `Yamlink: Open Home` from the Command Palette — start with the Home panel
2. Click **New note** in the pulse bar
3. Enter an ID and pick a type
4. Start writing

The rest of the structure will emerge as you link notes together.

---

## Learn more

- Full documentation and tutorials: [Yamlink on GitHub](https://github.com/Yamlink-Labs/yamlink)
- Query language reference: see [../QUERY_LANGUAGE.md](../QUERY_LANGUAGE.md)
- Getting started guide: see [../GETTING_STARTED.md](../GETTING_STARTED.md)
- Report issues: [github.com/Yamlink-Labs/yamlink/issues](https://github.com/Yamlink-Labs/yamlink/issues)

---

*Yamlink 0.6.0 — Shujimi*
