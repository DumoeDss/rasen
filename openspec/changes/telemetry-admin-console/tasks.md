## 1. Wrangler config & dependencies

- [x] 1.1 Add `jose` to `telemetry-backend/package.json` dependencies (runtime dep; bundled by wrangler/esbuild — no build step added); run `pnpm install`/`npm install` so a lockfile entry exists.
- [x] 1.2 In `telemetry-backend/wrangler.toml` add an `[assets]` block: `binding = "ASSETS"`, `directory = "./admin"`, `run_worker_first = true`, `not_found_handling = "none"`. (SECURITY-CRITICAL: `run_worker_first = true` makes the Worker run before any asset is served.)
- [x] 1.3 In `telemetry-backend/wrangler.toml` add Access vars under `[vars]`: `ACCESS_TEAM_DOMAIN = ""` and `ACCESS_AUD = ""` (empty = fail-closed until backfilled), with a comment that they are set post-Access-app-creation and that `ACCESS_ALLOWED_EMAILS` is optional defense-in-depth.
- [x] 1.4 In `telemetry-backend/wrangler.toml` add the custom-domain route COMMENTED with a re-enable note: `# routes = [{ pattern = "telemetry.rasen.io", custom_domain = true }]  # uncomment once rasen.io zone is Active` (keeps workers.dev deploy working while the zone propagates).

## 2. Access JWT verification module

- [x] 2.1 Create `telemetry-backend/src/access.ts`: `isAccessConfigured(env)` (true only when `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are both present/non-empty) and a per-URL isolate-level JWKS cache (`Map<string, ReturnType<typeof createRemoteJWKSet>>`) with a test-overridable certs-URL constant defaulting to `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`.
- [x] 2.2 In `access.ts` add `verifyAccessJwt(env, token)`: `jose.jwtVerify(token, jwks, { algorithms: ["RS256"], audience: env.ACCESS_AUD, issuer: 'https://'+env.ACCESS_TEAM_DOMAIN })`, return lowercased `email` claim or `null` on any failure.
- [x] 2.3 In `access.ts` add `verifyAdminAccess(env, headerToken)`: fail-closed collapse — `null` when unconfigured, token missing, JWT invalid, or (if `ACCESS_ALLOWED_EMAILS` set) email not allowlisted; otherwise `{ email }`. This is the single gate the router calls.

## 3. Stats API module (CF SQL API)

- [x] 3.1 Create `telemetry-backend/src/stats.ts`: a `runSql(env, sql)` helper that POSTs to `https://api.cloudflare.com/client/v4/accounts/5cc51d8388c780c03fb4c6161bd403c4/analytics_engine/sql` with `Authorization: Bearer ${env.TELEMETRY_SQL_TOKEN}` and `text/plain` body; returns a typed result or a discriminated error (`token_missing` when `TELEMETRY_SQL_TOKEN` absent → maps to 503; `upstream` with status when the SQL API 4xx/5xx → maps to 502/503).
- [x] 3.2 Implement query builders using the column map (`blob1`=command, `blob2`=version, `index1`=distinctId, `timestamp`) with `SUM(_sample_interval)` for event counts and `count(DISTINCT index1)` for distinct users; `days` parsed to a clamped integer literal (default 14, max 30) — never string-interpolate user input.
- [x] 3.3 Implement four handlers returning JSON: overview (24h + 7d totals), dau (`?days=N` series), commands (`?days=N` breakdown), versions (`?days=N` breakdown); distinct-user fields carry `approximate: true`.

## 4. Router split in the Worker

- [x] 4.1 Refactor `telemetry-backend/src/index.ts` `fetch` to branch by path FIRST: (a) `/api/admin/*` → `verifyAdminAccess` gate, on fail return JSON `403` (unconfigured/invalid) — never HTML; on pass dispatch to the stats handlers; (b) `/admin` or `/admin/*` → `verifyAdminAccess` gate, on pass `await env.ASSETS.fetch(request)` (serve `admin/index.html`), on fail return the sealed static `403` HTML (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`); (c) everything else → the EXISTING ingest handler unchanged.
- [x] 4.2 Verify the ingest branch is byte-for-byte behavior-preserving: `POST /` still 202/400, non-POST on `/` still 405, privacy contract untouched. The admin gate MUST run before any `env.ASSETS.fetch` call (assert order).
- [x] 4.3 Extend the `Env` interface with `ASSETS: Fetcher`, `ACCESS_TEAM_DOMAIN?`, `ACCESS_AUD?`, `ACCESS_ALLOWED_EMAILS?`, `TELEMETRY_SQL_TOKEN?`.

## 5. Admin panel (single file)

- [x] 5.1 Create `telemetry-backend/admin/index.html`: self-contained vanilla-JS panel — fetches `/api/admin/overview|dau|commands|versions`, renders overview cards (24h/7d events + approx distinct users), a DAU line chart (inline SVG), and command/version tables. No external assets, no build.
- [x] 5.2 Handle the auth/degraded states in the panel: on `403` show a "reload to re-authenticate through Cloudflare Access" banner; on `503` show a "stats read token not configured" notice; distinct-user figures visibly annotated "approximate (sampled)".

## 6. Tests (fail-closed + ingest regression)

- [x] 6.1 Add a Worker test harness to `telemetry-backend` (vitest + `@cloudflare/vitest-pool-workers`, or unit tests over the exported handler with a mocked `env`/`ASSETS`/JWKS) and a `test` script in `package.json`.
- [x] 6.2 Test fail-closed admin: no Access env → `GET /admin` → 403 (HTML, no panel bytes) and `GET /api/admin/overview` → 403 (JSON); env present but missing/forged `Cf-Access-Jwt-Assertion` → 403; the admin gate runs before `env.ASSETS.fetch`.
- [x] 6.3 Test ingest regression: `POST /` valid → 202; `POST /` missing field → 400; `GET /` → 405; unexpected fields not persisted.
- [x] 6.4 Test stats degradation: valid identity + missing `TELEMETRY_SQL_TOKEN` → 503 with hint (no crash); `days` out of range is clamped.

## 7. Deploy & live smoke (workers.dev)

- [x] 7.1 `wrangler deploy` from `telemetry-backend` (deploy is in scope; wrangler is authenticated).
- [x] 7.2 Live workers.dev smoke: `POST /` → 202, `GET /` → 405 (ingest intact); `GET /admin` → 403 and `GET /api/admin/overview` → 403 (Access env not yet backfilled) — proving the HTML does NOT leak from workers.dev without an Access identity.

## 8. Docs & runbook

- [x] 8.1 Add an "Admin console" section to `telemetry-backend/README.md`: routes, auth model (edge Access + in-Worker fail-closed), single-file panel, SQL-API stats with sampling notes.
- [x] 8.2 Write the operator runbook (in `telemetry-backend/README.md` or a `telemetry-backend/RUNBOOK.md`) with exact Cloudflare dashboard steps: (a) create an **Account Analytics Read** API token → `wrangler secret put TELEMETRY_SQL_TOKEN`; (b) Zero Trust → Access → Applications → Add self-hosted app (domain `telemetry.rasen.io`, path `/admin*`), policy = allow email `ws11579@gmail.com` → copy the Application AUD + team domain → set `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` (vars) and `wrangler deploy`.

## 9. Custom domain attach (retryable, last)

- [x] 9.1 Check zone status: `nslookup -type=NS rasen.io` shows `*.ns.cloudflare.com`. If Active: uncomment the `routes` line in `wrangler.toml`, `wrangler deploy`, smoke `https://telemetry.rasen.io/` (ingest 202) and `/admin` (403 pre-Access). If not Active: leave the route commented and record "pending retry" in the change notes — do NOT block ship. OUTCOME: zone Active (NS = kevin/kami.ns.cloudflare.com). Route attached (`wrangler deploy` reports `telemetry.rasen.io (custom domain)`; DNS → Cloudflare IPs). Also set `workers_dev = true` (declaring `routes` disables workers.dev by default, which would break the hard-coded CLI ingest URL) and moved `routes` above `[vars]` (TOML scoping). Custom-domain HTTPS now LIVE (cert provisioned): smoke on `https://telemetry.rasen.io` → POST / 202 (distinctId `custom-domain-smoke`), GET / 405, GET /admin 403 (sealed, panel not leaked), GET /api/admin/overview 403; workers.dev regression POST / → 202, /admin → 403. See notes.md.
