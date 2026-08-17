# Design: canvas-parallel-frontier-inference

## Context

The IR grammar for a frontier (all sites verified at the current base): `WireFanOutNode` —
`branches: string[]`, `members: Array<{ id, hierarchicalPath, required, condition }>`,
`joinNodeId` (`packages/ui/src/api/types.ts:1440-1453`); `WireJoinNode` — `inputs`,
`requiredMembers`, `optionalMembers`, `outcomes: { proceed, failed }` (`:1455-1461`). The
drawn-edges equivalent in an authored v2 draft is the plain-connection sandwich:
S→m1, S→m2, …, m1→T, m2→T, … over root connections. `createParallelPair`
(`draft.ts:972-1037`) already validates and builds BOTH nodes as one transaction (members
must be root `AtomicStage`s, cap/budget positive, required ⊆ members, required defaults to
ALL members) — but it creates NO connections; `addParallelFrontier` (`:849`) is the unwired
palette gesture over every root stage. The rendered handle vocabulary the synthesized edges
must target (`layout.ts`): FanOut input `CONTROL_TARGET_PORT` ('input'), one output per
branch named by the member id; Join inputs named by member id, outputs from the outcomes
values. Selection writes must use the `recomputeFlow` selectionOverride pairing
(`PipelineCanvasPage.tsx:330-341`); the toast slot is the existing text-only surface.

Children 2/3 established the review-step pattern this change reuses; child 3's
`backedgeRegion`/`buildAdjacency` discipline (one adjacency builder, cited in the child-3
planner digest) is what the detector builds on; the boxselect-fix digest's probe-driver
corollary governs the browser gate.

## Goals / Non-Goals

**Goals:**

- Detect the fan-out/reconverge sandwich with a strict clean-branch rule; offer at the moment
  a drawn connection completes the shape; review; confirm synthesizes via
  `createParallelPair`-shaped machinery that consumes the drawn branch edges.
- The offer is non-blocking and cancellable with zero draft change (the edges are legal).
- The synthesized pair is indistinguishable from an explicitly authored one (same node shape,
  editable via the existing pair panels); the palette gesture is untouched.
- `legacyRuntimeOwner` never stamped; dual-layer guards.

**Non-Goals:**

- Sink/finish inference (child 5).
- Nested frontiers (a frontier whose source or target is itself a fan-out/barrier — the
  detector omits those shapes rather than reasoning about them).
- Frontiers with non-`AtomicStage` branches (the pair grammar itself requires root
  AtomicStage members — `createParallelPair:990-995`).
- Migrating branch stages' other connections (a branch with extra edges is simply not clean —
  excluded, not repaired).
- v1 editor; canvas Save persistence defect.

## Decisions

### D1. Detection: the clean-branch sandwich over the one adjacency builder

`detectParallelFrontiers(def)` (pure, `draft.ts`): for each ordered pair (S, T), S ≠ T, both
editable kinds and neither a FanOut nor Join, the branch set is
`{m | S→m ∈ conns ∧ m→T ∈ conns ∧ in(m) = {S} ∧ out(m) = {T} ∧ m is an AtomicStage}` — a
member's ONLY incoming edge is from S and its ONLY outgoing edge is to T. A frontier exists
iff |branches| ≥ 2. Strictness is the honesty rule: `FanOut.members`/`Join.inputs` semantics
presume the pair dispatches every branch and the barrier collects them; a branch with other
edges is not that shape, so it is excluded (not repaired). The offer surfaces via
`completedFrontier(def, connection)` — detection over the post-connect draft filtered to
frontiers whose branch-edge set contains the just-drawn connection; computed only in v2 edit
mode after a successful connect (cheap: one pass over root.connections).

Why non-blocking offer rather than child-3's modal-at-refusal: the completing edge here is
LEGAL — there is no refusal to justify interrupting the author, so the offer rides the toast
surface with an optional action button ("Run in parallel") instead of a modal. Dismissal
(timeout or next action) is a complete outcome.

### D2. Synthesis: compose `createParallelPair`, consume the drawn sandwich

`synthesizeParallelFrontier(def, input) -> { next, fanOutId, joinId }`, input =
`{ source, target, members: Array<{ id, required }>, concurrencyCap, budget, outcomes }`:

1. Re-detect from `(source, target)` on the live draft and re-check cleanliness and kinds
   (the review is not trusted — child-2/3's rule).
2. Remove every drawn `S→m` and `m→T` connection (the consumption rule: none survive
   alongside the pair; the removed connection objects' extension fields die with them —
   these are the author's transient plain edges, not extracted content, mirroring how the
   back-edge died at draw time in child 3).
3. `createParallelPair(def2, { fanOutId: v2NodeIdFor('FanOut', def2), joinId:
   v2NodeIdFor('Join', def2), memberNodeIds, requiredMemberIds, concurrencyCap, budget,
   outcomes })` — its own validators (member kind, cap/budget positivity, required ⊆
   members) are the model's refusal surface, reused verbatim.
4. Add the wiring on the rendered handle ids via the `addV2Connection`/`v2ConnectionIdFor`
   convention: `S@drawnSourcePort → FanOut@input`; per member `FanOut@<memberId> →
   m@input` and `m@done → Join@<memberId>`; `Join@<outcomes.proceed> → T@input`. No cycle
   is possible (the pair is newly minted between S and T's existing downstream relationship).
5. Return the ids; the page selects the FanOut through `recomputeFlow`'s selectionOverride
   pairing (both truths in one tick).

### D3. Review UI: the established pattern, membership-centric

`V2ParallelReviewPanel.tsx` (child-2/3 review pattern: modal overlay, model-owned validation
surfaced in-dialog, edits survive an error, integer fields under the
authoring-draft-errors discipline): read-only source/target line ("S → fan-out → N branches
→ barrier → T"), the branch list with required-vs-optional toggles (default all required —
`createParallelPair`'s own default), cap and budget integer fields (defaults mirroring
`addParallelFrontier`: cap `max(1, min(3, N))`, budget `max(1, N)`), proceed/failed outcome
selects over `def.outcomes` (defaults `def.outcomes[0]`/`def.outcomes[1]`). Refusals (from
re-detection at open) render in place of Confirm. The toast action opens it; Cancel closes
with zero draft change.

### D4. Toast slot gains an optional action

The existing toast (`PipelineCanvasPage`'s `showToast`) stays text-only for every current
caller; add an optional `action` (`{ label, onClick }`) that renders a button inside the
toast and suppresses auto-dismiss while present (a toast with an action is a question, not a
notification). The completing-connect hook calls it with the frontier summary as the text.
One surface, no new banner machinery.

### D5. No capability holes; no stamps; spec ADDED-only

`addParallelFrontier`, `createParallelPair`, the pair property editors
(`setParallelMembers`/`updateParallelContract`/`updateParallelMember`), and the
declarations-row insert are untouched. The synthesized nodes come from `createParallelPair`
(which stamps nothing) and the connections from `addV2Connection`; dual-layer
`not.toHaveProperty` guards (model + POSTed definition) like children 2/3. Spec delta is one
ADDED requirement — merge-order agnostic per the standing digest rule.

### D6. Test strategy

- Model unit tests: detection (clean sandwich found; two-branch minimum; side-branch
  excluded from membership AND from the offer when it drops below two; non-AtomicStage branch
  excluded; S or T already a pair → no frontier; self/target adjacency sanity), synthesis
  (drawn sandwich consumed — none of S→m/m→T survives; the four wiring families with exact
  endpoint/port ids; metadata follows the review; createParallelPair's refusal strings
  surface verbatim; `legacyRuntimeOwner` absent on every node in `next`), and the
  pair-remains-authorable check (edit membership via `setParallelMembers` on the result).
- Component tests (existing triggers — the mock's connect path for the completing edge, no
  new seam): the offer appears only on completion (not on the first branch edge);
  dismiss leaves the draft unchanged; review toggles/caps land in the POSTed definition;
  confirm leaves the fan-out selected with its panel open; the palette gesture still works;
  POST-body `legacyRuntimeOwner` guard.
- Real browser (throwaway CDP, `--window-size=1600,1000`, fresh port — 9333-9340 used; build
  then serve; close the selection panel before handle drags, focus-before-blur, re-fit-view
  per drag): author S→b1→T and then draw S→b2 and b2→T — the completing edge surfaces the
  offer; open the review, flip one branch optional, confirm; assert the drawn sandwich gone,
  the pair + four wiring families present, fan-out selected; the gesture path still works.
- Suite: CI-canonical `pnpm --dir packages/ui exec vitest run`, counts cited against
  67 files / 815 tests.

## Risks / Trade-offs

- [Offer noise on every completing edge of an incidental diamond] → the strict clean-branch
  rule plus the two-branch minimum mean only true sandwiches qualify; dismissal is free and
  the offer re-appears only when a NEW connection completes a frontier again.
- [Consuming the author's drawn edges loses extension fields they carried] → scoped and
  stated (D2.2): the sandwich edges are transient control wiring the pair replaces; anything
  load-bearing should not have been a branch edge. The spec pins non-survival explicitly.
- [Port-id drift between synthesis and rendering] → the wiring uses the rendered handle ids
  from `layout.ts` (member-id-named dispatch and barrier inputs); model tests pin exact ids,
  the same discipline that caught nothing-but-truth in children 2/3.
- [Toast-with-action interacts with `markDraftChanged` clears] → the offer is computed at
  connect time and carries its (S, T) as data; a stale offer opening the review re-detects at
  open and refuses cleanly if the draft moved under it.
- [Windows flakiness] → isolate, re-run settled, never pipe through `tail`.

## Migration Plan

Single change, single PR: detector + synthesis + model tests first, then toast action + review
UI + component tests, then the browser gate. Rollback is the PR revert; the persisted effect
is ordinary authored v2 content (a FanOut/Join pair) the engine already accepts. Ship
`local`; the parent delivers after all children.

## Open Questions

- Should the offer also surface from a multi-selection action (select the branches → "run in
  parallel")? Deferred — one entry point (the completing-connect offer) keeps the gesture
  chain simple; a selection entry can be added if users look for it.
- Condition-bearing members: the IR's `members[].condition` supports per-branch conditions;
  the review defaults all to `'always'` and leaves condition editing to the pair's existing
  property panel (where it already lives). Revisit only with user feedback.
