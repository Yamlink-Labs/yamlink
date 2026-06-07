# How Yamlink Intelligence Works

Yamlink observes your vault — the notes you write, the fields you define, the links you create — and surfaces useful actions and completions without requiring any configuration. The system gets smarter the longer you use it, and it earns that intelligence from your vault, not from assumptions about what your notes mean.

This document explains every surface the intelligence system touches: what it does, what it says, and what happens when you act on it.

---

## The core idea

Yamlink's intelligence runs on three evidence sources, in order of strength:

1. **What your vault contains** — which fields link to which note types, which fields cluster together, how fields are used across similar notes
2. **What you've done before** — the mutation log records field changes, and the system learns which fields you've historically used as relations
3. **What you've confirmed** — when you accept a completion suggestion, that acceptance is remembered; fields you've confirmed once are suggested with more confidence next time

Schema notes make every one of these signals more precise. But none of them require a schema to work.

---

## Relation completion

When your cursor is on a frontmatter field line and you type `[[`, Yamlink offers a ranked list of candidate notes.

**What drives the ranking:**
- Schema target type: if the schema says this field links to `contact` notes, contacts rank first
- Vault evidence: which note type this field most commonly links to across your vault
- Already-linked notes: notes this note already references are demoted
- Commonly-linked notes in similar notes: notes linked by similar notes get a small boost
- Acceptance history: fields whose completions you've accepted before rank their candidates higher

**What you see in each completion item:**
- The primary label is the note's `name` or `title` field when available
- The description shows the note's ID
- The detail line shows the note's type and any relation context

**The "New [type]" item** appears at the top when Yamlink is confident about the target type and the note you'd link to doesn't exist yet. Selecting it creates the note and automatically wires a back-link from it to the current note.

---

## Field name suggestions

When you're on a blank line inside frontmatter and start typing a field name, Yamlink suggests fields from several sources:

| Source | What it suggests | Detail text |
|---|---|---|
| **Schema** | Fields declared in the schema for this note type | `status (required) · schema relation → contact` |
| **Vault pattern** | Fields that appear on 30%+ of same-type notes | `in 7 of 9 contact notes · likely missing · relation` |
| **Drift** | Fields missing relative to the schema or learned bundle | `missing from 6 of 9 contact notes like this` |
| **Adaptive** | Fields inferred from how this note has developed | `common alongside company and role (4 similar notes)` |
| **Note role** | Fields typical for the inferred role (person, event, etc.) | `common on person notes (7 notes)` |
| **Observed** | Fields seen on same-type notes | `observed in 5 contact notes` |

Fields from multiple sources combine — if a field appears in both the schema and the vault pattern, its ranking is boosted and its detail line merges both signals.

---

## Lightbulbs

Yamlink produces lightbulbs in four trigger contexts. Each context has a different set of possible actions.

### 1. On the `type:` line with no value set

Yamlink infers what type this note probably is from its field structure and suggests the type and its canonical fields.

**Actions that may appear:**

| Text | What it does |
|---|---|
| `Set type to contact?` | Writes `type: contact` directly into frontmatter |
| `Add the usual contact fields?` | Inserts up to 4 of the most common fields for that type; relation fields are pre-filled with `[[` |

---

### 2. On a frontmatter field line with no value

When your cursor is on a line like `commander:` with nothing after the colon, Yamlink classifies the field and decides what actions are appropriate for it.

**Field-scoped actions that may appear:**

| Text | What it does |
|---|---|
| `Should commander link to johnny-rico?` | Fills the field with `[[johnny-rico]]` — the most likely candidate based on vault evidence |
| `Add commander here?` | Inserts `commander: [[` to open relation completion |

The confidence bar is higher for field-scoped actions. Yamlink only offers `Should X link to Y?` when it's fairly certain about both the field being relational and the specific candidate.

---

### 3. On an empty line inside frontmatter (or any blank frontmatter line)

When you land on a blank line between frontmatter fields, Yamlink looks at the note as a whole and offers document-level suggestions. Up to 8 actions may appear.

**Document-level actions that may appear:**

| Text | What it does |
|---|---|
| `Add status here?` | Inserts a specific suggested field at the cursor |
| `Add company here?` | Inserts a specific field |
| `Add company and role here?` | Inserts two fields together |
| `Fill in the usual fields?` | Inserts a batch of fields typical for this note type |
| `Use the usual fields for notes like this?` | Inserts a field bundle matched to the note's inferred context |
| `Should company link to acme-corp?` | Inserts a field with a specific note already filled in |
| `Should this note link to johnny-rico?` | Inserts a companion field linking to a note that appears in similar context |
| `Add the linked fields here?` | Inserts relation setup fields derived from the note's body links |
| `Insert a related view?` | Inserts a `!view` query block showing notes linked via the detected relation field |
| `Insert the usual related list?` | Inserts a thread view for a relation pattern common on this note type |
| `Insert the usual related views?` | Inserts a bundle of view blocks typical for this note type |

Yamlink shows at most 8 actions and deduplicates by title. The most preferred action (marked `isPreferred`) appears at the top and is the one VS Code highlights when you click the lightbulb icon.

After any frontmatter edit, the Note Report opens automatically so you can see how the note connects to the rest of the vault.

---

### 4. On a `!view` block line

When your cursor is inside or adjacent to a `!view` query block:

| Text | What it does |
|---|---|
| `Run this view` | Executes the query and renders the table |
| `Adjust this view?` | Opens the view refinement builder |
| `Insert another view?` | Opens the view insertion flow |

---

## What the lightbulb colors mean

In most VS Code themes, two lightbulb colors appear:

**Yellow (QuickFix)** — Yamlink is confident and offering a direct action: fill in a field, fix a broken link, apply a type, add missing schema fields. These are higher-confidence suggestions.

**Blue (RefactorRewrite)** — Yamlink is offering a structural suggestion: insert a view block, adjust a query, add a field bundle. These are offered at a lower confidence bar and never apply directly to field values.

---

## Note Report — Overview tab

The Note Report's Overview tab shows three kinds of information about the current note:

### Briefing

A summary of the note's scalar frontmatter fields — date, status, name, title, and other key values — in a two-column grid.

### Likely missing

A ranked list of fields common on same-type notes in your vault that this note doesn't have yet.

Each row shows:
- The field name
- A `[relation]` badge if the field is typically used as a wikilink
- A `[✓N]` badge if Yamlink has had suggestions for this field accepted N times before — indicating the system is reliable on this field
- The percentage of same-type notes that have it (`in 80% of contact notes`)

**How ranking works:** Fields are scored by how common they are in your vault (75% weight) and how many times suggestions for them have been accepted (25% weight). A field that's common and has been reliably suggested scores highest.

This section is empty for untyped notes, and disappears when all common fields are already present.

### Signals

Intelligence signals about the note's health and position in the vault:
- **Lifecycle state** — `draft`, `growing`, `consolidated`, `hub`, or `stale`
- **Drift** — how far the note's field shape deviates from the learned pattern for its type: `on-track`, `minor-drift`, `drifting`, or `outlier`
- **Note role** — the system's inferred semantic role: `person`, `event`, `container`, `artifact`, `project`, `task`, `record`, `concept`, `place`

---

## How the system gets smarter over time

### From your vault

Every save updates the vault's learned patterns:
- Which fields link to which note types (from every `[[wikilink]]` in frontmatter)
- Which fields cluster together on same-type notes (from every note's field set)
- What your workflow vocabulary looks like (from the distinct values in status-like fields)

### From your history

Every field change is logged to `.yamlink/mutation-log.ndjson`. The system reads this log to learn:
- Which fields you've historically used as wikilinks — even if those fields are now empty
- Which notes were created and when
- How notes have changed over time (for lifecycle and stale detection)

### From your confirmations

When you accept a relation completion (pressing Enter or Tab on a `[[` candidate in frontmatter), Yamlink records that acceptance. Fields whose completions you've accepted before get a small confidence boost in future sessions — making the system more willing to suggest them proactively. This is the feedback loop: **the vault trains the system from use, not just from content**.

The boost is small and gradual: one accepted suggestion adds +0.07 confidence (enough to cross the hint threshold), capping at +0.15 after six or more. It only affects fields the system already has some evidence for — it doesn't invent relations from thin air.

---

## Vault Health

The Vault Health panel surfaces intelligence at the vault level rather than the note level.

| Section | What it shows |
|---|---|
| **Today's Activity** | Notes with mutations recorded today, sorted by change count. Persists across extension restarts via the mutation log. |
| **Lifecycle counts** | How many notes are in each lifecycle state (draft, growing, consolidated, hub, stale) |
| **Drift cards** | Notes classified as `drifting` or `outlier` — the ones most likely to need attention |
| **Schema Coverage** | For each schema type: how many notes conform, how many are missing required fields, and which fields are most commonly absent |
| **Type advisories** | Note types that have several notes but no schema — candidates for formalization |
| **Dangling relations** | Schema relation fields targeting a type that has no vault notes yet |
| **Template drift** | Notes whose fields have drifted from their `_templates/` counterpart |

---

## Schema: amplifies, never gates

Every Yamlink feature works on a vault with zero schema notes. Schema notes make the intelligence more precise — they do not unlock features that otherwise don't work.

**Without schema:** Vault priors, observed patterns, and history drive everything. Results are useful after a few notes and improve continuously.

**With schema:** The same surfaces get sharper. Completion filters to the declared target type. Drift detection measures against the schema rather than the learned bundle. Vault Health shows per-type conformance rates. The Note Report shows a "missing vs. schema" gap.

Schema is the formalization of structure the vault already shows — not a prerequisite.

---

## What Yamlink deliberately does not do

- **Interrupt your writing.** Lightbulbs only appear when you land on a specific line. The system never pops up dialogs or blocks editing.
- **Guess without evidence.** When the vault has nothing to say about a field, the system stays quiet. Silence on day one is correct — there's nothing to learn from yet.
- **Require upfront configuration.** The intelligence layer starts from zero and learns. You don't define types, schemas, or roles before writing.
- **Pretend to know more than it does.** Every suggestion carries an implicit confidence level. Fields classified at HINT level get subtler suggestions than fields classified at QUICKFIX level. The system is calibrated to match its assertiveness to its certainty.
