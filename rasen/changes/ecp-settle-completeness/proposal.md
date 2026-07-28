# ecp-settle-completeness

## Why

`ecp-run-spine` shipped the facade `settleCandidates` helper (the Wave 4
facade-settle ship-blocker fix, `0512e06e`) so that `start` and `resume`
commit the full reconciler candidate batch — admits, gate waits,
capability-unavailable suspends, finish, escalate, cancel — in one Record
revision. Two follow-on gaps were diagnosed and documented during that
change's Wave 4–5 verification but explicitly deferred so the spine could
land. This change closes both.

### Gap A — `complete` does not settle

The facade's `complete()` commits only the `commit-action-result` stimulus
and returns. It does NOT re-run the reconciler, so candidates that become
admissible as a direct consequence of the completion (the next stage's Gate
wait, the next stage's admit, the implicit Run finish, a capability-
unavailable suspend on a complex adaptive verify) are not committed in the
same revision. Design §5.6 puts `complete` in the same settlement class as
`start`/`resume`/`control`. The dogfood (`pipeline-complex-e2e`) works
around this by issuing a `resume-run` immediately after every `complete`
that should settle a downstream Gate or capability suspension.

### Gap B — `await-workspace` candidates are dropped

`settleCandidates` maps every reconciler candidate kind to a stimulus
except `await-workspace`, which falls through a `case` with a comment
explaining the block: a `workspace-reservation` wait needs identities for
each blocked intent, and the canonical schema in `waits.ts` required
`attemptId`/`actionId` per intent — values that do not exist for a
candidate the reconciler has NOT admitted. The result is that workspace
contention (intra-Run as emitted by the reconciler, and cross-Run once the
reservation registry is wired) never produces a durable wait, so the Run
silently drops the blocked work and the control path has no WaitId to
target. Single-Run dogfood is unaffected because the bug-fix pipeline has
no intra-Run workspace contention.

The `ecp-change-run-runtime` spec already states the correct shape: the
wait carries "only WorkspaceInstanceId and stable local candidate
identities, never the other Run identity." `attemptId`/`actionId` are
neither stable nor local-candidate-level — they belong to a specific
admitted Action. The schema requiring them was the bug.

## What Changes

### Gap A — `complete` settles (small, surgical)

`src/core/change-run/internal/facade-runtime.ts`:

- After the `commit-action-result` step, `complete` now reconciles the
  resulting Record and calls `settleCandidates` on it (the same helper
  `start`/`resume` use), committing the candidate batch in the SAME
  revision as the completion. The Run reaches its next quiescent point in
  one round-trip.
- The receipt contract is preserved: the receipt's `disposition` follows
  the same rule as `resume` (terminal / waiting / advanced), and the
  `actions` list carries any actions granted by the settle (e.g. an
  immediately-admitted next stage). When the settle produces no granted
  actions and no waits, `disposition` is `advanced` and `actions` is `[]`
  — the previous behavior.

### Gap B — `await-workspace` commits a durable wait

Three coupled edits, plus the dogfood test workarounds removed.

**1. Schema correction** (`src/core/change-run/internal/waits.ts`,
`src/core/change-run/contracts.ts`, `packages/ui/src/api/types.ts`):

The `workspace-reservation` intent drops `attemptId` and `actionId`. An
intent is now `{ nodeId, invocationId, occurrence, access }` — the stable
local candidate identity the spec calls for. The `WaitId` is still
deterministic over the wait context; existing fixtures that hard-coded the
old shape are updated.

**2. Reconciler carries the candidate as-is**
(`src/core/change-run/internal/reconciler.ts`):

No change to the `await-workspace` shape — it already carries exactly the
node-intent fields the wait now needs.

**3. Facade handles `await-workspace` + cross-Run registry**
(`src/core/change-run/internal/facade-runtime.ts`):

- `settleCandidates` gains an `await-workspace` arm: it builds a
  `workspace-reservation` wait from the candidate's intents (deriving the
  `invocationId` for each via `deriveInvocationId(runId, nodeId,
  occurrence)`) and pushes a `suspend` stimulus. If an identical wait
  already exists in the Record (same `waitId`), the suspend is skipped so
  the path is idempotent.
- `RuntimeDeps` gains an optional `reservationRegistry` wired with the
  existing `createWorkspaceReservationRegistry`. When wired, the `admit`
  arm consults the registry before emitting each workspace admit
  (`access: 'read' | 'write'`). A reservation conflict converts the admit
  into a blocked intent (same node-intent shape as `await-workspace`),
  serializing cross-Run contention without the reconciler ever needing to
  see another Run's Record.
- A pre-pass auto-resumes any `workspace-reservation` wait whose workspace
  is observably free (registry `isBusy === false`) before processing
  admits, so a single `resume` after the contention clears both removes
  the wait and admits the stable compatible subset in one revision.
- `complete` releases the completed Action's reservation before settling
  (idempotent `release(runId, actionId)`), so the post-complete settle can
  admit a blocked candidate from this OR another Run.

### Dogfood test cleanup

`test/commands/pipeline-complex-e2e.test.ts` drops the post-`complete`
`resume-run` workaround between propose-complete and the apply Gate, and
the pre-resume "no wait committed yet" assertion at verify-complete. Both
assertions are strengthened to verify the settle happens IN the complete
call (one revision). `test/commands/pipeline-bugfix-e2e.test.ts` asserts
the apply Gate wait is committed by `complete` itself.

## Capabilities

This change MODIFIES one capability of `ecp-change-run-runtime`:

- **Scenario: Workspace reservation wait is retryable and non-churning**
  is MODIFIED to drop the `attemptId`/`actionId` requirement from the
  intent tuple and to require the facade to commit `await-workspace`
  candidates.

The remaining scenarios (admit selection, external reservation recheck,
reservation release, cross-Run registry, self-handoff, distinct worktrees)
are restated verbatim from `ecp-run-spine` to remain coherently testable
under the corrected schema; their substance is unchanged.
