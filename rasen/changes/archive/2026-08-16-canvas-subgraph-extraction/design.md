# Design: canvas-subgraph-extraction

## Context

Child 1 shipped the selection substrate: `CanvasSelection { nodeIds, connectionIds }` in
`draft.ts` (`:1857`), `selectionPanelMode` (`:1894`), the page's `replaceSelection` /
`syncFlowSelection` pairing (PipelineCanvasPage.tsx `:342-377` — the SelectionListener
revert trap is documented there and its discipline is binding for this change too), and
`recomputeFlow(def, catalog, selectionOverride)`. This slice consumes `selection.nodeIds` and
derives everything else from the draft, exactly as child 1's design D1/D2 contracted.

The grammar this slice manipulates (all type sites verified at the current base):

- `WireCompositeDeclaration` — `packages/ui/src/api/types.ts:1498`: `{ id, kind: 'Composite',
  provenance: 'built-in' | 'custom', inputs: WireDefinitionPort[], artifacts:
  WireDefinitionArtifact[], outcomes: string[], graph }`; `WireDefinitionPort { name, type,
  required? }` (`:1306`), `WireDefinitionArtifact { name, type }` (`:1312`). The IR mirror is
  `CompositeDeclaration` at `src/core/pipeline-registry/definition.ts:243`.
- `WireCompositeRefNode` — `types.ts:1379`: `{ kind: 'CompositeRef', declarationId }`. A ref's
  rendered ports come from its declaration: inputs become input handles, artifacts + outcomes
  become output handles with outcome ports typed `outcome/<name>`
  (`layout.ts lookupDeclarationPorts`, `:79-126`).
- Root graph — `WireDefinitionGraph { nodes, connections }`, connections
  `from/to { node, port }` (`types.ts:1485-1496`). Control-port convention:
  `CONTROL_SOURCE_PORT = 'done'`, `CONTROL_TARGET_PORT = 'input'` (`draft.ts:59-60`).
- Cross-node structural references that a cut must respect: `Gate.target`
  (`types.ts:1465`), `FanOut.branches` / `members[].id` / `members[].hierarchicalPath`
  (`:1446-1452`), `Join.inputs` / `requiredMembers` / `optionalMembers` (`:1457-1459`),
  definition-level `consultations[].sourceStage` (`:1273`, `:1526`). Note the engine's v1
  normalizer writes `stage:`-prefixed forms for `Gate.target`/`Join.inputs`/`hierarchicalPath`
  (`definition.ts:3599`, `:3681-3692`) while authored v2 writes raw ids — reference checks
  must test both forms.
- The engine already contains this transformation's template: `normalizeV1`'s loop-body
  declaration synthesis (`definition.ts:3603-3625`) and its group-member connection rewriting
  (`:3699-3727` — "a stage that requires a group member now requires the Join instead"), the
  proof that re-pointing external edges at a replacement node is the engine's own idiom.
- Existing model primitives to compose: `addDeclaration` (`draft.ts:2086`, unique-id rule +
  custom shell), `insertCompositeRef` (`:880`, existence + referenceability + ref append),
  `updateDeclaration` (`:2116`, `assertNamedContractRows` / `assertNamedOutcomes` validation
  + BoundedLoop exit reconciliation), `v2NodeIdFor` / `v2ConnectionIdFor` (id minting),
  `isDeclarationIdUnique`.

Forward consumer (why the contract must land exactly this way): child 3's loop inference
points a `BoundedLoop.body` — a **declaration id** (`types.ts:1386`) — at a declaration this
slice produces; children 4/5 build on the same extraction surface.

## Goals / Non-Goals

**Goals:**

- Box-select N plain stages → "package into reusable block" → review derived contract →
  confirm: custom declaration created, selected nodes moved, one `CompositeRef` replaces them,
  crossing connections rewired onto the ref's ports, ref selected.
- Every refusal names its blocker; the availability rule lives in `draft.ts` (one home).
- Verbatim content preservation and the never-stamp-`legacyRuntimeOwner` discipline.
- The extracted declaration is a first-class custom row: rename/patch/insert all work.

**Non-Goals:**

- Loop, parallel-frontier, and finish inference (children 3/4/5).
- Extracting non-AtomicStage kinds (body vocabulary stays `['AtomicStage']` — a spec forbids
  widening; subsumes "must not sever a FanOut/Join pair").
- v1 editor (declaration authoring is v2-only).
- Atomic all-or-nothing multi-delete semantics (child 1's non-goal, unchanged).
- Migrating consultation bindings or parallel memberships into bodies — refused, not migrated.
- Canvas Save persistence defect (pre-existing; verification stays in-memory).

## Decisions

### D1. One pure transaction in draft.ts, composed from existing primitives

`extractSubgraph(def, input) -> { next, declarationId, refId }` where `input` = reviewed
`{ id, inputs, artifacts, outcomes }`:

1. Re-run the refusal rules (below) — the model owns them; the dialog is not trusted.
2. Mint the declaration id from the reviewed name (validated by `isDeclarationIdUnique` +
   the existing blank rules).
3. Build the declaration in one immutable step (as `addDeclaration` builds its shell):
   body `graph.nodes` = the selected stages **verbatim** (same ids — body ids are
   declaration-scoped; the body palette already dedups per-declaration only), body
   `graph.connections` = internal connections verbatim, contract = the reviewed rows
   (validated by `assertNamedContractRows` / `assertNamedOutcomes`).
4. Remove the selected nodes and internal connections from the root graph.
5. Append the ref via **`insertCompositeRef`** (the handoff's "reuse for the final step") —
   its existence/referenceability checks run against the just-created declaration.
6. Rewire: for each severed incoming edge `X --(p)--> s`, emit `{ ...originalConnection, id:
   v2ConnectionIdFor(next, …), from: unchanged, to: { node: refId, port: mappedInputName } }`;
   for each severed outgoing edge `s --(p)--> Y`, `from: { node: refId, port:
   mappedOutcomeName }`, `to` unchanged. Extension fields (`[key: string]: unknown`) are
   carried by the spread; only id/from/to are rewritten. New endpoint-derived ids follow the
   `v2ConnectionIdFor` convention already used by `onConnect`; the old ids die with the old
   endpoints (child 1's `pruneSelectionToDraft` already tolerates connection-id churn).

### D2. Derivation rules (defaults, all review-editable)

- One input port per distinct `(target stage, target port)` among severed incoming edges;
  default name = the target stage's id (suffixed on collision), default type = the severed
  edge's target port id (typically `'input'`), `required` unset.
- One outcome per distinct `(source stage, source port)` among severed outgoing edges;
  default name = the source stage's id (suffixed on collision). If no outgoing edge is
  severed, a single default outcome `'done'` (the `addDeclaration` shell's own default).
- Artifacts default to `[]` — control edges carry no artifact semantics; the review row lets
  the author declare them.
- Derivation is a separate pure function (`deriveSubgraphContract(def, nodeIds)`) so the
  dialog opens with defaults and the transaction re-validates the *edited* rows.

### D3. Refusal rules — `subgraphExtractionRefusals(def, selection): string[]`

Empty array = extractable. Each entry is one author-readable blocker:

1. Non-empty selection, every selected node an `AtomicStage` (cites `V2_BODY_PALETTE_KINDS`
   and the executable-custom-composite body-vocabulary requirement; anything else — Gate,
   FanOut, Join, Choice, BoundedLoop, CompositeRef, Finish — is named).
2. No **outside** `Gate` targets a selected stage (`Gate.target`, raw or `stage:`-prefixed).
3. No **outside** `FanOut` counts a selected stage among `branches` / `members[].id` /
   `members[].hierarchicalPath` (both raw and `stage:`-prefixed forms).
4. No **outside** `Join` lists a selected stage in `inputs` / `requiredMembers` /
   `optionalMembers` (both forms).
5. No consultation binding references a selected stage (`consultations[].sourceStage`).

"Outside" matters only for kinds that cannot be selected anyway (rule 1), but the checks are
written structurally so they hold regardless. Rules 2-4 are the grammar-derived answer to
"must not orphan a Gate disposition / sever a parallel pair": those references cannot cross
a declaration boundary, so a cut that would sever them is refused instead of migrated.

### D4. Entry point and review UI

- `V2SelectionPanel` gains optional props `onPackage` / `packageRefusals` — still strictly
  presentational: the button renders when `onPackage` is provided, and refusals render as
  the panel's existing muted text (the page passes
  `subgraphExtractionRefusals(draft, selection)`).
- A new `V2ExtractReviewPanel.tsx` dialog (the `duplicateDialog` overlay pattern): declaration
  id input (default `block`, `block-2`, … via `isDeclarationIdUnique`), editable
  inputs/artifacts/outcomes rows (the declarations editor's row UX, same validation surfaced
  from the model), and a body summary (stage count, internal connection count, the derived
  cut). Confirm calls the page handler; Cancel discards. The dialog is modal, so the
  selection cannot change underneath it; the transaction still re-validates (D1.1).
- Page confirm handler: `extractSubgraph` → `setDraft(next)` → `recomputeFlow(next, catalog,
  [refId])` (the selectionOverride path writes both selection truths in one tick — the
  pairing discipline) → `markDraftChanged()` → success toast naming the declaration.

### D5. No capability holes; no new vocabulary drift

The per-declaration-row "Insert into graph" action is untouched and keeps working for the
extracted declaration (custom provenance is referenceable by `isReferenceableDeclaration`).
The package action, the availability rule, the derivation, and the transaction all live in
`draft.ts`; the panels render. `V2_BODY_PALETTE_KINDS` is untouched.

### D6. Never stamp `legacyRuntimeOwner`

Moved nodes are spread verbatim (an authored stage carries no such field); the ref is built
by `insertCompositeRef` with exactly `{ id, kind, declarationId }`. Tests assert
`not.toHaveProperty('legacyRuntimeOwner')` at the model layer AND on the definition actually
sent to validation (round-one's two-layer guard discipline; the field's semantics live at
`definition.ts:220-228` — `orchestrationEvaluatorCapabilityFor` reads its absence as
"authored").

### D7. Spec delta stays ADDED-only

One ADDED requirement in `pipelines-ui`; nothing existing becomes false. This keeps the delta
merge-order-agnostic per the child-1 planner digest (the tree's spec and `f77bccdf` may still
be reconciling on `dev/0.2.0`'s side — an ADDED requirement applies under either state).

### D8. Test strategy

- Model unit tests (`draft.test.ts` or a sibling): derivation defaults and collisions;
  every refusal rule (each blocker in isolation); the transaction (body verbatim, internal
  moves, crossing rewires with extension fields preserved, ref selected-able, result
  re-referenceable via `insertCompositeRef`, no `legacyRuntimeOwner`, id-uniqueness errors).
- Component tests (`pipeline-canvas-page.test.tsx`, reusing child 1's `onSelectionChange`
  trigger): action gating (enabled for multi AtomicStage; refusal text for mixed/kind/gate/
  member/consultation cases), review flow (edit outcome name → rewired port uses it),
  confirm leaves the ref selected and the declarations panel shows the row, insert-into-graph
  still adds a second ref, POSTed-definition `legacyRuntimeOwner` guard.
- Real browser (throwaway CDP Chrome, direct on the throwaway port — `cdp-proxy.mjs`
  hardwires 127.0.0.1 which this Chrome does not bind): box-select two stages between an
  upstream and a finish → package → confirm → ref rendered with derived ports, root rewired,
  second insert from the row.
- Suite discipline: `pnpm --dir packages/ui exec vitest run` (CI-canonical), cite counts
  against the 67 files / 768 tests baseline.

## Risks / Trade-offs

- [Selection changes while the review is open] → the dialog is modal; the transaction
  re-validates refusals against the live draft regardless (D1.1).
- [Rewired connection ids churn breaks user expectation of "same edge"] → endpoint-derived
  identity is the file's own convention (`v2ConnectionIdFor`); the visible graph is
  equivalent. Accept and test.
- [Same-id body stages across declarations confuse the engine] → the authoring surface
  already permits per-declaration-scoped ids (body palette dedups within one declaration
  only); moving verbatim matches existing authored v2. Verified by the model tests + a
  validate-clean assertion in the component test.
- [`stage:`-prefixed reference forms missed] → both-form checks (D3); unit tests cover a
  legacy-normalized fixture shape.
- [Author packages a cut that validates red] → the editor's Validate button remains the
  authority (same posture as cycle-check-on-connect); the review does not pre-validate
  server-side.
- [Windows test flakiness] → re-run in isolation on a settled machine; never pipe the gate
  through `tail`.

## Migration Plan

Single change, single PR: model functions + unit tests land first, then the panel/dialog
wiring + component tests, then the real-browser pass; the IR-frozen assertion runs as a task
gate. Rollback is the PR revert; the only persisted-format effect is ordinary authored v2
content (a custom declaration + ref) the engine already accepts. Ship `local`; the parent
delivers after all children.

## Open Questions

- Should singleton selections (one stage) also expose the package action from the node
  panel? Deferred — the gesture is box-select-shaped; revisit if users ask (the model
  already permits N=1; only the entry point is multi-mode).
- Should artifacts ever be derived (e.g. from capability outputs of severed edges)? Deferred
  — control edges carry no artifact semantics; the review row is the authoring surface.
- Default outcome naming (`<stageId>`) vs port-aware names — pinned in D2, revisit only with
  user feedback.
