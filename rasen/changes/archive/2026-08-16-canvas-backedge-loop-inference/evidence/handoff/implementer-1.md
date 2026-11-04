# Handoff — implementer-1, canvas-backedge-loop-inference (apply)

## Status: COMPLETE — 13/13 apply tasks ticked; parked out to stand-down

- Change: `canvas-backedge-loop-inference` (child 3 of
  `canvas-gesture-ir-compiler`), stage apply.
- Worktree: `feat/canvas-gesture-ir-compiler` @ HEAD `8ad73cc9`, **no commits
  made** (ship owns them). Working-tree delta:
  `packages/ui/src/canvas/{draft.ts,PipelineCanvasPage.tsx}` modified,
  `packages/ui/src/canvas/V2LoopReviewPanel.tsx` new,
  `packages/ui/test/canvas/{draft.test.ts,pipeline-canvas-page.test.tsx}`
  modified, plus `rasen/changes/canvas-backedge-loop-inference/`.
- Tests: full UI suite **67 files / 814 tests, exit 0** via the CI-canonical
  `pnpm --dir packages/ui exec vitest run` (baseline 67/795; +12 model +7
  component; child-2's 21 extraction tests green with zero edits). tsc: only
  the three pre-existing failing files (ConsultationBindingEditor /
  IssuesDrawer / v2-node-panel-consultation test) — untouched by this change.
- Real browser: **ALL CHECKS PASSED** — `evidence/cdp-transcript.md`,
  `evidence/cdp-results.json`, rerunnable driver
  `evidence/cdp-backedge-loop-check.mjs`, 7 screenshots.
- Gates: `evidence/gates-5-2.md` — IR diff vs `74568906` empty (commits AND
  working tree), `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (draft.ts:736),
  DeclarationsPanel/PalettePanel **zero diff lines**, `addBoundedLoopOverDeclaration`
  and `addRootGesture`'s loop branch zero diff lines.

## m2 box-select repeat-probe: REPRODUCED 3/3 (the headline for child 1)

Every verified rectangle (geometry checked: pane start, full containment of
targets, zero intersection with others) dropped at least one enclosed node:

- middle pair `{2,3}` → selected only `[3]`
- singleton `{3}` → selected `[]` (dropped the ONLY node)
- region triple `{2,3,4}` → selected `[3,4]`

Always `atomic-stage-2` missing — the leftmost enclosed stage, i.e. the one
whose left edge the drag ENTERS first... or just the first in intersection
order. This is no longer one-run noise: 3/3 with correct rect math, on a
different session and fixture than child-2's observation. Routed to child 1
(canvas-multi-selection) per the standing order; NOT fixed here. The
back-edge flow never uses box-select, so this change is unaffected.

## Decisions a successor must know

1. **Region insertion order is `[to, from, …intermediates in draft node
   order]`** — `backedgeRegion` seeds the set with the literal `{to, from}`.
   Deterministic; the review's region line shows this order
   ("atomic-stage-2, atomic-stage-4, atomic-stage-3"). The declaration body
   and the cut computation are order-independent of it (they filter
   `root.nodes`/`root.connections`).
2. **`extractSubgraph` is now a three-piece composition**: public
   `extractSubgraph` = `extractSubgraphIntoDeclaration` (validate + declare +
   remove from root) → `insertCompositeRef` → `rewireCrossingsOnto`
   (positional cut rewire parameterized by replacement node id). The loop path
   = declare → `addV2Node(loop)` → rewire(loopId). One implementation of every
   rule; `synthesizeBoundedLoopFromBackedge` differs only in the replacement
   node it mints (plus the positive-integer bound check). Children 4/5 doing
   topology work should reuse `backedgeRegion`'s adjacency
   (`buildAdjacency`/`reachesThrough`) rather than reimplementing
   reachability — the planner digest already says this.
3. **The loop's exits map over the REVIEWED outcomes** (the declaration rows),
   not the derived fallback — multi-outcome exits follow the reviewed order
   (cut keys in draft-connection order); only the LAST exits, to the author's
   `exitOutcome` (page defaults the select to `def.outcomes[0]`; the model
   uses whatever it is given — the review is a select, so it is always a real
   definition outcome).
4. **The v1 + non-editable-endpoint path keeps the plain refusal** — the
   interception lives INSIDE `onConnect`'s `wouldCreateCycle` branch, gated on
   `draft.version === 2` + both endpoints existing editable nodes. The toast
   text is byte-identical on every path; the review opens AFTER the toast on
   the intercepted path, and cancel adds no second toast (the draw-time one
   stands).
5. **The integer-error scope is `loop-review:maxIterations`** (module const
   `LOOP_REVIEW_INTEGER_FIELD`), cleared on open AND on cancel/close via
   `removeAuthoringDraftErrorScopes`. An active error disables the review's
   Confirm AND blocks the page's Validate/Save (`handleValidate`'s
   `hasAuthoringDraftErrors` early return) — that is the standing page
   discipline, not new behavior.
6. jsdom sanitizes non-numeric text on `<input type="number">` ('abc' → '');
  the component test drives '1.5' as the surviving-invalid value.

## Eliminated hypotheses (debugging record — read before touching the driver)

- **"The source handle is covered by a panel" was NOT the panel**: on the
  first driver run every handle drag reported `src-covered` because the
  headless window defaulted to ~764x485 — the flow column collapsed to
  179px, fit-view's transform (`translate(39.5,-35) scale(0.5)`) pushed node
  tops ABOVE the container's box, and `elementFromPoint` at the handle fell
  through to `.pipeline-canvas`. Fix: `--window-size=1600,1000` on the
  throwaway Chrome. Child-2's transcript never mentions a window flag —
  either their Chrome default differed or they got lucky; pin the flag.
- **"The confirm success toast never fired" was NOT an app bug**: the
  draw-time refusal toast's 2500ms `setToast('')` timer fired just after the
  confirm toast was set and clobbered it mid-read. Fix (driver-side): sleep
  2600ms after the review interactions, before clicking confirm, so the
  confirm toast owns its window. The jsdom component test pins the toast text
  authoritatively.
- **The first-order region test failure** was my own wrong expectation, not a
  bug: insertion order is `to, from` then draft-order intermediates (see
  decision 1).

## Environment notes for reruns

- Ports 9333-9338 busy with sibling sessions; this run used **9339** (CDP,
  throwaway Chrome 151 headless, fresh temp profile — killed and profile
  removed after) and **4531** (app server, stopped after).
- Serving: `pnpm --dir packages/ui run build` FIRST (chunk this round:
  `PipelineCanvasPage-DoKwXOt1.js`, verified to contain
  `v2-loop-review-panel`), then `node bin/rasen.js ui --no-open --no-daemon
  --port <p>`; token from the printed URL.
- The m2 probe's Control+click correction was deliberately NOT used — the
  probe is measurement; only child-2's workflow driver corrects.

## Next action

Review routing (LEAD owns it; reads this handoff + the working-tree diff +
`evidence/`). If clean, ship commits with narrow pathspecs: the two modified
`packages/ui/src/canvas/` files, `V2LoopReviewPanel.tsx`, the two modified
test files, and `rasen/changes/canvas-backedge-loop-inference/`. The m2
reproduction needs its own child-1 follow-up task with
`evidence/cdp-results.json`'s `m2Probe` block as the input.
