# Yamlink

Structured knowledge for Markdown inside VS Code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yamlink.yamlink?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink) ![Version](https://img.shields.io/badge/version-0.1.0--Apollo-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blueviolet)

Yamlink turns Markdown vaults into structured knowledge systems by giving each file a stable identity in YAML frontmatter instead of relying on filenames.

![Yamlink Demo](media/demo.gif)

---

## My Problem

Many Markdown linking systems rely on filenames. Over time, files are renamed, reorganized, and moved. Links drift and references break. A vault slowly becomes a loose collection of documents rather than a coherent system.

Yamlink separates **identity** from **filenames**.

---
## The Core Idea

Each Markdown file declares a canonical `id:` in YAML frontmatter. That `id` becomes the stable identity of the node — so links remain valid even if files are renamed or moved.

```yaml
---
id: johnny-rico
type: character
created: 2297-01-15
---
Mobile Infantry soldier and leader of Roughnecks.

[[johnny-rico]] trained alongside [[dizzie-flores]] in the Mobile Infantry.

```

Use Yamlink to build:

- Personal knowledge bases
- Research databases and literature maps
- CRM-style relationship graphs
- Project and architecture knowledge systems
- World-building and narrative systems

All local-first. All Git-native.

---

## Install

Install Yamlink directly from the VS Code Marketplace:

https://marketplace.visualstudio.com/items?itemName=yamlink.yamlink

Or search **"Yamlink"** in the VS Code Extensions panel.

---

## Features

|Feature|Description|
|---|---|
|Canonical `id:` identity|Filename is cosmetic. The `id:` field is permanent.|
|Vault-wide rename propagation|Change an ID, update every reference — with confirmation.|
|Hybrid graph model|YAML typed relations + body wikilinks, both tracked.|
|Backlinks panel|Every inbound link to the active node, labeled by field.|
|Wikilink autocomplete|`[[` triggers suggestions from every indexed node.|
|Ctrl+Click navigation|Jump to any node instantly.|
|Hover preview|Frontmatter fields + body snippet on hover.|
|Real-time diagnostics|Broken links, duplicate IDs, unknown types — as you type.|
|Quick fixes|Create a node from a broken link. Add frontmatter to any file.|
|Observational type registry|Types are derived from your vault — nothing hardcoded.|
|Status bar|Live node count and broken link indicator.|

---

## Getting Started

**1. Open a folder in VS Code and Create your first node.**

Run `Yamlink: Create Node` from the Command Palette (`Ctrl+Shift+P`). Enter an ID and select a type — the file is created and opened immediately.

```yaml
---
id: johnny-rico
type: character
created: 2297-01-15
---
```

**2. Create a second node**

```yaml
---
id: dizzie-flores
type: character
created: 2297-01-15
---
```


**4. Start linking and writing normally.**

Type `[[` anywhere to trigger autocomplete.

```markdown
[[johnny-rico]] and [[dizzie-flores]] trained together before deployment to Klendathu.
```

**4. Build structure.**

Relationships can also be declared in frontmatter.

```yaml
---
id: mission-klendathu
type: mission
squad-leader: [[johnny-rico]]
squadmate: [[dizzie-flores]]
created: 2297-01-15
---
```

Open `johnny-rico.md` — the Backlinks panel shows `mission-klendathu` labeled `squad-leader`.

---

## Automatic Rename

When you change an `id:` and save, Yamlink scans your entire vault, shows you how many files are affected, and asks for confirmation before applying anything. Large changes can be previewed. Every change can be reverted.

**References are never broken.**

---

## Backlinks Panel

The Backlinks panel in the Explorer sidebar shows every inbound link to the active file, labeled by how it was declared.

```
dizzie-flores         character
mession-klendathu     mission
```

YAML field relations show their field name. Body wikilinks are labeled `body`. Click any entry to open that file.

---

## Diagnostics - Yamlink provides assistance 

|Code|Severity|Meaning|
|---|---|---|
|`yamlink.missingId`|Hint|File has no `id:` and is not indexed|
|`yamlink.duplicateId`|Warning|Same `id:` declared in multiple files|
|`yamlink.brokenLink`|Warning|Body wikilink references a non-existent node|
|`yamlink.brokenRelation`|Warning|YAML relation references a non-existent node|
|`yamlink.unknownType`|Info|`type:` value not seen in any other node|

---

## ID Rules

IDs use letters, numbers, hyphens, and underscores only.

```
dizzie-flores          ✓
mission_klendathu      ✓
Johhny Rico            ✗  spaces not allowed
note#1                 ✗  special characters not allowed
```

The same rule applies to field names. Use `related-concepts` not `related concepts` — fields with spaces are not recognized as graph edges.

---

## Philosophy

- **Local-first** — your vault is a folder of plain Markdown files
- **Git-native** — every node, relation, and change is version-controlled
- **Schema-optional** — structure emerges from your vault; nothing is enforced until you want it
- **No proprietary storage** — disable the extension and your files remain valid Markdown
- **No cloud dependency** — nothing leaves your machine

The extension adds structure, not lock-in.

---

## Roadmap

**Phase 2 — Intelligence Layer** _(in progress)_

- Schema enforcement — declare required fields per type
- Field suggestions based on type — YAML autocomplete guided by schema

**Phase 3 — Query Surface**

- Vault health report — nodes by type, broken links, orphans, total word count
- Graph visualization — D3.js webview of the full node graph
- Orphan detection — nodes with no connections surfaced automatically

**Phase 4 — Views + Export**

- Type-filtered sidebar views
- Kanban view for nodes with `status:` field
- Export pipeline — PDF, HTML, structured JSON

**Phase 5 — Platform**

- Web companion for read-only vault viewing
- API layer for programmatic vault queries
- Team vaults — shared graph, merge-safe via Git

---

**0.1.0 — Apollo** · Identity engine · Hybrid graph · Backlinks panel · Real-time diagnostics