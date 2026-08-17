# Review report — canvas-parallel-frontier-inference (verify stage)

- Reviewer: reviewer-1 (verified children 1-3 and the boxselect fix; non-author for impl-6).
  Dispatched report-only mode: no fixes applied, no commits, no subagents, no working-tree edits.
- Date: 2026-08-17. Branch `feat/canvas-gesture-ir-compiler`, HEAD `3240b0c7`; review target =
  uncommitted working-tree delta vs HEAD over `packages/ui/` plus untracked
  `packages/ui/src/canvas/V2ParallelReviewPanel.tsx`.

## Verdict: FINDINGS — 0 Blocker, 0 Major, 1 Minor, 0 Trivial (ship-able; m1 routable)

## Independent test gate (mandatory)

- Command: `pnpm --dir packages/ui exec vitest run` from repo root, not piped.
- Result: **67 files / 838 tests, all passed, exit 0** — matches the claim exactly
  (baseline 67/815; +23 = 17 model + 6 component).
- Evidence sanity: `evidence/cdp-transcript.md` (25 checks, ALL PASSED), `cdp-results.json`,
  the driver, and 7 screenshots exist and are internally consistent (throwaway Chrome 151
  headless, fresh port 9341 + fresh profile, `--window-size=1600,1000`, chunk-hash provenance,
  tab-alive check).

## Scope check: CLEAN

Exactly the claimed touch set: `draft.ts` (+249, verified a SINGLE end-of-file append hunk
`@@ -3020,3 +3020,252 @@` — `addParallelFrontier`/`createParallelPair`/`setParallelMembers` live
before the hunk and are byte-untouched), `PipelineCanvasPage.tsx` (+236: toast action surface,
offer hook, review handlers), `style.css` (+11, toast-with-action styling only),
`V2ParallelReviewPanel.tsx` (new), two test files. IR frozen re-verified
(`git status --porcelain -- src/core/pipeline-registry/` empty); `V2_BODY_PALETTE_KINDS`
untouched (outside the append hunk).

## Adversarial gates

### 1. Closure audit (the self-disclosed defect class) — ref discipline COMPLETE; one residual timer issue (m1)

- The disclosed defect and fix verified: the toast action's `onClick` originally captured the
  render-time `openParallelReview`, whose closure held the PRE-connect `draft` — at click time
  re-detection ran against a draft missing the completing edge, so every review opened
  stale-refused. The fix routes through `openParallelReviewRef` (a render-time re-stamped
  latest-ref, `PipelineCanvasPage.tsx` — `openParallelReviewRef.current = openParallelReview`
  every render), so the click reaches the handler closing over the current draft.
- Full audit of the new surface's callbacks: the toast action is the ONLY long-lived callback
  (its auto-dismiss is suppressed), and it is the only one needing the ref; the review panel's
  `onConfirm`/`onCancel` are render-bound (re-bound each render to fresh closures); the toast's
  action/dismiss buttons read `toastAction` from the current render; no new effects. Two
  independent freshness layers back the ref: re-detection at open (`openParallelReview` refuses
  with "no longer a clean parallel frontier" when the draft moved under a sitting offer) and the
  model's re-detect + membership-drift refusal at confirm (`synthesizeParallelFrontier`).
- **Test discrimination of the original defect — CONFIRMED**: component test 3
  ("the review's toggles, cap, budget, and outcome picks land in the POSTed definition")
  completes the frontier via the mock connect, clicks the toast action, and asserts the review's
  prefilled route/member-required flags/cap/budget/outcomes — under the stale closure the review
  would open refused with empty branches and every one of those assertions fails. The stale-offer
  test (draw a dirtying edge while the offer sits, then click the action) pins the
  re-detection layer specifically, and the real-browser transcript exercises the full
  connect→toast-action→fresh-review path end to end.
- **m1 (Minor) — stale auto-dismiss timer can wipe a fresh offer toast.**
  `showToast(message)` arms `setTimeout(() => setToast(''), 2500)` for action-less toasts with
  NO stored handle and an unconditional callback (`PipelineCanvasPage.tsx`, showToast). If any
  notification toast fired within 2.5s before a completing connect (connect refusals, saves,
  deletes are all common during authoring), its still-armed timer clears the newly surfaced
  offer shortly after it appears — `{toast && …}` unmounts the whole offer. Concrete scenario:
  author draws a wrong edge (refusal toast at t=0), immediately draws the completing edge at
  t=1s → offer appears → at t=2.5s the old timer wipes it; the frontier is already complete so
  no future completing edge re-offers, and the author falls back to the palette gesture.
  Dismiss-changes-nothing still holds and nothing is lost from the draft — a UX loss of the new
  feature's entry point on a plausible path. Fix: clear the previous timer at the top of
  `showToast` (store the handle in a ref), or make the callback conditional on the message
  (`setToast((current) => (current === message ? '' : current))`).

### 2. Detection correctness — verified against the code, edge shapes included

- Same adjacency: `detectParallelFrontiers` derives its backward map FROM `buildAdjacency`'s
  forward map — one builder, no second reachability.
- Clean branch = `in(m) = {S}` AND `out(m) = {T}` via `setEquals` (exact-set equality),
  `S→m ∧ m→T` via the adjacency, member an `AtomicStage`, `m ∉ {S, T}`, both endpoints editable
  and neither a FanOut/Join, `S ≠ T`, ≥ 2 branches. Boundary shapes reasoned and/or pinned:
  - member with a second consumer or second feeder → excluded (model test);
  - source also targeting the target directly → S→T is not a phantom branch (`member !== target`)
    and survives synthesis alongside the pair (legal, unconsumed — matches the consumption rule
    as specified: only branch edges die);
  - nested/overlapping frontiers: an endpoint that is already a pair half is excluded by
    `eligible()` (design non-goal); two independent sandwiches sharing a node are detected
    independently and cannot be completed by one edge (in(m)/out(m) are singletons, so a
    completing edge matches at most one frontier — `completedFrontier`'s `.find` is safe);
  - a member inside a child-3 loop region cannot exist (region stages live in a declaration
    body, not the root); a BoundedLoop branch is excluded by the AtomicStage kind rule;
  - `completedFrontier` fires on the completing dispatch half (S→m) or barrier half (m→T) —
    pinned by both model and component tests (no offer on the first branch edge).
  - One stricter-than-wording case verified sound: a member with TWO edges from the same source
    is excluded (`setEquals` is length-exact) even though the spec's "from elsewhere" wording
    would not require it — the IR cannot encode duplicate dispatch (one FanOut output per member
    id), so exclusion is the only representable choice, and the direction is conservative
    (fewer offers, never a wrong one). Observation, not a finding.

### 3. Edge consumption and wiring — verified

`synthesizeParallelFrontier` removes every S→m and m→T connection for the detected branches
(never both surviving; pinned by model + component POST-body + browser assertions of the exact
six-edge wiring list), reads the drawn source port BEFORE the filter so S→FanOut preserves the
handle the author drew from (deterministic first-in-draft-order, pinned by a dedicated test),
mints the pair via `createParallelPair` with `v2NodeIdFor` ids against the post-consumption
state, and wires on the rendered handle ids (`fan-out:<memberId>`, `join:<memberId>`,
`join:<proceed>` — matching `layout.ts`'s member-id-named handles, browser-verified by the
rendered-handle checks). The fan-out is selected through the `setSelection` + `recomputeFlow`
override pairing (both truths in one tick; component test asserts `data-selected` with the
listener stand-in live). No cycle is possible (the pair preserves existing reachability).

### 4. Non-blocking offer — verified

The dismiss button only calls `clearToast` (no draft touch); the offer fires exactly when a
connection completes the shape (post-connect `completedFrontier`, node-level ports-agnostic);
component test 2 pins dismissal leaves every drawn connection; the stale-offer test pins cancel
after a dirtying edge preserves everything.

### 5. Invariants

`createParallelPair`/`addV2Connection` stamp nothing; dual-layer guards discriminate (model
walks every node in `next`; the component POST-body walk asserts `not.toHaveProperty` over the
submitted definition). The explicit Parallel gesture is untouched (outside the append hunk;
re-exercised in suite + browser). IR frozen; `V2_BODY_PALETTE_KINDS` unchanged.

### 6. Test quality

All seven spec scenarios pinned (offer-at-completion + dismissal; two-branch minimum; shared
branch excluded; review contract lands in the POSTed definition; consumption + four wiring
families + fan-out selected; pair editable + gesture works; content verbatim + no ownership
metadata). Model tests additionally pin refusal strings verbatim, stale/membership-drift
refusals, non-colliding id minting beside an existing pair, and the drawn-source-port
preservation. Regression lens on children 1-3: no existing behavior is modified — the connect
path gains only a post-success detection; the toast surface is backward-compatible (existing
callers keep auto-dismiss); the full suite (including all prior children's tests) is green.

## Counts

- Blocker: 0 · Major: 0 · Minor: 1 (m1) · Trivial: 0
- Standards axis worst: m1 (Minor). Spec axis: no failing items — all seven scenarios delivered
  and pinned.
- Test gate: 67 files / 838 tests, exit 0 — independently reproduced.
