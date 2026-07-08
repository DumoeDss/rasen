# telemetry-admin-console — implementation notes

## Deploy

- Worker `openspec-telemetry`, account `5cc51d8388c780c03fb4c6161bd403c4`.
- Live Version ID (final): `9a114f41-da85-4ade-9662-31ca6f21e184`.
- Routes ACTIVE on both hosts: `https://openspec-telemetry.ws11579.workers.dev`
  (workers.dev, kept for the hard-coded CLI ingest URL) **and**
  `telemetry.rasen.io` (custom domain).
- `jose` (5.10.0) is bundled by wrangler/esbuild at deploy — no build step added.

## Live smoke matrix (workers.dev, Access env still empty = fail-closed)

| Request                     | Result | Meaning                              |
| --------------------------- | ------ | ------------------------------------ |
| POST / valid                | 202    | ingest intact                        |
| POST / missing field        | 400    | ingest validation intact             |
| GET /                       | 405    | ingest method rule intact            |
| GET /admin                  | 403    | fail-closed; body is sealed 403 HTML |
| GET /admin/                 | 403    | fail-closed                          |
| GET /api/admin/overview     | 403    | fail-closed (JSON)                   |
| /admin panel-leak grep      | SEALED | panel HTML NOT served from workers.dev |

The single most important invariant — `run_worker_first = true` + gate before
`env.ASSETS.fetch` — is proven live: the panel cannot be fetched from workers.dev
without a valid Access identity.

## Custom domain `telemetry.rasen.io` — LIVE and verified (2026-07-09)

- Zone Active (NS = kevin/kami.ns.cloudflare.com); route attached (`wrangler deploy`
  reports `telemetry.rasen.io (custom domain)`, latest Version `ddc983a6`).
- The edge TLS cert finished provisioning; the custom domain now answers end-to-end.
- **Live smoke matrix on `https://telemetry.rasen.io` (Access env still empty):**

  | Request                        | Result | Meaning                       |
  | ------------------------------ | ------ | ----------------------------- |
  | POST / (distinctId `custom-domain-smoke`) | 202 | ingest live on custom domain |
  | GET /                          | 405    | ingest method rule            |
  | GET /admin                     | 403    | fail-closed (Access app not created) |
  | GET /api/admin/overview        | 403    | fail-closed (JSON)            |
  | /admin panel-leak grep         | SEALED | panel HTML not served         |

- **workers.dev regression re-confirmed:** POST / → 202, GET /admin → 403. Both
  hosts serve the same Worker; the hard-coded CLI ingest URL is unaffected.

## wrangler.toml gotchas hit (recorded so a re-deploy doesn't regress)

1. `routes` MUST be a top-level key placed BEFORE any `[table]` header. Placed
   after `[vars]`, TOML scopes it into `[vars]` and wrangler treats it as an env
   var named `routes` (silently no route attached).
2. Declaring `routes` DISABLES the `workers.dev` route by default. Because the
   shipped CLI hard-codes the workers.dev URL, `workers_dev = true` is set
   explicitly to keep BOTH hosts serving. (A deploy without it would break
   telemetry for every installed CLI.)

## Testing note (jose JWKS)

jose's Node build fetches JWKS over `node:https` directly, so a stubbed global
`fetch` does NOT intercept it. `src/access.ts` exposes a production-inert test
hook `ACCESS_URLS.keySet`; the Worker unit tests inject an in-memory
`createLocalJWKSet` and mint a real RS256 token, so the valid-JWT path is
verified offline. 13/13 Worker tests pass (`npm test` in telemetry-backend).

## Operator manual steps (see RUNBOOK.md) — gate live panel data, not this ship

1. Create an Account Analytics Read API token → `wrangler secret put TELEMETRY_SQL_TOKEN`
   (until then `/api/admin/*` → 503 with hint, no crash).
2. Create the Zero Trust Access self-hosted app for `telemetry.rasen.io/admin*`,
   policy allow `ws11579@gmail.com` → set `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`
   (until then all admin paths → 403).
