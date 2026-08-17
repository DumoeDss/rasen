# Handoff — implementer-1, canvas-loop-body-visibility (apply)

Status: ALL 18 tasks done; stage complete. Working tree carries the full
implementation, UNCOMMITTED per the round-3 implementer discipline — the ship
stage owns the narrow-pathspec commit (inventory + suggested pathspec in
`evidence/constraint-sweep.md`): `packages/ui/src/canvas/layout.ts`,
`packages/ui/src/canvas/StageNode.tsx`,
`packages/ui/src/canvas/PipelineCanvasPage.tsx`,
`packages/ui/src/canvas/V2BodyStagePanel.tsx` (new),
`packages/ui/src/style.css`,
`packages/ui/test/canvas/layout.test.ts`,
`packages/ui/test/canvas/pipeline-canvas-page.test.tsx`,
`packages/ui/test/canvas/canvas-authored-composite-export.test.tsx`,
`packages/ui/test/style/canvas-frame.test.ts` (new),
`rasen/changes/canvas-loop-body-visibility/`. `bin/rasen.js` is the CRLF
phantom — stays out of every pathspec. `.rasen/…/ephemera/` (driver,
screenshots, transcripts, throwaway chrome-profile* dirs) stays untracked.

## What shipped

- **Frame machinery (layout.ts)**: `UnpositionedStage` gains optional
  `width`/`height` (dagre dims AND the flow node's render `style`; default
  constants keep every existing caller byte-identical — unit-pinned);
  `declarationBodyFrame(def, declarationId, frameId, catalog)` — a pure dagre
  pass over the declaration body with the root-pass constants, the v1
  group-sizing arithmetic for the frame box, namespaced children
  (`<frameId>::<bodyId>`, parent-relative positions, `parentId` +
  `extent: 'parent'`, inert group-parity flags, real card data +
  `bodyStage: {frameId, declarationId}`), and prefixed body edges
  (`body:<frameId>:<connectionId>`), shared by `BoundedLoop.body` and
  `CompositeRef.declarationId`; `draftToGraph(def, catalog?, expandedFrames?)`
  returns root nodes + `frameChildren` map (children NEVER in the root array
  — the placement cache's prune set stays root-only) with byte-parity when
  the set is absent/empty-of-that-id; `layoutGraph` splices each frame's
  children immediately after the frame (parentId resolution order).
- **Cards/panel**: StageNode's frame variant (header strip + identity +
  collapse chevron + tinted body region filling the wrapper's explicit size)
  and the chevron on the collapsed card (`nodrag` + stopped click — no RF
  side effects); body cards carry the read-only click affordance; new
  `V2BodyStagePanel.tsx` (presentational, facts + declarations-panel pointer
  + the honest future-change note, one close button); CSS + a constants-tied
  string pin (`test/style/canvas-frame.test.ts` imports GROUP_PADDING /
  GROUP_LABEL_HEIGHT so CSS and geometry cannot drift).
- **Page wiring**: `expandedFramesRef` (session-only, reset in
  `enterEditWith`); auto-expand at formation in all three handlers
  (loop-review confirm, palette loop gesture, extract confirm);
  `bodySelection` scalar with full mutual exclusivity (body click → panel +
  `replaceSelection([])`; a selection WITH CONTENT closes the panel; pane
  click clears both via `onPaneClick`; collapse clears its own frame's
  panel); `recomputeFlow` prunes a body panel whose frame/declaration/stage
  left the draft; the drag-capture loop additionally skips non-root ids
  (body ids can never enter the root-keyed placement cache).
- **React Flow controlled-mode stabilization (found live, fixed in-page)**:
  the affordance wiring is memoized on `flowNodes` with stable
  `useCallback([])` handlers reading live draft/catalog/selection through a
  ref (`latestFlowInputsRef`) — node-object identity now changes exactly
  when the flow rebuilds; `recomputeFlow` carries `measured` across
  rebuilds by id; `CanvasFlow` forces one batched `useUpdateNodeInternals`
  when the node ID set changes. Without these, RF's `adoptUserNodes`
  (checkEquality) re-initialized nodes on every render, clearing
  measured/handleBounds, and body-frame edges rendered NOTHING.
- One existing test supersession (honest): the back-edge suite's "region
  gone" assertion now asserts the exact ROOT id list + the namespaced body
  ids (the synthesized loop opens expanded — the region renders as body
  children). Every other existing assertion passes unchanged.

## Gates (all green on the final clean build)

- Full UI suite `pnpm --dir packages/ui exec vitest run`: **69 files / 927**
  (baseline 68/912; +1 file, +15 tests), zero failures.
- Typecheck: exactly the 13 pre-existing errors.
- Real browser (port 9354 server, throwaway Chrome 151 1600×1000, CDP 9355,
  fresh profile): all 13 gates in one run — empty canvas → cycle → confirm →
  loop OPENS EXPANDED (frame 668×208, both body stages + their connection
  rendered inside, external handles intact) → body panel → collapse (compact
  card, zero body children/edges, handles byte-identical) → re-expand →
  composite-ref symmetry via package-into-block (auto-expanded + manual
  collapse/re-expand). Narrative + traps in `evidence/browser-gate.md`;
  driver + 12 screenshots + transcripts in `.rasen/…/ephemera/`.
- Constraint sweep `evidence/constraint-sweep.md`: IR frozen (empty diff
  under `src/core/pipeline-registry/`), draft.ts untouched (wire shape
  intact; page test pins no `::`/`expandedFrame` in the submitted payload),
  `V2_BODY_PALETTE_KINDS` unchanged, no `legacyRuntimeOwner`, v1 group path
  byte-identical.

## Eliminated hypotheses (debugging this stage)

- "The missing body edge was a store/adoption failure" — no: the store HELD
  the edge (`getEdges()` proved it via a temporary onInit debug hook) and
  the nodes rendered; `EdgeWrapper` returns null while an endpoint's
  `handleBounds` is undefined, and adoption identity churn kept clearing
  them. The same churn wedged leftover tabs ("beforeunload dialog" below
  aside). Fix = identity stability + measured-carry + forced internals
  refresh, not edge handling.
- "The tab freezes were a render loop in my code" — no (twice): first the
  real adoption-churn wedge, then — after stabilization — the recurring
  'timeout' on leftover tabs was the dirty editor's beforeunload MODAL
  blocking navigation/debugging entirely. A CPU profile of a healthy
  collapse was 97% idle; the dialog was the blocker.
- "The body panel race was the selection listener wiping on every re-fire" —
  half right: the listener DID wipe, but only because the body click's own
  `replaceSelection([])` re-fired it against the pre-replace mirror. Only a
  selection WITH CONTENT may clear the panel; the pane click owns the empty
  case.
- "The intermittent GATE 9 failure was page churn" — no: Preact schedules
  renders via requestAnimationFrame and Chrome SUSPENDS rAF in an occluded
  tab — state landed but painted seconds late (exactly the 2.5s toast timer)
  until `Page.bringToFront`. A driver trap, not a product bug.
- "CDP takes modifier name arrays" — no: bitmask (Shift=8, Ctrl=2); `[]` and
  `['Shift']` both return "Invalid parameters".

## Durable findings for the next workers

- Any node-data callback injected into React Flow nodes MUST be
  identity-stable across renders (stable callback + live-state ref) and the
  nodes prop must not churn identity — RF's controlled adoption re-reads
  identity and re-initializes otherwise. The same applies to any future
  in-frame interaction work.
- Every test file that mocks `@xyflow/react` must export every symbol the
  page imports — a missing `useUpdateNodeInternals` crashed that file's page
  render (caught only by the FULL suite; the focused page-file run was
  green).
- Future gate drivers: `Page.bringToFront` first; handle
  `Page.javascriptDialogOpening` (dirty-canvas beforeunload); never run the
  gate concurrent with the vitest suite (screenshot timeouts).
- Known boundary carried unchanged: loop output handles still render the
  declaration's outcome rows while engine ports are exit values (coincide in
  the default flow); in-frame EDITING remains the recorded follow-up.
