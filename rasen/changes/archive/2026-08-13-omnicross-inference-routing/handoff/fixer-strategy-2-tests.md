# Post-cap strategy attempt 2 test handoff

## Status

HANDOFF. The five LEAD-reported candidate-preview defects were diagnosed and repaired statically, but the command permission layer intercepted the required focused suite and typecheck before execution. No dynamic pass is claimed.

## Eliminated hypotheses and retained fixes

### F1 — closed receipt codecs

- Eliminated: the receipt invariant is too strict or should be weakened.
- Diagnosis: the candidate fixture carried `recordVersion: 0` while the receipt view carried version 1. The candidate Run matched, but its Record version did not.
- Fix: updated only the valid fixture to version 1 and made the negative mismatch case use version 0. Duplicate, wrong-Run, and wrong-version rejection remain intact.

### F2 — fan-out rollback

- Eliminated: `admit` should swallow an Action-builder failure or return a partial receipt.
- Diagnosis: throwing is the correct public behavior, but every speculative reservation must be released and the canonical Record must remain byte-logically unchanged. The existing catch around candidate collection releases reservations accumulated before a later builder throws; reduction and store failures require the same cleanup boundary.
- Fix: retained builder-error propagation; kept the discriminating assertions for zero Actions, unchanged Record version, and an empty reservation snapshot; wrapped reduction failure cleanup; and added cleanup before completion's fallback commit when combined settle reduction fails. Store create/commit failures already release the collected pending reservations.

### F3/F4 — workspace contention and durable waits

- Eliminated: an exact agent manifest must cover non-agent `await-workspace` candidates, or exact candidate checks must be weakened.
- Diagnosis: manifest exactness applies to the complete agent frontier only. The same admission transaction may reconcile a registry conflict into a durable non-agent `workspace-reservation` wait. The old `admit` rejected any non-agent candidate and then treated fewer granted Actions than agent candidates as stale, preventing the designed wait transition.
- Fix: `admit` validates every current agent candidate through the manifest resolver, settles the full reconciler batch, and allows a zero-grant durable-wait commit. Candidate identities are still derived from the exact Run/head version/digest and descriptor; no stale check was weakened. Tests now require Run B to commit one wait with no Action, require the post-wait candidate identity to reflect the new Record, require repeated resume to preserve that new identity/version, and require Run B to admit only after Run A releases the workspace.

### F5 — runtime-context initial preview

- Eliminated: production lost a ready agent during initial reconciliation.
- Diagnosis: the fixture's first `propose` stage was gated in both authored Definition and effective policy, so the correct initial state was a durable gate wait, not a ready agent preview.
- Fix: introduced a ready-agent fixture variant with the first gate disabled and passed the matching effective-policy gate. Existing assertions prove start admits no Action, returns one preview, leaves the Record Action map empty, and repeated resume reproduces the candidate exactly before explicit admission.

## Command/host construction audit

- `prepareRuntimeContext` currently calls `buildAgentAction` for every descriptor, but every production binding emitted by `profile-resolver.ts` currently freezes `actionKind: 'agent'`.
- No shipped profile path producing command/host capability bindings was found; therefore command/host construction is not presently reachable through this production host constructor.
- The low-level `buildCommandAction` and `buildHostAction` constructors retain direct unit coverage. No speculative adapter inputs were invented in this fix.

## Replacement-lease retry/resume identity proof identified

`test/commands/agent-omnicross.test.ts` contains real vertical replacement-lease identity proofs:

- `routes Codex fresh and exact resume through replacement leases`: lease-1 then lease-2, both returning `threadId: vertical-thread`, with distinct route tokens absent from receipts/persistence.
- `routes Claude fresh and exact continuation with the frozen model`: lease-1 then lease-2, both returning `sessionId: vertical-session`.

These tests must be included in the broader AT execution; static identification is not reported as a dynamic pass.

## Verification actually executed

- `git diff --check`: passed (exit 0); output contained only LF-to-CRLF working-copy warnings.

## Commands attempted but not executed

The permission layer intercepted each command as approval-required:

- `pnpm exec vitest run test/core/change-run/runtime-context.test.ts test/core/change-run/facade-settle-completeness.test.ts test/core/change-run/contracts.test.ts test/commands/pipeline-agent-turn-input.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit`

## Exact remaining list

1. Run the exact four-file focused protocol suite above and require 4 files / 36 tests / 36 passed. If any expectation differs, preserve exact candidate identity and durable-wait semantics described above.
2. Run `pnpm exec tsc --noEmit` and fix all compiler errors.
3. Run frozen executor and Management API authority suites: authority, executor, production executor, and management frozen-action executor tests.
4. Run `test/commands/agent-omnicross.test.ts` and record the exact replacement-lease Codex thread and Claude session identity results.
5. Run the broader AT-1–AT-14 suite and record exact files/tests/counts.
6. Run `pnpm build`.
7. Run the full `pnpm test -- --reporter=dot` in background as requested, relying on completion notification rather than polling.
8. Run change validation, UTF-8 replacement-character scan, JSON/YAML parsing, canonical Record prompt/body and secret persistence scans, and final `git diff --check`.
9. Re-open the retained architecture-index edits in `detail/quick-locate.md`, `detail/modules/workflow-pipeline.md`, and `detail/modules/ai-integration.md` and confirm they describe the preview/admit and frozen execution seams accurately.
10. Append dynamic counts and residual risks under `Post-cap strategy attempt 2 fix` in `evidence/review-cycle-report.md`.
11. Check tasks 7.1–7.8 only after all proof above passes.

## Files changed by this successor

- `src/core/change-run/internal/facade-runtime.ts`
- `test/core/change-run/contracts.test.ts`
- `test/core/change-run/facade-settle-completeness.test.ts`
- `test/core/change-run/runtime-context.test.ts`
- `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md`
- `rasen/changes/omnicross-inference-routing/handoff/fixer-strategy-2-tests.md`
