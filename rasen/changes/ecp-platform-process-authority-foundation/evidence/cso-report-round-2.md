# CSO security and safety re-review - round 2

**Change:** `ecp-platform-process-authority-foundation`
**Branch:** `wip/ecp-shared-bounded-loop-lifecycle-resume`
**Date:** 2026-08-05
**Mode:** dispatched, report-only, fresh non-author re-review
**Verdict:** **NOT CLEAN - Blocker: 4, Major: 5, Minor: 0, Trivial: 0**

## Scope and method

Reviewed `proposal.md`, `design.md`, `tasks.md`, the complete delta spec, all eight files under `src/core/session-host/process-authority/`, all nine focused process-authority test files, all three focused helpers, `cso-report-round-1.md`, `code-spec-review-round-2.md`, and `review-fix-round-1.md`. The shared dirty worktree was treated as pre-existing context and was not attributed to this Change.

The review independently traced local manifest provenance, local and recovery reference generations, exact-reference binding, prepare/publish/activate ordering, retained authority, monotonic settlement, hostile and mutable inputs, diagnostic projections, and fixed-capacity concurrency. Eight public/built-seam probes were executed inline without retaining probe files. The reusable conformance gap was re-proved from the complete suite and fixture contract. Self-verification was used because this dispatched leaf review may not spawn another reviewer.

Validation evidence:

- Focused Vitest command: **exit 0; 9 files, 136 tests passed**.
- `pnpm exec tsc --noEmit --pretty false`: **exit 0**.
- Current built-module probes reproduced B-001, B-002, B-005, M-002, M-005, M-006, M-007, and M-008.
- B-004 was established by tracing every abort assertion and the measured mutation snapshot; no positive abort capability is required.
- No network, credential, external-system, platform-provider, product, test, spec, task, runstate, Direction, portfolio, stash, temp-output, commit, ship, or archive action was taken.

## Trust and invariant assessment

| Invariant | Result | Evidence |
| --- | --- | --- |
| Local manifest provenance | **FAIL** | B-001: coordinator trusts an overridable registry selection result with no non-forgeable provenance. |
| Reference generation non-reuse | **FAIL** | B-002 excludes recovery-only generations from the ledger; M-007 can exceed the fixed ledger under concurrent prepare. |
| Exact-reference lifecycle binding | **FAIL** | B-005 rereads a mutable provider preparation and can control B while authenticating release of A. |
| Publish before activate | **PARTIAL** | Activation remains type/runtime gated behind exact publication, and the adapter opens its bridge while inert; M-008 still permits a second durable publisher invocation after the first callback settles with a mismatched acknowledgement. |
| Retained authority | **FAIL** | Ordinary ambiguous outcomes retain authority, but B-002 and B-005 can return authentic stale/cross-reference exact-empty receipts. |
| Monotonic deadlines | **FAIL** | Fulfillment is checked at settlement; M-006 classifies post-deadline rejection as `control-loss` instead of `timeout`. |
| Immutable bounded input snapshots | **FAIL** | M-005 validates and dispatches different accessor values. |
| Non-replayable diagnostic views | **PASS** | SEC-PA-004 is closed: the public view exposes only tuple metadata and SHA-256 of the full sensitive reference. |
| Bounded concurrency | **FAIL** | M-007 accepted 1,025 generations under the advertised 1,024 bound. |
| Exact root-exit truth | **FAIL** | M-002 accepts `code: null, signal: null` as a complete root-exit fact. |
| Reusable provider conformance | **FAIL** | B-004 can certify a provider that never proves successful abort. |

## Findings summary

| ID | Native severity | Canonical severity | Confidence | Category | Primary location |
| --- | --- | --- | --- | --- | --- |
| B-001 | CRITICAL | Blocker | 10/10 | Manifest provenance / provider substitution | `registry.ts:118-127`, `coordinator.ts:606-615` |
| B-002 | CRITICAL | Blocker | 10/10 | Reference replay / false release | `coordinator.ts:622-678`, `coordinator.ts:1049-1074` |
| B-004 | CRITICAL | Blocker | 10/10 | False conformance / missing abort capability | `process-authority-provider-conformance.ts:210-236`, `:388-528` |
| B-005 | CRITICAL | Blocker | 10/10 | Cross-reference control / false release | `coordinator.ts:902-967` |
| M-002 | HIGH | Major | 10/10 | Incomplete lifecycle truth | `types.ts:99-116`, `coordinator.ts:435-445` |
| M-005 | HIGH | Major | 10/10 | Mutable input validation bypass | `coordinator.ts:340-405` |
| M-006 | HIGH | Major | 10/10 | Deadline truth | `coordinator.ts:815-848` |
| M-007 | HIGH | Major | 10/10 | Fixed-capacity concurrency | `coordinator.ts:622-624`, `:852-930` |
| M-008 | HIGH | Major | 10/10 | Duplicate durable publication | `coordinator.ts:979-1003` |

## B-001 - Manifestless registry override reaches provider dispatch

- **Severity:** CRITICAL -> **Blocker**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / A08 Software and Data Integrity Failures
- **Locations:** `src/core/session-host/process-authority/registry.ts:118-127`, `:165-187`, `:198-219`; `src/core/session-host/process-authority/coordinator.ts:606-615`, `:852-892`; `test/core/session-host/process-authority-public-surface.test.ts:52-73`.
- **Description:** Direct non-empty registry construction now requires a manifest, but the public registry class remains subclassable and `select()` remains overridable. The coordinator accepts the declared registry object and trusts its virtual `select()` result without checking non-forgeable local manifest provenance.
- **Concrete failure path:** A registry subclass calls valid `super([])`, overrides `select()` to return a raw provider, and is passed to the public coordinator. Preparation returns `prepared-inert`, and the unmanifested provider receives one prepare call.
- **Impact:** A substituted or unpackaged authority provider can execute under an approved descriptor identity despite the mandatory closed-manifest gate.
- **Required action:** Make selection provenance non-forgeable at the coordinator boundary. Do not trust subclass, proxy, look-alike, or overridden selection methods; use an internal closed lookup/brand created only after manifest validation and add zero-dispatch probes for all supported attack shapes.
- **Verification:** Inline public-seam probe reproduced one provider dispatch and successful inert preparation.

## B-002 - Recovery-only generations replay stale exact-empty receipts

- **Severity:** CRITICAL -> **Blocker**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / A08 Software and Data Integrity Failures
- **Locations:** `src/core/session-host/process-authority/coordinator.ts:622-678`, `:872-930`, `:1049-1074`, `:1077-1112`; `test/core/session-host/process-authority-outcomes.test.ts:141-186`.
- **Description:** Only successful local preparation enters `referenceLifecycles`. Dispatchable references first seen through replacement inspect/terminate are never registered as observed generations. Their exact-empty receipts are still cached by reference string.
- **Concrete failure path:** A replacement coordinator inspects recovered reference A and receives an authentic exact-empty receipt. The same coordinator then accepts a local prepare that reuses A, publishes and activates it live, and answers the new generation's inspect from the old receipt cache without a second provider observation.
- **Impact:** A live authority can receive an authentic clean-release receipt from a retired recovered generation, detaching workload control and allowing unsafe capacity/identity reuse.
- **Required action:** Atomically reserve/register every valid recovered generation before provider observation or control, retire it only from authentic exact empty, and apply the same collision and capacity rules to local and recovery paths.
- **Verification:** Probe produced an authentic recovered receipt, a second `prepared-inert`, a `live` activation, then an authentic stale receipt while provider inspect calls remained at one.

## B-004 - The unchanged suite can certify an abort-incapable provider

- **Severity:** CRITICAL -> **Blocker**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / acceptance-integrity failure
- **Locations:** `test/helpers/process-authority-provider-conformance.ts:210-236`, `:258-313`, `:348-369`, `:388-528`; `test/helpers/deterministic-process-authority-provider.ts:93-105`.
- **Description:** Prepared and published abort tests require only correct retention of `authority-uncertain`. The measured probe ignores the result of `nextPrepared.abort()`, and the abort deadline case times out before it can prove provider behavior. No assertion requires successful exact recursive abort.
- **Concrete failure path:** A later platform fixture implements terminate but always returns `authority-uncertain` from abort. Every unchanged conformance assertion can remain green, so the provider is certified for the indivisible recursive-abort semantic without ever demonstrating it.
- **Impact:** A provider that cannot clean up inert authority can pass the common acceptance artifact, leaving prepared/published authorities retained indefinitely and making later platform readiness evidence false.
- **Required action:** Require successful prepared and published abort to return provider-proven authentic exact empty for the exact generation; preserve negative abort tests; add a broken-abort mutation whose unchanged measured snapshot is RED.
- **Verification:** Self-verified from the complete suite and fixture call paths; every current abort assertion is negative, ignored, or timer-short-circuited.

## B-005 - Mutable prepared reference authenticates release for the wrong authority

- **Severity:** CRITICAL -> **Blocker**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / A08 Software and Data Integrity Failures
- **Locations:** `src/core/session-host/process-authority/coordinator.ts:902-930`, `:939-967`, `:1013-1017`.
- **Description:** The fulfilled `ProviderPreparedAuthority` is not normalized once. Its reference is read during diagnostic fingerprinting/encoding and read again for abort, while the public receipt is always attached to the earlier common reference.
- **Concrete failure path:** A prepared object returns provider reference A during fingerprint/encoding and B during abort. The provider correctly proves B empty; the coordinator mints a WeakSet-authentic exact-empty receipt naming public reference A.
- **Impact:** Exact-reference control and the sole authority-release predicate are confused across generations. Authority A may be released even though only B was controlled.
- **Required action:** Capture and validate the provider reference and activation callable exactly once into a closed immutable internal snapshot. Use only the captured reference for envelope creation and every later activate/abort/control identity.
- **Verification:** Probe observed three accessor reads, encoded A publicly, delivered B to provider abort, and returned an authentic exact-empty receipt naming A.

## M-002 - Null/null root exit is accepted as exact backend status

- **Severity:** HIGH -> **Major**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / lifecycle truth
- **Locations:** `src/core/session-host/process-authority/types.ts:99-116`; `src/core/session-host/process-authority/coordinator.ts:435-445`; `test/core/session-host/process-authority-outcomes.test.ts:188-204`.
- **Description:** Normalization requires both keys but permits both values to be null. That is statusless, not an exact root-exit fact for the Node compatibility contract.
- **Concrete failure path:** Provider inspect and terminate each return `{ state: 'root-exited', code: null, signal: null }`; both are accepted and projected as exact common root-exited outcomes.
- **Impact:** Recovery/policy code receives an asserted backend-exit fact without an exit code or terminating signal, weakening exact lifecycle truth and diagnosis.
- **Required action:** Require at least one of code or signal to be non-null, or define a stronger closed status union, and add inspect/control/adapter/shared-suite coverage for null/null.
- **Verification:** Inline probe reproduced accepted null/null outcomes on both inspect and terminate.

## M-005 - Alternating accessors bypass immutable bounded input snapshots

- **Severity:** HIGH -> **Major**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / validation-dispatch split
- **Locations:** `src/core/session-host/process-authority/coordinator.ts:340-405`, `:638-640`, `:864-892`, `:1088-1101`; `test/core/session-host/process-authority-lifecycle.test.ts:183-199`; `test/core/session-host/process-authority-outcomes.test.ts:320-339`.
- **Description:** Prepare and termination snapshotters reread accessors after validation. A value can be valid during checks and different, malformed, or unserializable during snapshot construction and operation identity generation.
- **Concrete failure path:** A command getter returns `safe-command` for validation and `unsafe\0command` for the final snapshot. Preparation succeeds and the provider receives the NUL-containing command. Equivalent termination getters can escape the typed outcome through later JSON serialization.
- **Impact:** The provider can receive launch/control data that was never validated, and malformed identity material can reject the public promise outside the typed fail-closed contract.
- **Required action:** Perform one guarded read of each own allowed field, validate only the captured values, recursively snapshot arrays/maps from captured descriptors, then use that one frozen object for identity and dispatch. Add alternating-getter cases for every prepare and termination field.
- **Verification:** Probe returned `prepared-inert`; the command getter was read twice and the provider observed a NUL-containing command.

## M-006 - Post-deadline rejection is not classified as timeout

- **Severity:** HIGH -> **Major**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / deadline truth
- **Locations:** `src/core/session-host/process-authority/coordinator.ts:815-848`; `test/core/session-host/process-authority-deadlines.test.ts:285-400`, `:472-494`.
- **Description:** Fulfillment rereads monotonic time before settlement, but the rejection handler immediately returns `control-loss`. With a delayed scheduler callback, rejection after the recorded deadline violates the common deadline vocabulary.
- **Concrete failure path:** Inspect starts at monotonic 0 with deadline 10, the timer callback is withheld, and provider control rejects at monotonic 11. The coordinator returns `control-loss` rather than `timeout`.
- **Impact:** Retention remains fail-closed, but phase truth and downstream retry/policy decisions are wrong for all operations using the shared runner.
- **Required action:** Route fulfillment and rejection through one monotonic settlement guard, abort/quarantine on or after deadline, and test delayed rejection for all seven phases.
- **Verification:** Inline probe reproduced `control-loss` for a post-deadline inspect rejection.

## M-007 - Concurrent prepare exceeds the fixed reference ledger

- **Severity:** HIGH -> **Major**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / bounded concurrency
- **Locations:** `src/core/session-host/process-authority/coordinator.ts:622-624`, `:852-930`; `test/core/session-host/process-authority-deadlines.test.ts:724-742`.
- **Description:** Capacity is checked before awaited provider preparation, but no slot is reserved. Concurrent calls can all pass the check and add generations after settlement.
- **Concrete failure path:** After 1,023 accepted generations, two concurrent prepares both dispatch and both return `prepared-inert`. The coordinator retains 1,025 generations despite the exported 1,024 limit; only the following prepare is refused.
- **Impact:** The fixed non-evicting bound and fail-before-dispatch guarantee are false under ordinary concurrency, undermining replay retention and bounded-memory reasoning.
- **Required action:** Reserve tombstone capacity atomically before provider dispatch, release a reservation only when no reference is minted, and cover concurrent success, pre-reference failure, timeout, and collision settlement.
- **Verification:** Inline probe recorded two concurrent successes, 1,025 provider dispatches/accepted generations, then refusal of the following call.

## M-008 - Mismatched publication acknowledgement permits a second durable write

- **Severity:** HIGH -> **Major**
- **Confidence:** 10/10
- **Category:** A04 Insecure Design / durable publication integrity
- **Locations:** `src/core/session-host/process-authority/coordinator.ts:979-1003`; `test/core/session-host/process-authority-lifecycle.test.ts:215-235`; `test/helpers/process-authority-provider-conformance.ts:116-132`.
- **Description:** After the publisher callback settles with a mismatched acknowledgement, state is reset to `prepared-inert`. The publish capability can be invoked again even though the first trusted callback may already have committed the durable binding.
- **Concrete failure path:** First publisher invocation writes but returns a wrong digest and receives `ordering-conflict`; a second publisher invocation runs and produces `published-inert`. Callback count is two.
- **Impact:** Durable authority publication is not exactly once and can create duplicate/conflicting registry writes after acknowledgement mismatch or corruption.
- **Required action:** Consume publication capability on every publisher attempt. Invalid acknowledgement must retain a typed uncertain/control failure and allow only bounded abort or exact-reference reconciliation, never another publisher callback.
- **Verification:** Inline probe reproduced first `ordering-conflict`, second `published-inert`, and two publisher invocations.

## Prior security finding recheck

| Prior finding | Round-2 status | Result |
| --- | --- | --- |
| SEC-PA-001 stale exact-empty replay | **OPEN / Blocker** | Local reuse is rejected, but B-002 preserves the recovery-to-local stale-receipt path and B-005 creates a cross-reference authentic receipt. |
| SEC-PA-002 bridge failure after activation | **CLOSED** | `process-scope-adapter.ts:188-226` opens/validates the bridge while `published-inert`, aborts before activation on bridge failure, and performs exact-reference termination after ambiguous activation. Focused adapter tests pass. |
| SEC-PA-003 manifest bypass | **OPEN / Blocker variant** | Direct raw-provider and direct manifestless base construction are closed; B-001 bypasses provenance through the public virtual registry boundary. |
| SEC-PA-004 replayable diagnostic view | **CLOSED** | `reference-codec.ts:310-336` returns redacted tuple metadata and one-way digest only; no full reference or reversible provider bytes are projected. |

## Round-2 correctness recheck

All nine findings in `code-spec-review-round-2.md` remain reproducible in the current source/build. No intervening product or test fix was present:

- **Blocker:** B-001, B-002, B-004, B-005.
- **Major:** M-002, M-005, M-006, M-007, M-008.

The passing focused suite does not contain the registry-subclass/proxy, recovery-reuse, successful-abort capability, prepared-reference drift, null/null root status, alternating-accessor, delayed-rejection, concurrent-capacity, or publisher-retry discriminators described above.

## Explicitly clean boundaries

- Canonical envelope encoding/decoding, malformed/tampered/future-version refusal, exact tuple/reference-version matching, and byte preservation remain fail-closed in reviewed paths.
- The common SHA-256 envelope digest is correctly treated as corruption detection, not authentication or signer authority.
- The public diagnostic view is non-replayable and does not expose provider-owned bytes.
- The adapter now acquires and validates its runtime bridge before activation and performs bounded exact-reference reconciliation on activation ambiguity.
- The production registry remains empty; no Linux, Windows, macOS, broker, installer, signing, entitlement, VM, PID-tree, PGID, Action, signer, Run, ProcessCapsule protocol/manifest, or release-support implementation crossed this Change.

## Canonical counts and final gate

- **Blocker:** 4
- **Major:** 5
- **Minor:** 0
- **Trivial:** 0
- **Total reported:** 9
- **Candidates filtered:** 3 (the explicitly non-authenticating common digest, path/symlink speculation without a foundation artifact loader, and provider-native late-effect concerns without a distinct common-contract exploit beyond the retained timeout model)

**Final verdict: NOT CLEAN.** Resolve all four Blockers and five Majors, add the cited public/shared-suite discriminators, rerun the focused and static gates, then obtain another fresh non-author security/safety and code/spec review. This Change is not eligible for task 9.11, local ship, or archive.

This AI-assisted review is not a substitute for a professional security audit or platform-specific penetration testing. Actual Linux, Windows, and any future macOS provider still require independent real-OS authority, escape, recovery, kill, unavailable, packaging, and authentication review.
