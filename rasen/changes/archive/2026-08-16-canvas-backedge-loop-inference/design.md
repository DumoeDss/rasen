# Design: canvas-backedge-loop-inference

## Context

Children 1 and 2 shipped the substrate this slice consumes:

- Selection: `CanvasSelection` (`draft.ts:1857`), the page's `replaceSelection` /
  `syncFlowSelection` pairing and the `recomputeFlow` selectionOverride path (the
  SelectionListener revert trap, `PipelineCanvasPage.tsx:330-341`).
- Extraction: `subgraphExtractionRefusals` (`draft.ts:2551`, the refusal rules), the internal
  `subgraphExtractionRefusalsForNodeIds` seam `extractSubgraph` re-runs, `computeSubgraphCut`
  (`:2650`, the positional (stage, port) cut enumeration shared by derivation and rewire,
  keyed through `CUT_KEY_SEPARATOR`), `deriveSubgraphContract` (`:2696`),
  `SubgraphExtractionInput/Result` (`:2721-2733`), and `extractSubgraph` (`:2756`) —
  validate → build custom declaration with verbatim body → remove from root →
  `insertCompositeRef` → rewire crossings positionally onto the ref's ports.
- The loop template: `addBoundedLoopOverDeclaration` (`draft.ts:843-867`) —
  `{ id, kind: 'BoundedLoop', body: <declarationId>, limits: { maxIterations: 3, maxActions:
  12, budget: 12 }, lifecycle: createDefaultBoundedLoopLifecycle(), exits: <last body outcome
  exits to def.outcomes[0], others continue> }`. `WireBoundedLoopNode.body` is a **declaration
  id** (`types.ts:1386`) — the structural reason C depends on B.

What the model does with cycles today (the behavior C intercepts): `wouldCreateCycle`
(`draft.ts:305-307`) answers "would connecting `from -> to` close a cycle" by reachability
(`reachesThrough(buildAdjacency(def), ...)`) over v1 `requires` / v2 typed edges; the page's
`onConnect` calls it FIRST and refuses with a toast before anything is added, so a drawn
back-edge never enters the draft. Body graphs get the same treatment per declaration
(`bodyWouldCreateCycle`, `:315-327`) — a cycle inside a declaration body is illegal, which is
why the back-edge must be consumed by the synthesis rather than moved into the body.

Child-2 implementation constraints that bind here (from the archived implementer handoff):
severed edges map onto reviewed contract rows POSITIONALLY in draft-connection order with a
derived-name fallback; `CUT_KEY_SEPARATOR` must stay `String.fromCharCode(0)` (never a `\0`
literal in an Edit/Write payload — the JSON layer turns it into a real NUL byte);
`PortListEditor`/`NameListField` are exported from `DeclarationsPanel.tsx` as the one row-UX;
the confirm handler must write both selection truths in one tick; and the open m2 probe
(box-select containment deterministically dropping an enclosed node, 3/3 in child 2's
transcript) is repeated FIRST in this change's browser gate — if it reproduces it is a
child-1 follow-up, not this change's scope.

## Goals / Non-Goals

**Goals:**

- A drawn cycle-closing connection opens a loop review (v2 edit mode); cancel reproduces
  today's refusal outcome byte-for-byte.
- The review shows the enclosed region, the derived contract, the bound, and the exit outcome;
  the author adjusts; confirm synthesizes.
- Synthesis = extract region into a custom declaration (reusing child 2's machinery via an
  internal decomposition) + mint `BoundedLoop` pointing at it + rewire crossings onto the
  loop's ports + select the loop. The back-edge exists only as loop semantics.
- Refusals reuse `subgraphExtractionRefusals`' named blockers verbatim.
- Explicit Loop gesture and insert-into-graph untouched; nothing stamped
  `legacyRuntimeOwner`.

**Non-Goals:**

- Parallel-frontier and sink-finish inference (children 4/5).
- v1 editor (its loop settings stay the stage-panel's review-cycle controls).
- Editing the enclosed region by hand in the review (the region is computed; the author who
  wants a different region draws a different back-edge or uses child 2's selection-based
  packaging).
- Regions containing non-AtomicStage nodes (refused; extracting fan-outs/loops into bodies is
  future work if ever wanted).
- Fixing box-select containment (m2 — probed, routed to child 1 if it reproduces).
- Canvas Save persistence defect.

## Decisions

### D1. Detection rides the existing cycle refusal — no second rule

`onConnect`'s v2 branch: when `wouldCreateCycle` fires AND both endpoints are editable nodes,
open the loop review instead of stopping at the toast (the toast text still heads the review,
so the author sees why the edge was not added). The drawn `Connection` object is passed to the
review but never written to the draft — cancel therefore equals today's state exactly. v1 and
non-editable endpoints keep the plain refusal. There is no separate "is this a back-edge"
predicate to drift: a refused cycle-closing draw IS loop intent by construction, and
`wouldCreateCycle` stays the single owner of cycle semantics.

### D2. The region is reachability over the same adjacency the cycle check uses

`backedgeRegion(def, from, to)` (new, `draft.ts`): S = `{to, from} ∪ {n | to ⇝* n ∧ n ⇝* from}`
computed with the `buildAdjacency`/reachability machinery `wouldCreateCycle` already uses —
one adjacency builder, two questions, no direction drift (the implementer pins the exact
`reachesThrough` direction against `:305-307`'s tests). Deterministic and
connection-order-stable; S always contains both endpoints (the existing path `to ⇝* from` is
what made the draw a refusal). A self-loop draw (from === to) yields S = {that node} — a
single-stage retry loop, legal.

### D3. Reuse child 2's extraction by decomposing it, not duplicating it

`extractSubgraph` currently does four things inline: build+validate the declaration, remove
the region from root, `insertCompositeRef`, rewire onto the ref. Decompose internally
(public signature and behavior unchanged, existing tests stay green):

- `extractSubgraphIntoDeclaration(def, { nodeIds, id, contract }) -> { next, declarationId }`
  — validate (refusals re-run, id/row rules) + build declaration + remove from root.
- `rewireOnto(def, preExtractionDef, nodeIds, replacementId, rows, derived)` — the positional
  cut rewire parameterized by the replacement node id.

`extractSubgraph` = declare → `insertCompositeRef` → rewire(refId). The new
`synthesizeBoundedLoopFromBackedge(def, input)` = region → refusals → declare → mint loop →
rewire(loopId). One implementation of every rule; the loop path differs only in the
replacement node it mints and appends.

### D4. The loop mint mirrors the explicit gesture, with the author's two knobs

`WireBoundedLoopNode` built exactly like `addBoundedLoopOverDeclaration` (`:851-865`) except:
`body` = the just-extracted declaration id (explicit, not "first with a body");
`limits.maxIterations` = the author's reviewed bound (positive integer; `maxActions`/`budget`
keep the gesture's defaults 12/12); `exits` = the same last-outcome-exits convention but
exiting to the author's picked definition outcome (default `def.outcomes[0]`); `lifecycle` =
`createDefaultBoundedLoopLifecycle()`. The loop stays editable post-hoc via the existing
`V2NodePanel` bounded-loop patch path — the review is not the last word.

### D5. Back-edge consumption is structural, not a special case

The drawn edge never entered the draft, so nothing must be excluded from the body move: the
connections that move into the body are the region's existing internal edges — all acyclic
(a body cycle is what `bodyWouldCreateCycle` exists to refuse). The loop's iterate semantics
replace the drawn edge; "the back-edge does not persist" is a one-line test assertion, not
logic.

### D6. Review UI and wiring

- `V2LoopReviewPanel.tsx`, the child-2 review pattern (modal overlay, model-owned validation
  surfaced in-dialog, edits survive an error): the back-edge endpoints, the region node list
  (read-only), the derived contract rows (editable via the exported
  `PortListEditor`/`NameListField`), `maxIterations` integer field (the existing
  authoring-draft-errors discipline for invalid integers blocks confirm), exit-outcome select
  (definition outcomes), declaration id (default `loop-body`, `loop-body-2`, … minted by the
  page via `isDeclarationIdUnique`). Refusals render in place of the confirm button.
- Page confirm handler: `synthesizeBoundedLoopFromBackedge` → `setDraft` →
  `recomputeFlow(next, catalog, [loopId])` (both selection truths in one tick) →
  `markDraftChanged()` → success toast; model errors surface as toast + in-dialog line with
  the review staying open (child-2's rule).
- The region and contract are computed at review-OPEN from the live draft; the transaction
  re-validates against the draft at confirm (the review is modal; child-2's "captured at
  open, judged exactly" discipline).

### D7. Never stamp `legacyRuntimeOwner`; no capability holes

The minted loop carries exactly the fields D4 lists; the declaration and rewire paths are
child 2's, already guarded. Dual-layer `not.toHaveProperty` tests: model layer over every
body node and the loop, AND over the definition actually sent to validation (round-one
discipline). The palette Loop gesture, `addBoundedLoopOverDeclaration`, and the
declarations-row insert action are untouched; `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`.

### D8. Spec delta stays ADDED-only

One ADDED requirement; the existing cycle-refusal wording stays true because cancel
reproduces it exactly and the drawn edge is never added as a plain connection. Merge-order
agnostic per the child-1 digest rule.

### D9. Test strategy

- Model unit tests: region computation (diamond graphs, side branches excluded — a node on
  `to ⇝* n` but not `n ⇝* from` stays outside; self-loop; endpoints-only); the decomposition
  refactor (existing extraction tests green unchanged); synthesis shape (declaration +
  loop + rewire, back-edge absent from root, exits mapping per author choice, defaults);
  refusals surface verbatim; `legacyRuntimeOwner` dual-layer; id/row validation reuse.
- Component tests (child-1 `onSelectionChange` trigger where selection matters, child-2's
  review-test patterns): the refused draw opens the review (draft unchanged); cancel;
  confirm end-state (loop selected, region gone, externals rewired, declaration row present);
  refusal text; invalid-integer bound blocks confirm; POST-body guard.
- Real browser (throwaway CDP, direct on a fresh port — neighbors 9333+ run busy): **the m2
  box-select repeat-probe FIRST** (several rectangles over known-contained sets, assert full
  membership; if it reproduces, record and route to child 1 — not this change's scope), then
  the back-edge flow end-to-end. Child-2's driver pitfalls apply verbatim: close the
  selection summary panel before handle drags (it covers right-column handles), focus before
  blur on inputs, re-fit-view before every drag attempt, `pnpm --dir packages/ui run build`
  before serving.
- Suite: CI-canonical `pnpm --dir packages/ui exec vitest run`, counts cited against
  67 files / 795 tests.

## Risks / Trade-offs

- [Refactoring shipped `extractSubgraph` internals breaks child 2's behavior] → public
  signature unchanged; child-2's 21 model tests + 5 component tests are the regression net;
  the decomposition lands as its own task before any loop logic.
- [Author expects the drawn edge to remain visible as an edge] → the loop node's
  declaration-derived ports render the entry/exit the rewire produces; the review's region
  list sets the expectation before confirm. Accept; note in the toast ("Loop created from
  back-edge …").
- [Loop bodies with derived input ports may validate differently than the engine's legacy
  template (which uses `inputs: []`)] → Validate stays the authority (the portfolio's
  standing posture); the review shows the derived rows and the author can delete them
  (child-2's positional-fallback rule applies).
- [Direction bug in region computation mirrors the cycle check's direction] → one adjacency
  builder shared with `wouldCreateCycle`; unit tests pin both directions on the same fixture.
- [m2 probe reproduces mid-change] → it does not block this change's scope (back-edge flow
  does not lean on box-select); record, route to child 1, continue.
- [Windows flakiness] → isolate and re-run on a settled machine; never pipe through `tail`.

## Migration Plan

Single change, single PR: decomposition refactor + green tests first, then region + synthesis
+ model tests, then review UI + wiring + component tests, then the browser gate (m2 probe
first). Rollback is the PR revert; the only persisted-format effect is ordinary authored v2
content (a custom declaration + a BoundedLoop node) the engine already accepts. Ship `local`;
the parent delivers after all children.

## Open Questions

- Should the review offer editing the region (deselect stragglers)? Deferred — computed
  regions keep the gesture one-shot; child 2's selection-based packaging already covers
  hand-picked regions.
- Should `maxActions`/`budget` be author-facing in the review too? Deferred — the loop's
  properties panel already edits them post-hoc; the review carries the two knobs the handoff
  names (bound + exit).
- Default exit mapping "last body outcome exits" inherits the gesture's convention — revisit
  only with user feedback.
