---
id: supply-requisition-foxtrot
type: field-report
name: Supply Requisition — Foxtrot (Sky Patrol)
unit: Sky Patrol
date: 2297-12-02
priority: medium
budget: 3500
squad_size: 8
casualties: 0
replacements: 1
---

Supply requisition for Sky Patrol. Effective strength and cost are calculated below.

Effective strength: `effective_strength=squad_size-casualties+replacements`

Cost to resupply (budget less effective strength × 150): `cost=budget-effective_strength*150`
