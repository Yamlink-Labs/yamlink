# Yamlink 0.7.9

0.7.9 is another quick hotfix, found the same way as 0.7.8: a real, live verification run of `yamlink publish` against a separate repo.

---

## What's new in 0.7.9

### Fixed

- **`yamlink publish` never detected real changes across separate runs.** Because `yamlink publish` runs as a fresh process each time, its internal vault-generation counter always started from the same value — so the build cache compared that number against the last run's and reported "unchanged" on every run after the first, even when notes were genuinely edited, added, removed, or newly excluded by a `.yamlinkignore` change. Fixed: the cache now compares each note's real content, which works correctly across separate runs.
- **`--force` couldn't clean up stale files from a genuinely previous build.** Fixed alongside the above — `--force` now rewrites everything unconditionally while still correctly removing anything now-stale.

---

For the full Authoring & Publishing feature set shipped in 0.7.7 (`yamlink publish`, single-note HTML export, the Live Note preview target), see [CHANGELOG.md — 0.7.7](./CHANGELOG.md#077).
