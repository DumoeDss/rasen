# Task 8.3 — the gate run, its triage, and why it is not closed

Written in English for byte-safety, as every other evidence file here is.

**Bottom line: no regression was found, and the gate is NOT closed.** Those are two separate
statements and this document keeps them separate on purpose.

## The run

Taken on the merged base (`e6cd8860`), not the pre-merge tree. That ordering was deliberate: the
ten commits this branch was behind rewrite `test/core/change-run/` heavily, and that directory is
76 of this gate's 189 suites, so a gate on the old base would have measured a tree that never
ships. See the merge commit message.

Command (the re-derived three-command gate's first command, from
`evidence/task-8-2-rederived-gate.md`), at `VITEST_MAX_WORKERS=2`:

```
test/core/store test/core/change-run test/core/management-api
test/commands/{store,store-root-selection,store-target-line-cli,
  store-v2-workspace-concurrency,store-v2-workspace-journey,workspace-cli,
  store-issue-cli,store-aggregate-cli}.test.ts
test/cli-e2e/store-lifecycle.test.ts
```

Result:

| | |
|---|---|
| Test files | **8 failed / 181 passed (189)** |
| Tests | 27 failed / 2613 passed / 9 skipped (2649) |
| Unhandled errors | 2, both `[vitest-worker]: Timeout calling "onTaskUpdate"` |
| Duration | 2825.46s (47 min) |

## Task 8.2's verification half — CLOSED by this run

8.2 required verifying the run's reported file count against this change's test-file additions.
The expected count was computed and written down **before the run started**, not after seeing the
result: 50 (`test/core/store`) + 76 (`test/core/change-run`) + 54 (`test/core/management-api`) = 180
directory suites, plus the 9 individually-named files, none of which fall inside those three
directories = **189**.

The run reported **189**. Exact match. No suite was silently absent, which is the specific failure
8.2 exists to catch and which had already happened twice in this portfolio.

## Triage: every failing file re-run solo

Per this task's own standing rule — *never triage a full-run failure by its shape; re-run the file
solo before concluding anything* — all 8 files were re-run individually at
`VITEST_MAX_WORKERS=1`, one at a time, nothing else running.

| File | In the gate | Solo | Verdict |
|---|---|---|---|
| `management-api/session-context-handover` | 4 failed | 7/7 pass | contention |
| `management-api/sessions-api` | 5 failed | 22/22 pass | contention |
| `management-api/session-launch-context` | 1 failed | 26/26 pass | contention |
| `store/bootstrap-obtain` | 3 failed | 44/44 pass | contention |
| `store/workspace-identity` | 6 failed | 6/6 pass | contention |
| `store/workspace-baseline` | 6 failed | 7 pass / 5 skip | contention |
| `commands/store-issue-cli` | 1 failed | 7/7 pass | contention |
| `commands/workspace-cli` | 3 failed | **failed** | see below |

A hypothesis worth recording because it was **falsified**: four of the eight failures sat in
`management-api/`, which is exactly where the ten newly-merged commits landed, so "the merge broke
the session surface" was the obvious reading. All four pass solo. The merge did not break them.

## `workspace-cli.test.ts` — environmental, not a defect

This one failed its first solo re-run too (4 failed / 10 passed), which is why it was initially
recorded as a real defect. Taking the actual error text rather than stopping at "solo also fails"
is what corrected that.

Three runs produced **three different failure sets**:

| Run | Failed |
|---|---|
| In the gate | 3 (`does not claim a scope...`, `reports a prepared pair...` x2) |
| Solo #1 | 4 |
| Solo #2 | 1 (`omits the Change instance from the preview when the plan mints one`) |

The failure modes are `Test timed out in 30000ms` and `EPERM, Permission denied` from
`fs.rmSync` in `test/helpers/temp-cleanup.ts:8` — never an assertion.

The per-test wall-clock from solo #2 explains it. Every test in the suite runs within a factor of
two of the 30s per-test timeout:

```
previews a cleanup, refuses an unsafe one...   29674ms   <- 326ms under the limit
omits the Change instance...                   32816ms   <- over; this run's failure
applies a stored plan id...                    25170ms
does not claim a scope with two prepared...    22223ms   <- failed the PREVIOUS run, passed this one
```

Which tests fail is a coin flip against a wall, not a property of the code.

**Root cause, measured.** Each case spawns `node bin/rasen.js` as a subprocess, several times.
CLI startup was measured directly:

- bare `node -e "0"`: 647/653/711/717/812 ms — median **711ms**, stable. Already slow for Node
  (antivirus overhead), but consistent.
- `node bin/rasen.js --version`: 2223/2381/5546/9983/10032 ms — median **5546ms**, and an earlier
  sample on the same binary read 15154/15183/23741/27131/29470 ms.

Same binary, same argument, startup ranging from 2.2s to 29.5s. The variance is the finding.

**Why the environment is degraded, and why it is self-reinforcing.** `%TEMP%` held **3,983**
leftover `rasen-*` directories, many of them complete Git repositories (`rasen-workflow-draft` 232,
`rasen-test-config` 213, `rasen-consultation-host` 204, ...). Merely `statSync`-ing them took over
120 seconds, which is milliseconds' work on a healthy filesystem.

The `EPERM` seen above **is the cleanup failing** — the known Windows rmdir problem. So: residue
slows the filesystem, slow filesystem times out tests, timed-out tests skip or fail their cleanup,
residue grows. A count taken 15 minutes after the first read 3,453, so deferred cleanup does happen
but does not keep pace.

**`workspace-cli` is not a regression from this change.** Corroborating: it was GREEN at child 2's
close (`portfolio-run.json` -> `s2GateResult.s2CommandSuites`, 4 files / 26 passed / 0 failed), and
the only commit touching it or its subjects since is `8caafa11`, whose entire diff to
`src/commands/store.ts` is **8 lines of additive subcommand registration** that touch no workspace
path. The merge touched nothing this suite exercises.

## Why 8.3 stays open

This task's own text forbids the shortcut that would close it: *"Do not accept 'every file passes
solo' as the gate either; it is good evidence but a different claim from 'the suite passes'."*

The suite did not pass. What is established is narrower and worth stating exactly:

1. The gate ran at the correct scope and the file count verified exactly (189/189).
2. All 8 failing files were re-run solo; 7 passed clean.
3. The 8th fails non-deterministically with timeout/EPERM signatures traced to a measured
   environmental cause, and is demonstrably not touched by this change.
4. **No regression was identified.**

What remains is to repair the environment and re-take the gate. Until a green run exists, 8.3 is
unticked, and the ship gate should treat this change as unmeasured rather than as passing.

## The environment repair, and its proof

Deleted every `rasen-*` directory in `%TEMP%` older than one hour, keeping newer ones in case a
concurrent session in another worktree was mid-run (this machine carries more than twenty
worktrees). Result: **3430 deleted, 23 kept, 0 failures.**

Re-measured immediately afterwards, same commands, same binary:

| | Before | After |
|---|---|---|
| bare `node -e "0"` median | 711ms | **130ms** |
| `rasen --version` median | 5546ms | **2443ms** |
| `rasen --version` spread | 2223-29470ms (**13x**) | 2319-2558ms (**1.1x**) |

**The collapse in spread is the proof, not the drop in median.** A 13x spread is what turns a suite
whose tests all run within 2x of a 30s timeout into a coin flip; a 1.1x spread does not. Startup
went from "somewhere between 2.2 and 29.5 seconds" to "2.4 seconds, reliably".

Recorded separately so it is not mistaken for a regression: `rasen --version` still costs ~2.3s
above bare Node even on a clean filesystem. That is pre-existing, unrelated to this change, and
untouched here — but it is why suites that spawn the CLI several times per case sit so close to the
30s timeout in the first place. The headroom is thin by construction, which is what made the
environment able to tip them over.

The gate is re-taken against this repaired environment. Its result, not this one, is what 8.3
turns on.

## The closing run — GREEN

The repair was necessary and not sufficient. Two further runs at `VITEST_MAX_WORKERS=2` still
failed, and their failure sets did not overlap with the first or with each other:

| Run | Files | Failed files |
|---|---|---|
| 1 (189 files) | complete | 8 |
| 2 (118/189) | **cut off, no summary block** | 4 |
| 3 (187 files) | complete | 9 |

Across the three: **19 distinct files failed, 21 occurrences, only 2 repeating, ZERO appearing in
all three.** Removing the two intrinsically-slow suites for run 3 did not help — other files simply
became the victims (`canvas-v2-vertical-proof.test.ts`, one test, took 945s). The conclusion is
about load, not about particular suites: `MAX_WORKERS=2` cannot produce a stable result on this
machine at this file count.

So the setting this task names was abandoned **on evidence**, and replaced with two levers:

- **`VITEST_MAX_WORKERS=1`** removes contention entirely — the measured cause.
- **`VITEST_FILE_PARTITION` in thirds** bounds each run to ~10-15 minutes, after run 2 was cut off
  at 118/189 with no summary block. This is the same mechanism CI shards with, not an invention.

### Result

| Partition | Files | Tests | Failed | Duration |
|---|---|---|---|---|
| 1/3 | 67 | 1102 passed, 7 skipped | **0** | 914.59s |
| 2/3 | 74 | 1000 passed | **0** | 621.73s |
| 3/3 | 50 | 561 passed, 2 skipped | **0** | 528.13s |
| **Total** | **191** | **2663 passed, 9 skipped** | **0** | 2064s |

Every suite that failed in the earlier attempts — `workspace-cli`, `workspace-cleanup`,
`workspace-identity`, `bootstrap-obtain`, `sessions-api`, `store-aggregate-query` — passed **first
time**, none rescued by a solo re-run. That distinction is the whole point: this task's text
forbids accepting "every file passes solo" as the gate, because it is a different claim from "the
suite passes". This is the latter.

### The count is +2, and the delta reconciles exactly

191 against the 189 predicted before the first run. That is not waved off:

| Source | Files | Tests |
|---|---|---|
| `store-issue-uncommitted-reference.test.ts` (BLOCKER-1's first-ever coverage) | +1 | +3 |
| `store-issue-plan-canonicalization.test.ts` (MAJOR-1's guard) | +1 | +10 |
| `stores.test.ts` 19 → 25 | | +6 |
| `store-issue-cli.test.ts` 7 → 9 | | +2 |
| `store-aggregate-wire-mirror.test.ts` 13 → 15 | | +2 |
| **Total** | **+2** | **+23** |

189 + 2 = 191. 2649 + 23 = 2672 = 2663 passed + 9 skipped. Every added file and test is named and
attributable to a specific review-loop finding. Nothing is silently present, and nothing absent.

### One precondition that is not optional

`pnpm run build` was run immediately before the gate. `test/helpers/run-cli.ts:166`'s
`ensureCliBuilt()` returns early when `dist/cli/index.js` merely **exists** — it never rebuilds on
source change. Any CLI suite run without a preceding build reports on whatever binary happens to be
on disk. The round-1 fixer discovered this by accident (their new CLI tests were RED against a
stale `dist/` and GREEN after a build). CI is unaffected: `ci.yml` runs `pnpm run build` before
`pnpm test`.

## Re-taken after the verify round — still GREEN

The GREEN above was invalidated, deliberately and by us. The verify stage found two Blockers that
three earlier passes had missed (`evidence/verify-report.md`), the operator ruled to change the code
rather than the deltas, and the fix (`f46ffc13`) touched 12 files including `query/` internals. A
gate taken before that fix describes a tree that no longer exists — the same reason the first gate
was deliberately taken after the `origin/dev/0.2.0` merge rather than before it.

Re-taken on identical terms, `pnpm run build` first:

| Partition | Files | Tests | Failed | Duration |
|---|---|---|---|---|
| 1/3 | 73 | 927 passed | **0** | 1553.78s |
| 2/3 | 55 | 777 passed, 3 skipped | **0** | 540.06s |
| 3/3 | 63 | 964 passed, 6 skipped | **0** | 792.57s |
| **Total** | **191** | **2668 passed, 9 skipped** | **0** | 2886s |

**The delta reconciles exactly again: +0 files, +5 tests.** All five of the fix round's new tests
landed in `store-aggregate-query.test.ts` (26 → 31), so no new file appears and the count stays 191;
2672 + 5 = 2677 = 2668 passed + 9 skipped. `stores.test.ts` + `store-aggregate-cli.test.ts` remain
29 combined, unchanged.

Two things recorded rather than smoothed over:

- **Per-partition file counts moved** (67/74/50 → 73/55/63) even though the total did not.
  `VITEST_FILE_PARTITION` re-derives its weighted split over the whole suite, so a change in any
  file's weight redistributes every partition. Only the total is comparable across runs; a
  per-partition comparison would be reading noise.
- **Total wall-clock rose 40%** (2064s → 2886s) for five more tests. That is not explained by the
  work added. The most likely cause is `%TEMP%` residue re-accumulating — measured earlier in this
  change to inflate CLI startup spread 13x — and it is worth re-checking before any future
  measurement is trusted. It does not invalidate this result: the run completed, every partition
  produced a summary block, and nothing failed.

## Inherited item this run confirms

`workspace-cleanup.test.ts` was flagged in task 8.5 as possibly a >2x under-entry in
`KNOWN_SLOW_TEST_WEIGHTS_MS`. `workspace-cli.test.ts` now shows the same shape from the other side:
its entry is `166960`, and solo runs this session took 350.94s and 250.87s. Both numbers are real
measurements of the same file. On this machine a single solo wall-clock is a point estimate with
roughly 2x spread, which is the same caution task 8.5 recorded for `store-aggregate-query`. Do not
re-baseline these weights from a run taken while `%TEMP%` is loaded.
