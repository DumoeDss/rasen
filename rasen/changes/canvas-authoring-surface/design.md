## Context

The v2 Canvas (`packages/ui/src/canvas/`) is work-in-progress: `DefinitionContractPanel.tsx` has
exactly one commit, `d638f87d wip(preserve): snapshot in-flight v2-authoring and session-host work`.
Two consequences of that WIP state reached a user in one sitting and are fixed together here,
because they are the same mistake at two altitudes: the editor exposes the engine's internals
(unstyled panels, IR node kinds) instead of an authoring surface.

Current state that this design builds on:

- `V2_ROOT_PALETTE_KINDS` (`draft.ts:696-705`) is a 1:1 mirror of `ECP_NODE_KINDS`
  (`src/core/pipeline-registry/definition.ts:31-40`).
- `normalizeV1()` (`definition.ts:3377`) already proves the vocabulary gap is bridgeable: it
  synthesizes `Choice` from `condition:` (`:3581-3590`), `Gate` from `gate: true` (`:3591-3602`),
  a declaration + `BoundedLoop` from `loop:` (`:3603-3643`), and a `FanOut`/`Join` pair plus all
  connections from one `parallelGroup:` string (`:3644-3750`).
- `createParallelPair()` (`draft.ts:795`) already creates "both structural halves of one parallel
  frontier as one transaction", while the palette still offers the halves separately.
- `.pipeline-canvas__authoring-contracts` (`PipelineCanvasPage.tsx:1976`) has no CSS rule anywhere;
  neither do `.definition-contract` nor `.declarations-panel`. Its siblings do:
  `.palette-panel { width:200px; flex-shrink:0; overflow-y:auto }` (`style.css:1657`) and
  `.stage-panel { width:280px; flex-shrink:0; overflow-y:auto }` (`style.css:1673`).

Constraints inherited from the workstream, all binding on this design:

1. The IR is frozen. `ECP_NODE_KINDS` and every node interface in `definition.ts` stay
   byte-identical.
2. No capability holes: every palette kind withdrawn ships its replacement affordance here.
3. One home for the palette vocabulary — `draft.ts`, beside `V2_BODY_PALETTE_KINDS`, whose comment
   records that this project already paid for four drifting encodings of "which kinds may appear
   where".
4. `V2_BODY_PALETTE_KINDS` (declaration body, `AtomicStage`-only) is untouched;
   `executable-custom-composite` forbids widening it.

## Goals / Non-Goals

**Goals:**

- The v2 authoring column is a fixed-width, independently-scrolling column whose content reads as a
  stacked card, and the node canvas keeps the remaining width.
- The ROOT palette speaks in four author gestures (Stage, Parallel, Loop, Finish) rather than eight
  IR node kinds.
- Every graph shape authorable before this change remains authorable after it, through an
  affordance that ships in this change.
- The gesture vocabulary, the gesture-availability rule, and the gesture→IR composition all live in
  `draft.ts`; `PalettePanel.tsx` renders and decides nothing.

**Non-Goals:**

- The canvas-gesture → IR compiler (back-edge ⇒ BoundedLoop, enclosed-subgraph ⇒ declaration,
  branch-and-reconverge ⇒ FanOut/Join). Deferred by the user. Loop and Parallel stay explicit
  gestures.
- Select-and-group extraction of existing root nodes into a new declaration. This is literally
  "extract the enclosed subgraph into a declaration" from the deferred item; see D6 for the parity
  affordance that ships instead, and the seam left for it.
- Drag-and-drop placement of v2 nodes. `recomputeFlow()` (`PipelineCanvasPage.tsx:304-316`) re-runs
  `layoutGraph` over every v2 node after each mutation, so a drop coordinate is discarded on the
  next keystroke. Offering a drop target that silently ignores where you dropped is worse than a
  click. v1 keeps its existing drag-and-drop, which works because v1 keeps `flowNodes` positions.
- Changing the wire format, the server, or any saved definition. Every gesture emits IR that was
  already producible by hand.

## Decisions

### D1 — The authoring column is constrained the way its two working siblings are

`.pipeline-canvas__authoring-contracts` gets `width: 280px; flex-shrink: 0; min-height: 0;
overflow-y: auto;` plus `display: flex; flex-direction: column; gap`. 280px matches `.stage-panel`,
the other properties column.

The single scroll lives on the column, **not** on `.definition-contract` and `.declarations-panel`
individually — nested scrollers inside a scroller is its own defect class, and the requirement is
about the column scrolling within its own bounds.

The two panels inside get the card treatment their siblings have (border, radius, padding,
`background: var(--surface)`) and, crucially, `display: flex; flex-direction: column` on the panel
and on each `<label>`/field, which is what stops "Named outcomes / Maximum actions / Budget" from
rendering as one run-together line.

*Alternative considered:* `flex: 0 1 320px; min-width: 0` — a shrinkable column. Rejected: a
shrinkable panel reintroduces content-driven sizing under pressure, and the two panels that
currently work set the house convention with a hard `width` + `flex-shrink: 0`.

*Alternative considered:* a collapse toggle so all three chrome columns need not coexist. Rejected
as scope: 200 + 280 + 280 of chrome leaves the canvas the majority of a normal viewport, which is
the reported complaint. A toggle can be added later without disturbing this rule.

### D2 — The gesture vocabulary and its availability rule live in `draft.ts`

Added beside `V2_BODY_PALETTE_KINDS`, and `V2_ROOT_PALETTE_KINDS` is **removed** rather than left
alongside — keeping both would be precisely the drift the neighbouring comment warns about.

```ts
export type V2RootGesture = 'stage' | 'parallel' | 'loop' | 'finish';

export const V2_ROOT_PALETTE_GESTURES: readonly V2RootGesture[] =
  ['stage', 'parallel', 'loop', 'finish'];

/** The gestures this draft cannot accept right now, and why — one rule, read by
 *  the palette's enablement and by the insertion itself. */
export function unavailableRootGestures(
  def: WirePipelineDefinitionV2,
  input: { exactCapabilities: readonly { id: string; version: string }[] }
): readonly V2RootGesture[];
```

Rules: `stage` unavailable when no enabled catalog skill carries an exact capability revision;
`parallel` unavailable when the root has no `AtomicStage`; `loop` unavailable when no declaration
has a body graph (`loopBodyDeclaration`); `finish` always available.

This also fixes a live contradiction: `PalettePanel.tsx:48-51` hardcodes the AtomicStage
availability rule inside the panel body, while the panel's own doc comment (`:7-13`) says "the
caller reports any further unavailable kinds via `disabledKinds` so the palette never re-decides
insertability itself". After this change the panel receives `disabledGestures` and evaluates
nothing.

### D3 — Gesture → IR composition helpers, all pure, all in `draft.ts`

Each helper returns a new definition or throws an `Error` whose message the page surfaces as a
toast. This is the established convention in this module ("the panel never re-decides a rule the
model owns", `PipelineCanvasPage.tsx:885-891`), and it is why the composition cannot live in the
page's `addV2RootNode` switch.

| Helper | Gesture | Composes |
|---|---|---|
| `addAtomicStageForCapability(def, capability)` | Stage | one `AtomicStage` with the author's chosen capability and the default `execution` block currently built inline at `PipelineCanvasPage.tsx:782-791` |
| `addParallelFrontier(def)` | Parallel | delegates to the existing `createParallelPair()` with today's defaults (all root AtomicStages as members, first required, cap `min(3, members)`, budget `members.length`, outcomes from `def.outcomes`) |
| `addBoundedLoopOverDeclaration(def)` | Loop | today's `BoundedLoop` construction (`PipelineCanvasPage.tsx:816-836`) moved wholesale, including `createDefaultBoundedLoopLifecycle()` |
| `addFinishNode(def)` | Finish | `{ kind: 'Finish', outcome: def.outcomes[0] ?? 'done' }` |

The **Stage** gesture is the one behavioural upgrade in this table: today
`addV2RootNode('AtomicStage')` binds `(catalog?.skills ?? []).find(s => s.enabled && s.capability)`
— the *first* capability it happens to find. The gesture instead renders the installed-skill card
list that `PalettePanel.tsx:71-104` already renders for v1, and the author picks. Skills the
catalog reports as disabled, or that carry no exact capability revision, are greyed exactly as v1
greys disabled skills.

### D4 — Gate becomes a checkbox on the AtomicStage it targets

`GateNode` is `{ kind:'Gate', target: <AtomicStage id>, outcomes, dispositions }` — it already
*names* the stage it guards, which is why it reads naturally as that stage's property. In v1 it
literally was one (`gate: boolean`).

```ts
export function gateForStage(def, stageId): WireGateNode | undefined;
export function setStageGate(def, stageId, enabled: boolean): WirePipelineDefinitionV2;
```

- Enabling appends a `Gate` targeting `stageId` with `outcomes: ['approved','rejected']` and
  `dispositions: { approved: 'proceed', rejected: 'escalate' }` — the *Canvas's* current defaults
  (`PipelineCanvasPage.tsx:804-805`), deliberately **not** `normalizeV1`'s `approve`/`reject`
  vocabulary (`definition.ts:3597`), so no definition previously authored in the Canvas changes
  meaning.
- Disabling routes through the existing `removeV2Node`, which already drops incident connections.
- Nothing else is lost: the Gate node still renders on the canvas, is still selectable, and
  `GateDetails` (`V2NodePanel.tsx:325-390`) still edits its target and per-decision dispositions.
  The checkbox is an additional entry point, not a replacement editor.

`removeV2Node` (`draft.ts:1024-1029`) refuses to delete a node that a Gate still targets. Deleting
a gated stage therefore requires unchecking first; `setStageGate(def, id, false)` is exactly that
step, so the checkbox makes an existing refusal actionable instead of a dead end.

### D5 — Choice becomes a condition spliced onto a selected edge

Three named model operations rather than one overloaded setter:

```ts
export function spliceConditionOntoConnection(def, connectionId, expression): WirePipelineDefinitionV2;
export function unspliceChoice(def, choiceId): WirePipelineDefinitionV2;
// editing the expression afterwards is `updateV2NodeFields(def, choiceId, { expression })`
```

**Splice** on edge `A:pOut → B:pIn`:

1. reject unless both endpoints pass the same `isV2EditableNodeKind` guard `onConnect` uses;
2. create `{ id: v2NodeIdFor('Choice', def), kind: 'Choice', outcomes: ['matched','skipped'],
   expression }`;
3. drop the original connection; add `A:pOut → choice:input` and `choice:matched → B:pIn`
   (`CONTROL_TARGET_PORT` is `'input'`, `draft.ts:59`; a Choice's output ports are its outcomes,
   `layout.ts:234-236`).

Shape and vocabulary are deliberately identical to what `normalizeV1()` writes for a v1
`condition:` (`definition.ts:3581-3590`) — including the `expression` field, which the node
interfaces admit through their index signature and which the validator preserves verbatim
(`definition.ts:1440-1441` reads only `outcomes`).

**One thing is deliberately not copied:** `legacyRuntimeOwner`.
`orchestrationEvaluatorCapabilityFor()` (`definition.ts:220-228`) uses the *absence* of that field
to mean "authored, and therefore requires a `choice-select` orchestration evaluator". Stamping it
onto authored content would silently exempt the node from an evaluator requirement. Authored
Choices carry the requirement, as they already do today.

**Unsplice** refuses when the Choice has any outbound connection on a port other than the one being
restored — otherwise clearing a condition would silently discard a wired `skipped` branch. The
model refuses; the page shows the refusal.

Where the author touches it: React Flow's `onEdgeClick` (not currently wired) selects a connection
and opens a small **Connection** panel in the right-hand properties column, reusing `.stage-panel`
so it inherits the constrained, independently-scrolling treatment the viewport requirement already
covers. Node selection and edge selection are mutually exclusive. Once spliced, the expression is
edited on the Choice node's own panel, which gains an expression field beside its existing branch
outcomes editor; that panel also carries the "remove condition" action that calls `unspliceChoice`.

Edges becoming first-class selectable objects is also the clean seam the deferred back-edge/
topology compiler will need.

*Honest limitation, stated for the reviewer:* the v2 reconciler runtime does not exist yet
(`V2_RUNTIME_UNAVAILABLE_REASON`; `pipelines-ui` already specifies that a valid v2 draft saves and
exports but cannot Run). So `expression` is authored intent that round-trips through save/export
and is preserved verbatim; the branch *structure* (a Choice with two outcome ports and its
connections) is fully visible to today's static validation and plan digest. This is not a
regression — today's palette Choice button cannot express a condition at all, only
`outcomes: ['default']`.

### D6 — CompositeRef becomes an "Insert into graph" action on each declaration row

`DeclarationsPanel` already renders one row per declaration with Select and Delete
(`DeclarationsPanel.tsx:152-186`). A third action per row inserts a `CompositeRef` referencing
*that* declaration:

```ts
export function isReferenceableDeclaration(declaration): boolean;  // extracted predicate
export function insertCompositeRef(def, declarationId): WirePipelineDefinitionV2;
```

The row's enablement and the insertion read the one predicate — the same discipline
`referenceableDeclaration()` was written for (`draft.ts:720-736`). The "find the first one"
wrapper is removed with the palette button, because picking the first is exactly the arbitrary
behaviour being retired.

*Why not select-and-group ("打成复用块") in this change:* extracting an enclosed subgraph into a
declaration is named inside the deferred compiler work. Doing it properly means moving nodes into a
declaration body, deriving that declaration's inputs/artifacts/outcomes from the cut edges, and
rewiring the surviving root connections onto the CompositeRef's ports — a graph-surgery operation,
not a palette change. The capability actually being withdrawn here is narrower: "insert a
CompositeRef referencing an existing declaration", and the per-row action restores it exactly while
removing the arbitrary pick. The seam for the larger gesture is `insertCompositeRef` plus the
declaration-creation path that `DeclarationsPanel` already owns.

### D7 — Join is not withdrawn, it is un-duplicated

`createParallelPair()` already creates both halves in one transaction and
`removeParallelPair()`/`onDeleteParallelPair` already deletes both. The two palette buttons were
the anomaly — clicking either one already ran the same paired constructor
(`PipelineCanvasPage.tsx:837-870`), differing only in which half got selected afterwards. One
Parallel gesture selects the FanOut. No capability is lost; the ability to create a *lone*
FanOut or a *lone* Join never existed.

### D8 — How the layout claim is verified (it cannot be verified by markup)

jsdom performs no layout, so a DOM test asserting the column's class or its children cannot see a
width or flex regression. `pipelines-ui`'s viewport requirement already anticipates this and
demands real-browser verification, and the repo already has the pattern:
`packages/ui/test/style/canvas-lock.test.ts` is a narrow string-level CSS contract pin whose
docblock says exactly why ("that is exactly how the previous (dead-code) fix slipped through").

Two layers, both required:

1. **CSS contract pin** in the same file/style: the `.pipeline-canvas__authoring-contracts` block
   exists and contains a definite `width`, `flex-shrink: 0`, and `overflow-y: auto`; the
   `.definition-contract` and `.declarations-panel` blocks exist and set
   `flex-direction: column`. This pins the *presence* of rules whose *absence* was the whole bug,
   which is the right assertion shape here.
2. **Real-browser measurement** recorded under `evidence/`: open a v2 definition in edit mode and
   record (a) `documentElement.scrollHeight <= innerHeight`, (b) the authoring column's measured
   width is the fixed width and not ~800px, (c) the flow column's measured width exceeds the
   authoring column's. Layer 1 alone cannot catch a rule that exists but does not constrain — that
   is precisely the `calc(100vh …)` failure `canvas-lock.test.ts` was written about.

UI tests run through `packages/ui`'s own vitest config. The root config excludes `packages/ui`, so
`pnpm exec vitest run packages/ui/test/` runs zero tests and prints "passed".

## Risks / Trade-offs

- **Rewriting the palette tests could quietly delete coverage of a withdrawn capability.**
  `v2-authoring-model.test.ts:150` pins the eight-kind list, 11 sites in
  `pipeline-canvas-page.test.tsx` drive `v2-palette-add-<Kind>`, and
  `canvas-authored-composite-export.test.tsx:289` drives one more. → Every deleted assertion must be
  replaced by one that drives the *replacement* affordance (gate checkbox, edge condition,
  declaration-row insert), not merely removed. A per-withdrawal parity test is called out
  explicitly in `tasks.md`; that mapping is the enforcement.
- **A CSS pin can pass while the layout is still broken** (a rule that exists but does not
  constrain). → The real-browser measurement in D8 is not optional; the CSS pin alone is the known
  failure mode this repo has already been bitten by.
- **`unspliceChoice` could orphan a wired branch.** → The model refuses rather than silently
  dropping edges, matching how `removeV2Node` guards Gate targets and parallel membership.
- **A gesture-only palette hides shapes an expert could previously click into existence.** → Every
  one of the eight kinds remains renderable, selectable, editable, and deletable on the canvas;
  only the *creation* entry points are re-homed. Definitions containing any kind still load and
  round-trip.
- **`expression` is inert to today's engine** (D5). → Called out rather than papered over; the
  structure is engine-visible, the field round-trips, and v2 cannot Run at all yet.
- **Three chrome columns plus a canvas is tight on a small laptop.** → Accepted this round; the
  fixed widths make the canvas's share deterministic instead of content-driven, which is the
  reported defect. A collapse control is a clean follow-up against these rules.

## Migration Plan

None required. No wire-format, schema, or persisted-definition change; no server change. Existing
v2 definitions — including any containing Choice, Gate, FanOut, Join, or CompositeRef nodes — load,
render, edit, and save exactly as before. Rollback is reverting the branch.

## Open Questions

None blocking. Two decisions were made rather than escalated, and are flagged for the reviewer:
the fixed 280px column width (D1) and the deferral of select-and-group extraction in favour of the
per-declaration insert action (D6).
