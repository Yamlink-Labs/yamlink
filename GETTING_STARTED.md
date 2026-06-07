# Yamlink Getting Started

This document is a complete tutorial for Yamlink.

**Tutorial sections:**

| Section | What you learn |
|---|---|
| [Core Idea](#the-core-idea) | ID, type, links, queries — the whole model in one pass |
| [Home Panel](#home-panel-activity-stream) | Activity stream, vault pulse, continue working |
| [Import an Obsidian vault](#import-an-obsidian-vault) | Bring an existing Obsidian vault into Yamlink quickly |
| [First Steps](#recommended-first-steps) | Create notes, link them, write body content |
| [Wikilink Aliases](#2a-wikilink-aliases-and-display-names) | Display aliases and vault codenames |
| [Body as a signal surface](#2b-use-the-body-as-a-real-signal-surface) | Headings, footnotes, blockquotes, tags, callouts |
| [Embeds](#embeds) | `![[id]]` pull-in references |
| [Callouts](#callouts) | Structured `> [!TYPE]` blocks |
| [Date shortcuts](#date-shortcuts-with-) | `@today`, `@tomorrow`, etc. |
| [Tags](#tags) | `#hashtag` detection and tag queries |
| [Queries](#3-add-a-query-block-to-a-dashboard-note) | Full `!view` query language |
| [Templates](#templates) | `_templates/` for consistent note creation |
| [Schemas](#schemas) | Schema-driven creation and field enforcement |
| [Query Builder](#query-builder) | Guided query building and refinement |
| [Tasks](#tasks) | Markdown checkboxes and task queries |
| [Graph](#using-the-graph) | Sidebar graph and Graph Workspace — layers, dragging, node info |
| [Note Report](#using-the-note-report) | Structured note inspector — tabs, lifecycle, relations |
| [Vault Health](#using-vault-health) | Every panel section explained: score, lifecycle, drift, schema conformance |
| [PDF Export](#pdf-export) | Export notes and live views |
| [CLI](#using-the-cli) | `build`, `health`, `validate`, `query`, `serve`, `export` — full headless vault access |
| [CRM setup](#recommended-setup-crm) | CRM vault walkthrough |
| [Programmer setup](#recommended-setup-programmer--project-tracker) | Engineering project tracker walkthrough |

Use this together with:

- [README.md](./README.md) for the product overview
- [FEATURES.md](./FEATURES.md) for the full capability reference
- [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md) for the exact query syntax

---

## The Core Idea

Yamlink works best when you treat Markdown notes as structured records:

1. give important notes an `id:`
2. give them a `type:`
3. relate them with `[[wikilinks]]`
4. query them with `!view`

That is the system.

Yamlink also learns from the note body, not just from frontmatter. Headings, tags, links, quotes, and footnotes can all contribute to how the extension understands a note and what it suggests next.

---

## Import an Obsidian vault

If you already have an Obsidian vault, start with:

- `Yamlink: Import Obsidian Vault`

What the first Zim iteration does:

1. lets you choose an Obsidian vault folder
2. lets you either:
   - copy it into the current workspace
   - or add it as a workspace folder
3. ignores `.obsidian/` on the copy path so Yamlink brings in your content, not your editor settings
4. rebuilds the Yamlink index
5. offers to open Vault Health right away

What it does **not** do yet:

- it does not translate plugin configuration
- it does not process Dataview logic

This first pass is a quick bridge: bring the vault in, let Yamlink index it, then use Note Report, Calendar, Vault Health, and Graph Workspace to understand what structure already exists there.

---

## Excluding notes from Yamlink

If you want to keep files in your repo but keep them out of Yamlink's operating system, add a root-level file named:

- `.yamlinkignore`

Write one path per line. Yamlink treats matching files and folders as outside the system.

Example:

```text
# One specific note
legacy-note.md

# One file by relative path
notes/internal-dump.md

# Whole folders
scratch/
raw-notes/
```

- ignored notes stay in your repo, but Yamlink does not index them
- they do not contribute to graph edges, diagnostics, Note Report, Vault Health, Calendar, or inference
- rename propagation does not touch them


---

## Home Panel (Activity Stream)

When you first activate Yamlink, a **Home panel** opens automatically. It shows your vault at a glance:

- **Pulse bar** — note count, type count, and broken link count
- **Quick actions** — New note, Today's journal, and buttons for your vault's top types
- **Activity feed** — last 15 mutation events as a human-readable timeline, clickable to open the note
- **Continue working** — your 5 most recently touched notes
- **Nudge cards** — broken links and untyped notes

For fresh vaults with fewer than 5 notes, the panel shows an onboarding welcome with 3 quick-start steps instead of the activity feed.

Run the Home panel anytime with `Yamlink: Open Home` from the command palette, or click the `$(home)` button in the status bar — it sits immediately to the right of the vault-health indicator and is always visible regardless of which file is open. This newer panel is still in development but works as your introduction to your daily activities.

---

## Recommended First Steps

### 1. Create 3-5 notes with frontmatter

The fastest way is **`Yamlink: New Note`** (`Ctrl+Alt+N` / `Cmd+Alt+N`). It picks the scaffold automatically: matching `_templates/` file first, then schema node, then vault-pattern inference. The note opens with `id:`, `type:`, and `created:` already filled in.

If you're inside an existing Yamlink note when you trigger it, Yamlink asks if you want to link the new note back to the current one — enter a field name and the reverse relation is written automatically.

You can also use `Yamlink: New Note from Template` to pick a specific template, or `Yamlink: New Note from Schema` to generate frontmatter from a schema definition directly.

**Daily Notes**: press `Ctrl+Alt+J` / `Cmd+Alt+J` to open or create today's journal note (`journal-YYYY-MM-DD`). If `_templates/journal.md` exists, it is used as the template. Otherwise Yamlink creates a minimal stub with `id`, `type: journal`, and `date` pre-filled.

**Creating notes from selected text**: two right-click commands are available in the editor context menu when you have text selected:
- **Yamlink: New Note from Selection** — selected text becomes the title of a new linked note; the selection is replaced with `[[new-id]]`
- **Yamlink: Extract Selection to New Note** — selected body text becomes the body of a new note; the selection is replaced with `![[new-id]]` (embed); the new note gets `source: [[original-id]]` written into its frontmatter

Example note:

```yaml
---
id: johnny-rico
type: character
name: Juan "Johnny" Rico
unit: [[roughnecks]]
rank: lieutenant
date: 2026-04-08
---
```

### 2. Link them to each other

Use body links or frontmatter relation links:

```yaml
unit: [[roughnecks]]
commander: [[johnny-rico]]
```

```md
After [[mission-klendathu]], [[johnny-rico]] rejoined [[roughnecks]] for the Planet P assault.
```

### 2a. Wikilink aliases and display names

**Display alias** — show a different label without changing the underlying link:

```md
[[johnny-rico|Rico]]
[[roughnecks|Rasczak's Roughnecks]]
[[mission-klendathu|Klendathu]]
```

The graph edge still points to the canonical ID. Ctrl+Click still navigates to the right note. The alias is purely display.

**Vault alias** — give a note a codename that works everywhere as if it were the real ID:

```yaml
---
id: lt-rasczak
type: character
aliases: [rasczak]
---
```

Now anywhere in the vault you can write `[[rasczak]]` and Yamlink treats it exactly like `[[lt-rasczak]]`:

- Ctrl+Click navigates to it
- the decoration appears (resolved link styling, not a broken link)

*Multiple aliases are supported*

**Broken wikilinks and the template quick fix** — if you write `[[a-note-that-doesnt-exist]]`, Yamlink decorates it with amber brackets and faded amber text (a subtle "dead reference" signal that doesn't interrupt reading) and places a lightbulb on the line. The quick fix is *"Create note"*. When you trigger it, Yamlink walks you through the template workflow:

- No `_templates/` folder → Yamlink offers to create it and writes a starter template for the inferred type (pre-filled with the fields most common for that type in your vault). Edit the template, then trigger the quick fix again — the note will be created using it.
- `_templates/` exists but empty → same offer, same loop.
- `_templates/` has templates → a QuickPick list shows all available templates. If one matches the type Yamlink inferred from context, it floats to the top labeled "Suggested: contact". Pick one and the note is scaffolded from it immediately.

The note opens with the cursor positioned on the first empty field for immediate editing. This is the intended workflow for growing a vault from links first, structure second.

### 2b. Use the body as a real signal surface

Yamlink does not treat the body as "just body content". It is now "understanding" content.

Right now that includes:

- headers
- tags
- blockquotes such as `> quoted passage`
- footnotes such as `[^source-1]`

Notes become more understandable to Yamlink.

Example:

```md
# Evidence

> Planet P intelligence confirmed that the Arachnids were coordinating through Brain Bugs.

This changes how [[federal-intelligence]] should read the aftermath of [[mission-planet-p]][^source-1].

[^source-1]: Notes from the post-mission briefing after Planet P.
```

Yamlink can use patterns like that to understand that the note is source-heavy, reference-heavy, or research-oriented.

### 2c. Exact Markdown syntax for longform structure

If you want Yamlink to pick up longform signals, use normal Markdown syntax.

#### Footnotes

Write a footnote reference where the claim appears:

```md
This is worth sourcing.[^source-1]
```

Then define the footnote later in the same note:

```md
[^source-1]: Interview notes with the regional product team.
```

**At this point, Yamlink detects:**

- footnote reference
- footnote definition

And then treats that as a sign that the note may be research-heavy, source-heavy, or reference-heavy


#### Blockquotes

Use `>` for quoted material:

```md
> First quoted line
> Second quoted line
```

What Yamlink does with this right now:

- counts blockquote lines
- uses repeated quote blocks as a hint that the note may be acting like a source note, evidence note, or interview note


#### Quoting another note or section

The cleanest current Yamlink-friendly pattern is:

```md
> From [[source-note]]
> Quoted passage here.
```

If your workflow supports heading anchors, you can be more specific:

```md
> From [[source-note#Evidence]]
> Quoted passage here.
```

This keeps the quote readable while preserving the source link in normal Markdown.

#### Body autocomplete for longform notes

Yamlink now helps with two body-writing patterns directly while you type:

- heading anchors inside wikilinks
- footnote references from the current note
- source-heavy longform snippets for quote / evidence / reference notes

##### Heading anchors

If you start a link like:

```md
[[source-note#
```

Yamlink can suggest headings from `source-note`, so you can finish links like:

```md
[[source-note#Evidence]]
[[source-note#References]]
```

It also works for the current note:

```md
[[#Evidence]]
```

That means a Yamlink user can quote or cite a specific section much faster, instead of having to retype heading names manually.

##### Footnote references

If you already have footnote definitions in the current note, and you type:

```md
[^
```

or

```md
[^sou
```

Yamlink can suggest existing footnote IDs from the same note, so you can reuse:

```md
[^source-1]
[^interview-a]
```


This is meant to make longform notes more consistent:

- repeated section links are easier to write
- repeated footnote references are easier to reuse
- body structure becomes part of Yamlink's actual editing experience, not just passive detection

##### Source-aware writing snippets

If a note already looks research-heavy or source-heavy because it has quotes or footnotes, Yamlink can now also help with a few body-writing patterns directly:

- `Quote from linked source`
- `Quote from linked section`
- `## Evidence`
- `## References`
- missing footnote definitions such as `[^source-1]: ...`

That means on a blank line, in a quote-heavy note, Yamlink can help you start patterns like:

```md
> From [[source-note]]
> Quoted passage here.
```

or:

```md
> From [[source-note#Evidence]]
> Quoted passage here.
```

And if you already wrote a footnote reference like:

```md
Claim worth checking.[^source-1]
```
:
Yamlink can help you add the missing definition later

```md
[^source-1]: Source detail
```

### 3. Query in plain English

If you are not sure how to write a `!view` query, run `Yamlink: Query in Plain English` from the command palette. Type what you want to find and Yamlink generates the `!view` syntax for you using your vault's own types, fields, and status values.

Examples:
- "active contacts" → `!view contact where status = active`
- "tasks due today" → `!view open-tasks`
- "projects I haven't updated in 30 days" → `!view project where file.modified < days-ago(30)`
- "contacts without a company" → `!view contact where company is empty`
- "missions linked to johnny-rico" → `!view mission where commander = [[johnny-rico]]`

The generated query is shown for your review before it is inserted, and you can choose "Edit before inserting" to adjust it. Standard `!view` syntax is completely unchanged — this command is a learning and discovery tool, not a replacement.

### 4. Add a query block to a dashboard note

Type `!view` in a note and use `Yamlink: Insert View Block` — or write the query directly:

```md
!view contact | Active contacts
where status = active
select name, company, owner, date
sort date desc
```

### 3b. Learn the actual `!view` language

Yamlink queries are small on purpose. They are not SQL.

The most important rule is:

- one `where` line can contain an `or` group
- multiple `where` lines combine with `and`

Example:

```md
!view mission | Missions to review
where outcome = victory or commander = [[carl-jenkins]]
where date exists
sort date desc
```

This means:

- `outcome = victory OR commander = [[carl-jenkins]]`
- `AND date exists`

### 3c. Query patterns you can rely on

Exact match:

```md
where status = active
```

Relation match:

```md
where unit = [[roughnecks]]
```

Contains:

```md
where body contains "brain bug"
where any contains klendathu
```

Empty / exists:

```md
where close-date is empty
where date exists
```

Date functions:

```md
where date >= today()
where date <= days-from-now(14)
where date >= days-ago(30)
```

File system dates (no frontmatter needed):

```md
where file.modified >= today()
where file.created >= 2026-01-01
select id, type, file.modified
sort file.modified desc
```

`file.created` and `file.modified` are virtual fields — Yamlink reads them from the file system at query time. Useful for finding recently touched notes or notes created in a date range without manually adding a `created:` field.

For the full operator list — `!=`, `>=`, `<=`, tag filters, all date functions, and Boolean rules — see [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md).

Recommended habit:

- use one-line queries for quick experiments
- use multi-line queries for anything you want to keep
- if a view matters, prefer one condition idea per line so it stays readable

### 3d. Query examples that should just work

```md
!view contact | Active contacts
where status = active
select name, account, owner, date
sort date desc
```

```md
!view deal | Deals missing close dates
where close-date is empty
sort created desc
```

```md
!view * | CRM research notes
where #crm
where status != archived
select id, type, status, date
sort date desc
```

> **`!view *` tip:** querying all types at once produces a column for every field that exists anywhere in the vault. Always add `select` to keep the table readable.

```md
!view mission | Missions linked to Carl or marked as victory
where commander = [[carl-jenkins]] or outcome = victory
where date exists
sort date desc
```


### 5. Open side surfaces

Operational readouts for the vault:

- `Yamlink: Open Note Report`
  - local note intelligence
  - what this note links to
  - what links here
  - related tasks, timeline, and suggested next views
- `Yamlink: Open Calendar`
  - dated activity across the vault
  - tasks, dated notes, and created-note milestones
  - useful when you want to see work and activity by day, week, or month
- `Yamlink: Open Vault Health`
  - vault-wide structural quality
  - broken links, duplicate IDs, schema drift, lifecycle maturity, and type coverage


Use:

- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Vault Health`
- `Yamlink: Open Graph` — opens the sidebar graph panel
- `Yamlink: Open Graph Workspace` — opens the full Graph Workspace panel centered on the active note
- `Yamlink: Open Vault Graph` — opens the Graph Workspace in vault-wide Explore mode

---

## Templates

Templates are `.md` files in a `_templates/` folder at your workspace root. They define the frontmatter shape for a note type, with empty fields that get filled in when you create a note from the template.

### Creating your first template

Run `Yamlink: New Note from Template`. If no templates exist yet, Yamlink will offer to create the `_templates/` folder with a starter `contact.md` template and open it for you to edit.

### Template structure

A template is a regular Markdown file with frontmatter. Leave `id:` and `created:` empty — Yamlink fills them on creation. Leave relation fields as `[[]]` to mark where a link belongs. You can define your schema according to your own needs and uses.

```yaml
---
id:
type: contact
name:
account: [[]]
email:
status: active
created:
---
```

### Using a template

Run `Yamlink: New Note from Template`. The picker shows each template's type and its field names so you can choose without opening the file first. After you enter the new note's ID, Yamlink creates the file, fills in `id:` and `created:`, opens the note, and positions your cursor on the first empty field ready to type.

### Type-matched templates at note creation

When you run `Yamlink: Create Note` and choose a type, Yamlink automatically checks for `_templates/<type>.md`. If it exists, the new note is created from that template instead of a blank stub.


---

## Schemas

Even though the idea is for users to customize Yamlink to their own mental structure, Yamlink supports `type: schema` notes. A schema defines the expected field shape for a note type: which fields are required, which are relations (and what they point to), and what type each field holds.

### Writing a schema note

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

Key rules:
- `target:` is the note type this schema governs — one schema per type
- `fields:` is a map of field name → field definition
- `type:` on each field is `string`, `number`, `relation`, `boolean`, or `date`
- `required: true` makes the field mandatory (Yamlink surfaces a diagnostic when it's missing)
- `target:` on a relation field drives completion — only notes of that type appear in suggestions

### Creating a note from a schema

Run **`Yamlink: New Note from Schema`**. Yamlink shows all schema types in a quick pick, with the field summary visible so you can choose without opening the schema first. Enter an ID, and Yamlink creates the note with:

- all schema fields in the frontmatter (required fields first)
- `relation`-typed fields filled with `[[]]` as a placeholder
- `string` / `number` fields left empty, ready to type
- cursor positioned on the first empty field

### Note creation priority chain

When you run `Yamlink: Create Note` and choose a type, Yamlink picks the frontmatter source in this order:

1. **Template** — `_templates/<type>.md` exists → use it (full body + frontmatter)
2. **Schema** — a `type: schema` note exists for the type → generate frontmatter from schema fields
3. **Vault inference** — no template or schema → infer likely fields from observed vault patterns/tendencies
4. **Bare stub** — no signal → `id:` + `created:` only

### Schema field enforcement

Once a schema exists, Yamlink enforces it passively:

- missing required fields get a diagnostic squiggle on the note
- unknown types (no schema defined, no vault usage) also get a lighter advisory
- duplicate schema notes (two schemas for the same target type) get a warning

### Schema-aware completion

On a relation field whose target type is defined in a schema, Yamlink filters the completion list to notes of that type. If no notes of that type exist yet, completion still offers a `New [type]` action.

---

## Query Builder

### Smart starters (the default)

When you run `Yamlink: Insert View Block`, Yamlink reads the active note and surfaces context-aware suggestions at the top of the list — labelled **Smart:**. These are generated from the note's type, its relations, and what notes link to it.

For example, if you are on an `account` note, you might see:

- **Smart: Contacts in this account** — contacts whose `account` field links to this note
- **Smart: Open deals** — deals related to this account
- **Smart: Latest meetings** — meetings linked here

These smart starters are vault-aware. They update as your vault grows.

### Guided builder

Pick **Guided builder** from the starter list to step through a structured flow:

1. **Choose view kind** — Table of a type, Tasks and calendar, or Backlinks to this note
2. **Choose type** — the current note's type floats to the top marked as "current note type"
3. **Choose a preset** — Standard table, Latest entries, Active items, or a context-aware preset if applicable:
   - If the chosen type has a schema relation field pointing back at the current note's type, a **"[Type]s linked to this [current type]"** preset appears at the top, pre-filtered to this note
4. **Custom** — if none of the presets fit, choose columns, filter field and value, sort, and limit manually

### What the builder is actually building

The builder is always producing normal `!view` blocks.

That means the output can be edited by hand later, and it still follows the same query rules:

- `select`
- `where`
- `sort`
- `limit`
- `via`


### Refine an existing view

Position your cursor on any `!view` block and use `Yamlink: Refine View Block` (or the lightbulb → Refine this view) to change the label, sort, limit, or filter without rewriting the block from scratch.

### Query reference

Yamlink supports two query-writing styles:

- simple one-line queries
- multi-line power-user queries


```md
!view contact | Active contacts
where status = active
select name, company, owner, date
sort date desc
limit 10
```

#### Clauses

| Clause | Purpose |
|---|---|
| `select field, field` | Which columns to show (omit for auto) |
| `where field = value` | Filter by exact match |
| `where field contains value` | Filter by partial match |
| `sort field` / `sort field desc` | Sort order |
| `limit N` | Cap the number of rows |
| `via field` | Narrow an incoming query to a specific relation field |

#### Shortcut queries

```md
!view today
!view upcoming
!view calendar
!view open-tasks
!view done-tasks
!view overdue
!view undated-tasks
```

For the full supported rules and current limitations, see [QUERY_LANGUAGE.md](./QUERY_LANGUAGE.md).

#### Incoming (backlinks) query

```md
!view incoming meeting
via account
select date, title
sort date desc
```

---

## Tasks

Tasks in Yamlink are Markdown checkboxes anywhere in a note body:

```md
- [ ] Call Jane tomorrow
- [x] Send proposal Friday
- [ ] Review pipeline next Monday
```

They appear in the Calendar, Note Report, and task queries. You do not need a separate note per task — tasks live inside notes and are tracked from there.

### Toggling tasks

In a `!view tasks` table, click the **True/False** cell in the `done` column to toggle a task's checkbox directly. Yamlink rewrites the `- [ ]` / `- [x]` line in the file.

### Date extraction from task text

Yamlink extracts dates from task text automatically:

- `26/03/2026`, `March 26 2026`
- `tomorrow`, `Friday`, `next Monday`, `end of month`

Use `YYYY-MM-DD` for canonical dates in frontmatter.

---

## Date Shortcuts with `@`

Type `@` in any frontmatter field or task line to trigger date shorthand completions. Yamlink replaces the shortcut with the real `YYYY-MM-DD` date on selection.

| Shortcut | What it inserts |
|---|---|
| `@today` | Today's date |
| `@tomorrow` | Tomorrow's date |
| `@yesterday` | Yesterday's date |
| `@thisweek` | Start of the current week |
| `@nextweek` | Start of next week |
| `@endofmonth` | Last day of the current month |
| `@startofmonth` | First day of the current month |

Example — in a frontmatter `date:` field:

```yaml
date: @tomorrow   →   date: 2026-05-12
```

Example — in a task line:

```md
- [ ] Review recon with [[carl-jenkins]] @tomorrow
```

Select the shortcut from the completion list and Yamlink writes the resolved date. The canonical `YYYY-MM-DD` form is always what gets stored.

---

## Tags

Tags in Yamlink are standard `#hashtag` notation written anywhere in the note body.

```md
This is a strategic research note. #crm #priority
```

Yamlink detects and indexes body tags automatically as part of each note's metadata. You do not need to add a `tags:` frontmatter field — body tags are picked up from the text.

### Querying by tag

Use `#tag` shorthand directly inside a `where` clause:

```md
!view * | CRM research notes
where #crm
where status != archived
sort date desc
```

```md
!view contact | VIP contacts
where #vip
sort name
```

Tag filters combine with other conditions using the standard `AND` across lines:

```md
!view * | Active priority items
where #priority
where status = active
sort date desc
```


---

## PDF Export

Yamlink can export notes and live query results directly to PDF. 

### Export options

- **`Yamlink: Export Active Note to PDF`** — exports the current note, including any rendered `!view` table results embedded inline
- **Print from table panel** — in any live `!view` table, use the print/export button to export just that view's results as a formatted PDF

### What gets included

- frontmatter fields rendered as structured metadata
- note body with Markdown formatting applied
- live `!view` results rendered as tables

This is useful for:
- sharing a structured note or report with someone outside VS Code
- archiving a point-in-time snapshot of a live view
- printing a dashboard or query result from the active session

---

## Callouts

Callouts are structured blockquotes that tell Yamlink what kind of content is inside. They follow Obsidian-compatible syntax:

```md
> [!SOURCE] Planet P after-action memo
> Planet P intelligence confirmed coordinated Arachnid activity after the outpost assault.

> [!EVIDENCE]
> Three field reports from [[roughnecks]] survivors corroborate the Brain Bug timeline.

> [!NOTE] Cross-reference
> See [[mission-planet-p]] for the mission record and [[carl-jenkins]] for the intelligence angle.

> [!WARNING] Reliability concern
> Source relies on survivor testimony gathered under combat stress.
```

### Supported callout types

| Type | Color | Use for |
|---|---|---|
| `[!SOURCE]` | amber | primary sources, raw intel, memos |
| `[!EVIDENCE]` | amber | supporting data, corroborating facts |
| `[!QUOTE]` | amber | verbatim quotes from sources |
| `[!REFERENCE]` | amber | citations, linked material |
| `[!NOTE]` | blue | annotations, observations, context |
| `[!INFO]` | blue | background information |
| `[!TIP]` | blue | practical hints |
| `[!WARNING]` | orange | caveats, reliability concerns, outdated flags |
| `[!DANGER]` | red | critical issues, blockers, contradictions |

### What Yamlink does with callouts

- decorates `[!TYPE]` in the editor with its color family
- uses callout types as note-role signals: a note with `[!SOURCE]` and `[!EVIDENCE]` blocks reads as a source/evidence note to the intelligence layer
- feeds into Note Report role inference

### Title is optional

Both forms work:

```md
> [!NOTE]
> Content here.

> [!NOTE] Title here
> Content here.
```

---

## Embeds

Embeds are wikilinks prefixed with `!`. They reference another note as embedded content:

```md
![[mission-planet-p]]
![[carl-jenkins]]
```

### How embeds work in Yamlink

- the `!` is dimmed (same style as `[[` brackets) to indicate the embed marker
- hover shows the embedded note's content with an "Embedded note" badge
- Ctrl+Click navigates to the note
- aliases work
- broken embed references get diagnostics squiggles like regular broken wikilinks
- embeds count as body links — the graph edge is registered
- a note with multiple embeds gets a "hub / references" role signal in the intelligence layer

### Embed vs. wikilink

| | `[[id]]` | `![[id]]` |
|---|---|---|
| Graph edge | yes | yes |
| Hover | note card | note card + "Embedded note" |
| Ctrl+Click | navigate | navigate |
| Decorations | bracket dim + underline | `!` dim + bracket dim + underline |
| Intent | link / reference | pull the note in as content |

---

## Body Intelligence And Longform Structure

Yamlink is designed around structured Markdown, not only around YAML fields.

That means the note body matters.

### What Yamlink currently detects

#### Headings

Yamlink reads headings like:

```md
# Overview
## Evidence
## References
```

Why it matters:

- headings help Yamlink understand what kind of note it is looking at
- they can reinforce note-role inference
- they provide useful context for autocomplete and later reporting

#### Blockquotes

Yamlink detects Markdown quote blocks:

```md
> Direct quote from a source
> Follow-up quoted context
```

Why it matters:

- quote-heavy notes often behave like source notes, evidence notes, interview notes, or research notes
- repeated blockquotes can act as a signal that the note contains extracted material rather than only original prose

#### Footnotes

Yamlink detects both footnote references and definitions:

```md
Claim supported by a source[^s1]

[^s1]: Interview notes with a partner team.
```

Why it matters:

- footnotes are explicit structure in Markdown
- they can signal research, references, evidence, or source-heavy writing
- they create a strong foundation for later validation and reporting

### What this currently does

Right now these signals are used to improve Yamlink's understanding of a note.

That means they can feed:

- note-role hints
- document intelligence
- future autocomplete and ranking improvements

Examples of the kinds of hints Yamlink can derive:

- `source`
- `references`
- `research`
- section names like `Overview`, `Evidence`, or `References`



## How Yamlink Learns From Your Vault

For a complete guide to what the lightbulbs mean and how the intelligence system works, see [INTELLIGENCE.md](INTELLIGENCE.md).

Yamlink does not rely only on fixed built-in assumptions.

It also learns from the structure already present in your vault.

That means:

- repeated field patterns teach Yamlink what usually belongs together
- repeated note shapes teach Yamlink likely note roles
- a note can now carry one primary role and one or two secondary roles when it clearly serves more than one purpose
- known note IDs can help relation detection even when a field uses plain IDs instead of `[[wikilinks]]`
- stronger repeated patterns are treated with more confidence than weak one-off patterns
- the learned note index now patches changed notes more deeply instead of rebuilding every observed note from scratch on each small vault edit

Example:

```yaml
unit: roughnecks
commander: johnny-rico
```

If `roughnecks` and `johnny-rico` are real note IDs in the vault, Yamlink can now treat those as relation signals even without brackets.

This does **not** replace `[[wikilinks]]`.

The preferred stored form is still:

```yaml
unit: [[roughnecks]]
commander: [[johnny-rico]]
```

But in this iteration Yamlink is now more forgiving when it reads existing vault data.

### Confidence behavior

Yamlink now tries to be more disciplined about confidence:

- strong repeated vault patterns should surface more decisively
- weak or noisy patterns should stay quieter
- autocomplete should prefer signals that the vault keeps proving correct
- newer repeated patterns can now matter more than stale historical ones

The goal is simple:

- less random suggestion noise
- better ranking
- a clear rule for how Yamlink turns raw evidence scores into surface confidence
- the more structure your notes have, the "smarter the system will feel"


### Mixed-purpose notes

Some notes are not purely one thing.

Examples:

- a bug note can also clearly belong to a project
- a contact note can also carry account/container context
- a research note can also behave like a source note

Yamlink now tries to keep that nuance instead of forcing every note into only one label.

That means Yamlink can now infer:

- one primary role
- one or two secondary roles

The primary role still drives the main label.

The secondary roles help ranking, inference, and autocomplete behave more realistically for mixed-purpose notes.

### Best current practice

If you write research, essays, technical notes, interviews, or worldbuilding material, use:

- stable headings
- proper footnotes
- honest blockquotes for sourced text
- body tags where helpful
- `[[wikilinks]]` to connect the prose back into the rest of the vault

That gives Yamlink better signals while keeping everything in plain Markdown.

---

## Recommended Setup: CRM

Start with these note types:

- `account`
- `contact`
- `deal`
- `task`
- `meeting`
- `person`

### Suggested field shapes

#### Account

```yaml
---
id: federal-intelligence
type: account
name: Federal Intelligence
status: active
owner: [[owner]]
segment: command
date: 2026-04-08
---
```

```yaml
---
id: sicon-command
type: account
name: SICON Command
status: active
owner: [[owner]]
segment: military
date: 2026-04-09
---
```

#### Contact

```yaml
---
id: carl-jenkins
type: contact
name: Carl Jenkins
account: [[federal-intelligence]]
owner: [[owner]]
role: analyst
status: active
date: 2026-04-08
---
```

```yaml
---
id: carmen-ibanez
type: contact
name: Carmen Ibanez
account: [[sicon-command]]
owner: [[owner]]
role: pilot
status: active
date: 2026-04-09
---
```

#### Deal

```yaml
---
id: deal-tango-urilla-briefing
type: deal
name: Tango Urilla Briefing Review
account: [[federal-intelligence]]
contact: [[carl-jenkins]]
owner: [[owner]]
stage: discovery
value: 25000
date: 2026-04-10
---
```

### Recommended CRM dashboard queries

```md
!view account | Accounts
select name, owner, status, segment
sort name
```

```md
!view contact | Recent contacts
select name, account, owner, status, date
sort date desc
limit 10
```

```md
!view deal | Open deals
where stage contains discovery
select name, account, owner, value, date
sort date desc
```

```md
!view today | Follow-ups today
```

### CRM workflow recommendation

- use `date:` for the main operational date on notes
- use Markdown tasks in meeting / deal / account notes for follow-ups
- keep `owner`, `account`, `contact`, and `stage` structured in frontmatter
- use Note Report for local context
- use Calendar for dated activity and follow-ups
- use tables for the actual working views
- create a `_templates/contact.md`, `_templates/account.md`, etc. so new records start consistently, or write schema notes and use `Yamlink: New Note from Schema` for programmatic creation

---

## Recommended Setup: Programmer / Project Tracker

Start with:

- `project`
- `task`
- `decision`
- `bug`
- `meeting`
- `doc`

### Suggested field shapes

#### Project

```yaml
---
id: project-yamlink-carmen
type: project
name: Carmen
status: active
owner: [[person-rico]]
area: product
date: 2026-04-08
---
```

#### Bug

```yaml
---
id: bug-calendar-date-parser
type: bug
title: Calendar ignores note date field
project: [[project-yamlink-carmen]]
status: fixed
priority: high
owner: [[person-rico]]
date: 2026-04-08
---
```

#### Decision

```yaml
---
id: decision-graph-right-rail
type: decision
title: Move selected-node details into the right rail
project: [[project-yamlink-carmen]]
status: accepted
date: 2026-04-08
---
```

### Recommended engineering dashboard queries

```md
!view project | Active projects
where status = active
select name, owner, area, date
sort date desc
```

```md
!view bug | Recent bugs
select title, project, priority, status, date
sort date desc
limit 15
```

```md
!view decision | Decisions
select title, project, status, date
sort date desc
```

```md
!view upcoming | Upcoming dated tasks
```

### Programmer workflow recommendation

- use one note per project / bug / decision / meeting
- use body links for references and narrative context
- use frontmatter for structured fields like `status`, `priority`, `owner`, and `project`
- keep tasks in the body when they are part of a running work log
- use Graph for structural understanding, not as the primary work surface
- add a schema note for your main types so Yamlink can infer relation targets automatically and so `Yamlink: New Note from Schema` generates correct frontmatter on creation

---

## Using the Graph

The graph gives you a structural picture of your vault — who links to whom, which notes are hubs, and how clusters form.

Both graph surfaces (the sidebar and the workspace panel) use the **x-graph** Canvas2D renderer: a lightweight physics-based engine with no external graph library dependency. Nodes are sized by hub score; edges connect them with live D3-force physics that settles after a few seconds. X-graph is in its alpha stage, but it is fully operational.

There are two separate graph surfaces.

### Sidebar graph (always visible)

Open it with `Yamlink: Open Graph`. It lives in the sidebar and stays open as you work.

Shows the **vault constellation** — every indexed note as a dot. Hub notes appear larger. Nodes are colored by their inferred kind (person/teal, event/amber, artifact/mint, schema/purple, task/pink, container/blue).

**Interacting with nodes:**

- **Hover** a node → a bottom-center info card appears with the note's label, type, lifecycle state badge, and link count. Connected nodes brighten; non-connected notes dim.
- **Click** a node → opens that note in the editor.
- **Click and drag** a node → pins it to a new position. Connected nodes respond through live physics. Release to let it settle naturally.

**Panning and zooming:**

- **Scroll wheel** — zoom in and out (0.05× to 8×), centered on cursor
- **Drag the canvas** — pan the view
- **Double-click the canvas** — fits all nodes into view

**Toolbar buttons:**

- **Fit** — fits all visible nodes into the panel
- **Semantic** — toggles the Semantic layer (edge colours by relation type, with direction arrowheads and a legend)
- **Health** — toggles the Health layer (colored rings on each node showing lifecycle state and structural drift, with a legend)

### Visual layers

The Semantic and Health layers stack on top of the base graph and are fully independent — either, both, or neither can be active.

**Semantic layer:**
- Edges are colored by source node type (person/contact → teal, container/project → amber, topic/tag → purple, event/session → pink)
- Triangle arrowheads mark edge direction
- Dashed lines for weak-strength links
- An inline legend expands when active

**Health layer:**
- A colored ring around each node encodes lifecycle state: hub (teal), consolidated (green), growing (amber), draft (gray), stale (red)
- Structural drift overrides lifecycle rings: minor-drift (yellow), drifting (orange), outlier (red)
- An inline legend expands when active showing separate keys for lifecycle and drift

### Graph Workspace (full exploration panel)

Two commands open it:

- `Yamlink: Open Graph Workspace` — opens centered on the current note
- `Yamlink: Open Vault Graph` — opens in vault-wide constellation mode

The same x-graph engine powers this surface. All the same interactions apply: hover for node info, click to open, drag to reposition, Semantic/Health layer toggles.

**Toolbar:**

- **Semantic** and **Health** layer toggle buttons — same as sidebar
- **Fit** — fits all visible nodes into the panel

### What the numbers mean

**Notes** — every indexed note (a note with an `id:` field). Notes without `id:` are invisible to the graph.

**Edges** — directed links between notes. Each `[[wikilink]]` in a frontmatter field or note body creates one edge from the source note to the target. If `mission-klendathu` has `commander: [[johnny-rico]]`, that is one edge from `mission-klendathu` toward `johnny-rico`.

**Why the Health panel may show more edges than the graph** — the Health panel counts all graph edges including body text links. Body wikilinks (prose mentions not in frontmatter) are included in the edge total and appear as connections in the graph. If the two numbers differ, this is expected behavior, not a bug.

**Node size** — encodes hub score: larger nodes have more connections. A large dot means many other notes link to it.

**Lifecycle badge** (shown in the node info card on hover) — the note's current lifecycle state: `draft`, `growing`, `consolidated`, `hub`, or `stale`.

**Link count** (shown in the node info card) — total inbound + outbound connections from the graph edge layer.

### What to expect for `johnny-rico` in the vault graph

Open the sidebar graph. Find the `johnny-rico` node — it should appear slightly larger than most other nodes because several mission notes link to it.

Hover it: the info card should show `Hub` lifecycle, `character` type, and a link count of 6 or more.

Click it: the note opens in the editor.

Enable the **Health** layer: a colored ring appears on every node. `johnny-rico` should show a hub-teal ring. Any notes not touched in 45+ days show a red stale ring.

Enable the **Semantic** layer: edges gain colors. The `commander` relation from missions to `johnny-rico` appears in one color family; the `unit` relation from `johnny-rico` to `roughnecks` appears in another.

### What to use the graph for

- Find orphan notes (no connections at all — no edges in or out)
- Spot hub notes (large nodes — they usually matter most)
- Check whether a new note is properly linked into the vault
- Use the Health layer to quickly see which notes are stale or drifting
- Use the Semantic layer to understand what kind of relationships exist between clusters
- Validate structure: does the graph match what you expected?

The graph is a structural inspection tool, not the main working surface. Use it when structure matters, then work from the editor.

---

## Using the Note Report

The Note Report is the structured inspector for the currently active note. Open it with `Yamlink: Open Note Report`.

It lives in the Yamlink sidebar and follows whichever note is active in the editor.

### What the Note Report shows

The Note Report uses five tabs to keep related information together and reduce scrolling:

- **Overview** — key fields, simple signals, and optional signal details
- **Links** — structured relations first, with body mentions separated underneath
- **Tasks** — only tasks written inside the currently opened note, plus local dated activity
- **Views** — one suggested next view and one already-in-note view at most
- **History** — structural arc over time: when fields were added, how links changed, before/after diffs for each mutation

Tab selection persists across note switches.

### Overview tab

The Overview tab follows a simple rule:

- facts first
- inference second
- advanced diagnostics only if you expand them

That is why the report now separates **Signals** from **Signal details**.

| Row | What it means |
|---|---|
| **ID / Type** | The note's canonical identifier and type label |
| **Role** | Inferred note role: person, event, artifact, container, source, record, etc. Yamlink derives this from field shapes, body structure, and vault patterns — not from a hardcoded label |
| **Lifecycle** | Where this note sits in its maturity curve (see below) |

### Signals vs. Signal details

The **Signals** section is the human-first summary.

| Signal row | What it means | Kind |
|---|---|---|
| **note type** | The note's `type:` value | direct fact |
| **structured inbound links** | How many non-body relations point to this note, compared with the vault average | derived summary |
| **structured outbound links** | How many non-body relations this note points to, compared with the vault average | derived summary |
| **lifecycle** | Yamlink's maturity / centrality classification for the note | inferred summary |
| **note role** | Yamlink's best guess about what kind of note this is | inferred summary |
| **next view** | The single most relevant query view Yamlink thinks is worth inserting next | suggested action |

The **Signal details** section is the advanced layer.

| Detail row | What it means |
|---|---|
| **total inbound link rows** | Every inbound link row counted together, including body mentions |
| **total outbound link rows** | Every outbound link row counted together, including body mentions |
| **body mentions to this note** | How many other notes mention this note in prose/body text |
| **body mentions from this note** | How many body/prose mentions this note makes to other notes |
| **linked here via** | Which fields or surfaces are creating inbound links, counted by link rows |
| **links out via** | Which fields or surfaces are creating outbound links, counted by link rows |
| **linked from types** | Which note types are contributing inbound link rows |
| **links to types** | Which note types this note points to |
| **body evidence** | Repeated body references that Yamlink is using as a lightweight signal |

Important:

- **structured inbound/outbound links** are cleaner than total link rows because they exclude body mentions
- **body mentions** are weaker than explicit frontmatter relations
- **linked from types** and **links to types** count **link rows**, not just unique notes
- **Signal details** is there for power users and diagnostics, not because every user should read every row on first glance

**Lifecycle states:**

| State | What it means |
|---|---|
| **Draft** | Very sparse — 1 or fewer non-system fields and no relation links yet |
| **Growing** | Structure is forming but not yet matching what similar notes look like |
| **Consolidated** | Matches ≥74% of the common field pattern for its type, with ≥55% field coverage |
| **Hub** | More inbound links than the vault's hub threshold (average inbound + 1, minimum 3) |
| **Stale** | File not touched in ≥45 days, or a date/deadline field is ≥30 days in the past with no recent activity |

Lifecycle is determined in priority order: Stale beats Hub; Hub beats Consolidated; Consolidated beats Growing; Growing beats Draft. A note that qualifies as both Stale and Hub shows as Stale.

**Likely missing fields**: the Overview tab shows a "Likely missing" section listing fields that appear on most notes of the same type but are absent from this note. Each row shows the field name, what percentage of same-type notes have it, and a relation badge if the field links to other notes. Click the `+` button next to any field to add a stub for it at the end of the frontmatter instantly — Yamlink positions the cursor there and triggers completion for relation fields.

> **Intelligence learning tip**: Yamlink learns from completions you accept. When you press Enter or Tab to accept a relation completion candidate, that acceptance is recorded. Over time, fields you have confirmed as relations are suggested more confidently and earlier. The system never forgets confirmed field relationships even after vault restructuring.

### Links tab

**Incoming relations** — grouped by the field name used to link here. If three missions all have `commander: [[johnny-rico]]`, you see a `commander` group with all three missions listed.

**Outgoing relations** — this note's own frontmatter fields that contain `[[links]]`, one group per field.

Body mentions are still visible, but they are intentionally separated into:

- **body mentions from this note**
- **body mentions to this note**

That separation matters because body mentions are weaker than explicit frontmatter relations.

So the Links tab is now meant to answer three different questions clearly:

- what structured relations leave this note?
- what structured relations point to this note?
- where is this note merely being mentioned in prose?

### Tasks tab 

Shows only the tasks that live inside the currently opened note.

That means:

- no cross-note task pileup
- no `tasks linking here` section
- a cleaner answer to: **what work is written in this note?**

The timeline in this tab is also local:

- the note's own `date:` if present
- dated tasks written in this note

### Views tab 

The Views tab is now deliberately curated to avoid overload.

It shows at most:

- **one suggested next view**
- **one already in note view**

This is intentional. The goal is not to dump every possible recipe. The goal is to answer:

- what is the single most useful view to add next?
- what useful view is already present here?

Click any suggested view to insert the `!view` block directly into the active note.

### What to expect when opening the Note Report for `johnny-rico`

Open `johnny-rico.md`, then run `Yamlink: Open Note Report`.

**Overview tab:**
- ID: `johnny-rico`, Type: `character`
- Role: `person` (inferred from the name field and the character type pattern)
- Lifecycle: `Hub` if the file is recent (5 inbound links, threshold is typically 3); `Stale` if the file is old (≥45 days since last edit)
- Structured inbound: 5 (above vault average — roughnecks, two missions, note-report, table-types all link here)
- Structured outbound: 1 (unit → roughnecks)

**Links tab — Incoming:**

| Field | From note |
|---|---|
| commanding-officer | roughnecks |
| commander | mission-klendathu, mission-tango-urilla |
| subject | note-report |
| owner | table-types |

**Links tab — Outgoing:**

| Field | To note |
|---|---|
| unit | roughnecks |

**Tasks tab:** empty (no checkboxes in `johnny-rico.md`)

**Views tab:** suggested queries for `character` type — likely a "missions commanded by this character" view and a "units this character belongs to" view.

### History tab

The History tab surfaces the structural arc of the note — not edit history from git, but Yamlink's mutation log: when fields were added, when links changed, when lifecycle state shifted.

At the top of the tab, a vertical milestone spine traces the note's lifecycle with color-coded Lucide icons:
- **Note created** (mint) — first appearance in the log or mtime backfill
- **Type established** (lavender) — when `type:` was first set
- **First link** (mint) — when the first `[[wikilink]]` was added to frontmatter
- **Last activity** (amber) — most recent structural change

Each entry in the full log below shows:
- a timestamp
- the mutation type (field added, relation changed, type set, etc.)
- a before/after diff of the frontmatter change

This is most useful for hub notes that evolve over time — you can see how a note was built up across multiple sessions.

### Note Report gets stronger with structure

The more structured a note is, the better the Report:

- `id:` and `type:` let the system infer a role and lifecycle state
- `[[links]]` populate the relation sections
- body wikilinks (repeated 2+ times) surface as promotion hints
- headings, footnotes, and callouts push useful role signals

A note with just `id: foo` and `type: foo` gets a minimal report. A note with full frontmatter, body links, and structured content gets context-aware suggestions.

---

## Using Vault Health

Open with `Yamlink: Open Vault Health`. The panel gives you a full structural snapshot of the vault — not just broken links, but lifecycle maturity, type consistency, and type coverage.

### Tab navigation

Vault Health organizes its content into tabs so you jump directly to the section you need rather than scrolling through the full panel:

| Tab | What you see |
|---|---|
| **Activity** | Notes mutated today, sorted by change count — click any to open it in Note Report |
| **Lifecycle** | Distribution cards for Draft / Growing / Consolidated / Hub / Stale |
| **Consistency** | Type-consistency cards (On Track, Slightly Unusual, Missing Structure, Very Unusual) plus pill list of notes needing attention |
| **Schema** | Per-type conformance coverage, non-conformant notes, unschematized type advisories, dangling relation warnings |
| **Templates** | Notes drifted from their `_templates/` file (only visible when template drift exists) |
| **Types** | Full type catalog with expandable note lists and "View all →" buttons |
| **Orphans** | Unlinked notes (only visible when orphan nodes exist) |

The stats strip cards for **Types**, **Schema**, and **Orphan Nodes** switch to the matching tab when clicked.

### Health score

The score in the top-right card runs 0–100.

| What hurts the score | How much |
|---|---|
| Each broken link | −10 points (capped at −50 total) |
| Orphan ratio (unlinked / total nodes) | up to −30 points |

A vault with 0 broken links and well-connected notes scores 100%. One broken link drops it to ~90%. Orphan nodes reduce it proportionally to how isolated the vault is overall.

This score is intentionally simple. It is not AI. It is just:

- broken links hurt confidence in the vault
- isolated notes suggest weak structure

So the score is a quick cleanliness indicator, not a deep judgment about quality.

### Stats strip

The six cells beneath the header:

| Cell | What it counts |
|---|---|
| **Nodes** | Every note with an `id:` field that was indexed |
| **Edges** | Every directed link in the vault — frontmatter + body `[[wikilinks]]` |
| **Broken Links** | `[[links]]` that point to an `id:` that doesn't exist in the vault |
| **Orphan Nodes** | Notes with no connections at all (no inbound links and no outbound links) |
| **Types** | Unique `type:` values seen across all notes |
| **Schemas** | Notes with `type: schema` — one per governed type |

Plain-language reading:

- **Nodes** = how many real Yamlink notes the vault currently has
- **Edges** = how many note-to-note connections exist
- **Broken Links** = links that point nowhere
- **Orphan Nodes** = notes that are completely isolated
- **Types** = how many different note categories you are using
- **Schemas** = how many of those categories have formal structure definitions

Clicking **Nodes** opens a view of all notes. Clicking **Broken Links** opens the Problems panel. Clicking **Orphan Nodes** switches to the Orphans tab. Clicking **Types** or **Schemas** switches to the matching tab.

Hovering any Vault Health card shows a short tooltip explaining the stat in plain language.

**On the edge count:** the Health panel counts all graph edges including body text links. The graph sidebar shows a rendered subset. If the two numbers differ, this is normal — body links contribute to the Health total but may not render visibly as edges in the graph view depending on your graph display settings.

**On broken links appearing after a reload:** the indexer processes files as they are opened and saved. A broken link from a note you haven't opened yet in this session may not appear until that note is indexed. If you see 0 broken links initially and then 2 after opening additional notes, the newly opened notes contain the broken references.

### Lifecycle States

Yamlink classifies every non-dashboard, non-schema note into one of five lifecycle states based entirely on vault structure — no manual tagging required.

| State | Count means | What drives it |
|---|---|---|
| **Draft** | Notes that are barely started | ≤1 non-system field and no relation links |
| **Growing** | Notes with structure forming | Has fields and/or links but doesn't yet match the common pattern for its type |
| **Consolidated** | Notes that look complete for their type | Matches ≥74% of common fields for the type AND ≥55% field coverage |
| **Hub** | Notes everything else links to | Inbound link count ≥ vault hub threshold (avg inbound + 1, minimum 3) |
| **Stale** | Notes that haven't moved | File not touched in ≥45 days, OR a `date`/`due`/`deadline` field is ≥30 days past with no recent activity |

**Priority:** Stale overrides Hub. Hub overrides Consolidated. Consolidated overrides Growing. Growing overrides Draft.

Plain-language reading:

- **Draft** = barely started
- **Growing** = taking shape
- **Consolidated** = looks complete for its kind
- **Hub** = many other notes point to it
- **Stale** = probably needs review because it has not moved in a while

**Hub threshold** is computed per vault: `max(3, ceiling(average_inbound_count + 1))`. A small vault where most notes have 0–1 inbound links sets the threshold at 3. A denser vault raises it automatically.

**System types** (dashboard, schema, template) are excluded from lifecycle analysis — they are structural notes, not content notes.

The highlights beneath the grid show standout Stale and Hub notes as clickable pills. Click any pill to open that note.

### Type Consistency

Drift measures how far a note's field structure has diverged from what its type normally looks like across the vault.

Plain-language reading:

- this is not about writing quality
- this is about structural consistency
- Yamlink is asking: "does this note still look like the other notes of its type?"

**Minimum requirement:** at least 3 notes of the same `type:` must exist before drift analysis runs. Below that, the vault sample is too small to be meaningful.

**Three signals drive the drift score:**

| Signal | What it detects | Weight |
|---|---|---|
| Missing expected fields | Fields that ≥60% of the same type have, but this note doesn't | +proportional to how common the field is |
| Unusual fields | Fields this note has that <15% of its type have (requires ≥5 same-type notes) | +10 per unusual field |
| Value mismatches | A field that usually holds a `[[wikilink]]` but this note has plain text, or vice versa | +15 per mismatch |

**Drift score → label:**

| Score | Label | Meaning |
|---|---|---|
| 0–19 | On Track | No meaningful deviation from type pattern |
| 20–49 | Slightly unusual | Small gaps — worth a look but not urgent |
| 50–79 | Missing structure | Notable structural divergence from peers |
| 80–100 | Very unusual | Significant departure — likely missing several expected fields |

If this sounds too technical, the easiest interpretation is:

- **On Track** = this note looks normal for its kind
- **Slightly unusual** = a little off-pattern, but not alarming
- **Missing structure** = probably missing something
- **Very unusual** = very different from the rest of its type

Missing structure and Very unusual notes appear as clickable pills in the section. Hovering a pill shows the specific missing fields and the drift score in a tooltip. Click to open the note.

**In the sample vault:** if all your character notes have the same 5 fields and all missions have the same 7 fields, every analyzed note will show as On Track (drift score 0). Drift becomes useful when the vault grows and inconsistency creeps in — a new character note created without `rank:` or `homeworld:` will immediately appear as Missing structure.

**A note about consistency and completion:** when you open a note that is missing expected structure and trigger frontmatter field-name completion, Yamlink surfaces the missing expected fields at the top of the suggestion list — labeled with the percentage of same-type notes that have that field. Type-consistency detection actively assists your editing workflow, not just the health report.

### Schema Conformance

If you have schema notes (notes with `type: schema` that define field shapes for a target type), Vault Health shows per-type conformance coverage.

| Column | What it means |
|---|---|
| **Type** | The `type:` value being analyzed |
| **Coverage** | Percentage of notes of this type that have all required fields from the schema |
| **Non-conformant** | Notes missing one or more required fields |
| **Advisories** | Notes with unexpected extra fields, or fields with wrong value shapes |

The philosophy: schema amplifies, never gates. Schema conformance in Vault Health is diagnostic — it tells you which notes are drifting from the intended structure, but it does not block editing or prevent those notes from appearing in queries. Every Yamlink feature works on zero-schema vaults.

If no schema exists for a type, Vault Health shows an advisory: "no schema defined for this type." This is an invitation, not an error. Define a schema when you want consistent field shapes for that type.

**Dangling relations** are also surfaced here: links from notes of this type to notes that don't exist in the vault. These differ from broken links in that the link target might be a note you intend to create — the conformance panel flags them so you can decide.

### Entity Types

An accordion list of every `type:` value in the vault, ordered by note count. Expand any type to see all its notes as clickable pills. Notes that are orphans within a type are labeled "N unlinked."

The **View all →** button next to each type opens a `!view` query for that type.

### Orphan Nodes

Notes with no edges at all — no `[[links]]` leaving them, and no other note linking to them. These are isolated from the graph entirely.

Dashboard notes are excluded (they are intentionally non-relational). Schema notes are excluded. Only content notes appear here.

### Reading the sample vault in Vault Health

With the Starship Troopers sample vault loaded, the panel should show approximately:

- **Nodes:** ~28
- **Edges:** 50+
- **Broken links:** 0
- **Orphan nodes:** 1 (`blank-test`)
- **Schemas:** 3 (`schema-character`, `schema-mission`, `schema-unit`)
- **Types:** 10+ (`character`, `dashboard`, `mission`, `dossier`, `unit`, `schema`, `lab`, `journal`, etc.)
- **Health score:** 98%

Lifecycle in the sample vault is a little more time-sensitive:

- the structural distribution is stable
- but **Stale** depends on file timestamps and past dates, so it can change depending on when the sample files were last touched
- if older files like `table-types.md` or `tasks-calendar.md` have not been updated recently, they may appear as **Stale** even if their structure is otherwise fine

Drift in the sample vault should remain calm:

- **On Track** should dominate
- **Slightly unusual** may appear on a few notes
- **Missing structure** and **Very unusual** should normally stay at 0 in the clean sample vault

---

## Using the CLI

Yamlink ships with a `yamlink` command that lets you query, inspect, validate, and serve your vault from a terminal — no VS Code required.

### What is a CLI and why does it matter?

A CLI (command-line interface) lets you run Yamlink from a terminal window — that is, any app like Terminal on macOS, PowerShell or Command Prompt on Windows, or a shell in Linux. You type a command, press Enter, and see the output.

This matters because:
- you can script and automate vault operations (CI checks, daily exports, build pipelines)
- you can use Yamlink in contexts that don't have VS Code (servers, other editors, build systems)
- you can pipe results into other tools like `jq`, spreadsheets, or your own scripts

### Setup

```bash
# Run once from the yamlink project folder
npm link
```

This makes `yamlink` available as a command anywhere in your terminal. After that, point it at any vault with `--vault`, or run it from inside the vault folder and omit the flag.

**Windows note:** Run PowerShell or Command Prompt as normal. If `yamlink` is not recognized after `npm link`, try restarting your terminal.

### All commands at a glance

| Command | What it does |
|---|---|
| `yamlink build` | Index the vault, report all broken links and duplicate IDs. Exits with error code 1 if issues are found — use this in CI. |
| `yamlink health` | Structural overview: note count by type, lifecycle distribution, orphans, drift. |
| `yamlink validate` | Schema conformance check: which notes are missing required fields, dangling relations, unschematized types. |
| `yamlink query "<clause>"` | Run a `!view`-compatible query and print results in the terminal. |
| `yamlink report <id>` | Full note report: lifecycle, drift, all in/out links grouped by field. |
| `yamlink links <id>` | Outbound and inbound links for a single note. |
| `yamlink serve` | Start a local HTTP API server so other tools can read your vault. |
| `yamlink export` | Dump vault data to JSON or CSV. |

### Commands in detail

#### `yamlink build`

```bash
yamlink build --vault ~/my-vault
yamlink build --vault ~/my-vault --json
```

Indexes the entire vault and reports structural issues:
- broken links (wikilinks pointing to IDs that don't exist)
- duplicate IDs (two notes with the same `id:` field)

If it finds any issues, it exits with code 1. This is what you want in CI — a broken vault fails the build.

```bash
# In a CI script (GitHub Actions, etc.)
yamlink build --vault ./vault  # exits 1 if broken
```

The `--json` flag gives you machine-readable output for downstream processing.

#### `yamlink health`

```bash
yamlink health --vault ~/my-vault
yamlink health --vault ~/my-vault --json
```

Shows a structural overview: note count by type, broken links, orphan nodes, and lifecycle state distribution. Good for a quick vault sanity check.

#### `yamlink validate`

```bash
yamlink validate --vault ~/my-vault
yamlink validate --vault ~/my-vault --json
```

Checks schema conformance: which notes are missing required fields defined by your schema notes, which types have no schema at all, and which links are dangling (point to notes that don't exist yet).

Exits with code 1 if it finds non-conformant notes or dangling relations, so you can use it as a CI gate.

Schema-free vaults are fine — `yamlink validate` will just report that no schemas are defined and exit cleanly.

#### `yamlink query "<clause>"`

```bash
yamlink query "where type = character" --vault sample
yamlink query "where type = mission sort date desc" --vault sample
yamlink query "!view character select id, rank, status" --vault sample
yamlink query "where type = character" --vault sample --json
```

Runs a vault query using the same language as `!view` blocks inside notes.

- Bare clauses like `"where type = contact"` are auto-wrapped — you don't need to write `!view *` yourself
- Full `!view` format also works: `"!view character where status = active"`
- Select fields can be comma-separated or space-separated: `"select id, name, status"` and `"select id name status"` are equivalent

#### `yamlink report <id>`

```bash
yamlink report johnny-rico --vault sample
yamlink report johnny-rico --vault sample --json
```

Shows the full note report in the terminal: type, lifecycle state, structural drift, and all outbound/inbound links grouped by relation field — the same data as the Note Report panel.

#### `yamlink links <id>`

```bash
yamlink links johnny-rico --vault sample
```

Lists the note's outbound links (with `⚠` markers for broken targets) and inbound links in formatted tables. Faster than opening the Note Report just to check connectivity.

#### `yamlink serve`

```bash
yamlink serve --vault ~/my-vault
yamlink serve --vault ~/my-vault --port 4000
```

Starts a local HTTP server that exposes your vault as a REST API. Default port is 3000. The server watches for `.md` file changes and rebuilds the index automatically — no restart needed.

**Endpoints:**

| Endpoint | What it returns |
|---|---|
| `GET /api/nodes` | All indexed notes (id, type, fields) |
| `GET /api/nodes/:id` | A single note by ID |
| `GET /api/query?q=<clause>` | Query results — same syntax as `!view` |
| `GET /api/graph` | Graph edges (from, to, field) |
| `GET /api/types` | All `type:` values seen in the vault |
| `GET /api/health` | Structural stats (broken links, lifecycle, etc.) |

**Using `yamlink serve` as a CMS backend:**

This is the main reason to use `serve`. Your vault becomes the data layer for any web framework:

```js
// In a Next.js or Astro build script
const res = await fetch('http://localhost:3000/api/query?q=where type = post');
const { rows } = await res.json();
// rows is your list of blog posts, from your Markdown vault
```

Your notes become pages. Frontmatter becomes metadata. Wikilinks resolve to URLs. You write content in your editor, the site reads it from the local API at build time.

#### `yamlink export`

```bash
yamlink export --vault ~/my-vault --format json
yamlink export --vault ~/my-vault --format csv
yamlink export --vault ~/my-vault --format csv --output ~/backup.csv
yamlink export --vault ~/my-vault --query "where type = contact" --format csv
```

Dumps vault data to JSON or CSV.

- `--format json` (default) — full structured output including all frontmatter fields
- `--format csv` — flat CSV with all fields; wikilinks are unwrapped to bare IDs
- `--output <file>` — write to a file instead of printing to the terminal
- `--query "<clause>"` — filter results before exporting

### JSON output

Most commands accept `--json` for machine-readable output that you can pipe into other tools:

```bash
yamlink health --vault ~/my-vault --json
yamlink build --vault ~/my-vault --json
yamlink query "where type = character" --vault sample --json
yamlink report johnny-rico --vault sample --json
```

### Practical examples

**CI pipeline (GitHub Actions):**

```yaml
- name: Validate vault
  run: |
    yamlink build --vault ./vault       # fails if broken links exist
    yamlink validate --vault ./vault    # fails if schema violations exist
```

**CRM workflows:**

```bash
# Daily check: any contacts missing a follow-up date?
yamlink query "!view contact where date is empty" --vault ~/crm

# Export contacts to CSV for a spreadsheet
yamlink export --vault ~/crm --query "where type = contact" --format csv --output contacts.csv

# Vault health check
yamlink health --vault ~/crm --json
```

**Engineering project tracker:**

```bash
# Open bugs for a specific project
yamlink query "where type = bug and project = [[project-yamlink]] and status != fixed" --vault ~/notes

# Full report on a decision note
yamlink report decision-graph-right-rail --vault ~/notes

# All inbound links to a project hub
yamlink links project-yamlink --vault ~/notes
```

**Publishing use case (vault as CMS):**

```bash
# Start the API server
yamlink serve --vault ~/my-site-content --port 3000

# In another terminal, start your web framework
npm run dev   # Next.js, Astro, etc. fetches from localhost:3000
```

**Scripting pipelines:**

```bash
# Export all character notes as JSON
yamlink export --vault sample --query "where type = character" --format json > characters.json

# Check for broken links before committing
yamlink build --vault . --json
```

### What the CLI enables

The CLI calls the same pure engine that powers the VS Code extension — same indexing, same query language, same intelligence layer. This means:

- vault query results from the terminal match what you see in `!view` tables in the editor
- health and lifecycle data matches what Vault Health shows
- the `--json` flag feeds the same structured data into any downstream tool
- `yamlink serve` opens Yamlink to any tool that can make an HTTP request

---

## Best Commands To Learn First

| Command | What it does |
|---|---|
| `Yamlink: Open Home` | Open the Home panel — vault pulse, activity feed, continue working, nudges |
| `Yamlink: Create Note` | Create a new note with frontmatter (uses template → schema → vault inference) |
| `Yamlink: New Note from Template` | Pick a template and create a note with its field shape |
| `Yamlink: New Note from Schema` | Pick a schema type and create a structured note from its field definitions |
| `Yamlink: Insert View Block` | Insert a `!view` query — shows smart starters for the current note |
| `Yamlink: Query in Plain English` | Type plain English; Yamlink generates the `!view` syntax and inserts it |
| `Yamlink: Refine View Block` | Edit an existing view block's label, sort, filter, or limit |
| `Yamlink: Run Views in Current File` | Execute all `!view` blocks in the current note |
| `Yamlink: Open Note Report` | See relations, tasks, timeline, and suggestions for the current note |
| `Yamlink: Open Calendar` | Month / week / day view of dated notes and tasks |
| `Yamlink: Open Vault Health` | Broken links, duplicate IDs, schema violations |
| `Yamlink: Import Obsidian Vault` | Bring an existing Obsidian vault into the workspace and rebuild the Yamlink index |
| `Yamlink: Open Graph` | Sidebar graph — ambient vault constellation |
| `Yamlink: Open Graph Workspace` | Graph Workspace centered on the active note |
| `Yamlink: Open Vault Graph` | Graph Workspace in vault-wide constellation mode |
| `Yamlink: Export Active Note to PDF` | Export current note or its live views to PDF |
| `yamlink build` | Terminal: index vault and report broken links / duplicate IDs — exits 1 in CI if issues found |
| `yamlink health` | Terminal: vault overview (broken links, lifecycle, types) |
| `yamlink validate` | Terminal: schema conformance check — missing required fields, dangling relations |
| `yamlink query "<clause>"` | Terminal: run a `!view`-compatible query and see results |
| `yamlink report <id>` | Terminal: full note report with links, lifecycle, and drift |
| `yamlink links <id>` | Terminal: outbound and inbound links for a note |
| `yamlink serve` | Terminal: start a local HTTP API server so websites can read vault data |
| `yamlink export` | Terminal: dump vault to JSON or CSV |

---

## Keyboard Shortcuts Inside Yamlink Surfaces

### Graph

Both graph surfaces (sidebar and Graph Workspace) use the same interactions:

- **Hover** a node — info card appears (label, type, lifecycle, link count); connected nodes highlight
- **Click** a node — opens the note in the editor
- **Click and drag** a node — repositions it; physics responds in real time; release to settle
- **Drag the canvas** — pan the view
- **Scroll wheel** — zoom in / out
- **Double-click the canvas** — fit all nodes into view
- **Semantic** button — toggle edge colouring by relation type
- **Health** button — toggle lifecycle/drift rings on nodes
- **Fit** button — fit all visible nodes into the panel

### Calendar

- `M` month mode
- `W` week mode
- `D` day mode
- `[` move backward
- `]` move forward
- `T` jump to today

### Note Report

- open the current note's report from the command palette or the lightbulb
- the report is strongest when notes have:
  - `id:`
  - `type:`
  - clear `[[links]]`
  - useful body structure like headings, quotes, and footnotes
- Yamlink uses the report to show:
  - likely note role
  - nearby or related notes
  - likely missing fields
  - suggestions that fit this note's context

### What Calendar Currently Tracks

Calendar is not only for checkbox tasks.

It currently uses:

- dated tasks in note bodies
- frontmatter `date:`
- frontmatter `created:`

So a note can appear in Calendar because:

- it has a dated task
- the note itself has a `date:`
- the note has a `created:` value

This means Calendar is already a lightweight activity + milestone surface, not just a task list.

### Tables

- double-click editable cells to edit
- click a boolean cell twice to toggle it
- click the `done` column in a tasks table to toggle the checkbox in the file
- `Tab` / `Shift+Tab` move across editable cells
- paste spreadsheet ranges directly into selected cells
- `Ctrl/Cmd+Z` undo recent table edits

**Matrix view** — any `!view` table has a layout toggle in the toolbar: **Table** | **Matrix**. Switch to Matrix to turn the results into a two-axis grid: rows are the query results, columns are a vault type you pick, and each cell shows a dot (●) if a connection exists. The query is the same — only the rendering changes. This is useful for seeing, for example, which characters appear in which missions at a glance, without writing a separate query.

---

## What To Open First In A Real Vault

If you are new to Yamlink, I would recommend this order:

1. `welcome.md` in the sample vault
2. `dashboard.md`
3. `query-shortcuts.md`
4. `note-report.md`
5. `tasks-calendar.md`
6. `table-types.md`

---

## If You Want A Simple Starter Rule

Use this:

- every important note gets `id:` and `type:`
- every important relationship becomes a `[[link]]`
- every repeated list becomes a `!view`

That alone gets you most of Yamlink.
