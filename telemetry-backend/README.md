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

### Stats API

Read-only JSON over the Analytics Engine dataset via the CF SQL API
(`src/stats.ts`). Event counts use `SUM(_sample_interval)` (sampling-accurate);
distinct-user counts use `count(DISTINCT index1)` and are flagged
`usersApproximate: true`.

| Endpoint                     | Returns                                             |
| ---------------------------- | --------------------------------------------------- |
| `GET /api/admin/overview`    | total events + distinct users for last 24h and 7d   |
| `GET /api/admin/dau?days=N`  | daily event + distinct-user series (N clamped 1..30, default 14) |
| `GET /api/admin/commands?days=N` | per-command breakdown (events desc)             |
| `GET /api/admin/versions?days=N` | per-version breakdown                            |

Graceful degradation (deploy is always safe):

- `TELEMETRY_SQL_TOKEN` unset → stats endpoints return **503** with a hint (never
  a crash); the panel shows a "read token not configured" notice.
- CF SQL API upstream error → **502/503** with the upstream status echoed in the
  hint.

### Panel

`admin/index.html` is a single self-contained file (vanilla JS + `fetch` + inline
SVG chart) — no bundler, no build step, no credentials in the browser. It renders
overview cards, a DAU line chart, and command/version tables; on `403` it shows a
"reload to re-authenticate through Cloudflare Access" banner, on `503` a
"read token not configured" notice, and annotates distinct-user figures as
approximate.

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
