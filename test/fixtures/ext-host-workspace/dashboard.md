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

## Intelligence Notes

!view mission | Missions with Bug Intelligence
select date, commander, notes
where notes contains brain
sort date

---

*Last updated after Tango Urilla. All data reflects field reports only.*