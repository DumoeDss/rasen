# Review report — canvas-loop-body-visibility (stage: verify)

Reviewer: reviewer3 (independent non-author; dispatched, report-only).
Target: uncommitted delta vs `59bfa9f8` under `packages/ui/` (7 modified +
`V2BodyStagePanel.tsx` + `test/style/canvas-frame.test.ts` new; +1324/-32).
Method: full read of change artifacts + child-3 planner digest, full-diff
review of all four source files and every test file, independent re-run of
all gates (suite, typecheck, validate).

Scope check: CLEAN. `packages/ui/src/canvas/draft.ts` has ZERO diff — the
model, synthesis defaults (child 2), and port derivation (child 1) are
untouched by construction; this is a pure rendering/wiring change as
proposed. `bin/rasen.js` = the known CRLF phantom (excluded per
constraint-sweep). Tasks 18/18 complete.

## Verdict

**0 Blocker / 0 Major / 1 Minor / 0 Trivial.** Ship-able.

Independent gates (all re-run by this reviewer, 2026-08-17):
- UI suite `pnpm --dir packages/ui exec vitest run` → **69 files / 927
  passed, exit 0** (baseline 912 + 15 new: 6 layout, 4 style pin, 5 page;
  +1 file). Single clean run, no flake isolation needed.
- Typecheck `tsc --noEmit` → **exactly 13 errors**: 8
  ConsultationBindingEditor, 1 IssuesDrawer, 2 pipeline-canvas-page casts,
  2 v2-node-panel-consultation — file-for-file child-2's pre-existing
  inventory; ZERO in this change's files.
- `rasen validate canvas-loop-body-visibility` → "valid".
- IR frozen: `git status --porcelain -- src/core/pipeline-registry/` empty;
  `git diff 59bfa9f8 -- src/core/pipeline-registry/` empty.

## Gate-by-gate

### 1. The two browser-found defect fixes — SOUND (no papering-over)

**(a) Node-identity churn / hidden body edges — the three-part fix:**
1. `wiredFlowNodes` is memoized on `[flowNodes, toggleFrameExpand,
   selectBodyStage]` with both callbacks `useCallback(..., [])` reading live
   state through `latestFlowInputsRef` (reassigned every render,
   `PipelineCanvasPage.tsx:660-666` region). Judgment on the LEAD's
   question — can the fix freeze STALE internals/data: NO. The callbacks
   read the ref at call time, so a chevron click after later mutations sees
   the CURRENT draft (the doc comment names exactly the
   freeze-against-rebuild-snapshot trap and the shape avoids it); identity
   churn stops (nodes-prop identity changes only on rebuild), so RF's
   `adoptUserNodes` re-initialization loop ends.
2. `recomputeFlow` carries `measured` by id across rebuilds
   (`measuredById`). This cannot freeze stale size: the carry only bridges
   re-adoption for persisting ids, and any actual element resize fires the
   ResizeObserver (an element whose size changed always re-delivers) — the
   no-fire hazard exists precisely and only when the size did NOT change,
   in which case the carried `measured` is still correct.
3. `CanvasFlow` forces one batched `useUpdateNodeInternals` when the node
   ID SET changes (`nodeIdKey` joined ids, effect on key change) —
   mount/add/remove/expand/collapse, exactly the moments elements appear or
   disappear. A frame resize from a body EDIT (ids unchanged, style size
   changed) is covered by the observer per (2). Composition is coherent;
   the browser gate proved the original failure mode dead at GATE 8 (the
   body edge renders on the first post-confirm commit).

**(b) Body-panel wipe race:** the guard clears `bodySelection` in
`onSelectionChange` ONLY for an incoming selection WITH CONTENT that
differs from the mirror (`PipelineCanvasPage.tsx:1296-1310` region) — the
body click's own `replaceSelection([])` re-fire (empty) no longer wipes the
panel one commit after opening. The LEAD's question — does a genuine
pane-click clear still work: YES, via the dedicated `onPaneClick`
(`setBodySelection(null); replaceSelection([])`), wired as
`onPaneClick={editable ? onPaneClick : undefined}` on the ReactFlow
element; the test mock sequences BOTH events as real RF does
(emitSelection(∅) then onPaneClick) and the test asserts the panel clears.
The race itself is pinned: the panel is asserted open immediately after the
body click that triggers the emptying re-fire. Other emptying paths are
benign (root-panel close can't coexist with an open body panel — mutual
exclusivity; deletion empties selection while `recomputeFlow`'s
frame/stage-present prune owns the panel's validity).

### 2. Collapsed-state byte-parity — PASS (pinned absolutely)

Layout test "a node without dimensions lays out exactly as today": geometry
deep-equal between omitted and explicit-default dimensions, plus no
`style` key for plain cards. "No expandedFrames arg (or an empty set)":
the no-arg projection has zero affordance data / dimensions / body nodes;
edit-mode-with-nothing-expanded's ONLY delta is the `frameToggle` flag on
exactly the loop + refs (the sanctioned chevron). Page test "collapsed
default parity": today's card assertions unchanged, `data-node-style`
"null", zero namespaced ids, and NO chevron when the declaration body is
empty. The parity claim is honored as specified (compact card + sanctioned
chevron affordance).

### 3. Payload cleanliness — PASS

Expansion lives in `expandedFramesRef` (page ref, reset in `enterEditWith`,
never written to any draft mutation; the toggle handler does ref write +
`recomputeFlow` with NO `markDraftChanged`). Body ids exist only in flow
space (`<frameId>::<bodyId>`). Pinned: the submitted definition's JSON
contains neither `::` nor `expandedFrame` (placement-survival test tail).
Placement cache: `pruneAuthorPositions` consumes `draftToGraph().nodes` —
the ROOT projection only (body children ride the separate `frameChildren`
map); the `onNodesChange` capture guard additionally skips any position
change under a non-root id (`!rootIds.has(change.id) continue`), pinned by
the rogue-drag test (layout position wins the next rebuild). Round-2
positions tests green in the suite.

### 4. Selection discipline — PASS

Body nodes are `selectable/draggable/connectable/deletable: false` by
construction (layout.ts, pinned) — `CanvasSelection` never sees a body id.
Body click: `stopPropagation` on the card (RF never selects the frame) +
`selectBodyStage` sets the scalar and `replaceSelection([])` in the same
tick (the round-1 pairing pattern). Mutual exclusivity pinned BOTH
directions (root click clears the panel; body click deselects the root),
pane click clears both, and the selection-pairing override survives with
children present (the existing pairing tests + the auto-expand test's
`data-selected` assertions). External handles untouched when expanded: the
frame card renders the same `inputPorts`/`outputPorts` handles; the
expand/collapse test captures ports + external edge ids before and
re-asserts byte-identical after each toggle, and the browser gate GATE 10
confirmed it live.

### 5. Subflow mechanics — PASS

- `parentId`/`extent: 'parent'`/parent-relative positions follow the v1
  group pattern already exercised in production against the installed
  @xyflow/react 12.11.2; frame emitted strictly before children (pinned by
  index assertions; `layoutGraph` splices children right after the frame).
- Second dagre pass: same constants (LR, nodesep 48, ranksep 90) over the
  declaration's node/connection order — deterministic per input; stateless
  re-derivation every rebuild.
- Frame sizing: body bounding box + GROUP_PADDING ×2 + GROUP_LABEL_HEIGHT,
  children pinned at exact insets (min x = GROUP_PADDING, min y =
  GROUP_PADDING + GROUP_LABEL_HEIGHT, max edges one padding from the far
  side); the CSS mirrors the same IMPORTED constants
  (`canvas-frame.test.ts` imports `GROUP_PADDING`/`GROUP_LABEL_HEIGHT` so
  geometry and CSS cannot drift — good pattern).
- The frame's box feeds the ROOT pass via per-node width/height — pinned
  (`frameStage.width > NODE_WIDTH`, style equals the box).

### 6. Test quality — PASS

All six spec-scenario families pinned: expand/collapse (both directions +
external contract byte-identical across toggles), moment-of-formation (all
THREE handlers: loop review, palette gesture `bounded-loop-2::…`, extract
confirm `composite-ref::…` + body edges), select-opens-panel (facts,
one-button, mutual exclusivity both ways, pane clear), body inertness
(end-to-end: clicks + rogue drag + toggles → submitted definition
deep-equal), payload-clean, collapsed parity. The namespaced-id collision
case (root id EQUAL to a body id) and the two-refs-one-declaration case
are both pinned at layout level. The export-mock change is exactly a
no-op `useUpdateNodeInternals` stand-in with an honest comment (jsdom
measures nothing); the file's real export flow is otherwise unmocked. The
pane-click mock now sequences deselect + onPaneClick like real RF — that
is what makes the wipe-race guard genuinely tested.

### 7. Independent gates — PASS

Counts cited above; both claims match exactly.

### 8. Invariants — PASS

IR frozen (both commands empty). `draft.ts` ZERO diff → child-1/2 surfaces
untouched by construction; `V2_BODY_PALETTE_KINDS` unchanged
(`['AtomicStage']`, draft.ts:829, no hunk). No `legacyRuntimeOwner` added
lines (grepped the diff). The only group-path change is the `export`
keyword on the two group constants (needed by the CSS pin; arithmetic
byte-identical; v1 group tests green in the suite). Delta is ADDED-only,
8 scenarios, zero em-dashes, SHALL on line one; `rasen validate` green.

## Findings

### Minor 1 — body EDGES are selectable (body nodes are not)

`declarationBodyFrame` (layout.ts) projects the body's internal edges
without `selectable: false` — only body NODES carry the inert flags — and
the canvas runs `elementsSelectable` with `edgesFocusable={editable}`
(`PipelineCanvasPage.tsx:3069-3070`). Failure scenario: the author clicks
a body edge inside an expanded frame; `onSelectionChange` receives a
non-empty selection holding `body:<frameId>:<connectionId>` which (a)
closes the open body panel (the guard treats it as a real selection) and
(b) parks a phantom id in the selection mirror. Traced end-to-end BENIGN:
`singletonConnectionId` → `draft.root.connections.find` → null → no
connection panel renders; Delete on it funnels into
`applyV2BatchRemoval`, which skips unknown ids (`if (!connection)
continue`) — a no-op on the draft; the visually-removed edge returns on
the next rebuild; the mirror entry is replaced by the next real selection.
So: no crash, no draft mutation, no spec violation (the delta pins STAGE
inertness, and stages are inert) — but it is a loose interaction thread
against the change's own "body interactions change nothing" spirit (the
panel close IS a change the author did not ask for). One-line fix
(`selectable: false` on the body-edge projection) belongs in a polish
pass; not worth a fix round on its own.

## Notes (verified-sound, no action)

- `frameToggle` data on collapsed loop/ref cards in edit mode is the
  sanctioned chevron affordance; the parity pins assert it is the ONLY
  collapsed data delta.
- The guard's `sameNodes`/`sameConnections` computation duplicates the one
  inside `setSelection` below it — micro-duplication, harmless.
- The browser gate's honest record of the two defects it caught (root
  causes + the three-part fix), the `bringToFront`/rAF trap, and the
  no-concurrent-vitest note are all faithful to the code as reviewed.
- `enterEditWith` resets both `expandedFramesRef` and `bodySelection`;
  view mode never passes expansion state (view uses `viewFlowNodes`).
