# Yamlink API Contract

A machine-scannable reference for every route the local HTTP API (`yamlink serve`) exposes: method, path, query params, request/response body shape, and error codes. Generated from and cross-checked against the live route table in `src/api/router.js` (`routeDefs`) and each handler in `src/api/handlers/` — not written from memory, and should be re-verified against `routeDefs` whenever a route is added or changed.

For prose walkthroughs with example requests/responses, see [README-API.md](./README-API.md). This document is the flat contract table; that one is the guided tour.

## Conventions

- All responses are JSON except `GET /api/events` (`text/event-stream`).
- Every response carries `X-Yamlink-Generation: <n>` and `X-Yamlink-Api-Version: <version>` headers.
- Error responses are `{ "error": "<message>", "code": "<CODE>", ...extra }`. HTTP status is derived from `code` via a fixed map (below) — a handler cannot emit a code without a registered status.
- `page`/`limit` on list endpoints follow the same shape: `{ items: [...], meta: { total, page, limit, pages } }`. Each endpoint below notes its own max `limit`.
- Any endpoint reachable by a method it doesn't support returns `405 METHOD_NOT_ALLOWED`.
- A path segment matched by `/api/nodes/bulk` is checked before the generic `/api/nodes/:id` pattern for `POST`/`PATCH` — but for methods neither `bulk` route declares (e.g. `GET`/`DELETE` on the literal path `/api/nodes/bulk`), the request falls through and is treated as `/api/nodes/:id` with `id="bulk"`. Documented as a known routing quirk, not a bug to route around.

### Error codes

| Code | HTTP status |
|---|---|
| `BAD_REQUEST` | 400 |
| `MISSING_PARAM` | 400 |
| `INVALID_JSON` | 400 |
| `INVALID_PARAM` | 400 |
| `LIMIT_EXCEEDED` | 400 |
| `UNAUTHORIZED` | 401 |
| `NOT_FOUND` | 404 |
| `METHOD_NOT_ALLOWED` | 405 |
| `CONFLICT` | 409 |
| `INTERNAL_ERROR` | 500 |

### Authentication (opt-in)

CORS is intentionally wide open (`Access-Control-Allow-Origin: *`) so browser-based local tools running on a different origin/port can call the API. By default there is **no authentication at all** — anything that can reach `127.0.0.1:<port>` can read or write the vault, including a webpage open in the same browser.

Set the `YAMLINK_API_TOKEN` environment variable before starting `yamlink serve` to require every request (except the `OPTIONS` CORS preflight) to carry a matching `X-Yamlink-Token` header. Missing or mismatched tokens get `401 UNAUTHORIZED`. Unset (the default), behavior is unchanged from before this existed. `yamlink serve`'s human-readable startup output prints a loud warning whenever it starts without a token set.

## Routes

### Nodes

| Method | Path | Query params | Body | Success | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/nodes` | `type`, `page`, `limit` (max 500, default 100) | — | `200 { nodes: [...], meta }` | — |
| `POST` | `/api/nodes` | — | `{ type, fields? }` | `201 { ok, id, filePath, _generation }` | `400 MISSING_PARAM` (no type), `400 INVALID_JSON`, `409 CONFLICT` (id collision) |
| `POST` | `/api/nodes/bulk` | — | `{ notes: [{ type, fields? }] }`, max 50 | `201` (all ok) or `207` (partial) `{ created, errors, _generation }` | `400 MISSING_PARAM` (no `notes` array), `400 LIMIT_EXCEEDED` (>50) |
| `PATCH` | `/api/nodes/bulk` | — | `{ updates: [{ id, fields }] }`, max 50 | `200` (all ok) or `207` (partial) `{ updated, errors, _generation }` | `400 MISSING_PARAM`, `400 LIMIT_EXCEEDED` |
| `GET` | `/api/nodes/:id` | `include` (csv: `outbound,inbound,intelligence,history,body,timestamps`), `minGeneration` (int, waits up to 3s), `at` (ISO timestamp, time-travel — see below) | — | `200` note fields + `_outbound`/`_inbound` (or requested `include` sections — `body` adds `_body` (raw body text), `timestamps` adds `_timestamps: { created, modified }` from real filesystem stat data) | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id?at=<ts>` | `at` required for this mode | — | `200 { id, at, exists, fields, _outbound, complete, earliestReconstructableTimestamp, reason?, deletedAt? }` | `400 INVALID_PARAM` (bad timestamp), `404 NOT_FOUND` with `{ reason: "not-yet-created"\|"already-deleted"\|"no-history" }` |
| `PATCH` | `/api/nodes/:id` | — | `{ field, value }` or `{ fields: {...} }` | `200` updated fields + `_generation` | `400 BAD_REQUEST` (no field/fields), `400 INVALID_JSON`, `404 NOT_FOUND` |
| `DELETE` | `/api/nodes/:id` | — | — | `200 { ok, id, _generation }` | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id/outbound` | — | — | `200 { id, edges: [{ field, to, toType, toName }] }` | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id/inbound` | — | — | `200 { id, edges: [{ field, from, fromType, fromName }] }` | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id/neighborhood` | `depth` (1–3, default 1) | — | `200 { id, depth, nodes, edges, truncated? }` (`truncated: true` past 200 nodes) | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id/history` | — | — | `200 { id, events }` (last 100, newest first) | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id/evolution` | — | — | `200` — noteId, totalEdits, unstableFields, etc. (`buildNoteEvolution`) | `404 NOT_FOUND` |
| `GET` | `/api/nodes/:id/archaeology` | `field` (required) | — | `200` — relation timeline for that field (`buildRelationArchaeology`) | `400 MISSING_PARAM` (no field), `404 NOT_FOUND` |

### Graph

| Method | Path | Query params | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/graph` | `at` (ISO timestamp, optional — historical graph) | `200 { nodes, edges, stats: { nodes, edges, types, incomplete? } }` | `400 INVALID_PARAM` (bad `at`) |

### Query

| Method | Path | Query params | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/query` | `q` (required — `!view` syntax; auto-wrapped as `!view * <q>` if it doesn't already start with `!view `) | `200 { query, count, rows, columns }` | `400 MISSING_PARAM` (no `q`), `400 BAD_REQUEST` (unparseable or failed query) |

### Search / Schema / Types / Tasks

| Method | Path | Query params | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/search` | `q` (required), `type`, `field`, `page`, `limit` (max 200) | `200 { results, meta }` | `400 MISSING_PARAM` (no `q`) |
| `GET` | `/api/schema` | `type`, `page`, `limit` (max 100) | `200 { schemas, meta }` | — |
| `GET` | `/api/types` | — | `200` — array/summary of known types | — |
| `GET` | `/api/tasks` | `note`, `done` (`true`/`false`), `overdue` (`true`), `today` (`true`), `page`, `limit` (max 200) | `200 { tasks, meta }` | — |
| `PATCH` | `/api/tasks` | — | `{ noteId, line, done }` (`line` 1-indexed, matches `GET /api/tasks`'s rows) | `200 { ok, changed, noteId, line, done }` | `400 MISSING_PARAM`, `400 INVALID_PARAM` (bad `line`), `404 NOT_FOUND` (unknown `noteId`) |
| `GET` | `/api/glossary` | `types` (csv, required), `groupByType` (`true` default), `hideUnreferenced` (`true`/`false`, default shows all), `sortBy` (`alphabetical` default \| `mostReferenced`), `extraFields` (csv) | `200 { types, entryCount, groups }` — same shape as `yamlink glossary --json` | `400 MISSING_PARAM` (no `types`) |

### Mutations / History / Diff

| Method | Path | Query params | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/mutations` | `type`, `id`, `since`, `page`, `limit` (max 200) | `200 { events, meta }` | — |
| `GET` | `/api/diff` | `from` + `to` (compare two notes) **or** `since` (ISO timestamp — all field changes after it) | `200` — see below | `400 MISSING_PARAM` (neither mode satisfied), `404 NOT_FOUND` (unknown `from`/`to`) |
| `GET` | `/api/diff?from=&to=` | | `200 { from, to, added, removed, changed }` | |
| `GET` | `/api/diff?since=` | | `200 { since, count, changes: [{ id, type, fields }] }` | |
| `GET` | `/api/session/summary` | `sessionId` (optional — omit for "last 30 minutes") | `200 { sessionId, summary, bursts, events }` | — |

### Health / Intelligence

| Method | Path | Query params | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/health` | — | `200` — vault health snapshot | — |
| `GET` | `/api/intelligence/arc` | `id` **or** `type` (one required) | `200` — arc snapshot (note-level if `id`, type-level if only `type`) | `400 MISSING_PARAM`, `404 NOT_FOUND` (unknown `id`) |
| `GET` | `/api/intelligence/fieldCategory` | `id` + `field` (both required) | `200` — field classification | `400 MISSING_PARAM`, `404 NOT_FOUND` |
| `GET` | `/api/intelligence/note` | `id` (required) | `200` — lifecycle + drift + arc snapshot | `400 MISSING_PARAM`, `404 NOT_FOUND` |
| `GET` | `/api/intelligence/clusters` | — | `200` — detected pre-schema field-signature clusters | — |
| `GET` | `/api/intelligence/trends` | — | `200` — vault projections for growth, stale, structure, retrospective accuracy, and staleness forecast | — |
| `GET` | `/api/intelligence/lenses` | — | `200 { mostEdited, fastestGrowingTypes, ... }` | — |

### Live events

| Method | Path | Query params | Response |
|---|---|---|---|
| `GET` | `/api/events` | `note`, `noteType`, `type` (any combination — filters the stream) | SSE. Emits `connected`, then live `field_changed`/`relation_*`/`note_created`/`note_deleted`/etc. mutation events, plus `rebuild` and `intelligence_changed` after every rebuild. See README-API.md's "Live event stream" section for full event shapes and filter semantics. |

## Not yet built

Tracked in `ROADMAP.md`'s "API maturity pass" — not part of this contract yet: shared request/response validation layer (handlers currently hand-parse body/query shapes individually), richer error detail on `query.js`/intelligence handlers, `POST /api/intelligence/outcome`, `POST /api/query`, field-level patch ops (list append/remove), bulk intelligence reads, `GET /api/intelligence/vault` summary.
