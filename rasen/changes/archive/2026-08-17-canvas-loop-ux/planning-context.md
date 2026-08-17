# Planning context — canvas-loop-ux (portfolio parent, round 3)

## User intent (verbatim, 2026-08-17 live testing round 2)

> 为什么现在连成循环节点就变成了一个节点，还没有入口，我当前想要用ecp表达一个review-cycle这么难吗？
> 1. 为什么不能展开 2. 为什么就不能先连成环，要先连上出入口 有什么是要求这两点必须这样设计的？

LEAD's verified answer to the user: NOTHING in the IR requires either pain. Both are UI-layer
choices from round one. Directive: 开始做吧 (two children, serial, IR untouched).

Base: `f512e3ea` (dev/0.2.0 tip = PR #169 + round-2 parent archive). Branch `feat/canvas-loop-ux`,
worktree `.claude/worktrees/canvas-ir-compiler`. UI test baseline: **68 files / 894**.

## The two findings (LEAD-verified at f512e3ea)

### Child 1 — `canvas-loop-port-inference` (the ordering trap)

- BoundedLoop node ports = its declaration's contract, via `lookupDeclarationPorts`
  (`packages/ui/src/canvas/layout.ts`, input/output branches both route `record.body`).
- Loop extraction reuses child-2's `deriveSubgraphContract`, which derives ports ONLY from edges
  the cut SEVERS. A standalone cycle severs nothing → declaration `inputs: []` → the loop node
  renders ZERO input handles (and an empty outcome set on the exit side) → nothing to connect.
- The IR does NOT require this: `normalizeV1()` mints the loop body with `outcomes: ['done']`
  UNCONDITIONALLY (`src/core/pipeline-registry/definition.ts` ~:3604 — declarations may carry
  contract ports that no edge severed).
- Fix design: when the loop region's extraction severs no inputs, derive the ENTRY port from the
  BACK-EDGE ITSELF — the back-edge's target node is the loop's entry (input port named for that
  node's entry semantics), the back-edge's source node is the loop's tail (exit outcome). Order of
  authoring stops mattering: connect-first or cycle-first both yield a usable loop node. Severed
  edges, when present, still take precedence (existing behavior preserved). All in draft.ts
  (extraction/contract derivation); layout.ts rendering unchanged; IR untouched.
- Acceptance: from an EMPTY canvas, create two stages, wire them into a cycle, confirm the loop
  review → the resulting BoundedLoop node HAS an input handle and an exit outcome handle; connect
  external stages to it afterwards; Validate passes. Also the round-one path (externals first)
  must produce byte-identical results to today.

### Child 2 — `canvas-loop-body-visibility` (the black box)

- The body stages (e.g. review + fix) live in the declaration's graph (`declarations[]`), the
  canvas renders only the root graph → the BoundedLoop node is opaque; the author's mental model
  ("review⇄fix 在环里") is invisible.
- Fix design: render the loop body INSIDE the loop node as an expandable React Flow group
  (parent node + child nodes, `extent: 'parent'`, RF subflow mechanics). Decisions to make:
  expanded by default vs collapsed-with-chevron; read-only rendering vs full editing inside the
  frame (editing must route through draft.ts mutation helpers against the DECLARATION's graph —
  node add/remove/rewire inside the body edits `declaration.graph`, NOT the root); what happens
  to the frame on body edits (re-layout inside the frame); interaction with child-2 round-2
  (durable positions: body nodes' positions live where? — the placement cache is root-node-id
  keyed; decide the frame-local coordinate story). CompositeRef nodes (package-into-block) show
  their declaration the same way? — IN SCOPE if cheap and symmetric (same declaration mechanism),
  else record as explicit non-goal with rationale.
- The body data is fully in hand client-side; no IR change, no server change expected.

## Hard constraints (unchanged)

1. IR frozen: `src/core/pipeline-registry/` empty diff vs `f512e3ea`.
2. No capability holes; one home (rules in draft.ts/layout.ts as appropriate; panels render).
3. `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`; no `legacyRuntimeOwner` stamps.
4. Children ship LOCAL; parent delivers ONCE (push + PR to dev/0.2.0).
5. Selection pairing discipline (recomputeFlow override); positions cache from round-2 must not
   regress (its prune rule is root-node-id based — child 2 must reconcile with body rendering).

## Repo traps (accumulated rounds 1-2 — all live)

- UI tests: `pnpm --dir packages/ui exec vitest run` (CI-canonical). Baseline 68 files / 894.
  NEVER pipe through tail; background + ≤270s polling; Windows flake = timeout → isolate first
  (known i18n catalog src-scan contention flake class).
- Real browser: throwaway Chrome `--window-size=1600,1000`, FRESH port (9333-9348 consumed;
  start 9349+), fresh user-data-dir, direct CDP. Build UI first; note `bin/rasen.js` serves
  ROOT dist — after any `src/` change run `pnpm run build` before serving.
- Driver gotchas (panel occludes right nodes → close panel + re-fit-view; off-screen clamp
  deselects; headless launcher probe /json/version; drag auto-pan inflates near pane edges).
- Spec deltas ADDED-only preferred. Narrow pathspec commits; `bin/rasen.js` CRLF phantom stays
  out of every pathspec; archive-time exclude all `signals/`.
- Round-1/2 digest index: `rasen/changes/archive/2026-08-17-canvas-authoring-followups/planning-context.md`
  (round-2, freshest) and
  `rasen/changes/archive/2026-08-17-canvas-gesture-ir-compiler/planning-context.md` (round-1).
  READ the relevant sections before proposing.

## Planner digest — child 1 propose (canvas-loop-port-inference)

- **BRISE-CORRECTION (the round-3 brief's finding, refined):** the standalone-cycle loop
  is NOT missing its exit handle today — `deriveSubgraphContract` already defaults an
  empty severed-outcome side to `['done']` (draft.ts:2839), so one exit handle renders
  under a generic name. The actual gap is INPUTS-ONLY: `inputs: []` → zero input
  handles → nothing connectable. The change still covers both sides per the brief's
  design (the exit outcome RENAMES from generic `'done'` to the back-edge source's
  name); acceptance stays as written (both handles exist).
- **PORT-NAMING DECISION (design D2, binding for child 2):** fallback rows follow the
  severed-edge boundary convention — entry input named for the back-edge TARGET,
  typed `CONTROL_TARGET_PORT`; exit outcome named for the back-edge SOURCE.
  Soundness (cite-ready): the draft is acyclic (the back-edge was refused for closing
  a cycle), so no internal edge can enter `to` (it would imply a pre-existing cycle
  `to⇝*m⇝*to`) and every other region member is reachable from `to` internally —
  `to` is the body's UNIQUE ROOT and `from` its UNIQUE SINK. Rejected: reserved words
  `entry`/`exit` (a second convention beside the severed one the same dialog shows;
  can collide with a stage id), keeping `'done'` (says nothing, collides with
  definition-outcome vocabulary). Names are editable review defaults and renameable
  afterwards — `updateDeclaration` (draft.ts:2239) reconciles referencing loops' exit
  maps (:2259-2277), verified present.
- **THE SEAM (design D1):** new `deriveBackedgeLoopContract(def, region, from, to)`
  composing OVER `deriveSubgraphContract` (per-side: empty inputs → one `{name: to,
  type: CONTROL_TARGET_PORT}` row; empty outcomes → `[from]`; severed sides verbatim).
  `deriveSubgraphContract`/`computeSubgraphCut`/`rewireCrossingsOnto` untouched —
  pseudo-keys in the cut were REJECTED because that enumeration feeds rewire's
  POSITIONAL mapping (fallback rows exist only when a side's real key list is empty,
  so indices cannot collide by construction). Exactly two call sites switch:
  `openLoopReview` (PipelineCanvasPage.tsx:1406, plus the `derived` type at :317) and
  `synthesizeBoundedLoopFromBackedge`'s internal re-derivation (draft.ts:3110).
  `V2LoopReviewPanel` and `layout.ts` change nothing. The extract/CompositeRef path
  cannot see the fallback (no back-edge exists there — explicit non-goal, recorded).
- **LINE-NUMBER DRIFT vs the digests (child 2, re-locate before citing):** round-2
  child-2's placement work shifted the loop seams at f512e3ea:
  `deriveSubgraphContract` :2819 (was :2696), `extractSubgraph` :2887,
  `extractSubgraphIntoDeclaration` :2915, `rewireCrossingsOnto` :2973,
  `synthesizeBoundedLoopFromBackedge` :3072, `backedgeRegion` :340,
  `addBoundedLoopOverDeclaration` :966 (was :843). Engine cite: the brief's
  "normalizeV1 ~:3604" is the loop block :3603-3637 (declarations.push :3605,
  `outcomes: ['done']` :3611, BoundedLoop node :3626).
- **SPEC PARSER RULE EXTENDED (bit THIS child; child 2 must follow):** beyond the
  round-1 em-dash truncation, the delta parser's captured requirement text is
  effectively the FIRST LINE of prose — validate requires SHALL/MUST inside that
  captured segment. This change failed validation with zero em-dashes (truncation at
  the first line wrap; `rasen show <change> --json --deltas-only` shows the cut).
  RULE: the FIRST LINE of requirement prose must contain SHALL. (Round-1/2 deltas
  passed with SHALL on line one, apparently by luck of the wrap.)
- **Test layout fact:** loop-synthesis unit tests all live in
  `packages/ui/test/canvas/draft.test.ts` (the only test file referencing
  `synthesizeBoundedLoopFromBackedge`; `bounded-loop-lifecycle.test.tsx` is the
  lifecycle panel, unrelated). Child-2 body-visibility tests will likely need a new
  seam in the shared ReactFlow mock for parent/child extent rendering — check what
  child-1-round-2's `position`-change trigger already models before adding another.
- **Artifacts:** proposal/design/specs/tasks complete, `rasen validate` green; delta
  ADDED-only ("The loop carries its entry and exit", 6 scenarios, no em-dashes,
  SHALL on line one); 13 tasks across model/page/unit/page-test/gates; acceptance
  pins externals-first byte-preservation (deep-equal per severed side) and the
  mixed-side cases both directions.

## Planner digest — child 2 propose (canvas-loop-validate-clean-synthesis)

- **ENGINE CONTRACT RULES (cite-ready, all read at 604caba1; child 3 needs these):**
  exact cover is TWO-directional (`validateOwnerTerminalOutcomes` definition.ts:3060:
  undeclared producible AND declared unproducible both error); producible =
  `resolveGraphTerminalOutcomes` :2952 (control-typed outputs not consumed by
  same-graph connections; AtomicStage = descriptor outcomes PHASE-PROJECTED via
  `loopPhaseOutcomeNames` :2777 — review→findings, triage→ready, fix→fixed,
  re-review→clean/needs_fix, goal work→ready, goal judge→clean/needs_fix); declaration
  input rows get NO control widening (`portMap(declaration.inputs)` literal — the
  input/in/start widening at :2813-2830 is AtomicStage-only, empty-descriptor-only);
  **a BoundedLoop's OUTPUT ports are the exit-ACTION outcome values of exits +
  lifecycle.exits** (`contractForNode` :2851-2867), NOT the declaration outcome rows;
  the default lifecycle's ONLY exit action is iterationLimit→'iteration-limit'
  (draft.ts:576 — fail/escalate/human-required produce no control output; evidence V4
  proved over-declaring those names goes red).
- **RENDER-VS-ENGINE DIVERGENCE (child 3's boundary, recorded not fixed):** layout.ts
  :251-258 renders the loop's output handles from the DECLARATION's outcome rows while
  the engine's ports are the exit values — a drawn edge FROM the loop validates only
  when the chosen exit outcome name coincides with a producible row name (the default
  flow: both 'done'). Child 3 (body visibility) owns what the loop's output side
  renders; the general fix belongs there. Also still engine-red and deliberately
  untouched: the EXTRACT/package-into-block path (same stage-id-outcome and
  port-name-as-type defects in `deriveSubgraphContract` rows) — future change.
- **THE THREE FIXES AS DESIGNED (design D1-D4):** outcome rows = new
  `bodyTerminalOutcomes(def, region, catalog)` (catalog.skills by id+version, phase
  mirror, internal-connection consumption, body-node order; catalog-gap = review
  refusal + model re-check, "surfaced in the review, not Validate"); input rows keep
  child-1's NAMES and gain type `ecp/control` (new draft.ts constant); synthesis
  declares every loop-emitted exit outcome via `declareDefinitionOutcome` in the
  SHARED mint layer (both gestures; `iteration-limit` under the default lifecycle);
  outgoing crossings rewire onto the EXIT OUTCOME via an optional rewire override
  (extract path positional behavior byte-kept); `exitOutcome` must be declared — new
  model refusal. Catalog-gap staleness is honest: the refusal names the stage.
- **DELTA DISCIPLINE:** MODIFIED ×2 against the TREE's current text (both OURS and
  landed: round-one's "The canvas turns a drawn back-edge into a bounded loop" via PR
  #167; child-1's "The loop carries its entry and exit" via archive d0c761a6 — whose
  amended scenario :1075-1080 already names THIS change as the deferred fix, so the
  MODIFIED deletes that deferral honestly) + ADDED "Loop synthesis needs no contract
  repair" (5 scenarios). SHALL-on-first-line held for all three (validated green
  first try). The deliberate byte-preservation supersession is inventoried in design
  D5 (changes: input row TYPES, outcome row NAMES, outgoing rewire PORT, definition
  outcomes += iteration-limit; pinned identical: region, refusals, input NAMES,
  incoming positional rewire, body preservation, extract path end-to-end).
- **Zero-edit acceptance mechanics (for the implementer):** the review's inline
  declare (round-2 child-1) is the ONE author input the empty-canvas flow still
  needs (the exit outcome must exist to be chosen) — that is review-time design
  input, not contract repair; the acceptance forbids POST-synthesis contract edits.
  Reusable drivers: `.rasen/changes/canvas-loop-port-inference/ephemera/`
  (author-edits-to-green.mjs minus the three edits; validate-variants.mjs).
  Baseline now 68 files / 902. No client-side rule reads input-handle types
  (grep at propose time — re-verify in apply before assuming interactions changed).

## Planner digest — child 3 propose (canvas-loop-body-visibility — LAST child)

- **FRAME MECHANISM FACTS (verified at f18a811c / RF dist):** the v1 `parallelGroup`
  subflow rendering (layout.ts:599-700) is the in-repo template — group node with
  explicit style width/height from the members' dagre bounding box (+GROUP_PADDING
  +GROUP_LABEL_HEIGHT), members `parentId`/`extent: 'parent'` with positions RELATIVE
  to the box origin, group emitted BEFORE members (RF parentId resolution order).
  Verified live in the installed dist (@xyflow/react 12.11.2 → @xyflow/system 0.0.79:
  parent-relative positioning, child z-order from parents, extent clamping); the
  `group` node type is already registered (`stageNodeTypes` includes it,
  StageNode.tsx:194) and group nodes are `selectable: false, draggable: false` — body
  cards follow that parity. The frame differs from a v1 group in exactly three ways:
  the parent is a REAL root node (identity + external handles stay), body ids are
  declaration-scoped (may COLLIDE with root ids → namespaced flow ids
  `<frameId>::<bodyNodeId>`, per-frame so two expanded refs can share ONE
  declaration), and the frame's size feeds the ROOT dagre pass (UnpositionedStage
  gains optional width/height; default constants keep every existing caller
  byte-identical).
- **SELECTION/CACHE ISOLATION (the zero-regression design):** body nodes are
  RF-unselectable (`selectable: false`) so CanvasSelection, the mirror, box-select,
  multi-delete, and the selectionOverride pairing NEVER see a body id; body clicks set
  a separate `bodySelection` scalar (round-1 node/edge mutual-exclusivity pattern;
  pane click clears both). The placement cache stays root-keyed — body ids never
  enter it; frame growth shifting undragged neighbors is the round-2 rule, dragged
  placements survive (pinned by test 4.5 via the round-2 drag trigger). Expansion
  state = a page REF keyed by root node id (the flow rebuild is the render truth),
  reset in enterEditWith, never in the payload.
- **SCOPE VERDICT (the honest stretch call):** minimum-lovable = see the body + a
  read-only body-stage panel (V2BodyStagePanel; pointer to the declarations panel for
  the contract). Full in-frame editing is the EXPLICIT non-goal: no declaration-body
  mutation helpers exist, and any body edit forces contract re-derivation against the
  engine's exact-cover rule (child-2's bodyTerminalOutcomes becomes a re-derivation
  engine) — a change of its own. CompositeRef frames ARE in scope (same declaration
  lookup as BoundedLoop — one helper, both id sources). Synthesis auto-expands the
  new node (all three handlers: loop review, palette gesture, extract confirm) —
  moment-of-formation feedback is the point of Q1. No new ReactFlow mock seam needed
  (chevron is real DOM; body cards are plain nodes).
- **Known boundaries carried (unchanged, for any future change):** the extract path
  still mints engine-red defaults; loop output handles render declaration rows while
  engine ports are exit values (coincide in the default flow — deliberately NOT fixed
  here per this round's no-port-changes split); canvas Save defect untouched.
- **Artifacts:** proposal/design/specs/tasks complete, validate green; delta
  ADDED-only ("The loop shows its body", 8 scenarios, SHALL on line one, no
  em-dashes); 18 tasks. Browser gate: port 9354+ and the route from the `?space=`
  query param (child-2's handoff: the entry pathname is `/`; deriving from it 404s).

## Round-3 assembly notes (for the parent PR body — one line per child)

- **1 canvas-loop-port-inference** (ship 604caba1, archive d0c761a6, tests 68/902) —
  a standalone cycle's loop derives its entry port from the back-edge target
  (boundary-convention naming, control-typed): loops are connectable cycle-first and
  authoring order stopped mattering (user Q2's ordering trap killed).
- **2 canvas-loop-validate-clean-synthesis** (ship f18a811c, archive 59bfa9f8, tests
  68/912 UI + 5/5 core) — loop synthesis mints engine-clean defaults zero-edit:
  producible outcome rows, `ecp/control` entry rows, and the lifecycle's exit outcome
  declared at synthesis in the shared mint layer (palette gesture covered); the
  cross-layer provenance test re-injects each pre-fix defect class and proves it red.
- **3 canvas-loop-body-visibility** (this propose) — expandable frames render the
  body inside the loop/composite node with read-only body panels and synthesis
  auto-expand (user Q1 "为什么不能展开").
- **User-question mapping:** Q1 (为什么不能展开) → child 3; Q2/Q3 (连成环没有入口 /
  必须先连出入口) → children 1+2 (entry derivation from the back-edge; validate-clean
  defaults so nothing needs rewiring first).
- **Standing posture (all three):** IR frozen (zero diff under
  src/core/pipeline-registry since f512e3ea); ADDED-only deltas except child-2's
  sanctioned MODIFIED ×2 of our own landed requirements; no legacyRuntimeOwner;
  one-home rules held (draft.ts model, layout.ts geometry, panels render); children
  ship LOCAL, the parent delivers ONCE (push + PR to dev/0.2.0); UI suite counts
  894 → 902 → 912 → (child-3 gate cites its own); all verification in-memory (Save
  defect deliberately untouched).
