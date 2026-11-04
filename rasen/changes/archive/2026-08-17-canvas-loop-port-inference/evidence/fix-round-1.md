# Fix round 1 — deviation decision: Validate-clean acceptance clause

LEAD decision (2026-08-17, on the apply-stage deviation report): amend the
spec scenario honestly rather than ship a false claim; defer the deeper
synthesis-defaults fix to the new sibling change
`canvas-loop-validate-clean-synthesis`. This entry records the decision and
the facts the sibling change starts from. Full driver logs and the variant
table live in `browser-gate.md` (same directory).

## The three pre-existing error classes (all shared with the round-one
severed path; none introduced by this delta)

1. **Outcome rows must name producible terminal outcomes.**
   `validateOwnerTerminalOutcomes` (src/core/pipeline-registry/definition.ts:3060)
   requires every owner's declared outcomes to exactly cover the graph's
   unconsumed control outputs. Naming an outcome after a STAGE (severed
   convention, round one) or after the back-edge SOURCE (D2 fallback, this
   change) is unproducible by construction → 2 PORT_MISMATCH +
   UNREACHABLE_EXIT + MISSING_EXIT per synthesized loop.

2. **Derived input rows carry the port NAME as the type.**
   `deriveSubgraphContract` types rows with `connection.to.port` (e.g.
   `'input'`); the engine's control type is `ecp/control`
   (`CONTROL_PORT_TYPE`, definition.ts:2749). Any connection onto a derived
   row — severed (round one) or fallback (this change, via
   `CONTROL_TARGET_PORT`) — fails `validateTypedPorts` with PORT_MISMATCH.
   Fixing the type convention changes round-one outputs and needs its own
   byte-preservation decision (the 3.4 deep-equal pin).

3. **Default lifecycle exits to `iteration-limit`.**
   `createDefaultBoundedLoopLifecycle` maps the iteration-limit exit to the
   outcome `iteration-limit`, which the definition must declare or the root
   graph reports an undeclared terminal outcome. True of every
   canvas-synthesized loop and the palette Loop gesture alike.

## The proven green path (driven end-to-end in the real browser)

Three authored edits, all through existing affordances, take the wired
standalone-cycle loop from 6 errors to **0 errors** (only this machine's
unrelated workflow-profile warning remains):

1. Declaration outcomes → the producible terminal outcome (`done`);
   `updateDeclaration` reconciles the loop's exit map automatically.
2. Declaration input row type → `ecp/control` (the `PortListEditor` type
   field is free text).
3. Definition outcomes += `iteration-limit`.

Variant table (same definition, same `/api/v1/pipeline-validation` endpoint
the Validate button uses): unedited 6 errors → +outcome fix 2 → +entry type
1 → +lifecycle outcome declared 0 (`valid: true`).

## What shipped in THIS change (amended wording)

- Spec scenario "External stages connect after the loop exists" now claims
  what was proven: the connection lands on the entry port, zero errors
  after the author aligns the contract, and the defaults themselves are an
  author-alignment step deferred to `canvas-loop-validate-clean-synthesis`.
- design.md Risks carries the correction (the original "END state validates
  green" was an unverified planning assumption).
- V2LoopReviewPanel.tsx prose updated to name `deriveBackedgeLoopContract`
  (doc comment only; the file's behavior was always unchanged).
- Re-verified after amendment: `rasen validate` green; focused suites
  draft.test.ts + pipeline-canvas-page.test.tsx = 258/258.

## Starting points for canvas-loop-validate-clean-synthesis

- The sibling must decide the naming/type conventions against the engine:
  producible outcome names (the terminal node's outcomes, not stage ids)
  and `ecp/control`-typed entry rows — both break round-one byte
  preservation somewhere and need explicit pins for what DOES stay
  identical (e.g. the region, refusals, rewire positions).
- Class 3 could be fixed engine-side (declare the lifecycle outcome) or
  UI-side (synthesis declares it) — engine is frozen for THIS portfolio's
  children; the sibling's scope is the LEAD's call.
- Repro harness: `.rasen/changes/canvas-loop-port-inference/ephemera/`
  holds the working CDP driver (`browser-gate.mjs`), the capture-based
  variant replayer (`validate-variants.mjs`, `validate-v5.mjs`), and the
  author-edits driver (`author-edits-to-green.mjs`) — all against a
  build-then-serve `rasen ui` on a fresh port.
