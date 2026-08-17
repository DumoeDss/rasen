# Constraint sweep — canvas-loop-validate-clean-synthesis (task 6.3)

Date: 2026-08-17, run against the working tree after all tasks.

- **IR frozen**: `git status --porcelain -- src/core/pipeline-registry/`
  prints nothing (re-asserted after every edit session; the engine was
  never touched — all three fixes are draft.ts synthesis defaults).
- **Extract path untouched**: `deriveSubgraphContract` and
  `computeSubgraphCut` extracted from HEAD and the working tree are
  BYTE-IDENTICAL (diff empty). `rewireCrossingsOnto` changed only by the
  OPTIONAL `outgoingPortOverride` parameter — the extract path passes
  nothing and keeps the positional row mapping (`outgoingPortOverride ??
  rows.outcomes[index] ?? derived.outcomes[index]!`).
- **`V2_BODY_PALETTE_KINDS` unchanged**: zero diff lines touch it.
- **No `legacyRuntimeOwner`**: the only added lines mentioning it are a doc
  comment and a negative assertion (`not.toHaveProperty`).
- **Changed-file inventory** (the ship stage's narrow pathspec — implementer
  leaves the tree uncommitted per the round-3 discipline):
  - `packages/ui/src/canvas/draft.ts`
  - `packages/ui/src/canvas/PipelineCanvasPage.tsx`
  - `packages/ui/src/canvas/V2LoopReviewPanel.tsx`
  - `packages/ui/test/canvas/draft.test.ts`
  - `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`
  - `test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts` (new)
  - `rasen/changes/canvas-loop-validate-clean-synthesis/` (change dir)
  No ephemera (`.rasen/…/ephemera/` stays untracked), no `bin/rasen.js`
  CRLF phantom.
- **Typecheck**: `tsc --noEmit` in packages/ui reports exactly the 13
  pre-existing errors (ConsultationBindingEditor, IssuesDrawer, two
  pre-existing page-test casts, v2-node-panel-consultation) — none in this
  change's files.
- **Tests**: full UI suite `pnpm --dir packages/ui exec vitest run` =
  68 files / 912 (baseline 68/902, +10, zero failures); new core pin
  `test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts`
  = 5/5 (the REAL `EcpDefinitionModule.prepare` over the synthesized
  definitions — the child-1 mock-split gap closed, with three
  falsifiability controls re-injecting each pre-fix defect class and
  proving it red).
