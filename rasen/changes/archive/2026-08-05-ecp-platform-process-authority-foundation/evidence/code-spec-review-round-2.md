# Code/spec re-review round 2

Date: 2026-08-05

Verdict: **FAIL** — 4 Blocker, 5 Major, 0 Minor, 0 Trivial.

This was a fresh, report-only review of the current product, tests, proposal,
design, delta spec, round-1 code/spec report, and round-1 fix evidence. The
fixer's conclusions were treated as claims to re-prove, not as acceptance
evidence. No product, test, task, runstate, Direction, portfolio, ship, archive,
or commit state was changed.

| Severity | Count |
| --- | ---: |
| Blocker | 4 |
| Major | 5 |
| Minor | 0 |
| Trivial | 0 |
| Total | 9 |

Scope Check: **REQUIREMENTS MISSING**

The round-1 fix materially improved the implementation: ordinary non-empty
registries now require a manifest, fulfilled results are checked against the
monotonic deadline, the real publisher callback is bounded, inert recovery is
typed, prepare failures retain their type, the public reference view is
redacted, and the shared suite is much broader. Those changes do not close the
gate because manifest authority is still forgeable, recovery references are not
tombstoned, a mutable prepared reference can produce a false release receipt,
and the shared conformance suite can still certify an abort-incapable provider.

## Findings

### B-001 — Blocker — A manifestless registry subclass still reaches provider dispatch

- Locations: `src/core/session-host/process-authority/registry.ts:118-127`,
  `src/core/session-host/process-authority/registry.ts:165-187`,
  `src/core/session-host/process-authority/registry.ts:198-219`,
  `src/core/session-host/process-authority/coordinator.ts:606-615`, and
  `src/core/session-host/process-authority/coordinator.ts:852-892`.
- Coverage gap: `test/core/session-host/process-authority-public-surface.test.ts:52-73`
  rejects only the removed `providers` option, while
  `test/core/session-host/process-authority-registry.test.ts:77-83` checks only a
  direct non-empty base-class construction.
- Spec obligation: `specs/process-authority-provider/spec.md:154-175` requires
  exact manifest validation before dispatch and zero dispatch for direct raw
  provider construction.
- Failure path: `ProcessAuthorityProviderRegistry` is public and subclassable;
  `select` is an overridable prototype method. A subclass can call `super([])`
  (the valid manifestless empty construction), override `select()` to return a
  raw provider, and pass itself to `createProcessAuthorityCoordinator`. The
  coordinator trusts that override and invokes `provider.prepare` without any
  manifest validation.
- Fresh public-seam probe: a `ManifestlessRegistry extends
  ProcessAuthorityProviderRegistry` returned `prepared-inert` and recorded one
  provider prepare call.
- Impact: the mandatory packaged-identity gate remains bypassable through the
  declared public registry type, so a mismatched or unpackaged provider can
  create authority.
- Required action: make registry provenance/selection non-forgeable at the
  coordinator boundary. A subclass, proxy, look-alike object, or overridden
  method must not supply selection state; add public runtime probes for each
  supported attack shape and assert zero dispatch.

### B-002 — Blocker — Recovery-only references are outside the tombstone ledger and replay stale exact-empty receipts

- Locations: `src/core/session-host/process-authority/coordinator.ts:622-624`,
  `src/core/session-host/process-authority/coordinator.ts:667-678`,
  `src/core/session-host/process-authority/coordinator.ts:872-930`, and
  `src/core/session-host/process-authority/coordinator.ts:1049-1074`.
- Coverage gap: `test/core/session-host/process-authority-outcomes.test.ts:141-155`
  tests reuse only after the same coordinator prepared the first generation.
  Recovery tests at `:175-186` do not attempt reuse.
- Spec obligation: `specs/process-authority-provider/spec.md:91-101` applies
  non-reuse to every active or retired generation the coordinator has observed,
  including replacement recovery.
- Failure path: only successful local `prepare()` adds a reference to
  `referenceLifecycles`. `inspect()` and `terminate()` never register a
  dispatchable recovered reference. A replacement coordinator can therefore
  inspect recovered reference A as exact empty, cache A's authentic receipt,
  accept a later `prepare()` that reuses A, and answer the new generation's
  `inspect()` from the stale cache without provider dispatch.
- Fresh public-seam probe: recovered A returned an authentic exact-empty
  receipt; a second preparation using A returned `prepared-inert`; its next
  inspect returned the old authentic receipt with total provider inspect calls
  still equal to one.
- Impact: a live new authority can receive an authentic-looking clean-release
  receipt from an earlier generation. This is the original false-release class
  of failure on the replacement/recovery path.
- Required action: atomically register every valid recovered reference as an
  observed active generation before any provider observation/control dispatch,
  retire it on exact empty, and apply the same non-reuse/capacity rules to local
  and recovered lifecycles.

### B-004 — Blocker — The unchanged conformance suite can still certify a provider that never completes abort

- Locations: `test/helpers/process-authority-provider-conformance.ts:210-236`,
  `test/helpers/process-authority-provider-conformance.ts:258-313`,
  `test/helpers/process-authority-provider-conformance.ts:355-369`, and
  `test/helpers/process-authority-provider-conformance.ts:438-442`.
- Supporting fixture: `test/helpers/deterministic-process-authority-provider.ts:93-105`.
- Spec obligation: `specs/process-authority-provider/spec.md:181-198` and
  `design.md:154-160` require the unchanged provider suite to exercise prepared
  and published abort exactness and make a false conformance claim RED.
- Failure path: the new prepared/published abort tests deliberately configure
  `authority-uncertain` and assert only that this failure is retained. The only
  other abort in the measured probe ignores its result, and the per-phase
  timeout test times out before meaningful provider behavior is asserted. A
  fixture whose terminate path works but whose abort path always returns
  `authority-uncertain` can therefore pass the complete unchanged suite without
  ever demonstrating the advertised exact recursive-abort capability.
- Impact: the common acceptance artifact can still be GREEN for a provider that
  cannot satisfy an indivisible required capability. Later platform Changes can
  inherit a materially false provider-conformance receipt.
- Required action: add successful prepared and published abort assertions that
  require provider-proven exact empty for the exact generation, retain the
  existing negative abort cases, and add a broken-abort mutation that makes the
  unchanged measured assertion RED.

### B-005 — Blocker — A mutable prepared reference can turn control of B into an authentic release receipt for A

- Locations: `src/core/session-host/process-authority/coordinator.ts:902-930`,
  `src/core/session-host/process-authority/coordinator.ts:939-967`, and
  `src/core/session-host/process-authority/coordinator.ts:1013-1017`.
- Coverage gap: lifecycle providers return plain stable preparation objects;
  hostile fulfilled-outcome coverage in
  `test/core/session-host/process-authority-outcomes.test.ts:244-305` starts only
  after a durable reference already exists.
- Spec obligation: `specs/process-authority-provider/spec.md:49-78` binds
  publication, activation, and abort to the same exact prepared reference, and
  `design.md:44` assigns state transitions and exact identity handling to the
  common coordinator.
- Failure path: preparation validates `providerPrepared.activate`, then reads
  `providerPrepared.reference` to encode public reference A, but later reads the
  property again when calling provider abort. A legal runtime object with an
  alternating getter can return A during encoding and B during abort. If the
  provider accurately returns exact empty for B, the coordinator attaches that
  result to A and mints an authentic exact-empty receipt for A.
- Fresh public-seam probe: the public preparation encoded A, abort received B,
  and the returned result was an authentic `exact-scope-empty` receipt naming A.
- Impact: exact-reference control is confused across generations and the sole
  release predicate can be forged for an authority that was not aborted.
- Required action: normalize the fulfilled preparation once into a closed,
  immutable internal snapshot. Read and validate its reference and activation
  callable exactly once, and use only that captured reference for encoding and
  every later exact control operation.

### M-002 — Major — `{ code: null, signal: null }` is still accepted as complete root-exit status

- Locations: `src/core/session-host/process-authority/types.ts:99-116` and
  `src/core/session-host/process-authority/coordinator.ts:435-445`.
- Coverage gap: `test/core/session-host/process-authority-outcomes.test.ts:188-204`
  rejects missing keys only; it never exercises present-but-empty status.
- Spec obligation: `design.md:124-126` requires exact backend status and rejects
  statusless values; `specs/process-authority-provider/spec.md:83-85` requires
  backend status on root exit.
- Failure path: normalization checks that both keys exist and that each value is
  nullable, but never requires either fact to be present. Both inspect and
  terminate accept `{ state: 'root-exited', code: null, signal: null }` as a
  valid common root exit. For the Node compatibility seam, a completed root exit
  has an exit code or a terminating signal; two nulls describe no exit status.
- Fresh public-seam probe: both inspect and terminate returned common
  `root-exited` with two null status values.
- Required action: freeze and enforce the complete-status invariant (at least
  one of code/signal non-null, or a stronger exact platform-neutral union) in
  types, normalization, adapter tests, and shared conformance.

### M-005 — Major — Multi-read accessors still separate validated prepare/termination data from identity and dispatch

- Locations: `src/core/session-host/process-authority/coordinator.ts:340-405`,
  `src/core/session-host/process-authority/coordinator.ts:638-640`,
  `src/core/session-host/process-authority/coordinator.ts:879-892`, and
  `src/core/session-host/process-authority/coordinator.ts:1088-1101`.
- Coverage gap: `test/core/session-host/process-authority-lifecycle.test.ts:183-199`
  and `test/core/session-host/process-authority-outcomes.test.ts:320-339` cover
  throwing getters, not getters that return different values across reads.
- Spec obligation: `design.md:130-140` and
  `specs/process-authority-provider/spec.md:134-136` require one validated
  immutable snapshot to supply both operation identity and provider dispatch.
- Failure path: `snapshotPrepareInput` reads `command`, `cwd`, `args`, `env`, and
  `windowsVerbatimArguments` repeatedly. `snapshotTerminationIntent` likewise
  rereads `reason` and `graceMs`. An alternating getter can present a valid value
  during checks and a different unchecked value during the final object build.
  The resulting unsafe value may reach the provider or make the later
  `JSON.stringify` operation identity reject outside typed settlement.
- Fresh public-seam probes: a command getter returned `safe` for validation and
  `unsafe\0command` for the snapshot; the provider received the NUL-containing
  command and preparation succeeded. Returning `1n` on the second read rejected
  the public promise with `Do not know how to serialize a BigInt` and zero
  provider calls.
- Required action: use own-property descriptors or one guarded read per allowed
  field, validate that captured value, and build identity/dispatch solely from
  it. Add alternating-getter cases for every prepare and termination field.

### M-006 — Major — Rejection after the monotonic deadline is typed as control loss instead of timeout

- Locations: `src/core/session-host/process-authority/coordinator.ts:815-848`,
  especially the rejection handler at `:843-847`.
- Coverage gap: the all-phase delayed-scheduler table in
  `test/core/session-host/process-authority-deadlines.test.ts:309-399` resolves
  fulfilled values only. Provider rejection coverage at `:472-494` does not
  advance monotonic time past the deadline.
- Spec obligation: `specs/process-authority-provider/spec.md:123-144` says an
  operation that does not settle before its monotonic phase deadline returns
  `timeout`; the discipline covers success or failure settlement.
- Failure path: the fulfillment branch rereads `clock.now()`, but the rejection
  branch directly settles `control-loss`. If the scheduler callback is delayed,
  the provider rejects after `context.deadline`, and the operation reports the
  wrong retained reason for every phase that uses the shared runner.
- Fresh public-seam probe: an inspect promise rejected at monotonic time 11 with
  a deadline of 10 and a withheld timer; the coordinator returned
  `control-loss`, not `timeout`.
- Impact: late failure is no longer unsafe release, so the round-1 Blocker impact
  is reduced, but the common deadline truth and downstream retry/policy signal
  remain wrong.
- Required action: route both fulfillment and rejection through the same guarded
  monotonic settlement check, then add delayed rejection coverage for all seven
  phases.

### M-007 — Major — Concurrent prepare oversubscribes the fixed tombstone capacity

- Locations: `src/core/session-host/process-authority/coordinator.ts:622-624` and
  `src/core/session-host/process-authority/coordinator.ts:872-930`.
- Coverage gap: `test/core/session-host/process-authority-deadlines.test.ts:724-742`
  fills and tests the ledger sequentially only.
- Spec obligation: `specs/process-authority-provider/spec.md:95-97` and
  `design.md:140` require a fixed non-evicting ledger and refusal before provider
  dispatch when no slot remains.
- Failure path: capacity is checked before the awaited provider preparation, but
  no slot is reserved. With 1,023 retained generations, two concurrent prepares
  both see capacity, both dispatch, both return `prepared-inert`, and the map
  grows past the exported 1,024 limit.
- Fresh public-seam probe: after 1,023 sequential preparations, two concurrent
  calls both returned `prepared-inert` and both dispatched; total accepted
  generations became 1,025. Only the following call was refused.
- Impact: the declared bound and fail-before-dispatch guarantee are false under
  ordinary concurrency. It also breaks the intended alignment between the
  tombstone and 1,024-entry exact-receipt cache.
- Required action: reserve tombstone capacity atomically before provider
  dispatch, release a reservation only when no reference was minted, and test
  the limit with concurrent success, failure, timeout, and collision settlement.

### M-008 — Major — A mismatched durable-publication acknowledgment permits a second publisher invocation

- Locations: `src/core/session-host/process-authority/coordinator.ts:979-1003`.
- Tests that currently preserve the retryable state:
  `test/core/session-host/process-authority-lifecycle.test.ts:215-235` and
  `test/helpers/process-authority-provider-conformance.ts:116-132`.
- Spec obligation: `design.md:103` says publish is exactly once, while
  `specs/process-authority-provider/spec.md:49-78` requires one bounded durable
  publication and exact settlement without a second write after uncertainty.
- Failure path: after the actual publisher callback returns a mismatched
  acknowledgment, the coordinator resets state from `publishing` to
  `prepared-inert`. The caller can invoke `publish()` again, causing a second
  durable-writer callback even though the first callback may already have
  committed data.
- Fresh public-seam probe: the first publisher returned a forged digest and got
  `ordering-conflict`; a second publisher was invoked and returned
  `published-inert`; the callback count was two.
- Impact: host durable publication is not exactly once and a lost/mismatched
  acknowledgment can produce duplicate or conflicting external writes.
- Required action: treat any attempted publisher settlement as consuming the
  publish capability. On invalid acknowledgment, retain a typed uncertain/control
  failure and permit only bounded abort or exact-reference reconciliation, not a
  second publication callback.

## Round-1 finding recheck

| Round-1 finding | Round-2 status | Result |
| --- | --- | --- |
| B-001 manifest-only dispatch | **OPEN / Blocker** | Direct paths closed, but registry subclass override bypasses the manifest. |
| B-002 stale reference reuse | **OPEN / Blocker** | Local generations are tombstoned; recovery-only generations are not. |
| B-003 monotonic deadline | **PARTIAL / Major** | Fulfillment is checked; post-deadline rejection is not. |
| B-004 reusable conformance | **OPEN / Blocker** | Abort is invoked negatively, but successful abort capability is never required. |
| M-001 inert recovery | **CLOSED** | `prepared-inert` and `published-inert` remain distinct retained outcomes. |
| M-002 root status | **OPEN / Major** | Missing keys fail; `{null,null}` remains accepted. |
| M-003 actual publisher bound | **CLOSED** | The durable publisher callback runs inside the common publish phase. |
| M-004 prepare failure typing | **CLOSED** | Prepare timeout/control loss retain phase/type and adapter mappings. |
| M-005 immutable bounded inputs | **OPEN / Major** | Stable inputs are copied, but alternating getters defeat the snapshot. |

## Requirement and scenario audit

The latest delta contains **8/8 requirements and 49/49 scenarios**. This is the
original 38-scenario inventory plus 11 round-1 fix scenarios. Counts below are
inspection counts, not passing claims.

| Requirement | Scenarios inspected | Assessment |
| --- | ---: | --- |
| 1. Exact provider selection | 4/4 | Exact tuple logic is present, but B-001 defeats closed registry provenance. |
| 2. Opaque reference envelope | 6/6 | PASS in reviewed scope: codec closure, bounds, byte retention, native-field exclusion, redacted view, and corruption-only digest remain coherent. |
| 3. Bounded prepare/publish/activate ordering | 7/7 | Actual publication and bridge-before-activation are fixed; B-005 and M-008 break exact-reference/exactly-once lifecycle behavior. |
| 4. Exact lifecycle observations | 10/10 | Inert recovery is fixed; B-002, M-002, and M-007 leave reuse, status, and tombstone scenarios nonconformant. |
| 5. Bounded retained control | 7/7 | Fulfilled deadline checks and late quarantine exist; B-005, M-005, and M-006 violate exact snapshot/deadline settlement. |
| 6. Closed manifest negotiation | 6/6 | Schema/tuple validation is deep when the base registry owns selection, but B-001 bypasses the public coordinator gate. |
| 7. Reusable conformance harness | 5/5 | Matrix breadth and named mutation sensitivity improved; B-004 still permits a false abort-capability GREEN. |
| 8. Additive migration | 4/4 | PASS in reviewed scope: no production provider/default wiring, legacy bytes remain separate, and no platform/release claim was added. |

## Coverage and mutation assessment

```text
CODE/SPEC COVERAGE
==================
[reviewed] 8/8 requirements
[reviewed] 49/49 latest scenarios (38 original + 11 fix delta)
[reviewed] 8/8 product modules
[reviewed] 9/9 focused authority test files
[reviewed] 3/3 shared/test helpers

[closed deeply] direct no-manifest construction, actual publisher bounding,
                fulfilled deadline comparison, inert recovery vocabulary,
                typed prepare failures, redacted reference projection
[open/blocker] forgeable registry provenance, recovery reference reuse,
               cross-reference prepared abort, false abort conformance
[open/major]   null/null root status, alternating input accessors,
               late rejection deadline typing, concurrent tombstone capacity,
               repeat publisher invocation after mismatched acknowledgment
```

The named mutation loop is mechanically RED/GREEN for its current snapshot, but
it does not measure successful prepared/published abort. The fixed suite also
does not include the manifest-registry subclass, recovery-reuse, concurrent
tombstone, alternating-getter, null/null root-status, post-deadline rejection,
prepared-reference drift, or publisher-retry discriminators reproduced here.

## Fresh evidence

- Exact task-9.1 focused command: exit 0; **12 files, 156 tests passed**.
- Read-only/public-seam probes against the current built module reproduced
  B-001, B-002, B-005, M-002, M-005, M-006, M-007, and M-008. No probe output
  was retained in the worktree.
- B-004 was established from the complete unchanged suite and fixture contract:
  every provider abort assertion is negative, timed out before provider
  settlement, or ignored; no positive abort receipt is required.
- `git diff --check` over the foundation-owned product/test/spec surface returned
  no whitespace errors. The cumulative shared dirty worktree was preserved and
  not attributed to this Change.

## Exclusion and package-surface result

- CLEAN: the production registry remains empty and the common module is not
  wired as the Session/Management default.
- CLEAN: no Linux, Windows, macOS, broker, installer, signing, entitlement, VM,
  PID-tree, or PGID authority implementation was added by this Change.
- CLEAN: public exports do not expose provider-reference creation/decoding or
  provider-owned bytes; the diagnostic view is non-replayable.
- CLEAN: no Action, signer, Run, native ProcessCapsule protocol/manifest, or
  release-support authority crossed the reviewed seam.
- NOT CLEAN: manifest-only public dispatch is still forgeable through B-001.

## Final gate

This Change is **not eligible for task 9.11, local ship, or archive**. Resolve
all four Blockers and five Majors through a non-author fix/re-review loop, add
the cited public discriminators to the appropriate focused/shared suites, rerun
tasks 9.1-9.8, and obtain a fresh 0-Blocker/0-Major code/spec verdict.
