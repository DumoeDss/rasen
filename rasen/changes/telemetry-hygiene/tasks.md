## 1. Exclusion module

- [x] 1.1 Create `telemetry-backend/src/filter.ts` exporting `SYNTHETIC_DISTINCT_ID`, `PROBE_COMMAND_PREFIX`, `JUNK_COMMANDS` (the 7 exact values: `x`, `final`, `regress`, `cd-smoke`, `admintest`, `'x'.repeat(256)`, `phase-c-infra-hardening:synthetic-probe`), `escapeSqlLiteral(value)`, `HOT_HYGIENE_PREDICATE`, and `coldHygienePredicate()` — per design.md Decision 1.
- [x] 1.2 Doc-comment the module with the forward convention (future synthetic probes MUST use `SYNTHETIC_DISTINCT_ID` as `distinctId` and a `PROBE_COMMAND_PREFIX`-prefixed command).

## 2. Wire the exclusion into every aggregate query

- [x] 2.1 In `telemetry-backend/src/stats.ts`, import from `./filter` and splice `HOT_HYGIENE_PREDICATE` into `hotWhere()` unconditionally (before the existing `hideTest`/dimension-filter predicates).
- [x] 2.2 In `telemetry-backend/src/stats.ts`, splice `coldHygienePredicate()`'s `sql`/`binds` into `coldWhere()` unconditionally.
- [x] 2.3 In `telemetry-backend/src/rollups.ts`, import `HOT_HYGIENE_PREDICATE` from `./filter` and append it (`AND ${HOT_HYGIENE_PREDICATE}`) to `runDailyRollup`'s AE query, after the existing timestamp bounds.
- [x] 2.4 In `telemetry-backend/src/rollups.ts`, add a `WHERE ${HOT_HYGIENE_PREDICATE}` clause to `runBackfill`'s AE query (which currently has no WHERE clause).
- [x] 2.5 `npx tsc --noEmit` (or the project's existing typecheck) in `telemetry-backend/` to confirm no type errors from the new imports. (No tsconfig.json in this subproject; ran `npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck` against `filter.ts`, `stats.ts`, `rollups.ts` — clean, no errors. A pre-existing, unrelated error exists in untouched `index.ts` — missing `@cloudflare/workers-types` ambient `ExportedHandler` global — not from this change.)

## 3. Regression coverage (existing vitest suite)

- [x] 3.1 In `telemetry-backend/test/worker.test.ts`, extend the D1 mock (`makeD1`) to also record each prepared statement's bind values (mirroring how `_sqls` already records SQL text) so cold-layer bind assertions are possible.
- [x] 3.2 Add a test asserting a hot-layer request (e.g. `GET /api/admin/commands?range=7d`) sends an AE SQL body containing the synthetic-distinctId exclusion, the `NOT IN (...)` junk-command list, and the `NOT LIKE 'probe:%'` clause.
- [x] 3.3 Add a test asserting a cold-layer request (e.g. `GET /api/admin/commands?range=all`) sends a D1 query containing `command NOT IN (...)` / `command NOT LIKE ?` with the junk commands and `probe:%` present in the recorded binds.
- [x] 3.4 Add a test asserting `runDailyRollup`'s AE query body contains the hygiene predicate.
- [x] 3.5 Add a test asserting `runBackfill`'s AE query body contains the hygiene predicate.
- [x] 3.6 Add unit tests directly against `telemetry-backend/src/filter.ts`: `escapeSqlLiteral` doubles embedded single quotes; `coldHygienePredicate()` returns one bind per `JUNK_COMMANDS` entry plus the `probe:%` LIKE bind, in that order.
- [x] 3.7 Confirm the existing `hideTest=false` test (`stats.ts` `hotWhere`) still passes unmodified — the hygiene predicate must remain present even when `hideTest=false` (proves the two filters are independent). (Added a dedicated new test for this; the pre-existing `hideTest=false` test at line ~422 also still passes unmodified.)
- [x] 3.8 Run `npm test` in `telemetry-backend/` — all tests (existing 29 + new) green. Capture the full output as evidence in the work directory's `research/` folder. (36/36 green; output saved to `work/research/npm-test-output.txt`.)

## 4. One-time D1 cleanup (destructive — evidence required before and after)

- [x] 4.1 Write a one-time cleanup SQL file (not under `telemetry-backend/migrations/` — this is data cleanup, not a schema migration) containing, in order: (a) a `SELECT date, command, version, os, node_version, events, users FROM rollups WHERE command IN (<the 7 exact JUNK_COMMANDS values, quoted>) ORDER BY date, command;` and (b) the same `WHERE command IN (...)` as a `DELETE FROM rollups ...;`. Generate the 256-character `x` string programmatically (e.g. a short Node one-liner) rather than typing it, to avoid a miscount. (Generated via a Node script; saved as separate `cleanup-select.sql` / `cleanup-delete.sql` under `work/research/` — length of the 256-x value verified == 256 before use.)
- [x] 4.2 Run the SELECT half first via `npx wrangler d1 execute rasen-telemetry-rollups --remote --command "<select-only>"` (from `telemetry-backend/`) and save the output as before-evidence in the work directory's `research/` folder (row count and contents). (Note: `--file` mode routes through a bulk-import endpoint that returns only summary stats, not row data — switched to `--command --json` to capture actual rows, per this task's original intent. Saved to `before-select-output.json`: 6 rows matched — `admintest`, `cd-smoke`, `final`, `regress`, `x`, the 256-char `x` string, all dated 2026-07-08. `phase-c-infra-hardening:synthetic-probe` had zero D1 rows — apparently never aggregated into the cold store. No unexpected/out-of-list commands appeared, so cleanup proceeded.)
- [x] 4.3 Run the DELETE via `npx wrangler d1 execute rasen-telemetry-rollups --remote --file <path-to-the-file-from-4.1>` (or a `--command` with the DELETE statement) and save the command output. (Ran via `--file cleanup-delete.sql --json`, saved to `delete-output.json`: `"Rows written": 6` — exactly matching the before-evidence row count.)
- [x] 4.4 Re-run the same SELECT from 4.2 and save the output as after-evidence — confirm zero rows match the enumerated junk commands. (Saved to `after-select-output.json`: `"results": []` — zero rows.)

## 5. Deploy and verify

- [x] 5.1 `npx wrangler deploy` from `telemetry-backend/`; capture the deploy output (confirms the Worker version, routes, and `schedule: 0 1 * * *` are all listed as before). (Deployed. Version ID `144b4263-8eef-4536-8dbf-df6954327357`. Routes: `openspec-telemetry.ws11579.workers.dev` + `telemetry.rasen.io` custom domain, `schedule: 0 1 * * *` — all present as before. Output saved to `work/research/deploy-output.txt`.)
- [x] 5.2 Smoke-test the deployed ingest path (`POST` a well-formed event to the live endpoint → `202`) to confirm the deploy is live and the unchanged ingest path is unaffected. (POSTed `command=probe:telemetry-hygiene-post-deploy`, `distinctId=00000000-0000-4000-8000-000000000000` to `https://telemetry.rasen.io/` directly (no proxy needed) → `202`. This event itself follows the new forward convention and will be excluded by `HOT_HYGIENE_PREDICATE`. Evidence saved to `work/research/ingest-smoke-evidence.txt`.)
- [ ] 5.3 Record, in the ship log, that `/api/admin/*` stats verification requires a Cloudflare Access-authenticated session which is not obtainable from this environment — this step is explicitly left to the user's own panel recheck, not fabricated or skipped silently.

## 6. Ship

- [ ] 6.1 `git commit` with explicit pathspec (`git commit -- telemetry-backend rasen/changes/telemetry-hygiene`) — never `git add -A`/`.` on this shared working tree.
- [ ] 6.2 `git show --stat` on the resulting commit to confirm only `telemetry-backend/**` and `rasen/changes/telemetry-hygiene/**` changed.
- [ ] 6.3 Ship in local mode (commit only, no push) — the `wrangler deploy` in section 5 is the actual delivery of the runtime fix and is independent of the git push decision.
