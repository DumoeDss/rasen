# Review Report — telemetry-admin-console

**Reviewer:** reviewer-b1 (independent; did not author this change; also reviewed the B1 telemetry backend and B2 client)
**Date:** 2026-07-09
**Branch:** dev-harness
**Scope reviewed:** `telemetry-backend/` diff only — `src/index.ts` (modified), `src/access.ts` + `src/stats.ts` (new), `admin/index.html` (new), `wrangler.toml`, `package.json` + `package-lock.json` (jose), `README.md`, `RUNBOOK.md`, `test/worker.test.ts` — plus `openspec/changes/telemetry-admin-console/` artifacts. Out-of-scope siblings (`bin/rasen.js` rename, root `package.json`, `scripts/pack-version-check.mjs`, `test/commands/*`, phase2-rasen-* change dirs) were NOT reviewed.

## Verdict

**APPROVE.** All 5 ADDED requirements + the 1 MODIFIED requirement are implemented correctly. The fail-closed Access gate is airtight — verified by code reading, 13/13 passing unit tests with real RS256 signatures, and extended live adversarial probing of the deployed Worker. No Blockers, no Majors. One Minor (a stale RUNBOOK step) and a few Trivial/informational test-coverage gaps.

---

## Live verification evidence (deployed Worker, distinctId "reviewer-test", no redeploy/edits)

Base matrix (re-confirmed): `GET /admin → 403`, `GET /admin/index.html → 403`, `GET /api/admin/overview → 403`, `POST / → 202`, `GET / → 405`.

Extended adversarial probes — all pass:
| Probe | Result | Why it matters |
| --- | --- | --- |
| `GET /admin` with garbage `Cf-Access-Jwt-Assertion` | 403 | Header is cryptographically verified, not trusted |
| `GET /api/admin/overview` with garbage header | 403 | Same, JSON surface |
| `POST /admin` | 403 (not 405) | Auth gate runs BEFORE method handling |
| `POST /api/admin/overview` | 403 | Gate-first on the API surface too |
| `GET /index.html` (asset off a non-/admin path) | **405** | **Proves `run_worker_first=true` — the panel asset is NOT auto-served; it falls through to ingest** |
| `GET /admin/../index.html` | **405** | URL normalizes to `/index.html` → ingest; no path-traversal leak |
| `GET /admin/` (trailing slash) | 403 | `startsWith('/admin/')` gated |
| `GET /api/adminx` (prefix confusion) | 405 | Not matched as admin API; falls to ingest — no stats leak |
| `/admin` 403 body | sealed static notice, `grep "openspec-telemetry · admin"` = 0 | Panel HTML never leaks in the 403 |
| `POST https://telemetry.rasen.io/` (custom domain, `--noproxy`) | 202 | Custom domain live; ingest works on both hosts |
| `GET https://telemetry.rasen.io/admin` | 403 | In-Worker gate fires on the custom domain too |
| `GET https://telemetry.rasen.io/` | 405 | Ingest method rule identical on custom domain |
| `GET https://telemetry.rasen.io/index.html` | 405 | No asset leak on the custom domain either — `run_worker_first` holds on both hosts |

Custom-domain matrix re-confirmed fresh after the sanctioned route-attach + redeploy (`wrangler.toml` re-read: route `telemetry.rasen.io` active, `workers_dev=true` retained, `[assets]` flags unchanged). Both hosts are the same Worker and behave identically.

Unit tests: `npx vitest run` in `telemetry-backend/` → **13/13 pass** (86ms), including real RS256 mint/verify via `jose` with an injected local JWKS.

---

## Spec conformance

| Requirement | Status | Evidence |
| --- | --- | --- |
| Access-Gated Admin Panel Serving | PASS | `index.ts:137-144` gate before `env.ASSETS.fetch`; self-contained `admin/index.html`; live `/admin → 403`, unit test serves panel via `/index.html` only with valid JWT |
| Fail-Closed In-Worker Access Enforcement | PASS | `access.ts:103-114` collapses unconfigured/missing/invalid → null; `isAccessConfigured` requires BOTH vars (`:52-54`); enforced on every host (no edge dependency); live garbage-header → 403 |
| Aggregate Stats API | PASS | `stats.ts` overview/dau/commands/versions; `SUM(_sample_interval)` for events (`:111`), `count(DISTINCT index1)` labelled `usersApproximate:true`; read-only (SELECT only) |
| Graceful Degradation When Read Token Absent | PASS | `runSql` token check → `token_missing` → 503 `stats_unconfigured` (`:36-38,92-99`); upstream error → 502/503, never a crash; unit-tested |
| Custom Domain Delivery | PASS | `wrangler.toml:10,16` `workers_dev=true` + custom-domain route; live-verified both hosts answer |
| MODIFIED: Minimal Validation (ingest scoped) | PASS | `handleIngest` (`index.ts:75-121`) byte-preserved: `POST / → 202/400`, non-POST `/ → 405`; admin routes correctly excluded from the POST-only rule |

## Auth correctness (highest-risk — detailed)

- **jose usage** (`access.ts:85-89`): `algorithms:['RS256']` pins the alg (defeats `alg:none`/HS256 confusion); `audience:env.ACCESS_AUD` and `issuer:'https://'+ACCESS_TEAM_DOMAIN` are both bound; `jwtVerify` enforces `exp`/`nbf` automatically. Wrong-audience → 403 is unit-tested; garbage token → 403 is both unit- and live-tested.
- **JWKS caching** (`:37-46`): `Map` keyed by the derived certs URL, which is a function of the trusted `ACCESS_TEAM_DOMAIN` env var (never attacker input) — no cross-team poisoning is possible, and certs aren't re-fetched per request.
- **Config gate ordering**: `verifyAdminAccess` checks `isAccessConfigured` (both vars non-empty) BEFORE reading the token (`:107-108`); `verifyAccessJwt` re-checks it too (`:83`). Unset config → null → 403 everywhere. Live state (vars empty) shows exactly this.
- **No auth-bypass path**: `index.ts` gates `/api/admin*` (`:129-133`) and `/admin*` (`:137-144`) before `handleAdminApi` / `env.ASSETS.fetch`; every other path goes to public ingest. `handleAdminApi` is never called without a prior successful gate. Confirmed live that `/index.html` and `/admin/../index.html` cannot reach the asset.
- **Header spoofing**: `Cf-Access-Jwt-Assertion` is verified against the Access team's remote JWKS, not trusted — unforgeable without the Access private key. Fail-closed on `workers.dev` (no Access edge) is the whole point of the in-Worker layer.
- **Error/timing hygiene**: every failure collapses to `null` inside a `try/catch` (`:93-95`); no stack traces or config values ever reach the response.

## Routing / assets security

`wrangler.toml [assets]` has `run_worker_first=true` and `not_found_handling="none"` (`:32-33`) — the Worker owns all routing and no SPA fallback auto-serves assets. Live `GET /index.html → 405` is direct proof the static runtime does not answer before the Worker. Ingest precedence (`POST /`) is unbroken. The asset request is hardcoded to `/index.html` (`index.ts:142`), so no client-controlled path reaches the asset binding.

## Stats API safety

- **SQL injection surface**: the only client-controlled value reaching SQL is `days`, clamped to an integer in `[1,30]` via `Number.parseInt` + `Math.min` (`stats.ts:68-72`); `column`/`label` are hardcoded literals from the `switch` (`:175-183`), never user input. Live/unit: `?days=999` → query contains `INTERVAL '30' DAY` and not `999`.
- **Counts**: `SUM(_sample_interval)` for events (sampling-accurate); `count(DISTINCT index1)` returned with `usersApproximate:true`.
- **Missing token** → 503 `stats_unconfigured`, not 500/crash (unit-tested). **Upstream error** → 502 (4xx) / 503 (5xx/network) with detail sliced to 500 chars; the token lives only in the request `Authorization` header and is never placed in any response body. Error detail is surfaced only to an already-authenticated admin.

## Panel (admin/index.html)

Fully self-contained — inline `<style>` and `<script>`, no external CDN/script/font/image (CSP-friendly behind Access). Same-origin `fetch` (default `same-origin` credentials sends the Access cookie on the custom domain). 403 → "reload to re-authenticate through Cloudflare Access" banner; 503 → "read token not configured" notice (elftia pattern, `index.html:184-192`). Breakdown cells run through `escapeHtml` (`:167-169`); the banner uses `textContent` (`:101`) — no XSS on telemetry-derived strings. Distinct-user figures annotated "approximate (sampled)".

## RUNBOOK accuracy

Steps 1 (SQL token), 2 (Access self-hosted app + AUD/team-domain backfill + `wrangler secret put`), and the fail-closed quick-reference are accurate and executable cold. `ACCESS_TEAM_DOMAIN` is correctly documented as the full host including `.cloudflareaccess.com`, which matches the issuer/certs-URL derivation in `access.ts`. See Minor-1 for the one stale step.

---

## Findings

### Minor

**Minor-1 — RUNBOOK Step 3 is stale relative to the shipped `wrangler.toml`.** RUNBOOK.md:100-113 tells the operator to "uncomment the route line" and "Leave the route commented until the zone is Active," but `wrangler.toml:16` already has `routes = [...]` active (the zone went Active during implementation — tasks.md 9.1 — and the route was attached and live-verified). A cold operator following Step 3 would find the route already enabled. Doc lag only; the shipped config is correct and the custom domain is live. Recommend updating Step 3 to reflect "already attached (2026-07-09)". Not a code defect.

### Trivial / Informational

**T1 — Auth test-coverage gaps (core mechanism proven, edges not unit-tested).** `test/worker.test.ts` covers wrong-audience → 403 but not: wrong-issuer, expired token, or `ACCESS_ALLOWED_EMAILS` allowlist rejection. `jose` enforces issuer/exp by the same path as audience, and garbage/forged tokens → 403 are proven live, so risk is low; adding these three cases would make the gate's contract fully self-documenting.

**T2 — `POST /admin → 403` (gate before method) is verified live but not unit-tested.** Worth a one-line regression test so the gate-before-method ordering can't silently regress.

**T3 (informational) — stats `hint` echoes upstream SQL-API error detail to the admin client** (`stats.ts:104`). Verified safe: it's behind the Access gate (authenticated maintainer only) and the SQL token is never in that detail. No action needed.

---

## Durable findings

- The admin surface is fail-closed and airtight: in-Worker RS256 JWT verification (alg/aud/iss/exp all pinned) gates `/admin*` and `/api/admin*` on every host BEFORE any asset serve or stats read; `run_worker_first=true` + `not_found_handling="none"` is load-bearing — live `GET /index.html → 405` proves the panel cannot leak off `workers.dev`. Any future `wrangler.toml [assets]` change must preserve both flags.
- Both hosts are live: `workers.dev` (public ingest, hard-coded in shipped CLIs) and the custom domain `telemetry.rasen.io` (202 ingest + 403 admin, verified with `--noproxy '*'` — the machine's HTTP proxy returns 000 for non-workers.dev hosts). `workers_dev=true` MUST stay or CLI ingest breaks.
- Admin is inert until an operator backfills `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` (→ 403) and `TELEMETRY_SQL_TOKEN` (→ 503); RUNBOOK Step 3 is stale (route already attached) but Steps 1-2 are accurate.
