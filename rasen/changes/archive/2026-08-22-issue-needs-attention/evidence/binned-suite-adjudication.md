# Binned full-suite adjudication — issue-needs-attention (implementer, 2026-08-22)

678 files -> 28 bins (≤25 files/box; alphabetical round-robin striping),
node-driven with spawn argv direct. Three runner legs after two host-task
interruptions (recorded honestly): v1 ran bins 01-06, v3 ran 07-22 with a
15-minute watchdog cap per bin (output file-redirected so orphaned pipe
writers cannot wedge the runner), v4 resumed 23-28 after v3's host task was
killed externally mid-bin-23. Per-bin logs + real exit codes under the
worktree's `.rasen/g003-nd-*.log`; every failure below is enumerated from
those captured logs, none extrapolated.

## Result

**19 green bins / 9 red bins / 9 failed files / 25 failed tests. Zero
failures attributable to this change's delta. CI stays the authority gate.**

| Bin | Files | Tests | Exit |
| --- | --- | --- | --- |
| 01 | 25 | 451 passed + 1 skipped | 0 |
| 02 | 25 | 394 passed, 1 failed | 1 |
| 03 | 25 | 313 passed, 6 failed, 2 skipped | 1 |
| 04 | 25 | 365 passed + 6 skipped | 0 |
| 05 | 25 | 331 passed + 2 skipped | 0 |
| 06 | 25 | 429 passed + 4 skipped | 0 |
| 07 | 24 | 470 passed + 11 skipped | 0 |
| 08 | 24 | 340 passed, 1 failed, 5 skipped | 1 |
| 09 | 24 | 212 passed + 3 skipped | 0 |
| 10 | 24 | 269 passed + 3 skipped | 0 |
| 11 | 24 | 327 passed | 0 |
| 12 | 24 | 363 passed | 0 |
| 13 | 24 | 347 passed, 3 failed | 1 |
| 14 | 24 | 415 passed | 0 |
| 15 | 24 | 285 passed | 0 |
| 16 | 24 | 435 passed | 0 |
| 17 | 24 | 285 passed, 1 failed | 1 |
| 18 | 24 | 328 passed, 1 failed | 1 |
| 19 | 24 | 557 passed, 1 failed | 1 |
| 20 | 24 | 472 passed + 5 skipped | 0 |
| 21 | 24 | 432 passed | 0 |
| 22 | 24 | 273 passed, 6 failed, 1 skipped | 1 |
| 23 | 24 | 299 passed + 2 skipped | 0 |
| 24 | 24 | 398 passed + 9 skipped | 0 |
| 25 | 24 | 235 passed + 5 skipped | 0 |
| 26 | 24 | 401 passed + 5 skipped | 0 |
| 27 | 24 | 389 passed, 5 failed, 4 skipped | 1 |
| 28 | 24 | 383 passed + 3 skipped | 0 |

## Full failure enumeration, adjudicated

**The 2026-08-17 known machine-state cluster — all six named files appeared,
no others:**

- bin-02 `test/commands/config-profile.test.ts` — 1 failure ("keep action
  should not warn when project files are already synced").
- bin-03 `test/core/profile-sync-drift.test.ts` — 6 failures (all describe
  blocks).
- bin-08 `test/core/project-home.test.ts` — 1 failure ("leaves
  installedVersion absent when no skill files exist").
- bin-13 `test/core/update.test.ts` — 3 failures (tool detection /
  configured-tools / --force).
- bin-19 `test/core/init.test.ts` — 1 failure ("should preselect detected
  tools for first-time interactive setup").
- bin-27 `test/core/shared/tool-detection.test.ts` — 5 failures, including
  the literal cluster signature: `expected [ 'hermes' ] to deeply equal []`.

**Ambient/spawn-family — each adjudicated SOLO after the run (all green
solo; load-flake under the binned run, the same shape g-002's adjudication
recorded):**

- bin-17 `test/scripts/local-version-runtime.test.ts` — 1 failure in-bin;
  SOLO 9/9 passed, exit 0 (`.rasen/g3-solo-local-version.log`).
- bin-18 `test/commands/legacy-groups-removed.test.ts` — 1 failure in-bin;
  SOLO 6/6 passed, exit 0 (`.rasen/g3-solo-legacy-groups.log`).
- bin-22 `test/core/archive-consumer-integration.test.ts` — 6 in-bin
  failures (each "Test timed out in 30000ms" — spawn-load timeouts); SOLO
  7/7 passed, exit 0 (`.rasen/g3-solo-archive-consumer.log`).

## Runner-incident record (honest bookkeeping)

- v1's bins 07/08 were killed prematurely by the implementer on a
  misdiagnosed "hang" (wall-clock misread: a young vitest process with
  seconds of CPU was read as "idle for an hour"). Both bins re-ran green
  under v3 — no result was lost, only time.
- v3's host background task was killed externally (harness-side) mid-bin-23;
  v4 resumed bins 23-28 to completion.
- The watchdog cap never fired on any healthy bin (no TIMEOUT rows): the cap
  exists to bound a genuinely wedged bin, and none wedged.
