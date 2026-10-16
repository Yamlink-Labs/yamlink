# Calculations

Write real arithmetic directly inside a note — no grid, no separate spreadsheet file, just your text with one explicit marker. Yamlink computes it live, the same way a spreadsheet does, with Excel-style references between calculations. Refrence and call all your results accross your vault for your own personal "computational workspace".

## The basics

Write an inline code span whose content starts with `=`:

```
The total comes to `=1 + 2(3+4)^2` before tax.
```

Yamlink shows the result right after it (`= 99`), updating as you type. An incomplete or invalid expression shows an honest `= ?` instead of a guess. Nothing outside this exact `` `=...` `` shape is touched — an ordinary code span like `` `npm install` `` is left completely alone.

Standard math works as expected: `+ - * / ^ %`, parentheses, and implicit multiplication (`2(1+1/14)` needs no `*` between the 2 and the parenthesis).

## Four ways to pull in a number

**1. An earlier calculation in the same note** — by name or by its automatic label:

```
Subtotal: `subtotal=price*quantity`
Total: `=subtotal*1.08`
```

Every calculation also gets an automatic `Y1`, `Y2`, `Y3`... label in the order it appears, whether you name it or not — `` `=Y1+Y2` `` works even if you never gave either one a name. Insert a new calculation earlier in the note and every later `Y<N>` reference updates to still point at the right one, the same way a spreadsheet rewrites formulas when you insert a row above them.

**2. This note's own frontmatter**, with no re-typing:

```yaml
---
price: 19.99
quantity: 3
---
```
```
Total: `total=price*quantity`
```

**3. Another note's calculation**:

```
`=[[budget]]^total`
`=sum([[budget]]^Y1:Y5)`
```

**4. A table already in the note**:

```
!view expense select name, budget

Total: `=sum(T1.budget)`
```

`T1` is this note's first `!view` block (`T2` the second, and so on) — its whole `budget` column becomes a usable range, pulled from every note it matches, without writing a second query.

Autocomplete offers all four as you type `` ` `` or `=` — same-note cells first, then frontmatter fields, then table columns, then (once you type `[[`) other notes' cells.

## Ranges, named ranges, and conditionals

```
Rifles: `=40`
Grenades: `=15`
Medkits: `=8`
Total: `=sum(Y1:Y3)`

prices=Y1:Y3
Items over 10: `=countif(prices, ">10")`
Total of those: `=sumif(prices, ">10")`
```

`Y<N>:Y<M>` expands to every cell in that range, usable in `sum`, `average`, `min`, `max`, `median`, and more. `countif`/`sumif`/`averageif` take a quoted criterion: `">40"`, `"<=10"`, `"<>0"`, or a plain value for an exact match.

## Comparisons and logic

```
Over budget: `over_budget=spent>budget`
Status: `status=if(over_budget, "cut spending", "on track")`
```

`> < >= <=` compare two numbers or two strings. `== !=` work across any types. `and`/`or`/`not` are plain-English words, not symbols — `` `=spent > 0 and spent < budget` ``. `if(condition, then, else)` only evaluates the branch actually taken, so `` `=if(x != 0, 10/x, 0)` `` never divides by zero when `x` is `0`.

## Dates

```
Days left: `days_left=days_between(today(), due)`
Status: `status=if(due < today(), "overdue", "on track")`
New deadline: `new_due=add_days(due, 14)`
```

A date is just a `YYYY-MM-DD` string, the same format every frontmatter date field already uses — `due < today()` works with no function at all, since text order already matches calendar order here.

## Statistics, finance, and growth

```
Typical price: `=median(prices)`
Future value at 5% for 10 periods: `=fv(0.05, 10, -100)`
Payment to pay off $1000 over 10 periods at 5%: `=pmt(0.05, 10, 1000)`
Compound growth rate: `=cagr(100, 150, 5)`
```

| Category | Functions |
|---|---|
| Statistics | `median`, `mode`, `stdev`, `variance`, `stdevp`, `variancep` |
| Finance | `fv`, `pv`, `pmt`, `npv`, `irr` — same formulas and sign conventions as Excel |
| Growth | `cagr` |
| Other | `sqrt`, `abs`, `round`, `floor`, `ceil`, `sin`, `cos`, `tan`, `log`, `ln`, `sign`, `exp` |

## Formatting the display

```
Price: `=19.999 as currency`      →  $20.00
Approval rate: `=0.84 as percent` →  84%
Headcount: `=1234 as comma`       →  1,234
Precise: `=3.14159 as 0.00`       →  3.14
```

The real, unrounded value is what every further calculation or query actually uses — `as currency` only changes what's displayed.

## Checking your work

Hover any formula to see its label, name, result, and exactly which cells it read. For anything beyond plain arithmetic — a range, a function, a cross-note reference, a comparison — the hover also shows the step-by-step trace of how it resolved, in the order Yamlink actually evaluated it.

If a formula fails, hovering shows exactly why:

| | |
|---|---|
| `#REF!` | References a cell that doesn't exist |
| `#DIV/0!` | Division or modulo by zero |
| `#NAME?` | An unknown function or variable, usually a typo |
| `#VALUE!` | Anything else — malformed syntax, wrong type, a non-number result |

## Querying your calculations

Select, filter, and sort by a note's calculated values from a `!view` block:

```
!view expense where cell.total > 100 select name, cell.total sort cell.total desc
```

And fold across every matched note at once:

```
!view expense aggregate sum(cell.total) as grand_total, average(cell.total) as avg_total
```

## Good to know

- A date-looking number like `2099-01-01` written directly in a formula is ordinary subtraction, not a date — write `date(2099, 1, 1)` or a quoted string instead.
- A field name with a hyphen (`unit-price`) can't be read directly from frontmatter — it would parse as subtraction. Rename it, or reference it some other way.
- `pi` and `e` are built in as constants — but a variable you name yourself always takes priority if it shares the name.
- Cross-note references are single-hop by design: if note A reads note B, and B's own formula tries to read note C, that chain isn't followed. This is deliberate, not a missing feature — it's what keeps circular references structurally impossible.

See [FEATURES.md](./FEATURES.md#inline-calculations) for the complete feature list this builds on, including the full query-language side (`!view`, `group by`, `aggregate`).
