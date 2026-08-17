# Handoff — implementer-1, canvas-loop-port-inference (apply, fix round 1)

Status: ALL 13 tasks done; fix round 1 (LEAD decision on the Validate
deviation) applied; stage complete. Working tree carries the full
implementation, UNCOMMITTED per the round-3 implementer discipline — ship
stage owns the narrow-pathspec commit (`packages/ui/src/canvas/draft.ts`,
`packages/ui/src/canvas/PipelineCanvasPage.tsx`,
`packages/ui/src/canvas/V2LoopReviewPanel.tsx` (doc comment only),
`packages/ui/test/canvas/draft.test.ts`,
`packages/ui/test/canvas/pipeline-canvas-page.test.tsx`,
`rasen/changes/canvas-loop-port-inference/`). `bin/rasen.js` is a CRLF
phantom — stays out of every pathspec. Prior portfolios' untracked residue
stays unstaged.

## What shipped

- `deriveBackedgeLoopContract(def, region, from, to)` in draft.ts,
  composing OVER `deriveSubgraphContract` (per-side fallback: empty inputs
  → `[{name: to, type: CONTROL_TARGET_PORT}]`; empty outcomes → `[from]`;
  emptiness tested against the CUT's key lists, because the base
  materializes an empty outcome side as `['done']` and a severed outcome
  could legitimately be named `done`). `deriveSubgraphContract`,
  `computeSubgraphCut`, `rewireCrossingsOnto` untouched. Exactly two call
  sites switched: `openLoopReview` (PipelineCanvasPage.tsx, with the
  `loopReview` state's `derived` type) and `synthesizeBoundedLoopFromBackedge`'s
  internal re-derivation.
- Tests: +7 unit (standalone cycle incl. synthesis + exits, self-loop,
  mixed both directions incl. rewire pin, deep-equal externals-first pin,
  review-edit override), +1 page acceptance (cycle-first flow, both
  handles asserted from the declaration-contract port descriptors,
  loop-entry connect seam added to the shared ReactFlow mock — first
  AtomicStage's LAST output handle onto the first BoundedLoop's FIRST
  input handle; AtomicStage cards render artifacts before outcomes, so
  output[0] is `patch`, not the control `done`).
- Gates: full UI suite 68 files / 902 (baseline 68/894). Real browser:
  everything the delta claims verified (see evidence/browser-gate.md);
  spec scenario amended in fix round 1 to the proven truth; design.md
  Risks corrected; V2LoopReviewPanel.tsx prose names the new function.

## The material deviation and its resolution

The original acceptance clause "Validate reports no issue for the wired
graph" was an unverified planning assumption. Unedited synthesized
defaults are engine-red (6 errors) for three PRE-EXISTING classes shared
with round-one's severed path — see evidence/fix-round-1.md for the
engine-cited list (producible-outcome naming, port-name-as-type vs
`ecp/control`, lifecycle `iteration-limit` declaration). Zero errors is
reachable via three authored edits (proven live) and the deeper
synthesis-defaults fix is deferred to the sibling
`canvas-loop-validate-clean-synthesis`, which the amended delta names
explicitly.

## Eliminated hypotheses (browser-gate debugging)

- "The back-edge drag failed because React Flow rejected it" — no: the
  nodes rendered OFF-PANE (node 2's handles at x≈1436–1836 in a 734px
  pane); the release landed on the right panel. Fix: fit-view
  (`.react-flow__controls-fitview`) before every drag + an in-pane guard
  on both endpoints.
- "The wedge after the first run was the server" — no: the CDP target's
  debug session wedged after a script crashed mid-`Page.navigate`;
  Runtime.enable then timed out forever on that target. Fix: kill Chrome,
  fresh instance + fresh user-data-dir + new debug port.
- "The 6th error (entry PORT_MISMATCH) was introduced by the fallback" —
  no: the fallback inherits `CONTROL_TARGET_PORT` exactly like severed
  rows; the type-vs-port-name defect is identical in the round-one path
  (variant replays + engine read confirmed; V3 proves the single-edit
  fix).
- "Declaring all lifecycle outcomes would finish the green path" — no:
  V4 over-declared (`stall`/`blocker` unproducible in the real default
  lifecycle); the minimal set is `['done', 'iteration-limit']` (V5,
  `valid: true`).

## Gotchas for the next worker on this portfolio

- CDP `Page.navigate` can wedge a target if the driver dies mid-call —
  always wrap with a fallback (`location.assign` via evaluate) and be
  ready to relaunch the browser.
- React Flow edge DOM ids: read `data-id` on `.react-flow__edge` (the
  `id` attribute is empty); node handles: `.react-flow__handle` +
  `data-handleid`.
- The validate response on this machine ALWAYS carries one unrelated
  workflow-profile warning; assert on error counts / `valid`, never on
  "no issues at all".
- Full driver suite reusable for the sibling change:
  `.rasen/changes/canvas-loop-port-inference/ephemera/` (browser-gate.mjs,
  validate-variants.mjs, validate-v5.mjs, author-edits-to-green.mjs,
  screenshots 01–08).

Next action (ship stage): commit with the narrow pathspec above, PR per
portfolio discipline (children ship LOCAL; parent delivers once).
