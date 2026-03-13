# Changelog



## [0.2.0] — "Dizzie" — 2026

The "query release". Yamlink now has a live view panel, a full query language,
the "Entity Hub", schema enforcement, and a sesries of refinements across every
previous feature. The vault is now not just navigable — it is queryable.

### Added

**View Panel**
- `!view <type>` blocks render live, interactive tables inside VS Code
- Multiple `!view` blocks in one file become tabs in the panel
- Tab state (active tab, sort column, search term) persists across re-renders
- `▶ Run views` status bar button — visible only when the active file has `!view` blocks
- Inline cell editing — double-click any cell to edit frontmatter in place
- Relation cell editing with known-ID validation and `[[` promotion
- Save confirmation — cells flash green on successful write
- Multi-relation cells (multiple `[[links]]`) show tooltip explaining read-only status
- Filter chips with live count updates reflecting active search
- Column sort per tab, persistent across renders

**Query Language**
- `select <fields>` — specify and order columns
- `where <field> = <value>` — equality filter (scalar and `[[relation]]` values)
- `where <field> contains <text>` — substring filter
- `sort <field>` / `sort <field> desc` — ascending and descending sort
- `limit N` — first N rows after sort, for "latest N" patterns
- `| <label>` pipe syntax — set tab label from the query line
- Multi-line query blocks — clauses can follow `!view` on subsequent lines
- `!view *` wildcard — show all typed nodes with a type column

**Entity Hub**
- Full backlink view for a focused node, grouped by relation field
- Each relation field becomes a collapsible, sortable table section
- Body mentions grouped last, starting collapsed
- Global search across all sections with live visible count
- Click any ID or relation pill to open the linked node

**Vault Health Panel**
- 0–100 health score based on broken links and orphan density
- Stats strip: nodes, edges, broken links, orphans, types, schemas
- Entity type list with per-type node pills and "View all →" quick access
- Orphan node list with click-to-open pills
- Snapshot timestamp

**Code Actions**
- Query suggestion — when 3+ nodes of the same type all reference this node
  via the same relation field, a Code Action offers to insert a scoped `!view`
  block at the end of the document, with `select` pre-filled from schema if
  one exists for that type
- `yamlink.insertViewBlock` command — inserts `## Heading` + query block

**Schema System**
- Schema nodes (`type: schema`) define expected structure for a type
- Required field validation — warning diagnostic when required field absent
- Relation field target enforcement — completions filter by schema-defined target type
- Schema-aware Quick Fix type inference — "Create account X" instead of "Create node X"
- Duplicate schema detection — warning when two schemas share a `target:`

**Completions**
- YAML field name completions inside frontmatter — derived from schema fields
- Required fields sorted first
- Relation fields insert as snippet `field: [[|]]`

**Templates**
- Template auto-use on node creation — checks `_templates/<type>.md`
- `yamlink.newNodeFromTemplate` command — QuickPick of all templates
- Bootstrap prompt — if no templates exist, offers to create `_templates/` with a starter

**Diagnostics**
- `yamlink.missingRequiredField` — schema-required field absent
- `yamlink.duplicateSchema` — two schemas for the same target type
- `clearAll()` before `validateAll()` — stale diagnostics from deleted files no longer linger

**Status Bar**
- Node-mode: shows type + backlink count when active file is a node
- Node-mode: click opens Entity Hub when backlinks exist
- Orphan indicator when node has no connections
- `▶ Run views` button — separate item, shown only when relevant

**Wikilinks**
- Resolved `[[wikilinks]]` are underlined in the editor — visual confirmation that a link points to a real node

### Fixed
- Edge deduplication key was `targetId` only — now `field:targetId`, preventing
  collapse of distinct relation fields pointing to the same target
- `schema[fieldName]` reference in code actions corrected to `schema.fields[fieldName]`
- Orphan detection included system nodes (`schema`, `dashboard`, `template`) — now filtered
- Empty `[[]]` pills rendered in entity hub — filtered before render
- `yamlink.runViews` and `yamlink.insertViewBlock` missing from `package.json` commands — added
- Chip filter counts did not update when search term was active — now recalculated per filter on every search pass

### Changed
- Body links in Entity Hub sorted last and start collapsed
- Hover preview now expands relation fields inline — linked node's own fields
  shown indented beneath the link (one level deep, no recursion)

---

## [0.1.0] — "Apollo" — 2025

The identity release. Yamlink establishes the foundation: every file gets a
stable ID, every link resolves to that ID, and broken links surface
immediately as diagnostics.

### Added
- Canonical `id:` identity model — filename is cosmetic, `id:` is permanent
- Vault-wide rename propagation with preview and revert
- Hybrid graph model — YAML typed relations + body wikilinks, both indexed
- Inbound edge tracking (`inboundEdges`) for full backlink support
- Backlinks panel in Explorer sidebar with field labels and click-to-open
- Hover previews — frontmatter fields + body snippet
- `Ctrl+Click` definition navigation to any `[[wikilink]]`
- `[[` wikilink autocomplete — relation-aware filtering in frontmatter context
- Observational type registry — types derived entirely from vault, nothing hardcoded
- Broken link diagnostics (`brokenLink`, `brokenRelation`) as you type
- Duplicate ID detection
- `yamlink.unknownType` advisory for singleton types
- Quick Fix: add frontmatter to an unindexed file
- Quick Fix: create a node from a broken `[[link]]`
- Quick Fix: link an orphan node to any other node in the vault
- Status bar: vault summary (node count, broken link count)
- `yamlink.createNote` command — create node from Command Palette with type selection
- Graph stats: total edges, backlink count, node count
- `_templates/` folder exclusion from indexing
- Windows line ending normalization at index time

### Foundation
- Schema registry scaffold — observational only, not yet enforced (groundwork for 0.2.0)