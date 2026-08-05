# Implementer 2 handoff

## Boundary reached

- APPLY progress: **62/76 complete**, 14 remaining.
- Sections 1-8 are checked with deterministic/common and legacy-preservation evidence.
- Stopped at the requested coherent boundary before section 9. No verification/review/ship/archive task is checked.
- This is common-contract evidence only. No Linux, Windows, macOS, native ProcessCapsule closure, or release-support receipt exists.

## Product implementation added or extended

Under `src/core/session-host/process-authority/`:

- `coordinator.ts`: exact recovery `inspect`/`terminate`/exact-empty observation, runtime-authentic exact-empty receipts, sole release discriminator, bounded publish phase, prepare/inspect/control cancellation, synchronous-scheduler-safe cleanup, late-result quarantine, exception-safe diagnostics, operation identity/ledger, and bounded receipt caches.
- `manifest.ts`: closed provider-manifest schema, bounded relative artifact paths, immutable validated entries, exact recursive capability/version identity, duplicate rejection, and runtime descriptor equality.
- `process-scope-adapter.ts`: opt-in provider-backed `ProcessScope`, required trusted publication callback, explicit stream/common-event bridge, retained outcome mapping, and no legacy promotion/default wiring.
- `index.ts`: common exports for the above surfaces.
- Existing `types.ts`, `registry.ts`, `reference-codec.ts`, and `reference-resolution.ts` remain owned from implementer 1 and are consumed by these sections; `registry.ts` now accepts an optional exact manifest binding.

No existing production host/backend default, `process-scope.ts`, native helper/protocol/manifest/resolver, Management/Session wiring, platform provider, or Direction/run-state file was changed.

## Tests and evidence

Added:

- `test/core/session-host/process-authority-outcomes.test.ts`
- `test/core/session-host/process-authority-deadlines.test.ts`
- `test/core/session-host/process-authority-manifest.test.ts`
- `test/core/session-host/process-authority-conformance.test.ts`
- `test/core/session-host/process-authority-process-scope-adapter.test.ts`
- `test/helpers/process-authority-provider-conformance.ts`
- `test/helpers/deterministic-process-authority-provider.ts`
- `evidence/implementation-progress-2.md`

Updated foundation-owned prior files:

- `test/core/session-host/process-authority-lifecycle.test.ts`
- `test/core/session-host/process-authority-public-surface.test.ts`
- `rasen/changes/ecp-platform-process-authority-foundation/tasks.md`

Latest exact receipt:

1. Focused common plus legacy-preservation command in `evidence/implementation-progress-2.md`: exit 0; **12 files, 108 tests passed**.
2. `pnpm exec tsc --noEmit`: exit 0.
3. Foundation-owned `git diff --check`: exit 0.
4. `rasen instructions apply --change ecp-platform-process-authority-foundation --json`: **62/76**, 14 remaining.

## Review hazards

- `isExactScopeEmptyReceipt` is intentionally runtime-authentic through a module-private WeakSet. Review bundling/module-duplication assumptions, but do not weaken it to shape validation.
- Operation and exact-empty caches use explicit FIFO bounds of 1,024. Eviction is fail-closed/safe, but independent review should assess whether the limits and observability are suitable for long-lived production coordinators.
- Reused operation ids always fault closed; semantically identical repeated settlement inside one operation is idempotent, while conflicting/late settlement becomes diagnostic only. The common Promise seam cannot emit two synchronous provider receipts as a stream.
- The common digest and operation-identity digest are corruption/confusion guards, not signer or same-user authentication.
- `publishAuthority` is a trusted-host callback. The adapter can validate only the returned exact acknowledgement; durable write truth remains the host transaction's responsibility.
- The adapter requires an explicit stream/common-event bridge because the authority provider owns control, not stdio. It is opt-in and unregistered; later closure integration must review this split before default wiring.
- Publication is synchronous host acknowledgment validation wrapped as an independent bounded phase; it has no provider result that can arrive late. Other provider phases have late-result discriminators.
- The deterministic mutation harness now uses measured public behavior plus external authority facts. Reviewers should pressure-test whether each future actual-OS fixture supplies truthful `actualEmpty`, destructive-control, and release-oracle facts.
- The current common `AuthorityPrepareInput.windowsVerbatimArguments` remains the one OS-named launch-fidelity field noted by implementer 1. No Windows authority behavior is attached to it.

## Section 9 still required

- 9.1 focused foundation gate (the current focused command is evidence but LEAD should rerun after review fixes).
- 9.2 complete Session-host/Management/daemon/CLI regression set.
- 9.3 build, lint, typecheck, diff check.
- 9.4 full `pnpm test` with retained output discipline.
- 9.5 all UI gates.
- 9.6 strict Change validation.
- 9.7 final scenario-to-code/test/command implementation report.
- 9.8 final forbidden-scope/package audit.
- 9.9 fresh security review and resolution of every Blocker/Major.
- 9.10 separate fresh code/spec review and bounded fix/re-review.
- 9.11 full rerun after the last review fix.
- 9.12-9.14 LEAD-owned local ship, immediate archive, and parent terminal evidence.

## Complete owned-file inventory

Product:

- `src/core/session-host/process-authority/types.ts`
- `src/core/session-host/process-authority/registry.ts`
- `src/core/session-host/process-authority/reference-codec.ts`
- `src/core/session-host/process-authority/reference-resolution.ts`
- `src/core/session-host/process-authority/coordinator.ts`
- `src/core/session-host/process-authority/manifest.ts`
- `src/core/session-host/process-authority/process-scope-adapter.ts`
- `src/core/session-host/process-authority/index.ts`

Tests/support:

- `test/core/session-host/process-authority-public-surface.test.ts`
- `test/core/session-host/process-authority-registry.test.ts`
- `test/core/session-host/process-authority-reference.test.ts`
- `test/core/session-host/process-authority-lifecycle.test.ts`
- `test/core/session-host/process-authority-outcomes.test.ts`
- `test/core/session-host/process-authority-deadlines.test.ts`
- `test/core/session-host/process-authority-manifest.test.ts`
- `test/core/session-host/process-authority-conformance.test.ts`
- `test/core/session-host/process-authority-process-scope-adapter.test.ts`
- `test/helpers/process-authority-provider-conformance.ts`
- `test/helpers/deterministic-process-authority-provider.ts`

Change-owned planning/evidence/handoff:

- `rasen/changes/ecp-platform-process-authority-foundation/proposal.md`
- `rasen/changes/ecp-platform-process-authority-foundation/design.md`
- `rasen/changes/ecp-platform-process-authority-foundation/specs/process-authority-provider/spec.md`
- `rasen/changes/ecp-platform-process-authority-foundation/tasks.md`
- `rasen/changes/ecp-platform-process-authority-foundation/evidence/implementation-baseline.md`
- `rasen/changes/ecp-platform-process-authority-foundation/evidence/red-baseline.md`
- `rasen/changes/ecp-platform-process-authority-foundation/evidence/green-progress.md`
- `rasen/changes/ecp-platform-process-authority-foundation/evidence/implementation-progress-2.md`
- `rasen/changes/ecp-platform-process-authority-foundation/handoff/implementer-1.md`
- `rasen/changes/ecp-platform-process-authority-foundation/handoff/implementer-2.md`

Do not adopt or clean any unrelated cumulative file, retained test output, `.rasen/**`, `rasen/changes/foo/`, stash, or parent/other Change artifact.
