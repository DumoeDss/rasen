## Context

`openspec-telemetry` is a bare `fetch`-handler Worker (no framework, no runtime deps, no build step) live at `https://openspec-telemetry.ws11579.workers.dev`. It accepts `POST /` anonymous events and writes them to the `openspec_telemetry` Analytics Engine dataset. Reads today are out-of-band SQL API `curl`. This change bolts an authenticated admin dashboard onto the *same* Worker, following the same-origin model proven by the elftia `backend-cf` admin console (referenced read-only; different repo, Hono stack — we borrow the model, not the framework).

Hard constraints from planning (locked, not re-litigated):
- Same Worker (方案 A), no second Worker.
- Public ingest (`POST /` on `workers.dev`) is byte-for-byte unchanged; the shipped CLI hard-codes that URL.
- Cloudflare Access at the edge + fail-closed in-Worker JWT enforcement (the `workers.dev` host bypasses Access, so the Worker must self-verify).
- Stats read via CF SQL API (the AE binding is write-only); read token is a secret.
- Single-file panel, no npm build chain.
- Delivery mode `local` (commit, no push). Deploy to `workers.dev` IS in scope (wrangler is authenticated).
- Account `5cc51d8388c780c03fb4c6161bd403c4`; column map `blob1=command, blob2=version, blob3=os, blob4=node_version, index1=distinctId, timestamp=ingest time`.

## Goals / Non-Goals

**Goals:**
- Serve a private admin panel and read-only stats API from the existing Worker with zero regression to ingest.
- Make the admin surface fail-closed on **every** host, including `workers.dev`, so the panel and its data are never reachable without a valid Access identity.
- Keep the Worker build-chain-free and the panel a single self-contained file.
- Degrade gracefully (clean 503, no crash) when the SQL read token or Access config is absent, so a deploy is always safe.

**Non-Goals:**
- No mutations of any kind — the admin API is read-only over aggregate anonymous stats (no user records exist to mutate; the ingest privacy contract forbids identifying data).
- No login UI, no session/cookie management, no CSRF machinery — Access authenticates at the edge; the panel carries no credentials.
- No multi-file SPA / bundler / React. No PostHog or third-party analytics UI.
- Custom-domain provisioning is best-effort/retryable, not a blocker for shipping the Worker.

## Decisions

### D1 — Routing & asset serving: `[assets]` + `run_worker_first = true`, gate before `env.ASSETS.fetch` (SECURITY-CRITICAL)

The panel HTML lives at `telemetry-backend/admin/index.html` and is served through a Workers static-assets binding:

```toml
[assets]
binding = "ASSETS"
directory = "./admin"
run_worker_first = true
not_found_handling = "none"
```

`run_worker_first = true` is the load-bearing security control. Semantics (verified against the live elftia deployment's wrangler.toml + `src/index.ts`, wrangler 4.x):

- With `run_worker_first = true`, the **Worker script runs first for every request**. Static assets are served **only** when the Worker code explicitly calls `env.ASSETS.fetch(request)`.
- Therefore the Worker gates `/admin*` (verify JWT) **before** it ever calls `env.ASSETS.fetch`. On `workers.dev` (no Access edge), an unauthenticated `GET /admin` returns the sealed static 403 and never touches the asset binding — the HTML cannot leak.
- **Without** `run_worker_first = true` (the default), the static-assets runtime answers a matching path (e.g. `/admin/index.html`, `/admin/`) **before** the Worker runs — the admin HTML would be served straight off `workers.dev` with no auth. This is exactly the "open, data-less admin console with no login" failure the task warns about, so `run_worker_first = true` is a **mandatory, tested invariant**.
- `not_found_handling = "none"`: the binding does no SPA fallback; the Worker owns all fallback. For a single file we don't need SPA rewriting.

Request routing inside `fetch`, in order:
1. `POST /` (and any non-`/admin`, non-`/api/admin` path) → existing ingest handler, unchanged. `POST /` → 202/400; other methods on `/` → 405.
2. `/api/admin/*` → JWT gate → stats handler (JSON). Gate failure → JSON 401/403 (never HTML).
3. `/admin` or `/admin/*` → JWT gate → on pass, `env.ASSETS.fetch` serves `admin/index.html`; on fail, sealed static **403** HTML (`no-store`, `nosniff`, `noindex`).

*Alternative considered — inline the HTML as a Worker string constant (no `[assets]` binding at all).* This is marginally *more* airtight (the bytes literally cannot be served except by returning the constant after the gate) and needs no binding, but it buries a growing HTML document inside a TS template literal, which the planning context explicitly steers away from ("single-file static `admin/index.html`", mirror elftia's `[assets]` model). Rejected in favour of the `[assets]` + `run_worker_first` model, whose security is equivalent as long as the gate precedes `env.ASSETS.fetch` — which we assert with a test.

### D2 — Access JWT verification via `jose` (mirrors elftia `services/admin.ts`)

Verification steps, applied to every `/admin*` and `/api/admin*` request:
1. **Config gate (fail-closed):** if `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is absent/empty → deny (admin HTML → sealed 403; admin API → 403 JSON). Checked *before* reading the token, so an un-provisioned deploy exposes no admin behaviour.
2. Read the token from the `Cf-Access-Jwt-Assertion` header (Access injects it server-side after its edge login). A `CF_Authorization` cookie fallback exists but is not needed for the same-origin header path; header-only mirrors elftia.
3. Verify with `jose` `jwtVerify(token, jwks, { algorithms: ["RS256"], audience: ACCESS_AUD, issuer: 'https://<ACCESS_TEAM_DOMAIN>' })`, where `jwks = createRemoteJWKSet(new URL('https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs'))`. `jwtVerify` enforces `exp`/`nbf` automatically.
4. On any failure (missing/expired/bad-sig/wrong-aud/wrong-iss) → deny. On success, optionally check the `email` claim against an optional `ACCESS_ALLOWED_EMAILS` allowlist (defense-in-depth atop the Access policy; when unset, a valid Access JWT for this AUD is sufficient since the Access policy already restricts to the maintainer's email).

JWKS `createRemoteJWKSet` results are cached per-URL in an isolate-level `Map` (elftia idiom) so verification does not re-fetch certs on every request. A module-level overridable certs-URL constant lets unit tests inject a local JWKS.

*Why `jose` over hand-rolled WebCrypto RS256.* The Worker currently has zero runtime deps, so adding one is a real cost. But hand-rolling JWKS fetch + JWK→CryptoKey import + RS256 `crypto.subtle.verify` + claim checks is ~60 lines of security-sensitive code; `jose` is the elftia-proven, well-tested path, runs in Workers on WebCrypto (no `nodejs_compat` needed), and is bundled by wrangler/esbuild at deploy — it introduces **no separate build step**, so "the Worker stays build-chain-free" holds. Net: correctness and parity beat dependency-count here.

### D3 — Stats via CF SQL API, server-side, with graceful 503

The AE binding is write-only, so stats read through the SQL API: `POST https://api.cloudflare.com/client/v4/accounts/5cc51d8388c780c03fb4c6161bd403c4/analytics_engine/sql`, `Authorization: Bearer <TELEMETRY_SQL_TOKEN>`, body = SQL as `text/plain`. The token is a secret set via `wrangler secret put TELEMETRY_SQL_TOKEN`.

- **Missing `TELEMETRY_SQL_TOKEN` → 503** with `{ error, hint }` (never a crash, never a 500). The panel renders a "stats read token not configured" notice.
- **Counts use `SUM(_sample_interval)`** (sampling-accurate) and are labelled as event counts. **`count(DISTINCT index1)`** distinct-user counts are returned but flagged `approximate: true` (sampling makes distinct counts approximate — B1 review conclusion).
- Endpoints (all read-only JSON):
  - `GET /api/admin/overview` — total events + distinct users for last 24h and last 7d.
  - `GET /api/admin/dau?days=N` — daily event + distinct-user series (N clamped, default 14, max 30).
  - `GET /api/admin/commands?days=N` — per-`blob1` breakdown (events desc).
  - `GET /api/admin/versions?days=N` — per-`blob2` breakdown.
- Each handler validates/clamps `days`, builds a parameter-free SQL string from a fixed template (no user-interpolated SQL — `days` is an integer bound), and normalizes the SQL API JSON envelope (`{ data: [...] }` or error) into the panel's shape. SQL API HTTP errors (401/403/5xx from Cloudflare) map to a 502/503 with the upstream status echoed in the hint.

### D4 — Custom domain `telemetry.rasen.io` as a retryable final task

`wrangler.toml` gains a route while keeping `workers.dev` enabled:

```toml
routes = [{ pattern = "telemetry.rasen.io", custom_domain = true }]
```

The `rasen.io` zone (account `5cc51d8388…`) may still be propagating NS to Cloudflare. Ordering: everything else develops and deploys to `workers.dev` first. The custom-domain attach is the **last** task; it (a) checks zone Active (`nslookup -type=NS rasen.io` shows `*.ns.cloudflare.com`), (b) if Active, `wrangler deploy` mounts the route and we smoke `https://telemetry.rasen.io/`; (c) if not Active, record as "pending retry" and ship without it — the route line can stay in `wrangler.toml` uncommented only once the zone exists, else a deploy would fail, so if the zone is not Active we keep the route line **commented** with a re-enable note.

### D5 — Modified `telemetry-backend` spec: scope the method rule to ingest

The existing spec's "Non-POST method is rejected (GET → non-2xx)" scenario would be violated by an authenticated `GET /admin` returning 200. We scope that requirement's method/validation rule to the **ingest endpoint** (`POST /`), leaving ingest behaviour otherwise identical. No change to the privacy contract, persistence, or the ingest success/`400` paths.

## Risks / Trade-offs

- **[Asset layer serves admin HTML before the Worker runs]** → `run_worker_first = true` set and asserted by a smoke test: an unauthenticated `GET /admin` on the deployed `workers.dev` host MUST return 403, not the HTML. This is the single most important verification gate.
- **[Ingest regression from routing changes]** → the ingest branch is reached first and untouched; a Worker test/smoke asserts `POST /` → 202 and `GET /` → 405 still hold after the split.
- **[Fail-open if Access env is half-configured]** → config gate requires ALL Access vars present *before* reading the token; any missing var → deny. Tested: no env → 403; forged/absent JWT with env present → 403.
- **[SQL injection via `days`]** → `days` is parsed to a clamped integer and inserted as a numeric literal into a fixed template; no string interpolation of user input. No other user-controlled query input exists.
- **[SQL API token scope too broad]** → runbook specifies an **Account Analytics Read**-only token, distinct from the Workers deploy credential; leaked, it reads aggregate anonymous stats only.
- **[`jose` bundle size / Workers compat]** → `jose` targets WebCrypto and runs in Workers without `nodejs_compat`; bundle impact is small and only on the admin path. Accepted.
- **[Custom domain deploy fails on inactive zone]** → route stays commented until the zone is Active; attach is isolated as the last, retryable task and never blocks the `workers.dev` deploy or this change's ship.

## Migration Plan

1. Add `jose` dep + `[assets]`/Access vars/(commented) route to `wrangler.toml`; split routing in `src/index.ts`; add JWT-verify + stats modules + `admin/index.html`.
2. Verify locally (Worker unit tests / `wrangler dev --noproxy '*'`): ingest regression + admin fail-closed.
3. `wrangler deploy` to `workers.dev`. Live smoke: `POST /` → 202, `GET /` → 405, `GET /admin` → 403 (Access env not yet set), `GET /api/admin/overview` → 403 (or 503 if only SQL token missing behind a valid identity).
4. Operator runbook steps (manual, out-of-band): create Analytics Read token → `wrangler secret put TELEMETRY_SQL_TOKEN`; create Zero Trust Access app (self-hosted, `telemetry.rasen.io`, path `/admin*`, policy allow `ws11579@gmail.com`) → set `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`.
5. When `rasen.io` is Active: uncomment the route, `wrangler deploy`, smoke `telemetry.rasen.io`.

**Rollback:** revert `wrangler.toml` + `src/` and `wrangler deploy` restores the ingest-only Worker; no CLI-package coupling. Removing the Access app or the route leaves ingest fully functional.

## Open Questions

- Should `ACCESS_ALLOWED_EMAILS` be required (defense-in-depth) or optional? Design treats it as optional since the Access policy already pins the maintainer email; a valid JWT for this AUD is sufficient. Left optional to avoid a second place to update the allowed identity.
