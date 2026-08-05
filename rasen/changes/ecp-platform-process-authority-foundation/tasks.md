## 1. Contract baseline and RED harness

- [x] 1.1 Inventory the current `ProcessScope`, native ProcessCapsule resolver/manifest, registry `runtimeRef`, and host authority-release call sites; record the exact additive edit boundary and the still-open closure findings in `evidence/implementation-baseline.md` before changing product code.
- [x] 1.2 Add a compile-time/public-surface RED test proving Session/backend consumers cannot construct or read PID, PGID, Job, broker, namespace, handle, or provider-owned fields from the proposed authority contract.
- [x] 1.3 Add a public-seam RED test fixture for an explicit deterministic provider and prove the test fails because no `ProcessAuthorityProvider` contract, exact descriptor, or coordinator exists yet.
- [x] 1.4 Add a production-registry RED assertion proving the foundation starts with no registered operating-system provider and cannot label the current native ProcessCapsule as conformant.
- [x] 1.5 Run the new focused files individually, capture the intended assertion failures in `evidence/red-baseline.md`, and confirm failures arise from missing public behavior rather than syntax, fixture, or private-call expectations.

## 2. Exact provider descriptor and closed registry

- [x] 2.1 Add RED cases for exact provider/capability/protocol tuple registration and dispatch, including a successful exact lookup whose selection is preserved without normalization.
- [x] 2.2 Add RED cases for duplicate provider ids, duplicate tuples, conflicting descriptors, malformed ids, and registry mutation after construction.
- [x] 2.3 Add RED cases proving absent providers and partial recursive-scope capabilities return `authority-unavailable` without registration-order, PID-tree, PGID, or weaker-capability fallback.
- [x] 2.4 Implement immutable `ProcessAuthorityProviderDescriptor`, exact selection, operation-context, provider input/reference, observation, and control-outcome types in `src/core/session-host/process-authority/` with the recursive-scope capability constants defined in one named list.
- [x] 2.5 Implement a finite closed registry with full construction-time validation, exact map lookup, duplicate rejection, copy-safe descriptors, and no implicit `process.platform` selection policy.
- [x] 2.6 Implement fail-closed availability/selection results so no provider call occurs when the exact tuple or indivisible recursive-scope semantics are absent.
- [x] 2.7 Run the registry/contract test file and `pnpm exec tsc --noEmit`; prove exact dispatch is GREEN while the production registry remains empty.

## 3. Versioned opaque authority-reference envelope

- [x] 3.1 Add RED cases for canonical encode/decode/re-encode of the exact provider tuple, provider-reference version, bounded opaque provider bytes, and integrity identity through only the branded public reference.
- [x] 3.2 Add RED mutation cases for truncated/base64-invalid data, non-canonical encoding, changed payload or digest, duplicate/unknown fields, overlong fields, malformed identities, and mismatched provider/capability/protocol tuples; assert zero provider dispatch.
- [x] 3.3 Add RED cases proving an unknown future envelope version and a known envelope with an unknown provider-reference version remain byte-identical and return retained `authority-unavailable` without rewrite or downgrade.
- [x] 3.4 Add RED API/View/registry-projection cases proving decoded provider bytes and native PID/PGID/Job/broker/namespace/handle fields cannot cross the public seam or appear in JSON/log-safe views.
- [x] 3.5 Implement the branded `rasen-process-authority/1:<base64url>` type and internal closed-schema canonical codec with explicit key lists, cross-platform-safe string handling, and bounded field lengths.
- [x] 3.6 Implement canonical integrity-digest creation and constant-time digest comparison, document/test that it detects corruption but does not substitute for provider-native identity or signer authority.
- [x] 3.7 Implement typed non-dispatchable parse results that retain the original reference bytes for malformed, tampered, unknown-version, or tuple-mismatch recovery paths.
- [x] 3.8 Run the reference/public-surface tests and typecheck; prove every mutation is GREEN only by fail-closed behavior and that no public decoder/native-control escape was added.

## 4. Prepare, publish, activate, and abort state machine

- [x] 4.1 Add RED cases proving successful prepare is inert, exact durable publication produces `published-inert`, and only the published capability can activate the same reference once.
- [x] 4.2 Add the required activate-before-publication RED mutation and prove it cannot start workload code, cannot synthesize publication, and leaves bounded abort/reconciliation available.
- [x] 4.3 Add RED cases for publication acknowledgments with a different reference digest, version, preparation operation id, duplicate acknowledgment, or acknowledgment after abort.
- [x] 4.4 Add RED cases for duplicate/concurrent activation, abort racing publication, activation racing abort, and a provider outcome delivered after the state transition; assert one semantic settlement and no second workload start.
- [x] 4.5 Implement the coordinator's runtime-checked `PREPARING -> PREPARED_INERT -> PUBLISHING -> PUBLISHED_INERT -> ACTIVATING -> LIVE` transitions with explicit abort and retained-failure branches.
- [x] 4.6 Implement a bounded, exact publication-acknowledgment token that binds the prepared reference and operation/version without carrying Action, Run, signer, prompt, result, or native control material.
- [x] 4.7 Implement exactly-once publication, activation, and prepared-abort guards at both the type seam and runtime so forged casts or concurrent callers cannot bypass ordering.
- [x] 4.8 Map unsuccessful prepared abort to its precise retained failure and exact successful abort only to `exact-scope-empty`; never assume provider/controller death closed the authority.
- [x] 4.9 Run the lifecycle mutation file repeatedly with an injected scheduler/clock and prove deterministic GREEN settlement without sleeps, private call-count coupling, or production test switches.

## 5. Exact observation and release truth

- [x] 5.1 Add RED cases proving `root-exited` carries backend status but remains distinct from exact-scope-empty and keeps inspect/terminate authority available.
- [x] 5.2 Add RED cases proving exactly one provider-proven natural or controlled `exact-scope-empty` receipt is the only outcome eligible to release durable ownership/capacity.
- [x] 5.3 Add RED cases for post-publication `authority-unavailable` and `authority-uncertain`; assert the exact reference, publication fact, and no-restart/no-release disposition are retained.
- [x] 5.4 Add RED cases for `identity-drift` and `event-gap`; assert zero destructive provider control, no optimistic close, and no normalization into generic foreign/closed outcomes.
- [x] 5.5 Implement the exhaustive common discriminated unions for prepared-inert, published-inert, live, root-exited, exact-scope-empty, authority-unavailable, authority-uncertain, identity-drift, event-gap, timeout, and control-loss.
- [x] 5.6 Implement coordinator transition/reconciliation rules so only the exact provider tuple can change a retained authority and root/transport/provider exit never clears it.
- [x] 5.7 Implement one explicit `isExactScopeEmptyReceipt`/release-eligibility seam and use it in the provider-backed compatibility adapter; no other outcome may release a ProcessScope reference.
- [x] 5.8 Run the observation/release tests and a host-facing deterministic discriminator proving registry facts, writer ownership, and capacity remain retained until exact-scope-empty.

## 6. Common bounded-control and single-settlement discipline

- [x] 6.1 Add RED deadline cases for prepare, publish, activate, inspect, terminate, abort, and exact-empty observation using an injected monotonic clock and independently asserted phase identities.
- [x] 6.2 Add RED adapter-authority-loss cases for provider exception, controller/channel close, cancellation, and provider disappearance before exact terminal evidence; assert `control-loss` with retained authority.
- [x] 6.3 Add RED late-result cases in which each timed-out phase later returns success or failure; assert the late value cannot activate, release, terminate twice, or overwrite the recorded result.
- [x] 6.4 Add RED duplicate/conflict cases for identical repeated receipts and incompatible outcomes under one operation id; assert one semantic result and retained control loss for conflicts.
- [x] 6.5 Implement one internal bounded operation runner that supplies phase, operation id, `AbortSignal`, and monotonic deadline, clears its timer once, and quarantines late provider settlement.
- [x] 6.6 Implement an operation ledger/state guard that accepts one semantically identical duplicate receipt idempotently, rejects conflicts, and never mutates state twice.
- [x] 6.7 Ensure every ambiguous outcome after reference creation returns the same opaque reference and a bounded diagnostic while pre-reference unavailability starts no workload and creates no false authority.
- [x] 6.8 Run the deadline/control-loss tests under fake time plus real event-loop settlement; prove bounded completion, no leaked timers/listeners, and no sleep-based flakiness.

## 7. Closed descriptor/manifest negotiation and rollback

- [x] 7.1 Add RED cases for provider, capability, protocol, provider-reference, and common-contract version mismatch across selection, runtime descriptor, envelope, and manifest.
- [x] 7.2 Add RED manifest cases for unknown/missing fields, duplicate entries, malformed bounds, missing recursive-scope semantics, path separator variants, and descriptor mutation after validation.
- [x] 7.3 Add RED rollback cases proving an older envelope/runtime/provider cannot rewrite, downgrade, inspect, terminate, or strengthen a newer reference or legacy PID/PGID fact.
- [x] 7.4 Implement a platform-neutral closed provider-manifest entry/schema validator using exact named key/capability constants and `path.join`/`path.resolve` for any fixture paths.
- [x] 7.5 Bind registry construction/resolution to exact equality between validated manifest entries and immutable runtime descriptors before any provider preparation or recovery dispatch.
- [x] 7.6 Implement exact recovery dispatch from the envelope tuple; a missing/mismatched tuple returns retained `authority-unavailable` and preserves the original bytes with no alternate-provider probe.
- [x] 7.7 Run manifest/reference tests with Windows, Linux, and macOS path-shaped fixtures on the current host and record that these are cross-platform contract tests, not actual provider runtime evidence.

## 8. Reusable conformance harness and additive ProcessScope adaptation

- [x] 8.1 Extract the GREEN public-seam scenarios into `test/helpers/process-authority-provider-conformance.ts` as one suite factory whose assertions do not depend on provider-private calls or operating-system-native fields.
- [x] 8.2 Define the fixture/mutation contract and exact named mutation catalog for activate-before-publication, tuple/manifest mismatch, reference tamper/future version, optimistic close, unavailable/uncertain retention, identity drift, event gap, timeout, control loss, duplicate/late outcomes, and adapter authority loss.
- [x] 8.3 Demonstrate mutation sensitivity one mutation at a time: each enabled faulty behavior must make the unchanged suite RED, and disabling it through the production contract must return the same assertion GREEN.
- [x] 8.4 Implement the explicit deterministic provider/fixture with injected clock, event source, and operation outcomes only under test/support code; ensure it is absent from the production provider registry and package selection.
- [x] 8.5 Re-run the common suite through the deterministic fixture after extraction and add an import-only contract proving later Linux, Windows, and macOS fixtures can consume the suite without copying its scenario body.
- [x] 8.6 Add RED compatibility-adapter cases mapping common prepare/publish/activate/root-exit/exact-empty/retained outcomes to the existing opaque `ProcessScope` semantics without exposing provider data.
- [x] 8.7 Implement opt-in `createProviderBackedProcessScope(...)` and common-to-ProcessScope outcome mapping; do not wire it as the Management/Session default or wrap the existing native ProcessCapsule.
- [x] 8.8 Add migration tests proving existing `rasen-process-scope/1` values remain byte-preserved on the legacy path, unknown future values fail closed, and PID/PGID facts are never promoted into a new authority envelope.
- [x] 8.9 Audit production imports/registrations and add a negative test proving this Change adds no Linux, Windows, macOS, broker, installer, entitlement, signing, VM, native protocol/manifest revision, or support-claim implementation.
- [x] 8.10 Run the unchanged conformance suite, compatibility/migration tests, and the pre-existing ProcessScope contract/package/migration tests; record deterministic/common versus legacy-preservation evidence separately.

## 9. Verification, independent review, and local child lifecycle

- [x] 9.1 Run the complete focused foundation command over provider contract, registry, reference, lifecycle, outcomes, deadlines, manifest, conformance, compatibility adapter, migration, and public-surface files with `--maxWorkers=1 --minWorkers=1`.
- [x] 9.2 Run the full existing `test/core/session-host` suite plus Management hosted-session recovery/shutdown, daemon half-start/convergence, agent CLI process, and Session CLI E2E tests; repair only foundation-owned regressions.
- [x] 9.3 Run `pnpm run build`, `pnpm run lint`, `pnpm exec tsc --noEmit`, and `git diff --check`; keep every production control/output/deadline bound and cross-platform path rule intact.
- [x] 9.4 Run `pnpm test` after the final implementation fix and preserve the complete root receipt without deleting or adopting unrelated retained test outputs.
- [x] 9.5 Run `pnpm --dir packages/ui run typecheck`, `pnpm --dir packages/ui run test`, and `pnpm --dir packages/ui run build` to prove the internal common seam does not regress consumers despite adding no UI.
- [x] 9.6 Run `node bin/rasen.js validate ecp-platform-process-authority-foundation --strict` and record all four apply artifacts plus requirement/scenario/task coverage.
- [x] 9.7 Produce `evidence/implementation-report.md` mapping every `process-authority-provider` scenario to exact public code, RED-to-GREEN test, and command, explicitly labelling all evidence deterministic/common and all actual-OS provider receipts unexecuted and out of scope.
- [x] 9.8 Audit the final diff and package output for forbidden OS adapters, PID-tree/PGID fallback, broker/install/signing/entitlement/VM work, Action/signer/Run authority, native protocol/manifest integration, support claims, secrets, unrelated Change/run-state files, retained temp outputs, or safety-stash content.
- [x] 9.9 Dispatch a fresh non-author security review over opaque-reference integrity, provider/manifest dispatch confusion, publication ordering, retained authority, timeout/control-loss races, rollback, native-field leakage, command/path injection, and forbidden signer/Run crossing; resolve every Blocker/Major.
- [x] 9.10 Dispatch a separate fresh non-author code/spec review over all eight requirements, exact outcome/state coverage, mutation sensitivity, registry/codec depth, compatibility migration, deterministic-versus-runtime truth, and exclusions; resolve every Blocker/Major through a bounded fix/re-review loop.
- [x] 9.11 After the final review fix, rerun tasks 9.1-9.8 plus every affected discriminator and record final 0-Blocker/0-Major security and code/spec verdicts.
- [ ] 9.12 Run local `rasen-ship` only after tasks 9.1-9.11 are complete; create this child commit with `Mode: local`, no push, no child PR, and no unrelated retained files.
- [ ] 9.13 Immediately dispatch `rasen-archive-change` after local ship and record real archive evidence as done; use skipped only if ship evidence explicitly reports `Archived in ship`.
- [ ] 9.14 Return terminal foundation evidence to the ECP-7 parent without making Linux/Windows runnable before real local ship/archive, moving the decision-deferred macOS node, resuming ProcessCapsule closure, or claiming any platform/release support.
