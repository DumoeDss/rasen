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

## npm packaging note

`telemetry-backend/` lives at the repo root and is **not** in the CLI
`package.json` `files` whitelist (`dist`, `bin`, `schemas`, `pipelines`,
`scripts/postinstall.js`), so it is automatically excluded from the published
npm tarball. No `.npmignore` is needed.
