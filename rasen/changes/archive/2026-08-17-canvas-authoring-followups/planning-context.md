# Planning context — canvas-authoring-followups (portfolio parent, round 2)

## User intent (verbatim, 2026-08-17 live testing of PR #167's build)

> 1. 我现在怎么创建一个基于ecp的review-cycle
> 2. 我为apply后面接了teacher和review，teacher作为特殊接线，不是必经的，要怎么正确接上呢？现在报错
>    PORT_MISMATCH: Definition graph produces terminal outcome 'done', but it is not declared by the owner contract.
>    /root/nodes/0/capability  /root/nodes/6/capability
> 3. 为什么现在增加一个节点都是固定初始位置，不是用户拖拽到任意位置
> 4. 左侧的stage列表应该把expert和普通workflow区分开，并且propose apply review ship archive 这些常用的应该靠上面

User directive: 从 0.2.0 新开分支开始做 2/3/4（三个子项，全部 small-feature，严格串行）。

Base: `fb243e83` (dev/0.2.0 tip = PR #167 + parent archive). Branch `feat/canvas-authoring-followups`.
Worktree: `.claude/worktrees/canvas-ir-compiler` (same as round one; the ir-compiler portfolio's
untracked ephemera residue is inert — never commit it).

## The three findings (LEAD-verified against code at fb243e83)

### Child 1 — `canvas-root-contract-editor` (the HARD BLOCKER — reframed after planner2's premise correction)

- **CORRECTION (planner2, 2026-08-17, three-way verified):** the root contract editor EXISTS —
  `DefinitionContractPanel` renders in the left authoring column whenever v2 edit mode is on
  (`PipelineCanvasPage.tsx:2808-2816`, wired to `patchDefinitionContract` since ECP-2 era), and it
  already edits outcomes/inputs/artifacts/limits via `updateDefinitionContracts`. The LEAD's earlier
  "no UI calls it" claim was a grep miss (`onPatch={patchDefinitionContract}` is a prop reference,
  not a call site — grep for the bare symbol, not just the call form).
- The REAL dead end is discoverability + degenerate picks on a fresh definition:
  `createBlankCanvasPipelineDefinitionV2` seeds `outcomes: []` (draft.ts:90) → clicking the
  PORT_MISMATCH issue selects the producing NODE, whose sink-promotion select is EMPTY with a
  disabled confirm; loop review + parallel review outcome selects map only `definitionOutcomes`
  (parallel defaults 'done'/'failed' with NO options — confirm would submit UNDECLARED outcomes and
  re-trip the same PORT_MISMATCH); loopReview holds a stale open-time outcomes snapshot (:2746).
- `resolveGraphTerminalOutcomes` (definition.ts:2952) is NOT exported — a structural
  "declare-the-complained-outcome" button would duplicate the frozen engine rule; message-parsing
  is fragile. Don't build that.
- Reframed scope (planner2's, LEAD-approved): left panel stays THE surface; definition outcomes
  switch to the NameListField idiom (commit-on-blur — also kills the per-keystroke
  patch/recomputeFlow churn at DefinitionContractPanel.tsx:206-215); empty-state POINTERS in sink
  promotion + review panels (jump/focus the root outcomes field); thin inline declare in the LOOP
  REVIEW ONLY (the one blocking modal) via a new `declareDefinitionOutcome` wrapper in draft.ts
  (single rule site stays `updateDefinitionContracts`); fix the stale snapshot.
- **Single-home verdict for children 2/3:** root editor = single home for declaring; all picks
  read-only + pointers.
- Issues do NOT auto-refresh after declaring (only explicit Validate, handleValidate :724) —
  acceptance scenario pins declare → Validate → issue gone; debounced auto-revalidate is an
  explicit NON-goal.
- Teacher optional wiring (the user's actual graph): teacher belongs on a parallel branch as an
  optional member (round-one child-4 review panel has required-vs-optional toggles) or as an
  optional Join input; its terminal outcome must be declared (or get a Finish via sink promotion).
  No code change needed for the wiring itself — document it in the proposal as guidance.

### Child 2 — `canvas-durable-node-positioning`

- `recomputeFlow()` re-runs `layoutGraph` over EVERY v2 node after EVERY mutation → author-dragged
  positions are discarded on the next keystroke (non-durable BY CONSTRUCTION). Recorded as a
  deliberate non-goal in round one's handoff §7 and planner digest; the user's request is the
  trigger to revisit.
- Design direction: persist author positions (cache per node id — in-memory state or a def-level
  position map; note `src/core/pipeline-registry/` is FROZEN, so positions cannot go into the IR
  definition — UI-local state/derived storage only), layout only NEW nodes, preserve positions of
  existing nodes across mutations. Watch the interaction with the selection-carry (`recomputeFlow`
  stamps `selected` by id — keep it) and with extraction/loop/parallel synthesis (nodes move INTO
  declarations — decide what happens to their cached positions).

### Child 3 — `canvas-palette-grouping`

- `PalettePanel.tsx` renders `(skills ?? []).map(...)` in API order — flat, no grouping, no
  priority. User wants: experts visually separated from ordinary workflows, and the core pipeline
  stages (propose / apply / review / ship / archive) at the top.
- ONE-HOME rule: the grouping + ordering rule belongs in `draft.ts` (a pure helper: takes the
  skill list, returns grouped+ordered), `PalettePanel.tsx` only renders. Do NOT decide in the panel.
- Skill source: `isBindableSkill` is the single bindability predicate; the grouping input needs the
  skill's kind/expert metadata — check what the skills API payload carries (kind: task|driver|
  internal|expert per CLAUDE.md's workflow taxonomy); if the payload lacks it, find the right
  source before inventing detection.

## Hard constraints (unchanged from round one — all still live)

1. IR frozen: no edits under `src/core/pipeline-registry/` (assert empty diff vs `fb243e83`).
2. No capability holes.
3. One home for the vocabulary: rules live in `draft.ts`; panels render and decide nothing.
4. `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`.
5. Never stamp `legacyRuntimeOwner` on synthesized nodes.
6. Children ship LOCAL; parent delivers ONCE (push + PR to dev/0.2.0 per round-one precedent).

## Repo traps (all paid for in round one — read the archived handoffs too)

- UI tests: `pnpm --dir packages/ui exec vitest run` (CI-canonical). Round-one close: 67 files /
  854 tests. NEVER pipe through tail; background + ≤270s polling for long runs.
- Real browser: throwaway Chrome, FRESH port (9333-9344 consumed; start 9345+),
  `--window-size=1600,1000`, fresh `--user-data-dir`, direct CDP (cdp-proxy.mjs hardwires 127.0.0.1).
  Build first (`pnpm --dir packages/ui run build`), serve `node bin/rasen.js ui --no-open
  --no-daemon --port <p>`.
- Driver gotchas (panel occludes right-side nodes → close panel + re-fit-view before clicking;
  off-screen centers clamp → deselect; headless launcher exits immediately on Windows → probe
  /json/version): preserved in
  `rasen/changes/archive/2026-08-17-canvas-sink-finish-inference/evidence/handoff/implementer-1.md`.
- Spec deltas: ADDED-only preferred (tree base = fb243e83 carries round one's code but its archive
  PR #166 spec sync STILL may be unmerged — same merge-order discipline as round one's digest).
- Windows flake = timeout, not assertion. Narrow pathspec commits; never `git add -A`;
  archive-time `git add rasen/changes/archive` needs `:(exclude)` on all `signals/` subdirs.

## Round-one digest index (all in the ARCHIVED parent planning-context)

The richest single file: `rasen/changes/archive/2026-08-17-canvas-gesture-ir-compiler/planning-context.md`
— contains every planner/implementer digest from round one (adjacency discipline, selection
pairing, re-stamped-ref rule, NUL-trap, grammar facts with citations). READ IT before proposing.

## Planner digest — child 1 propose (canvas-root-contract-editor)

- **PREMISE CORRECTION (LEAD notified 2026-08-17 before proposing):** the round-2 brief's
  "patchDefinitionContract is CALLED BY NOTHING / the root contract has NO editing
  affordance" is not the tree at fb243e83. `DefinitionContractPanel` renders with
  `definition={draft}` (the ROOT) at PipelineCanvasPage.tsx:2808-2816 in EVERY v2 edit
  session (left column, beside DeclarationsPanel; wiring dates to d638f87d, ECP-2 era),
  and pipeline-canvas-page.test.tsx:1256-1289 drives it through the exact
  start-assembling flow. Child 1 was therefore reframed from "build the missing surface"
  to "make the existing surface reachable and fix the degenerate pickers" — same user
  intent, same acceptance scenario, same hard constraints. Implementer/reviewer briefs for
  child 1 must use the reframed scope.
- **SINGLE-HOME VERDICT (binding for children 2/3):** the definition contract panel is the
  single home for DECLARING outcomes. Rule of thumb adopted: **write where blocked, point
  where visible**. The loop review is a modal whose overlay covers the contract panel, so
  it alone gains a thin inline declare (only while the contract is empty) through the new
  model helper `declareDefinitionOutcome` (draft.ts; the sole rule site stays
  `updateDefinitionContracts`). The sink endpoint offer sits beside the visible panel, so
  it gets a locate-and-focus pointer, no write. Any FUTURE picker over `def.outcomes`
  (children 2/3 included): read-only over the contract; pointer when the panel is visible;
  inline declare only inside a blocking modal; always via `declareDefinitionOutcome`,
  never a local append.
- **Fresh-definition trap class:** `createBlankCanvasPipelineDefinitionV2` seeds
  `outcomes: []` (draft.ts:90), so every select over `def.outcomes` is degenerate on a new
  draft: loop-review exit (empty select; its `definitionOutcomes` was an open-time
  STALE snapshot at PipelineCanvasPage.tsx:1363/2746 — child 1 fixes to live read,
  matching the parallel review at :2764); sink promotion (empty select + disabled
  confirm); and the parallel review's proceed/failed selects
  (V2ParallelReviewPanel.tsx:85-89/179/200) default to 'done'/'failed' with ZERO options —
  confirm submits UNDECLARED outcomes and re-trips the same PORT_MISMATCH. The parallel
  review is child-4 territory and deliberately untouched; if a later child touches it,
  fix via the same declare helper.
- **Engine facts:** `resolveGraphTerminalOutcomes` (definition.ts:2952) is NOT exported —
  the UI cannot structurally recompute undeclared outcomes without duplicating a frozen
  engine rule, and parsing validator prose is banned; so no affordance derives "the
  outcome this issue names" — the author types it. Issue click on
  `/root/nodes/<i>/capability` maps to kind 'node' (definitionIssuePathTarget), which is
  why the PORT_MISMATCH navigation dead-ended at the node panel.
- **Spec base:** the tree's pipelines-ui spec at fb243e83 ALREADY carries all round-one
  child requirements (in-branch archives 3240b0c7 / f66666d9 / 38d2ad8b) — the round-2
  caution about the unmerged PR #166 sync concerns dev/0.2.0-side merge order only.
  Child 1's delta is ADDED-only (1 requirement, 6 scenarios), no em-dashes in requirement
  prose, validate green. Children 2/3: keep ADDED-only while merge order is open.
- **Validation refresh fact:** issues do NOT auto-refresh after edits — only explicit
  Validate (handleValidate, PipelineCanvasPage.tsx:724). The acceptance scenario is pinned
  as declare -> Validate -> cleared; debounced auto-revalidate recorded as an explicit
  non-goal. Also: DefinitionContractPanel's outcomes input was a per-keystroke FULL draft
  patch (recomputeFlow per keystroke); child 1 moves it to NameListField commit-on-blur,
  so the page-test pattern for `definition-outcomes` changes to focus/blur (mirror the
  declaration-outcomes test at pipeline-canvas-page.test.tsx:1309-1317).

## Planner digest — child 2 propose (canvas-durable-node-positioning)

- **WHERE POSITIONS LIVE (for child 3 and any later slice):** the placement rule is in
  `layout.ts` — `layoutGraph(nodes, edges, authorPositions?)` applies a cached
  `{ x, y }` by node id after the dagre pass, and a pure `pruneAuthorPositions(positions,
  presentStageIds)` keeps the cache keyed to the CURRENT root graph. The cache itself is
  a page ref (`Map<nodeId, {x,y}>`), captured in `onNodesChange` on the drag-final change
  (`type === 'position'` with `dragging === false`, v2 only), reset in `enterEditWith`,
  cleared by `relayout()`. NOTHING else may write node positions: panels and gesture
  handlers still only mutate the draft; a new node never gets a placement unless the
  author drags it. Child 3's palette work must not introduce its own position writes —
  if palette drag-and-drop placement is ever wanted, it should WRITE THE CACHE through
  the same seam (add with computed layout, then seed the cache entry), not a parallel
  mechanism.
- **INVALIDATION RULE (binding):** `recomputeFlow` applies the cache, re-stamps the
  selection-carry (byte-identical, preserved), then PRUNES the cache to the rebuilt
  stage-node ids. Consequences all deliberate: deletion drops placement; extraction
  moves body nodes into a declaration so their placements are pruned and the replacing
  CompositeRef lays out afresh; delete-then-re-add under a reused id yields a LAYOUT
  position (no resurrection). RENAME carries the placement to the new id
  (`renameSelectedV2Node` moves the cache entry BEFORE recomputeFlow — v2 rename changes
  the node id via `renameV2Node`; without the carry, renaming teleports the node to its
  dagre spot).
- **Mechanism facts (cite-ready, verified at child-2 propose):** drags already reach the
  page — edit mode passes `onNodesChange` (PipelineCanvasPage.tsx:1042-1061) and React
  Flow emits `position` changes (final one `dragging === false`); positions are discarded
  only because `recomputeFlow` (:531-561) re-runs `layoutGraph` over EVERY node per
  mutation. v2 nodes are draggable per-node (`draftToGraph` sets `draggable:
  safelyEditable`, layout.ts:558); v1 stage nodes get `draggable: true` only in
  recomputeFlow's map (:537-540). Scope is v2-ONLY: v1 `parallelGroup` subflow children
  use parent-relative positions + `extent: 'parent'` (layout.ts:652-671), a different
  coordinate contract; v1 keeps today's behavior.
- **TEST SEAM:** the shared ReactFlow mock (pipeline-canvas-page.test.tsx:54-413) models
  only `select`/`remove`; `applyNodeChanges` (:385-398) DROPS `position` changes today —
  child 2 teaches it the `position` change type + a drag trigger + a positions dump
  testid (one trigger per concern, same pattern as the box-select/selection triggers).
  Later children testing drag interactions reuse that trigger, do not add another seam.
- **Non-goals recorded:** palette DnD placement of NEW v2 nodes (the v1-only
  `onDropStage` path stays v1-only, CanvasFlow:3111-3119), cross-reload/saved placement
  (Save defect untouched), full incremental layout for undragged neighbors (dagre
  re-layouts everything each rebuild — an undragged node CAN shift when the graph grows;
  spec states undragged elements always lay out afresh), fitView changes. Baseline for
  child 2: 67 files / 866 tests (child-1 close). Delta ADDED-only ("The canvas keeps the
  author's node placement", 6 scenarios), no em-dashes, validate green.

## Planner digest — child 3 propose (canvas-palette-grouping — LAST child; includes round-2 assembly notes)

- **KIND-METADATA ANSWER (the premise check):** the catalog payload LACKS kind
  (`PipelineCatalogSkill` = id/description/enabled/capability?, wire-types.ts:294-310)
  but the SOURCE has it — `WorkflowDefinition.kind: 'task'|'driver'|'internal'|'expert'`
  (workflow-registry/types.ts:13,49), built-ins default 'task' (builtins.ts:214),
  drivers = auto-command + goal-command, internals = retain-command / review-fix /
  goal-plan / goal-iterate / goal-judge / goal-report / task-loop, experts unified into
  the same catalog (experts.ts:71). `handlePipelineCatalog`
  (management-api/pipelines.ts:757-776) DROPS it. Child 3 adds a pass-through optional
  `kind` on the wire (server + UI types) — NO detection, NO name sniffing. NOTE for
  reviewers: child 3 legitimately touches `src/core/management-api/` (NOT frozen; only
  `src/core/pipeline-registry/` is).
- **CORE-STAGES CONSTANT'S HOME:** `CORE_PALETTE_SKILL_IDS` in draft.ts — the five
  PALETTE skill ids in pipeline order: 'rasen-propose', 'rasen-apply-change',
  'rasen-review-cycle', 'rasen-ship', 'rasen-archive-change' (exact template names,
  verified at templates/workflows/{propose:12, apply-change:12, review-cycle:160,
  ship:278, archive-change:13}.ts). NOT server-side CORE_WORKFLOW_IDS (builtins.ts:40) —
  that list is WORKFLOW ids ('propose','apply'...), a different namespace from palette
  skill ids; coupling them would need an id translation nobody else has. Grouping rule
  = `groupPaletteSkills` pure helper in draft.ts: sections core / workflows (task+driver)
  / experts / internal, stable input order within each, absent kind -> workflows, absent
  core id renders nothing. Both palette branches (v1 cards + v2 Stage expansion) render
  the same model; isBindableSkill untouched; internals GROUPED not hidden (no capability
  hole); child 2's placement cache untouched (no position writes, nothing foreclosed).
- **ROUND-2 ASSEMBLY NOTES (for the parent PR body, one line per child):**
  - **1 canvas-root-contract-editor** (ship 4de74cdd, archive 8679c6aa, tests 67/866) —
    the root outcome contract became reachable at the moment of need: outcomes list-field
    commit-on-blur, sink-offer locate pointer, loop-review inline declare via
    declareDefinitionOutcome, live loop-review outcome read; premise correction (the
    panel already existed) recorded in this file.
  - **2 canvas-durable-node-positioning** (ship 7677ff77, archive 04ebc38b, tests
    67/880) — dragged node placement survives subsequent mutations in a v2 edit session
    (drag-final capture + layoutGraph authorPositions + prune-to-current-graph +
    rename-carry; Re-layout is the explicit reset; placement never enters the payload).
  - **3 canvas-palette-grouping** (this propose) — the palette groups by workflow kind:
    core five first in pipeline order, experts in their own distinct section, workflows
    and internals in stable own sections, both palette branches, kind via catalog-wire
    pass-through (no inference).
  - User-request mapping for the PR body: request 1/2 (ECP review-cycle authoring +
    teacher optional wiring + PORT_MISMATCH unblock) -> child 1 (plus its documented
    guidance); request 3 (durable dragged positions) -> child 2; request 4 (palette
    grouping) -> child 3.
  - Standing posture (all three): IR frozen (zero diff under src/core/pipeline-registry
    since fb243e83), ADDED-only deltas throughout, no legacyRuntimeOwner, baseline grew
    854 -> 866 -> 880 -> (child-3 gate will cite the new count), teacher optional-branch
    guidance documented (not coded).
