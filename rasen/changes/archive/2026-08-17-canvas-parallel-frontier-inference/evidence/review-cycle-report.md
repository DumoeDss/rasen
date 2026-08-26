# Review-cycle report — canvas-parallel-frontier-inference

## Round 1 (m1 fix re-review)

- Re-reviewer: reviewer-1 (author of the round-0 findings; fixer is impl-6 — non-author status
  holds). Dispatched report-only: no fixes, no commits, no subagents, no working-tree edits.
- Scope per dispatch: the m1 delta only. Round-0 full findings live in `review-report.md`
  (0 Blocker / 0 Major / 1 Minor / 0 Trivial — m1 was the only finding).

### m1 — a notification toast's pending auto-dismiss wiped a freshly surfaced offer: RESOLVED

- Fix verified in the working tree (`PipelineCanvasPage.tsx:591-620`): one stored handle
  `toastTimerRef`; `showToast` clears any previous timer BEFORE arming the new one (newest-wins
  — exactly my scoped failure mode: the rejection/refusal/saving toast's pending clear can no
  longer fire against a later toast); `clearToast` clears the handle too; the action path still
  returns before arming (an offer never auto-dismisses); the fired callback nulls the handle so
  no stale handle lingers for a later `clearTimeout`. The timer race is closed with minimal
  surface: every existing text-only caller keeps the same 2.5s auto-dismiss against its own
  timer.
- Pinning test verified (`pipeline-canvas-page.test.tsx:6438`, "a notification toast inside its
  2.5s window cannot wipe a freshly surfaced offer"): fires a real rejection toast (refused
  cycle draw + loop-review cancel), completes the frontier INSIDE that toast's window, waits
  2700ms (crossing the first timer's deadline), and asserts the offer toast and its
  "Run in parallel" action survive. Discrimination holds analytically — pre-fix, the pending
  `setToast('')` fires at the 2.5s mark and unmounts the offer, failing the `not.toBeNull()`
  assertion — and the fixer RED-CHECKED it (pre-fix body restored → test fails; documented in
  `fix-round-1.md`). No slow-CI flake risk: if the completing connect ever lands after T1
  already fired, both pre- and post-fix behavior is the notification expiring normally and the
  test still passes.
- Unmount judgment (per dispatch): there is no useEffect cleanup clearing `toastTimerRef` on
  unmount — judged immaterial here. The pending callback only calls `setToast('')`, a silent
  no-op on an unmounted Preact component (no DOM access, no warning, one-shot then GC); there
  is no interval or recurring work. Not a leak in any observable sense; not a finding.
- Blast radius: nothing else moved. `draft.ts` (+249) and `style.css` (+11) diff-stat vs base
  are byte-identical to the state I reviewed in the verify pass;
  `V2ParallelReviewPanel.tsx` remains untracked and contains zero timer code. The browser
  re-run waiver is sound — the fix changes no selector/testid/wiring, only timing, and the
  pinning test carries the discriminating proof.

### Gate

- Focused file re-run by this reviewer: `test/canvas/pipeline-canvas-page.test.tsx`
  **114/114 passed, exit 0** (113 round-0 tests + 1 new pin). Full-suite 67 files / 839
  exit 0 already run by the fixer on this exact tree state; not re-run per dispatch.

### Overall round-1 verdict: CLEAN

m1 resolved with the exact scoped fix (stored handle, newest-wins, action-path untouched),
a red-checked discriminating pin, and zero collateral movement. Child 4 is ready for ship.
