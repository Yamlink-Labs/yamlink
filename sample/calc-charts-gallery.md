---
id: calc-charts-gallery
type: guide
name: Charts Gallery
---

Every chart in this note draws from the eight supply requisitions in this folder. Each one is a normal table in the note. Use the buttons at the top of a table to switch it to a chart: **Table, Matrix, Bar, Scatter, Line, Pie**.

What the numbers mean: "strength" is how many people are effectively available after casualties and replacements. The eight requisitions come from three units: Roughnecks, Sky Patrol, and Tango Squad.

## 1. Total strength by priority (bar)

Table below, then press **Bar**. In the value picker, choose **total_strength**.

!view field-report
group by priority
aggregate sum(cell.effective_strength) as total_strength

The bars show high 35, medium 23, and low 20. The roughnecks supply log has no priority set, so it appears as a fourth bar with a blank label and a value of 14.

## 2. Share of strength by priority (pie)

The same table as above. Press **Pie**, and keep the value picker on **total_strength**.

Each slice is sized by its share of total strength. Hover a slice for its exact number.

## 3. Average strength by priority (bar)

!view field-report
group by priority
aggregate average(cell.effective_strength) as avg_strength

Press **Bar**, value **avg_strength**. This answers a different question from chart 1: not "how much strength in total" but "how strong is a typical requisition at each priority". High-priority requisitions are not automatically stronger.

## 4. Budget against strength (scatter)

!view field-report
select name, budget, cell.effective_strength
sort budget

Press **Scatter**. Put **budget** on the horizontal axis and **effective_strength** on the vertical axis.

Each dot is one requisition. Dots high and to the right are large squads with large budgets. Dots low on the right are large budgets that buy little strength.

## 5. Strength over time (line)

!view field-report
select name, date, cell.effective_strength
sort date

Press **Line**. Put **date** on the horizontal axis and **effective_strength** on the vertical axis. Points are sorted by date before drawing, so the line traces the order the requisitions were made in.

The line tracks strength across late November and early December 2297.

## 6. How many requisitions per priority (bar, count)

!view field-report
group by priority

Press **Bar** and leave the value picker on **Count** (the default). This is the simplest chart: how many requisitions fall into each priority.

## 7. Summarize chart 1's table from a formula

Chart 1's table above is this note's first `!view` block, so it's addressable as `T1` — no second query needed:

Total strength across chart 1's table, read straight from it: `=sum(T1.total_strength)`
Typical bucket size: `=median(T1.total_strength)`
How many buckets are above 20: `=countif(T1.total_strength, ">20")`

These report the total across chart 1's four bars, their median, and how many of the four buckets are above 20 — without writing a second query.

## What to check

- Each chart's title line says what it is plotting, for example "Plotting budget against effective_strength across 8 rows".
- If a chart says it has no numeric values to plot, the field it needs is missing or not a number on those notes. Hover the table to see which notes are involved.
- Charts 1 and 2 show the same numbers in two shapes. Changing one requisition's casualties in its note updates both.
