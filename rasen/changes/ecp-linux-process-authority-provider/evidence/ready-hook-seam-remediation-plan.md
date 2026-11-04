# Ready-hook seam remediation plan

Date: 2026-08-06\
Mode: read-only design analysis; no source, test, task, or run-state edits\
Input finding: `NATIVE-SEAM-R1-M01`, `NATIVE-SEAM-R1-M02`\
Recommendation: **replace the callback-shaped production seam with a pre-readiness permit owned by one deadline-aware recoverable-prepare supervisor**

## Problem frame and architectural lock

The current product order is sound: the primary parent constructs and validates the exact
attestation, the broker hook writes the construction reference, the primary parent releases the
identity to the namespace guardian, and only then can the guardian create its bound journal and
emit final `R` readiness. The defects are in the **Interface** around that order:

- `prepare_primary_with_ready_hook` accepts an arbitrary `FnOnce` with no deadline or cancellation
  semantics. Its production **Adapter** performs `write_all` and `sync_all` inline.
- `PrimaryGuardianAuthority::prepare_inert_recoverable` owns the caller-mapped worker but waits with
  blocking `read_exact` and `waitpid(..., 0)` and does not receive the request's absolute monotonic
  deadline.
- The only focused oracle proves hook-error cleanup, not the defining ordering. It would remain
  green if the hook moved after `expect_byte(..., b'R', ...)`.

The dependencies fall into three categories:

1. Deadline arithmetic is in-process and should live behind one small value **Interface**.
2. `CLOCK_MONOTONIC`, pidfd, poll, and waitpid are local kernel dependencies. Production uses the
   Linux **Adapter**; focused tests use a deterministic clock/process **Adapter**, while actual WSL
   remains the acceptance oracle.
3. The broker construction record is same-boot process-recovery state. The authority reference is
   boot-bound, so a machine reboot destroys the authority and invalidates the record. The
   pre-readiness transaction therefore needs process-crash visibility and atomic validation, not a
   synchronous power-loss `fsync` on the request thread.

Non-negotiable locks:

- `prepare_primary(request, artifact_digest, source_digest)` remains the ordinary entry point and
  retains its no-extra-work behavior.
- No argv, environment variable, launch field, broker frame, helper protocol frame, or caller input
  selects or injects the seam.
- One absolute `CLOCK_MONOTONIC` timestamp from `BrokerRequest.deadline_monotonic_ns` governs the
  whole broker prepare. No phase creates `now + 2 seconds` or another absolute deadline.
- Final readiness is impossible until the exact construction reference is committed and reopened.
- Deadline expiry cannot return while a caller-mapped worker is unreaped or an exact known guardian
  remains live. If the kernel cannot complete the proof, the durable recovery remains retained and
  the result must not be promoted to prepared or exact empty.

## Design it twice

### Design A — add a deadline parameter to the existing callback

Illustrative **Interface**:

```rust
prepare_primary_with_ready_hook(
    request,
    artifact_digest,
    source_digest,
    deadline,
    |prepared, deadline| commit(prepared, deadline),
)
```

The broker service would pass the deadline through `GuardianAuthority`, and the hook would check
the remaining duration before and after its write.

**Depth:** low. The caller must understand deadline arithmetic, commit ordering, cancellation,
cleanup, and how every blocking operation behaves. A deadline check before `sync_all` does not
bound the call, so the defining failure survives.

**Locality:** poor. Timeout behavior is split across `broker_service.rs`, `broker_guardian.rs`, and
the callback body, while primary cleanup still knows nothing about the same deadline.

**Failure semantics:** unsafe. The outer blocking `read_exact` and `waitpid` remain, and a callback
can still outlive the deadline. This is a shallow **Module** and is rejected.

### Design B — supervise the current whole caller-mapped worker only at the broker seam

Illustrative **Interface**:

```rust
GuardianAuthority::prepare_inert_recoverable(
    caller_uid,
    caller_gid,
    body,
    recovery_id,
    deadline,
)
```

`PrimaryGuardianAuthority` would poll the result socket and a worker pidfd with the remaining
budget, then kill/reap the worker on expiry. The current callback and primary handshake would
otherwise remain intact.

**Depth:** medium. Broker callers learn only one deadline-aware prepare operation, and blocking
`read_exact`/`waitpid` can be removed at that layer.

**Locality:** incomplete. The supervisor can stop waiting, but the primary **Implementation** still
uses fixed per-handshake timeouts and owns the exact guardian child. Killing its parent before a
stable checkpoint can leave the supervisor without the guardian identity needed for exact
reconciliation. A filesystem-stuck worker also makes “kill then reap” an assumption rather than an
Interface invariant.

**Failure semantics:** better but insufficient for `BRK-R2-B01`. The outer layer can time out, yet
it cannot itself prove that the guardian never crossed readiness. This design is rejected as the
terminal fix, though its pidfd/poll supervisor is retained in the recommendation.

### Design C — pre-readiness permit plus one recoverable-prepare supervisor (recommended)

Make the primary construction transaction a deep **Module**. Its external ordinary **Interface**
does not change. Its broker-only internal **Seam** exchanges one closed checkpoint and one permit:

```rust
pub fn prepare_primary(...) -> io::Result<PreparedPrimary>; // unchanged

pub(crate) fn prepare_primary_recoverable_until(
    request: PrepareRequest,
    expected_artifact_digest: [u8; 32],
    source_digest: [u8; 32],
    deadline: AbsoluteMonotonicDeadline,
    permit: &mut dyn PreReadinessPermit,
) -> io::Result<PreparedPrimary>;

trait PreReadinessPermit {
    fn commit_and_release(
        &mut self,
        candidate: &PreparedPrimary,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<()>;
}
```

This trait is internal, not a protocol. There are real **Adapters**: the compiled broker permit and
the deterministic barrier permit used by the primary contract test. The ordinary wrapper uses a
private immediate permit and does not expose a new argument.

For the production broker **Adapter**, `commit_and_release` is not allowed to call `fsync`. It sends
one bounded exact candidate over a private, inherited `SOCK_SEQPACKET` checkpoint channel to the
root broker supervisor and waits, using the same deadline, for a one-byte permit. The supervisor
owns the same-boot construction journal and releases the permit only after it has atomically
written, reopened, and byte-compared the exact reference. The journal record remains root-owned,
closed, checksummed, recovery-id-bound, and boot-id-bound. It uses a preallocated two-slot or
equivalent commit-marker layout so a process death yields either the prior intent or one complete
reference; it does not use synchronous `fsync` on the prepare path. This is safe for this record
because a power loss also destroys the live guardian and changes the bound boot identity. Durable
lease/publication records outside this narrow construction window keep their existing semantics.

The broker supervisor owns the caller-mapped worker pidfd, checkpoint socket, result socket, and
the single absolute deadline. The primary transaction owns the guardian child and its cleanup.
Before any guardian can exist, the worker installs and race-checks parent-death coupling. The
pre-ready guardian remains death-coupled to that worker until the supervisor has committed the
exact reference and issued the permit. Once a candidate checkpoint exists, the supervisor also
holds the exact guardian identity and can revalidate/kill/wait it directly if the worker fails.

This **Module** is deep because callers supply one timestamp and receive one prepared result; the
Implementation hides poll conversion, partial I/O, worker lifecycle, guardian cleanup, commit
ordering, and retained recovery. Deleting it would spread those rules back across three callers,
so it earns its **Interface**.

## Recommended lifecycle and failure semantics

The exact sequence is:

1. `BrokerServiceCore::handle` validates and constructs `AbsoluteMonotonicDeadline` once from the
   request. `prepare` passes the same value through `GuardianAuthority`; it never reconstructs a
   relative timeout.
2. Before forking, the supervisor creates the root-owned construction intent and reserves a bounded
   reconciliation interval from the same expiry timestamp. If the supplied budget cannot contain
   that reserve, prepare fails before any worker or guardian exists.
3. The supervisor forks the caller-mapped worker, opens its pidfd immediately, and uses `poll` plus
   `waitpid(WNOHANG)` only. Result and checkpoint channels use bounded `SOCK_SEQPACKET` messages, so
   there is no blocking `read_exact` framing loop.
4. Primary namespace construction uses deadline-aware `poll` for `M`, `N`, identity, and `R`.
   `ChildContext` receives the same absolute deadline. All partial reads/writes recompute remaining
   time from that timestamp.
5. After exact attestation validation, but before identity release to the guardian, the compiled
   broker permit sends the exact candidate to the supervisor. The supervisor commits and reopens
   the same-boot construction record, then sends the permit.
6. Only after the permit does primary send identity to the guardian. The guardian creates its bound
   journal and emits `R`; the caller-mapped worker returns a byte-identical result.
7. The supervisor receives the single result datagram, observes worker pidfd completion, reaps with
   `waitpid(WNOHANG)`, and rejects any result/reference mismatch.
8. On work-cutoff or deadline cancellation, the permit remains closed. The primary transaction
   signals and reaps its exact guardian, removes the partial scope, and exits. The supervisor uses
   the same deadline to pidfd-kill/reap a non-cooperating worker and, when a candidate was observed,
   independently reopens the exact guardian identity and proves it absent. It then reopens the
   construction record and either removes a reconciled intent or retains the exact reference.
9. `TimedOut` is returned only after worker reap, guardian absence/exact teardown, empty partial
   runtime scope, and construction-record reconciliation. A contradictory identity or kernel wait
   failure remains a retained control/identity failure and never becomes `Prepared`, `ExactEmpty`,
   or an optimistic timeout cleanup claim.

The reconciliation interval is a reservation inside the one caller-supplied deadline, not a second
deadline. Every `poll` timeout is derived from the same `expires_at`; there is no fixed two-second
or five-second tail. `waitpid(..., 0)`, unguarded `read_exact`, and inline `fsync` are forbidden in
this prepare path.

## Composition with `BRK-R2-B01`

The permit makes the construction-death-window invariant stronger rather than replacing it:

| Crash/expiry point | Durable/owned fact | Reconciliation |
| --- | --- | --- |
| Before worker fork | Intent only; no authority exists | Remove reconciled intent |
| After guardian fork, before candidate checkpoint | Worker/guardian parent-death coupling; no permit | Kill/reap worker; kernel-coupled guardian teardown; no readiness |
| After checkpoint, before record commit | Supervisor holds exact identity; no permit | Exact pidfd kill/wait plus worker reap; retain/remove validated intent |
| After record commit, before permit | Exact root-owned reference; no readiness | Replacement or current supervisor aborts exact inert guardian |
| After permit, before `R` | Exact root-owned reference; guardian may only be finalizing inert readiness | Reopen exact reference and abort; never infer activation |
| After `R`, before lease recovery transition | Exact root-owned reference plus inert guardian | Existing `abort_recovery` path reopens the same authority |

The construction record is removed only after the replayable prepared response and durable lease
state own the same byte-identical reference. `finalize_recovery` therefore remains after that
handoff; timeout cleanup cannot erase a contradictory or unreadable record.

## Deterministic ordering and cleanup oracles

Keep two distinct tests; do not combine their claims.

### Ordering oracle (`NATIVE-SEAM-R1-M02`)

Add a barrier permit to `linux_primary_contract.rs`:

1. Run `prepare_primary_recoverable_until` on a test thread.
2. The permit sends the exact attestation to the test thread and blocks before release.
3. While the permit is held, derive the existing scope directory from the known runtime root and
   `scope_id`. Assert that `journal.bin` is absent through the existing `AuthorityClient::journal`
   interface. Also issue a zero-progress/nonblocking control probe and prove that no authenticated
   server challenge is available. These are readiness observations, not sleeps.
4. Release the barrier. Assert prepare completes, the same attestation is returned, and
   `client.inspect()` reports inert from the authentic prepared journal.

`DurableJournal::create_in` completes before the child emits `R`. Therefore moving the permit after
`R` makes `journal.bin` present while the barrier is held and deterministically fails the test. The
control assertion supplies the behavioral companion without using a quiet polling interval as the
ordering oracle.

### Hook/permit-error cleanup oracle

Retain `pre_readiness_hook_failure_reaps_the_exact_inert_guardian`, rename only if the production
function name changes, and strengthen its launch to `/usr/bin/touch <marker>`. The permit returns an
injected error. Assert separately:

- the exact guardian identity is `AbsentSameBoot`;
- the runtime directory is empty;
- the workload marker does not exist; and
- the construction intent/reference is either removed after exact reconciliation or explicitly
  retained, never silently discarded.

### Deadline oracle (`NATIVE-SEAM-R1-M01`)

Use a barrier/stalling permit in a killable caller worker with a short absolute deadline. The test
must observe the worker pid and exact attestation before withholding release, then assert one
bounded result: typed timeout after exact worker reap, guardian absence, empty runtime root, absent
workload marker, and reconciled construction record. Add sibling mutations for expiry before the
candidate checkpoint, after checkpoint/before permit, and after permit/before `R`. A fake monotonic
clock closes service-level propagation; fresh WSL execution closes the real pidfd/poll/reap path.

## Exact change map

Likely source files and functions:

- `native/linux-process-authority/src/deadline.rs` (new):
  `AbsoluteMonotonicDeadline`, Linux and fake clock adapters, remaining/poll conversion.
- `native/linux-process-authority/src/lib.rs`: internal module/export wiring only.
- `native/linux-process-authority/src/broker_cgroup.rs`:
  move or re-export `MonotonicDeadline` so cgroup and guardian use the same value module; retain
  existing fake-kernel tests.
- `native/linux-process-authority/src/broker_service.rs`:
  `GuardianAuthority::prepare_inert_recoverable`, `BrokerServiceCore::handle`, and
  `BrokerServiceCore::prepare` pass the one exact deadline.
- `native/linux-process-authority/src/broker_guardian.rs`:
  `PrimaryGuardianAuthority::{new, prepare_inert_recoverable, abort_recovery,
  finalize_recovery}`, `prepare_as_caller`, construction-record commit/reopen helpers, and child
  result framing become the deadline-aware supervisor/permit adapter. Remove the prepare-path
  `read_child_result` blocking reads and construction `sync_all`.
- `native/linux-process-authority/src/primary.rs`:
  preserve `prepare_primary`; replace public callback use with internal
  `prepare_primary_recoverable_until`; thread the deadline through `ChildContext`, handshake I/O,
  and `kill_and_reap_until`; preserve the exact pre-identity/pre-`R` permit position.

Likely focused tests:

- `native/linux-process-authority/tests/linux_primary_contract.rs`: deterministic held-permit
  ordering oracle, strengthened permit-error cleanup marker, actual WSL deadline cleanup.
- `native/linux-process-authority/tests/linux_broker_service_contract.rs`: exact deadline value is
  passed unchanged; expired/too-small budget starts no authority; timeout remains retained.
- `native/linux-process-authority/tests/linux_broker_lease_contract.rs`: construction intent,
  complete-slot, torn-slot, and removal-after-handoff recovery mutations.
- If supervisor process tests cannot remain local without exposing internals, add
  `native/linux-process-authority/tests/linux_broker_guardian_contract.rs`; do not add a production
  argv/env/protocol selector merely to drive it.

No TypeScript provider interface, common provider contract, helper argv, broker wire schema,
manifest tuple, ProcessScope default, or Section 9 claim needs to change.

## RED / GREEN / refactor sequence

1. **RED — ordering:** add the held-permit test and prove it fails when the permit call is
   temporarily placed after final `R`; restore source order before proceeding.
2. **RED — cleanup:** strengthen the injected permit-error test with the workload marker and exact
   guardian/record reconciliation assertions.
3. **RED — deadline propagation:** make the fake guardian capture the absolute timestamp and fail
   until `BrokerServiceCore` passes the request value unchanged.
4. **RED — stalled worker:** add before-checkpoint, in-commit, and pre-`R` stalls. Require bounded
   worker reap, exact guardian teardown, empty runtime root, and retained/reconciled record.
5. **GREEN — value module:** centralize the absolute deadline and replace fixed prepare waits with
   remaining-budget poll helpers.
6. **GREEN — supervisor/permit:** replace result `read_exact` and blocking waitpid, implement the
   closed checkpoint/permit exchange and process-recovery construction commit, and preserve exact
   byte comparison.
7. **GREEN — cleanup:** implement cooperative cancellation followed by pidfd force and
   `waitpid(WNOHANG)` reconciliation inside the same deadline reservation.
8. **REFACTOR:** delete the callback-shaped production seam and duplicate timeout arithmetic. Keep
   the ordinary wrapper and internal test adapter small.
9. **VERIFY:** Rust format/check; Windows host tests; fresh musl build; fresh serial and
   default-parallel WSL primary/broker matrices. Independently review the live delta before closing
   either finding. Section 9 remains open.

## Invariants for review

- Ordinary `prepare_primary` has the same type-level Interface and executes no broker persistence.
- Exactly one request-derived monotonic `expires_at` crosses service, supervisor, worker, primary,
  and guardian handshake.
- The permit happens after exact attestation construction and before identity bootstrap, journal
  creation, or `R`.
- A permit can be selected only by a statically compiled internal caller/test adapter.
- No prepared result precedes a committed, reopened, byte-identical construction reference.
- Every expiry path either proves worker reaped plus guardian absent and reconciles the record, or
  retains a typed non-terminal failure; it never fabricates empty/prepared state.
- No prepare-path `read_exact`, `waitpid(..., 0)`, inline `fsync`, PGID scan, PID-tree scan, or
  descendant sample is used as authority or completion proof.
- The ordering oracle fails if the permit moves after final readiness; the separate error oracle
  continues proving cleanup and workload inertness.

## Rollback and scope risks

- **Risk: construction-record durability semantics.** Replacing synchronous `fsync` is acceptable
  only for this boot-bound pre-readiness record. Lease/publication durability must not be weakened.
  A security/spec reviewer must verify the boot-crash argument and closed record layout.
- **Risk: parent-death race.** Worker and pre-ready guardian must install parent-death coupling and
  immediately verify the expected parent identity before continuing. Tests must inject death on
  both sides of installation.
- **Risk: deadline reservation changes very-short requests.** Reject insufficient budgets before
  fork; do not start an authority that cannot be reconciled within the same absolute deadline.
- **Risk: test seam leaks into product selection.** Keep the permit trait/module internal. No
  feature flag, argv, env, frame, launch field, or filesystem value may choose an arbitrary adapter.
- **Risk: scope expansion.** This plan closes only the ready-construction/deadline seam. It does not
  close real cgroup-v2 Section 9, release packaging, production-default selection, or broader
  durable-store latency claims.

Rollback before merge is path-local: restore the current ready-hook implementation and its tests.
After implementation, rollback must restore the previous source atomically across primary,
broker-guardian, broker-service, and deadline wiring; retaining only half of the permit/supervisor
would reopen `BRK-R2-B01` and is forbidden.

## Durable findings

1. The seam belongs at the pre-readiness permit, not at an arbitrary callback: that placement gives
   the primary transaction enough depth to own ordering and cleanup while the broker owns recovery.
2. The one absolute deadline must govern the worker and guardian topology, not merely socket
   reads. Blocking framing and blocking waitpid are part of the same correctness defect.
3. The correct regression pair is structural ordering plus failure cleanup. Neither can substitute
   for the other, and the ordering oracle must observe a fact created before `R`, not elapsed time.
