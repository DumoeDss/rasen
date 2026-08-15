# Ship Log: store-planning-contract-v2

**Date:** 2026-08-12T22:05:25+0800
**Mode:** local
**Branch:** feat/store-v2-foundation
**Commit:** 6b7ddcfbb9b3adecf55be3f845b3cc115c5d5223
**Tree:** 462deb1d96a324b06ab4007cfa9e620827007c61
**Status:** Committed (delivery deferred to portfolio level)

## Portfolio Context

This is **child 1 of 3** in the `store-v2-foundation` portfolio (siblings:
`store-worktree-bindings-v2`, `store-issue-resources`). Decomposed children
ship `local` — commit only. No push, no PR, no remote ref created or moved.
The portfolio delivers **once**, as a single pull request at the parent level,
after all three children are terminal. That parent PR resolves the delivery
mode; this ship does not.

## Pre-Flight Results

- **Verification:** passed — `evidence/review-report.md` (1533 lines: rounds
  1-3 plus round-3 verification), plus per-round mutation-proof files
  (`fix-round-1-mutation-proofs.md`, `fix-round-2-mutation-proofs.md`,
  `fix-round-3-mutation-proofs.md`, `purity-guard-mutation-proof.md`).
  17 findings closed across 3 review rounds plus one escalation-ladder
  attempt. Final state: **0 Blocker / 0 Major**. Every finding was confirmed
  by a non-author who re-ran the mutation rather than accepting the recorded
  proof.
- **Tasks:** 35/36 complete (`- [x]` count: 35, `- [ ]` count: 1).

  **Task 6.5 is deliberately unchecked and is NOT a gap.** Its
  matrix-configuration half is verified and recorded in
  `evidence/task-6-5-windows-ci-verification.md`. Its "record the run
  reference" half is structurally unsatisfiable before delivery: this child
  ships `local`, and CI only runs on a pull request — which this portfolio
  opens once, at the parent, after all three children are terminal. There is
  no CI run to reference yet. This is carried forward as the inbound
  acceptance item for portfolio delivery: the CI run reference gets recorded
  there, against the real Windows leg. It was not ticked, its prose was not
  softened, and it was not marked `[~]` — this repo's `TASK_PATTERN` does not
  match `~`, which would silently drop it from both numerator and denominator
  of the completion count.

  Consequently `rasen archive --dry-run --json` for this change reports a
  tasks blocker. That blocker is the **intended state** — this child must not
  archive independently before the portfolio PR's CI run exists.

## Invariance (sanity-checked at ship time, not re-derived)

- `git diff --stat eaefc01b HEAD -- src/core/store` is **empty** — every
  Layer-0 contract source is byte-identical to the reviewed apply commit
  (`eaefc01b`, 25 files, +3858/-99) across all three fix rounds.
- The only `src/` edit in the entire delta is `src/core/index.ts` (+13/-6,
  1 file) — a disambiguating re-export resolving a genuine TS2308 collision
  between change-run's pre-existing `ChangeInstanceId` and the new
  Store-planning brand.
- Full delta from proposal to HEAD (`eea78de8`..HEAD): 38 files changed,
  6973 insertions(+), 106 deletions(-).

## Test Gate

- **Required scope:** full no-regression suite for this child's touched
  surfaces, taken by the LEAD on a quiesced tree (reused here as scoped green
  evidence — tree fingerprint matches current HEAD).
- **Rationale:** Layer-0 pure contract change with cross-cutting exports
  (`src/core/index.ts`); the LEAD's final gate covers the full repository
  suite, which is broader than the minimum required scope and fully covers it.
- **Tests:** `.rasen/final-gate-s1.log` — **110 files / 1511 passed / 1
  skipped / 0 failed**, against a pre-change baseline of 104 files / 1264
  passed / 1 skipped / 0 failed. Re-verified at ship time: working tree is
  clean (no commits since the logged gate run), so the evidence is current.
- Other gates recorded by the LEAD: `tsc --noEmit` 0 errors, `lint` 0 errors,
  `build` 0 errors, `test:types` 5 type tests no errors,
  `rasen validate 'store-planning-contract-v2' --type change --strict` valid
  (re-confirmed at ship time: `Change 'store-planning-contract-v2' is valid`).
- **Tree:** 462deb1d96a324b06ab4007cfa9e620827007c61
- Diff scan at ship time (`git diff eea78de8..HEAD -- src/`) for debug output,
  secrets, or leftover TODO/FIXME markers: none found.

## Open Item Carried Forward (not closed)

During apply, the implementer's run saw 2 failures in
`test/cli-e2e/store-lifecycle.test.ts`. It has since passed **four**
consecutive times (reviewer, fixer, and the LEAD's quiesced final gate).

**Recorded verdict: transient, non-reproducing, cause unestablished** —
explicitly NOT classified as "pre-existing" and NOT dismissed as a flake. One
of the two original failures was never read (its output was not captured
before the run moved on). The causal lead that was recovered is preserved in
`evidence/task-6-4-baseline-flake-analysis.md`. This is carried forward to
the portfolio level unresolved; it should not be read as a clean run history.

## Delivery

- **Mode:** local — commit only. No `git push`, no PR, no remote ref created
  or moved. Confirmed via `gh pr view` for this branch: "no pull requests
  found for branch feat/store-v2-foundation".
- Delivery for the `store-v2-foundation` portfolio happens once, at the
  parent, after `store-worktree-bindings-v2` and `store-issue-resources` are
  also terminal.
