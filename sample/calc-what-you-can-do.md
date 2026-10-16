---
id: calc-what-you-can-do
type: guide
name: What the Formula Groups Are For
budget: 4000
spent: 3800
due: 2297-12-10
---

Each formula is written inside backticks and starts with an equals sign. Yamlink works out the answer and shows it in place. Hover a formula to see how the answer was reached.

Rates are typed as decimals (8% is 0.08). Adding `as percent` or `as currency` at the end of a formula changes how the answer is displayed, not the number itself.

## The data

Eight crate prices from recent supply runs:

`=42` `=38` `=45` `=41` `=39` `=50` `=41` `=44`

Their cells are called Y1 to Y8, in that order. The formulas below refer to them.

Total of all eight: `=sum(Y1:Y8) as currency`

## 1. Statistics: what is a typical price?

Use these when you have a list of numbers and want to know what is normal and how much it varies.

- **Typical price (median):** `typical=median(Y1:Y8) as currency`
  The middle value when the list is sorted. Unlike the average, one very expensive crate does not pull it up.
- **Most common price (mode):** `common=mode(Y1:Y8) as currency`
  The price that appears most often. If nothing repeats, Yamlink says so instead of guessing.
- **How much prices vary (standard deviation):** `spread=stdev(Y1:Y8)`
  How far a typical price sits from the average. A small number means predictable prices. A large number means budget a buffer.

Try it: change one price above (for example 50 to 90). The median barely moves, while the spread jumps.

## 2. Finance: is a purchase worth it?

Use these to compare money now with money later.

A pod upgrade costs 20,000 today and saves 6,000 a year for five years:

- Upfront cost: `cost=20000 as currency`
- Yearly savings: `save=6000 as currency`
- **Five years of savings, worth today at 8%:** `today_value=npv(0.08, save, save, save, save, save) as currency`
- **Net gain after paying the upfront cost:** `gain=today_value-cost as currency`
- **Return the upgrade earns (IRR):** `payback=irr(-cost, save, save, save, save, save) as percent`

Other finance functions, same idea:

- **Monthly loan payment:** 10,000 borrowed at 6% a year over 5 years: `monthly=pmt(0.005, 60, 10000) as currency`. A negative result means money going out.
- **Savings growth:** 100 put in every year for 10 years at 5%: `in_ten=fv(0.05, 10, -100) as currency`

Try it: change `save` in the return line to 4000. The return drops, and once the savings can no longer cover the upfront cost, the net gain turns negative.

## 3. Growth: how fast did it grow?

Use this to turn "it went from A to B over N years" into one steady yearly rate.

- Budget four years ago: `then=3000 as currency`
- Budget now (read from this note's `budget` field): `now=budget as currency`
- **Steady yearly growth:** `growth=cagr(then, now, 4) as percent`

Try it: change `budget` in this note's frontmatter. The growth rate updates on its own.

## 4. Dates: how long until something is due?

A date in a formula is written `YYYY-MM-DD`. Dates compare correctly with `<` and `>` without any special handling.

- Due date (read from this note's `due` field): `due`
- **Two weeks after the due date:** `deadline_plus=add_days(due, 14)`
- **Days between the two dates:** `gap=days_between(due, deadline_plus)`
- **Status against today:** `status=if(due < today(), "overdue", "on track")`
- **Days left from today:** `days_left=days_between(today(), due)`

This story is set in the year 2297, while today is a real calendar date, so the days-left count is very large. For a realistic countdown, change `due` to a date a few days from now.

Try it: change `due` to 2000-01-01. The status changes to "overdue" immediately.

## 5. Logic: yes or no decisions

Use these to turn numbers into a decision that updates by itself.

- Money spent so far (from frontmatter): `spent`
- Budget (from frontmatter): `budget`
- **Over budget?** `over=spent>budget`
- **How much is left:** `left=budget-spent as currency`
- Squad strength: `strength=12`
- **Ready to deploy (function form):** `ready=and(strength>=10, not(over))`
- **Same check, keyword form:** `ready_too=strength>=10 and not over`
- **Message:** `message=if(over, "request more budget", "fine to proceed")`
- **Safe division:** `per_person=if(strength != 0, 1000/strength, 0) as currency`. The `if()` guard means a strength of zero gives 0 instead of an error.

Try it: set `spent` in the frontmatter to 4500. `over` becomes true, `message` changes, and `left` goes negative.

## 6. Named ranges and conditions

Give a run of cells a name, then use the name anywhere a list is expected:

- Name the eight prices: `prices=Y1:Y8`
- Median of the named prices: `named_median=median(prices) as currency`
- How many prices are above 40: `above_count=countif(prices, ">40")`
- Total of the prices above 40: `above_total=sumif(prices, ">40") as currency`
- Average of the prices below 40: `below_avg=averageif(prices, "<40") as currency`

The criterion is written in quotes: `">40"`, `"<=10"`, `"<>0"`, or a plain value such as `"high"`.

Try it: change one price in the data block above and watch the counts and totals move.

## Quick reference

| Question | Use |
|---|---|
| What is normal? | median, mode |
| How much does it vary? | stdev |
| Is it worth paying now? | npv, irr |
| What is the monthly payment? | pmt |
| How fast is it growing? | cagr |
| How long until it is due? | days_between, add_days |
| Should we proceed? | and, or, not, if |
