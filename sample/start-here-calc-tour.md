---
id: start-here-calc-tour
type: guide
name: Start Here — Formula and Chart Tour
---

This folder is a small, made-up supply story (Starship Troopers themed) used to test Yamlink's formulas and charts. Every number here is calculated by Yamlink, not typed in by hand.

## The three notes to read, in order

1. [[calc-what-you-can-do]] — what each formula group is for, in plain words, with examples you can change.
2. [[calc-charts-gallery]] — the same data drawn as bar, pie, scatter, and line charts.
3. [[supply-requisition-charlie]] — the longest worked example, with every formula group in one place.

## Checking it in five minutes

Work through these in order:

- [ ] Open [[calc-what-you-can-do]]. Each formula shows its answer in place.
- [ ] Hover over any formula to see a step-by-step explanation of how it got its answer.
- [ ] Change one input, for example the `budget` in this note's frontmatter from 4000 to 3000. The `Over budget?` answer flips, and the dependent formulas update on their own.
- [ ] Open [[calc-charts-gallery]]. Each chart draws bars, slices, dots, or a line. If a chart is empty, its message explains why.
- [ ] Open [[supply-requisition-charlie]] and scroll to the bottom. The four "all three forms agree" answers are all true.

## If something looks wrong

- A formula shows an error instead of a number: hover it. The error name says what kind of mistake it is, for example a name that doesn't exist yet.
- A chart is empty: the note's query probably matched no notes. Read the grey line above the chart.
- Nothing updates: save the file once (Ctrl+S) so Yamlink re-reads it.

## Checking every formula at once without VS Code

From the Yamlink project folder, run:

    node scripts/check-calc-notes.js

It reads every note in this folder, works out every formula, and prints one line per formula: OK with the answer, SKIP for the few that need the live vault (cross-note references), or PROBLEM with the reason. It only reads files and never changes anything. The last line gives the total.
