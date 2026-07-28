# Tasks

## A. `complete` settles the candidate batch

### A.1 RED — `complete` settles the next Gate in one revision

- Add a facade-runtime test: linear plan `propose[gate] -> apply[gate] ->
  finish`. Start the Run, decide the propose Gate, resume to grant
  propose, observe the propose effect, then call `complete` on the
  propose Action.
- Assert the receipt's `view.recordVersion` is exactly base+1 (the
  completion AND the apply-gate wait land in one revision).
- Assert the receipt's `view.waits` contains the apply Gate wait and the
  receipt's `view.allowedControls` offers a `decision` for it.
- Assert NO second `resume` is required to see the apply Gate wait.

### A.2 GREEN — `complete` reconciles + settles after the commit-action-result

- In `facade-runtime.ts` `complete`, after the existing
  `reduceCanonicalRunRecord(record, commit-action-result)` step succeeds,
  call `reconcile(plan, result.record)`; on `ok`, call `settleCandidates`
  with the resulting candidate batch (same deliveryMode-aware helper
  start/resume use) and commit the settled Record.
- The receipt's `disposition` follows the `resume` rule (terminal /
  waiting / advanced) and `actions` carries any granted actions from the
  settle. When the settle is a no-op (no candidates), preserve the
  existing `'advanced'` disposition and `actions: []`.

### A.3 UPDATE — drop the post-complete `resume-run` workarounds

- In `pipeline-complex-e2e.test.ts`, remove the `resume-run` between the
  propose `complete` and the apply-Gate status assertion; assert the
  apply-Gate wait is committed IN the complete call. Update the
  verify-complete section to assert the capability-unavailable wait is
  committed by complete (not by a separate resume-run).
- In `pipeline-bugfix-e2e.test.ts`, assert the apply-Gate wait is
  committed by `complete` itself (the Run progresses past propose in one
  step).

## B. `await-workspace` commits a durable wait

### B.1 RED — schema drops ActionId/AttemptId from the wait intent

- Update `record.test.ts`'s workspace-reservation fixture to omit
  `attemptId`/`actionId` from each intent. The fixture still verifies
  that reversing the intent order produces an equal wait (the create
  helper sorts by canonical JSON).
- Add a facade-runtime test asserting `createCanonicalWait` accepts the
  trimmed intent shape and derives a deterministic WaitId.

### B.2 GREEN — schema correction

- `src/core/change-run/internal/waits.ts`: the `workspace-reservation`
  intent zod schema drops the `attemptId` and `actionId` fields.
- `src/core/change-run/contracts.ts`: the contracts-side mirror drops
  the same two fields.
- `packages/ui/src/api/types.ts`: the UI mirror drops the same two
  fields.

### B.3 GREEN — facade handles `await-workspace`

- In `settleCandidates`, the `await-workspace` arm builds a
  `workspace-reservation` wait from the candidate intents (deriving
  `invocationId` via `deriveInvocationId(runId, nodeId, occurrence)`)
  and pushes a `suspend` stimulus. Skip the stimulus when the resulting
  WaitId is already present in the Record (idempotent re-settle).

### B.4 GREEN — cross-Run registry wiring

- `RuntimeDeps` gains optional
  `reservationRegistry?: WorkspaceReservationRegistry`.
- In `settleCandidates`, before the admit arm, a pre-pass auto-resumes
  any `workspace-reservation` wait whose workspace the registry reports
  free (`isBusy === false`).
- In the admit arm, when the registry is wired and the candidate's node
  has workspace access, build the action, attempt `reserve`, and on
  conflict accumulate the node-intent as a blocked intent instead of
  admitting. After the candidate loop, blocked intents (from
  `await-workspace` or registry-denied admits) become one
  `workspace-reservation` wait via the same suspend path.
- In `complete`, after `commit-action-result`, call
  `registry.release(runId, actionId)` (idempotent no-op when not
  reserved) before reconciling + settling.

### B.5 RED+GREEN — two-Run contention test

- Add a facade-runtime test: two plans sharing one
  `workspaceInstanceId`, two facades wired to ONE registry, each plan
  has one root writer.
- Start Run A: writer admitted, registry holds the reservation.
- Start Run B: writer NOT admitted; a `workspace-reservation` wait is
  committed for it.
- Complete Run A's writer (observe + complete): Run A's reservation is
  released and Run A finishes.
- Resume Run B: the wait is auto-resumed and Run B's writer is admitted
  in one revision. Assert NO conflicting workspace write occurred (Run
  B's writer is the only one admitted against the workspace after Run A
  released).

## C. Verification

### C.1 Kernel suite green

- `pnpm exec vitest run test/core/change-run/` — all green. No regress
  on the facade-settle fix (`0512e06e`) or the bug-fix dogfood.

### C.2 Commands dogfood green

- `pnpm exec vitest run test/commands/pipeline-bugfix-e2e.test.ts
  test/commands/pipeline-complex-e2e.test.ts` — green with the
  post-complete `resume-run` workarounds removed.

### C.3 Static checks clean

- `pnpm exec tsc --noEmit` clean.
- `pnpm exec eslint src/core/change-run/` clean.
