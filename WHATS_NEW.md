# Yamlink 0.7.7

0.7.7 is Yamlink's first Authoring & Publishing release. A real, separate website project adopted Yamlink as its content engine ahead of schedule, and building its own pipeline by hand surfaced concrete gaps this release closes. For reference: https://www.yamlink.dev (coming soon)

---

## What's new in 0.7.7

### `yamlink publish` — turn your vault into a real website's content

- **A native build command** — `yamlink publish --out <dir>` walks every publishable note and writes a structured JSON payload (per type, plus a manifest) that a site generator like Astro, Next.js, or Eleventy can build a site from. No more hand-rolling a script to walk files and parse frontmatter yourself.
- **`[[wikilinks]]` resolve to real site URLs** — in both frontmatter fields and body text, automatically.
- **`!view` blocks become static snapshots** — resolved to a plain Markdown table as of the build, since the destination site has no Yamlink query engine to run them live.
- **`status: draft/published/archived` is now a real gate**, not just a colored label — a production build excludes drafts by default; add `--mode preview` to include them. Nothing about how `!view`, completions, hover, or diagnostics behave changes — a vault that never sets this field sees zero difference anywhere.
- **`order:` for manual ordering** — a numeric frontmatter field the published manifest sorts by, for chapters, changelog entries, or any fixed sequence.
- **`previous_ids:` for redirects** — declare a note's old slug(s) and `yamlink publish` writes a redirect map, so a rename doesn't break old links on the published site.
- **A pre-publish safety net** — every build reports (without failing) any published note linking to a draft/archived note or a link that doesn't resolve at all, ignoring fenced code-block examples.
- **Everything else a static site needs** — referenced images are copied into the output automatically, builds are incremental (only what changed gets rewritten), a search index is generated every time, and adding `--site-url` also generates a sitemap and an RSS feed.

### Preview and export, beyond the build command

- **`yamlink export --id <id> --format html`** — one note, resolved links and all, as a standalone HTML file — for sending a single note to someone with no Yamlink install at all.
- **A pluggable Live Note preview target** — set `yamlink.liveNotePreviewUrl` (e.g. `http://localhost:4321/{slug}`) and Live Note shows your destination site's own live rendering of the current note instead of Yamlink's generic view, staying in sync as you switch notes.

### A real bug fixed along the way

- Body-text wikilink detection (used everywhere — the graph, diagnostics, hover, backlinks) could get confused by a bare `` `[[` `` used in prose to illustrate the syntax itself (like "type `[[` to trigger autocomplete"), treating everything between it and the next real `]]` — potentially whole paragraphs later — as one garbled broken link. Fixed.

---

For the previous release, see [CHANGELOG.md — 0.7.6](./CHANGELOG.md#076).
