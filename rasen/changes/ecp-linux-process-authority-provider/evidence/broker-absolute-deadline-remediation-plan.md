# Broker absolute-deadline and late-mutation remediation plan

Date: 2026-08-06\
Mode: fresh read-only design; no source, test, task, run-state, portfolio, or Git mutation\
Input finding: `BRK-R2-B06` from native broker review round 3\
Baseline: `140115ced9df814f6adf3190b47171202d964a5e`, source digest
`2cf6d54e8c05164c54b5800c3e2e1213865eb400c43c8eef73983f38d24bd151`\
Recommendation: **put every broker lifecycle mutation behind one process-supervised absolute-
deadline Module, and make activation gate release a deadline-aware guardian commit**

File and line references below describe that baseline. The concurrent prepared-delivery fix owns
the new controller-known delivery identity, `PreparedPendingAck`, explicit ACK, and delivery
record transitions. This plan composes with that transaction; it does not replace or duplicate
its identity, index, capability, or state machine.

## Problem frame

The wire already carries a nonzero `BrokerRequest.deadline_monotonic_ns`, but it is not yet the
governing transaction deadline:

- the broker client constructs the absolute value only after it has read its TypeScript input,
  installs one relative socket timeout, and can reset the effective budget across several
  blocking frame/authentication operations;
- the daemon gives each connection an unrelated 30-second timeout, detaches one thread per
  request, and does not observe client HUP while `BrokerServiceCore::handle` is running;
- `BrokerServiceCore::handle` checks the deadline only at dispatch. Prepare, publication,
  activation, inspection, cleanup, and their durable store calls can continue afterward;
- `PrimaryGuardianAuthority::prepare_inert_recoverable` has no deadline. It uses a blocking child
  result read and `waitpid(..., 0)`, while its construction hook rewrites and `sync_all`s a record
  inline;
- `GuardianAuthority::activate` and `AuthorityClient::activate` receive no deadline. The guardian
  can durably append activation and open the workload gate after the common coordinator has
  already settled timeout;
- killing the TypeScript-spawned broker-client ends only that process. The independent daemon
  thread retains the request and can still create a guardian, cgroup, lease, or activation.

This is not fixed by adding more `is_expired()` calls. A thread blocked in `fsync`, socket I/O, a
lock, or `waitpid` cannot be cancelled safely. A check immediately before such a call is not a
bound, and a check after it is too late for an irreversible mutation.

Dependencies are:

1. Absolute deadline arithmetic and transition admissibility are in-process and belong behind one
   small value Interface.
2. `CLOCK_MONOTONIC`, `timerfd`, pidfd, nonblocking Unix sockets, `poll`, and `waitpid(WNOHANG)`
   are local-substitutable Linux dependencies. Production uses the Linux Adapter; deterministic
   contract tests use clock, barrier, and process-lifecycle Adapters.
3. Lease, delivery, construction, journal, and cgroup state are local crash-recovery dependencies.
   Their potentially blocking work must execute in a killable worker while the supervisor owns
   cancellation, exact process identity, and recovery.

Non-negotiable constraints:

- The broker client chooses one absolute `CLOCK_MONOTONIC` expiry once at operation entry. The
  same integer crosses client, daemon, service, prepare supervisor, primary construction, and
  guardian activation. No phase turns it back into `now + timeout`.
- A retry of the same mutating delivery uses the original stored deadline. A later observational
  recovery call may have its own read deadline, but cannot extend the original mutation window.
- Client death/HUP is a cancellation source before the operation's irreversible commit. After a
  commit, HUP means response loss; it never rolls committed authority back or makes it
  unreachable.
- Activation cannot release the workload gate after the absolute deadline. Late bookkeeping may
  record a fact that committed before expiry, but cannot create a guardian, cgroup, lease, gate
  release, signal, or cleanup against a new identity.
- No `sleep`, process group, PID-tree walk, or sampled descendant set is an authority or a
  completion oracle. Worker and guardian control uses exact pidfds; authority control remains the
  namespace guardian or exact cgroup leaf.
- No argv, environment, wire-protocol, filesystem, or feature-flag **test switch** is added.
  Internal semantic deadline fields and compiled test Adapters are not test selection switches.

## Design it twice

### Design A - pass a deadline token through the current threads

Add `MonotonicDeadline` parameters to `handle`, `prepare`, `activate`, guardian calls, and store
helpers. Check it before and after every blocking operation, and replace fixed socket timeouts with
the current remaining duration.

**Depth:** low. Every caller must understand deadline arithmetic, which operations are reversible,
how to cancel them, and how to reconcile a result returned after expiry.

**Locality:** poor. The same rules remain spread over the TypeScript wrapper, broker client,
daemon, service, cgroup code, guardian Adapter, primary helper, and stores.

**Failure semantics:** insufficient. `sync_all`, blocking `flock`, `read_exact`, and
`waitpid(..., 0)` can still outlive the deadline. Rust threads cannot be safely killed. Client HUP
still cannot stop a detached daemon thread. This design is useful only as value propagation inside
the stronger design and is rejected as the fix.

### Design B - process-supervised mutation, but keep one-way guardian activation

Run each mutating `BrokerServiceCore` call in a disposable worker. The daemon monitors a timerfd,
the worker pidfd, and the client socket, then kills/reaps the worker on expiry or HUP. Keep the
current guardian `Activate -> Activated` request/response.

**Depth:** medium. Blocking durable calls become cancellable as a group and client death reaches
the daemon transaction.

**Locality:** improved, but the irreversible seam is still wrong. Killing the service worker does
not cancel a guardian already blocked in its journal commit, and the guardian has no deadline. It
may resume and open the gate after the worker and caller have timed out.

**Failure semantics:** safe for ordinary late worker results, unsafe for activation. It also needs
an exact guardian checkpoint so prepare-worker death does not strand an unnamed guardian. This
design is rejected as terminal but supplies the outer supervisor used below.

### Design C - process-supervised mutation plus guardian gate permit (recommended)

Create one deep `BrokerMutationSupervisor` Module. Its external Interface is deliberately small:

```rust
pub(crate) struct AbsoluteMonotonicDeadline(u64);

pub(crate) struct SupervisedBrokerRequest {
    pub peer: PeerCredentials,
    pub authenticated_nonce: [u8; 32],
    pub request: BrokerRequest,
}

pub(crate) enum SupervisedBrokerOutcome {
    Committed(BrokerResponse),
    ReconciledTimeout,
    Retained(BrokerResponseCode),
}

impl BrokerMutationSupervisor {
    pub fn execute(
        &self,
        request: SupervisedBrokerRequest,
        client: ClientLiveness,
    ) -> io::Result<SupervisedBrokerOutcome>;
}
```

Callers learn one expiry and one result. The Implementation hides timerfd setup, nonblocking
framing, HUP/client-pidfd monitoring, work cutoff, child pidfd control, exact reap, progress
checkpoints, store reload, prepare reconciliation, response quarantine, and guardian gate
control. Deleting this Module would spread those rules across every lifecycle route, so it earns
its Interface.

The root daemon frontend remains a transport/authentication Adapter. It must not fork arbitrary
Rust work from the current multithreaded server. Replace detached connection threads with a
single-threaded dispatcher plus a bounded, serial mutation supervisor (or an equivalent preforked
supervisor). The supervisor creates a disposable transaction worker before any thread exists,
opens its pidfd immediately, and communicates over private inherited `SOCK_SEQPACKET` channels.
Serial mutation is acceptable for this local administrative broker and preserves the current
transaction-lock semantics without copying process-local mutexes into concurrently mutating fork
children. Long-lived runtime byte relay is handed to a separate non-mutating relay process only
after bounded `OpenRuntime` success; it never occupies or mutates through the transaction worker.

Every store rewrite, directory sync, cgroup mutation, guardian RPC, and lifecycle transition runs
inside the disposable worker. A stuck syscall is cancelled by exact worker pidfd `SIGKILL`; the
supervisor polls the pidfd and reaps with `waitpid(WNOHANG)`. Atomic store formats decide whether a
commit happened. The parent never trusts a late in-memory return to decide durable truth.

Prepare additionally uses the ready-hook remediation's
`RecoverablePrepareSupervisor`/pre-readiness permit. The caller-mapped worker is itself pidfd-owned,
and its pre-ready guardian remains parent-death-coupled until the exact construction reference is
checkpointed. After that checkpoint, the supervisor holds the exact guardian identity and can
signal/wait it directly. Thus cancellation covers both the transaction worker and the exact
guardian; killing only one is not considered reconciliation.

Activation becomes a broker-private, deadline-aware gate transaction:

```text
durable lease Published -> ActivationPending
    -> guardian prepares an exact root behind a still-closed gate
    -> guardian reports ActivationReady on the authenticated private stream
    -> supervisor proves client/cancellation state and remaining absolute deadline
    -> guardian receives ReleaseGate(deadline_monotonic_ns)
    -> guardian rechecks CLOCK_MONOTONIC and atomically writes the nonblocking one-byte gate
    -> guardian reports GateReleased and durable authentic activation evidence
    -> service records Activated
```

`ReleaseGate` is a semantic internal control frame, not a test hook. It carries the same request
deadline and can be selected only by the compiled broker Adapter after an exact
`ActivationPending` lease. The guardian arms an absolute `CLOCK_MONOTONIC` timerfd and prioritizes
expiry/HUP over a release permit. Immediately before the one-byte nonblocking gate write it checks
the same clock again; no allocation, fsync, socket write, or other blocking operation occurs
between that check and gate release. A gated root also observes the inherited absolute timerfd and
exits rather than executing if expiry wins before the permit. This defines gate release as the
irreversible activation linearization point.

Potentially blocking activation journal/store work occurs before the release decision inside a
killable exact process. If it is still incomplete at the mutation cutoff, the supervisor kills the
worker and exact guardian while the gate is closed. If gate release was already durably observed
before expiry, cancellation becomes response loss: the authority remains live and later exact
reconciliation records/replays `Activated`; it never opens the gate a second time.

This design has the highest depth and locality and is the recommendation.

## Absolute deadline value and blocking-I/O rules

Move the current cgroup-local `MonotonicDeadline` into a crate-level `deadline.rs` as
`AbsoluteMonotonicDeadline`. It validates:

- nonzero canonical nanoseconds;
- `expires_at > CLOCK_MONOTONIC now` on admission;
- a remaining interval no greater than the closed broker phase maximum; and
- exact, overflow-safe conversion to poll milliseconds, rounding up while positive and never
  yielding an unbounded negative poll value.

The production clock Adapter calls only `clock_gettime(CLOCK_MONOTONIC)`. Tests inject a fake
clock behind an internal trait. `timerfd_settime(..., TFD_TIMER_ABSTIME, ...)` arms the expiry once;
EINTR recomputes from the same value. The client creates this value immediately after argument
validation and before reading the TypeScript input frame. It then copies the exact nanoseconds into
`BrokerRequest`; daemon and service never derive a replacement deadline.

For prepared delivery, the concurrent delivery Module stores the original mutation deadline in
its exact binding/record. A replacement client performing `RecoverPreparation` has a new bounded
observational-call deadline, but the daemon consults the stored original before any reconciliation
that could create or commit authority. It cannot submit `now + another prepare budget`.

All finite-phase I/O becomes nonblocking and uses one `DeadlineIo` Adapter that polls the target
fd, the operation timerfd, and cancellation fd together:

- TypeScript stdin request and stdout response framing in the broker client;
- broker socket connect/authentication/request/response framing in client and daemon;
- worker result/checkpoint seqpackets;
- primary `M`, `N`, identity, pre-readiness permit, and `R` handshake pipes;
- guardian control authentication, activation-ready/permit/final response;
- cgroup `populated` observation; and
- pidfd completion and child reap.

Each partial read/write recomputes remaining time. A single initial `SO_RCVTIMEO` or
`SO_SNDTIMEO`, `read_exact`, `write_all`, blocking `flock`, blocking `waitpid`, thread `join`, or
fixed 2/5/30-second tail is forbidden in these finite paths. The runtime relay is explicitly not a
finite lifecycle operation after `RuntimeReady`; its shutdown follows runtime ownership rather
than reusing the opening deadline.

Every `sync_all` remains part of the crash-safe store where required, but it executes only inside
a disposable supervised process. On cutoff, exact `SIGKILL` prevents that process from returning
to userspace and performing a later transition. A syscall already in progress may still make its
atomic record durable; therefore reconciliation reopens the record and classifies the durable
phase instead of assuming cancellation won. Temporary/torn entries remain bounded and block
optimistic cleanup. Reconciliation itself may record already-committed truth after expiry, but it
cannot perform a new authority mutation.

The supervisor reserves a bounded cleanup interval *inside* the caller's one deadline and derives
a mutation cutoff from the same expiry. If the initial budget cannot contain that reserve, the
request is rejected before any worker, guardian, leaf, lease, or gate exists. This is not a second
deadline. At cutoff it closes permits, signals exact workers/guardians, and uses the remaining
interval only for reap and durable-state classification. If the kernel keeps a killed process in
an uninterruptible syscall, the request remains retained and the supervisor continues exact reap
observation; it never lets that process execute another userspace mutation or calls the authority
reconciled/empty prematurely.

## Client death and cancellation

After `SO_PEERCRED` authentication, the daemon opens a pidfd for the exact broker-client process
and monitors it together with socket `POLLHUP/POLLERR` and the timerfd. The pidfd is only a client
liveness/cancellation source; it is never workload authority. The TypeScript wrapper's existing
`SIGKILL` on abort therefore becomes visible to the daemon immediately instead of merely killing
the proxy.

Cancellation rules are phase-aware:

- Before an irreversible commit, HUP/client death closes the permit, kills/reaps the mutation
  worker, and invokes exact reconciliation. It cannot leave work running until an unrelated
  daemon timeout.
- After `PreparedPendingAck`, client loss is delivery response loss. The exact prepared reference
  remains reachable through the delivery Module and is not aborted or pruned.
- Before activation `GateReleased`, HUP closes the gate permit. The gated root and worker are
  killed/reaped, and the exact lease/guardian state is reconciled. No workload code runs.
- After `GateReleased`, HUP is activation response loss. The live authority remains bound to its
  already controller-known reference; exact lease/guardian recovery converges `ActivationPending`
  to `Activated` without another gate release.
- After `cgroup.kill` or exact guardian kill is issued for abort/terminate, HUP cannot reverse the
  destructive commit. Only bounded exact-empty observation/reconciliation continues.

The daemon never treats a closed response socket as proof that no commit occurred.

## Commit, response-loss, and late-result semantics

### Prepare and controller-known delivery recovery

The deadline supervisor supplies mutation control; the concurrent prepared-delivery Module owns
identity and delivery state:

1. Delivery `Intent` exists before prepare mutation.
2. Prepare construction, guardian checkpoint, cgroup placement, lease commit, and exact response
   assembly run under the original deadline.
3. If cutoff/expiry occurs before delivery `PreparedPendingAck`, the worker is cancelled and the
   existing exact recovery path aborts the guardian/leaf. Delivery becomes `Reconciled(Timeout)`
   only after proof; otherwise it remains retained uncertainty and never returns a reference.
4. If `PreparedPendingAck` commits before expiry, authority mutation is complete. Socket/stdout
   loss or deadline settlement after that point preserves the byte-identical response. A new
   attempt id may recover it through the controller-known operation binding and delivery
   capability.
5. Explicit ACK still retires provisional delivery. The deadline supervisor does not invent an
   identity/index, does not use request id as reachability, and does not move ACK before the
   controller's durable `ReferenceStored` commit.

### Publication

Publication commit must be admitted before the deadline and run in the supervised worker. If the
exact Published lease/record commits and the response is lost, retry returns the same fact. If the
worker dies before a durable commit, reload yields Prepared or retained uncertainty. Activation
continues to require exact common-ledger and broker publication truth; deadline work must not add a
hidden publish side effect.

### Activation

The durable lease enters `ActivationPending` before guardian interaction. Only the guardian's
deadline-aware gate release is authority activation. Outcomes are:

- no `GateReleased`: cancel/reap the gated root and exact guardian or retain uncertainty; never
  report Activated and never execute workload code;
- `GateReleased` before expiry, response/lease-finalization lost: preserve the authority and use
  authentic guardian/lease evidence to finish or replay Activated bookkeeping;
- any worker result received after timeout/HUP without a pre-expiry commit checkpoint: quarantine
  it, close the old result channel, and reload durable state. It cannot settle this or a later
  request and cannot open the gate;
- replay against Activated returns success without another fork, journal activation, or gate
  permit.

### Inspect, open-runtime, abort, and terminate

Inspect is observational only until it needs to persist authentic root-exit/exact-empty truth or
cleanup; those writes run supervised and late responses are quarantined. `OpenRuntime` is bounded
through exact `RuntimeReady`; cancellation before that closes both sides and leaves activation
inert. After ready, relay lifetime belongs to the runtime session.

Abort/terminate revalidate the exact guardian/cgroup and deadline before the destructive commit.
Grace is capped by remaining time and zero remains valid. Once exact pidfd kill or `cgroup.kill`
is issued, no additional destructive target is selected. Expiry during empty observation returns
retained timeout/uncertainty; it never fabricates `exact-scope-empty`. Later reconciliation uses
the same reference and authentic terminal history/EventGap rules.

## Public and internal seams

No frozen `ProcessAuthorityProvider`, common outcome, provider tuple, or provider-reference
Interface changes.

Internal Rust Interfaces become deadline-explicit:

```rust
trait GuardianAuthority {
    fn prepare_inert_recoverable_until(
        &self,
        caller: PeerCredentials,
        body: &[u8],
        recovery_id: [u8; 32],
        context: &MutationContext,
    ) -> io::Result<PreparedGuardian>;

    fn activate_until(
        &self,
        lease: &BrokerLease,
        reference: &[u8],
        context: &MutationContext,
    ) -> io::Result<ActivationCommit>;
}
```

`MutationContext` contains only the absolute deadline, derived internal cutoff, cancellation fd,
and private checkpoint channel. It carries no lease identity, delivery key, token, operation id,
or authorization. The prepared-delivery binding and records remain the sole owner of
controller-known delivery identity.

Primary keeps its ordinary Interface. Broker-only internal entry points accept the same deadline
and compiled permit Adapter:

```rust
prepare_primary(...) -> io::Result<PreparedPrimary>; // unchanged
prepare_primary_recoverable_until(..., deadline, permit) -> io::Result<PreparedPrimary>;
AuthorityClient::activate_until(deadline, cancellation) -> io::Result<ActivationCommit>;
```

The internal guardian control codec is versioned and adds the semantic deadline plus
activation-ready/release/final frames. Unknown/old codec versions fail closed. This is production
protocol meaning, not fault injection. Tests select barrier/clock/process Adapters only through
Rust construction; production argv, environment, frames, and files cannot select them.

## RED oracles

Write one RED -> minimal GREEN slice at a time through the agreed supervisor, prepared-delivery,
guardian-control, and public provider seams:

1. **Exact propagation:** a capture Adapter proves the one client-created absolute nanosecond
   value is byte-identical in daemon, service, prepare supervisor, primary handshake, and guardian
   activation. Advancing a fake clock never creates `now + another budget`.
2. **Partial frame budget:** deliver authentication/request bytes in several barrier-controlled
   fragments. The total call expires at the original deadline; each read cannot reset a relative
   timeout.
3. **Client death before prepare commit:** close/kill the real broker-client after daemon
   authentication but before guardian checkpoint. Observe exact transaction-worker pidfd reap,
   closed gate, absent workload marker, no prepared lease, and reconciled/retained delivery.
4. **Client death after guardian checkpoint:** hold construction commit, kill the client, and prove
   exact caller-worker and guardian cancel/reap plus bounded construction record reconciliation.
5. **Stalled construction fsync:** a test store Adapter blocks on an eventfd barrier. Deadline
   cancellation kills/reaps the exact worker and prevents final readiness; releasing the stale
   barrier cannot produce a later result or gate.
6. **Prepared post-commit response loss:** commit `PreparedPendingAck` before expiry, kill the
   client before socket/stdout delivery, then recover with a new attempt id. Receive the same
   reference and ACK it; exactly one guardian/leaf/lease exists.
7. **Activation before-gate expiry:** hold at `ActivationReady`, advance the fake clock to exact
   expiry, then offer release. Assert the permit is refused, the gated root is reaped, the workload
   marker is absent, and Activated is not returned.
8. **Activation HUP before gate:** hold at `ActivationReady` and kill the broker-client. Assert the
   same closed-gate cleanup and retained exact lease disposition.
9. **Activation post-gate response loss:** release the gate before expiry, discard the final
   response, and recover from `ActivationPending`. Assert one workload marker, one authentic
   activation event, one gate release, and convergence to Activated without replaying the gate.
10. **Late worker quarantine:** force an old worker result to become readable only after the
    supervisor has cancelled and reaped that worker. The old channel/result cannot complete a new
    request or alter its request/delivery/lease record.
11. **Greater-than-two-second success:** use a timerfd/event barrier, not `sleep`, to hold a valid
    operation beyond two seconds but release it before a larger original deadline. It succeeds,
    proving no hidden fixed two-second timeout remains.
12. **Zero grace:** `Terminate { grace_ms: 0 }` immediately uses the exact force seam while still
    obeying the same absolute deadline.
13. **Store commit boundary:** for delivery, lease, publication, activation, terminal, and request
    records, kill before rename, after rename/before directory sync, and after commit/before
    response. Reload must yield old, new, or retained closed state, never a fabricated phase.
14. **Lock and poll interruption:** contention and EINTR consume the original budget; no blocking
    lock, busy wait, or new deadline appears.
15. **Runtime-open cancellation:** HUP/expiry before `RuntimeReady` closes the bridge and leaves the
    gate inert. After `RuntimeReady`, ordinary runtime relay is unaffected by the opening deadline.
16. **Destructive commit:** expire/HUP immediately before and after exact guardian kill and
    `cgroup.kill`. Before commit no destructive action occurs; after commit reconciliation never
    selects another PID/path and never reports empty without the exact oracle.

Process-level death tests must execute real client/daemon framing and pidfds. Deterministic stalls
use a separately linked test harness or injected Rust Adapter; they must not add a production
argv/env/protocol selector. No oracle uses elapsed quiet time, `sleep`, PGID, PID-tree traversal,
or descendant sampling.

## Exact change map

Baseline functions are named because concurrent delivery work may move their line numbers.

| File | Required change |
| --- | --- |
| `native/linux-process-authority/src/deadline.rs` (new) | `AbsoluteMonotonicDeadline`, Linux/fake clock Adapters, timerfd creation, remaining/poll conversion, mutation-cutoff derivation, and `DeadlineIo`. |
| `native/linux-process-authority/src/broker_supervisor.rs` (new) | Deep mutation supervisor, client pidfd/HUP watch, disposable worker pidfd, checkpoint/result seqpackets, cancel/kill/reap, durable-state reload, and late-result quarantine. |
| `native/linux-process-authority/src/lib.rs` | Internal module wiring only. |
| `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker-client.rs` | In `prepare`, `control`, `record_publication`, `open_runtime`, `call`, `broker_request`, `send`, and `one_input`, create the absolute deadline before input, replace relative socket timeouts/blocking framing, preserve it across same-attempt retry, and make late stdout delivery non-mutating. |
| `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker.rs` | Replace detached `thread::spawn`/fixed 30-second `handle_one` path with bounded dispatcher/supervisor ownership; monitor client HUP; keep request replay and the concurrent delivery transitions in their owner Module; write responses only for the matching live attempt. |
| `native/linux-process-authority/src/broker_transport.rs` and `broker_protocol.rs` | Deadline-aware authentication/framing and closed bound validation. Keep `request_id` attempt-local. Adapt to, but do not redefine, the delivery fix's recover/ACK operations. |
| `native/linux-process-authority/src/broker_service.rs` | Replace entry-only validation with one `MutationContext` passed through `handle`, `prepare`, `record_publication`, `activate`, `inspect`, `terminate`, `open_runtime`, `fail_prepare`, and recovery. Change `GuardianAuthority` to the deadline-explicit prepare/activate/reopen/control Interface. |
| `native/linux-process-authority/src/broker_guardian.rs` | Make `prepare_inert_recoverable` a pidfd-based deadline supervisor; remove blocking child result/read/wait and inline unsupervised commit; compose with the pre-readiness permit; add deadline-aware activation-ready/gate-release/final handshake and exact guardian cancel/reap. |
| `native/linux-process-authority/src/primary.rs` | Preserve ordinary `prepare_primary`; add broker-only deadline-aware prepare/control entry points; replace fixed prepare/control timeouts and blocking pipe helpers in that path; ensure final readiness follows the construction permit; enforce the deadline at the workload gate. |
| `native/linux-process-authority/src/authority.rs` | Version the internal guardian control request/activation handshake and carry the semantic absolute deadline; no common provider/reference vocabulary expansion. |
| `native/linux-process-authority/src/broker_cgroup.rs` | Use the shared deadline value, deadline-aware nonblocking locks/waits, and the same absolute deadline for graceful/force/empty convergence. Remove the duplicate value type and relative tail deadlines. |
| `native/linux-process-authority/src/broker_lease.rs` and `journal.rs` | Keep atomic crash-safe codecs, but execute blocking commits inside supervised workers and expose exact reload/classification. Merge around the delivery fix's `PreparedPendingAck`/ACK transaction; add no competing delivery identity/index. |
| `src/core/session-host/process-authority/linux/native-assembly.ts` | Preserve the common context deadline, ensure deadline settlement kills the broker-client even without a second signal race, and treat native output after settlement as quarantined. Do not put capabilities or test controls in argv/env. |

Focused tests belong in:

- `native/linux-process-authority/tests/linux_broker_protocol_contract.rs` for exact deadline bounds,
  partial framing, recovery-call versus original mutation deadline, and internal codec rejection;
- `native/linux-process-authority/tests/linux_broker_service_contract.rs` for propagation,
  phase commits, HUP, late results, activation gate, zero grace, and store reload;
- `native/linux-process-authority/tests/linux_primary_contract.rs` for pre-readiness and gated-root
  deadline behavior with exact guardian/workload observations;
- a new process-level `linux_broker_deadline_contract.rs` for real broker-client/daemon death,
  pidfd reap, and response loss;
- TypeScript provider tests for common signal/deadline -> client death, late output quarantine, and
  controller recovery composition.

## RED -> GREEN sequence

1. Add the shared deadline value and exact-propagation/partial-I/O RED tests; replace duplicate
   arithmetic without changing lifecycle behavior.
2. Add RED client-HUP and late-worker tests around a minimal supervisor harness.
3. Implement the single-threaded/preforked process supervisor and exact worker pidfd reap; move
   blocking store/service execution behind it.
4. Add RED prepare stalls at worker, construction commit, and pre-readiness permit; then compose
   the ready-hook remediation and exact guardian cleanup.
5. Merge against the concurrent delivery transaction and close pre-/post-`PreparedPendingAck`
   response-loss tests without changing delivery identity or ACK ownership.
6. Add RED activation-ready/gate-release boundary and HUP tests; implement the internal guardian
   permit and absolute gate enforcement.
7. Thread the same context through publication, inspect, open-runtime, abort, terminate, cgroup,
   and terminal cleanup; remove fixed tails and blocking finite-path waits.
8. Run fresh default-parallel Rust tests, TypeScript tests/typecheck, fresh musl/WSL process-level
   oracles, strict Change validation, and independent non-author broker/seam review. Section 9
   remains open until the authorized installed root/cgroup-v2 runner exists.

## Failure and rollback semantics

- Expiry or HUP before a durable commit returns timeout/control loss only with the matching
  retained/reconciled record. It never fabricates Prepared, Activated, or ExactEmpty.
- An atomic commit completed before expiry remains authoritative even when response delivery is
  late. Delivery recovery, publication replay, activation reconciliation, and terminal replay
  return that same fact; they do not rerun the mutation.
- A killed worker's in-memory result is never accepted. Durable records plus exact guardian/cgroup
  observation are the only source of truth after cancellation.
- Missing, torn, conflicting, or identity-drifted state stays retained. Cleanup never targets a
  numeric PID, path replacement, PGID, PID tree, or sample.
- If worker/guardian reap cannot yet be observed, exact pidfd kill remains pending and the record
  remains retained. Workload gate permission stays closed unless its pre-expiry commit was proven.
- Older client/daemon/guardian internal codec versions reject the new semantic handshake. Rollback
  cannot leave a mixed client, service, supervisor, or guardian implementation.
- Before landing, rollback is atomic across deadline module, daemon/client framing, service
  Interfaces, prepare supervisor, and guardian activation. Prepared-delivery records from the
  concurrent fix remain authoritative; rollback must never restore request-id-only reachability.
- Development records may be removed only after the existing exact guardian/cgroup empty proof.
  Unknown/in-flight records block uninstall or rollback cleanup rather than being deleted.

## Review invariants

- Exactly one client-created `CLOCK_MONOTONIC` absolute expiry governs each mutation end to end.
- The prepared-delivery Module alone owns controller-known delivery identity,
  `PreparedPendingAck`, and ACK.
- Client HUP cancels pre-commit work in the daemon, not only the proxy process.
- Every finite blocking socket/fsync/lock/wait/poll path is deadline-aware or isolated in an exact
  killable/reapable process.
- Activation gate release has a deadline-aware guardian commit and cannot be replayed.
- Late results may record/reveal pre-expiry truth but cannot perform a new authority mutation or
  settle another request/generation.
- No test control is selectable through production argv, env, protocol, files, or feature flags.
- No authority or completion claim uses sleep, PGID, PID-tree traversal, or descendant sampling.

## Durable findings

1. Deadline checks are not supervision: any lifecycle path containing `fsync`, blocking framing,
   or blocking wait must sit inside a pidfd-owned worker whose durable result is reloaded after
   cancellation.
2. The activation deadline belongs at the guardian's workload-gate permit. A daemon/service check
   alone cannot prevent a late guardian from starting workload code.
3. Deadline supervision must compose under the delivery transaction: pre-`PreparedPendingAck`
   expiry reconciles, post-commit loss recovers the same reference, and no deadline fix may create
   a second identity/index or retire recovery before explicit ACK.
