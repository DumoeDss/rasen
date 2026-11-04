# Native Linux broker review report - round 2

Date: 2026-08-06
Reviewer role: fresh non-author, dispatched report-only
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
Review snapshot HEAD: `140115ced9df814f6adf3190b47171202d964a5e`
Final live native source SHA-256: `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd`
Scope: broker Rust/TypeScript client and assembly, daemon, guardian, service core,
cgroup authority, durable lease/recovery state, administrative assets, and focused tests.

## Verdict

**FAIL - 7 Blocker, 1 Major.**

The round-1 implementation materially advances the broker from a probe-only skeleton to a
source-wired lifecycle, and the fresh current-source WSL non-privileged broker matrix passes
41/41. However, the production boundary still has unrecoverable prepare windows, a hidden
publication operation, concurrent durable-state corruption races, terminal event loss, a
zero-grace/deadline incompatibility, and a remaining pathname cgroup deletion race. The
uninstaller also cannot remove a broker after any cleanup tombstone exists. Tasks 8.1-8.10
and security/spec gates 11.5-11.6 remain open. Section 9 was not run and is not claimed.

Scope Check: **REQUIREMENTS MISSING**

- Intent: deliver an explicitly installed, authenticated, replacement-safe broker whose
  non-migratable cgroup-v2 leaf implements the complete frozen lifecycle.
- Delivered: closed authentication/codecs, production route surfaces, caller-mapped guardian,
  durable lease/recovery records, fd-pinned cgroup control, trusted install inputs, singleton
  restart handling, and non-privileged Linux tests.
- Missing or incorrect: crash-recoverable prepare ownership, exact publisher provenance,
  serialized lease transitions, recovered root-result fidelity, common zero-grace termination,
  exact end-to-end deadlines, race-free cgroup deletion, post-use uninstall, and the real
  root-installed writable-cgroup gate.
- No broker-scope feature creep was found.

## Standards axis

Result: **FAIL - 6 Blocker, 1 Major.** Worst issue: authenticated concurrent requests can
overwrite one another's lifecycle transitions and silently resurrect a killed authority phase.

## Spec axis

Result: **FAIL - 6 Blocker, 1 Major.** Worst issue: prepare can leave a live guardian or a
committed lease with no recoverable client reference, while native activation can create its
own publication state without the exact common publisher record required by the spec.

## Findings

### BRK-R2-B01 - Blocker - The provisional Intent record cannot recover a guardian created before the worker returns

Evidence:

- `broker_service.rs:233-238` commits an Intent and passes `recovery_id` into guardian prepare.
- Production `PrimaryGuardianAuthority::prepare_inert_recoverable` ignores that value as
  `_recovery_id` (`broker_guardian.rs:283-289`). Its forked caller worker creates the real
  namespace guardian before returning `GuardianClientReference` (`broker_guardian.rs:290-327`).
- Until that return, the durable record is valid only as Intent and deliberately contains no
  scope, guardian identity, client reference, or cgroup (`broker_lease.rs:282-289`). The default
  `abort_recovery` cannot act on such an Intent because it requires those absent fields
  (`broker_service.rs:68-87`).

Impact: daemon death, worker death, or transport loss after native guardian creation but before
the parent records `GuardianPrepared` leaves a live namespace authority that a fresh broker can
neither identify nor abort. Startup then fails closed forever on an opaque Intent while the
guardian remains outside a usable client capability. This is the exact control-state-loss window
that round-1 `BRK-B02` required the provisional transaction to close.

Required fix: bind `recovery_id` into a root-owned, durable guardian-construction record before
the guardian can survive; make the fresh production guardian recover/abort by that id. Add actual
process-death injections before fork, after fork, after primary ready, during child-result write,
and before `GuardianPrepared` replacement.

### BRK-R2-B02 - Blocker - A normal two-second client timeout can commit an unreachable prepared lease

Evidence:

- The broker client applies one fixed two-second read/write timeout to every request
  (`rasen-linux-process-authority-broker-client.rs:36`, `289-290`).
- Native guardian prepare independently permits ten seconds at each construction gate
  (`primary.rs:28`, `420`, `436`). The daemon handles each connection in a detached thread and
  discards the handler result (`rasen-linux-process-authority-broker.rs:79-82`).
- Successful prepare commits the lease and then removes the provisional record before the daemon
  writes the Prepared response (`broker_service.rs:300-319`, daemon response at
  `rasen-linux-process-authority-broker.rs:292-314`). There is no request-id replay record.

Impact: if a valid prepare takes more than two seconds, the client returns control loss while the
daemon can continue, commit the lease, remove recovery, and fail to deliver the only reference,
token, and cgroup identity. The resulting inert guardian/cgroup is durable but unreachable by any
controller. This is a common latency window, not the unavailable Section 9 environment.

Required fix: carry one common absolute deadline into the client and daemon, retain a request-id
result/recovery record until Prepared delivery is replayable, and reconcile failed delivery without
discarding the only reference. Add delayed-prepare and response-loss actual-process tests.

### BRK-R2-B03 - Blocker - Native activation still creates publication truth from the launch digest

Evidence:

- The change spec requires the canonical full-reference ledger and states that native activation
  SHALL NOT create, imply, or replace publication truth (`spec.md:49-50`, activation scenario at
  `spec.md:67-71`).
- The production broker client handles `activate` by first sending `RecordPublication` itself,
  using only `attestation.launch_digest`, then sending Activate
  (`rasen-linux-process-authority-broker-client.rs:129-151`).
- The TypeScript test named "contains no hidden publication side effect" inspects only
  `provider.ts`; it never inspects or executes the broker client path
  (`linux-process-authority-provider.test.ts:635-650`).

Impact: the daemon never receives proof of the exact common publisher record or canonical full
reference. Possession of the broker private reference is enough to make the client self-declare a
different digest as published and activate a workload whose common reference may never have been
durably acknowledged. This introduces a new publication trust gap and leaves acknowledgement-loss
recovery bound to the wrong identity.

Required fix: route the exact common publisher commitment into the broker's durable lease through
an explicit publisher-owned seam before activation; activation may only verify it. Bind the
canonical full-reference digest, operation id, generation, and launch digest, and add a real broker
client mutation proving activation cannot publish.

### BRK-R2-B04 - Blocker - Threaded daemon requests can corrupt durable lease lifecycle state

Evidence:

- The daemon spawns one concurrent thread per authenticated connection
  (`rasen-linux-process-authority-broker.rs:79-83`).
- `DurableLeaseStore::replace` implements compare-then-rename without a store/lease lock: it reads
  the expected pathname (`broker_lease.rs:499-525`) and later overwrites it with `fs::rename`
  (`broker_lease.rs:751-769`).
- Service transitions such as publication, activation, inspect, and terminate independently read
  and replace the same record (`broker_service.rs:323-425`, `433-464`). The new per-leaf lock covers
  cgroup calls, not lease-file transitions.

Impact: two capability-authenticated requests can both observe Prepared, both pass the pathname
comparison, and then overwrite each other. For example, `RecordPublication` can race Abort so that
Published is written after the cgroup has been killed and cleanup begun, silently resurrecting a
retained lifecycle phase over an exact-empty authority. Duplicate activation/inspect transitions
have analogous lost-update windows. This violates the late/duplicate result scenario
(`spec.md:218-221`) and can corrupt recovery truth.

Required fix: serialize every lease lifecycle transaction across daemon threads and restarts with
one fd-pinned per-token lock or an actually atomic compare-and-swap representation. Add concurrent
publish/abort, activate/terminate, inspect/terminate, and duplicate-request stress tests.

### BRK-R2-B05 - Blocker - Cleanup tombstones discard authentic root-exit history and fabricate abort-shaped replay

Evidence:

- `CleanupComplete` retains identity/capabilities but no guardian journal or exact root result
  (`broker_lease.rs:49-68`, codec at `broker_lease.rs:121-223`).
- Inspect returns only `ExactScopeEmpty` as soon as it sees that tombstone and never reopens the
  guardian journal (`broker_service.rs:396-404`).
- The broker client then fabricates `Prepared -> ExactScopeEmpty`
  (`rasen-linux-process-authority-broker-client.rs:181-194`), which is the prepared-abort shape even
  when the lease had been Activated or RootExited.

Impact: if the controller/runtime stream dies after an activated workload's natural empty but
before it consumes root exit, replacement inspection permanently loses the exact exit code or
signal and reports an abort-shaped terminal history. The spec requires root exit and empty to be
distinct exact facts and treats lost/malformed root status as retained event gap/control loss
(`spec.md:95-112`). Empty replay is idempotent, but lifecycle evidence is silently corrupted.

Required fix: persist the closed terminal journal/root result in the authenticated tombstone, or
retain an exact pointer/digest to the durable guardian journal. Replay the authentic activated
history and return event-gap when root evidence is unavailable; never synthesize an abort history.

### BRK-R2-B06 - Blocker - Common zero-grace termination is rejected and longer controls time out at two seconds

Evidence:

- The frozen common coordinator accepts `graceMs >= 0` (`coordinator.ts:436-451`) and the
  compatibility adapter actively issues `graceMs: 0` (`process-scope-adapter.ts:220`).
- Broker TypeScript passes `intent.graceMs` directly as the native terminate timeout
  (`native-assembly.ts:727`), while the broker codec rejects zero
  (`broker_protocol.rs:522-525`; regression assertion at
  `linux_broker_protocol_contract.rs:94-101`).
- Even nonzero broker operations inherit the fixed two-second client response timeout
  (`rasen-linux-process-authority-broker-client.rs:36`, `289-290`), independent of the requested
  deadline up to five minutes.
- Fresh default-parallel `cargo test --locked` failed
  `termination_records_exact_empty_before_leaf_and_lease_cleanup` because its 250 ms deadline
  expired while reopening; serial broker tests passed, exposing a wall-clock-sensitive gate.

Impact: the production broker cannot satisfy the common immediate-force path at all. Controls with
valid longer deadlines can return early control loss while the daemon continues destructive work,
so caller settlement and daemon authority diverge. `graceMs` is also a graceful-policy interval,
not the entire phase deadline.

Required fix: encode graceful policy separately from the common absolute phase deadline, permit
zero grace, derive all waits and socket timeouts from the remaining deadline, and cancel or retain
late work exactly once. Add zero-grace, >2-second convergence, delayed response, abort, and
deadline-boundary production-client tests.

### BRK-R2-B07 - Blocker - Empty-leaf removal re-enters by pathname after the last identity check

Evidence:

- Writes to `cgroup.procs` and `cgroup.kill` now use the pinned leaf descriptor and are improved.
- Cleanup still validates the pinned binding, then separately calls
  `unlinkat(parent_fd, leaf_name, AT_REMOVEDIR)` (`broker_cgroup.rs:630-650`, unlink helper at
  `broker_cgroup.rs:840-845`). A privileged replacement can rename the pinned leaf and create a
  different empty leaf at the same name between the last validation and `unlinkat`.
- The actual Linux replacement test proves only that a pinned control-file write stays on the old
  fd; it does not exercise removal of a pathname replacement
  (`broker_cgroup.rs:961-1018`).

Impact: cleanup can delete a different empty cgroup at the reused path after proving the old inode.
This is still a destructive operation against replacement identity, prohibited by the token/inode
drift scenario (`spec.md:196-199`). Per-lease in-process serialization does not exclude a
privileged external controller or crash/restart pathname race.

Required fix: use a removal protocol that makes name identity stable under the service-wide
administrative lock (or an equivalent kernel-backed compare/remove sequence), and prove the exact
inode/name immediately through the destructive step. Add a real cgroup replacement-during-remove
oracle; a before/after check alone is insufficient.

### BRK-R2-M01 - Major - Cleanup tombstones make normal post-use uninstall impossible

Evidence:

- Successful control intentionally retains up to 1,024 `CleanupComplete` tombstones
  (`broker_lease.rs:19`, `685-725`; service pruning at `broker_service.rs:541-547`).
- `uninstall.sh` refuses if the lease directory contains any entry, without decoding or accepting
  authenticated cleanup tombstones (`uninstall.sh:58-64`).
- Task 8.2 asks for an idempotent uninstaller that refuses active populated leases, not all
  completed history (`tasks.md:83`).

Impact: after the first successful broker lifecycle, an ordinary uninstall always stops with
"durable or unrecognized lease state remains". Tombstone pruning never reaches zero because the
production retain bound is fixed at 1,024. This leaves the administrative lifecycle incomplete.

Required fix: while holding the stopped-service singleton, strictly decode the root-owned store,
refuse every retained/recovery/unknown record, and allow deletion of unchanged authenticated
`CleanupComplete + ExactEmpty` tombstones before removing recovery identity. Add executed isolated
filesystem/systemctl-fixture coverage and close it on the real privileged gate.

## Round-1 closure matrix

| Round-1 finding | Round-2 status | Evidence |
|---|---|---|
| `BRK-B01` lifecycle wiring | **OPEN** | Routes exist, but hidden publication, zero-grace failure, prepare response loss, and terminal-history corruption make the production lifecycle non-conformant (`BRK-R2-B02`, `B03`, `B05`, `B06`). |
| `BRK-B02` provisional recovery | **OPEN** | The durable Intent exists, but production ignores `recovery_id` and cannot recover the guardian-before-result window (`BRK-R2-B01`); response loss can also remove recovery before reference delivery (`B02`). |
| `BRK-B03` terminal replay | **OPEN** | Empty is replayable, but the tombstone discards/fabricates lifecycle evidence (`BRK-R2-B05`). |
| `BRK-B04` fd-pinned serialized cgroup identity | **OPEN** | Control-file writes are fd-pinned, but lease transitions are not serialized and leaf removal is still pathname-racy (`BRK-R2-B04`, `B07`). |
| `BRK-B05` trusted installer inputs | **CLOSED in source** | System PATH is pinned; absolute root-owned non-writable staging ancestry, source identity/digest, staged digest, and fixed destinations are checked. Real root installation remains Section 9. |
| `BRK-B06` stop/singleton uninstall race | **PARTIAL / OPEN** | Stop failure, inactive state, MainPID, and singleton are now checked, but completed tombstones make post-use uninstall impossible (`BRK-R2-M01`). |
| `BRK-B07` stale socket restart | **CLOSED in source** | One root-owned flock domain and identity-checked `ConnectionRefused` reclamation are implemented. Actual SIGKILL/restart with a live lease remains Section 9. |
| `BRK-M01` monotonic end-to-end deadline | **OPEN** | The cgroup loop uses monotonic time, but the client has a fixed 2 s response timeout, zero grace is rejected, and graceful policy is conflated with the phase budget (`BRK-R2-B02`, `B06`). |

## Coverage map

```text
BROKER CODE PATH COVERAGE
=========================
[+] Protocol, peer, key manifest, request capability, response codecs
    +-- [TESTED] closed frames, fresh nonce, SO_PEERCRED, Ed25519, bounds
    +-- [GAP] production client response-loss/replay across every operation
[+] Prepare and provisional recovery
    +-- [TESTED/FIXTURE] Intent -> GuardianPrepared -> LeafPrepared and ambiguous cleanup
    +-- [GAP -> BLOCKER] daemon/worker death before GuardianPrepared; delayed Prepared response
[+] Publication and activation
    +-- [TESTED/FIXTURE] service Prepared -> Published -> ActivationPending -> Activated
    +-- [GAP -> BLOCKER] exact common publisher digest; native activation cannot self-publish
[+] Durable lease lifecycle
    +-- [TESTED/FIXTURE] sequential transitions, terminal cleanup, duplicate empty replay
    +-- [GAP -> BLOCKER] concurrent authenticated transitions and cross-thread CAS
[+] Guardian/runtime/root/empty
    +-- [TESTED/FIXTURE] signal root exit then natural empty in one process
    +-- [GAP -> BLOCKER] replacement recovers exact root result after CleanupComplete
[+] Cgroup authority
    +-- [TESTED/ACTUAL LINUX] pinned control-file replacement, monotonic wait, serialization
    +-- [GAP -> BLOCKER/SECTION 9] removal race, migration denial, real cgroup.kill,
        populated restart, unrelated-cgroup survival
[+] Installer/uninstaller/stale socket
    +-- [TESTED/STATIC] trusted sources, failed stop, singleton ordering, socket policy
    +-- [GAP -> MAJOR/SECTION 9] terminal tombstone uninstall and actual root execution

TERMINAL COVERAGE
=================
Current-source host/cross-build/non-privileged WSL checks: mostly PASS (one parallel host flake)
Actual installed daemon lifecycle: NOT RUN
Actual writable unified cgroup-v2/root gate: UNAVAILABLE / NOT RUN
Section 9, production default, package release, and terminal Linux support: NOT CLAIMED
```

## Verification receipts

Successful fresh commands:

1. Broker-focused host locked tests, serial:
   `cargo test --locked ... --test linux_broker_* -- --test-threads=1`
   - 38/38 passed on Windows; Linux-only SO_PEERCRED selected zero there.
2. Linux all-target check:
   `cargo check --locked --all-targets --target x86_64-unknown-linux-gnu ...`
   - Passed; cross-target build evidence only.
3. Current-source static-musl no-run build:
   `RUSTFLAGS='-C linker=rust-lld' cargo test --locked --target x86_64-unknown-linux-musl --no-run ...`
   - Passed; emitted 18 test ELFs.
4. Actual WSL execution of current-source broker library/integration ELFs, serial:
   - 41/41 broker tests passed, including SO_PEERCRED, fd-pinned replacement, codecs,
     recovery/replay, pruning, root-exit/natural-empty, and virtual/deferred deadline oracles.
5. Focused TypeScript broker/provider/resolver/boundary suites:
   - 39/39 passed.
6. `pnpm exec tsc --noEmit`: passed.
7. Focused ESLint for native assembly/provider/provider test: passed.
8. Pinned WSL Rust 1.88 `cargo fmt --all -- --check`: passed.
9. WSL `sh -n` for both administrative scripts: passed; neither was executed as root.
10. `node scripts/build-linux-process-authority.mjs --check-only --target x86_64-unknown-linux-gnu`:
    passed, final live source digest `c98040d5...5780dd`.
11. `node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json`:
    1/1 valid, 0 issues.

Failed or non-terminal receipts:

- Default parallel `cargo test --locked` stopped in `linux_broker_service_contract` with
  46 passed and 1 failed before later binaries ran. The 250 ms control deadline expired while
  reopening the guardian; the same broker selection passed 38/38 serial. This is retained as
  evidence for `BRK-R2-B06`, not relabelled as a clean host gate.
- A concurrent package/CI-focused run had four failures in package-owned provenance/npm/CI
  expectations. Those files were being changed by the separate package owner and are excluded
  from broker finding counts; the LEAD was notified as a durable out-of-scope finding.
- WSL kernel: `5.15.167.4-microsoft-standard-WSL2`. `/sys/fs/cgroup` is a read-only tmpfs;
  `/sys/fs/cgroup/unified` is mounted cgroup2 but exposes no required controller/events/kill
  surface and is not writable to this reviewer. No root install, daemon service, or real broker
  leaf was exercised.

## Required next review entry criteria

1. Resolve every finding above with production-path regression oracles, especially real process
   death/response-loss/concurrency rather than static source-string assertions.
2. Re-run the default parallel host gate until deterministic, plus the fresh current-source WSL
   broker matrix.
3. Run a new non-author source/security review after fixes.
4. Keep all Section 9 tasks open until the exact root-installed writable-cgroup-v2 matrix and
   independent security receipt run on an authorized dedicated Linux environment.
