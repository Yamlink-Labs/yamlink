---
id: supply-requisition-bravo
type: field-report
name: Supply Requisition — Bravo Squad
unit: [[roughnecks]]
date: 2297-11-24
priority: medium
budget: 3000
approved: false
---

A second squad's requisition, filed the same day — same formula shape as Alpha's, reinforcing the vault-learned pattern Yamlink now suggests for `field-report` notes.

## Strength

Squad size at deployment: `squad_size=13`
Casualties: `casualties=1`
Replacements received: `replacements=2`
Effective strength: `effective_strength=squad_size-casualties+replacements`

`=squad_size*replacements`


## Budget check

Requested spend: `requested=3500`
Remaining budget: `remaining=budget-requested`
Over budget: `over_budget=requested>budget`
Status: `status_label=if(over_budget, "OVER BUDGET", "within budget")`

## Charts — grouped (try Bar or Pie layout in the View Panel)

!view field-report
select name, cell.effective_strength, cell.over_budget
group by over_budget

## Charts — ungrouped, numeric + date (try Scatter or Line layout)

!view field-report
select name, date, cell.effective_strength
sort date asc
