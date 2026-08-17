# Ship Log: canvas-durable-node-positioning

**Date:** 2026-08-17 13:04 +0800
**Mode:** local
**Branch:** feat/canvas-authoring-followups
**Commit:** 7677ff779d632e79b3d4025c1cb5f51ac4c5b637
**Tree:** 9b48b856e53279429faa70ed79c300edd04abb8c
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: pass (review-report.md, verify round 0 — 0 Blocker / 0 Major /
  0 Minor / 2 Trivial accepted-known; review-loop skipped by policy)
- Tasks: 16/16 complete

## Test Gate
- Required scope: full UI suite, CI-canonical `pnpm --dir packages/ui exec
  vitest run` (canvas page wiring + geometry module change with a 37-call-site
  choke point; portfolio gate pins the full suite, count only grows vs the
  67/866 child-1 close), plus the IR-frozen and payload-clean asserts.
- Rationale: the durability rule lives in `layout.ts` and is funneled through
  `recomputeFlow` from every mutation site, so the full canvas surface is the
  affected behavior; `draft.ts` (definition model) is untouched and pinned
  untouched.
- Tests: skipped — evidence-cited green:
  - `evidence/gates-6.md`: implementer full runs — run 1: 67 files / 879 exit 0;
    run 2 (final, all 14 new tests): **67 files / 880, exit 0, zero failures**
    (866 baseline + 14: 6 layout/prune units + 8 page scenarios), with three
    targeted self-mutations each caught by the intended test.
  - `evidence/review-report.md` (reviewer2, independent, verify round 0):
    fresh run **67 files / 880 — 879 passed + 1 failed**, the single failure
    fully enumerated as `test/i18n/catalog.test.ts > all literal catalog keys
    referenced in src exist in en.json` "Test timed out in 5000ms" during
    collection — the documented pre-existing Windows parallel-load timeout
    flake class (memory: timeout-not-assertion), in a file the delta does not
    touch; isolated rerun of that file 12/12 exit 0. Recorded here honestly as
    the known flake class, not a red gate: the delta's own scope is green in
    both independent runs and the 866+14 arithmetic matches.
  - Freshness audit (this shipper, at ship time): every product file mtime
    (latest 1786944468) predates gates-6.md (1786944498) and
    review-report.md (1786944912) — no code changed after the last green
    evidence; the committed content is the tested content.
  - IR-frozen assert re-run at ship: `git status --porcelain -- src/core/pipeline-registry/`
    empty; `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (draft.ts:750,
    0-byte diff on draft.ts); no added line carries `legacyRuntimeOwner`;
    working diff exactly the 4 product files.
- Tree: 9b48b856e53279429faa70ed79c300edd04abb8c

## Ship-time note
- One trailing space in `evidence/gates-6.md` line 35 was removed at ship time
  (caught by `git diff --cached --check` — CI whitespace gate). Prose-only,
  pre-archive (before any content-addressed hashing); no other evidence byte
  was touched.

## Delivery
- Mode local: nothing pushed; the portfolio parent delivers the branch once all
  children ship. Commit is pathspec-scoped to the 4 product files plus this
  change directory (signals/ excluded; the bin/rasen.js CRLF phantom and all
  throwaway e2e/run-state dirs kept out); 20 files, 1871 insertions, 9
  deletions.

## Archive
**Date:** 2026-08-17T05:41:03.400Z
**Ship commit:** 7677ff779d632e79b3d4025c1cb5f51ac4c5b637
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\canvas-ir-compiler\rasen\changes\archive\2026-08-17-canvas-durable-node-positioning
**Transaction:** 18809d91-3687-4eb2-b70e-c0d141c531ae
