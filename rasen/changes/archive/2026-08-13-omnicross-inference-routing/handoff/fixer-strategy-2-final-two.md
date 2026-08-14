# Post-cap strategy attempt 2 final-two handoff

## Status

HANDOFF. Both requested candidate-preview test fixes are applied. Terminal permission blocked the exact four-file suite and TypeScript check, so 36/36 and typecheck cannot be claimed and downstream verification was not started.

## Applied fixes

### Fan-out admission rollback

File: `test/core/change-run/facade-settle-completeness.test.ts`

- Wrapped the synchronous `runtime.admit()` call in a Promise boundary so Vitest observes the deliberately injected second-build error as a rejection.
- Asserted the complete exact error message, including the second candidate's node identity.
- Captured the durable Record before admission and required the post-rejection Record to be equal.
- Required zero partial Actions, unchanged Record version, an empty workspace reservation snapshot, and no finalized reservation.
- Kept the successful retry proof: two Actions, no candidates, one Record revision, and two final reservations.
- Production cleanup was inspected in `src/core/change-run/internal/facade-runtime.ts`; collection and reduction failures release all accumulated pending reservations, store failures release pending reservations, and finalization occurs only after a successful Record mutation. No production change was required, and the injected error remains public and unrelabelled.

### Stable candidate preview and exact admission

File: `test/core/change-run/runtime-context.test.ts`

- Repeated preview through the production `resume` path against the existing Run rather than issuing a conflicting start request.
- Required the resumed receipt to contain no Actions, exactly the original candidate list, and the same `candidateId`.
- Required the durable Record still to contain zero admitted Actions after repeated preview.
- Captured the explicit admission manifest through `resolveAgentTurnInput` and required `finalizeAgentTurnInputs` to observe exactly the one previewed candidate ID before admission.
- Retained exact rendered UTF-8 byte assertions and stale reuse rejection after admission.
- Did not weaken `launch_request_conflict`.

## Evidence update

Updated `rasen/changes/omnicross-inference-routing/evidence/review-cycle-report.md` under the existing exact heading `Post-cap strategy attempt 2 fix` with the final-two changes and truthful blocked-verification status.

## Commands attempted but blocked before execution

```text
pnpm exec vitest run test/core/change-run/runtime-context.test.ts test/core/change-run/facade-settle-completeness.test.ts test/core/change-run/contracts.test.ts test/commands/pipeline-agent-turn-input.test.ts --reporter=dot
pnpm exec tsc --noEmit
```

Both calls returned an approval-required interception. No dynamic result is claimed.

## Required continuation

1. Run the exact four-file command above until it reports 36/36 passing.
2. Run `pnpm exec tsc --noEmit`.
3. If both pass, continue frozen executor and Management API authority suites, replacement-lease identity proof audit/test, command/host audit, and build.
4. Update evidence with exact commands and counts.
5. Do not check tasks 7.1–7.8 unless every required proof is complete.
