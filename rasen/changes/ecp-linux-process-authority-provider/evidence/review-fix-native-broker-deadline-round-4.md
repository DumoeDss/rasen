# Native broker deadline/readiness fix — round 4

Date: 2026-08-06\
Role: fresh design-level fixer\
Change: `ecp-linux-process-authority-provider`\
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`\
Start HEAD: `140115ced9df814f6adf3190b47171202d964a5e`

## Implementation boundary

This pass is limited to `BRK-R2-B06`, the `BRK-R2-B01` Major residual, and
`NATIVE-SEAM-R1-M01/M02`. It implements one absolute monotonic deadline through broker mutation,
recoverable primary construction, and guardian activation, with pidfd-owned cancellation and a
deadline-aware pre-readiness/workload-gate permit. It also adds behavior-sensitive regressions for
the persistence-before-readiness order and for zero post-deadline mutation.

The concurrent prepared-delivery transaction is frozen input. This pass preserves its
controller-known `preparationOperationId`, delivery capability/index, `PreparedPendingAck`, exact
response replay, explicit ACK, delivery reclamation, leaf recovery, shipping transaction, and
orphan enumeration. It does not create a second delivery identity, use attempt-local `request_id`
as durable reachability, retire recovery before ACK, or assemble a different prepared reference.

The pass does not edit `tasks.md`, pipeline run-state, Direction, macOS, Windows, provider defaults,
release truth, Git state, commits, pushes, or stashes. It does not claim or simulate the privileged
Section 9 cgroup-v2 gate.

## Frozen design invariants

1. One client-created `CLOCK_MONOTONIC` absolute expiry governs every finite mutation and is never
   reset to `now + timeout` in a later phase.
2. Blocking persistence, framing, lock, and wait work is either deadline-aware or contained in an
   exact killable/reapable process. A deadline check alone is not supervision.
3. The exact construction reference is committed and reopened before final guardian readiness;
   timeout/error leaves no live unreferenced guardian or workload marker.
4. Guardian workload-gate release is the activation linearization point. A permit offered at or
   after expiry cannot exec workload code.
5. Pre-`PreparedPendingAck` timeout reconciles the existing exact construction. Post-commit
   response loss reuses the delivery transaction's byte-identical response and reference.
6. Late worker results can reveal a pre-expiry durable fact but cannot perform a new mutation,
   settle another attempt, select a new identity, or fabricate exact empty.

## Verification ledger

Implementation continuation completed the partially written supervisor/service transaction and
froze the current source on the same branch. This is apply evidence, not an independent finding
closure or review-cycle verdict.

### Completed source delta

- `BrokerMutationSupervisor::execute_for_client` now threads the already opened authenticated
  client pidfd into `wait_for_result`, polls it beside the socket and exact worker pidfd, and kills
  and reaps only the supervised mutation worker when that client process dies.
- The shipping daemon now uses `execute_for_client` with the peer PID obtained from authenticated
  Unix credentials; the pidfd path is production-reached rather than a dead helper.
- Prepare now rechecks one absolute deadline at every durable phase boundary. A deadline that
  expires after the exact lease exists aborts the inert guardian, empties/removes the bound leaf,
  advances the lease through exact-empty/cleanup-complete, retires provisional recovery, and
  reconciles the delivery instead of leaving an unreachable prepared authority.
- Prepared response commit accepts the original deadline explicitly. Startup and retry recovery
  reconcile an expired `Preparing` lease rather than promoting it to `PreparedPendingAck` after
  expiry.
- Recover, ACK, reopen, inspect, publication, activation, runtime-open, abort, and terminate now
  consume the request's original absolute deadline at their service boundary. Inspect checks
  before identity reopen, native observation, and each durable lifecycle transition.
- The fresh-controller TypeScript bundle owns closed orphan recovery: `Intent` performs broker
  recover, exact reference validation/storage, publication prepared-state recording, and ACK;
  `ReferenceStored` revalidates and ACKs; unrecoverable work is exactly aborted or retained. It
  does not expose the older unconstrained callback-only seam.

### Focused commands and receipts

1. `cargo fmt --all -- --check` with stable Rust: **PASS**.
2. Rust 1.88 locked Linux GNU cross-target `cargo check --all-targets`: **PASS**, no warning.
3. Rust 1.88 locked static-musl `cargo test --no-run`: **PASS** for the complete crate and all
   test binaries.
4. Fresh static-musl ELFs executed as Linux processes on WSL2 Ubuntu 24.04:
   - supervisor unit subset: **4 passed, 0 failed**;
   - broker admin: **7 passed, 0 failed**;
   - cgroup: **9 passed, 0 failed**;
   - install: **4 passed, 0 failed**;
   - lease: **13 passed, 0 failed**;
   - peer credentials: **1 passed, 0 failed**;
   - protocol: **6 passed, 0 failed**;
   - service: **21 passed, 0 failed, 1 ignored**. The ignored row is the documented subprocess
     selector entrypoint; its parent shipping process-loss oracle passed.
5. TypeScript preparation-delivery and provider Vitest suites: **31 passed, 0 failed**.
6. Scoped Linux preparation-delivery/provider/native-assembly ESLint: **PASS**.
7. Current-tree locked dual-binary package check:
   `node scripts/build-linux-process-authority.mjs --check-only --target
   x86_64-unknown-linux-gnu`: **PASS**, explicitly `cross-build-non-runtime`, with identical
   before/after source SHA-256
   `49c327ca968e7b2f40ea4a23f0a2cf3cd014732635afec8b3112d3d3c1146540`.
8. Linux resolver/package-CI plus legacy package/provenance: **47 passed, 0 failed**.
9. Full named legacy ProcessCapsule regression group for native, replacement, migration,
   deadline, package, provenance, and macOS identity: **28 passed, 0 failed, 4 platform skips**.
   The legacy build script remains SHA-256
   `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92`, identical to the accepted
   baseline.

### Frozen implementation identities

```text
broker_service.rs                              734aac0823a64a7b52105f8ffa75c7a4f223db5b2863186111e404263746aa81
broker_supervisor.rs                           9a9439188e33d5741339d8ca6f9ec57f3bb7eaa2e4d8a98372bc2f85f51769d8
broker_daemon_transaction.rs                   80e18efdeeda7abde3efa663b588942860474b4887bc25232f17555930e11fd3
linux_broker_service_contract.rs               68906ea57d3d78038e30adadab2c976af6a35197577beb865fd63c5fa0a8d3c2
linux_broker_admin_contract.rs                 97425660466b40a4dce95bf27dd5fda23fd51402cf2e81632c994e95c74cecf9
```

### Accounting boundary

The implementation ledger supports completion of Tasks `3.1`, `3.7`, `8.1` through `8.10`,
`10.1`, `10.4`, and `10.7`. It does not close `NATIVE-SEAM-R1-M01/M02`, `BRK-R2-B01`,
`BRK-R2-B02-M03`, or `BRK-R2-B06`; those identifiers remain open until the later consolidated
fresh review wave evaluates this frozen delta. It also does not close WSL gaps `M00/M01/M04-M06`,
Task `7.2`, Section 9, production defaults, distribution support, release, or macOS.
