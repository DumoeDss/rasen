## 1. Frozen Contracts and Profile Binding

- [x] 1.1 Add strict versioned schemas, bounded decoders, JSON schemas, and deterministic identity helpers for consultation requests, Teacher invocation/advice, source resume/unavailable input, consultation ids, and continuation request ids.
- [x] 1.2 Add the separate `consultable-leaf` worker contract and tests for `DONE | HANDOFF | CONSULT`, preserving the existing `leaf` schema/parser and its rejection of `CONSULT` byte-for-byte.
- [x] 1.3 Extend the runtime execution profile with an optional undefined-dropped consultation binding and validate unique source/Teacher paths, positive bounded limits, agent kind, read-only sandbox, `none | read` workspace authority, and zero effects.
- [x] 1.4 Add profile open/create/digest compatibility tests proving absent bindings preserve existing serialized shapes and digests and invalid/write-capable bindings fail before execution.

## 2. Canonical Consultation Lifecycle

- [x] 2.1 Extend canonical Record contracts with optional consultation state, paused source execution state, signed question/advice attribution, independent counters, and the complete request/Teacher/advice/continuation/unavailable/ambiguity transition vocabulary.
- [x] 2.2 Implement the pure `consultation-lifecycle` module for deterministic ids, gap-free ordinals, state transitions, frozen budget decisions, exact source/Teacher correlation, and idempotent duplicate classification.
- [x] 2.3 Extend reducer decoding and invariants so an attested consultation request pauses but does not complete the source Action, exact duplicates no-op, conflicts fail closed, and terminal/cancel paths close consultation state consistently.
- [x] 2.4 Add canonical record/reducer tests for malformed requests, crossed advice, duplicate identities, gap-free ordinals, budget exhaustion, terminal cleanup, and Record encode/decode/restart round trips.

## 3. Reconciler, Facade, and Projection

- [x] 3.1 Extend reconciler candidates so requested consultations directly admit the frozen Teacher profile, valid advice produces one source continuation grant, and exhausted consultation limits produce one unavailable continuation without changing BoundedLoop strategy counters.
- [x] 3.2 Add an attested consultation submission to the public runtime facade; verify source Action authority, actor/session attribution, evidence bytes, expected Record version, and consultation binding before atomically committing request plus Teacher settlement.
- [x] 3.3 Validate successful Teacher results against `teacher-consultation/advice/1` and the exact consultation/attempt before the ordinary trusted completion commit, then settle advice and continuation in one canonical Record revision.
- [x] 3.4 Extend Action construction/receipts with runtime-owned Teacher invocation input and optional `AgentContinuationGrant` values while preventing caller-supplied capability, model/runtime, limit, advice, or continuation text overrides.
- [x] 3.5 Project one versioned consultation ChangeRunView section with exact identities, state, advice decision, evidence digests, continuation status, failures, and independent used/max counters; add core cross-plane contract tests without implementing Canvas rendering.

## 4. Exact Hosted Session Continuation

- [x] 4.1 Add `continuableTurns` to the executor capability matrix, declare hosted true/in-tool false, and reject consultation-eligible Actions on unavailable or uncontinuable cells before backend work without silent rerouting.
- [x] 4.2 Preserve settled hosted result body/digest/replay/request/stable-Session facts through the production executor and parse/attest the selected terminal or consultable step only after frozen Action authority validation.
- [x] 4.3 Replace Action-only hosted request identity with deterministic fresh-step and consultation-continuation request identities that replay settled acknowledgements without colliding or resending input.
- [x] 4.4 Implement continuation-grant validation and exact `SessionHost.execute(sessionId)` wake with runtime-serialized committed advice, wiring the existing same-Invocation/role/workspace/backend reuse policy and rejecting cross-authority or caller-substituted input.
- [x] 4.5 Wire the daemon execution face to return/consume consultation step submissions and continuation grants through the same production executor and canonical Facade path, leaving Canvas authoring/observability endpoints to the dependent change.
- [x] 4.6 Add executor/SessionHost tests for same stable/backend Session identity, Teacher/source Session separation, stale Record versions, retired/cwd-mismatched Sessions, settled replay, host restart, and sent-but-ambiguous continuation without automatic resend.

## 5. Read-only Teacher Workspace Coordination

- [x] 5.1 Add an exact consultation-sponsored read operation to the workspace reservation registry, requiring the same Run/workspace, the source writer reservation, canonical paused source Action, and matching consultation identity.
- [x] 5.2 Integrate sponsored Teacher reads with facade admission/release so the source writer remains exclusive, unrelated readers/writers remain blocked, and `workspace.access: none` Teachers require no reservation.
- [x] 5.3 Fail closed on Teacher write authority, declared effects, workspace mutation/effect observation, sponsor mismatch, or stale consultation state, and cover each guard with a discriminating mutation test.
- [x] 5.4 Extend reservation-delta recovery, cancel, failure, and terminal cleanup tests so source and sponsored reservations cannot leak or be released in the wrong order after a crash.

## 6. End-to-end and Compatibility Verification

- [x] 6.1 Add a deterministic runtime fixture proving implementer `CONSULT` -> direct read-only Teacher Action -> `plan | correction | stop` advice -> exact source Session continuation, with no LEAD Action and with full question/advice attribution.
- [x] 6.2 Add replay/restart journey tests at every commit boundary: request before/after Record commit, Teacher before/after advice commit, advice before continuation send, settled continuation acknowledgement loss, and ambiguous sent continuation.
- [x] 6.3 Add BoundedLoop integration tests proving consultation transitions do not advance iteration/progress/blocker/strategy state, strategy and consultation counters are independent, and the eventual source result follows existing loop behavior.
- [x] 6.4 Run no-binding legacy Record/profile fixtures and existing bounded-loop, facade, executor, SessionHost, worker-contract, projector, and reservation suites to prove additive compatibility.
- [x] 6.5 Run real current-host hosted Session tests plus deterministic Windows/POSIX branch fixtures using platform-aware path construction; record non-host branches as simulated rather than real OS evidence.
- [x] 6.6 Export the frozen consultation contracts from the core public seams, run focused Vitest suites during iteration, then run TypeScript checks and the repository build once after integration.
- [x] 6.7 Validate `teacher-consultation-runtime` with Rasen and confirm the downstream workflow/registry and Canvas changes can consume the exported binding/invocation/advice/continuation/view contracts without duplicating runtime schemas.

## 7. Exact Teacher Provider Production Assembly

- [x] 7.1 Add a server-owned exact-Teacher authority policy that resolves one manifest-bound provider tuple for the current host and exposes typed pre-activation availability without accepting provider, backend, exactness, limits, cwd, PID, name, ProcessRef, or receipt input from callers.
- [x] 7.2 Assemble the Linux primary/broker production provider bundles, authenticated manifest-bound registry, coordinator, publication ledger, preparation-delivery recovery where applicable, and frame-preserving runtime bridge under the management host state root.
- [x] 7.3 Complete and assemble the Windows production provider Adapter, including a frame-preserving runtime bridge and durable publication path, so the packaged helper can carry hosted turn I/O without allowing workload bytes to forge authority outcomes.
- [x] 7.4 Keep the ordinary/source SessionHost on its existing declared best-effort ProcessScope and construct a separate exact Teacher lane backed only by `createProviderBackedProcessScope`; do not change generic hosted cancellation or release claims.
- [x] 7.5 Report macOS and any Windows/Linux host lacking an authenticated exact provider as typed exact-Teacher authority unavailable before preparation or workload activation, with no best-effort or PID/name fallback.

## 8. Durable Exact Authority and Receipt Plumbing

- [x] 8.1 Add a bounded durable Teacher-attempt journal that binds the provider tuple, opaque ProcessRef, Run/Action/Invocation/attempt, stable Session, deterministic request, hosted receipt identity, and current exact-attempt phase without persisting PID, process name, native handles, or result bodies.
- [x] 8.2 Extend the exact Teacher Session registry facts and strict decoders so the attempt journal, SessionHost registry, canonical Record, and provider publication ledger form one identity-checked restart union and preserve unknown/future authority bytes fail closed.
- [x] 8.3 Add authenticated exact-retirement receipt plumbing from `ExactProcessAuthority` through the provider-backed ProcessScope and exact Teacher SessionHost, exposing release only for the coordinator-minted `ExactScopeEmptyReceipt` bound to the persisted ProcessRef.
- [x] 8.4 Implement phase recovery/reconciliation for canonical preflight, baseline capture, provider prepare, durable publish, activation, request send/settle, result quarantine, hosted-receipt verification, retirement, final observation, validation, and canonical settlement.
- [x] 8.5 Make root exit, declared-unproven terminal, timeout, control/provider loss, foreign or stale reference, identity drift, event gap, malformed journal, and tuple mismatch retain or recover exact authority and forbid optimistic Session/reservation release.

## 9. Deep Exact Teacher Attempt Module

- [x] 9.1 Introduce the domain-specific deep Module `ExactTeacherAttemptModule` with the sole common-caller Interface `executeAndSettle(canonicalLocator)`; resolve all execution and authority facts from the canonical Run, frozen Action, Session registry, and server policy behind the Seam.
- [x] 9.2 Route every Teacher dispatch face through the single entry point and reject legacy Teacher envelopes that submit `hostedSeam`, backend, limits, exact flags, provider selection, ProcessRef, PID/name, receipt, turn input, or reorderable phase commands.
- [x] 9.3 Enforce the fixed ordering: canonical preflight, stable baseline, exact provider prepare/publish, exactly-once execution, result-byte quarantine, durable hosted-receipt verification, exact recursive retirement, stable final manifest fence, strict advice validation, then canonical advice or safe unavailable settlement.
- [x] 9.4 Keep quarantined result bytes outside canonical advice, continuation, projection, and trusted completion until exact retirement and final observation succeed; discard or retain them according to the durable authority disposition without parsing them as advice early.
- [x] 9.5 Implement failure disposition so pre-activation unavailability settles typed unavailable safely, post-activation retained authority produces no advice or source continuation, and bounded retry/unavailable settlement occurs only after the exact prior attempt has an authenticated safe disposition.
- [x] 9.6 Release the sponsored Teacher reservation only after exact authority is empty (or no activation occurred), retain it while authority is live/uncertain, always retain the paused source writer until canonical source continuation/terminal settlement, and recover those decisions idempotently after restart.

## 10. Stable Final Workspace Fence

- [x] 10.1 Refactor workspace observation into a bounded no-follow manifest module that records canonical path, entry kind, identity, type/mode, size, `mtimeNs`, and `ctimeNs` for tracked, untracked, and ignored entries while preserving HEAD/index, byte, entry, and diagnostic bounds.
- [x] 10.2 Add post-read `fstat` validation for every regular file and reject identity, type/mode, size, `mtimeNs`, or `ctimeNs` drift between initial `lstat`, open, read, and final `fstat`.
- [x] 10.3 Add post-enumeration and post-children `lstat` validation for every directory, use handle-bound/no-follow traversal where supported, and reject directory replacement, child-set drift, junction/symlink traversal, or metadata instability.
- [x] 10.4 Permit a bounded whole-observation retry only for an explicit internal-instability classification; make permission, path, decoding, bounds, unsupported entry, and persistent-instability outcomes fail closed without retrying into success.

## 11. Deterministic and Platform Verification

- [x] 11.1 Add the deterministic delayed-child barrier fixture: the Teacher returns valid-looking advice, a contained child waits to mutate/create an early-sorted ignored path while a later bounded entry is scanned, and the test proves retirement prevents the write or the stability fence detects an injected internal race.
- [x] 11.2 Add restart tests at every durable exact-attempt phase and assert the same provider tuple, opaque ProcessRef, Action/Invocation/attempt, stable Session, request, receipt, quarantine, reservation disposition, and exactly-once execution survive replacement.
- [x] 11.3 Run the unchanged provider-neutral conformance harness against the deterministic Adapter plus the Windows and Linux production Adapters, and record actual-OS evidence separately from deterministic cross-target simulations.
- [x] 11.4 Add Windows/Linux availability and exact-retirement journeys, macOS typed-unavailable coverage, foreign/stale/tampered receipt and reference cases, and timeout/control-loss/identity-drift/event-gap cases with no best-effort fallback.
- [x] 11.5 Add discriminating consultation journeys proving no advice or continuation is emitted while an exact failure remains unsafe, eventual bounded unavailable settlement is singular after a safe disposition, and sponsored/source reservations are retained or released in the required order.
- [x] 11.6 Re-run ordinary leaf, unbound pipeline, source hosted continuation, generic SessionHost cancellation/retire, BoundedLoop, and management driver suites to prove the exact Teacher lane does not widen existing best-effort behavior.

## 12. Documentation and Re-Verification

- [x] 12.1 Document the exact Teacher lane, provider/platform availability, opaque authority retention and operator-visible waits, quarantine/settlement ordering, and the unchanged ordinary hosted Session semantics without presenting PID/name controls or continuation view limits as authority.
- [x] 12.2 Run focused exact-authority, SessionHost, manifest, consultation, restart, reservation, and management HTTP suites during implementation; then run the full related suite, TypeScript, lint, build, and actual available Windows/Linux provider gates once after integration.
- [x] 12.3 Validate `teacher-consultation-runtime` strictly with Rasen, run `git diff --check`, re-run the B2 delayed-writer proof, and obtain a fresh independent pre-landing review before marking any rework task complete.
