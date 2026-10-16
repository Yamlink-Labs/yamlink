---
id: supply-requisition-alpha
type: field-report
name: Supply Requisition — Alpha Squad
unit: [[roughnecks]]
date: 2297-11-23
priority: high
budget: 5000
approved: true
---

Follow-up requisition after the Tango Urilla tally, cross-checked against the original supply log.

## Supply tally (ranges)

Rifles: `=40`
Grenades: `=15`
Medkits: `=8`
Total supplies: `=sum(Y1:Y3)`
Average per category: `=average(Y1:Y3)`

## Strength (same shape as the original tally — reinforces the vault-learned formula pattern for `field-report` notes)

Squad size at deployment: `squad_size=12`
Casualties: `casualties=3`
Replacements received: `replacements=5`
Effective strength: `effective_strength=squad_size-casualties+replacements`

## Reading our own frontmatter

Priority (string, straight from frontmatter): `priority_cell=priority`
Approved (boolean, straight from frontmatter): `approved_cell=approved`
Requested spend: `requested=4200`
Remaining budget (reads `budget` from frontmatter directly): `remaining=budget-requested`
Over budget: `over_budget=requested>budget`
Status: `status_label=if(over_budget, "OVER BUDGET", "within budget")`

## Cross-note reference

Compare to the original Tango Urilla tally:

Previous effective strength: `previous=[[roughnecks-supply-log]]^effective_strength`
Strength change: `strength_change=effective_strength-previous`
Strength holding steady or better: `strength_holding=effective_strength>=previous`

## Display formatting

Requested spend, formatted: `=requested as currency`
Approval confidence, formatted: `=0.84 as percent`

## Query — pull it all back

!view field-report
select name, cell.effective_strength, cell.over_budget, cell.status_label
sort cell.effective_strength desc
