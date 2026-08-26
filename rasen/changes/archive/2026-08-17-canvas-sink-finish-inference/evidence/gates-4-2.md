# Gates 4.2 — IR frozen, vocabulary unchanged, no capability hole

Date: 2026-08-17. Working tree = child-5 apply (uncommitted); last archived child ship
= `f66666d9` (child-4 archive, ship `6dba3ff0`); portfolio base = `74568906`.

## IR frozen: `src/core/pipeline-registry/` untouched

```
$ git diff 74568906..HEAD --stat -- src/core/pipeline-registry/
(empty)
$ git diff f66666d9 --stat -- src/core/pipeline-registry/
(empty)
$ git diff f66666d9 --stat -- src/core/pipeline-registry/   # + working tree
(empty)
```

Zero diff both against the portfolio base `74568906` (the portfolio-wide
"zero diff since base" posture) and against the last archived child ship
`f66666d9` plus the uncommitted working tree. The registry engine
was not touched by this change.

## `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`

`packages/ui/src/canvas/draft.ts:736`:

```ts
export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];
```

Unchanged (no `-`/`+` lines touch it in `git diff f66666d9 -- packages/ui/src/canvas/draft.ts`).

## `addFinishNode` + the palette gesture path behaviorally untouched

- `git diff f66666d9 -- packages/ui/src/canvas/draft.ts`: the ONLY hunks are
  (a) the new `===== Sink promotion =====` section appended after
  `synthesizeParallelFrontier` (new exports `isPromotableSink` /
  `promoteSinkToFinish` / `SinkPromotionResult`, new private constant
  `PROMOTABLE_SINK_KINDS`) and (b) no changes at all inside
  `addFinishNode` (`draft.ts:901-905`) or `V2_NODE_ID_BASE` — grep of the
  diff's `[-+]` lines for `addFinishNode|V2_NODE_ID_BASE|Finish` matches only
  the NEW section's code/comments.
- `git diff f66666d9 -- packages/ui/src/canvas/PipelineCanvasPage.tsx`: no
  `[-+]` line matches `addFinishNode|addRootGesture|v2-palette` — the
  `addRootGesture('finish')` handler and its palette button are untouched;
  the new wiring is additive (imports, `confirmSinkPromotion`,
  `selectedV2SinkOutcomes` memo, the `sinkPromotion` prop pass).
- `git status --porcelain packages/ui/src/canvas/PalettePanel.tsx` → empty:
  the palette component is untouched.
- Behavioral proof, not just textual:
  - jsdom: `pipeline-canvas-page.test.tsx` "the palette Finish gesture still
    works after a promotion (no capability hole)" — `finish-2` appears,
    UNWIRED, first-outcome default, exactly `addFinishNode`'s shape.
  - Real browser: CDP check "the gesture Finish is unwired (exactly
    addFinishNode behavior)" + "the gesture Finish carries the first-outcome
    default" (`cdp-results.json`, both PASS).
- The promoted Finish is indistinguishable from an authored one: model test
  pins `promoted toEqual { ...gestureFinish, outcome: picked }` and the
  promoted node patches through the same `updateV2NodeFields` path.

## Suite (task 3.2 cross-cite)

CI-canonical `pnpm --dir packages/ui exec vitest run`:
**67 files / 854 tests passed** (baseline 67/839; +12 model, +3 component).
