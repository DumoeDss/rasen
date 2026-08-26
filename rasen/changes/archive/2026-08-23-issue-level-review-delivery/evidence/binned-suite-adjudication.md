# Full-suite gate — binned adjudication (P6 portfolio close, 2026-08-23)

Tree under test: `feat/issue-phase6` @ `8c70ac7e` (g-001 `2bdd1513` + g-002 ship
`e5c88225`/archive `62553fe0` + g-003 ship `a0d4d6b2`/archive `8c70ac7e`), dist rebuilt
immediately before the run (`pnpm run build`, emit completeness spot-checked including
`dist/commands/shared-output.js` — the g-002 verify I-3 under-emit trap).

Method: node-spawn argv binned runner (`.rasen/run-bins-p6close.mjs`, copied from the
established `.rasen/run-bins.mjs` shape) — 687 test files -> 28 bins (<=25 files/bin),
serial `pnpm exec vitest run <files...>` per bin, per-bin logs `.rasen/p6close-NN.log`
(gitignored, left on disk), detached process + tail watchdog.

## Result: PASS (zero unknown reds)

- 28/28 bins completed; `DONE failedBins=5/28`.
- Green bins: 23 (01,03,04,05,07,08,09,11,12,13,14,16,17,18,19,20,21,23,24,25,26,27,28).
- Red bins and their failing FILES (full enumeration, no extrapolation):
  - bin 02: `test/commands/config-profile.test.ts` (1 test)
  - bin 06: `test/core/shared/tool-detection.test.ts` (5 tests)
  - bin 10: `test/core/profile-sync-drift.test.ts` (6 tests)
  - bin 15: `test/core/project-home.test.ts` (1 test)
  - bin 22: `test/core/init.test.ts` (1 test), `test/core/update.test.ts` (3 tests)

## Adjudication

The 6 failing files are EXACTLY the known machine-state failure cluster (hermes et al.
user-state leakage), triple-adjudicated 2026-08-17 with baseline comparison; no member
is touched by this portfolio's diff (P6 changes live in issue-status / issue-acceptance /
issue-execution / store issues / store-issue command; the cluster is
config-profile / tool-detection / profile-sync-drift / project-home / init / update).
No red file outside the cluster appeared, so no solo re-run adjudication was required.

CI remains the authoritative gate (per campaign policy); this local gate clears the
branch for push + PR.
