# Review Report — telemetry-rollups-dashboard

**Reviewer:** reviewer-rollups (independent; author ≠ verifier)
**Date:** 2026-07-09
**Scope reviewed:** `telemetry-backend/` only (per task). Changes outside it are owned by a parallel session and were ignored.

## Summary verdict

**CLEAN — ready for archive/ship.** No Blockers, no Majors in the implementation itself. All 8 hard constraints pass, `validate --strict` is green, and the test suite re-runs 29/29. One ship-stage hygiene finding (Major, `.wrangler/` not gitignored) applies to the deferred commit step (task 9.1), not to the code under review. Two Minor scaling/semantic notes and one Trivial note round it out.

The 4 unchecked/partial tasks (7.3 partial, 7.4, 7.6, 9.1) are the pre-declared user-action-required / ship-stage items — not findings.

## Scorecard

| Dimension    | Result |
|--------------|--------|
| Completeness | 25/29 tasks checked; 4 remaining are declared deferred (live row population, authenticated backfill run, hands-on panel acceptance, commit). All spec requirements implemented. |
| Correctness  | All 5 requirements + all scenarios mapped to code and tests. 29/29 vitest green. |
| Coherence    | Implementation follows every locked design decision. `validate --strict` green (4/4 artifacts complete, MODIFIED headers aligned). |

## Findings

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | Major (ship-stage) — **RESOLVED** | `telemetry-backend/.wrangler/` (untracked); no `.gitignore` in `telemetry-backend/` and root `.gitignore` has no wrangler rule | `git check-ignore` confirms `.wrangler/` is NOT ignored. The deferred commit (task 9.1) is specified as `git commit ... -- telemetry-backend/`, which would sweep `.wrangler/tmp/bundle-*` and `dev-*` local build cache into the commit. Fix before shipping: add `.wrangler/` to a `.gitignore`, or use a narrower pathspec listing only the intended files (`src/rollups.ts migrations/ wrangler.toml src/index.ts src/stats.ts admin/index.html README.md RUNBOOK.md test/worker.test.ts`). Not a code defect. |

> **Major #1 → RESOLVED** (2026-07-09). Fix = new `telemetry-backend/.gitignore` (`.wrangler/`, `node_modules/`, `.dev.vars`). Confirmed by reviewer (non-author): `git check-ignore -v` matches `.wrangler/tmp` and `node_modules` to the rule; `migrations/`, `src/rollups.ts`, and `.gitignore` itself remain trackable (not ignored); a `-- telemetry-backend/` pathspec commit now sees only the 7 modified files + `.gitignore` + `migrations/` + `src/rollups.ts`, no build-cache junk.
| 2 | Minor | `src/rollups.ts:149-178` (`runBackfill`) | Backfill issues one `env.ROLLUPS.batch([...])` over ALL history rows. Fine for the current ~2 days of data, but D1 batch has a bound-statement ceiling; a full 90-day dataset × many dimension tuples could exceed it. Consider chunking the batch (e.g. 50–100 stmts) before real-scale backfills. Daily rollup is unaffected (one day's tuples only). |
| 3 | Minor | `src/stats.ts:293` (`overviewCold`, `last24h`) | Cold "24h" total uses `date >= date('now','-1 day')`, which on a day-grained store matches yesterday AND today (≈2 calendar days), slightly wider than the "24h" label. Harmless (events are the primary additive metric; cold view is historical), but the label is imprecise. |
| 4 | Trivial | `src/stats.ts:209` (`dauHot`) | Uses `toStartOfInterval(timestamp, INTERVAL '1' DAY)` where the design snippet wrote `toStartOfDay`. Equivalent for day-bucketing; no behavior difference. |

## Constraint audit (8 hard constraints)

1. **Ingest hot path unchanged, zero shared code** — PASS. `git diff src/index.ts` shows `handleIngest` byte-for-byte unchanged; the only additions are the `runDailyRollup/runBackfill` import, `Env extends RollupsEnv`, the `/api/admin/backfill` branch (inside the admin gate), and the `scheduled` export. `scheduled` calls `runDailyRollup` via `ctx.waitUntil`; it shares nothing with `handleIngest`.
2. **D1 stores only aggregate counts, no distinctId/index1/IP** — PASS. `migrations/0001_rollups.sql` schema has only `date, command, version, os, node_version, events, users` (no identifier column). `rollups.ts` `RollupRow` and both aggregation queries select dimensions + `SUM(_sample_interval)` + `count(DISTINCT index1) AS users` (the distinct is aggregated, never stored). Test 6.1 asserts no `index1`/`distinctId` key/substring in any stored row.
3. **New admin endpoint behind existing `verifyAdminAccess`; `src/access.ts` untouched** — PASS. `access.ts` has zero diff. `/api/admin/backfill` sits *after* the `verifyAdminAccess` check inside the `/api/admin/*` branch. Test asserts 403 (and no aggregation, no SQL) without a JWT, 200 with a valid JWT.
4. **wrangler.toml: workers_dev / routes / [vars] / three [assets] flags unchanged; only [[d1_databases]] + [triggers] added** — PASS. Diff is purely append-only after the existing `[vars]` block: one `[[d1_databases]]` (binding `ROLLUPS`) and `[triggers] crons = ["0 1 * * *"]`. All prior keys and the `run_worker_first`/`not_found_handling`/`html_handling` flags are byte-identical.
5. **SQL injection guard on both layers** — PASS. Hot layer: `FORBIDDEN_FILTER = /['";\\\x00-\x1f]/` rejects quotes/semicolon/backslash/control chars, plus a 256-char cap, before values are interpolated into the SQL-API text body; because values are always wrapped in single quotes and the single quote is forbidden, string-literal breakout is impossible (`init--` stays inside the quoted literal). Cold layer: dimension filters use bound `?` params; `hideTest`/base predicates are trusted literals; breakdown column names come from a fixed `'command'|'version'|'os'` union, never user input. Tests 4.5 cover both the rejection (400) and the equality-predicate path.
6. **Cold all-history "users" not presented as exact** — PASS. `stats.ts` carries an explicit non-additive comment; every cold response sets `usersApproximate: true`; the dashboard footnote states distinct users are an upper bound on the cold layer and "events are exact." Design and delta spec both encode the caveat.
7. **admin/index.html single self-contained no-build file** — PASS. One HTML file with inline `<style>`, inline `<script>`, and inline-SVG charts. No external stylesheet/script/font/image references, no bundler, no new asset files.
8. **Existing 13 tests not weakened** — PASS. The original ingest (202/400/405, field-stripping) and fail-closed admin (403 sealed HTML / JSON, wrong-aud, forged JWT, ASSETS-not-called) tests are all present and unchanged; suite grew to 29 (16 new). No assertions were loosened.

## Test re-run result

`npm test` in `telemetry-backend/` (npm, not pnpm): **29 tests passed, 0 failed** (vitest 3.2.7, 97ms). Independently confirms the implementer's 29/29 report. Test quality is high: the D1 mock applies real composite-PK UPSERT semantics via a Map (so idempotency test 6.2 genuinely exercises replace-not-double), SQL bodies are captured and asserted for hot-layer predicates/clamps, and the injection guard, cold-store-unavailable 503, and fail-closed backfill paths are all covered.

## Artifact-vs-implementation coherence

- **proposal.md / design.md**: implementation matches on every decision — D1 binding `ROLLUPS`, table `rollups`, composite PK, `ON CONFLICT DO UPDATE`, `''` dimension normalization, `scheduled` + `ctx.waitUntil`, `runSql()` reuse (never-throws no-op on failure), backfill as gated admin endpoint returning `{days, rows}`, `range` param with `days` back-compat, `source` annotation, `hideTest` default-on, hot-interpolation-with-guard + cold-bound-params.
- **delta specs**: `telemetry-backend` ADDED (Permanent Daily Rollup Persistence / One-Time Historical Backfill / Two-Layer Aggregate Query) and `telemetry-admin-console` MODIFIED (Aggregate Stats API) + ADDED (Dashboard Filtering and Time Range) all have implementing code and covering tests. `validate --strict` green confirms MODIFIED header alignment for archive matching.
- **tasks.md**: 25 checked tasks verified against code. 7.3 (partial), 7.4, 7.6 are runtime/human-in-the-loop items the deployed worker cannot self-verify (secret only on deployed worker; panel needs a signed-in human). 9.1 is the ship-stage commit — see Finding 1 before executing.
