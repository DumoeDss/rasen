# Handoff — implementer-1, canvas-parallel-frontier-inference (apply + review round 1 m1)

## Status: COMPLETE — 10/10 apply tasks ticked; m1 fixed; stood down

- Change: `canvas-parallel-frontier-inference` (child 4 of
  `canvas-gesture-ir-compiler`), stage apply of pipeline small-feature,
  plus review round 1 fix m1.
- Worktree: `feat/canvas-gesture-ir-compiler` @ HEAD `3240b0c7`, **no
  commits made** (ship owns them). Working-tree delta:
  `packages/ui/src/canvas/{draft.ts,PipelineCanvasPage.tsx}` and
  `packages/ui/src/style.css` modified,
  `packages/ui/src/canvas/V2ParallelReviewPanel.tsx` new,
  `packages/ui/test/canvas/{draft.test.ts,pipeline-canvas-page.test.tsx}`
  modified, plus `rasen/changes/canvas-parallel-frontier-inference/`.
- Tests: full UI suite **67 files / 839 tests, exit 0** via the CI-canonical
  `pnpm --dir packages/ui exec vitest run` (baseline 67/815; +24 = 23 apply
  tests [17 model + 6 component] + 1 m1 pin; 838 after apply, 839 after m1).
  tsc: only the three pre-existing failing files
  (ConsultationBindingEditor / IssuesDrawer / v2-node-panel-consultation
  test) — untouched by this change.
- Real browser: **ALL 25 CHECKS PASSED** first run —
  `evidence/cdp-transcript.md`, `evidence/cdp-results.json`, rerunnable
  driver `evidence/cdp-parallel-frontier-check.mjs`, 7 screenshots.
- Gates: `evidence/gates-4-2.md` — registry diff empty vs `864f45b9`
  (committed AND working tree AND untracked), `V2_BODY_PALETTE_KINDS` still
  `['AtomicStage']` (draft.ts:736), `draft.ts`'s only diff hunk is a
  +252/-0 end-of-file append so `addParallelFrontier`/`createParallelPair`/
  `setParallelMembers` are byte-outside the diff.
- m1: `evidence/fix-round-1.md` — the toast-timer wipe, fixed via
  `toastTimerRef`, pin red-checked.

## Decisions a successor must know (esp. child 5 — sink-finish-inference)

1. **The new model surface** (all in `draft.ts`, appended after
   `synthesizeBoundedLoopFromBackedge`): `detectParallelFrontiers(def)` —
   clean-branch sandwich per design D1, branches in DRAFT NODE ORDER,
   S/T must be editable kinds but not FanOut/Join (a Finish target is
   legal and tested); `completedFrontier(def, {source, target})` — node-level
   only, fires for EITHER the S→m or the m→T completing half;
   `synthesizeParallelFrontier(def, input)` — re-detects and requires the
   reviewed member set to EXACTLY match the re-detected branches (a drifted
   membership refuses; a drifted draft refuses with "no longer a clean
   fan-out and reconverge shape").
2. **The drawn source port rule**: the S→FanOut edge preserves the port of
   the FIRST drawn S→m connection in draft-connection order
   (`drawnSourcePort`, read BEFORE the consumption filter). With
   heterogeneous drawn handles that is the deterministic choice; member
   edges always use the conventional `input`/`done` control ports per
   design D2. Component fixtures: a `skill:rasen-apply` stage's first
   output port is the `patch` artifact, so trigger-drawn edges carry
   `patch` while pre-authored fixture edges carrying `done` WIN the
   first-drawn race — assert `source:done->fan-out:input` there.
3. **A toast action is a QUESTION and outlives its creating render** (design
   D4 + m1): two guards are load-bearing and tested —
   `openParallelReviewRef` (re-stamped every render; the action's onClick
   must reach the latest handler closing over the CURRENT draft, or every
   review opens stale-refused) and `toastTimerRef` (the only live
   auto-dismiss handle; cleared at the top of `showToast` and in
   `clearToast`). The offer toast also carries a dismiss `×` button
   (`pipeline-canvas-toast-dismiss`) — the completion of "dismissing
   changes nothing" that the artifacts require as a first-class outcome.
4. **The review panel** (`V2ParallelReviewPanel.tsx`, child-2/3 pattern):
   cap/budget integer scopes `parallel-review:concurrencyCap` /
   `parallel-review:budget`, cleared on close; refusals (re-detection at
   open) hide Confirm; defaults mirror `addParallelFrontier` exactly
   (cap `max(1, min(3, N))`, budget `max(1, N)`, proceed `outcomes[0] ?? 'done'`,
   failed `outcomes[1] ?? 'failed'`).
5. **Component-test triggers need no new seam**: `mock-connect-production-atomics`
   (first→second AtomicStage, from the first rendered output handle) drew
   both the completing and the first-branch edge depending on fixture
   wiring; `mock-connect-backedge-inner` (last→second) dirtied a branch for
   the stale-offer path; a SECOND mount inside one test needs
   `render(null, container)` FIRST or `pipeline-canvas-edit` is null
   (matching the file's existing remount helper pattern).
6. **Child-5 relevant CDP facts**: ports 9333-9341 are now all used by this
   portfolio's checks — take 9342+; app port used 4550; Chrome 151
   `C:\Program Files\Google\Chrome\Application\chrome.exe` headless with
   `--window-size=1600,1000` and a fresh `--user-data-dir` worked first
   try; the child-3 driver's helpers (connectWithRetry with fit-view +
   elementFromPoint reachability + landed check, close the selection
   summary before drags, focus-before-blur on inputs) remain the complete
   recipe. SPACE_ID `e2ee72ed-04a1-4395-86aa-7e77d2b83ec7` still resolves.

## Eliminated hypotheses (debugging record)

- **"The review opens with 0 branches / refusals"** was NOT a detection bug
  and NOT a fixture problem: the toast action's `openParallelReview`
  closure captured the PRE-connect `draft` (the render `onConnect` was
  created in), so re-detection at open always saw the sandwich minus its
  completing edge. Fixed with the re-stamped `openParallelReviewRef`; the
  panel then prefilled correctly with zero test-side changes.
- **"The palette gesture button is null after confirm"** was NOT a
  capability hole or a disabled gesture: the test mounted a second fixture
  into the same container without `render(null, container)`, so the edit
  button never rendered. Same root cause as the first test's remount
  failure; not a page defect.
- **"The synthesized S→FanOut edge used the wrong port"** was NOT a synthesis
  bug: the drawn-port rule (first S→m in draft order) picked the
  pre-authored `done` edge over the trigger-drawn `patch` edge by design;
  the expectation was wrong, the code was right.
- **m1 (reviewer-found)**: the pre-existing un-cleared `setTimeout(() =>
  setToast(''), 2500)` was "not mine to fix" during apply — WRONG call in
  context: the new offer surface interacts with it (a notification within
  the window silently deleted an offer nothing re-offers), which makes it
  this change's defect. Pin red-checked both directions (pre-fix body fails
  `expected null not to be null`; fixed body passes).
- Windows flakiness: none this change; every red run was a real expectation
  slip or the two real defects above.

## Environment notes for reruns

- Build before serving: `pnpm --dir packages/ui run build` (this round's
  chunk `PipelineCanvasPage-BLQjnmM9.js`, verified to contain the new
  strings). Serve `node bin/rasen.js ui --no-open --no-daemon --port <p>`;
  token from the stdout URL; throwaway Chrome + profile killed and removed
  after the run; server stopped.
- Full-suite scratch roots (`.rasen-e2e-*`, `.rasen-pipeline-command-*`,
  `test-pipeline-e2e-ackloss-tmp`) sit untracked in the worktree root from
  earlier children; ship must not include them in any pathspec.

## Next action for the successor

Stage per pipeline order: **verify** (rasen-verify-change — artifacts vs
implementation: proposal/design/tasks/spec delta vs the working tree, the
+23-test story, gates), then ship with narrow pathspecs (five modified
files + `V2ParallelReviewPanel.tsx` + `rasen/changes/canvas-parallel-frontier-inference/`),
then archive. Child 5 (`canvas-sink-finish-inference`) starts after this
child ships — its detection should reuse the same `buildAdjacency`
discipline and can lean on the toast-with-action surface if its offer is
also non-blocking.
