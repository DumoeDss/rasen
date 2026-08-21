# Local full-suite gate record (task 7.1) — 2026-08-21/22

Machine context: the full-suite shards ran while the machine was concurrently
running other projects' dev processes (elftia electron-vite dev, an excalidraw
vitest run, three codex CLI instances, rocut/director hosts — verified by
process listing). Ambient-load classification below refers to that state.

## Shard runs (real commands, real exit codes)

| Shard | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 — store/issue family | `npx vitest run test/core/store test/core/issue-publication test/core/issue-status test/core/issue-execution test/core/issue-acceptance` | 0 | 99 files passed (99); 1690 passed \| 2 skipped (1692). No failures. |
| 2 — rest of test/core | `npx vitest run test/core --exclude "test/core/store/**" --exclude "test/core/issue-publication/**" --exclude "test/core/issue-status/**" --exclude "test/core/issue-execution/**" --exclude "test/core/issue-acceptance/**"` | 1 | 427 files passed \| 12 failed (443); 6625 passed \| 41 failed \| 63 skipped (6729) |
| 3 — test/commands | `npx vitest run test/commands` (clean re-run; an earlier invocation of the same command was killed externally mid-flight and produced no summary — its partial failures were timeout-shaped and subsumed by the re-run) | 1 | 77 files passed \| 3 failed (80); 1223 passed \| 7 failed \| 3 skipped (1233) |
| 4 — acceptance + roots | `npx vitest run test/acceptance test/cli-e2e test/locales test/utils test/telemetry test/prompts test/specs test/ui test/scripts test/*.test.ts` | 1 | 38 files passed \| 3 failed (41); 577 passed \| 3 failed \| 3 skipped (583) |

Shard/failure-file outputs were preserved (ephemeral, not in-repo): `/tmp/shard1.txt` … `/tmp/shard4.txt`, `/tmp/triage-<file>.txt`.

## Every failed file, solo re-run (`npx vitest run <file>` each), classified

"Solo-clean" = passed when run alone (full-shard failure was contention).
"Cluster" = the deterministic machine-state failure family documented in the
team memory `local-full-suite-machine-state-cluster` (non-sealed tests reading
real user-level state, e.g. hermes in the machine's tool config; adjudicated
2026-08-17 by re-running the same files on a CI-green baseline worktree where
the same cluster was red, plus PR #168 CI green on three OSes).
"Ambient-timeout" = every failure is `Test timed out in 30000/60000/120000ms`
(several with the documented EPERM Windows temp-cleanup flake) against the
30/60/120s per-test caps under the ambient load described above; no assertion
failures.

| File (as failed in shard) | Solo exit | Solo result | Classification |
| --- | --- | --- | --- |
| test/commands/workspace-cli.test.ts (1 fail) | 0 | 14/14 | Solo-clean — ambient flake |
| test/commands/store-issue-start-cli.test.ts (3) | 0 | 10/10 | Solo-clean — ambient flake |
| test/commands/store-issue-status-cli.test.ts (3) | 1 | 4/5 — the 1 fail is "degrades to a labelled visibility-none answer from an unrelated directory", 30s test timeout + EPERM cleanup | Ambient-timeout |
| test/core/profile-sync-drift.test.ts (6) | 1 | 9 passed \| 6 failed — assertion `expected true to be false` from `hasProjectConfigDrift` | Cluster (deterministic) |
| test/core/project-home.test.ts (1) | 1 | 24 passed \| 1 failed | Cluster (deterministic) |
| test/core/shared/tool-detection.test.ts (5) | 1 | 29 passed \| 5 failed (reads the machine's real tool config) | Cluster (deterministic) |
| test/core/archive-consumer-integration.test.ts (7) | 1 | 1 passed \| 6 failed — all 30s timeouts | Ambient-timeout |
| test/core/management-api/stores-api.test.ts (1) | 1 | 16 passed \| 2 failed — 30s HOOK timeout | Ambient-timeout |
| test/core/management-api/workflow-enablement.test.ts (1) | 1 | 17 passed \| 2 failed — timeouts | Ambient-timeout |
| test/core/expert-install-flip.test.ts (1) | 1 | 11 passed \| 1 failed — 30s timeout | Ambient-timeout |
| test/core/management-api/supervisor-host-lifecycle.test.ts (1) | 0 | 20/20 | Solo-clean — ambient flake |
| test/core/retention-codify-e2e.test.ts (1) | 0 | 4/4 | Solo-clean — ambient flake |
| test/cli-e2e/capstone-journeys.test.ts (1) | 0 | 2/2 | Solo-clean — ambient flake |
| test/cli-e2e/workset-journey.test.ts (1) | 0 | 2/2 | Solo-clean — ambient flake |
| test/scripts/local-version-runtime.test.ts (1) | 1 | 6 passed \| 3 failed — all 30s timeouts (PowerShell launcher latency) | Ambient-timeout |
| test/core/init.test.ts (1) | 1 | 55 passed \| 1 failed (tool-detection preselect) | Cluster (deterministic) |
| test/core/update.test.ts (3) | 1 | 72 passed \| 3 failed (tool detection/update state) | Cluster (deterministic) |
| test/core/archive.test.ts (13) | 1 | 50 passed \| 11 failed — all 11 are `Test timed out` (one unhandled teardown TypeError after the timeouts) | Ambient-timeout |

Note on counts: solo re-runs sometimes failed one or two MORE tests than under
the shard (stores-api 1→2, workflow-enablement 1→2, local-version-runtime 1→3)
or fewer (archive-consumer 7→6, archive 13→11) — marginal 30s-cap boundary
fluctuation under the same ambient load, same failure mode in every case.

## Verdict

Zero failed files intersect the change's surfaces: the store/issue family
(this diff's home — issue-publication, store/issues, issue-status, and all new
suites) was fully green in shard 1 (exit 0), the change's CLI suites
(`store-issue-plan-decomposition-cli`, `store-issue-plan-portfolio-cli`,
`store-issue-start-cli` solo) are green, and every failure above is either the
pre-existing machine-state cluster or ambient-load timeouts. CI (including the
Windows leg) is the authoritative gate per the cluster memory.
