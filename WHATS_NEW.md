# Yamlink 0.5.0 — Zim

Zim is the release where Yamlink starts to feel like a fuller workspace, not just a set of note utilities.

The big story is simple:

- the graph is now a real product surface
- note structure is easier to query and inspect
- completions and note creation are smarter
- the whole extension is more stable, faster, and easier to trust

If Carmen was the hardening release, Zim is the release where Yamlink becomes more readable, more operational, and more complete in daily use.

---

## What's new

### A better graph

Zim introduces a clearer graph experience with two distinct surfaces:

- **Sidebar Graph** for ambient vault awareness
- **Graph Workspace** for focused exploration around the current note or the whole vault

What this means in practice:

- you can keep the broader vault shape visible while you work
- you can open a focused graph when you want to inspect one note in detail
- filters, search, minimap, and note selection now make the graph more usable as a workspace instead of just a visual novelty

This is not just a different renderer. It is a clearer graph model for how Yamlink should be explored.

### A stronger query language

Queries are now more practical for real work.

Zim adds:

- `!=` for not-equal filters
- `is empty`, `is not empty`, and `exists`
- `#tag` shorthand
- real cross-field `or`
- relative date functions like `today()` and `days-ago(30)`
- `group by`

This makes `!view` blocks much more usable for dashboards, reviews, reports, and operational tables without turning the query language into something bloated.

### Smarter note creation

Yamlink now does a better job helping you create structure instead of only reading it later.

You can now use:

- **Templates** when you want a repeated body/frontmatter layout
- **Schemas** when you want a repeated field shape with stronger structure
- **Vault learning** when you do not want to formalize everything up front

Zim makes those paths work together better:

- `Yamlink: Create Note`
- `Yamlink: New Note from Template`
- `Yamlink: New Note from Schema`

The goal is simple: new notes should feel easier to start, and repeated note types should feel easier to keep consistent.

### Better completions and structure awareness

Completion is now more useful where it matters most:

- relation targets are ranked more intelligently
- human names are easier to scan than raw IDs
- note-family and vault-pattern learning matter more than before
- aliases, tags, dates, headings, quotes, embeds, and footnotes all contribute more clearly to Yamlink's understanding

This does not mean Yamlink became noisy.

It means the system is getting better at helping where your vault already shows repeated structure.

### Note Report and Vault Health feel more like real product surfaces

Zim continues the move away from “developer tool output” and toward clearer operational surfaces.

**Note Report** now does a better job showing:

- what a note is
- how it connects
- what tasks belong to it
- what view is worth opening next

**Vault Health** now gives a clearer snapshot of:

- broken links
- orphan notes
- lifecycle distribution
- type consistency
- overall structural health

The intent is to make these panels useful even if you are not a graph person or a query person yet.

### Time, tags, callouts, embeds, and aliases are more useful

Zim improves several smaller but high-value behaviors:

- `@today`, `@tomorrow`, and similar date shortcuts
- body `#tags` as real queryable signals
- callouts as readable structured note signals
- `![[embeds]]` as first-class references
- note aliases that resolve like real links

Individually these are small.

Together they make Yamlink feel more like one coherent Markdown system instead of a loose bundle of features.

### More trust under the hood

The most important invisible change in Zim is trust.

The codebase now has:

- stronger automated testing
- linting
- CI
- extension-host coverage
- better caching and refresh behavior

That means Yamlink is in a better place to keep growing without turning brittle.

For users, the practical result is:

- fewer regressions
- faster surfaces
- more confidence that graph, Note Report, queries, and completions stay aligned

---

## Still part of Yamlink

These are active Yamlink capabilities today, even though they were introduced before Zim:

- **PDF export** for active notes and live table views
- **Obsidian import** for getting an existing vault into Yamlink quickly
- **public extension API**
- **`.yamlinkignore`** for excluding files and folders from the Yamlink system

Zim does not introduce these for the first time, but they remain part of the current product surface.

---

## Who Zim is for

Zim should feel better for both kinds of Yamlink users:

**If you are new to Yamlink**

- the core loop is clearer:
  - write notes
  - link notes
  - query notes
  - inspect notes
- Note Report, Vault Health, and Graph help you understand the vault without needing expert habits first

**If you already use Yamlink deeply**

- the graph is more usable
- queries are more expressive
- completions are more adaptive
- note creation is more structured
- the extension is more reliable at scale

---

## Notes for this release

Zim is a major quality release, but it is not pretending every lane is finished forever.

A few graph refinements are still intentionally deferred to Shujimi, especially around:

- very large-vault graph performance
- a few remaining graph workspace controls
- deeper graph export and secondary lenses

That said, the core Zim promise is real:

Yamlink is now a stronger graph workspace, a stronger structured Markdown system, and a more trustworthy operational extension than it was before.
