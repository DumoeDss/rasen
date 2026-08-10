## Why

Store v2 finalization can currently persist an unreachable transaction before management-route identity admission, hide reconciliation details behind a generic skip refusal, or discover association disagreement only after publication. The remaining CCR-4 through CCR-6, FAR-1 through FAR-3, and SCR-1 findings must be closed without weakening the typed spec, archive ownership, project-selection, or workspace durability contracts established by the dependency children.

## What Changes

- Make loopback management finalization inspect without saving first, then persist and apply only after the committed Change instance and the complete blocker set are admitted; identity and blocker refusals leave the transaction store unchanged.
- Exercise `mergeConfirmed` through the real HTTP and child-process boundary for omitted, false, sole-merge-blocker true, and true-with-another-blocker requests, including their transaction-store effects.
- Preserve incomplete apply dispositions through HTTP with their nested status, complete ordered blockers, and exact recovery, abort, or manual-action field.
- Compare workspace association/index agreement only by immutable pair identity while continuing to revalidate live Git state against the frozen plan.
- Freeze the derived execution-association path on every paired plan and block a missing association document before any mutation.
- Carry the complete typed spec-reconciliation issue array through Store finalization without source/capability deduplication or replacement by a generic skip conflict; reserve that conflict for intentional skip or decline.
- Keep Store finalization on the shared canonical project lookup, archive abort/cleaner ownership, and workspace claim/directory-durability paths established by its dependency changes.
- Render human abort refusals in actionable order: blockers first, then association and disposition guidance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `management-http-api`: Finalization admission becomes transaction-store neutral on refusal and preserves merge-gate and apply-failure structure across the real HTTP/CLI boundary.
- `change-finalization-transaction`: Finalization freezes a recoverable association, preserves typed reconciliation blockers, and validates mutable Git facts separately from immutable pair identity.
- `cli-archive`: Human Store abort refusal output presents blockers before association and recovery disposition guidance.

## Impact

- Management finalization orchestration and protocol decoding in `src/core/management-api/finalize.ts`, with the minimal router/server test seam needed to drive actual loopback child-process outcomes.
- Store finalization planning, association validation, and blocker types in `src/core/store/finalization/association.ts`, `module.ts`, and `types.ts`; archive preparation/Store rendering in `src/core/archive.ts`.
- Focused management HTTP, finalization association/spec-sync/token, archive rendering, and Store-selection regressions plus a bounded child-process fixture.
- No new runtime dependency, registry schema, workspace carrier format, or parallel archive recovery classifier.
