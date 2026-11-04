# Review round 1 — fix log — canvas-parallel-frontier-inference

## m1 — a notification toast's pending auto-dismiss wiped a freshly surfaced offer

**Reviewer finding (reviewer-1):** `showToast` armed
`setTimeout(() => setToast(''), 2500)` with no stored handle and an
unconditional callback. Any plain notification toast fired within 2.5s
before a completing connect (refusals, saves, deletes — all common) left a
pending clear that erased the just-surfaced "Run in parallel" offer shortly
after it appeared; the completed frontier never re-offers, so the offer was
silently lost.

**Fix** (`packages/ui/src/canvas/PipelineCanvasPage.tsx`): one stored timer
handle (`toastTimerRef`, cleared at the top of `showToast` before arming the
new one, and in `clearToast`). Exactly the newest toast's clear can ever
run; an action toast still never arms a timer. No other behavior changes —
every existing text-only caller keeps the same 2.5s auto-dismiss against its
own timer, and successive notifications now replace each other's timers
instead of the earlier one clobbering the later one mid-window.

**Pinning test** (`pipeline-canvas-page.test.tsx`, parallel-frontier
describe): fire the refused cycle-closing draw (`mock-connect-backedge`,
branch-2 → source) and cancel the loop review it opens — the rejection toast
stands; then complete the frontier inside that toast's 2.5s window and
outlive the window by 200ms; assert the offer toast AND its "Run in
parallel" action are still present. RED-CHECKED: with the pre-fix
`setTimeout` body restored the pin fails (`expected null not to be null` —
the stale timer wiped the offer); with the fix it passes.

**Suites after the fix:** focused file
`test/canvas/pipeline-canvas-page.test.tsx` — 114/114 passed. Full UI suite
via the CI-canonical `pnpm --dir packages/ui exec vitest run` (not
tail-piped): **67 files / 839 tests, exit 0** — was 838 after apply, +1 =
the m1 pin. tsc: only the three pre-existing failing files, untouched.

**Browser note:** the m1 defect is timing-only over the same DOM the task
4.1 driver already exercised end-to-end (offer surfaced, action clicked,
review opened); the fix changes no selector, no testid, and no wiring — the
archived transcript remains representative. The pinning test carries the
discriminating proof (red without the fix, green with it).
