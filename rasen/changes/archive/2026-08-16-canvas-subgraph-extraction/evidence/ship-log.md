# Ship Log: canvas-subgraph-extraction

**Date:** 2026-08-17 (portfolio canvas-gesture-ir-compiler, child 2, stage ship)
**Mode:** local
**Branch:** feat/canvas-gesture-ir-compiler
**Commit:** 7cc8e6808c95663c50868d003bbfb828cb5c4494
**Tree:** 7aebe8fe93971b1976a8596bd0d42ad1e236f915
**Base:** n/a (local mode — portfolio child; parent delivers the branch once)
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: pass — `evidence/review-cycle-report.md` (round 1 verdict CLEAN,
  "Ready for ship"), plus `review-report.md` (round 0: 0 Blocker / 0 Major /
  2 Minor / 1 Trivial) and `fix-round-1.md`.
- Tasks: complete (no `- [ ]` remaining in tasks.md).
- Working tree: on feat/canvas-gesture-ir-compiler at 5973d2ea (child 1's
  archive commit); this change shipped entirely from the working tree.

## Test Gate
- Required scope: `pnpm --dir packages/ui exec vitest run` (full UI package
  suite). Rationale: the delivered diff touches only `packages/ui/` (7 files);
  `src/core/` untouched — frozen-IR assertion below re-verified — so the UI
  package suite bounds the entire delivered risk.
- Tests: skipped — two independent green evidence sources, both cited, neither
  re-run at ship (shipper changed no code):
  1. impl-3's post-m1-fix full run: **67 files / 795 tests, exit 0** via the
     CI-canonical `pnpm --dir packages/ui exec vitest run` from repo root
     (recorded in `evidence/fix-round-1.md`).
  2. reviewer-1 (non-author) independently re-ran the focused file
     `test/canvas/pipeline-canvas-page.test.tsx`: **99/99 passed, exit 0** on
     the same tree state (recorded in `evidence/review-cycle-report.md`,
     round 1 CLEAN).
- Evidence identity: latest product-file edit 06:51 (the m1 index-key fix);
  review-cycle-report.md written 06:54 — no commits or code edits between the
  evidence runs and this ship. Commit 7cc8e680 commits exactly the gated bytes;
  the tree fingerprint above is the committed content tree.

## Pre-Commit Assertions (re-asserted at ship)
- `git status --porcelain -- src/core/pipeline-registry/` → empty (IR frozen;
  also pinned in `evidence/gates-5-2.md`).
- `git status --porcelain -- packages/ui/` → exactly the seven product files
  (DeclarationsPanel.tsx, PipelineCanvasPage.tsx, V2SelectionPanel.tsx,
  draft.ts, V2ExtractReviewPanel.tsx [new], test/canvas/draft.test.ts,
  test/canvas/pipeline-canvas-page.test.tsx).
- Diff scanned for debug output / secrets / TODO-FIXME-debugger markers: clean.
- `git diff --cached --check` on the staged set: clean (CI whitespace gate safe).

## Commit Contents
- 26 files: 7 product files + 19 change-dir files (proposal/design/tasks/
  specs/evidence/handoff + `.openspec.yaml`).
- Excluded by design: `signals/` (parked-worker ephemera; currently holds only
  an empty `.state` dir — nothing to stage), `.rasen/` run-state, sibling
  children's change dirs, parent planning dir, `HANDOFF-canvas-gesture-ir-compiler.md`,
  e2e tmp dirs, child 1's untracked archive `signals/` residue.
- Delivery: local mode — no push, no PR; the portfolio parent delivers the whole
  branch after all children ship.

## Archive
**Date:** 2026-08-16T22:58:40.956Z
**Ship commit:** 7cc8e6808c95663c50868d003bbfb828cb5c4494
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\canvas-ir-compiler\rasen\changes\archive\2026-08-16-canvas-subgraph-extraction
**Transaction:** 7b47b472-4fcf-4d9b-ace0-a4ac6153cd05
