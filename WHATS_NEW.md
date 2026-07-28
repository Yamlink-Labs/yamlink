# Yamlink 0.7.6

0.7.6 is a quick follow-up release, mainly to fix real problems that shipped in 0.7.5 and should have been caught before it went out.

---

## What's new in 0.7.6

### Fixes worth knowing about

- **The in-editor "What's New" notice still showed 0.7.4's release notes** to every user updating to 0.7.5 — the file behind this exact notice was never updated. Fixed.
- **Block IDs silently stopped working entirely on any note saved with Windows line endings** (CRLF) — no headings, tasks, quotes, or footnotes were recognized on an affected note, which meant hover, completion, go-to-definition, and block backlinks all quietly did nothing for it. Fixed regardless of line-ending style.
- **A multi-value relation field could render with corrupted, missing brackets in the hover card** — a YAML list field like `contacts:` with several entries could show its first and last entries with brackets silently stripped away, while entries in the middle were fine. Fixed; every entry now renders correctly, and any that resolve to a real note render as a clickable link.

### Block-level backlinks, now reachable outside VS Code

Knowing which notes link to a specific task, quote, heading, or footnote inside a note — not just which notes link to the note as a whole — already worked in VS Code's Note Report. It's now available from the terminal and over HTTP too:

- **`yamlink block-backlinks <note-id> [--block <block-id>]`** — lists every note referencing a specific block inside the given note; without `--block`, lists backlinks to every addressable block in it.
- **`GET /api/nodes/:id?include=blockBacklinks`** — the same data over HTTP, composable with the API's other `include` options.

---

For the previous release, see [CHANGELOG.md — 0.7.5](./CHANGELOG.md#075).
