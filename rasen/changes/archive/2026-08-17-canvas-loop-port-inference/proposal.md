# Proposal: canvas-loop-port-inference

## Why

Live testing round 3 (2026-08-17, user on the PR #169 build): the author wired two stages
into a cycle on an empty canvas, confirmed the loop review, and got a BoundedLoop node
with no entry — verbatim: "为什么现在连成循环节点就变成了一个节点，还没有入口，我当前想要用ecp表达一个review-cycle这么难吗？". The cause is an ordering trap in the
round-one loop synthesis: the body declaration's contract is derived by
`deriveSubgraphContract` (`draft.ts:2819`), which derives rows ONLY from connections the
extraction severs. A standalone cycle severs nothing, so the declaration gets
`inputs: []` and the loop node — whose handles render straight from that contract via
`lookupDeclarationPorts` (`layout.ts:86`) — shows ZERO input handles. Nothing can be
connected into the loop; the author must have wired external stages in FIRST and closed
the cycle LAST for the severed edges to produce ports. Authoring order became a hidden
requirement the IR never imposed: the engine itself mints loop bodies whose contract
rows no edge severed (`normalizeV1()` at `definition.ts:3603-3637` emits
`outcomes: ['done']` unconditionally), so a declaration's ports are an authored
contract, not edge-derived residue — the UI was free to derive them structurally all
along.

## What Changes

- When a back-edge loop region's extraction severs no INCOMING connection, the derived
  contract gains one entry input port derived from the back-edge itself: named for the
  back-edge's TARGET stage, typed as a control input. That stage is provably the body
  graph's unique root (the draft is acyclic — the back-edge was refused precisely
  because it would close a cycle — so no internal edge can enter the back-edge's
  target), making the name semantically honest: control enters the loop there.
- When the extraction severs no OUTGOING connection, the derived outcome list names the
  back-edge's SOURCE stage (the body's unique sink, the tail the body runs to before
  the exit decision) instead of today's generic `'done'` default — the same convention
  severed outcomes follow (named for the boundary stage the control leaves from).
- Precedence is per-side and byte-preserving: a side with severed connections derives
  exactly the rows it does today; the back-edge fallback fires only on a side that
  would otherwise be empty. Mixed regions (incoming severed, outgoing not, or vice
  versa) get severed rows on one side and the fallback on the other.
- The rule lives entirely in the model (`draft.ts`) as one new derivation function the
  review-open path and the confirm-time transaction both call — no second derivation to
  drift. Rendering needs nothing: the handles already render from the declaration's
  contract. The IR (`src/core/pipeline-registry/`) is untouched, as in every round.
- Result: from an empty canvas — two stages wired into a cycle, review confirmed — the
  BoundedLoop node HAS an input handle and an exit outcome handle; external stages can
  be connected AFTER the fact; Validate stays the authority. Authoring order stops
  mattering.
- The derived rows remain review-editable defaults, and the author can rename them
  afterwards through the declaration contract editor (`updateDeclaration` already
  reconciles a referencing loop's exit map, `draft.ts:2239`).
- Spec coverage via an ADDED-only delta under `pipelines-ui` ("The loop carries its
  entry and exit").

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: ADDED-only delta adding one requirement: a loop synthesized from a
  back-edge carries an entry port and an exit outcome derived from the back-edge when
  the region's extraction severs none on that side; severed connections keep their
  existing precedence on each side; the round-one externals-first results are
  unchanged.

## Impact

- `packages/ui/src/canvas/draft.ts`: one new exported derivation function composing
  over `deriveSubgraphContract` (which itself stays byte-identical — the
  package-into-block path is untouched); `synthesizeBoundedLoopFromBackedge`'s internal
  re-derivation (`draft.ts:3110`) switches to the new function. `rewireCrossingsOnto`
  needs no change: fallback rows exist only when a side's real severed list is empty,
  so positional rewire indices never shift.
- `packages/ui/src/canvas/PipelineCanvasPage.tsx`: `openLoopReview` (`:1406`) switches
  its derivation call; the `loopReview` state's `derived` type annotation follows. The
  review panel (`V2LoopReviewPanel.tsx`) is unchanged — its `derived` prop shape is
  identical.
- `packages/ui/src/canvas/layout.ts`: no change (handles already render from the
  declaration contract).
- Tests: unit coverage in `packages/ui/test/canvas/draft.test.ts` (standalone cycle,
  self-loop single-node region, mixed sides, severed-sides-unchanged deep-equal pin,
  review-edit override); page-test coverage of the empty-canvas acceptance flow.
  Baseline 68 files / 894 tests via `pnpm --dir packages/ui exec vitest run`.
- Real-browser gate: fresh port (9349+), `--window-size=1600,1000`, build-then-serve —
  empty canvas, two stages wired into a cycle, confirm review, assert both handles,
  connect an external stage onto the entry port, Validate.
- Frozen and untouched: `src/core/pipeline-registry/` (assert empty diff vs `f512e3ea`),
  `V2_BODY_PALETTE_KINDS`, no `legacyRuntimeOwner` stamps, definition wire shape.
- Explicit non-goals: the package-into-block (box-selection extraction) path keeps
  today's behavior — it has no back-edge to derive from, so a self-contained selection
  still defaults its outcomes to `'done'` and its inputs to empty (child 2 of this
  portfolio renders loop bodies; it does not change extraction either); loop-body
  visibility inside the node is child 2 (`canvas-loop-body-visibility`), not this
  change; no change to the explicit palette Loop gesture (`addBoundedLoopOverDeclaration`
  untouched).
