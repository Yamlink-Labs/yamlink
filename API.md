# Local API

`yamlink serve` exposes your vault as a local HTTP server — useful for scripting against your notes from any language, or building your own tooling on top of Yamlink.

```bash
yamlink serve --vault ~/notes --port 3000
```

It only binds to `127.0.0.1` — nothing about your vault is reachable from outside your own machine.

## Try it

```bash
curl http://127.0.0.1:3000/api/types
curl http://127.0.0.1:3000/api/nodes?type=contact
curl "http://127.0.0.1:3000/api/query?q=where+type=contact+sort+name"
```

## What it's for

Conduit (Yamlink's terminal UI) and the VS Code extension's some features both run on this same API — so does anything you build yourself: a personal dashboard, a script that bulk-edits notes, an automation that reacts to vault changes in real time over the `/api/events` stream.

It's read and write: you can create, edit, and query notes from outside the editor entirely.

## Where to go deeper

This is intentionally a quick-start, not the full endpoint reference — the API surface is large enough (notes, graph, tasks, mutations, intelligence signals, live events) that a complete reference belongs in its own place as it stabilizes further. If you're building something real against it and need the full route list, open an issue or reach out — [@yamlinklabs](https://x.com/yamlinklabs).
