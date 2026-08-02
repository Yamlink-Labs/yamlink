# Yamlink 0.7.8

0.7.8 is a quick hotfix for a real bug found immediately after 0.7.7 shipped, caught during a real verification run of the new publishing commands in a separate repo.

---

## What's new in 0.7.8

### Fixed

- **`yamlink --version` / `-v` did nothing but crash.** The CLI had no handling for either flag at all — a flag-shaped argument was silently filtered out while looking for a command, which meant `--version` fell into the same path as running bare `yamlink` with no arguments at all: launching Conduit. In a non-interactive terminal, that failed outright instead of ever printing a version. Fixed — both flags now print the installed version and exit cleanly.

---

For the full Authoring & Publishing feature set shipped in 0.7.7 (`yamlink publish`, single-note HTML export, the Live Note preview target), see [CHANGELOG.md — 0.7.7](./CHANGELOG.md#077).
