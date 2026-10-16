# Yamlink CLI

The `yamlink` command gives you full access to your vault from a terminal — no editor required. Query your notes, check vault health, watch for changes, automate with hooks, and serve your vault as a local API for other tools to use.

```bash
yamlink health
yamlink query "where type = contact sort name"
yamlink serve --port 3000
```

## Install

```bash
git clone https://github.com/Yamlink-Labs/yamlink.git
cd yamlink
npm install
npm link
```

`npm link` registers the global `yamlink` command. Check it worked:

```bash
yamlink --version
```

**Windows:** if `yamlink` isn't recognized right after `npm link`, restart your terminal. Still missing? Run `npm config get prefix` and make sure that folder's `bin/` is on your PATH.

## Pointing it at a vault

A vault is just a folder of Markdown files with `id:`/`type:` in their frontmatter. Every command needs to know where it lives:

```bash
# specific path
yamlink health --vault ~/notes

# or just execute from inside the vault
cd ~/notes && yamlink health
```

## Useful flags, everywhere

| Flag | What it does |
|---|---|
| `--vault <path>` | Vault directory (defaults to the current folder) |
| `--json` | Machine-readable output — pipe to `jq`, a script, a dashboard |
| `--output <file>` | Write a report straight to a file instead of the terminal |
| `--help` | Command-specific help |

Exit codes are predictable: `0` success, `1` a problem with input/arguments, `2` something went wrong internally.

## What you can do with it

**Look at your vault**

```bash
yamlink health                          # broken links, duplicate IDs, orphaned notes
yamlink query "where type = contact"    # run a !view-style query from the terminal
yamlink search "project launch"         # full-text search
yamlink graph                           # export the note graph
yamlink briefing                        # what's changed, what needs attention
yamlink trends                          # vault growth/stale forecasts
```

**Create and edit notes without opening an editor**

```bash
yamlink create --type contact --field name="Alex Rivera"
yamlink set some-note-id status=done
yamlink bulk-set --query "where type = task and status = todo" status=done
yamlink rename old-id new-id            # propagates every [[wikilink]] vault-wide
```

**Keep a vault healthy over time**

```bash
yamlink doctor                          # diagnose and suggest fixes
yamlink validate                        # check against your schema
yamlink stale                           # notes that haven't been touched in a while
yamlink orphans                         # notes nothing links to
yamlink drift                           # notes drifting from their type's usual shape
```

**Automate**

```bash
yamlink watch                           # re-run on every vault change
yamlink on note.created -- ./my-script.sh
yamlink hooks list
```

**Serve it to other tools**

```bash
yamlink serve --port 3000               # local HTTP API — see API.md
yamlink conduit                         # the terminal UI — see CONDUIT.md
```

**Back up and restore**

```bash
yamlink snapshot                        # save vault state
yamlink restore --snapshot <id> --output ./recovered
```

This is a sample of the most common commands — `yamlink --help` lists everything installed on your version, and every command supports `--help` for its own options.

## A typical session

```bash
cd ~/notes
yamlink health                                           # anything broken?
yamlink query "where type = task and status = todo"      # what's open?
yamlink set task-042 status=done                         # close one out
yamlink briefing                                         # what happened today?
```
