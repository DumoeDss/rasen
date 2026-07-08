# Review Report — fork-phase1-telemetry-backend

**Reviewer:** reviewer-b1 (independent; did not author this change)
**Date:** 2026-07-08
**Branch:** dev-harness
**Scope:** new `telemetry-backend/` (package.json, wrangler.toml, src/index.ts, README.md) + change `notes.md`. Everything is new/untracked — no committed baseline.
**Live verification:** POSTed to the deployed Worker `https://openspec-telemetry.ws11579.workers.dev` with distinctId `reviewer-test` (no redeploy/delete/edits).

## Verdict

**APPROVE.** The implementation faithfully satisfies all 6 spec requirements and every design decision (D1–D5). Live behavior on the deployed Worker matches the documented contract exactly. Findings are limited to two Minor doc/robustness notes and one Trivial note — none block the change or the B2 handoff.

---

## Spec conformance (6 requirements)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Anonymous Usage Event Ingestion (POST JSON, 2xx fast) | PASS | `src/index.ts:33-76`; live POST → 202; writeDataPoint is fire-and-forget (void), no downstream await |
| Minimal Validation (4xx malformed, POST-only) | PASS | `index.ts:36-61`; live: GET/PUT→405, missing field→400, malformed→400, empty→400, array/string/null→400, empty-string field→400 |
| Privacy Contract Enforcement (only contract fields; no IP/path/args) | PASS | `index.ts:63-74` reads only `command`/`version`/`distinctId`/`os`/`node_version`; IP & headers never accessed; live POST with injected `path`/`args`/`project` → 202, response body `accepted` (no echo) |
| Analytics Engine Persistence (one data point, blobs+indexes) | PASS | `index.ts:71-74` `writeDataPoint({ blobs:[command,version,os,node_version], indexes:[distinctId] })` matches D2 |
| Deployed & Reachable Endpoint (2xx to synthetic event, URL recorded) | PASS | Live 202; URL recorded in `notes.md:5` and `README.md:8` for B2 |
| Aggregate Query Access (SQL API DAU + breakdown documented) | PASS | `README.md:118-165` documents endpoint, token scope, `count()`/`count(DISTINCT index1)`, `GROUP BY` |

---

## Findings

### Minor

**M1 — Documented DAU/count queries are undercounts once Analytics Engine sampling kicks in.**
`telemetry-backend/README.md:141` and `:149` use raw `count()` / `count(DISTINCT index1)`. Analytics Engine samples at high write volume; the sampling-accurate form multiplies by the sample interval (`SUM(_sample_interval)` instead of `count()`). The README (`:76-77`, `:164-165`) and design D5 both acknowledge sampling and state phase-1 volume is below the threshold, so the documented queries are correct *today*. But a maintainer copying these queries at higher volume would silently under-report. Recommend a one-line note that `count()` is exact only below the sampling threshold, and `SUM(_sample_interval)` is the sampling-accurate variant. Not a code defect; documentation accuracy only.

**M2 — A broken/missing `TELEMETRY` binding is invisible from the response (silent data loss).**
`index.ts:77-79`: the outer catch returns `202` on any internal error. This is intentional per design D3 (fire-and-forget, never hang the caller) and is the right client contract. The trade-off: if the Analytics Engine binding is ever misconfigured (e.g., `env.TELEMETRY` undefined after a bad deploy), `writeDataPoint` throws, the catch swallows it, and the client still sees 202 while nothing is stored. There is no server-side signal in the response. This is acceptable for phase 1 (verification is the write-path 2xx, and B2 swallows errors anyway), but the maintainer's only detection path is querying the dataset, not the endpoint. Worth a one-line "how to detect silent drop" note or leaving observability/logpush as a documented future item. Behavior is correct per spec; flagging the operational gap.

### Trivial

**T1 — `distinctId` truncated at 256 bytes but Analytics Engine indexes cap at 96 bytes.**
`index.ts:65` slices `distinctId` to `MAX_FIELD_LEN` (256). Analytics Engine index values are capped at 96 bytes; a >96-byte index would be truncated/rejected by AE itself. Client UUIDs are 36 chars, so there is zero practical impact — noting only for completeness. blobs are fine (4 × 256 = 1024 bytes, well under the 5120-byte total cap).

---

## Robustness checks (all pass)

- **Malformed JSON** → inner try/catch (`index.ts:42-46`) → 400. Verified live.
- **Non-object JSON** (array/string/number/null) → `typeof !== 'object' || null` guard (`:48-50`) plus field checks reject → 400. Verified live for `[1,2,3]`, `"hello"`, `null`.
- **Oversized field** (10KB command) → truncated to 256 (`:63`), 202. Verified live.
- **Extra/hostile fields** (`path`, `args`, `project`) → ignored by construction (only contract fields read); 202; body not echoed. Verified live.
- **Non-string os/node_version** → `asField` coerces to `''` (`:25-27`). Safe.
- **Unhandled rejection** → outer try/catch (`:40,77-80`) guarantees a fast response. writeDataPoint returns void (fire-and-forget), so it does not block.
- **Response headers** → standard Cloudflare headers only; no payload/IP/debug leakage. Verified live.

## wrangler.toml / package.json / packaging

- `wrangler.toml`: correct `name`, `main`, `account_id` (matches proposal `5cc51d8388c780c03fb4c6161bd403c4`), `compatibility_date = "2025-07-08"` (a year stale vs. today but harmless — compat dates pin behavior forward), and a valid `[[analytics_engine_datasets]]` binding `TELEMETRY → openspec_telemetry` matching the code and README. No CORS/flags needed (Node CLI caller). OK.
- `package.json`: `private: true`, `type: module`, wrangler devDep `^4.86.0`, deploy/dev/tail scripts. OK.
- npm-pack exclusion: repo-root `telemetry-backend/` is not in the CLI `files` whitelist — auto-excluded. Confirmed in task 1.3; seam correctly flagged to release-prep (C). No `.npmignore` needed.

## README accuracy

SQL column mapping (`blob1..blob4` = command/version/os/node_version, `index1` = distinctId, `timestamp` = ingestion) matches the `writeDataPoint` call exactly. Deploy/rollback/smoke-test commands are correct. Only caveat is M1 (sampling-accurate count form).

## Non-goal boundaries respected

Confirmed via `git status`: `src/telemetry/index.ts` and CLI `package.json` are unmodified — the client rewrite and `posthog-node` removal correctly stay in B2. No scope creep in this change.

---

## Durable findings

- Worker `index.ts` is spec-faithful and privacy-airtight: only 5 contract fields read, IP/headers never touched, no payload echo, all fields truncated to 256B; verified live at `openspec-telemetry.ws11579.workers.dev`.
- The 202-on-internal-error design (D3) means a broken `TELEMETRY` binding causes silent data loss with no endpoint-visible signal — detection is dataset-query only (M2); acceptable for phase 1.
- Documented `count()` DAU queries are exact only below AE's sampling threshold; `SUM(_sample_interval)` is the sampling-accurate form for higher volume (M1).
