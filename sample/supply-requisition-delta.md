---
id: supply-requisition-delta
type: field-report
name: Supply Requisition — Delta (Sky Patrol)
unit: Sky Patrol
date: 2297-11-27
priority: high
budget: 6000
squad_size: 9
casualties: 1
replacements: 0
---

Supply requisition for Sky Patrol. Effective strength and cost are calculated below.

Effective strength: `effective_strength=squad_size-casualties+replacements`

Cost to resupply (budget less effective strength × 150): `cost=budget-effective_strength*150`
