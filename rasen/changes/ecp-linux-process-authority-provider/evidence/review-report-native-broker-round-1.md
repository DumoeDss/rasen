# Native Linux broker review report - round 1

Date: 2026-08-06
Reviewer role: fresh non-author, dispatched report-only
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
Review snapshot HEAD: `140115ced9df814f6adf3190b47171202d964a5e`
Scope: broker protocol/transport, service core, cgroup authority, durable lease store,
installed daemon, installer/uninstaller/service assets, and broker-focused tests.

## Verdict

**FAIL - 7 Blocker, 1 Major.**

The platform-neutral broker fixtures and cross-target build checks pass, but the installed
daemon still accepts only authenticated probes. The production guardian/client/runtime
path is absent, and the implemented broker core has unresolved recovery, target-identity,
deadline, and privileged-administration defects. Tasks 8.5-8.10 and the security gate in
11.5 must remain open. No Section 9 terminal claim is available.

Scope Check: **REQUIREMENTS MISSING**

- Intent: deliver an explicitly installed, authenticated, recoverable broker whose
  non-migratable cgroup-v2 leaf supplies exact lifecycle authority.
- Delivered: closed protocol/authentication primitives, root-owned path policy, durable
  lease/cgroup/service fixtures, probe-only installed daemon, and administrative assets.
- Missing: production caller-mapped guardian, daemon/client lifecycle routing, runtime
  duplex, root-exit/natural-empty observations, crash-safe daemon restart, terminal replay,
  and actual installed cgroup-v2 evidence.
- No broker-scope feature creep was found.

## Standards axis

Result: **FAIL - 5 Blocker, 1 Major.** Worst issue: privileged installation and destructive
cgroup control are not pinned to immutable inputs/targets.

- `BRK-B02`, `BRK-B03`, `BRK-B04`, `BRK-B05`, and `BRK-B06` violate the fail-closed,
  data-safety, race-safety, or privileged trust-boundary baseline.
- `BRK-M01` violates bounded wall-clock deadline semantics.

## Spec axis

Result: **FAIL - 4 Blocker, 1 Major.** Worst issue: the installed provider cannot execute a
single broker lifecycle operation beyond probe.

- `BRK-B01`, `BRK-B02`, `BRK-B03`, and `BRK-B07` leave required tasks/scenarios partial or
  wrong.
- `BRK-M01` does not implement the specified per-phase timeout.

## Findings

### BRK-B01 - Blocker - Installed broker lifecycle is not wired

Evidence:

- `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker.rs:171-180`
  returns `AuthorityUnavailable` for every operation except an empty authenticated probe.
- `native/linux-process-authority/src/broker_service.rs:146-149` explicitly rejects
  `OpenRuntime` as unsupported.
- Repository search finds no production caller of `authenticate_broker`; only the function
  definition exists in `broker_transport.rs:82`.
- The implementer handoff also declares the daemon probe-only, consistent with the code.

Impact: tasks 8.1 and 8.5-8.10 are not end-to-end behavior. There is no caller-mapped
privileged guardian, immutable launch transport, runtime duplex, inspect/root-exit path,
or installed client capable of exercising the otherwise fixture-only `BrokerServiceCore`.
The broker provider cannot prepare or control a workload.

Minimum fix: implement the production `GuardianAuthority` with exact peer uid/gid mapping
and inherited-descriptor hardening; add the pinned-manifest client connector; encode/decode
every successful service response; route all operations through one production
`BrokerServiceCore`; implement the byte-exact runtime bridge and root/empty event flow.
Add an installed-daemon integration test that exercises prepare -> publish -> activate ->
root exit -> exact empty plus abort and terminate. Do not mark the task complete from mock
core tests.

### BRK-B02 - Blocker - Failed prepare can lose a live guardian/cgroup without a durable recovery record

Evidence:

- `broker_service.rs:166-169`, `181-183`, and `201-204` discard failures from guardian abort
  and cgroup force/cleanup while no lease has necessarily been committed.
- `broker_cgroup.rs:116-123` calls `cleanup_partial_exact_leaf` and returns the original
  error, while that cleanup function returns no outcome and silently gives up on drift,
  event error, or kill failure.
- The mutation at `tests/linux_broker_cgroup_contract.rs:210-218` positively models this
  state: preparation returns an error while the leaf still exists, was not killed, and was
  not cleaned. No durable lease is created by that test or by `prepare_leaf`.

Impact: a prepare/store failure can leave privileged authority or kernel state alive with
no client reference and no durable token from which restart reconciliation can resume.
This contradicts `design.md:62`, the exact partial-cleanup scenario in the spec, and the
retained-failure requirement. It is control-state loss, not a safe retained failure.

Minimum fix: make partial construction a durable transaction. Before any state can become
unprovably live, persist a bounded provisional/quarantine record containing the exact
guardian and leaf identities. Return a normal prepare failure only after both guardian and
leaf are positively proven gone. If cleanup is ambiguous, retain the recovery record and
fail broker startup/prepare closed until exact reconciliation succeeds. Add injected
failure tests for every guardian/place/revalidate/store/fsync/kill/events/cleanup boundary,
including a fresh broker process reopening the retained record.

### BRK-B03 - Blocker - Exact-empty cleanup is neither crash-recoverable nor idempotently replayable

Evidence:

- `broker_service.rs:292-297` binds/reopens the cgroup before checking whether the durable
  lease is already `ExactScopeEmpty`.
- `broker_service.rs:303-309` persists the terminal lease, removes the leaf, then deletes
  the terminal lease.
- A crash after `cleanup_already_empty` removes the leaf but before `remove_terminal`
  leaves a durable terminal record whose next retry fails at `bind_recovered`, because the
  exact leaf is now absent. A normal successful return deletes the only terminal record,
  so a lost response/repeated authenticated request becomes `unknown token`, not the same
  exact-empty receipt.
- `tests/linux_broker_service_contract.rs:415-452` checks only a single successful control;
  there is no crash-after-leaf-removal or repeated-control oracle.

Impact: the broker cannot recover one of its own documented crash windows and cannot meet
the repeated-termination/idempotent-tombstone contract (`design.md:104`, tasks 9.4/9.6).
An acknowledgement loss after a real kill can strand a retained lease forever or turn a
successful destructive operation into an unauthenticated-looking retry.

Minimum fix: model exact empty and cleanup as separate durable phases. Reconcile the
terminal phase before requiring a live leaf; prove either the same empty inode or the
authenticated, non-conflicting absence of the already-cleaned exact leaf. Retain a bounded
terminal tombstone long enough to answer duplicate/lost-ack requests idempotently. Add
fresh-process tests for crashes before terminal fsync, after terminal fsync, after leaf
removal, and after response loss, plus repeated abort/terminate.

### BRK-B04 - Blocker - Destructive cgroup operations re-enter by pathname after identity validation

Evidence:

- `broker_cgroup.rs:450-455` revalidates a leaf and then separately opens pathname
  `cgroup.procs` to move the guardian.
- `broker_cgroup.rs:477-480` revalidates and then uses `fs::write` on pathname
  `cgroup.kill`.
- `broker_cgroup.rs:492-501` revalidates/population-checks and then removes the pathname.
- `reopen_leaf` validates device/inode only before those separate pathname syscalls; the
  test fixture changes identity between high-level calls but does not replace a real path
  between validation and open/write/remove.

Impact: a concurrent privileged controller, failed uninstall race, or future concurrent
broker request can replace the apparent leaf after validation. The operation may move the
guardian into, kill, or remove a different cgroup at the same path, violating the explicit
no-destructive-operation-on-replacement requirement and unrelated-process survival gate.

Minimum fix: open and retain an `O_PATH|O_DIRECTORY|O_NOFOLLOW` leaf fd, compare its
`fstat` identity to the lease, and open control files relative to that fd with
`openat2`/`openat` and no symlink traversal. Perform writes through the already-open
control fd, serialize destructive operations per lease, and revalidate the pinned handle
after the operation. Add an actual Linux replacement race oracle; a before/after pathname
check alone is insufficient.

### BRK-B05 - Blocker - Root installer trusts ambient PATH and mutable source pathnames

Evidence:

- `install/install.sh:1-23` never pins a trusted `PATH` and validates only that each source
  pathname is a regular non-symlink at one instant.
- It subsequently invokes PATH-resolved privileged utilities throughout the script and
  rereads those same mutable source pathnames in `install.sh:80-96`.
- The expected installation flow accepts a source-built binary from a user-owned build
  tree; no source ancestor ownership, open-file identity, or trusted build digest is pinned
  across check/copy.

Impact: an attacker who influences the root invocation environment can substitute `id`,
`getent`, `stat`, `install`, `mv`, or `systemctl`. A user able to replace a supplied build
artifact between validation and copy can install attacker bytes as the root broker. This
is a direct privileged code-execution boundary failure.

Minimum fix: pin/export a known system PATH or use absolute utility paths, and consume
source assets only from a root-owned non-writable staging directory. Prefer a small
source-owned Rust administrative installer that opens each asset with no-follow semantics,
validates owner/ancestors, verifies exact trusted build/key/unit digests, copies from the
pinned descriptor, fsyncs, and atomically installs. Add adversarial PATH and source-swap
tests.

### BRK-B06 - Blocker - Uninstall continues when service stop fails

Evidence:

- `install/uninstall.sh:14` executes `systemctl stop ... || true` and never proves the unit
  or socket listener is inactive before scanning leases/cgroups and deleting recovery
  identity.
- The comment claims the request race is closed, but the command explicitly ignores the
  failure that determines whether it was closed.

Impact: on a D-Bus/systemd failure or a still-running stray broker, prepare can race after
the empty-state scan. The uninstaller can then remove the socket, key, manifest, binary,
and service unit while a new durable lease/cgroup is live. That destroys recovery/control
identity for an active authority.

Minimum fix: acquire the same root-owned singleton/administrative lock used by the daemon,
stop the service, and fail unless service and socket listener death are positively proven.
Hold the lock through lease/cgroup validation and removal. Never convert a failed stop into
success. Add a mutation where stop fails and another where a prepare races the uninstall;
both must leave every recovery asset intact.

### BRK-B07 - Blocker - A normal daemon crash cannot restart because its pathname socket persists

Evidence:

- `rasen-linux-process-authority-broker.rs:62-67` rejects any existing socket pathname.
- The systemd unit sets `Restart=on-failure` at
  `install/rasen-linux-process-authority-broker.service:13`, but defines no systemd socket
  activation or `RuntimeDirectory` cleanup and the daemon has no exit cleanup/singleton
  protocol.

Impact: SIGKILL or process crash leaves the Unix socket inode. Every systemd restart exits
with `AlreadyExists`, so no authenticated replacement can reopen the durable lease/token
and cgroup inode required by task 8.9 and the broker restart scenario.

Minimum fix: use systemd socket activation, or hold a root-owned singleton lock and remove
only an exact proven-stale socket after proving no live owner/listener exists. Preserve the
rule that a live endpoint is never replaced. Add an actual daemon SIGKILL/restart test with
a durable populated lease and an endpoint-spoof mutation.

### BRK-M01 - Major - `timeout_ms` is treated as a read-count, not a wall-clock deadline

Evidence:

- The wire protocol names and bounds the field as milliseconds
  (`broker_protocol.rs:510-514`).
- `broker_service.rs:287-301` renames it `maximum_population_reads` and passes it directly
  to cgroup control.
- `broker_cgroup.rs:167-187` performs that many immediate reads with no monotonic clock,
  wait/poll, sleep, or abort context.

Impact: a request for 250 ms can fail after a microsecond-scale burst before asynchronous
kernel teardown completes, while 300,000 reads can consume substantial CPU/I/O and run
past the promised five-minute bound. The result remains fail-closed, but deadline behavior
is materially wrong on a plausible terminate path.

Minimum fix: carry one monotonic absolute deadline from the authenticated request through
guardian and cgroup control. Wait on `cgroup.events`/poll with bounded wakeups, revalidate
the pinned leaf after each wake, honor abort, and settle once when the actual deadline
expires. Add virtual-clock unit tests and a real delayed populated-to-empty oracle.

## Coverage map

```text
BROKER CODE PATH COVERAGE
=========================
[+] Protocol/challenge codecs
    +-- [TESTED] closed frames, nonce, pinned Ed25519, bounds (4 host tests)
    +-- [GAP] installed client manifest/socket/authentication journey
[+] Peer identity
    +-- [COMPILE/PRIOR ONLY] SO_PEERCRED Linux test target
    +-- [GAP -> REAL LINUX] fresh peer test in this review could not link without the
        isolated Zig linker wrapper; no terminal claim made
[+] Durable lease store
    +-- [TESTED] codec, collision/corruption, simple restart, terminal deletion (4 tests)
    +-- [GAP] concurrent replace, cleanup crash windows, durable idempotent tombstone
[+] Cgroup authority
    +-- [TESTED/FIXTURE] place, drift, kill-to-empty, retained errors (6 tests)
    +-- [GAP -> REAL CGROUP V2] fd-pinned target, replacement race, migration denial,
        cgroup.kill, broker owner death, unrelated-process survival
[+] Service core
    +-- [TESTED/FIXTURE] prepare, publish/restart, activation pending, auth drift,
        one-shot abort (5 tests)
    +-- [GAP] partial cleanup recovery, response-loss replay, wall-clock deadline,
        root-exit/natural-empty, runtime duplex
[+] Installed daemon/admin
    +-- [TESTED/STATIC] path model/admin plans and shell syntax (7 Rust tests + sh -n)
    +-- [GAP -> E2E] lifecycle routing, crash restart, safe install/uninstall, source swap,
        failed-stop race

TERMINAL COVERAGE
=================
Fixture/host/cross-build checks: PASS
Actual installed daemon lifecycle: NOT IMPLEMENTED
Actual writable unified cgroup-v2 gate: NOT AVAILABLE / NOT RUN
General install, package, closure, or release support: NOT CLAIMED
```

## Verification receipts

Successful commands:

1. `cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml`
   - 40 passed, 0 failed on the Windows host.
   - Broker-focused host selection: 26 passed; the Linux-only SO_PEERCRED test selected
     zero tests and is not Linux runtime evidence.
2. `cargo check --locked --all-targets --target x86_64-unknown-linux-gnu --manifest-path native/linux-process-authority/Cargo.toml`
   - Passed. This is cross-target compile evidence only.
3. WSL `sh -n` for `install.sh` and `uninstall.sh`
   - Passed. Neither script was executed administratively.
4. `cargo metadata --locked --format-version 1 --no-deps ...`
   - Passed.
5. `rasen validate ecp-linux-process-authority-provider --strict --json`
   - 1/1 valid, 0 issues.

Environment-limited checks (not product failures and not passes):

- Fresh WSL `linux_broker_peer_contract` build stopped before test execution because the
  isolated invocation lacked `cc`; the recorded WSL toolchain uses a separately provisioned
  Zig linker wrapper that was not recreated during this report-only review.
- Host `cargo fmt --check` could not run because pinned Windows Rust 1.88 lacks
  `cargo-fmt`. The earlier recorded pinned WSL format receipt remains historical evidence,
  not a fresh review receipt.

## Declared gates that remain open but are not additional round-1 regressions

- Tasks 9.1-9.7: no dedicated writable unified cgroup-v2/root-installed broker environment
  is currently available. Fixtures, Windows execution, cross-compilation, and ordinary WSL
  do not close these tasks.
- Real root install/service ownership, key identity, caller non-writeability, migration
  denial, broker death/restart, drift, recursive kill, natural empty, and unrelated-process
  survival still need the dedicated gate.
- Tasks 10.x and the relevant 11.x package/build/security/spec/closure handoff gates remain
  open. No package, closure, production-default, general Linux, or release statement follows
  from this review.
- Tasks 8.5-8.10 are findings rather than environment-only gates because required
  production behavior is absent or incorrect in the reviewed source.

## Required re-review entry criteria

1. Resolve every Blocker and Major above with focused regression tests.
2. Wire the production installed broker path before requesting another implementation
   review; a larger fixture-only core is insufficient.
3. Run a fresh non-author review of the fix delta, then run the real Section 9 gate on an
   authorized environment before any terminal broker claim.
