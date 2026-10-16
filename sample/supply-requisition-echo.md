---
id: supply-requisition-echo
type: field-report
name: Supply Requisition — Echo (Tango Squad)
unit: Tango Squad
date: 2297-11-29
priority: low
budget: 2500
squad_size: 10
casualties: 4
replacements: 2
---

Supply requisition for Tango Squad. Effective strength and cost are calculated below.

Effective strength: `effective_strength=squad_size-casualties+replacements`

Cost to resupply (budget less effective strength × 150): `cost=budget-effective_strength*150`
