---
id: roughnecks-supply-log
type: field-report
name: Roughnecks Supply Log
unit: [[roughnecks]]
date: 2297-11-22
---

Post-Tango Urilla headcount and resupply tally, filed by squad logistics.

## Strength Report

Squad size at deployment: `squad_size=12`
Casualties: `casualties=3`
Replacements received: `replacements=5`
Effective strength: `effective_strength=squad_size-casualties+replacements`

## Query — pull the numbers back out

!view field-report
select name, cell.squad_size, cell.casualties, cell.effective_strength
where cell.effective_strength > 0
sort cell.effective_strength desc
