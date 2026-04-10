# Yamlink Getting Started

This guide is for people who want to get productive with Yamlink quickly.

It focuses on:

- how to structure a vault
- how to think about IDs, links, and queries
- how to use Yamlink day to day
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

Example:

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

## Recommended Setup: CRM

If your main use is CRM, I would recommend starting with these note types:

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

---

## Recommended Setup: Programmer / Project Tracker

If your main use is engineering work, I would recommend starting with:

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

---

## Query Structure

Yamlink queries live directly in notes.

### Basic

```md
!view contact
```

### With a custom tab label

```md
!view contact | Active contacts
```

### Common clauses

- `select`
- `where`
- `contains`
- `sort`
- `limit`
- `via`

### Example

```md
!view deal | Open deals
where account = [[account-acme]]
select name, owner, stage, value, date
sort date desc
limit 10
```

### Incoming query

```md
!view incoming meeting
via account
select date, title
sort date desc
```

### Shortcuts

```md
!view today
!view upcoming
!view calendar
!view open-tasks
!view done-tasks
!view overdue
!view undated-tasks
```

---

## Date and Task Usage

### Best practice

Use canonical dates in frontmatter:

```text
YYYY-MM-DD
```

Example:

```yaml
date: 2026-04-08
```

### Task date parsing

Yamlink can now extract dates from task text such as:

- `26/03/2026`
- `March 26, 2026`
- `tomorrow`
- `Friday`
- `next Monday`
- `end of month`

Example:

```md
- [ ] Call Jane tomorrow
- [ ] Send proposal Friday
- [ ] Review pipeline next Monday
```

Those dates can then appear in:

- Calendar
- Note Report
- task-oriented shortcut queries

---

## Best Commands To Learn First

- `Yamlink: Create Node`
- `Yamlink: New Node from Template`
- `Yamlink: Query Builder`
- `Yamlink: Run Views in Current File`
- `Yamlink: Open Note Report`
- `Yamlink: Open Calendar`
- `Yamlink: Open Vault Health`
- `Yamlink: Vault Graph`
- `Yamlink: Export Active Note to PDF`

---

## Keyboard Shortcuts Inside Yamlink Surfaces

### Graph

- `/` focus search
- `F` fit visible graph
- `R` reset graph state
- `L` toggle edge labels
- `N` focus the active note
- `O` open the selected node’s note
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

Current sample files are still demo-oriented. Dedicated sample vaults for:

- CRM
- programming / project tracking

should be added as a future improvement.

---

## Good Working Habits

- keep IDs machine-friendly and stable
- use `name` or `title` for human labels
- keep key operational fields in frontmatter
- use body text for narrative detail
- query from dashboard notes instead of trying to turn every note into a dashboard
- prefer a few clear note types over too many vague ones

---

## If You Want A Simple Starter Rule

Use this:

- every important note gets `id:` and `type:`
- every important relationship becomes a `[[link]]`
- every repeated list becomes a `!view`

That alone gets you most of Yamlink.
