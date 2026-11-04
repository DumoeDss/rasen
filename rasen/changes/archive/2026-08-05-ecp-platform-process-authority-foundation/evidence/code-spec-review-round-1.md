# Code/spec review round 1: platform process-authority foundation

Date: 2026-08-05

Mode: dispatched, report-only, fresh non-author reviewer B

Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`

Reviewed HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`

## Verdict

**CODE/SPEC REVIEW VERDICT: FAIL — Blocker: 4, Major: 5, Minor: 0, Trivial: 0.**

Pre-Landing Review: **9 issues** (4 Blocker, 5 Major). No fix was applied.

| Severity | Count |
|---|---:|
| Blocker | 4 |
| Major | 5 |
| Minor | 0 |
| Trivial | 0 |
| Total | 9 |

Scope Check: **REQUIREMENTS MISSING**

Intent: freeze a platform-neutral, fail-closed provider contract with exact manifest dispatch, opaque references, bounded lifecycle/control, reusable conformance, and additive ProcessScope adaptation.

Delivered: the intended eight-module common seam and deterministic support exist and exclusions remain intact, but mandatory manifest binding, exact deadline enforcement, safe reference reuse, and portions of the required lifecycle/conformance contract are incomplete.

## Findings

### B-001 — Blocker — Non-empty provider dispatch bypasses the mandatory manifest gate

- Locations: `src/core/session-host/process-authority/registry.ts:95-101`, `src/core/session-host/process-authority/coordinator.ts:153-159`, `src/core/session-host/process-authority/coordinator.ts:490-497`.
- Tests that currently legitimize the bypass: `test/core/session-host/process-authority-registry.test.ts:77-80`, `test/core/session-host/process-authority-public-surface.test.ts:52-73`, `test/helpers/process-authority-provider-conformance.ts:68-74`, `test/helpers/process-authority-provider-conformance.ts:196-201`.
- Spec obligation: `specs/process-authority-provider/spec.md:118-135` requires descriptor/manifest equality before dispatch and says a missing or mismatched closed manifest fails before preparation.
- Failure path: `new ProcessAuthorityProviderRegistry([provider])` and `createProcessAuthorityCoordinator({ providers: [provider] })` are public, accepted constructions. Because registry `options` are optional, the provider is selected and `prepare` is invoked without any manifest entry. A missing, stale, rollback, or mismatched packaged artifact therefore bypasses the gate entirely; manifest validation is only exercised when a caller voluntarily supplies it.
- Fresh read-only probe: an unmanifested non-empty registry returned `selected` for the exact tuple.
- Required action: make exact manifest binding mandatory for every non-empty runtime registry/coordinator. If an unmanifested deterministic constructor is needed, keep it explicitly test-only and unavailable through the production/public surface. Add a no-manifest negative test that proves zero provider dispatch.
- Routing: ASK / non-author fix.

### B-002 — Blocker — A reused provider reference receives a stale authentic exact-empty receipt without inspection

- Locations: `src/core/session-host/process-authority/coordinator.ts:504-558`, `src/core/session-host/process-authority/coordinator.ts:712-768`, `src/core/session-host/process-authority/coordinator.ts:867-892`, `src/core/session-host/process-authority/coordinator.ts:895-920`.
- Conformance fixture that makes reuse possible without detecting it: `test/helpers/deterministic-process-authority-provider.ts:39-41` returns the same provider reference for every preparation.
- Spec obligation: `specs/process-authority-provider/spec.md:68-77` makes provider-proven exact empty for the exact current recursive authority the sole release fact.
- Failure path: authority A returns `exact-scope-empty`, which is cached only by opaque reference string. The same provider then prepares and activates authority B using the same reference bytes. `inspect(B)` hits `exactEmptyReceipts` and returns A's runtime-authentic release receipt without calling the provider. The host can release a live authority B.
- Fresh read-only probe: two preparations activated under one reused reference; after the first was terminated exact-empty, the second `inspect` returned authentic `exact-scope-empty` with `inspectCalls === 0`.
- Impact: this is a false clean-release receipt and silent authority/capacity corruption, not merely a test gap.
- Required action: freeze a non-reuse/generation identity rule in the provider contract and shared conformance suite, and reject a newly prepared reference that collides with an active or retired authority identity. Do not make cache deletion alone the safety rule.
- Routing: ASK / non-author fix.

### B-003 — Blocker — The runner records a monotonic deadline but accepts results after it

- Locations: `src/core/session-host/process-authority/coordinator.ts:561-577`, `src/core/session-host/process-authority/coordinator.ts:637-669`, `src/core/session-host/process-authority/coordinator.ts:695-707`.
- Coverage gap: `test/core/session-host/process-authority-deadlines.test.ts:203-243` and `:245-313` cause timeout only by explicitly invoking the scheduler callback; no test advances `clock.now()` past `context.deadline` while the callback is delayed.
- Spec obligation: `specs/process-authority-provider/spec.md:95-108` requires one monotonic phase-deadline discipline and quarantines provider success produced after timeout.
- Failure path: the timer callback is delayed or withheld, monotonic time advances beyond `context.deadline`, and the provider then resolves. `settle({ state: 'settled' })` never compares `clock.now()` with the stored deadline, so late `live`, activation, termination, or exact-empty evidence is accepted as on-time.
- Fresh read-only probe: with a 10 ms configured timeout, an injected clock advanced from 0 to 100 before provider resolution while the timer callback was withheld; `inspect` returned `live`, not `timeout`.
- Impact: the advertised bound is not a monotonic bound, and late terminal evidence may release or mutate authority after the deadline.
- Required action: enforce the monotonic deadline at settlement as well as through scheduling, and add delayed-scheduler probes for every state-mutating/release-capable phase.
- Routing: ASK / non-author fix.

### B-004 — Blocker — The reusable provider conformance suite can pass a provider with a broken abort contract

- Locations: `test/helpers/process-authority-provider-conformance.ts:68-148`, `test/helpers/process-authority-provider-conformance.ts:182-313`.
- Supporting evidence: there is no invocation of `prepared.abort(...)` or provider abort anywhere in the shared helper. The measured probe covers activation, inspect, terminate, and one inspect-timeout path; it separately constructs a manifest-bound registry at `:186-194` but performs the actual lifecycle with an unmanifested coordinator at `:196-201`.
- Spec obligation: `specs/process-authority-provider/spec.md:141-158` and `design.md:142-150` require one unchanged suite covering abort exactness, negotiation, envelope mutations, all bounded phases, duplicate/late outcomes, and authority loss for every later platform fixture.
- Failure path: a future Linux/Windows/macOS fixture can return optimistic `exact-scope-empty`, `live`, or an exception from prepared abort and still pass the unchanged suite because abort is never called. Likewise, manifest success is measured independently from the coordinator used for workload activation, so the harness does not prove manifest-gated dispatch.
- Impact: a provider can receive a common-conformance GREEN result while violating a mandatory lifecycle/release operation. That makes the required acceptance artifact materially false.
- Required action: move the full public behavior matrix into the shared suite: prepared/published abort, exact manifest-bound dispatch, publication mismatch, canonical/tampered/future reference recovery, natural empty, every bounded phase, and real duplicate/late settlement behavior. Each future fixture must run those assertions unchanged.
- Routing: ASK / non-author fix.

### M-001 — Major — Recovery loses the valid `published-inert` lifecycle fact

- Locations: `src/core/session-host/process-authority/types.ts:93-101`, `src/core/session-host/process-authority/coordinator.ts:114-119`, `src/core/session-host/process-authority/coordinator.ts:432-480`.
- Spec obligation: `specs/process-authority-provider/spec.md:45-69` requires `prepared-inert`, `published-inert`, `live`, `root-exited`, and `exact-scope-empty` to remain distinct.
- Failure path: after durable publication but before activation, a replacement coordinator reopens the exact reference and the provider validly reports `{ state: 'published-inert' }`. `normalizeProviderOutcome` accepts that state, but `attachProviderOutcome` has no lifecycle case for it and returns `control-loss` (`Provider returned published-inert during inspect.`). `ProcessAuthorityLifecycleOutcome` cannot express it, and recovery exposes no published activation/abort capability.
- Fresh read-only probe: a valid `published-inert` inspection returned retained `control-loss`.
- Required action: represent the inert recovery states explicitly and define the safe recovery transition (activate only with the exact durable publication identity, otherwise bounded abort/reconciliation). Add the crash-between-publish-and-activate discriminator.
- Routing: ASK / non-author fix.

### M-002 — Major — A valid control outcome can erase root-exit status

- Locations: `src/core/session-host/process-authority/types.ts:93-106`, `src/core/session-host/process-authority/coordinator.ts:324-335`, `src/core/session-host/process-authority/coordinator.ts:447-454`.
- Spec obligation: `specs/process-authority-provider/spec.md:68-73` says `root-exited` carries the backend status while authority remains retained.
- Failure path: `ProviderControlOutcome` explicitly permits `{ state: 'root-exited' }` with no `code` or `signal`. Normalization accepts that exact one-field shape, and attachment synthesizes `code: null, signal: null`. A terminate/abort reconciliation can therefore discard the real backend status while still returning a valid common `root-exited` outcome.
- Fresh read-only probe: a contract-valid statusless control outcome returned common `root-exited` with both status fields set to null.
- Required action: require the same exact `code`/`signal` payload for every root-exited provider outcome, including control outcomes, and reject a statusless value as control loss. Add terminate/abort status-fidelity coverage.
- Routing: ASK / non-author fix.

### M-003 — Major — The adapter's actual durable publication operation is unbounded

- Locations: `src/core/session-host/process-authority/process-scope-adapter.ts:156-176`, `src/core/session-host/process-authority/coordinator.ts:801-820`.
- Spec obligation: `specs/process-authority-provider/spec.md:45-66` and `:95-108` require publication to have a bounded outcome.
- Failure path: `PreparedProcessScope.activate()` awaits `options.publishAuthority(...)` before entering coordinator `publish`. If that durable writer never resolves, no coordinator timer, signal, or operation context covers it; the later bounded `publish` phase wraps only `async () => true`, after an acknowledgement already exists. Activation hangs indefinitely and cannot reach its abort/reconciliation branch.
- Fresh read-only probe: with `operationTimeoutMs: 5`, a never-settling `publishAuthority` callback was still pending after 25 ms.
- Required action: put the durable publication callback itself under the common publish deadline/AbortSignal and return a typed retained outcome on timeout/control loss. Preserve the exact reference for host reconciliation.
- Routing: ASK / non-author fix.

### M-004 — Major — Prepare timeout/cancellation is collapsed into permanent capability unavailability

- Locations: `src/core/session-host/process-authority/coordinator.ts:145-151`, `src/core/session-host/process-authority/coordinator.ts:734-739`, `src/core/session-host/process-authority/process-scope-adapter.ts:144-151`.
- Tests that assert the collapse: `test/core/session-host/process-authority-deadlines.test.ts:115-139`, `test/core/session-host/process-authority-deadlines.test.ts:339-367`.
- Spec obligation: `specs/process-authority-provider/spec.md:95-104` requires a timeout result for the exact phase; `design.md:122-128` allows pre-reference unavailability or a typed prepare failure without losing lifecycle truth.
- Failure path: bounded prepare returns `timeout` or `control-loss`, but `prepare()` rewrites either as `authority-unavailable` and drops the phase/state. The ProcessScope adapter then throws `containment-unsupported`, making a transient deadline/cancellation indistinguishable from an absent/weak provider.
- Required action: add typed pre-reference `timeout`/`control-loss` preparation results with phase `prepare`, and map them to `process-control-timeout` / `process-control-lost` rather than `containment-unsupported`.
- Routing: ASK / non-author fix.

### M-005 — Major — Mutable/unbounded operation inputs can diverge from their ledger identity or escape typed settlement

- Locations: `src/core/session-host/process-authority/coordinator.ts:519-521`, `src/core/session-host/process-authority/coordinator.ts:721-731`, `src/core/session-host/process-authority/coordinator.ts:906-910`; public readonly intent/input shapes are at `src/core/session-host/process-authority/types.ts:63-75`.
- Failure path 1: prepare hashes a copied view of `args`/`env`, then asynchronously dispatches the original caller-owned `input`. Mutation before the microtask changes what the provider executes without changing the recorded operation identity. Terminate similarly hashes then passes the original mutable `intent`.
- Failure path 2: `operationIdentity` directly `JSON.stringify`s runtime input before entering the bounded runner. A JS caller can supply BigInt/circular/accessor-hostile data and receive a thrown exception instead of a typed retained outcome; large values also bypass a declared control-input bound.
- Fresh read-only probe: mutating `args` and `intent.reason` immediately after the calls changed the values received by the provider; a BigInt `graceMs` threw `TypeError: Do not know how to serialize a BigInt`.
- Required action: validate, bound, copy, and freeze selection/prepare/termination inputs once; derive the ledger identity and provider call from that same immutable snapshot. Convert invalid runtime values to typed fail-closed outcomes before dispatch.
- Routing: ASK / non-author fix.

## Requirement/scenario audit

All **8/8 requirements and 38/38 scenarios were inspected** against the exact implementation and tests. The counts below are scenario inventory counts, not claims that affected scenarios pass.

| Requirement | Scenarios inspected | Assessment |
|---|---:|---|
| 1. Exact provider selection | 4/4 | Exact tuple/semantic mechanics exist; mandatory packaged identity is defeated by B-001. |
| 2. Opaque reference envelope | 5/5 | Codec/reference depth is otherwise coherent: canonical closed schema, bounded bytes, future-version retention, internal decoding, and corruption-only digest semantics are present. |
| 3. Prepare/publish/activate ordering | 5/5 | Local state guards are present; actual publication is unbounded (M-003), prepare phase truth is collapsed (M-004), and replacement published-inert truth is missing (M-001). |
| 4. Exact lifecycle observations | 6/6 | Retained failures and authentic release predicate exist; stale receipt reuse (B-002), published-inert loss (M-001), and statusless root exit (M-002) prevent conformance. |
| 5. Bounded retained control | 5/5 | Late-result quarantine and a bounded ledger exist; monotonic expiry is not enforced (B-003), publication is outside the bound (M-003), and input/identity settlement can escape (M-005). |
| 6. Closed manifest negotiation | 5/5 | Validator depth is present when invoked; invocation is optional on the production/public construction path (B-001). |
| 7. Reusable conformance harness | 4/4 | Deterministic mutations exist, but the unchanged platform suite omits mandatory operations and can falsely pass (B-004). |
| 8. Additive migration | 4/4 | Empty production registry, opt-in adapter, legacy byte preservation, and no OS/release claim are intact; adapter outcome/deadline semantics remain affected by M-003/M-004. |

## Coverage and mutation assessment

```text
CODE/SPEC COVERAGE
==================
[reviewed] 8/8 requirements
[reviewed] 38/38 scenarios
[reviewed] 8/8 product modules
[reviewed] 9/9 focused test files
[reviewed] 2/2 shared test helpers

[covered deeply] closed codec mutations, exact tuple lookup, local ordering races,
                 retained observation vocabulary, hostile fulfilled outcomes,
                 operation-id reservation, manifest schema/path validation
[gap/blocker]    non-empty registry without manifest
[gap/blocker]    provider-reference non-reuse / stale exact-empty cache
[gap/blocker]    monotonic time beyond deadline without timer callback
[gap/blocker]    unchanged provider abort conformance
[gap/major]      published-inert recovery, control-path root status,
                 bounded durable publication, typed prepare timeout,
                 immutable bounded operation inputs
```

The mutation harness's named mutations are not equivalent to complete scenario sensitivity. In particular, `tuple-manifest-mismatch` makes a side validation boolean red while workload operations still use an unmanifested coordinator, and no shared mutation exercises prepared abort. Passing the current helper therefore cannot support the stated future platform-provider conformance claim.

## Probe and evidence notes

- Read every requested source/test/support/Change/evidence/handoff file and `src/core/session-host/process-scope.ts`; inspected only enough native seam/import context to verify additive compatibility and exclusions.
- Ran read-only inline Node probes against the current built common module. They reproduced B-001, B-002, B-003, M-001, M-002, M-003, and M-005 without writing retained output.
- The previously recorded focused result (12 files, 116 passed), full suite, static gates, package audit, and strict validation were reviewed as evidence but were not treated as proof of uncovered invariants. No fresh Vitest gate was necessary to establish the cited failures.
- Cumulative unrelated dirty files were treated as context, not attributed to this Change.

## Exclusion and package-surface result

- CLEAN: no production import outside `src/core/session-host/process-authority/**`, no production/default provider registration, and no native ProcessCapsule wrapping.
- CLEAN: no Linux/Windows/macOS authority provider, PID-tree/PGID fallback, broker/install/signing/entitlement/VM implementation, Action/signer/Run authority crossing, native protocol/manifest revision, or release-support claim was found in the exact target.
- CLEAN: the public index does not export provider-byte decode/create or exact reference-resolution functions; platform-native control fields remain absent from the declared Session-facing types.
- NOT CLEAN: the same public index exposes coordinator/provider construction that permits unmanifested non-empty dispatch (B-001).

## Final gate

The Change is **not eligible for task 9.11, local ship, or archive** from this review. Resolve all four Blockers and five Majors through a non-author fix/re-review loop, rerun every affected discriminator plus tasks 9.1-9.8, then obtain a fresh code/spec verdict.
