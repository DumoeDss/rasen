# openspec-telemetry

A maintainer-owned Cloudflare Worker that ingests anonymous OpenSpec CLI usage
events into a Cloudflare Analytics Engine dataset. This replaces the upstream
PostHog reverse proxy (`edge.openspec.dev`) with infrastructure the fork
controls, while preserving the same privacy contract.

- **Deployed endpoint:** `https://openspec-telemetry.ws11579.workers.dev`
- **Worker name:** `openspec-telemetry`
- **Analytics Engine dataset:** `openspec_telemetry`
- **Cloudflare account:** `5cc51d8388c780c03fb4c6161bd403c4`

The CLI client that POSTs to this endpoint lives in `src/telemetry/` (sibling
change `fork-phase1-telemetry-client`).

## Privacy contract (hard line)

The Worker persists **only**:

- `command` — the CLI subcommand that ran (e.g. `init`)
- `version` — the CLI version
- `distinctId` — a client-generated anonymous UUID (no personal information)
- `os` *(optional)* — e.g. `linux`, `darwin`, `win32`
- `node_version` *(optional)* — e.g. `22`

It **never** stores IP addresses, file paths, command arguments, project names,
or any other field. Any unexpected fields in the payload are ignored by
construction (only the contract fields above are read). The request body is
never echoed back in the response.

## Event payload contract

`POST` a single JSON event. Only `POST` is accepted (any other method → `405`).

```json
{
  "command": "init",
  "version": "0.1.0",
  "distinctId": "b1a7...-anonymous-uuid",
  "os": "linux",
  "node_version": "22"
}
```

Responses:

| Case                                              | Status |
| ------------------------------------------------- | ------ |
| Valid event (recorded)                            | `202`  |
| Missing/empty `command`, `version`, `distinctId`  | `400`  |
| Malformed / non-object JSON body                  | `400`  |
| Method other than `POST`                          | `405`  |

The endpoint returns fast and fire-and-forget: `writeDataPoint` does not block
on downstream work, so a CLI awaiting the response (with a ~1s timeout) is never
delayed. Internal errors still return a `202` rather than hanging the caller.

## Analytics Engine data-point mapping

Each accepted event becomes one `writeDataPoint` call:

```ts
env.TELEMETRY.writeDataPoint({
  blobs: [command, version, os, node_version], // blob1..blob4
  indexes: [distinctId],                        // index1
});
```

- `blob1` = command
- `blob2` = version
- `blob3` = os
- `blob4` = node_version
- `index1` = distinctId (used for distinct-user counting)

Analytics Engine records the ingestion timestamp automatically; there is no
explicit timestamp field. At high volume Analytics Engine samples writes, but
phase-1 volume is far below sampling thresholds.

## Deploy

Prerequisites: `wrangler` (installed as a devDependency here) authenticated to
the maintainer's Cloudflare account with Workers write scope.

```bash
cd telemetry-backend
wrangler deploy          # or: npm run deploy
```

`wrangler deploy` prints the live `*.workers.dev` URL. Useful during
development:

```bash
npm run dev    # local dev server (wrangler dev)
npm run tail   # stream live request logs (wrangler tail)
```

### Smoke test

```bash
URL="https://openspec-telemetry.ws11579.workers.dev"

# WRITE path → expect 202
curl -i -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"command":"test","version":"0.0.0","distinctId":"<uuid>","os":"linux","node_version":"22"}'

# Negative paths
curl -i "$URL"                                   # GET → 405
curl -i -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"command":"test","version":"0.0.0"}'      # missing distinctId → 400
```

### Rollback

```bash
wrangler delete          # removes the Worker; no CLI-package change is coupled to it
```

## Reading the data (CF SQL API)

Reads use the Cloudflare SQL API. This requires a **separate** Cloudflare API
token with **Account Analytics read** scope (distinct from the Workers deploy
credential). Reads are documented here for the maintainer to run out-of-band;
they are not part of the deploy/verification gate.

Endpoint:

```
POST https://api.cloudflare.com/client/v4/accounts/5cc51d8388c780c03fb4c6161bd403c4/analytics_engine/sql
Authorization: Bearer <CF_API_TOKEN_with_Account_Analytics_read>
Content-Type: text/plain
```

The request body is the SQL query as plain text. In the `openspec_telemetry`
dataset the columns map as: `blob1` = command, `blob2` = version,
`blob3` = os, `blob4` = node_version, `index1` = distinctId, `timestamp` =
ingestion time.

**Daily active users (last 24h)** — total events and distinct anonymous users:

```sql
SELECT count() AS events, count(DISTINCT index1) AS distinct_users
FROM openspec_telemetry
WHERE timestamp > NOW() - INTERVAL '1' DAY
```

**Per-command / per-version breakdown (last 7 days):**

```sql
SELECT blob1 AS command, blob2 AS version, count() AS events, count(DISTINCT index1) AS users
FROM openspec_telemetry
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY command, version
ORDER BY events DESC
```

Example invocation:

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/5cc51d8388c780c03fb4c6161bd403c4/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d "SELECT blob1 AS command, count() AS events FROM openspec_telemetry WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY command ORDER BY events DESC"
```

Note: Analytics Engine reads reflect ingestion time and, at high volume, are
sampled — acceptable for aggregate anonymous stats. Raw `count()` is exact only
below the sampling threshold; at volume use the sampling-accurate form
`SUM(_sample_interval)` for event counts (distinct-user counts remain
approximate under sampling).

## Admin console

The same Worker serves a private maintainer dashboard. It is **not** a second
service — routing inside `src/index.ts` splits three surfaces:

| Path            | Auth                          | Handler                                  |
| --------------- | ----------------------------- | ---------------------------------------- |
| `POST /`        | none (public ingest)          | unchanged ingest — 202/400/405           |
| `/api/admin/*`  | Cloudflare Access JWT (gated) | read-only stats JSON (`src/stats.ts`)    |
| `/admin`, `/admin/*` | Cloudflare Access JWT (gated) | single-file panel `admin/index.html` |

### Auth model — edge Access **and** fail-closed in-Worker enforcement

Authentication is two layers, and the second is mandatory:

1. **Edge:** a Cloudflare Access self-hosted application fronts
   `telemetry.rasen.io/admin*`. Users authenticate at Cloudflare's edge; Access
   injects a signed `Cf-Access-Jwt-Assertion` header on allowed requests.
2. **In-Worker (fail-closed):** the `*.workers.dev` host does **not** pass
   through Access, so `src/access.ts` independently verifies that JWT (RS256,
   `audience` = `ACCESS_AUD`, `issuer` = `https://<ACCESS_TEAM_DOMAIN>`, JWKS from
   `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`) on **every** `/admin*` and
   `/api/admin*` request across every host. If `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`
   are unset, or the JWT is missing/invalid, admin paths return `403` — the panel
   HTML is never servable without a valid Access identity.

This is enforced by `run_worker_first = true` in the `[assets]` block: the Worker
script runs **before** any static asset is served, and it calls
`env.ASSETS.fetch` only **after** the JWT gate passes. (Without
`run_worker_first`, the static-assets runtime would answer `/admin` before the
Worker runs and leak the panel — so it is a tested, load-bearing invariant.)

### Stats API (v2 — two-layer hot/cold)

Read-only JSON aggregates (`src/stats.ts`). Event counts use
`SUM(_sample_interval)` (sampling-accurate); distinct-user counts are flagged
`usersApproximate: true`. Every response carries `source: "hot" | "cold"`.

**Two layers.** A `range` parameter selects the serving layer:

- `range=7d` / `30d` / `90d` → **hot** layer: live Analytics Engine via the CF
  SQL API (fine-grained, within the ~90-day retention). `source: "hot"`.
- `range=all` → **cold** layer: the durable D1 rollup store (day-grained, all
  history). `source: "cold"`.
- No `range` → back-compat: the legacy `days` param (clamped 1..30, default 14)
  on the hot layer.

| Endpoint                     | Returns                                             |
| ---------------------------- | --------------------------------------------------- |
| `GET /api/admin/overview`    | total events + distinct users for last 24h and 7d   |
| `GET /api/admin/dau`         | daily event + distinct-user series                  |
| `GET /api/admin/commands`    | per-command breakdown (events desc)                 |
| `GET /api/admin/versions`    | per-version breakdown                               |
| `GET /api/admin/os`          | per-os breakdown                                    |
| `POST /api/admin/backfill`   | one-time historical backfill → `{ ok, days, rows }` |

Shared query parameters (all endpoints): `range` (above); `hideTest` (default
**true** — excludes smoke-test traffic where version = `0.0.0`, on both layers;
`hideTest=false` includes it); and optional `command` / `version` / `os` equality
filters. Filter values are validated before use — any value with a quote,
semicolon, backslash, or control character is rejected with **400**
(`invalid_filter`), guarding the SQL-API text body against injection.

> **Cold-layer distinct users are an upper bound.** Per-day distinct-user counts
> are not additive across days (summing over-counts returning users), so
> all-history `users` totals from the cold layer are an approximate ceiling.
> Events are additive and are the primary metric.

Graceful degradation (deploy is always safe):

- `TELEMETRY_SQL_TOKEN` unset → hot-layer endpoints return **503** with a hint
  (never a crash); the panel shows a backend-unavailable notice.
- `ROLLUPS` D1 binding missing/erroring → cold-layer (`range=all`) reads return
  **503** (`cold_store_unavailable`); ingest and the hot layer are unaffected.
- CF SQL API upstream error → **502/503** with the upstream status in the hint.

### Permanent rollup store (D1) + daily cron

Analytics Engine retains raw events only ~90 days. A D1 database
(`rasen-telemetry-rollups`, binding `ROLLUPS`) holds day-grained **aggregate
counts** permanently — one row per `(date, command, version, os, node_version)`
with an event count and an approximate distinct-user count, and **no
`distinctId`** (privacy contract unchanged).

- **Daily cron** `"0 1 * * *"` (01:00 UTC): a `scheduled` handler
  (`src/rollups.ts` `runDailyRollup`) aggregates the prior UTC day from Analytics
  Engine and UPSERTs it into D1. It is a **pure bypass** — no shared code with the
  ingest hot path, and a SQL/token failure is a clean no-op that the next cron
  retries.
- **Backfill** (`runBackfill`, `POST /api/admin/backfill`): a maintainer-only,
  Access-gated one-shot that aggregates all retained history by day + dimensions
  and UPSERTs every row.
- **Idempotency:** both share the composite PK + `ON CONFLICT ... DO UPDATE`, so a
  cron re-run or an overlapping backfill replaces counts in place — never doubles.

Operator setup (create DB, migration, deploy, backfill) is in
[RUNBOOK.md](./RUNBOOK.md) Step 4.

### Panel

`admin/index.html` is a single self-contained file (vanilla JS + `fetch` + inline
SVG chart) — no bundler, no build step, no credentials in the browser. It renders
a control bar (time-range selector `7d/30d/90d/all`, command/version/os filter
dropdowns populated from the breakdown responses, and a hide-test-traffic checkbox
defaulting **on**), a data-source badge (recent live vs. historical aggregates)
driven by the `source` field, overview cards, a dual-series events+users trend
chart, and command/version tables. On `403` it shows a "reload to re-authenticate
through Cloudflare Access" banner, on `503` a backend-unavailable notice, and
annotates distinct-user figures as approximate (with the cold-layer upper-bound
caveat).

### Local development / tests

```bash
npm test                      # Worker unit tests (vitest): fail-closed + ingest regression
npm run dev -- --noproxy '*'  # wrangler dev; --noproxy '*' avoids this machine's localhost proxy hijack
```

> Setup of the Access application, the SQL read token, and the custom domain are
> **manual** operator steps — see [RUNBOOK.md](./RUNBOOK.md).

## npm packaging note

`telemetry-backend/` lives at the repo root and is **not** in the CLI
`package.json` `files` whitelist (`dist`, `bin`, `schemas`, `pipelines`,
`scripts/postinstall.js`), so it is automatically excluded from the published
npm tarball. No `.npmignore` is needed.
