# Ship Log: store-worktree-bindings-v2

**Date:** 2026-08-13T07:41:18Z
**Mode:** local
**Branch:** feat/store-v2-foundation
**Commit:** 6113f2880a4c59127b6c3e5a8434e4a27efbff4a
**Tree:** f09b7bc5ce3c3763ff4de71b0ff7b8767eeeae78
**Status:** Committed (delivery deferred to portfolio level)

This is child 2 of 3 in a decomposed portfolio (`store-v2-foundation`). Per
portfolio delivery design, decomposed children ship in `local` mode — commit
only, no push, no PR, no remote ref created or moved. The portfolio delivers
ONCE at the parent, via a single pull request, after all three children
(`store-planning-contract-v2`, `store-worktree-bindings-v2`,
`store-issue-resources`) reach terminal state. No merge/CI event is available
or expected at this child's ship point.

## Pre-Flight Results
- Verification: pass — `rasen/changes/store-worktree-bindings-v2/evidence/review-report.md`
  (round 1 + round-2 verification append), plus two standalone mutation-proof
  reports (`verb-guard-mutation-proof.md`, `digest-anchor-strengthening-mutation-proof.md`).
  Round 1 verdict: 0 Blocker, 0 Major, 3 Minor, 2 Trivial. Round 2 (independent,
  non-author re-verification): all five RESOLVED, one new Trivial (stale line
  pointers in design Decision 8, since corrected in commit `6113f288`).
  Final state 0 Blocker / 0 Major. **Ship recommendation: SHIP.**
- Tasks: 31/33 complete. Tasks 6.9 and 6.10 are intentionally `[ ]`, not oversights:
  - **6.9** (Windows CI verification): the matrix-configuration half is DONE —
    three `KNOWN_SLOW_TEST_WEIGHTS_MS` entries added to `vitest.config.ts`
    (`workspace-cleanup.test.ts` 166610, `workspace-cli.test.ts` 166960,
    `workspace-apply.test.ts` 109103), additive-only per `git diff`. The
    run-reference half is left open because CI only executes on a pull
    request, and this portfolio opens exactly one PR — at the parent, after
    all three children are terminal — so a Windows CI run reference is
    structurally unobtainable from inside this child's local worktree. This
    is an inbound acceptance item for portfolio delivery, not a defect.
  - **6.10** (portfolio no-regression baseline): reserved to the LEAD, taken
    personally and alone on a quiesced tree at reduced parallelism, for the
    same reason a solo real-git-worktree run caught genuine Windows
    contention elsewhere in this child. Result recorded below under Test Gate.
  - No task uses `[~]` anywhere in `tasks.md` (confirmed by reviewer, "Task
    honesty" section of review-report.md).

## Test Gate
- Required scope: this child's four command/module suites (workspace + target-line
  CLI, store `test/core/store/`, related compatibility suites) plus a
  portfolio-wide no-regression baseline comparing this worktree's post-child-1
  state to its post-child-2 state.
- Rationale: this child ports a whole 13-file module (workspace) plus
  target-lines and two new command groups touching shared seams
  (`file-state.ts`, `workflow/shared.ts`, command/locale registries); a
  module-scoped run plus a full-suite regression baseline both apply per the
  ship workflow's broadening triggers (shared/global contracts, CLI/locale
  registration, concurrency, persistence).
- Tests: **not re-run in this ship step** — gates were already taken by the
  LEAD on a quiesced tree at reduced parallelism, immediately prior to
  dispatching this ship:
  - Main baseline (task 6.10's command): **122 files / 1744 passed / 6 skipped
    / 0 failed**, against **110 files / 1511 passed / 0 skipped** recorded at
    child 1's close — net +12 files, +233 tests, **no regression**.
  - This child's four command suites, run separately: **4 files / 26 passed /
    2 skipped / 0 failed**.
  - `tsc --noEmit`: clean. `node bin/rasen.js validate 'store-worktree-bindings-v2'
    --type change --strict`: `Change 'store-worktree-bindings-v2' is valid`.
  - Reviewer round 2 independently re-confirmed `tsc --noEmit` clean and the
    same `validate --strict` result, and confirmed `git diff --stat ad413c6f
    HEAD -- src/` is empty by hash (not diff alone) on three representative
    files.
- Tree: `f09b7bc5ce3c3763ff4de71b0ff7b8767eeeae78` (current `HEAD^{tree}`,
  matching the tree the above evidence was measured against — confirmed via
  `git diff --stat ad413c6f HEAD -- src/` empty and `git diff --stat
  origin/dev/0.1.7 -- src/core/store/workspace/` empty).

## Seven deferred test cases (substitute coverage, not silently dropped)
Seven cases across two suites are deferred (5 in `workspace-baseline.test.ts`,
2 `it.skip` in `store-v2-workspace-journey.test.ts` with `DEFERRED (task 6.6)`
comments) because they depend on `new change --target-line`, delivered
upstream by `store-planning-scope-routing` (`3b050663`), which is not an
ancestor of `dev/0.2.0` and belongs to a later slice. Deferring the *cases*
was judged acceptable; shipping the *behaviour* untested was not, so
substitute coverage drives the same behaviours directly through the module
APIs. One honest gap carried forward rather than papered over:
`planning_worktree_required` does not exist anywhere in `src/` — it is
decided entirely by the deferred resolver, so no substitute could reproduce
it; the substitute coverage records that discrepancy explicitly.

## Deliberate carve-out
`src/core/session-runtime-context.ts` is out of scope for this child by
design. 0.1.7 raises `RUNTIME_CONTEXT_VERSION` 1->2 and declares it breaking;
this line pins it at 1 and guards it twice (14 consumers, 6 of them inside
`management-api/` that did not exist on 0.1.7). Porting the version bump
would make every on-disk context file unreadable under a live daemon. Task
6.11 proves the carve-out held: `RUNTIME_CONTEXT_VERSION` confirmed 1, both
`session-runtime-context.ts` and `commands/context.ts` confirmed byte-unmodified
(`git diff --stat` empty), daemon/session suites green (54 files / 658 passed
/ 1 skipped / 0 failed). The version freeze is handed forward to the slice
that owns that file.

## Invariance
- `git diff --stat ad413c6f HEAD -- src/` is empty — every mutation performed
  across every proof/review cycle (verb-guard mutation, digest-anchor
  strengthening, reviewer's own canonical-json probes) was byte-reverted and
  hash-verified back to the implementation commit's state.
- `git diff --stat origin/dev/0.1.7 -- src/core/store/workspace/` is empty —
  the 13-file workspace module is byte-identical to the 0.1.7 tip, which is
  this child's intended property (design Decision 3: squash base + two
  mandated fixups only, no further drift).

## Open item for CI (not a blocker, carried to task 6.9)
`workspace-cleanup.test.ts` ran **396.85s** solo, independently observed by
the reviewer as well, against its `KNOWN_SLOW_TEST_WEIGHTS_MS` entry of
`166610` — possibly a >2x underestimate of the sharding weight. Whether this
reflects machine load or a genuine underestimate is unresolved. Recorded here
as an open item under task 6.9's concern, to be resolved when the Windows CI
run reference becomes obtainable at the parent PR.

## Delivery
No push performed, no PR opened, no remote ref created or moved. All
substance was already committed prior to this ship step
(`ad413c6f` implementation -> `29dd0b8b` verb-guard mutation proof ->
`7fcfa457` review round-1 fixes -> `a8dce9e9`/`c24d04e5`/`1c4364b2`/`1b5cecb3`
round-1 bookkeeping -> `6d966e88` round-2 verification append -> `6113f288`
stale-pointer correction). Working tree was already clean at ship time; no
additional code commit was made. This ship-log file itself is committed
separately (see commit recorded in this change's evidence directory git
history) with a narrow pathspec.

Delivery for this change completes at the portfolio level: a single PR will
be opened against the resolved integration base once
`store-planning-contract-v2` (child 1), this change (child 2), and
`store-issue-resources` (child 3) are all terminal.
