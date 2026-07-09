## Context

Upstream telemetry (`src/telemetry/index.ts`) uses `posthog-node` to POST `command_executed` events (`{ distinctId, command, version, surface, $ip:null }`) to `https://edge.openspec.dev`, a PostHog reverse proxy the fork does not own. The fork replaces this with maintainer-owned infrastructure. Batch B1 builds the backend; batch B2 rewrites the client to call it. B1 must land first so B2 has a deployed, verified endpoint URL.

Verified environment facts:
- wrangler 4.86.0 is installed and logged in (ws11579@gmail.com), account `5cc51d8388c780c03fb4c6161bd403c4` with Workers write scope — a real deploy is possible in the implementation task.
- The CLI package (`@fission-ai/openspec`) uses a `files` whitelist in package.json: `["dist","bin","schemas","pipelines","scripts/postinstall.js", …negations]`. A repo-root `telemetry-backend/` is not in the whitelist, so it is excluded from `npm pack` automatically — no `.npmignore` entry needed.
- Privacy contract (planning-context locked decision 6): only command + version + anonymous UUID (+ optional os / node_version); no paths, args, or project info; opt-out lives client-side (B2).

## Goals / Non-Goals

**Goals:**
- A minimal, single-file Cloudflare Worker under `telemetry-backend/` that ingests one event per request and writes it to Analytics Engine.
- Real `wrangler deploy` + a POST smoke test against the live URL.
- A maintainer README documenting the SQL-API read queries (DAU, group-by).
- Record the deployed endpoint URL for B2 to consume.

**Non-Goals:**
- Touching `src/telemetry/index.ts` or removing `posthog-node` — that is B2.
- A read/dashboard API, auth, rate limiting, or batching — out of scope for phase 1 (Analytics Engine + SQL API cover reads; volume is low).
- Bundling `telemetry-backend/` into the npm package.
- Renaming to a non-openspec identity — phase 1 keeps `openspec` branding (Worker name `openspec-telemetry`).

## Decisions

**D1 — Cloudflare Worker + Analytics Engine (not Workers KV / D1 / external DB).** Analytics Engine is purpose-built for high-cardinality write-heavy event ingestion with `writeDataPoint` (fire-and-forget, no read cost on the write path) and is queryable via the CF SQL API. This matches the upstream PostHog usage pattern (write events, aggregate later) with zero servers to run. Alternative KV/D1 would require manual aggregation and per-write cost; rejected.

**D2 — Data point shape.** `writeDataPoint({ blobs: [command, version, os, node_version], indexes: [distinctId], doubles: [] })`. `indexes` holds distinctId so `count(DISTINCT index1)` gives DAU; `blobs` hold the low-cardinality dimensions for `GROUP BY`. Analytics Engine samples at very high volume but phase-1 volume is far below sampling thresholds. No timestamp field needed — Analytics Engine records ingestion time automatically.

**D3 — Minimal validation, silent-friendly.** The Worker: accepts only `POST`, parses JSON, requires `command`/`version`/`distinctId` as non-empty strings, coerces/optionally reads `os`/`node_version`, ignores all other fields, then `writeDataPoint` and returns `202` (accepted) with a tiny body. Malformed → `400`; wrong method → `405`. It never echoes the payload and never reads client IP into storage. This mirrors the client's fire-and-forget expectation (client uses a ~1s timeout and swallows errors).

**D4 — Project layout.** `telemetry-backend/` at repo root: `src/index.ts` (Worker), `wrangler.toml` (Worker name `openspec-telemetry`, `account_id = 5cc51d8388c780c03fb4c6161bd403c4`, `[[analytics_engine_datasets]]` binding, e.g. binding `TELEMETRY` → dataset `openspec_telemetry`), `package.json` (wrangler devDep + `deploy`/`dev`/`tail` scripts), and `README.md` (deploy steps + SQL-API query patterns + privacy contract). Co-located because the fork is single-maintainer; excluded from npm pack by the existing whitelist.

**D5 — SQL-API reads are documented, not gated.** Reading Analytics Engine requires a Cloudflare API token with Account Analytics read scope, POSTing SQL to `https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`. The verification gate is the *write* path (POST event → 2xx, optionally `wrangler tail`). Read queries (`count()`, `count(DISTINCT index1)` for DAU, `GROUP BY blob1, blob2` for command/version breakdown) are documented in the README so the maintainer can run them out-of-band. This avoids blocking the change on token provisioning.

## Risks / Trade-offs

- **Analytics Engine ingestion isn't queryable for a short delay / is sampled at high volume** → acceptable for aggregate anonymous stats; document that reads reflect ingestion-time and sampling. Not a correctness gate.
- **Real deploy is outward-facing infrastructure** → the deploy task creates a live endpoint under the maintainer's account; that is intended (this IS the replacement backend). Endpoint URL recorded for B2.
- **SQL-API read needs a token not yet provisioned** → documented, not gated (D5); if the maintainer wants live read verification, that is a follow-up, not a blocker for B1.
- **npm pack could accidentally include telemetry-backend/ if the `files` whitelist changes** → seam note for `fork-phase1-release-prep` (C) to confirm pack contents; no action expected now.
- **Worker CORS/method surface** → the client is a Node CLI (no browser CORS), so no CORS headers required; only POST is accepted.

## Migration Plan

1. Scaffold `telemetry-backend/` (Worker + wrangler.toml + package.json + README).
2. `wrangler deploy` to the authenticated account; capture the deployed `*.workers.dev` URL (or custom route).
3. Smoke-test: POST a synthetic event, expect 2xx; optionally `wrangler tail` to observe.
4. Record the endpoint URL in the change ship-log/notes for B2.
5. Rollback: `wrangler delete` removes the Worker; no CLI-package change is coupled to B1, so reverting is isolated. B2 (client) only proceeds once this URL exists.

## Open Questions

- Final dataset name and whether a custom domain/route is used vs. the default `openspec-telemetry.<subdomain>.workers.dev` — resolve at deploy; record whichever URL is live.
- Whether to add a lightweight shared-secret header now or defer — deferred (phase-1 volume low, payload non-sensitive); note as possible future hardening.
