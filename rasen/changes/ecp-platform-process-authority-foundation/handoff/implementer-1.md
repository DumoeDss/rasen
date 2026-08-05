# Implementer 1 handoff

## Boundary reached

- APPLY progress: **29/76 complete**, 47 remaining (`rasen instructions apply --change "ecp-platform-process-authority-foundation" --json`).
- Completed sections 1-4 exactly: implementation baseline/RED harness, exact provider descriptor and closed registry, opaque authority-reference envelope, and prepare -> publish -> activate/abort lifecycle.
- Stopped at the requested coherent 4.x soft boundary. No section 5-9 task is checked.
- All evidence in this handoff is deterministic/common only. No Linux, Windows, macOS, ProcessCapsule closure, or release-support receipt exists.

## Product implementation

Created only under `src/core/session-host/process-authority/`:

- `types.ts`: opaque provider/common reference brands, exact provider/selection/operation types, one named recursive-scope semantic list, and exhaustive provider outcome vocabulary.
- `registry.ts`: finite construction-time validation, immutable/copy-safe descriptors, exact tuple lookup, duplicate/malformed/weakened descriptor rejection, no platform/order/fallback policy, and explicit method binding that preserves class-provider prototype behavior.
- `reference-codec.ts`: canonical `rasen-process-authority/1:<base64url>` envelope, explicit key/bound checks, strict UTF-8 and canonical base64url, SHA-256 corruption identity with constant-time comparison, byte-preserving typed failures, provider-internal decode/re-encode, and one public log-safe opaque view.
- `reference-resolution.ts`: internal exact envelope-to-registry resolution with no alternate-provider probe and no provider call for malformed/mismatched references.
- `coordinator.ts`: runtime-guarded inert prepare, exact publication binding/acknowledgment, published-only activation, prepared/published abort, concurrent/duplicate ordering guards, retained failure mapping, and a first bounded single-settlement wrapper with injected monotonic clock/scheduler/operation ids.
- `index.ts`: deliberately narrow public exports. Provider-byte creation/decoding and exact resolution are not re-exported.

Production defaults, existing `ProcessScope`, native ProcessCapsule helper/protocol/manifest/resolver, Management/Session wiring, host release paths, Direction/parent run-state, and every platform adapter remain unchanged.

## Tests and RED -> GREEN receipts

Created:

- `test/core/session-host/process-authority-public-surface.test.ts`
- `test/core/session-host/process-authority-registry.test.ts`
- `test/core/session-host/process-authority-reference.test.ts`
- `test/core/session-host/process-authority-lifecycle.test.ts`

Durable receipts:

- `evidence/implementation-baseline.md`
- `evidence/red-baseline.md`
- `evidence/green-progress.md`

Exact RED commands/results are in `evidence/red-baseline.md`. Notable discriminator: the first registry implementation shallow-spread a provider and erased prototype methods; `process-authority-registry.test.ts` failed with `selected.provider.inspect is not a function`. Registration now validates and binds all four contract methods explicitly.

Latest commands:

1. `pnpm exec vitest run test/core/session-host/process-authority-public-surface.test.ts test/core/session-host/process-authority-registry.test.ts test/core/session-host/process-authority-reference.test.ts test/core/session-host/process-authority-lifecycle.test.ts --maxWorkers=1 --minWorkers=1`
   - Exit 0; **4 files, 29 tests passed**.
2. `pnpm exec tsc --noEmit`
   - Exit 0.
3. `git diff --check -- src/core/session-host/process-authority test/core/session-host/process-authority-public-surface.test.ts test/core/session-host/process-authority-registry.test.ts test/core/session-host/process-authority-reference.test.ts test/core/session-host/process-authority-lifecycle.test.ts rasen/changes/ecp-platform-process-authority-foundation`
   - Exit 0.
4. `node bin/rasen.js validate ecp-platform-process-authority-foundation --strict`
   - Exit 0; Change valid.
5. After replacing fixture-private call counts with an externally observed workload-start callback: `pnpm exec vitest run test/core/session-host/process-authority-lifecycle.test.ts --maxWorkers=1 --minWorkers=1` plus `pnpm exec tsc --noEmit`
   - Exit 0; **9 tests passed**, typecheck passed.

No build, lint, full suite, UI suite, package audit, independent review, ship, or archive was run; those are explicitly later tasks.

## Next implementation work

Continue strict vertical RED -> GREEN from task 5.1:

1. Section 5: common public observations/release eligibility, exact root-exit fields, retained reference/publication truth, identity-drift/event-gap no-control behavior, and the sole `isExactScopeEmptyReceipt` release seam.
2. Section 6: finish the common bounded-operation runner and semantic ledger across prepare, publish, activate, inspect, terminate, abort, and exact-empty observation; cover exceptions, cancellation/control loss, late results, duplicates/conflicts, and timer/listener cleanup under fake plus real event-loop settlement.
3. Section 7: closed provider manifest validator and exact manifest/runtime/envelope recovery/rollback negotiation.
4. Section 8: unchanged reusable conformance/mutation suite, deterministic test provider extraction, and opt-in `createProviderBackedProcessScope(...)` without default wiring or native capsule conformance.
5. Section 9: focused/regression/full/UI/static/package gates, scenario report/audit, fresh security and code/spec reviews, LEAD-managed local ship/archive lifecycle.

## Hazards and review targets

- **Synchronous scheduler token cleanup:** `coordinator.ts` assigns the scheduler token from `scheduler.set(...)`. A malicious or synchronous injected scheduler can invoke the callback before token assignment, causing `clear(undefined)` and leaving the subsequently returned token un-cleared. The default timer is asynchronous, but section 6 must add a RED discriminator and harden the token/cleanup protocol (or formally reject synchronous schedulers). This is the first next-runner concern.
- **Late-result diagnostics/ledger incomplete:** the bounded wrapper ignores a provider promise after first settlement, but it does not yet record bounded diagnostic evidence, accept semantic-identical duplicates, or convert conflicting outcomes to retained control loss. Section 6 owns this.
- **Publish deadline remains structural:** publication validation is synchronous and bounded by construction, but section 6 explicitly asks for a publish deadline identity. Decide whether the common runner models a trusted-host acknowledgment operation or documents/tests synchronous publication validation as the bounded operation; do not silently skip it.
- **Abort retained precision:** exact provider `exact-scope-empty` is the only outcome mapped to release. Provider `live`/`root-exited` remain retained facts, but section 5 should review whether prepared-abort needs a narrower explicit retained receipt instead of reusing those observation states.
- **Release helper absent by design:** there is no `isExactScopeEmptyReceipt` yet and no compatibility adapter. Do not let host/ProcessScope callers infer release from current lifecycle result strings before tasks 5.7 and 8.7.
- **Internal codec is intentionally not a public export:** provider byte creation/decoding is importable only by its internal module path. Preserve the `index.ts` negative test and audit package output later so no API/View/registry projection exposes decoded bytes.
- **Digest is not authentication:** SHA-256 detects canonical corruption only. Never turn it into provider identity, signer custody, or same-user attacker authentication.
- **Registry capability policy:** the current registry accepts only the exact indivisible recursive-scope capability. If later manifest work introduces additional capability ids, reconcile that with the artifact's simultaneous duplicate-provider-id rejection; do not weaken the recursive-scope semantics by intersection or fallback.
- **Launch input fidelity:** `AuthorityPrepareInput.windowsVerbatimArguments` mirrors the existing neutral launch request but is the only OS-named field in the common module. Independent review should decide whether it remains common command-line fidelity or should move behind the Windows provider; it is not wired to any adapter here.
- **Shared dirty worktree:** every owned file is still untracked as part of the cumulative worktree. Never clean/reset/revert the tree, adopt retained temp outputs, touch `.rasen/**`, or commit/push from an APPLY implementer.

## Exclusions rechecked

No platform provider/descriptor, PID-tree or PGID fallback, native helper/protocol/manifest edit, Mac decision, Endpoint Security/VM/signing/entitlement work, broker/installer, Action/Run/signer/EvidenceStore work, production default, support claim, child ship/archive, run-state edit, or safety-stash operation was added.
