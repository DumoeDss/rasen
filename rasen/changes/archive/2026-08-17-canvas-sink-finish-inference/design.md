# Design: canvas-sink-finish-inference

## Context

`addFinishNode` (`draft.ts:902-905`, unchanged since round one) appends
`{ id: v2NodeIdFor('Finish', def), kind: 'Finish', outcome: def.outcomes[0] ?? 'done' }` with
no wiring; the gesture's authored shape is stages chained into a Finish the author draws.
Grammar facts for the promotion rules (verified): `WireFinishNode` is its own kind carrying
one definition-outcome name (`packages/ui/src/api/types.ts:1470-1473`); a Join's `outcomes`
are barrier semantics `{ proceed, failed }` (`:1460`), not definition-outcome mappings, so a
Join can never BE a Finish; Finish's rendered input is the control port (`layout.ts:179-197`,
the Gate/Choice/Finish family). Sinks inside declaration bodies are the declaration's own
outcome contract (child 2) and are out of scope. Children 1-4 delivered the surface this
rides: the selection contract, the panel-mode discipline, the one-home rule in draft.ts, and
the selectionOverride pairing for programmatic selection
(`PipelineCanvasPage.tsx:330-341`).

Impl-6's relayed findings (toast-action guards, port census) are noted but not load-bearing
here: this slice adds no toast surface, and the browser gate takes port 9342+ per the census
(9333-9341 consumed).

## Goals / Non-Goals

**Goals:**

- Recognize terminal nodes; offer outcome-naming for plain-stage and parallel-barrier sinks
  in their properties panel; confirm appends a wired Finish with the picked outcome and
  selects it.
- The promoted Finish is indistinguishable from an explicitly authored one; the gesture is
  untouched.
- Smallest-slice discipline: one recognition rule, one select, one append; no modal, no toast,
  no new panels.

**Non-Goals:**

- Promoting other sink kinds (loop/composite-reference/gate/choice ends stay with the explicit
  gesture; the codebase has no authored terminal-wiring precedent for them and their rendered
  output ports are contract-named, which would need per-kind port resolution; revisitable with
  user demand).
- Converting any node into a Finish (always append).
- Sink detection inside declaration bodies (child 2's contract territory).
- v1 editor; canvas Save persistence defect; any other inference.

## Decisions

### D1. Recognition: out-edge absence over the one adjacency discipline

`isPromotableSink(def, node)` (pure, `draft.ts`): the node exists in the root graph, its kind
is `AtomicStage` or `Join`, and NO root connection has `from.node === id`. The out-edge scan
rides the same root-connection enumeration the frontier detector's adjacency builder uses
(`buildAdjacency`, the child-3 digest's one-builder rule; absence needs nothing stronger than
the builder's edge set). Why these two kinds: they are exactly the terminal shapes the
authored surface already wires (stage `done` control-out per the `addV2Connection` convention
and `createParallelPair`'s member `done` wiring; barrier outcome-valued outputs), so the
promotion's edge lands on a handle the renderer actually draws. FanOut cannot sink alone (its
pair's collector is the Join).

### D2. Affordance: a panel section, pull not push

`V2NodePanel` gains ONE optional prop group (`sinkPromotion?: { outcomes: readonly string[];
onPromote: (outcome: string) => void }`) rendering a compact section (label, outcome select
defaulting to `def.outcomes[0]`, confirm button) inside the existing panel; the page computes
`isPromotableSink` and passes the group only when true. The panel stays presentational: the
rule lives in draft.ts. Why not a toast offer (child 4's completing-connect pattern):
sink-ness is the common state of every growing draft (the newest node is always a sink), so a
push offer would fire constantly; the author names an endpoint when they are done building,
which is exactly a properties-panel moment. Why not a modal review (children 2-4): the input
is one select, not a contract.

### D3. Promotion: append in the gesture's shape, wire on rendered handles

`promoteSinkToFinish(def, sinkId, outcome) -> { next, finishId }` (pure, `draft.ts`):

1. Re-validate (the panel is not trusted): the node exists, `isPromotableSink` holds, and
   `outcome` is a non-blank member of `def.outcomes` (the select only offers those, but the
   model owns the rule).
2. Append the Finish with exactly `addFinishNode`'s node shape but the PICKED outcome
   (`{ id: v2NodeIdFor('Finish', def), kind: 'Finish', outcome }`); nothing else is stamped.
3. Wire sink→Finish via the `addV2Connection`/`v2ConnectionIdFor` convention with the sink's
   rendered control-out handle: `AtomicStage` sources `CONTROL_SOURCE_PORT` (`'done'`,
   `draft.ts:59`); a Join sources its `outcomes.proceed` VALUE (the barrier's rendered
   output port; implementer pins the exact id against `layout.ts`'s Join output mapping, the
   same rendered-id discipline children 2-4 used); the Finish's input is its control port.
4. Return the ids; the page selects the Finish through `recomputeFlow`'s selectionOverride
   pairing (both truths in one tick), `markDraftChanged()`, success toast (plain text; the
   child-4 toast-action guards do not apply because no action rides it).

The sink node itself is untouched (no move, no rewrite); its extension fields and execution
settings survive verbatim by construction.

### D4. No capability holes; no stamps; spec ADDED-only

The palette Finish gesture, `addFinishNode`, and every other panel path are untouched; the
promoted Finish edits through the existing `updateV2NodeFields` path (its outcome field). The
appended node stamps nothing (same object shape as the gesture's). Dual-layer
`not.toHaveProperty` guards (model + POSTed definition) per the children 2-4 discipline. The
spec delta is one ADDED requirement, and per the child-4 digest rule its prose contains NO
em-dashes (the delta parser truncates requirement text at the first one).

### D5. Test strategy

- Model unit tests: `isPromotableSink` truth table (plain-stage sink, barrier sink, node with
  an outgoing edge, non-promotable kinds, body-graph node not considered); promotion happy
  path (node shape `toEqual`-pinned against `addFinishNode`'s with the picked outcome; the
  wired connection's exact endpoint/port ids); refusal strings for a stale non-sink and an
  outcome not in `def.outcomes`; no `legacyRuntimeOwner` on any node in `next`; the promoted
  Finish patches via `updateV2NodeFields`.
- Component tests (existing selection/node-panel triggers): the section renders for a selected
  stage sink and not for a wired node or a loop end; picking and confirming lands the Finish
  with the chosen outcome in the definition actually sent to validation (POST-body walk, plus
  the `legacyRuntimeOwner` guard); the Finish is selected with its panel open; the palette
  Finish gesture still works.
- Real browser (throwaway CDP, `--window-size=1600,1000`, port 9342+ per the census, build
  then serve, close the selection panel before drags): author a chain ending in a stage,
  select the end stage, name its outcome via the panel, confirm; assert the Finish appears
  wired and selected; promote a barrier sink once; exercise the palette gesture once.
- Suite: CI-canonical `pnpm --dir packages/ui exec vitest run`, counts cited against
  67 files / 839 tests.

## Risks / Trade-offs

- [Authors expect the push moment ("you finished!") and miss the panel section] → the
  explicit gesture remains one click away, and the panel section is visible on every sink
  selection; a push offer can be added later without touching the model.
- [Barrier port-id mismatch between synthesis and rendering] → the implementer pins the Join
  output id from `layout.ts` and the model test asserts the exact id; same discipline that
  kept children 2-4 honest.
- [Multiple sinks promoted to the same outcome] → legal (multiple Finish nodes may name the
  same definition outcome; each maps its own endpoint); no uniqueness rule to invent.
- [Windows flakiness] → isolate, re-run settled, never pipe through `tail`.

## Migration Plan

Single change, single PR: model + tests, panel section + wiring + tests, browser gate,
IR-frozen assert. Rollback is the PR revert; the persisted effect is an ordinary authored
Finish node the engine already accepts. Ship `local`; the parent's portfolio-level delivery
follows the last child's archive.

## Open Questions

- Should loop/composite-reference sinks gain promotion later (needs per-kind rendered-port
  resolution)? Deferred; the explicit gesture covers them today.
- Should the section offer creating a NEW definition outcome inline? Deferred; the definition
  contract editor owns the outcome list (one home).
