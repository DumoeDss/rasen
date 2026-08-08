# Ship Log: ecp-native-process-capsule-closure

**Date:** 2026-08-08
**Mode:** local
**Branch:** wip/ecp-shared-bounded-loop-lifecycle-resume
**Commit:** 896966a0a474a942e83a6be244a78e7efe5d1969
**Tree:** f55c07138d53626947bacd6506cfe8341a8aad2c
**Status:** Committed (delivery deferred to portfolio level - ECP-8 owns the eventual single remote PR for the ECP-7 portfolio; this is a decomposed child change sharing the `wip/ecp-shared-bounded-loop-lifecycle-resume` worktree)

## Scope shipped

This change closes the durable ProcessScope/ProcessCapsule fault domain for ECP-7 at the
decision-13 best-effort acceptance tier. The implementation work (the shared retention rule
across all three maps, the delta spec re-author to best-effort, the native-map edit plus the
authorized `a070733c -> 3e74b2c2` pin rebaseline, and the frozen/parked provider crates) was
committed across `9b1ff319..bbe61eca` plus `efe834ba`/`34111e9c` for task 12.8; this ship-log
documents the ledger reconciliation commit `896966a0` on top, which is the final delivered
state. SEC-001, RC-004, and RC-005 are independently confirmed closed on the integrated tree;
SEC-002/003 and RC-001/002/003 carry honest dispositions (superseded by threat-model decision
12 / leaves-with-parked-crates / upgrade-path), none falsely closed by a scope change.

## Pre-Flight Results

- Verification: pass - `evidence/review-round-2.md` is the fresh non-author security + code/spec
  review (verdict **CLEAN**, 0 Blocker / 0 Major / 0 Minor). Its author is a third role with zero
  prior involvement; every "closed" finding was re-derived on the integrated tree from committed
  bytes, not trusted from a receipt. `evidence/closure-integration-disposition.md`,
  `evidence/decision13-regrade.md`, `evidence/step1-scope-reconciliation.md`, and the cutover's
  archived review rounds stand as the predecessor evidence.
- Tasks: 96/96 complete across `tasks.md` sections 1-12. The review/re-run cluster (9.3/9.4/9.5
  -> 12.9) is receipted to `evidence/review-round-2.md`; the ship/archive/parent-return cluster
  (9.7-9.10/12.10) is executed by this closure flow. Disposed rows (12.3/12.4/12.6) and the
  projected-prerequisite section 11 rows carry inline `**Disposition:**` markers stating where the
  obligation lives (sibling change / Direction decision / upgrade path) - closed-for-archive per
  repo convention, never claimed as implemented here.

## Test Gate

- Required scope: cited from recorded receipts per delivery instruction - vitest was NOT
  re-run by the shipper (shared worktree; vitest can wipe `dist/`).
- Rationale: the change already passed an independent non-author review round 2 that re-derived
  every digest from committed bytes (`git show HEAD:<path> | sha256sum`), re-ran the affected
  guard suites itself, and ran the `buildUpdatedSpec` projection self-check non-destructively.
  The commits between review round 2's anchor (`34111e9c`) and this ship are `bbe61eca` (the
  review-round-2 evidence file itself) and `896966a0` (this ledger reconciliation) - both
  docs/planning-only, touching no `src/`, `test/`, or `native/` file, carrying zero test-relevant
  risk. `rasen validate --strict` was re-run by the shipper at `896966a0` (below).
- Tests: skipped - scoped green evidence at:
  - `evidence/review-round-2.md` §6: targeted vitest 50 + 13 = 63 tests green across
    `scope-retention-lifecycle` / `win32-best-effort-scope` / `linux-process-authority-boundary-guards`
    / `windows-process-authority-package-ci` / `cutover-declaration-gated-release` /
    `process-scope-host-closure` (deterministic; no real-helper dependency on the best-effort /
    native-fake paths).
  - `evidence/review-round-2.md` §2: pin suites 21/21 green (both `LEGACY_PROCESS_CAPSULE_INPUTS`
    lists carry `3e74b2c2...` matching committed bytes at HEAD; pure byte-digest checks with no
    platform early-return, so they discriminate on this Windows host).
  - `evidence/review-round-2.md` §6: `node bin/rasen.js validate ecp-native-process-capsule-closure
    --strict` -> passed, exit 0; whitespace gate clean on the change tree.
  - `evidence/review-round-2.md` §3: RC-005 mutation discrimination - both under-sweep (R) and
    over-sweep (W) mutations RED, helper restored byte-exact (`5f92ccc6...`).
- Shipper re-ran: `node bin/rasen.js validate ecp-native-process-capsule-closure --strict` ->
  "Change 'ecp-native-process-capsule-closure' is valid", exit 0, at HEAD `896966a0`.
- Tree: `f55c07138d53626947bacd6506cfe8341a8aad2c` (`896966a0^{tree}`).

## Delivery

- Mode: local. No push, no per-child PR. Delivery is deferred to the ECP-7 portfolio / ECP-8,
  which alone creates the clean final branch, runs the mandatory real three-OS acceptance/release
  CI, updates release truth, and opens the unique 0.2.0 PR (task 9.10 boundary preserved).
- Branch tip at ship: `896966a0` (77 commits ahead of `origin/wip/ecp-shared-bounded-loop-lifecycle-resume`;
  the portfolio owns the single remote push).
