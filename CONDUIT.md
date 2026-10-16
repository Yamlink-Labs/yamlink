# Conduit

Conduit is Yamlink's terminal workspace — a full keyboard-driven application that takes over your terminal and stays live while you work. Not a wrapper around CLI commands that fire once and exit: it stays open, connects to your vault, and updates the instant something changes. Think lazygit or k9s, but for your Yamlink knowledge graph.

## Getting started

Conduit talks to a running Yamlink API server, so you need two terminals:

```bash
# Terminal 1 — start the server, keep it running
yamlink serve --vault ~/notes

# Terminal 2 — open Conduit
yamlink conduit
```

You land on the Briefing screen. Press a number key to switch screens, `?` on any screen for its key bindings.

## The ten screens

| Key | Screen | What it's for |
|---|---|---|
| `1` | **Briefing** | Vault pulse — what's changed, what needs attention |
| `2` | **Query** | Run a live query, see results update as the vault changes |
| `3` | **Navigator** | Fuzzy-search across every note |
| `4` | **Explorer** | Browse notes by type, edit frontmatter, read full notes |
| `5` | **Health** | Broken links, duplicate IDs, drift, orphaned notes |
| `6` | **Search** | Full-text search across note bodies |
| `7` | **Graph** | A live, spatial view of the note graph — connections rendered as a real terminal graph, colored by type |
| `8` | **Diff** | What changed between two points in time |
| `9` | **Radar** | Tasks and things needing attention right now |
| `0` | **Trends** | Vault growth and staleness forecasts |

## Working in Explorer

Explorer is where most day-to-day editing happens:

- `n` — create a new note
- `e` — edit a field
- `o` — open the note body in your `$EDITOR`
- `H` — note history
- `]` / `[` — follow an outbound / inbound link
- `S` — save the current context, so you can come back to it later

## Splitting the screen

Press `|` to split into two independent panes, both sharing one live connection to your vault — useful for, say, browsing in Explorer on one side while watching Query results update on the other.

## Why two terminals

Conduit is a client, not the engine. The API server (`yamlink serve`) does the actual vault reading/writing and pushes live updates over a persistent connection; Conduit is one of several things that can connect to it (the VS Code extension and any script you write are others). Keeping them separate means Conduit can crash or be closed without losing anything — restart it and it reconnects to the same live vault state.

```bash
yamlink serve --vault ~/notes --port 4000
yamlink conduit --port 4000
```

Both default to `127.0.0.1:3000` if you don't need a different port.
