---
id: dashboard
type: dashboard
created: 2297-11-01
---

# Bug War — Field Intelligence Dashboard

Active data from the Roughnecks' operational history. Open this file and click **▶ Run views** in the status bar.

---

## Personnel

!view character | All Personnel
select name, rank, unit, status
sort rank

!view character | Roughnecks Only
select name, rank, homeworld
where unit = [[roughnecks]]
sort rank

---

## Operations

!view mission | All Missions
select date, commander, outcome, casualties
sort date

!view mission | High Casualties
select date, unit, commander, outcome
where casualties = very-high
sort date desc

---

## Intelligence

!view mission | Missions with Bug Intelligence
select date, commander, notes
where notes contains brain
sort date

!view character | Active Personnel
select name, rank, unit
where status = active
sort name

---

## Recent Activity

!view * | Recently Modified
where file.modified >= today()
select id, type, file.modified
sort file.modified desc

!view * | Notes Added This Month
where file.created >= 2026-05-01
select id, type, file.created
sort file.created desc

---

## Tasks

!view open-tasks | Open Tasks

!view overdue | Overdue

!view upcoming | Upcoming

---

## Try: Natural Language Query

Run `Yamlink: Query in Plain English` from the command palette. Examples that work in this vault:

- "missions commanded by johnny-rico"
- "active characters"
- "missions with very-high casualties"
- "characters without a status"
- "recent missions"

The generated `!view` block is shown for your review before insertion.

---

## Try: Matrix View

Run the Personnel table above, then click **Matrix** in the toolbar. Choose `unit` as the column type to see which characters belong to which units as a grid.

---

*Last updated after Tango Urilla. All data reflects field reports only.*
