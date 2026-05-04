# Yamlink Getting Started

This guide is for people who want to get productive with Yamlink quickly.

It focuses on:

- how to structure a vault
- how to think about IDs, links, and queries
- how to use templates and the query builder day to day
- what a good CRM setup looks like
- what a good programmer / project-tracker setup looks like

Use this together with:

- [README.md](./README.md) for the product overview
- [FEATURES.md](./FEATURES.md) for the full capability reference

---

## The Core Idea

Yamlink works best when you treat Markdown notes as structured records:

1. give important notes an `id:`
2. give them a `type:`
3. relate them with `[[wikilinks]]`
4. query them with `!view`

That is the system.

---

## Recommended First Steps

### 1. Create 3-5 notes with frontmatter

The fastest way is `Yamlink: New Node from Template` if you have templates set up. Otherwise `Yamlink: Create Node` generates a minimal frontmatter stub.

Example note:

```yaml
---
id: contact-jane-doe
type: contact
name: Jane Doe
company: [[account-acme]]
status: active
date: 2026-04-08
---
```

### 2. Link them to each other

Use body links or frontmatter relation links:

```yaml
company: [[account-acme]]
owner: [[person-javier]]
```

```md
Met with [[contact-jane-doe]] about the [[deal-acme-expansion]] opportunity.
```

### 3. Add a query block to a dashboard note

Type `!view` in a note and use `Yamlink: Insert View Block` — or write the query directly:

```md
!view contact | Active contacts
where status = active
select name, company, owner, date
sort date desc
```

### 4. Open the side surfaces

Use:

- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Vault Health`
- `Yamlink: Vault Graph`

---

## Templates

Templates are `.md` files in a `_templates/` folder at your workspace root. They define the frontmatter shape for a note type, with empty fields that get filled in when you create a note from the template.

### Creating your first template

Run `Yamlink: New Node from Template`. If no templates exist yet, Yamlink will offer to create the `_templates/` folder with a starter `contact.md` template and open it for you to edit.

### Template structure

A template is a regular Markdown file with frontmatter. Leave `id:` and `created:` empty — Yamlink fills them on creation. Leave relation fields as `[[]]` to mark where a link belongs.

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

Run `Yamlink: New Node from Template`. The picker shows each template's type and its field names so you can choose without opening the file first. After you enter the new note's ID, Yamlink creates the file, fills in `id:` and `created:`, opens the note, and positions your cursor on the first empty field ready to type.

### Type-matched templates at note creation

When you run `Yamlink: Create Node` and choose a type, Yamlink automatically checks for `_templates/<type>.md`. If it exists, the new note is created from that template instead of a blank stub.

### Good template habits

- One template per type you use regularly
- Name the template file exactly after the type: `contact.md` for `type: contact`
- Keep default values in the template (e.g. `status: active`, `species: human`) so new notes start in the right state
- Use `[[]]` as the value for relation fields you always fill in — it signals that a link is expected there

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

### Refine an existing view

Position your cursor on any `!view` block and use `Yamlink: Refine This View` (or the lightbulb → Refine this view) to change the label, sort, limit, or filter without rewriting the block from scratch.

### Query reference

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
id: account-acme
type: account
name: Acme Corp
status: active
owner: [[person-javier]]
segment: enterprise
date: 2026-04-08
---
```

#### Contact

```yaml
---
id: contact-jane-doe
type: contact
name: Jane Doe
account: [[account-acme]]
owner: [[person-javier]]
role: buyer
status: active
date: 2026-04-08
---
```

#### Deal

```yaml
---
id: deal-acme-expansion
type: deal
name: Acme Expansion
account: [[account-acme]]
contact: [[contact-jane-doe]]
owner: [[person-javier]]
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
- create a `_templates/contact.md`, `_templates/account.md`, etc. so new records start consistently

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
owner: [[person-javier]]
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
owner: [[person-javier]]
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
- add a schema note for your main types so Yamlink can infer relation targets automatically

---

## Best Commands To Learn First

| Command | What it does |
|---|---|
| `Yamlink: Create Node` | Create a new note with frontmatter (uses template if one exists for the chosen type) |
| `Yamlink: New Node from Template` | Pick a template and create a note with its field shape |
| `Yamlink: Insert View Block` | Insert a `!view` query — shows smart starters for the current note |
| `Yamlink: Refine This View` | Edit an existing view block's label, sort, filter, or limit |
| `Yamlink: Run Views in Current File` | Execute all `!view` blocks in the current note |
| `Yamlink: Open Note Report` | See relations, tasks, timeline, and suggestions for the current note |
| `Yamlink: Open Calendar` | Month / week / day view of dated notes and tasks |
| `Yamlink: Open Vault Health` | Broken links, duplicate IDs, schema violations |
| `Yamlink: Vault Graph` | Visual graph of all note connections |
| `Yamlink: Export Active Note to PDF` | Export current note or its live views to PDF |

---

## Keyboard Shortcuts Inside Yamlink Surfaces

### Graph

- `/` focus search
- `F` fit visible graph
- `R` reset graph state
- `L` toggle edge labels
- `N` focus the active note
- `O` open the selected node's note
- `Esc` clear the current graph state

### Calendar

- `M` month mode
- `W` week mode
- `D` day mode
- `[` move backward
- `]` move forward
- `T` jump to today

### Tables

- double-click editable cells to edit
- click a boolean cell twice to toggle it
- click the `done` column in a tasks table to toggle the checkbox in the file
- `Tab` / `Shift+Tab` move across editable cells
- paste spreadsheet ranges directly into selected cells
- `Ctrl/Cmd+Z` undo recent table edits

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

## Good Working Habits

- keep IDs machine-friendly and stable
- use `name` or `title` for human labels
- keep key operational fields in frontmatter
- use body text for narrative detail
- query from dashboard notes instead of trying to turn every note into a dashboard
- prefer a few clear note types over too many vague ones
- use `_templates/` for every type you create more than once

---

## If You Want A Simple Starter Rule

Use this:

- every important note gets `id:` and `type:`
- every important relationship becomes a `[[link]]`
- every repeated list becomes a `!view`

That alone gets you most of Yamlink.
