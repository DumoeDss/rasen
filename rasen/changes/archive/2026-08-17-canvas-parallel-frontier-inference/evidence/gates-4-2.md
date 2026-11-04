# Gates — canvas-parallel-frontier-inference task 4.2

All commands run in this worktree (`feat/canvas-gesture-ir-compiler`) on
2026-08-17, against the last archived child's ship commit `864f45b9`
(fix(pipelines-ui): select overlapped nodes in box-select) and the working
tree as left by apply.

## IR frozen — `src/core/pipeline-registry/` untouched

```
git diff 864f45b9..HEAD -- src/core/pipeline-registry/   → 0 lines (empty)
git diff HEAD -- src/core/pipeline-registry/              → 0 lines (empty, working tree)
git status --short src/core/pipeline-registry/            → 0 entries (nothing untracked)
```

Committed range, working tree, and untracked files all clean. The same holds
against the portfolio base `74568906` (every child asserted it before; the
range above subsumes this change's span).

## `V2_BODY_PALETTE_KINDS` unchanged

`packages/ui/src/canvas/draft.ts:736`:

```ts
export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];
```

Byte-identical to the base (the only diff hunk in `draft.ts` is a pure append
after `synthesizeBoundedLoopFromBackedge` — see below).

## No capability hole — gesture/pair model functions behaviorally untouched

`git diff HEAD -- packages/ui/src/canvas/draft.ts` has exactly ONE hunk:

```
@@ -3020,3 +3020,252 @@ export function synthesizeBoundedLoopFromBackedge(
```

252 added lines, 0 removed, all appended at end of file (the new
`detectParallelFrontiers` / `completedFrontier` / `synthesizeParallelFrontier`
section). No hunk touches `addParallelFrontier` (~:849), `createParallelPair`
(~:972), or `setParallelMembers` (~:1046); `unavailableRootGestures` and the
palette wiring are likewise outside the hunk. The explicit Parallel palette
path (`addRootGesture('parallel')` → `addParallelFrontier`) is exercised
end-to-end in the browser gate (`07-explicit-gesture-still-works.png`) and in
the component suite (`the palette parallel gesture still works after a
synthesis`); the pair-property editors are exercised through
`v2-parallel-required` / `v2-parallel-member-select` in the browser gate and
`setParallelMembers` in the model suite.

## Working-tree scope

Exactly the proposal's Impact list, nothing else:

```
 M packages/ui/src/canvas/PipelineCanvasPage.tsx   (toast action, offer hook, review wiring)
 M packages/ui/src/canvas/draft.ts                 (+252: detector, completedFrontier, synthesis)
 M packages/ui/src/style.css                       (toast-with-action layout, 12 lines)
 M packages/ui/test/canvas/draft.test.ts           (+17 tests: detect/completed/synthesize)
 M packages/ui/test/canvas/pipeline-canvas-page.test.tsx (+6 tests: offer/review/confirm/gesture)
?? packages/ui/src/canvas/V2ParallelReviewPanel.tsx (new review panel)
?? rasen/changes/canvas-parallel-frontier-inference/  (change artifacts + evidence)
```

`git diff --check` over the change's paths: no whitespace errors (only the
standing LF→CRLF autocrlf warning on `PipelineCanvasPage.tsx`, same as every
prior child; the repo's blobs stay LF).

## `legacyRuntimeOwner` never stamped

- Model layer: `stamps no legacyRuntimeOwner on any node in next`
  (draft.test.ts) walks every root node of the synthesis result with
  `not.toHaveProperty`.
- POSTed-definition layer: the component test's POST-body walk asserts the
  same over the definition actually sent to validation, and the synthesized
  nodes are minted only by `createParallelPair` (which stamps nothing) and
  wired only by `addV2Connection` — the dual-layer guard of children 2/3.

## Suite

CI-canonical `pnpm --dir packages/ui exec vitest run` (not tail-piped):
**67 files / 838 tests passed, exit 0** — baseline 67/815, +23 (17 model +
6 component). tsc: only the three pre-existing failing files
(ConsultationBindingEditor / IssuesDrawer / v2-node-panel-consultation test),
untouched by this change.
