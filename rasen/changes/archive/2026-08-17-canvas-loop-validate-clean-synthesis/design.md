# Design: canvas-loop-validate-clean-synthesis

## Context

Child-1 (`canvas-loop-port-inference`, ship `604caba1`) landed the back-edge entry/exit
inference and its real-browser gate measured the truth: the wired standalone-cycle loop
validated with 6 engine errors, and only three authored contract repairs reached 0
(evidence: `rasen/changes/archive/2026-08-17-canvas-loop-port-inference/evidence/fix-round-1.md`).
All three defect classes live in the synthesis defaults the UI mints, and the engine
rules that reject them are fixed (this portfolio freezes `src/core/pipeline-registry/`):

- **Exact cover.** `validateOwnerTerminalOutcomes` (`definition.ts:3060`) requires an
  owner's declared outcomes to cover, both ways, the graph's producible terminal
  outcomes — computed by `resolveGraphTerminalOutcomes` (`:2952`): a node's
  control-typed outputs (`ecp/control`) not consumed by a same-graph connection. For a
  body of AtomicStages the producible names are each stage's capability outcomes
  (phase-projected via `loopPhaseOutcomeNames`, `:2777`) minus internally consumed
  ones. Undeclared producible → "produces terminal outcome ... not declared";
  declared unproducible → "declares ... cannot be produced". Stage-id names
  (round-one severed convention) and the back-edge source id (child-1's fallback) are
  unproducible by construction.
- **Control type.** `contractForNode` (`:2795`) types a Composite declaration's input
  rows straight from `portMap(declaration.inputs)` — name → authored type — and a
  connection validates only when producer and consumer types are equal
  (`validateTypedPorts`, `:3128`). Control sources produce `CONTROL_PORT_TYPE =
  'ecp/control'` (`:2749`); the UI wrote the port NAME (`'input'`) as the type, so
  every connection onto a derived row is PORT_MISMATCH. (The engine widens only
  AtomicStage's EMPTY descriptor inputs to `['input','in','start']` — declarations get
  no widening; the row must carry the type.)
- **Loop output ports are the EXIT outcomes.** For a BoundedLoop,
  `contractForNode` outputs = the exit-ACTION outcome values of `exits` +
  `lifecycle.exits` (`:2851-2867`) — definition-level outcomes, NOT the declaration's
  outcome rows. Today's outgoing rewire writes the declaration row name as the source
  port, engine-red whenever the names differ. The default lifecycle
  (`createDefaultBoundedLoopLifecycle`, `draft.ts:570`) has exactly one exit action —
  `iterationLimit: exit → 'iteration-limit'` (`:576`; the other entries are
  fail/escalate/human-required and produce no control output — V4 in the evidence
  proved over-declaring their names goes red) — so every canvas-synthesized loop emits
  `iteration-limit` plus its chosen exit outcome, and BOTH must be declared
  definition outcomes.
- **MISSING_EXIT / UNREACHABLE_EXIT** (`definition.ts:2301-2325`): the loop's `exits`
  keys must exactly cover the body's reachable terminal outcomes — satisfiable
  automatically once the declaration rows are the producible set (the existing
  exits-from-declaration-outcomes mint at `draft.ts:3149-3160` then produces the right
  keys).

Bodies are AtomicStage-only (the extraction refusals enforce `V2_BODY_PALETTE_KINDS`),
which bounds the derivation to one node kind. UI nodes CAN carry
`reviewCyclePhase`/`goalCyclePhase` (wire types + the execution editor), so the phase
projection must be mirrored, not ignored. The catalog payload carries each capability's
`inputs`/`artifacts`/`outcomes` (the same source `layout.ts:166-175,229-239` renders
handles from), so the producible set is derivable client-side. No client-side
connection rule reads input-handle types (grep at propose time; re-verify in apply), so
re-typing rows changes no interaction.

Precedent for synthesis-time declarations: `normalizeV1()` mints contract rows no edge
severed (`definition.ts:3603-3637`); the round-2 single-home verdict named
`declareDefinitionOutcome` (`draft.ts:539`) the one rule site for outcome declarations
— synthesis writes through that same wrapper, keeping one owner of the rule.

## Goals / Non-Goals

**Goals:**

- Empty canvas → cycle → confirm review → connect externals → Validate 0 errors with
  ZERO authored contract edits (child-1's amended-away scenario, now delivered).
- The palette Loop gesture over a well-formed body validates clean too (shared
  mint-layer fix).
- Underivable shapes (capability missing from the catalog) surface in the loop review
  as refusals, not as Validate errors.
- Deliberate, documented supersession of child-1's externals-first byte-preservation
  where the defaults change; everything else byte-identical.

**Non-Goals:**

- The extract/package-into-block path: untouched (it shares the class-1/2 defects —
  recorded as a durable finding for a future change; `deriveSubgraphContract` keeps
  its exact behavior).
- Loop-body visibility inside the node (child 3, `canvas-loop-body-visibility`).
- `layout.ts` rendering: loop output handles still render the declaration's outcome
  rows. Engine-valid drawing from the loop requires the chosen exit outcome name to
  coincide with a producible row name — true in the default flow (both `'done'`); the
  general divergence (exit value ≠ row name) is recorded below, not fixed here.
- Lifecycle/strategy authoring beyond the default; auto-revalidation after edits
  (Validate stays the authority); any IR change.

## Decisions

### D1 — Outcome rows derive from the body's producible terminal outcomes

New pure helper in `draft.ts` (working name `bodyTerminalOutcomes(def, region, catalog)`),
mirroring `resolveGraphTerminalOutcomes` restricted to the shapes a loop body can have:

- For each region node (all AtomicStage), resolve its capability in
  `catalog.skills` by `(id, version)`; take its `outcomes`, REPLACED by the engine's
  phase projection (`loopPhaseOutcomeNames` mirror: review→`findings`,
  triage→`ready`, fix→`fixed`, re-review→`clean`/`needs_fix`, goal work→`ready`,
  goal judge→`clean`/`needs_fix`) when the node carries a phase tag.
- Consume `(from.node, from.port)` for every INTERNAL region connection whose
  `from.port` is one of that node's outcomes (the engine counts consumption only on
  type-matched control edges; outcome ports are the control edges bodies carry —
  artifact ports are not outcome ports and never enter the set).
- Result: distinct outcome names in body-node order (draft node order, then descriptor
  order), deduplicated keeping first occurrence — deterministic.

A capability missing from the catalog yields NO derivation for that node; the loop
review surfaces a refusal naming the stage ("its capability is not in the catalog, so
the loop's exit outcomes cannot be derived") and offers no confirm — the same
refusal-rendering pattern the review already has. The model re-runs the same check at
confirm (the review is not trusted).

`deriveBackedgeLoopContract` gains a `catalog` parameter and returns
`outcomes: bodyTerminalOutcomes(...)` on EVERY side — severed or fallback, the
engine's exact-cover rule leaves no alternative. The severed/fallback distinction now
governs INPUT naming only. Child-1's `[from]` fallback and round-one's stage-id names
are superseded (documented supersession, D5).

Alternatives rejected: keeping stage-id names and declaring them as definition
outcomes too (pollutes the definition contract with stage names for every loop);
deriving from the sink node only (multi-sink bodies exist — a branch stage whose
outcome no internal edge consumes is terminal too; the engine's rule is graph-wide).

### D2 — Input rows keep their names, gain the control type

Loop-path input rows: names unchanged (child-1's boundary convention — severed target
stage ids, or the back-edge target when nothing severs; rendered handles and the
incoming positional rewire are untouched). Types become `ecp/control` via a new
`draft.ts` constant (`CONTROL_PORT_TYPE`, doc-citing `definition.ts:2749`) applied to
severed and fallback rows alike in `deriveBackedgeLoopContract` (base rows re-typed;
`deriveSubgraphContract` itself unchanged).

### D3 — Declare-on-synthesis through the single rule site, in the shared layer

New `draft.ts` helper (working name `ensureLoopExitOutcomesDeclared(def, loopNode)`):
for every exit-action outcome value in the minted loop's `exits` and
`lifecycle.exits` not already in `def.outcomes`, append it via
`declareDefinitionOutcome` — the same sole rule site the contract panel and the
review's inline declare write through (round-2's single-home verdict; no local
append). Called by BOTH `synthesizeBoundedLoopFromBackedge` and
`addBoundedLoopOverDeclaration` — the shared mint layer, so the palette gesture is
covered by the same transaction. Under the default lifecycle that appends
`iteration-limit` (and, for the palette gesture on an outcome-empty definition, its
`def.outcomes[0] ?? 'done'` exit value); already-declared names are left alone
(duplicate-refused by the rule site anyway).

Transparency: the loop review renders a muted line listing the names confirming will
declare (presentational only, no new decision). `normalizeV1()`'s unconditional
synthesis-time rows are the engine's own precedent for minting contract facts at
synthesis.

Alternative rejected: changing the default lifecycle's exit value to an existing
outcome (e.g. `def.outcomes[0]`) — collapses "loop completed its work" and "hit the
iteration bound" into one indistinguishable outcome, and still requires a declaration
when the definition declares nothing; the distinct name plus a declared contract is
both honest and engine-clean (V5 proved `['done','iteration-limit']` validates).

### D4 — Outgoing crossings rewire onto the loop's exit; the exit choice re-validated

`rewireCrossingsOnto` gains an OPTIONAL outgoing-port override: when present, every
outgoing crossing is rewired `from: { node: loopId, port: <exitOutcome> }` — the
engine's loop output port (D-context). The loop path passes the review's exit
outcome; the extract path passes nothing and keeps today's positional row mapping
byte-identically. The loop's `exitOutcome` is additionally re-validated at the model
(not previously checked): it must be a declared definition outcome, else the
transaction refuses with a named message (the review's select only offers declared
outcomes, so the zero-edit flow never trips it; the model owns the rule for
programmatic callers).

### D5 — Deliberate supersession inventory (what changes vs. what is pinned identical)

CHANGES on purpose (externals-first included): (1) loop-path input row TYPES
(`'input'`-as-type → `ecp/control`); (2) loop-path outcome ROW NAMES (stage ids /
back-edge source → producible terminal outcomes); (3) outgoing rewire source port
(row name → the exit outcome); (4) definition outcomes gain `iteration-limit` (both
gestures; palette additionally its exit value when the definition declared nothing).
Round-one and child-1 test pins asserting those shapes are REWRITTEN to the new truth
with a comment naming this change.

PINNED IDENTICAL: `backedgeRegion`, `subgraphExtractionRefusals`, input row NAMES,
incoming-crossing positional rewire, body content preservation (verbatim move, spread
rewires), id minting conventions, selection pairing, `deriveSubgraphContract` /
`computeSubgraphCut` / the extract path end-to-end, no `legacyRuntimeOwner`, IR.

## Risks / Trade-offs

- [The engine's exact cover makes the review's outcome rows effectively
  body-derived: an author renaming or deleting one re-reds Validate] → Stated in the
  review's outcome list label (rows mirror what the body produces); Validate stays
  the authority (the extract path's existing posture for edited rows). Input rows and
  the exit mapping stay freely editable.
- [Catalog staleness between bind and loop-draw (capability disabled/absent) turns a
  previously drawable cycle into a refusal] → The refusal names the stage and the
  missing capability; the author can still cancel (today's refusal outcome). Honest
  beats a loop that validates red.
- [Rendered loop output handles are the declaration's outcome rows while engine ports
  are the exit values: drawing from the loop is engine-valid only when they coincide
  (default flow: both `'done'`)] → Recorded here as the known boundary; fixing the
  render belongs with child 3's body-visibility work (it owns what the loop's output
  side shows). This change's acceptance covers the coinciding default flow.
- [Mirroring `loopPhaseOutcomeNames` risks drift with the engine] → One small switch
  beside the helper, doc-citing `definition.ts:2777`; unit test pins a phase-tagged
  body stage. The mirror exists BECAUSE the alternative (ignoring phases) silently
  derives unproducible names.
- [`iteration-limit` appears in the definition contract without the author typing it]
  → D3's review line shows exactly what confirming declares, before it happens.

## Migration Plan

UI-layer only; no persisted-state migration (the Save defect means sessions are
in-memory anyway; saved definitions from before keep their contracts verbatim — only
NEW synthesis changes). Rollback = revert the commit.

## Open Questions

None blocking. The producible-set order (body-node order, dedup-first) and the
`iteration-limit` name (engine lifecycle default, not localized) are pinned here;
child 3 consumes the digest for what the loop's output side should render.
