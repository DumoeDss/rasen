# Ship Log: ecp-hosted-best-effort-cutover

**Date:** 2026-08-08
**Mode:** local
**Branch:** wip/ecp-shared-bounded-loop-lifecycle-resume
**Commit:** 41e3d73f5a7af3984ca68f10b053a455dd8d5a88
**Tree:** 587c5a4d23cdeeb693bfd095a23623447b9f0536
**Status:** Committed (delivery deferred to portfolio level - ECP-8 owns the eventual single remote PR for the ECP-7 portfolio; this is a decomposed child change sharing the `wip/ecp-shared-bounded-loop-lifecycle-resume` worktree)

## Pre-Flight Results

- Verification: pass - `evidence/review-round-1.md` (initial review, findings raised) and
  `evidence/review-round-2.md` (independent delta re-review of the fix round, verdict
  **CLEAN**, 0 Blocker / 0 Major / 0 Minor, one Trivial noted for accuracy only) both present
  in the evidence directory. `evidence/fix-round-1.md` records the fix round between them.
- Tasks: 33/33 complete across `tasks.md` sections 1-8 (baseline, POSIX generalisation, win32
  re-declaration, mutation receipts, legacy freeze integrity, real Linux receipts [WSL-EXTERNAL],
  real Windows receipts [THIS-HOST], verification and ship). Every ticked task carries a receipt
  pointer into `evidence/`.

## Test Gate

- Required scope: cited from recorded receipts per delivery instruction - vitest was NOT
  re-run by the shipper.
- Rationale: the change already passed an independent delta re-review round 2 (author of
  round 1 review is not the fixer; the round-2 reviewer is a third, non-author role) that
  re-derived digests from committed bytes and re-ran three of the fix round's mutations
  itself rather than accepting them from the receipt. `tasks.md` 8.1 and 8.4 additionally
  record `rasen validate --strict` and static/lint/regression gates green on this host. The
  one commit made since round 2's anchor (`fec34c16`/`30dcb345`) is `41e3d73f`, a docs-only
  prose correction to `evidence/mutation-receipts.md` (round 2's own Trivial finding T1) that
  touches no `src/` or `test/` file - it carries zero test-relevant risk.
- Tests: skipped - scoped green evidence at:
  - `tasks.md` 8.1: `node dist/cli/index.js validate ecp-hosted-best-effort-cutover --strict`
    -> valid, exit 0; whitespace gate ALL CLEAN (19 files) on committed bytes.
  - `tasks.md` 8.4: `npx tsc --noEmit` exit 0; `npx eslint` clean over every changed path;
    guard suites 63 passed / 0 failed across six files; regression suites 19 passed / 2
    platform-skipped.
  - `evidence/review-round-2.md` "No regression": nine deterministic suites 97 passed / 2
    skipped (99); gated real-capsule suite (`RASEN_WIN32_REAL_CAPSULE=1`) 3 passed; `npx tsc
    --noEmit` exit 0; `git diff --check` clean; CR scan zero matches; working tree
    byte-identical after the reviewer's own mutation runs.
  - `evidence/legacy-freeze-integrity.md` (tasks.md 5.1): both LEGACY_PROCESS_CAPSULE_INPUTS
    pin lists (7 + 5 files) byte-identical to the `b3edf5bc` baseline, recomputed from commit
    `af21ba8d`. No rebaseline of either frozen crate.
- Tree: `587c5a4d23cdeeb693bfd095a23623447b9f0536` (HEAD `41e3d73f`). Receipted evidence spans
  commits `b3edf5bc..41e3d73f`; the review-round-2 fingerprint anchors at `fec34c16`/`30dcb345`,
  with only the docs-only `41e3d73f` fix applied since.

## Diff review

No accidental debug output, secrets, or TODO markers - already covered by review round 1 and
the independent delta re-review round 2 (CLEAN), both of which read the full diff.
