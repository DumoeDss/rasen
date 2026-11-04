# Native broker prepared-delivery recovery review — round 4

Date: 2026-08-06\
Role: fresh non-author reviewer, dispatched report-only\
Change: `ecp-linux-process-authority-provider`\
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`\
Review snapshot HEAD: `140115ced9df814f6adf3190b47171202d964a5e`

## Verdict

**FAIL — `BRK-R2-B02` remains OPEN as one Major acceptance residual.**

Round 4 closes both former Blockers (`BRK-R2-B02-A/B`) and the native leaf/process-loss Majors
(`M01/M02`). The current tree now has a prepare-digest-independent broker operation key, bounded
active ownership, terminal reclamation, a durable `LeafCreating` crash state, and one current-tree
actual-WSL run of the shared shipping daemon/client transaction route.

`BRK-R2-B02-M03` remains open. A fresh controller can enumerate trusted ledger records without a
remembered UUID, but the exposed recovery object only invokes a caller-supplied callback. It does
not itself recover/validate/store/ACK an `Intent`, replay ACK for `ReferenceStored`, or exactly
abort/reconcile an undelivered operation. There is no production consumer elsewhere in the tree.
The fresh-process test only copies orphan fields into a JSON result. This is discovery, not the
closed recovery/reconciliation interface required by the remediation design.

Not switching ProcessScope/SessionHost/default selection in this Change is correct and remains a
frozen non-goal. It does not, however, make an incomplete provider-owned orphan reconciliation
acceptable: the design requires either a durable production operation owner or bundle-owned exact
orphan reconciliation before a logically new operation is accepted. Neither exists in the current
tree. No production-default switch is required to fix this residual; the Linux bundle can own the
closed recovery/abort capability while closure later chooses and wires the provider.

This review does **not** close or rerank `BRK-R2-B06`, residual `BRK-R2-B01`, either ready/deadline
seam, WSL `M00-M06`, Section 9, installed-root/writable-unified-cgroup-v2, package, default,
release, or terminal Linux-support gates.

Scope Check: **REQUIREMENTS MISSING**

- Intent: close Round-3 delivery operation uniqueness, lifetime capacity, leaf-construction crash,
  shipping process-loss, and fresh-controller recovery gaps.
- Delivered: A/B/M01/M02 are source-complete with focused host and current-tree WSL evidence.
- Missing: a provider-owned fresh-controller operation that turns discovered `Intent` and
  `ReferenceStored` entries into exact broker recover/ACK/abort outcomes without an external
  remembered UUID or an unconstrained caller callback.
- No source, test, task, run-state, Direction, Git, stash, commit, push, default, Section 9, or
  release mutation was performed by this reviewer.

## Finding dispositions

| Finding | Round-4 disposition | Canonical severity | Evidence boundary |
|---|---|---|---|
| `BRK-R2-B02-A` | **CLOSED** | Former Blocker eliminated | Source + host/WSL service tests prove one broker-owned operation key and no second authority on digest drift across restart. |
| `BRK-R2-B02-B` | **CLOSED** | Former Blocker eliminated | Source + host lease/service tests prove active-only capacity, terminal conversion, bounded reconciled pruning, >64 lifetime cycles, restart, and uninstall. |
| `BRK-R2-B02-M01` | **CLOSED within the trusted broker-management domain** | Former Major eliminated | `LeafCreating` is durable before `create_leaf`; startup reopens the deterministic candidate, pins the inode, proves empty, removes it, and aborts the exact durable guardian. Section 9 remains open. |
| `BRK-R2-B02-M02` | **CLOSED** | Former Major eliminated | Both binaries and the subprocess oracle use shared shipping transaction modules; current-tree actual WSL is 18/18 with only the selector ignored. |
| `BRK-R2-B02-M03` | **OPEN** | **Major** | Fresh-process discovery is bounded/authentic, but no closed recover/ACK/abort reconciliation is exposed or consumed; the test callback only records fields. |

## Completion audit

### BRK-R2-B02-A — CLOSED — broker-owned operation uniqueness

Evidence:

- `PreparationDeliveryBinding::delivery_key` hashes only broker install id, broker key id,
  authenticated caller uid, and `preparationOperationId`; prepare/launch digests and recovery
  capability no longer select another filename (`broker_protocol.rs:396-511`). The protocol
  contract explicitly proves digest/launch/capability drift addresses the same key
  (`linux_broker_protocol_contract.rs:137-174`).
- `prepare` acquires the stable delivery-key lock before `prepare_delivery_locked`; when a record
  exists, `require_exact_delivery` compares caller, operation id, prepare digest, launch digest,
  install/key identity, and constant-time capability hash, then separately compares the exact
  original absolute deadline (`broker_service.rs:386-438,727-749`). These checks precede
  `put_delivery`, recovery creation, guardian prepare, leaf creation, and lease creation
  (`broker_service.rs:445-639`).
- The durable delivery record is the unified broker-owned operation index and state record; no
  digest-keyed secondary record remains. `put_delivery` is serialized by an in-process mutex plus
  fd `flock` across daemon processes before capacity/create (`broker_lease.rs:924-958,1179-1220`).
- `broker_operation_index_rejects_prepare_digest_drift_before_second_authority_across_restart`
  proves the original and replacement services retain exactly 1 guardian prepare, 1 leaf create,
  1 delivery, 1 recovery, and 1 lease (`linux_broker_service_contract.rs:1122-1178`).

Claim boundary: the dynamic count mutation uses prepare-digest drift as the representative full
binding conflict. The other immutable fields share the same pre-construction comparison; the
absolute deadline has its own adjacent pre-construction equality guard. Section 9 authentication
and privileged installation are not inferred from this fixture.

### BRK-R2-B02-B — CLOSED — active ownership capacity and terminal reclamation

Evidence:

- The store admits at most 64 delivery records under one global cross-process store lock. On
  capacity, it prunes only `Reconciled` candidates and refuses the new operation if no safe
  candidate exists (`broker_lease.rs:1179-1220`).
- Pruning excludes every active phase, every record with provisional recovery, and every record
  with a non-terminal lease. A `CleanupComplete + ExactEmpty + authentic terminal history` lease
  is the only lease state that no longer pins the reconciled operation tombstone
  (`broker_lease.rs:1295-1364`).
- Exact terminal cleanup converts the matching `Delivered` record to `Reconciled` under the
  delivery-store transaction only after the authenticated lease is `CleanupComplete`, exact empty,
  and carries terminal history (`broker_lease.rs:1387-1425`; `broker_service.rs:1149-1172`). The
  unified delivery record is also the operation index, so this one transition reclaims both
  ownership roles rather than coordinating two independently crashable files.
- The active-capacity race admits exactly one of two concurrent writers at slot 64 and never
  prunes an active record. The lifetime test runs 80 terminal plus 80 failed records across store
  restart, retains at most 64, preserves the latest tombstone conflict, and completes authenticated
  uninstall with 80 terminal leases removed (`linux_broker_lease_contract.rs:337-471`).
- `authenticated_terminal_cleanup_converts_delivered_ownership_to_a_prunable_tombstone` exercises
  the authentic service transition and idempotent terminal replay (`linux_broker_service_contract.rs:718-784`).

Claim boundary: host fixtures prove store transaction semantics, not real `cgroup.kill` or
populated-to-empty convergence. Those remain Section 9.

### BRK-R2-B02-M01 — CLOSED within trusted management domain — create-leaf crash boundary

Evidence:

- Prepare durably changes `GuardianPrepared -> LeafCreating` before calling `create_leaf`, then
  changes to inode-bearing `LeafPrepared` only after creation returns
  (`broker_service.rs:531-575`; `broker_lease.rs:1910-1933`).
- A `LeafCreating` recovery carries the exact scope id, guardian birth identity, and closed client
  reference. On startup the broker derives the only server-owned leaf name from the scope id,
  opens/pins its current device/inode, verifies `populated=0`, removes that pinned directory, then
  aborts the exact durable guardian and removes recovery (`broker_service.rs:1175-1213`;
  `broker_cgroup.rs:192-205,651-676,700-734`; `broker_guardian.rs:384-435`).
- `restart_reconciles_the_exact_empty_leaf_created_before_leaf_identity_commit` seeds the precise
  crash state and proves one existing leaf is cleaned, no second leaf is created, the guardian is
  aborted once, recovery/lease stores are empty, and delivery becomes `Reconciled`
  (`linux_broker_service_contract.rs:1037-1120`). Replacement/inode drift remains separately
  fail-closed in the cgroup contract.

Claim boundary: pre-create identity is the durable server-derived scope/name transaction; the
inode is pinned on recovery before removal. This relies on the installed broker singleton's trusted
management domain. It does not claim protection against arbitrary external root mutation or close
the privileged Section 9 oracle.

### BRK-R2-B02-M02 — CLOSED — shipping transaction process loss

Evidence:

- `BrokerDaemonTransactions` owns `accept_authenticated_request`, attempt replay, prepared commit
  before completed request response, response mapping/framing, and the response-loss observer seam
  (`broker_daemon_transaction.rs:43-159`). The installed daemon delegates every connection to
  `transactions.handle_one` (`rasen-linux-process-authority-broker.rs:57-82,300-323`).
- `BrokerClientEndpoint` owns fresh random attempt ids, pinned challenge authentication, retry,
  response identity/frame validation, and the prepared-reference parser
  (`broker_client_transaction.rs:35-184`). The installed client uses the same closed command parser
  and endpoint (`rasen-linux-process-authority-broker-client.rs:18-56,357-397`).
- The subprocess oracle uses those same modules, kills the first client after durable prepare
  commit, restarts the daemon, recovers with a new attempt id, loses the ACK response, restarts
  again, repeats ACK with another new attempt id, and proves exactly one lease, one `Delivered`
  operation, and no provisional recovery (`linux_broker_service_contract.rs:1435-1822`). It does
  not call `service.handle` directly.
- The final current-tree static-musl ELF was executed on WSL after current-tree rustfmt and passed
  18/18; only the test-only subprocess selector was ignored. This supersedes the non-byte-identical
  prior 18/18 receipt for M02.

Claim boundary: this WSL test runs real daemon/client test processes and the shipping transaction
modules with fixture guardian/cgroup implementations. It is not the installed root broker binary,
not a writable unified cgroup-v2 run, and not Section 9.

### BRK-R2-B02-M03 — OPEN — Major — discovery is not reconciliation

Evidence:

- The remediation design requires a closed bundle capability with `recover(...)` and
  `reconcileOrphans(context)`, where an `Intent` invokes `RecoverPreparation` and a replacement
  validates/stores/ACKs the exact reference. If there is no durable operation owner, bundle orphan
  reconciliation must exactly abort every undelivered entry before accepting a logically new
  operation (`broker-delivery-recovery-remediation-plan.md:129-168,193-206`).
- The implemented `LinuxBrokerPreparationDeliveryRecovery` exposes only
  `discoverPendingOrphans` and `reconcileOrphans(context, reconcileCallback)`
  (`preparation-delivery-ledger.ts:76-79,347-400,575-588`). The ledger invokes whatever callback
  the caller supplied and advances no `Intent`, `ReferenceStored`, `Acknowledged`, or `Reconciled`
  state itself.
- The bundle captures `transport.recoverPreparedDelivery` only inside `provider.prepare` when the
  caller already supplies the same operation id and full launch input. The separately exposed
  `preparationDeliveryRecovery` object is constructed from the ledger alone and has no captured
  transport, reference decoder, ACK, or abort route (`provider.ts:450-458,476-515,600`).
- No source/test consumer outside these definitions uses `preparationDeliveryRecovery`. A fresh
  default coordinator still chooses a new UUID, and no pre-new-operation orphan gate exists.
- The fresh-process test receives only the ledger root, but its callback merely pushes orphan
  fields into an array and writes JSON. It never invokes provider/native assembly, broker recovery,
  exact reference validation, `storeReference`, ACK, or exact abort
  (`linux-process-authority-preparation-delivery.test.ts:250-286,541-579`). Therefore its passing
  name overstates what it proves.

Impact: after controller loss, a fresh production owner may discover an old broker operation but
cannot resolve it through the exposed capability. It can still start a logically new operation
under a new UUID while the old `PreparedPendingAck` authority remains active/unowned. The broker
correctly prevents duplicates for the *same* operation id; it cannot prevent the controller from
forgetting that identity. This is a plausible leaked-authority/control-loss path and remains Major.

Required fix: make the branded bundle recovery capability own the captured ledger + transport +
exact reference decoder. It must recover/validate/store/ACK `Intent`, idempotently ACK
`ReferenceStored`, and provide an exact broker abort/reconciled disposition for an unrecoverable
orphan. `reconcileOrphans(context)` must not delegate authority semantics to an unconstrained
callback. Add a fresh-process oracle that passes only the trusted production state root and proves
the broker delivery/ledger phases actually converge; do not manually pass the old UUID. This can
remain unselected and does not require switching ProcessScope/SessionHost defaults.

## Coverage map

```text
BROKER PREPARED-DELIVERY PATH
=============================
[+] Stable operation ownership
    +-- [TESTED] same operation + changed prepare digest -> one authority across restart
    +-- [SOURCE] complete binding + original deadline rejected before construction
[+] Capacity and retirement
    +-- [TESTED] slot-64 concurrent active capacity
    +-- [TESTED] 80 terminal + 80 failed cycles, restart, conflict, uninstall
    +-- [TESTED] authentic Delivered -> terminal -> Reconciled transition
[+] Leaf construction crash
    +-- [TESTED] LeafCreating + existing empty leaf -> exact cleanup + guardian abort
[+] Shipping process loss
    +-- [TESTED/WSL] shared daemon/client transaction modules, fresh attempts, response/ACK loss
[!] Controller replacement
    +-- [TESTED] bounded trust-root enumeration without remembered UUID
    +-- [GAP/MAJOR] no provider-owned recover/ACK/abort reconciliation behind that capability

OUT-OF-SCOPE GATES
==================
BRK-R2-B06 absolute deadline supervisor: OPEN / not reranked
BRK-R2-B01 readiness residual: OPEN / not reranked
WSL M00-M06 and Section 9: OPEN / not reranked
Installed root broker + real writable cgroup-v2: NOT RUN
Package/default/release/Linux terminal support: NOT CLAIMED
```

## Verification receipts

### Current source identities

All Round-4 fixer-declared hashes match the reviewed current tree:

```text
broker_cgroup.rs                                      750201e78f7df59cbda10ddf5f0cf707cd1cdee8b299b6fbfac380126a6bb706
broker_lease.rs                                       fc00ee24a6a71805a0a167f7a525e534156e76f2446ef14e637fb308b279078f
broker_service.rs                                     d31d5231d5e06983236143d05bf16c67559076700623f711120b32d23d575aae
broker_protocol.rs                                    6b1e4fb804128549e23f8e6c2c2c88dc70d3fe54300fa674d445927610d9ac8a
broker_transport.rs                                   51e5f2e899bf796503290cedf27b3b02d1fd4c112b41e5584cc64117379a09c5
broker_daemon_transaction.rs                          df357a8ba88127cdc02cfbc1dc4f34e7ee8b38645d6c39c2f92ee02496c74002
broker_client_transaction.rs                          ee6530bba2f4441d53805fff108252320529495c31e79a8fb429c211d47055ef
bin/rasen-linux-process-authority-broker.rs           fa0559c0564b620167ddea6814d21448bda8062d2a8269e20bc4b86ce40ed741
bin/rasen-linux-process-authority-broker-client.rs    086c6a9305294cf23d859856bf89319663140a563879e9ed603644dd56e431a6
linux_broker_lease_contract.rs                        6ed8c27736bb3b037f8b03c93247409b8b5ce7b67cfde59b7e71e1fda37fa30a
linux_broker_cgroup_contract.rs                       66c4caa436d429893e664350f053375acae332b54f233e0dfb1bb6419b872e31
linux_broker_service_contract.rs                      9837af2c5aa1506b34322934f523c54232954cd295c4a90ebc049cc4825cd878
linux_broker_admin_contract.rs                        f35427a9fba9452755fd6c9e2ee380f13de22b2daa99e9d2a64996519dde665a
preparation-delivery-ledger.ts                        56b3b6c15f01992ce2d36e9100de0f40e85db51e8d01fcc3fa90e4ffe216fb51
provider.ts                                           258d844126fb6c1b424017b07110e1246a5fa670bb93365efc389c4ecae5678f
linux-process-authority-preparation-delivery.test.ts  db49ce92c569be46e08c2cc7be9831db1fbae89e28f5c1bc596ffa013cfc80b9
```

Additional reviewed identities:

```text
broker_guardian.rs                                    1a6ba0d847612c058b99c857c3c2d2518b5ae8d875765354f935eddc12c3ce33
linux_broker_protocol_contract.rs                     bf69a9329ea53bf18dbb4e8389ff2bc656c1ddacf8b03d8609b6472558166ca2
native-assembly.ts                                    5a94f5b38509bad712b555468be60b2d3f32e36ba1a80ea7e3e8bc3b9fa11918
linux-process-authority-provider.test.ts               2b677a43fa3428fd56f4c595356e911a3762aa62a34bab26a40f041ba8ee35e0
```

### Commands and outcomes

1. `rustup run stable cargo fmt --manifest-path native/linux-process-authority/Cargo.toml --all -- --check`
   — **PASS** on the reviewed tree.
2. `rustup run 1.88.0 cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml`
   with `CARGO_TARGET_DIR=<worktree>/.cargo-target-broker-r4`, `CARGO_INCREMENTAL=0`, and
   `TEMP=TMP=E:\\tmp\\rpa-broker-delivery-r4-review-host` — **PASS: 69 passed, 0 failed,
   0 ignored**.
3. `pnpm exec vitest run test/core/session-host/linux-process-authority-preparation-delivery.test.ts test/core/session-host/linux-process-authority-provider.test.ts`
   with Node temp on E — **PASS: 2 files, 27 tests** (12 delivery, 15 provider).
4. `rustup run 1.88.0 cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml --target x86_64-unknown-linux-musl --test linux_broker_service_contract --no-run`
   with target/temp on E, `CARGO_INCREMENTAL=0`, and `RUSTFLAGS=-C linker=rust-lld` — **PASS**.
5. Final static-musl service ELF:

   ```text
   bytes   16061616
   sha256  04c8fd51fef954efc538595175282822f05a0eaa6fca557664f51a359cace3e5
   ```

   Executed on WSL2 kernel
   `5.15.167.4-microsoft-standard-WSL2` with `--test-threads=1` — **PASS: 18 passed,
   0 failed, 1 ignored**. The ignored entry is only `broker_delivery_process_fixture`; its named
   parent test spawned it and passed.

   The successful harness used unprivileged user/mount namespaces. It mounted a mode-0700 tmpfs at
   the short E path `/mnt/e/r4`, then nested-mapped the test process to uid/gid 1000 so the exact
   store owner/mode and peer-credential contracts remained authentic. It did not use host root,
   install a broker, or access real cgroup v2.

   Two earlier harness attempts are not counted: the first used a long E temp path and hit Unix
   socket `SUN_LEN`; the second ran the same fixture as user-namespace uid 0 and correctly failed
   the fixture's uid-1000 assertion. Neither changed source or demonstrated a product failure.

## Durable findings

1. Keep the unified broker delivery record as the stable operation index; never restore a
   prepare-digest-keyed or attempt-request-id-keyed authority path.
2. Preserve active-only capacity, `Delivered` pinning, exact terminal conversion, and conservative
   `Reconciled` pruning. Section 9 must still prove the real cgroup facts.
3. Preserve `LeafCreating` before kernel creation and the shared daemon/client transaction modules;
   both former Majors are closed only within their stated fixture/trusted-domain boundaries.
4. Do not close `BRK-R2-B02` until the fresh-owner capability performs broker recover/ACK/abort
   reconciliation rather than delegating semantics to a callback. Discovery alone does not own an
   orphan authority.
5. Keep `BRK-R2-B06`, residual `BRK-R2-B01`, ready/deadline seams, WSL M00-M06, Section 9,
   package/default/release, macOS, and terminal-support gates open and independently reviewed.
