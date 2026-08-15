# Ship Log: store-issue-resources

**Date:** 2026-08-15T05:56:19Z
**Mode:** local
**Branch:** feat/store-v2-foundation
**Commit:** 0d4149fea3c91b0b37a77ff5dbd9d0e0e41822f1
**Tree:** 9bdd1418072909f4bd6f40e9832b1bd0676f9b34
**Status:** Committed (delivery deferred to portfolio level)

This is child 3 of 3 in a decomposed portfolio (`store-v2-foundation`), and the
last to reach terminal state. Per portfolio delivery design, decomposed children
ship in `local` mode — commit only, no push, no PR, no remote ref created or
moved. The portfolio delivers ONCE at the parent, via a single pull request,
after all three children are terminal. No merge or CI event is available or
expected at this child's ship point.

## Pre-flight results

Three independent passes ran on this child, each by a worker that authored
neither the code nor the pass before it.

- **Review round 1** — 1 Blocker, 2 Major, 3 Minor, 3 Trivial
  (`evidence/review-report-round-1.md`).
- **Review round 2** — after fixes: **0 Blocker, 0 Major**, 2 new Minor/Trivial
  (`evidence/review-report-round-2.md`). All round-1 findings independently
  re-established closed by a different reviewer.
- **Verify** — **2 Blockers**, 1 Major, 6 Minor (`evidence/verify-report.md`),
  none of which the two review rounds had found. Fixed under operator ruling;
  see below.

**Ship recommendation: SHIP.**

## The pattern this change should be remembered for

This change was caught **four separate times** shipping a ticked task or a delta
scenario whose text was false, and every one of the four shared the same
signature: **the false clause had zero test coverage**, so every gate stayed
green over it.

| Found by | What was false |
|---|---|
| Review round 1 | task 2.5 — an *uncommitted* Change reference was accepted, not refused |
| Review round 1 | task 2.4 — plans differing only in node ordering were two plans, not one |
| Verify | task 3.4 — an unreadable committed Change was silently omitted |
| Verify | two deltas — a declared-but-empty project or line could never appear |

Each pass found what the pass before it did not. The operator ruled the same way
every time — **change the code, not the spec** — so all four are now true rather
than reworded, each with a test that fails without the fix. The transferable
lesson is not "review harder": it is that **a claim no test pins is not
verified by a green suite**, and this change's task ticks were not evidence.

## Task state

**39/39 complete, no `[~]` markers anywhere.** Two task records (2.4, 2.5) carry
explicit corrections noting they were ticked while partly false and were made
true only by a later fix round — recorded rather than quietly completed, so the
ticks do not read as though they always held.

## Test gate

Full portfolio gate, re-taken **after** the verify fixes because those touched 12
files including `query/` internals and invalidated the earlier GREEN:

**191 files / 2668 passed / 9 skipped / 0 failed**, at `VITEST_MAX_WORKERS=1`
across three `VITEST_FILE_PARTITION` thirds (1553.78s + 540.06s + 792.57s),
`pnpm run build` first.

The count reconciles exactly against the prior run: **+0 files, +5 tests**, all
five new tests landing in `store-aggregate-query.test.ts` (26→31), so
2672 + 5 = 2677 = 2668 + 9. Every added test is attributable to a named finding.

`VITEST_MAX_WORKERS=2` — the setting task 8.3 originally named — was abandoned on
evidence: three runs at it produced 19 distinct failing files across 21
occurrences, only 2 repeating and **zero appearing in all three**, and one run was
cut off at 118/189 with no summary block. Serial removes the contention;
partitioning bounds each run. Full record in
`evidence/task-8-3-gate-run-and-environment.md`.

Also clean at ship time: `tsc --noEmit`, `pnpm run lint`, `pnpm run build`,
`node bin/rasen.js validate 'store-issue-resources' --type change --strict`,
`git diff --check`.

## Verification taken personally, not on report

Every fix round's mutation claims were re-run by the LEAD rather than read:

- **Wire-mirror completeness direction** — an unlisted export added to the core
  file's Store-aggregate section gives **RED 1/15**. First attempt gave a false
  GREEN because the probe landed inside the banner comment block rather than the
  section body; the trap is recorded so the next reader does not repeat it.
- **Plan-node canonicalization** — removing the node sort gives **RED 3/10**,
  naming exactly the three node-order cases, **while the task-7.1 digest anchors
  stay GREEN**. One mutation establishing both that the guard discriminates and
  that the anchors genuinely bypass the normalizer.
- Both files restored byte-exact (`78AA5825…`, `A96B2B71…`), and both baselines
  matched the fixers' independently — confirming we measured the same bytes.

## Open items carried forward, not closed

- **Task 8.6's CI-matrix half** — this child ships `local`, and the Windows leg
  runs only on a pushed branch. Structurally unobtainable here; it is an inbound
  acceptance item for portfolio delivery, exactly as child 1's 6.5 and child 2's
  6.9 are.
- **`packages/ui` typecheck fails** on 11 pre-existing errors in three files this
  change never touches (`ConsultationBindingEditor.tsx`, `IssuesDrawer.tsx`,
  `v2-node-panel-consultation.test.tsx`), unmodified since merge base `657c546d`.
  It does **not** threaten this PR — `ci.yml` never type-checks that package —
  but `release.yml:90` does, so it will fail the next release of 0.2.0. Corrected
  from an earlier record that said no CI job invokes it at all.
- **`ci.yml:151-156` runs `packages/ui` tests from a hardcoded four-file list** on
  one shard, which does not include this change's two new component suites. They
  run only in `release.yml`. Decision for whoever executes portfolio delivery.
- **An invalid project catalog** is reported through its own rollup entry rather
  than folded into `problems`. Judged the intended shape; recorded as a known
  boundary, one line to change if read otherwise.
- **`test/helpers/run-cli.ts:166`** — `ensureCliBuilt()` builds only when
  `dist/cli/index.js` is *absent* and never rebuilds on source change, so any CLI
  suite run without a preceding build reports on a stale binary. Not this
  change's defect; a live trap for anyone measuring here.
- **Gate wall-clock rose 40%** between the two full runs for five more tests,
  which the added work does not explain. Most likely `%TEMP%` residue
  re-accumulating — measured in this change to inflate CLI startup spread 13x.
  Re-check before trusting a future measurement.

## Delivery

No push performed, no PR opened, no remote ref created or moved. The branch is
ahead of `origin/dev/0.2.0` and behind it by nothing: `origin/dev/0.2.0` was
merged in at `e6cd8860` **before** the gate was taken, deliberately, so the
measurement describes the tree that will actually ship rather than a stale base.
The six colliding rim files auto-merged with no conflict, and all three locale
catalogs were confirmed at identical key sets (1606 each) with zero U+FFFD.

Delivery for this change completes at the portfolio level: a single pull request
against `dev/0.2.0` once all three children are terminal. That PR's CI run is
what supplies the run reference unblocking child 1's task 6.5, child 2's task
6.9, and this child's task 8.6 — after which the three children archive in
dependency order (child 1 → child 2 → child 3), which is required rather than
stylistic: this change's archive projection lists `store-planning-layout-v2` as a
CREATE, meaning child 1 has not yet archived the capability both of them touch.
