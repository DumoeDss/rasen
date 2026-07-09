## Why

The telemetry Worker (`openspec-telemetry`) ingests anonymous CLI usage but has no way to *see* it — reading the data means hand-running SQL API `curl` calls out of band. Maintainers need a private, always-available dashboard (daily active users, per-command / per-version breakdowns) without standing up a second service or exposing any of the anonymous data publicly. Cloudflare Access on a maintainer-owned domain gives edge authentication with zero credentials in the browser; extending the existing Worker keeps the ingest path and the admin path on one origin so the admin API is same-origin and cookie/JWT-authenticated for free.

## What Changes

- **Add an authenticated admin panel** at `/admin` served by the *same* Worker: a single self-contained `admin/index.html` (vanilla JS + `fetch` + inline SVG charts), no build chain, hosted via a Workers `[assets]` binding.
- **Add a read-only stats API** at `/api/admin/*` that queries the Analytics Engine dataset through the Cloudflare SQL API server-side (overview totals for 24h/7d, DAU daily series, command breakdown, version breakdown). Event counts use sampling-accurate `SUM(_sample_interval)`; distinct-user counts use `count(DISTINCT index1)` and are labelled approximate.
- **Enforce Cloudflare Access at the edge AND fail-closed in the Worker.** An Access self-hosted app fronts `telemetry.rasen.io/admin*`; because the `*.workers.dev` host does not pass through Access, the Worker independently verifies the `Cf-Access-Jwt-Assertion` JWT (JWKS / aud / iss / exp / RS256) on every `/admin*` and `/api/admin*` request across ALL hosts. **Fail-closed**: when Access env vars are absent, or the JWT is missing/invalid, admin paths return a static 403 — the admin HTML is never servable from `workers.dev` without a valid Access identity.
- **Preserve the public ingest path unchanged.** `POST /` to the `workers.dev` URL (hard-coded in shipped CLI clients) keeps its 202/400/405 semantics and privacy contract byte-for-byte; the `workers.dev` route stays enabled.
- **Attach the custom domain `telemetry.rasen.io`** as a retryable final task (the `rasen.io` zone may still be propagating NS to Cloudflare); development and deploy to `workers.dev` proceed regardless of zone status.
- **Ship an operator runbook** documenting the two manual Cloudflare steps (create the Analytics Read API token → `wrangler secret put TELEMETRY_SQL_TOKEN`; create the Zero Trust Access app → backfill team domain + AUD) to exact dashboard buttons.

## Capabilities

### New Capabilities
- `telemetry-admin-console`: An authenticated maintainer dashboard on the telemetry Worker — Access-gated admin panel serving, fail-closed in-Worker JWT enforcement on all admin routes across every host, a SQL-API-backed read-only stats API with graceful degradation when the read token is unconfigured, and custom-domain delivery.

### Modified Capabilities
- `telemetry-backend`: The "only accept the documented HTTP method" / minimal-validation rule is scoped to the **ingest endpoint** (`POST /`) rather than the whole Worker, so authenticated `GET /admin` and `GET /api/admin/*` responses do not violate it. The ingest requirement, privacy contract, and Analytics Engine persistence are otherwise unchanged.

## Impact

- **Code**: `telemetry-backend/src/index.ts` (routing split: ingest vs `/admin*` vs `/api/admin*`), new modules for Access JWT verification and SQL-API stats, new `telemetry-backend/admin/index.html`.
- **Config**: `telemetry-backend/wrangler.toml` gains an `[assets]` block with `run_worker_first = true` (security-critical — the Worker must run before any asset is served), Access vars (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), and a retryable custom-domain `route`.
- **Dependencies**: adds `jose` for JWT verification (bundled by wrangler/esbuild at deploy — introduces no separate build step; the Worker stays build-chain-free).
- **Secrets**: new `TELEMETRY_SQL_TOKEN` (Account Analytics Read); missing → stats API returns a clean 503, never crashes.
- **External / manual**: Cloudflare Zero Trust Access application + policy; Cloudflare Analytics Read API token; `rasen.io` zone reaching Active. Documented as a runbook; these gate live end-to-end panel rendering but not this change's review/ship.
- **Docs**: `telemetry-backend/README.md` gains admin-console + runbook sections.
