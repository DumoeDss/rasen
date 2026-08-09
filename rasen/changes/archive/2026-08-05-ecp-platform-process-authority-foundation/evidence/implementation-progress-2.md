# Implementation progress 2: common authority closure

## Scope and truth boundary

This receipt covers only the platform-neutral `ProcessAuthorityProvider` foundation, its deterministic fixture, and the opt-in `ProcessScope` compatibility adapter. It is not Linux, Windows, macOS, native ProcessCapsule, packaging, installer, entitlement, signing, VM, or release-support evidence. No production provider is registered and the existing native ProcessCapsule remains outside the new conformance contract.

## RED -> GREEN discriminators

- `process-authority-outcomes.test.ts` was first run with no coordinator `inspect`/`terminate` methods and no release predicate: 1 file, 6/6 RED. GREEN now distinguishes root exit, retained failures, identity drift/event gap, and authentic exact-empty release.
- `process-authority-deadlines.test.ts` was first run against the initial bounded wrapper: 1 file, 5/5 RED. It exposed the synchronous scheduler token race, operation start after synchronous timeout, missing phase identity, missing late diagnostics, missing caller cancellation, and absent operation-id conflict handling.
- `process-authority-manifest.test.ts` was first run before the closed manifest implementation: 1 file, 7/14 RED. GREEN now binds exact runtime/manifest identity and rejects closed-schema, version, path, duplicate, and rollback mutations.
- `process-authority-process-scope-adapter.test.ts` was first run before the opt-in adapter existed: 1 file, 3/4 RED. GREEN now proves publish-before-activate mapping, retained outcomes, authentic release receipts, legacy byte preservation, prepare cancellation, and post-publication failure retention.
- The reusable conformance mutation probe uses the same measured public snapshot for every named mutation. Each faulty deterministic fixture changes actual coordinator/registry/codec/adapter behavior or an external authority oracle and makes the unchanged assertion RED; the mutation-disabled fixture returns the exact GREEN snapshot.

## Deterministic common receipt

Command:

```text
pnpm exec vitest run test/core/session-host/process-authority-public-surface.test.ts test/core/session-host/process-authority-registry.test.ts test/core/session-host/process-authority-reference.test.ts test/core/session-host/process-authority-lifecycle.test.ts test/core/session-host/process-authority-outcomes.test.ts test/core/session-host/process-authority-deadlines.test.ts test/core/session-host/process-authority-manifest.test.ts test/core/session-host/process-authority-conformance.test.ts test/core/session-host/process-authority-process-scope-adapter.test.ts test/core/session-host/process-scope-contract.test.ts test/core/session-host/process-capsule-package.test.ts test/core/session-host/process-capsule-migration.test.ts --maxWorkers=1 --minWorkers=1
```

Result: exit 0; 12 files, 108 tests passed.

The common subset contains 9 files and 88 tests. Its provider-neutral suite includes a full measured manifest/ordering/opaque-reference/retention/timeout/control-loss/single-settlement/adapter probe, and later platform fixture factories receive that unchanged suite body.

Additional commands:

- `pnpm exec tsc --noEmit`: exit 0.
- `git diff --check -- <foundation-owned product/tests/change paths>`: exit 0.

## Legacy-preservation receipt

The same focused command separately included the existing legacy seams:

- `process-scope-contract.test.ts`: 4 passed.
- `process-capsule-package.test.ts`: 13 passed.
- `process-capsule-migration.test.ts`: 3 passed.

These 20 passing tests preserve existing `rasen-process-scope/1` behavior. They do not make the current ProcessCapsule a provider and do not prove its open native authority findings closed.

## Boundedness and release notes

- `exact-scope-empty` receipts are runtime-authentic objects minted only after exact provider evidence. A forged shape with the same state/reference is not release-eligible.
- Exact-empty receipt caching and operation-id retention are each capped at 1,024 entries. Safe receipt eviction may cause a later exact provider re-inspection; it never turns an uncertain result into release.
- Operation identities bind the phase to a closed digest of the exact selection/input, reference, publication acknowledgement, or termination intent. Reused ids fault closed. The injected signal is deliberately excluded from provider launch data and semantic identity.
- Publication validation is a synchronous host-owned operation, but it still has an independently identified bounded `publish` phase. Provider-return late-result tests cover prepare, activate, inspect, terminate, abort, and exact-empty observation; publication has no provider result to arrive late.
- Diagnostic observers are quarantined: observer exceptions cannot change settlement.

## Remaining work

Tasks 9.1-9.14 remain for the LEAD verification/review/local ship/archive lifecycle. No full build, lint, full root suite, UI gates, package audit, independent security/code-spec review, child commit, ship, or archive is claimed by this receipt.
