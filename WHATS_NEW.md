# Yamlink 0.6.0 — Shujimi

Shujimi is the "headless and depth release". Work is now well underway to turn The vault is now a data platform.

The big story:

- Yamlink now runs without VS Code — the CLI gives headless access to every vault capability
- The intelligence system is fundamentally different — vault-first, no hardcoded rules, learns from what you actually do
- The Home panel gives the vault a front door — activity stream, pulse, continue working
- Natural language queries let you describe what you want in plain English

---

## What's new

### Yamlink CLI

Run Yamlink from a terminal, CI pipeline, or build script. No VS Code required.

```bash
yamlink build          # index vault, check broken links — exits 1 in CI
yamlink health         # lifecycle, type distribution, drift
yamlink validate       # schema conformance — exits 1 if required fields missing
yamlink query "where type = contact and status = active"
yamlink report rico    # full note report in the terminal
yamlink links rico     # all inbound and outbound links
yamlink serve          # local HTTP API: /api/nodes, /api/query, /api/graph
yamlink export         # dump vault to JSON or CSV
```

`yamlink serve` exposes the vault as a REST API — any website framework (Next.js, Astro) can read your vault at build time. Notes become pages. Frontmatter becomes metadata. Wikilinks resolve to URLs. Vault as CMS, files stay plain Markdown.

### Intelligence overhaul — four phases

The intelligence layer is now fundamentally vault-first. No static field-name lists. No hardcoded type lookups. No global archetype tables. The vault teaches the system.

**Phase 1 — Cold-start awareness.** A field containing one typed `[[wikilink]]` is classified as a relation immediately — one observation is enough. Vault maturity (0–1) scales confidence thresholds, so a 3-note vault gets useful suggestions from the start.

**Phase 2 — Sticky knowledge.** The mutation log records every wikilink assignment. A field used as a relation before stays classified as relational even after vault restructuring — the system doesn't forget what it learned.

**Phase 3 — Vault-first classification.** Field names are the last resort, not the first. `status: [[rico]]` → relation. `disposition` with values `active/standby` → workflow (detected from your vocabulary, not a global list). Note roles (person, container, event) are inferred from field-bundle topology, not from type names.

**Phase 4 — Outcome calibration.** Every relation completion you accept (Enter/Tab on a `[[` candidate) is persisted as a training signal. Fields confirmed before get a small confidence boost next time. The vault trains the system from use, not just from content.

### Note arc prediction

Yamlink now answers "what does this note need next?" — a trajectory question, not just a classification.

The Note Report Overview tab shows a "Likely missing" section: fields that appear on 60%+ of same-type notes that this note doesn't have yet, ranked by vault frequency and calibration history. Each row has a `+` button — click it to insert the field stub and trigger completion in one step.

Arc-predicted fields also appear in frontmatter field name completion with a badge: `in 80% of contact notes · likely missing`.

### Home panel

`Yamlink: Open Home` — the vault's home screen.

- **Pulse bar** — note count, type count, broken link count
- **Activity feed** — last 15 mutation events as a human-readable timeline; each entry opens the note
- **Continue working** — 5 most recently touched notes, one click to open
- **Quick actions** — New note, Today (daily note), and per-vault type buttons

Auto-opens once on first vault activation. Shows an onboarding welcome when the vault has fewer than 5 notes.

### Natural language queries

`Yamlink: Query in Plain English` — describe what you want, get a `!view` block.

Type: *"active contacts I haven't updated in 30 days"*
Get: `!view contact where status = active and file.modified < days-ago(30)`

Uses 16 sentence pattern templates and full vault vocabulary injection — your types, fields, workflow values, and note IDs. The generated query is previewed before insertion. The `!view` query language is completely unchanged — this is a generator and a learning tool.

### Daily notes

`Ctrl+Alt+J` — open or create today's journal note. Uses `_templates/journal.md` if it exists; otherwise creates a stub with `id`, `type: journal`, and `date` pre-filled. Journal notes are first-class: queryable, linkable, visible in the Calendar.

### Unlinked references

The Note Report Links tab now shows body-text mentions of the current note's name or ID from other notes — without a formal `[[wikilink]]`. Word-boundary matched, case-insensitive. Sorted by occurrence count. The Roam Research discovery pattern: organic mentions surface before you formalize the link.

### True note splitting

`Yamlink: Extract Selection to New Note` — select body text, run the command. The selection becomes the body of a new note; the selection in the original is replaced with `![[new-id]]` (an embed); `source: [[original-id]]` is written into the new note's frontmatter automatically.

### Smart Templates (live, not one-time)

`_templates/*.md` files now act as live schema definitions. When you save a template with new fields, Yamlink scans the vault and asks: *"Template 'contact' has new fields. Apply to N notes?"*. Accepting inserts the missing fields into every affected note — open tabs via workspace edit, closed files directly on disk.

Notes missing template fields get a yellow squiggle on the `type:` line. The lightbulb reads: `Yamlink: Add missing "contact" fields (company, status)` — exact type and field names.

### Schema conformance in Vault Health

Vault Health now includes per-type schema analysis:

- **Coverage** — what percentage of notes of each type have all required fields
- **Non-conformant notes** — which specific notes are missing required fields, with the missing field names
- **Advisories** — types with notes but no schema (invitation to formalize, never a gate)
- **Dangling relations** — schema relation fields targeting a type that has no vault notes

### `file.created` and `file.modified` virtual query fields

Two implicit fields available in any query — no frontmatter required.

```
!view contact
where file.modified < days-ago(30)
select name, status, file.modified
sort file.modified desc
```

Both support all operators: `=`, `!=`, `>=`, `<=`, `>`, `<`, `is empty`, `exists`.

### Matrix view

Toggle any `!view` table to a two-axis relation grid. Rows = query results. Columns = all vault notes of any type you choose. Cells show ● where a connection exists. Bidirectional edge detection. Column and row headers click through to the notes.

### Git history import

`Yamlink: Import Git History` — for git-tracked vaults, reconstructs the full mutation history of every note from commit history. Walks each `.md` file with `git log --follow`, reads frontmatter at each commit, and emits accurate events with real commit timestamps. The Note Report History tab and arc spine are then populated going back to the first commit. Runs once, guarded by `.yamlink/git-history-import.done`.

### QOL: status bar and broken wikilinks

**Compact status bar** — the vault-health item drops "Yamlink" and "nodes" from its text. Before: `Yamlink  ⚠ 31 nodes · 104 broken`. After: `◈ 31  ⚠ 104`. The graph icon already brands it. The tooltip carries the full label. A permanent `$(home)` button now sits immediately to its right — one click opens the Home panel from any file.

**Broken wikilink visual** — dead `[[links]]` are now decorated with amber brackets and faded amber text rather than a disruptive yellow squiggle. Clearly a different state from working links (which have dim brackets + vivid mint text), but doesn't interrupt the reading flow.

**Template-guided note creation** — the "Create note" quick fix on a broken wikilink now walks you through the template workflow. If `_templates/` doesn't exist, Yamlink offers to create it with a starter template. If it exists, you get a QuickPick of all available templates, with the type-matched one at the top. Pick one and the note is scaffolded from it. Cancel and nothing is created.

### Callout blocks render in preview and PDF

`> [!SOURCE]`, `> [!EVIDENCE]`, `> [!WARNING]`, and all Yamlink callout types now render as styled blocks in the note preview panel and PDF exports — not as raw `[!SOURCE] text`.

Each family uses a distinct Yamlink Apollo palette color with a left accent bar, uppercase type label, and formatted body:

| Callout | Color |
|---|---|
| SOURCE, EVIDENCE, QUOTE, REFERENCE | Amber `#E7A85A` |
| NOTE, INFO, TIP, ABSTRACT | Teal `#5ECFBE` |
| WARNING, CAUTION | Orange `#E67D61` |
| DANGER, BUG, FAILURE | Red `#FF4A6A` |

The note preview also now uses **Inter** as its body and heading font (from the system font stack — no external request required).

---



The Zim release notes are preserved in [CHANGELOG.md](./CHANGELOG.md#050---zim).

---

## Who Shujimi is for

**If you want Yamlink without VS Code open** — the CLI gives you full vault access for scripting, CI, and publishing use cases.

**If you manage structured vaults** — the intelligence overhaul means the system adapts to your vocabulary, not the other way around. Schema conformance and template drift give you operational quality control.

**If you want to capture faster** — Home panel, daily notes, natural language queries, and note splitting reduce friction between having a thought and having it in the vault.

**If you've been using Yamlink for a while** — the feedback loop means the system gets more accurate the more you use it. Fields you've confirmed before are suggested with more confidence. The vault trains the system from use.
