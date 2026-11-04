# Planning context — canvas-gesture-ir-compiler (portfolio parent)

## User intent (verbatim)

> 查看交接文档：HANDOFF-canvas-gesture-ir-compiler.md 开始推进全部ir-compiler的任务！

The upstream product acceptance criterion (from the original user, recorded in the handoff):

> 我觉得这个设计的完全不是给普通人用的啊。Choice FanOut Join 这些不应该是底层逻辑吗？我想象中的
> 用户的使用体验，就是往 canvas 上创建 workflow 的节点，然后连线，能够连成环（有出口），能够连
> 并行节点，现在这样子复杂的根本不知道如何下手。

Target experience: **drop nodes, draw edges, and let the editor infer the IR** — loops from a
back-edge (with an exit), parallelism from edges that fan out and reconverge. The author never
meets the words `FanOut`, `Join`, or `Choice`.

## THE primary source — read this FIRST

`HANDOFF-canvas-gesture-ir-compiler.md` at the worktree root (repo root of this checkout). It
contains: what round one shipped (PR #165, palette + layout), the design argument
(`normalizeV1()` as proof these node kinds are IR not author vocabulary), the full decomposition
A/B/C/D/E with dependency rationale, the current API surface table in `packages/ui/src/canvas/draft.ts`
with line numbers, four non-negotiable constraints, repo traps that cost real time in round one, and
open decisions. EVERYTHING below is a summary — the handoff doc is authoritative.

## Decompose plan (LEAD-audited, taken)

Five serial children (ALL touch `packages/ui/src/canvas/draft.ts` + `pipelines-ui` spec → no
parallelism is provable → strict serial chain, per the conservative policy):

1. `canvas-multi-selection` (full-feature) — Set-based selection state, React Flow box-select,
   panels render multi-selection. Today: three single scalars, no multi-select at all.
2. `canvas-subgraph-extraction` (full-feature) — 框选「打成复用块」: compute the cut, derive
   declaration inputs/artifacts/outcomes from severed edges, build CompositeDeclaration, replace
   with CompositeRef, rewire. Depends on 1.
3. `canvas-backedge-loop-inference` (small-feature) — back-edge + author-supplied bound/exit →
   synthesize BoundedLoop. Depends on 2 (structurally: BoundedLoopNode.body is a declaration id).
4. `canvas-parallel-frontier-inference` (small-feature) — detect fan-out/reconverge → offer
   FanOut+Join pair with concurrencyCap/budget/membership. Depends on 3 (serial by file overlap).
5. `canvas-sink-finish-inference` (small-feature) — nodes with no outgoing edge are terminal;
   author names the outcome. Depends on 4 (serial by file overlap).

## Hard constraints (enforced in round one; carry into every child)

1. **IR frozen**: no edits under `src/core/pipeline-registry/`. Assert `git diff <base> -- src/core/pipeline-registry/` empty.
2. **No capability holes**: anything inference replaces must stay authorable (explicit gesture stays or replacement lands in same change).
3. **One home for the vocabulary**: gesture list + availability rule + composition helpers live in `draft.ts`; `PalettePanel.tsx` renders, decides nothing.
4. **`V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`** (spec forbids widening).
5. **Never stamp `legacyRuntimeOwner` on synthesized nodes** — it silently exempts nodes from the choice-select evaluator requirement. Round one has `not.toHaveProperty` guards; keep that discipline.

## Repo traps (round one paid for these)

- `packages/ui` has its OWN vitest config; root config excludes it. Always run with
  `pnpm exec vitest run --config packages/ui/vitest.config.ts` style invocation and CITE the count.
  Baseline at round one: 67 files / 743 tests.
- jsdom does no layout; width/flex claims need string-level CSS pin + real-browser CDP measurement.
- Real browser = CDP against throwaway Chrome (`--remote-debugging-port` + fresh temp user-data-dir);
  NEVER touch the user's daily Chrome (proxy latched 3456→9222).
- CSS pins must anchor property AND value (`declares(prop, value)` helper).
- Mutation proofs must land where aimed (assert anchor unique, print line numbers).
- `recomputeFlow()` (`PipelineCanvasPage.tsx:304-316`) re-runs `layoutGraph` after every mutation —
  node positions non-durable by construction. Relevant to child 1.
- Windows test flakiness is always timeout-never-assertion; re-run in isolation on a settled machine.
- Never pipe a gate command through `tail` (exit status becomes tail's).
- Narrow pathspec on every commit; never `git add -A`.
- Canvas Save does not persist (pre-existing defect, do NOT fix here; end-to-end save/reload
  verification will hit it — verify in-memory/state instead).

## Decisions already made

- All five children ship `local` (commit only); ONE portfolio-level delivery at the parent after
  all children complete.
- Explicit Loop/Parallel gestures SURVIVE; inference is additive (round one's position; revisit
  only with working code in hand — not in scope of these children).
- Child pipelines: small-feature for ALL five (children 1&2 switched from the handoff's full-feature recommendation by USER DECISION 2026-08-17 — do not re-introduce office-hours/expert-fan-out stages).

## Planner digest — child 1 propose

- SPEC-BASE TRAP: even after the rebase onto `74568906`, round one's SPEC sync lives only in
  archive commit `f77bccdf` (not an ancestor) — the tree's `rasen/specs/pipelines-ui/spec.md`
  is PRE-round-one. Child 1 therefore used an ADDED-only delta ("Canvas selection is a set"),
  which applies regardless of merge order. Any later child that must MODIFY a requirement round
  one touched ("Canvas edits the enabled v2 root vocabulary", "The v2 root palette offers author
  gestures", "The canvas page fits a single viewport") MUST copy its MODIFIED block from
  `f77bccdf`'s text, not the tree's, and confirm the round-one archive PR has merged.
- Forward contract for B/C/D (in child 1's design D1/D2): `CanvasSelection { nodeIds,
  connectionIds }` + `singletonNodeId`/`selectionPanelMode` live in draft.ts; React Flow owns
  the interaction truth, the page keeps one derived mirror; B consumes `nodeIds` only and
  derives its severed-edge cut from the draft itself.
- `recomputeFlow` gains a selection-carry (stamp `selected` by id when rebuilding) in child 1 —
  any later slice that rebuilds flow nodes must preserve it; node POSITIONS stay non-durable by
  deliberate non-goal (revisit only when a slice wants manual placement).
- Child 1's office-hours-design.md survived the office-hours abort and was propose's input; its
  B3 write-site table (~16 scalar sites) became design D3 + tasks 2.x verbatim.
- Tests: the ReactFlow mock in `pipeline-canvas-page.test.tsx` gains an `onSelectionChange`
  trigger (task 4.1) — later children writing selection-dependent tests should reuse that
  trigger instead of adding another seam.

## Open probe for children 3-5 (from child-2 verify, m2)

- Box-select containment reliability is UNPROVEN beyond one run: child-2's CDP transcript recorded
  three attempts where a verified-containing rectangle selected only ONE of two nodes
  (Control+click-corrected each time). Could be child-1 gesture behavior, could be one-run noise.
  Child 3's apply MUST repeat-probe box-select containment FIRST in its real-browser check (draw
  several rectangles over known-contained node sets, assert full membership) BEFORE leaning on
  box-select for loop-body selection; if it reproduces, it is a child-1 follow-up fix, not child-3 scope.

## Implementer digest — child 1 apply (relayed verbatim by LEAD)

- **VITEST INVOCATION CORRECTION (supersedes the trap line above):** `pnpm exec vitest run --config packages/ui/vitest.config.ts` from repo root runs the ROOT suite on this machine (wrong corpus, prints pass) — use the CI-canonical `pnpm --dir packages/ui exec vitest run` (67 files / 765 tests after child 1; baseline was 67/743).
- Real-browser check caught a hard tab freeze the jsdom suite could not see: React Flow's SelectionListener effect depends on the onSelectionChange callback identity and fires at mount, so writing a fresh selection object for an unchanged value loops forever — fixed by returning the same state for unchanged values (PipelineCanvasPage.tsx onSelectionChange); do not remove that guard.
- Gesture handlers UNION the new node into the selection instead of design D3's 'replace': the spec delta's 'Selection survives a non-destructive edit' scenario requires previously selected nodes to stay selected across a palette add (the parallel gesture unions both halves of the pair). removeV2Nodes also now removes selected FanOut pairs before plain nodes (pairs-first) so a box-selection of a frontier plus its members deletes as one unit instead of refusing the last member — both documented in rasen/changes/canvas-multi-selection/handoff/implementer-1.md.
- CDP note: cdp-proxy.mjs hardwires 127.0.0.1 which this Chrome does not bind — direct CDP against the throwaway instance's --remote-debugging-port (used 9333) works; evidence in rasen/changes/canvas-multi-selection/evidence/ (cdp-transcript.md, gates-5-2.md).

## Planner digest — child 2 propose

- Slice B grammar facts (cite-ready, verified at child-1 ship): declaration shape at
  `types.ts:1498` (inputs/artifacts/outcomes/graph; IR mirror `definition.ts:243`); a
  CompositeRef's RENDERED ports come from its declaration — inputs→in-handles,
  artifacts+outcomes→out-handles typed `outcome/<name>` (`layout.ts:79-126`) — so B's rewires
  must target exactly those names. Cross-node structural references that force refusals:
  `Gate.target`, `FanOut.branches/members[].id/.hierarchicalPath`, `Join.inputs/required/
  optional`, root `consultations[].sourceStage` — engine v1-normalized drafts write
  `stage:`-prefixed forms (`definition.ts:3599/3681-3692`) while authored v2 writes raw ids,
  so reference checks must test BOTH forms.
- normalizeV1 is the transformation template to mirror: loop-body declaration synthesis at
  `definition.ts:3603-3625` and the group-member connection rewrite at `:3699-3727`
  ("downstream requires re-pointed at the Join") — B's rewire is the engine's own idiom, not
  a novel one.
- Child-2 spec delta stayed ADDED-only ("The canvas packages a selection into a reusable
  declaration", 6 scenarios) — child 3/4/5 proposes should keep doing this while any
  round-one-touched requirement remains un-reconciled on dev/0.2.0's side.
- Contract note for child 3 (C): `BoundedLoop.body` is a DECLARATION id (`types.ts:1386`) —
  C's loop inference should mint a BoundedLoop pointing at a declaration B produced (or
  extract one via B's `extractSubgraph` first); the refusal/derivation functions
  (`subgraphExtractionRefusals`, `deriveSubgraphContract`, `extractSubgraph`) are the
  reusable seams, landing in draft.ts beside `insertCompositeRef` (:880 at current base).
- After-extraction selection write MUST go through the `recomputeFlow` selectionOverride
  path (both selection truths in one tick) — the plain `setSelection` mirror alone is
  reverted by React Flow's SelectionListener one commit later (documented at
  PipelineCanvasPage.tsx:330-341).

## Planner digest — child 3 propose

- Cycle handling C intercepts (cite-ready): `wouldCreateCycle` draft.ts:305-307 (reachability
  via `buildAdjacency` over requires/typed edges) is called FIRST in `onConnect` — a drawn
  back-edge NEVER enters the draft, so back-edge consumption in loop synthesis is structural
  (nothing to exclude; region-internal edges are acyclic by `bodyWouldCreateCycle`'s rule).
  Child-3 design D1: a refused cycle-closing draw IS loop intent by construction — no second
  "is-back-edge" predicate exists to drift.
- Child-2 seams as shipped (line numbers at child-2 archive 8ad73cc9): `subgraphExtractionRefusals`
  :2551 + internal `subgraphExtractionRefusalsForNodeIds`, `computeSubgraphCut` :2650 (positional
  cut enumeration, CUT_KEY_SEPARATOR NUL), `deriveSubgraphContract` :2696, `extractSubgraph` :2756;
  loop template `addBoundedLoopOverDeclaration` :843-867 (limits 3/12/12, last-outcome-exits
  convention). Child-3 decomposes extractSubgraph into declare + parameterized rewire (public API
  unchanged) and mints the loop as the replacement node instead of a CompositeRef.
- Region rule for C (design D2): S = {to, from} ∪ {n | to⇝*n ∧ n⇝*from} over the SAME adjacency
  builder wouldCreateCycle uses — children 4/5 doing topology detection should reuse that
  single builder rather than reimplementing reachability.
- Child-3's real-browser gate carries the m2 box-select repeat-probe FIRST (predecessor standing
  order); child-2's driver pitfalls are now a checklist: close the selection summary panel before
  handle drags (covers right-column handles), focus-before-blur on inputs, re-fit-view before
  every drag, fresh CDP port (9333+ busy), build packages/ui before serving.

## Planner digest — boxselect-fix propose (m2 ROOT-CAUSED)

- **m2 root cause (source-confirmed, cite-ready):** React Flow v12 defaults
  `selectionMode = SelectionMode.Full` (`@xyflow/react/dist/esm/index.js:3728`); box selection
  calls `getNodesInside(..., selectionMode === SelectionMode.Partial, ...)` (`:1519`), and
  `getNodesInside` (`@xyflow/system` 0.0.79 `dist/esm/index.js:354-381`) includes a node only
  when `overlappingArea >= area` (FULL containment) unless `partially`. We never passed
  `selectionMode`, and every CDP driver's rect entered 10px into the leftmost target's left edge
  — geometric containment but never full containment of that node → the deterministic
  leftmost-only miss and singleton-zero. NOT drag-on-node, NOT coordinate transform, NOT the
  mirror guard. Fix = `selectionMode={SelectionMode.Partial}` (one prop, g-003.5).
- **Probe-driver corollary for children 4/5:** any future driver that draws a box-select rect
  must either pass `selectionMode`-consistent expectations (post-fix: overlap selects) or
  construct rects that FULLY contain intended targets — the 10px-clip geometry was the
  confound that made three sessions read a library default as a mystery defect.
- The pinned-vs-behavioral test split for geometry-dependent interactions: jsdom mocks pin the
  PROP (one line), the throwaway-CDP probe pins the BEHAVIOR (the archived probe function is
  the reusable fixture — rerun verbatim, do not "fix" its rect construction).

## Planner digest — child 4 propose

- **SPEC PARSER QUIRK (bit child 4, will bite child 5):** the delta parser TRUNCATES a
  requirement's captured text at the first em-dash (" — "), and validate then requires
  SHALL/MUST inside that captured segment — child 4's delta failed validation with "must
  contain SHALL" while visibly containing three SHALLs past an em-dash on line one. Children
  1-3 passed only by luck (SHALL preceded every em-dash). RULE: write requirement prose with
  NO em-dashes (parentheses/colons instead) or put SHALL before any that remain; scenarios
  are unaffected. Debug with `rasen show <change> --json --deltas-only` and read the parsed
  `text` field to see the truncation.
- Slice-D facts (verified at fix-child ship 864f45b9): `createParallelPair` (draft.ts:972)
  builds BOTH nodes with metadata but ZERO connections (the gesture leaves wiring to the
  author) — D's synthesis composes it plus `addV2Connection` wiring on the RENDERED handle
  ids: FanOut in = 'input', out = one per branch named by member id; Join in = one per member
  id, out = outcome values (`layout.ts:207-260`). Drawn-edge consumption mirrors child-3:
  the S→m / m→T sandwich is removed, never surviving beside the pair.
- Detection strictness rule (design D1, generalizes to child 5's sink detection): a shape
  member qualifies only with in(m)={S} ∧ out(m)={T} exactly — extra edges EXCLUDE the node
  (honesty over repair); ≥2 clean branches minimum; S/T ∉ {FanOut, Join} (already-pair
  endpoints mean the IR structure exists). Non-blocking offer rides the toast slot with an
  optional action button (new in this change) because the completing edge is LEGAL — unlike
  child 3's refused back-edge, there is no refusal to justify a modal.

## Planner digest — child 5 propose (LAST child — portfolio assembly material)

- Slice-E shape (verified at child-4 ship 6dba3ff0): `addFinishNode` (draft.ts:902-905,
  untouched since round one) appends an UNWIRED Finish defaulting to `def.outcomes[0]`; E's
  `promoteSinkToFinish` reuses that exact node shape with the picked outcome + one wire
  (AtomicStage sources CONTROL_SOURCE_PORT 'done'; a Join sources its `outcomes.proceed`
  VALUE — pin the id against layout.ts). A Join is NEVER converted (Finish is its own kind,
  types.ts:1470-1473; Join outcomes are barrier semantics, :1460) — always append.
  Affordance is a panel section on the selected promotable sink (pull, not push: sink-ness
  is the common state of every growing draft). Promotable kinds = AtomicStage + Join only;
  loop/composite/gate/choice ends keep the explicit gesture (per-kind rendered-port
  resolution deferred).
- **PORTFOLIO ASSEMBLY MATERIAL (for the parent's delivery/PR body — the acceptance story):**
  the upstream user criterion was "drop nodes, draw edges, loops with an exit, parallel
  branches, never meet the words FanOut/Join/Choice". Delivered per child: **1**
  canvas-multi-selection (115857a0) — set selection, Shift+drag box-select, Ctrl/Cmd
  augmentation, multi-delete with pair co-deletion, panels render multi state;
  **g-003.5** boxselect-fix (864f45b9) — selectionMode=Partial, the m2 containment defect
  root-caused to RF's Full default and fixed; **2** canvas-subgraph-extraction (7cc8e680) —
  box-select a region into a reusable Custom Composite declaration with derived
  inputs/artifacts/outcomes and a rewire onto the ref; **3** canvas-backedge-loop-inference
  (41dda20d) — a drawn cycle-closing edge opens the loop review (bound + exit outcome),
  confirm extracts the region and synthesizes a BoundedLoop, the back-edge consumed; **4**
  canvas-parallel-frontier-inference (6dba3ff0) — a completing fan-out/reconverge offers the
  pair (membership required/optional, cap, budget), confirm consumes the drawn sandwich and
  wires the FanOut+Join; **5** canvas-sink-finish-inference (this change) — a terminal
  stage/barrier offers to name its endpoint's outcome, confirm appends the wired Finish.
  Standing posture across all: inference is ADDITIVE (every explicit gesture survives),
  IR frozen (src/core/pipeline-registry zero diff since 74568906), never stamped
  legacyRuntimeOwner (dual-layer guards), Validate stays the authority, all UI suites
  CI-canonical with cited counts (67/743 → 67/815 → 67/839 at child 4).
- Portfolio-wide gotchas the assembler should know: the tree's pipelines-ui spec history
  (round-one sync f77bccdf vs in-branch archives — all child deltas ADDED-only except
  g-003.5's MODIFIED of OUR child-1 requirement, deliberately merge-order-agnostic); the
  em-dash spec-parser truncation rule (child-4 digest); canvas Save persistence defect is
  STILL open and deliberately untouched (all verification in-memory); position
  non-durability (recomputeFlow re-layout) likewise untouched by portfolio decision.
