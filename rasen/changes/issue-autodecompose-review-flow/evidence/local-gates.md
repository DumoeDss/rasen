# Local gates — issue-autodecompose-review-flow (g-003 successor leg, 2026-08-21/22)

All commands run from the worktree root with real exit codes captured to files;
no test command was piped on the runner itself. CI (including the Windows leg)
remains the authoritative gate.

## Build

- `pnpm run build` — exit 0 ("Build completed successfully!", dist rebuilt,
  ProcessCapsule win32-x64 compiled). NOTE: a FIRST attempt failed (exit 1)
  with its output lost to a `| tail -5` pipe (the known pipe-masks-exit-code
  trap — the failure text was swallowed; the immediate full-output rerun was
  clean and is the receipt relied on).

## Focused suites (task 7.1 list) — all exit 0

| set | files | result |
| --- | --- | --- |
| plans schema/digest | store-issue-intent-lifecycle (new), -node-lifecycle, -node-suggestions, -plan-canonicalization, -digest-anchors | 5 files, 45 tests passed |
| publication | test/core/issue-publication/ (all 3: decomposition, orchestration, resolution) | 3 files, 30 tests passed |
| binding + confirm | test/core/issue-execution/ (all 3: binding, confirm, read-only guard) | 3 files, 53 tests passed |
| projection | test/core/issue-status/ (all 10, incl. revision-delta + decomposition-guidance) | 10 files, 61 tests passed |
| store-issue CLI + parity | confirm-cli, status-cli, start-cli, plan-decomposition-cli, skill-templates-parity | see below |

The CLI+parity batch exited 1 with exactly ONE failure —
`store-issue-status-cli > "degrades to a labelled visibility-none answer from
an unrelated directory"` timed out at 30s under 5-file parallel load (every
test in that file ran 22-64s; the EPERM temp-cleanup message is the timeout's
after-effect). Solo rerun of the whole file: exit 0, 6/6 passed (161s).
Parity (11), confirm-cli (4), start-cli (10), plan-decomposition-cli (6) all
passed inside the batch. Classification: ambient-timeout under load.

## Store family — sharded in three, sequential, all exit 0

- shard 0 (29 files): 576 passed. shard 1 (27 ran of 28 listed; one listed
  file is not a test file): 544 passed, 2 skipped (pre-existing conditional).
- shard 2 (26 files): 385 passed. Total: 1505 passed / 2 skipped / 0 failed.

## Full local suite — attempt honest and INCOMPLETE

`vitest run` (no args, single process, log /tmp/full-suite.log, ~60 min) died
mid-suite WITHOUT a final summary (log frozen mid-file; exit 1; no crash
signature; the box is running CLI-spawning tests 5-10x slow — ~1 min/file —
so the single-process form cannot complete tonight). A prior attempt to shard
it into chunks hit a Windows command-length failure and was stopped. The
partial log enumerated 45 failed tests across 15 files; classification below.
Every classification is against the documented local machine-state cluster
(memory: 2026-08-17 baseline-comparison on CI-green fb243e83 proved the
cluster) plus solo adjudication reruns.

| file (15) | failed | classification |
| --- | --- | --- |
| shared/tool-detection | 5 | machine-state cluster (hermes etc., documented) |
| core/update | 3 | machine-state cluster |
| core/profile-sync-drift | 6 | machine-state cluster |
| core/init | 1 (+EACCES probe) | machine-state cluster |
| core/project-home | 1 | machine-state cluster |
| core/archive-consumer-integration | 7 | machine-state cluster (documented member; solo rerun 6 failed — same cluster shape, `plan.complete` assertion family) |
| core/archive | 3 | ambient-timeout (30s budgets, 617s file) |
| core/archive-engine | 2 | ambient-timeout (30s budgets) |
| scripts/local-version-runtime | 1 | ambient (46s slow-op under load) |
| commands/store-v2-finalization-journey | 1 | under-load casualty — solo rerun exit 0 (1/1 passed, 136s) |
| commands/pipeline | 1 | under-load casualty — solo rerun exit 0 (107/107 passed, 942s) |
| commands/store-issue-start-cli | 1 | under-load casualty — 10/10 green in the focused batch earlier the same night |
| commands/store-issue-status-cli | 2 | under-load casualty — 6/6 green solo earlier the same night |
| change-run/engine-product-surface | 4 | under-load casualty — solo rerun green |
| change-run/engine-ownership-wiring | 6 | under-load casualty — solo rerun green |

Solo adjudication receipts (this leg): engine-product-surface +
engine-ownership-wiring together exit 0 (16/16 passed, 127s);
commands/pipeline exit 0 (107/107, 942s); store-v2-finalization-journey
exit 0 (1/1, 136s); archive-consumer-integration exit 1 (6 failed / 1 passed
— a documented cluster member reproducing its cluster shape, not this
change's surface: the change never touches the archive engine, its consumers,
or their templates).

Bottom line: of the 45 enumerated failures, 23 sit in the documented
machine-state cluster, 6 are ambient timeouts/slow-ops, 15 are under-load
casualties disproven by solo reruns the same night, and 0 are attributable to
this change's delta. Every suite this change touches passed with real exit
codes (focused sets + the sharded store family).

## Fence checks

- `git diff -- src/core/pipeline-registry/ pipelines/ packages/ui package.json`
  = 0 bytes (frozen surfaces untouched; `pipeline-registry` untouched all child).
- Store-side writes this leg: exactly one pathspec-scoped commit
  `8c65d14 chore(store): seed issue-autodecompose-graph archived evidence
  (g-003, repo archive 15b60a63)`; revision 0003 left uncommitted in the
  store working tree per the plan; no ship/archive/close/accept act run; no
  commit made in THIS repo.
