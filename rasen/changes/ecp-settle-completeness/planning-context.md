# ecp-settle-completeness — Planning Context

A focused follow-up to `ecp-run-spine` (0.2.0) that closes two settle-completeness gaps
in the reconciler facade. Both were found + diagnosed during ecp-run-spine's Wave 4–5
verification and documented there; this change fixes them. The facade-settle ship-blocker
fix (`0512e06e`, `settleCandidates`) is the foundation — DO NOT regress it.

## Gap A — facade `complete` does not settle downstream candidates

`src/core/change-run/internal/facade-runtime.ts` `complete()` commits only the
`commit-action-result` stimulus, then returns. It does NOT re-run the reconciler to settle
the candidates that become admissible after the completion (e.g. the next stage's gate).

Design §5.6: "start, resume, **complete**, and control settle the candidate Record to its
next quiescent point and commit once." So `complete` should settle, like `start`/`resume`.

**Fix:** after the `commit-action-result` reducer step in `complete`, call `settleCandidates`
on the resulting record (same helper start/resume use) + commit. Preserve the existing
receipt contract (the completion's disposition + the granted actions from the settle).
Update the tests that currently work around this with a `resume-run` after `complete`
(e.g. `test/commands/pipeline-bugfix-e2e.test.ts`, `pipeline-complex-e2e.test.ts` — the
post-complete `resume-run` becomes redundant once `complete` settles; assert the settle
happens in one step).

## Gap B — `await-workspace` candidates are dropped

`settleCandidates` maps admit / await-gate / suspend-unsupported / finish / escalate / cancel
to stimuli, but NOT `await-workspace`. The reconciler emits `await-workspace` when workspace-
lease contention blocks an admit (two Runs wanting to write the same worktree, etc.). The
facade drops it → no workspace-reservation wait is committed → multi-Run workspace contention
is not serialized. (Single-Run dogfood is unaffected — no contention.)

The block: a workspace-reservation wait needs `attemptId`/`actionId`, which don't exist for
a blocked (not-yet-admitted) action.

**Fix direction (investigate + choose):** read `src/core/change-run/internal/reconciler.ts`
(the `await-workspace` candidate shape — does it carry the node + workspace intent?) and
`src/core/change-run/internal/reservations.ts` (`createWorkspaceReservationRegistry`,
`classifyReservationDelta`, `applyReservationDelta`, `ReservationEntry` — the kernel machinery,
already tested by `test/core/change-run/reservations.test.ts` + the 15.6 fault journeys).
Design a way to commit a workspace-reservation wait for a blocked node WITHOUT a concrete
action — likely a node-intent-level reservation (the wait keys on `(workspaceInstanceId, nodeId,
intent)` rather than a specific `actionId`), and the reconciler re-evaluates admissibility
once the workspace is free. The reservation machinery + the reducer's `suspend`/wait paths
are the seams. G8.5/G8.6 is the design intent.

## Verification bar (non-negotiable)
- `pnpm exec vitest run test/core/change-run/` green (the 305-test kernel suite — the settle
  + reservation paths). The facade-settle fix + the existing tests must not regress.
- The dogfood must still pass: `test/commands/pipeline-bugfix-e2e.test.ts` (15.3) +
  `pipeline-complex-e2e.test.ts` (15.4) — drive a real bug-fix Run through gates end-to-end.
- Add REAL tests for A (complete settles the next candidate in one step) + B (two Runs
  contending for one worktree → one is serialized via a workspace-reservation wait, no
  conflict). Not kernel-only substitutes.
- `pnpm exec tsc --noEmit` + `pnpm exec eslint src/core/change-run/` clean.
- Also fill this change's `proposal.md` + `tasks.md` (scaffolded stubs) to reflect A+B.

## Constraints
- You ARE authorized to edit `src/core/change-run/internal/facade-runtime.ts`,
  `reducer.ts`, `reservations.ts`, `reconciler.ts`, and the affected tests for THIS change.
- Do NOT edit `rasen/changes/ecp-run-spine/**` (that change is shipped — PR #92). Do NOT
  edit this change's `auto-run.json` (LEAD owns it). REPORT completed work.
- Do NOT `git commit` — leave for LEAD. Do NOT spawn subagents.
- 1M-window context-probe false positive: `rasen agent context` reports `limit:200000`; real
  occupancy = contextTokens/1M.
