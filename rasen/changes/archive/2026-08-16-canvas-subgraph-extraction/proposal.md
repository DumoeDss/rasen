# Proposal: canvas-subgraph-extraction

## Why

The portfolio's target experience is that an author box-selects a region of the canvas and turns
it into one reusable unit (the round-one user wording: 框选「打成复用块」). Child 1 shipped the
selection substrate (set selection, box-select, `CanvasSelection`), but the canvas still cannot
turn a selected set into anything — every composition stays flat at the root, and the only way
to get a reusable declaration is to author its body one stage at a time in the declarations
panel. This slice closes that gap: it is the piece the previous round explicitly deferred, and
it is the structural prerequisite for loop inference (a `BoundedLoop` body is a declaration id,
not an inline subgraph).

## What Changes

- A "package into reusable block" action on the canvas multi-selection: box-select stages → the
  selection panel offers to package them into a Custom Composite declaration, replacing them in
  the root graph with one `CompositeRef`.
- The cut is computed from the draft itself: connections crossing the selected set become the
  new declaration's input ports (one per distinct severed incoming target) and outcomes (one
  per distinct severed outgoing source); internal connections move into the declaration body
  verbatim; crossing root connections are rewired onto the ref's ports.
- A review step before the change applies: the author names the declaration and can edit the
  derived input/artifact/outcome rows before confirming; the body summary shows what will move.
- Extractability rules, owned by the draft model: only plain stages may be packaged (the
  declaration body vocabulary is `AtomicStage`-only); a selection is refused while any outside
  Gate targets one of its stages, any outside FanOut/Join counts one of its stages as a member
  or input, or a consultation binding references one of its stages. Refusals name the blocker.
- After confirmation the new `CompositeRef` is the selection, the declaration appears in the
  declarations panel as a custom row, and its per-row "Insert into graph" action keeps working
  (the explicit path stays — no capability hole).
- Definition content is preserved: moved stages and internal connections keep their fields and
  ids verbatim; crossing connections keep their extension fields with only identity, endpoints,
  and ports rewritten; nothing is stamped with `legacyRuntimeOwner`.

## Capabilities

### New Capabilities

<!-- none — extraction is canvas-editor behavior inside the existing pipelines-ui capability -->

### Modified Capabilities

- `pipelines-ui`: the canvas editor gains the box-select-to-declaration gesture. Delivered as
  one ADDED requirement ("The canvas packages a selection into a reusable declaration") — no
  existing requirement text becomes false (the palette, declaration authoring, and
  insert-into-graph behaviors are untouched), so no requirement is modified.

## Impact

- Code: `packages/ui/src/canvas/draft.ts` (extractability rule + derivation + the extraction
  transaction, composed from `addDeclaration`/`insertCompositeRef`/`updateDeclaration`
  primitives — the one-home rule), a review dialog component
  (`packages/ui/src/canvas/V2ExtractReviewPanel.tsx`), `V2SelectionPanel.tsx` (optional package
  action, still presentational), `PipelineCanvasPage.tsx` (action wiring + confirm handler),
  and `packages/ui/test/canvas/` (model + component tests reusing child 1's
  `onSelectionChange` trigger).
- Frozen: `src/core/pipeline-registry/` untouched (asserted by a task).
- No API, dependency, or engine changes; the declaration/ref/rewire shapes already exist in the
  wire types and the engine's own v1 normalizer is the template being mirrored.
- Out of scope, unchanged: loop/parallel/finish inference (children 3/4/5 consume this
  substrate), v1 editor (declaration authoring is v2-only), canvas Save persistence defect.
