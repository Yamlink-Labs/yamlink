---
id: supply-requisition-charlie
type: field-report
name: Supply Requisition — Charlie Squad
unit: "[[roughnecks]]"
date: 2297-11-25
priority: low
budget: 4000
approved: true
---

Charlie Squad's requisition — written to put every formula-engine capability added since Alpha and Bravo through its paces: statistics, finance, growth, date math, and logical functions in both their keyword and function-call forms.

## Strength

Squad size at deployment: `squad_size=11`
Casualties: `casualties=2`
Replacements received: `replacements=3`
Effective strength: `effective_strength=squad_size-casualties+replacements`

## Ammo cost analysis (statistics)

Per-crate cost samples, eight requisitions back:
`=42` `=38` `=45` `=41` `=39` `=50` `=41` `=44`

Typical cost (median): `typical_cost=median(Y5:Y12)`
Most common cost (mode): `common_cost=mode(Y5:Y12)`
How much costs vary (sample stdev): `cost_spread=stdev(Y5:Y12)`
Variance: `cost_variance=variance(Y5:Y12)`

## Transport pod upgrade (finance)

Investment required: `investment=20000`
Annual fuel/maintenance savings: `annual_savings=6000`
Present value of five years of savings at an 8% discount rate: `savings_npv=npv(0.08, annual_savings, annual_savings, annual_savings, annual_savings, annual_savings)`
Net value after the upfront cost: `net_value=savings_npv-investment`
Break-even rate of return: `payback_rate=irr(-investment, annual_savings, annual_savings, annual_savings, annual_savings, annual_savings)`
Worth it: `worth_it=net_value>0`

## Budget growth (growth)

Budget four years ago: `budget_then=3000`
Budget today (frontmatter): `budget_now=budget`
Steady annual growth rate needed to get from one to the other: `budget_cagr=cagr(budget_then, budget_now, 4)`

## Deadline tracking (date functions)

Requisition deadline: `deadline=date(2297,12,1)`
Days until deadline (from the frontmatter `date` field): `days_left=days_between(date, deadline)`
Status: `deadline_status=if(days_left<0, "OVERDUE", "ON TRACK")`
Extended deadline, two more weeks: `extended_deadline=add_days(deadline, 14)`

## Mission readiness (logical functions — keyword form, function-call form, and explicit grouping)

Requested budget for this cycle: `requested=3800`
Over the approved budget: `over_budget=requested>budget`

Ready via keyword form: `ready_keyword=effective_strength>=10 and not over_budget`
Ready via function-call form: `ready_calls=and(effective_strength>=10, not(over_budget))`
Ready with explicit parenthesized grouping: `ready_grouped=(effective_strength>=10) and (not over_budget)`
All three forms agree: `all_agree=ready_keyword==ready_calls and ready_calls==ready_grouped`

## Vault-wide totals (aggregate — across every field-report note, not just this one)

!view field-report
aggregate sum(cell.effective_strength) as total_strength, average(cell.effective_strength) as avg_strength, min(cell.effective_strength) as weakest, max(cell.effective_strength) as strongest, count

## Chart by priority (switch to Bar or Pie — plot the aggregate, not just row count)

!view field-report
group by priority
aggregate sum(cell.effective_strength) as total_strength
