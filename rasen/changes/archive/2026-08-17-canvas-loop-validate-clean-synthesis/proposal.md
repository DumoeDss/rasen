# Proposal: canvas-loop-validate-clean-synthesis

## Why

Child-1's real-browser gate proved that loop synthesis NEVER validated clean unedited:
the wired standalone-cycle loop carried 6 engine errors, and reaching 0 required three
authored contract-repair edits (evidence:
`rasen/changes/archive/2026-08-17-canvas-loop-port-inference/evidence/fix-round-1.md`,
variant table 6 → 2 → 1 → 0). The three error classes are pre-existing and shared with
round-one's externals-first path, all born in the synthesis defaults:

1. **Unproducible outcome rows.** Declaration outcomes were named after stages (the
   severed convention, round one) or the back-edge source (child-1's fallback), but the
   engine requires an owner's declared outcomes to EXACTLY cover the graph's producible
   terminal outcomes (`validateOwnerTerminalOutcomes`, `definition.ts:3060`; the body's
   producible set is its stages' unconsumed capability outcomes, `resolveGraphTerminalOutcomes`,
   `definition.ts:2952`). Stage-id names are unproducible by construction.
2. **Port-name-as-type.** Derived input rows carry the port NAME (`'input'`) as the row
   type, but the engine's control type is `ecp/control` (`CONTROL_PORT_TYPE`,
   `definition.ts:2749`); any connection onto a derived row is PORT_MISMATCH.
3. **Undeclared lifecycle exit.** The default lifecycle exits to `iteration-limit`
   (`createDefaultBoundedLoopLifecycle`, `draft.ts:576`), which the definition must
   declare or the root graph reports an undeclared terminal outcome — true of the
   drawn-back-edge synthesis AND the palette Loop gesture alike (shared mint layer).

The IR requires none of this pain and is untouched by the fix: all three are UI-layer
synthesis defaults. Child-1's spec honestly deferred this ("the editor does not mint
engine-clean defaults for a new loop... deliberately deferred to the sibling change
canvas-loop-validate-clean-synthesis" — landed scenario text, `rasen/specs/pipelines-ui/spec.md:1080`);
this change is that sibling.

## What Changes

- **Producible outcome rows (fixes class 1).** The loop path's derived outcome rows
  become the body's producible terminal outcomes: for each body stage, its capability's
  control outcomes (with the engine's loop-phase projection mirrored when a stage
  carries a phase tag) minus the outcomes consumed by the region's internal
  connections, deduplicated in body-node order. This replaces BOTH the severed
  stage-id names and child-1's back-edge-source fallback, on every side — the engine's
  exact-cover rule makes producible names the only validating choice. A body stage
  whose capability is missing from the catalog is surfaced as a loop-review REFUSAL
  (the exit outcomes cannot be derived), not left for Validate to report.
- **Control-typed entry rows (fixes class 2).** The loop path's derived input rows are
  typed `ecp/control` (a draft.ts constant citing the engine's `CONTROL_PORT_TYPE`);
  names keep child-1's boundary convention (severed target stage, or the back-edge
  target when nothing is severed). Applies to severed and fallback rows alike.
- **Declared lifecycle exits (fixes class 3, shared layer).** Loop synthesis declares
  every exit-action outcome the minted loop can emit in the definition's outcome
  contract when absent — `iteration-limit` under the default lifecycle, plus the exit
  outcome value — through `declareDefinitionOutcome` (the single rule site the
  contract panel writes through). Living in the shared mint layer, the fix also covers
  the palette Loop gesture. The loop review shows which outcome names confirming will
  declare.
- **Exit rewired through the loop's exit port.** Outgoing severed crossings are
  rewired onto the loop's EXIT outcome (the review's chosen definition outcome) — the
  engine reads a BoundedLoop's output ports from its exit mappings
  (`contractForNode`, `definition.ts:2851-2867`), not from the declaration's outcome
  rows, so today's positional row-name port is engine-red whenever the names differ.
  The model also re-owns a rule it never checked: the chosen exit outcome must be a
  declared definition outcome.
- **Deliberate supersession of child-1's byte-preservation pin.** The externals-first
  loop results CHANGE where these defaults change them (input row types, outcome row
  names, outgoing rewire port, definition outcomes gaining `iteration-limit`). The
  round-one regression pins that asserted those shapes are updated on purpose — they
  were pinning engine-red output. What stays byte-identical: the region computation,
  the refusals, input row NAMES, incoming-crossing rewire positions, body content
  preservation, id minting, and the entire extract/CompositeRef path.
- Spec coverage: MODIFIED deltas against our own landed requirements (round-one's
  "The canvas turns a drawn back-edge into a bounded loop", child-1's "The loop
  carries its entry and exit" — both landed on the tree via PR #167 and archive
  `d0c761a6`) plus one ADDED requirement for the no-repair guarantee.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: MODIFIED "The canvas turns a drawn back-edge into a bounded loop"
  (review contents and confirming semantics: control-typed rows, producible outcomes,
  exit-through-the-exit rewiring, synthesis-time outcome declarations) and MODIFIED
  "The loop carries its entry and exit" (entry typing and the outcome-side derivation
  rule change; the severed-side byte-preservation clause is superseded deliberately),
  both OUR landed requirements so MODIFIED is sanctioned; plus ADDED "Loop synthesis
  needs no contract repair" (the zero-edit validate-clean guarantee, palette gesture
  coverage, and the review-surfaced underivable-capability refusal).

## Impact

- `packages/ui/src/canvas/draft.ts`: new pure helper deriving a body's producible
  terminal outcomes from the catalog (mirroring `resolveGraphTerminalOutcomes` over
  AtomicStage bodies, phase projection included); `deriveBackedgeLoopContract` gains a
  catalog parameter, re-types input rows, and derives outcomes from the helper; new
  `CONTROL_PORT_TYPE`-equivalent constant; `synthesizeBoundedLoopFromBackedge` gains
  the catalog parameter, the exit-outcome-declared check, the exit-port rewire, and
  the declare-on-synthesis step; `rewireCrossingsOnto` gains an optional
  outgoing-port override (extract path passes nothing — behavior unchanged);
  `addBoundedLoopOverDeclaration` (palette) gains the same declare-on-synthesis step
  through the shared helper.
- `packages/ui/src/canvas/PipelineCanvasPage.tsx`: `openLoopReview` passes the catalog
  to the derivation; the review state carries any catalog-gap refusals.
  `packages/ui/src/canvas/V2LoopReviewPanel.tsx`: a muted line listing outcome names
  confirming will declare (transparency only — no new decision).
- Tests: unit coverage in `packages/ui/test/canvas/draft.test.ts` (producible
  derivation incl. consumed/phase/missing-capability cases, typing, exit-port rewire,
  declare-on-synthesis, palette-gesture declaration, exit-outcome-declared refusal);
  round-one externals-first loop assertions updated deliberately (documented in the
  diff); page test extended to the zero-edit acceptance. Baseline 68 files / 902 via
  `pnpm --dir packages/ui exec vitest run`.
- Real-browser gate: reuse child-1's proven drivers
  (`.rasen/changes/canvas-loop-port-inference/ephemera/` — `author-edits-to-green.mjs`
  minus the edits, `validate-variants.mjs`) on a fresh port 9349+, asserting Validate
  `valid: true` with zero authored contract edits in the empty-canvas flow.
- Frozen and untouched: `src/core/pipeline-registry/` (assert empty diff), the
  definition wire shape, `V2_BODY_PALETTE_KINDS`, no `legacyRuntimeOwner`, the
  extract/CompositeRef path.
- Explicit non-goals: the extract/package-into-block path's own engine-red defaults
  (same class-1/2 defects exist there; a separate change — recorded as a durable
  finding); loop-body visibility (child 3); layout.ts handle rendering (loop output
  handles still render the declaration's outcomes — engine-valid exactly when the
  chosen exit outcome name coincides with a producible name, the common default
  shape; the general render-vs-exit-port divergence is recorded, not fixed here);
  strategy/lifecycle authoring beyond the default.
