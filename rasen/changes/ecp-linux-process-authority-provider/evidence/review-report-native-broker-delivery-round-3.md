# Native broker prepared-delivery recovery review — round 3

Date: 2026-08-06\
Role: fresh non-author reviewer, dispatched report-only\
Change: `ecp-linux-process-authority-provider`\
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`\
Review snapshot HEAD: `140115ced9df814f6adf3190b47171202d964a5e`

## Verdict

**FAIL — `BRK-R2-B02` remains OPEN: 2 Blocker, 3 Major.**

The delta correctly makes `preparationOperationId` the controller-visible delivery identity,
keeps random `request_id` attempt-local, adds an independent recovery capability, preserves
`PreparedPendingAck` until exact ACK, reconstructs the BCR1 response after the lease-commit crash
window, and retires provisional recovery on delivered replay. It does not yet enforce global
operation-id uniqueness in the broker, and it never removes or prunes terminal/reconciled delivery
records from the hard 64-record capacity. Those two defects make the broker capable of creating
multiple authorities for one semantic operation and permanently unavailable after 64 lifetime
attempts.

This review is limited to `BRK-R2-B02` and the delivery/recovery delta. It does **not** close or
rerank `BRK-R2-B06`, residual `BRK-R2-B01`, the ready-hook/deadline seams, Section 9, root install,
writable unified cgroup-v2, package/install, production-default, release, or Linux terminal-support
gates.

Scope Check: **REQUIREMENTS MISSING**

- Intent: make a prepared broker reference durably recoverable from the stable preparation
  operation through client/controller/daemon loss, and retire recovery only after exact durable
  controller ACK.
- Delivered: controller phase ledger, stable broker delivery records, recovery/ACK protocol,
  byte-identical response reconstruction, and process-isolated service/store mutations.
- Missing: broker-enforced one-operation/one-binding uniqueness, terminal delivery retirement and
  safe reconciled pruning, one exact cgroup construction crash seam, a durable production operation
  owner, and a process oracle that executes the shipping daemon/client transaction layers.
- No out-of-scope production-default, Section 9, macOS, release, task, run-state, Direction, Git, or
  stash mutation was found in this focused delta.

## Findings

### BRK-R2-B02-A — Blocker — one semantic preparation operation can create multiple broker authorities

Evidence:

- `PreparationDeliveryBinding::delivery_key` hashes caller/install/key, operation id, **and prepare
  digest** (`broker_protocol.rs:473-497`). Changing the prepare payload therefore selects a new
  filename/key instead of finding the old operation record.
- `prepare_delivery_locked` checks `require_exact_delivery` only after lookup by that derived key;
  when the different key is absent it writes a new `Intent` and starts construction
  (`broker_service.rs:409-481`).
- `put_delivery_unlocked` rejects only an existing identical delivery key and has no secondary
  `(caller uid, install id, key id, preparationOperationId)` uniqueness index
  (`broker_lease.rs:1181-1213`).
- The controller ledger rejects a conflicting digest within one trusted root
  (`preparation-delivery-ledger.ts:294-334`), but the root broker is the final trust boundary and
  must also reject a second controller root, a direct authenticated client, or controller-state
  loss. Current native tests vary the recovery capability on the same key but do not attempt the
  same operation id with a different prepare digest.

Impact: the stable semantic identity is not actually single-valued at the authority owner. A
same-uid authenticated caller can bind one `preparationOperationId` to two delivery records, two
guardians, and two leases. Replacement can then no longer treat the operation id as an exact
identity, and one authority may become unreachable.

Required fix: reserve a broker-owned operation index under the delivery-store transaction lock,
keyed independently of `prepareDigest`; compare the complete binding and original deadline before
any construction. Exact replay returns the existing state, while any different prepare/launch/
capability/install/key/caller binding returns identity drift and creates no second record or lease.
Add a service/store restart test proving one operation id plus a different digest cannot increase
guardian, delivery, recovery, or lease counts.

### BRK-R2-B02-B — Blocker — Delivered and Reconciled records permanently exhaust the 64-delivery store

Evidence:

- `MAX_DELIVERY_RECORDS` is 64 and `put_delivery_unlocked` counts every delivery phase before
  refusing new work (`broker_lease.rs:27,1194-1199`).
- ACK moves a record to `Delivered` and clears only its response body; it does not remove the
  delivery (`broker_service.rs:684-700`). Failed/startup reconciliation similarly leaves a durable
  `Reconciled` record (`broker_service.rs:1042-1048,1080-1096,1159-1184`).
- There is no `remove_delivery` or delivery-pruning operation in `DurableLeaseStore`. Terminal
  lease cleanup changes only the lease to `CleanupComplete` and prunes lease tombstones
  (`broker_service.rs:1106-1123`).
- The capacity regression fills the store and proves only that one of two new writers is rejected;
  it does not terminally finish records and reclaim capacity
  (`linux_broker_lease_contract.rs:339-383`).
- Authenticated uninstall explicitly refuses any remaining delivery (`broker_lease.rs:1303-1313`),
  so even otherwise terminal scopes cannot make the installed state removable.

Impact: 64 successful sessions, 64 failed/reconciled attempts, or any mixture permanently makes the
broker return capacity failure before new authority construction. This is a deterministic lifetime
denial of service on a normal path, not bounded active-delivery retention. It also contradicts the
remediation rule that `Delivered` remains only while its lease is non-terminal and that reconciled
entries are safely prunable.

Required fix: remove the exact `Delivered` record as part of authenticated terminal lease cleanup
under a consistent delivery-before-token transaction, and add bounded pruning for only proven
`Reconciled` records. Never prune active `Intent`, `Preparing`, `PreparedPendingAck`, or non-terminal
`Delivered`. Add tests cycling more than 64 complete and failed preparations across daemon restart,
then prove capacity, uninstall, and operation-id tombstone semantics remain exact.

### BRK-R2-B02-M01 — Major — a crash after cgroup creation but before LeafPrepared persistence leaves an unowned leaf

Evidence:

- Prepare creates the cgroup leaf first, then constructs and persists the `LeafPrepared` recovery
  record (`broker_service.rs:526-543`). A process death between those calls leaves the durable
  recovery at `GuardianPrepared`, which carries no cgroup device/inode.
- Startup reconciliation cleans a cgroup only when the recovery record contains `cgroup: Some(...)`;
  otherwise it aborts the guardian and removes the recovery (`broker_service.rs:1126-1156`). The
  empty but root-owned leaf created in the gap is no longer nameable by an exact inode-bearing
  record.
- `ambiguous_prepare_cleanup_retains_recovery_until_a_fresh_broker_proves_empty` injects failure
  after the leaf identity is already persisted; it does not kill between `create_leaf` and
  `replace_recovery` (`linux_broker_service_contract.rs:745-789`).

Impact: delivery can converge to `Reconciled` while an unmanaged service-subtree leaf remains.
Repeated crashes leak administrative state and can block subtree removal/uninstall. No workload is
shown to escape in this exact window, so this is Major rather than Blocker.

Required fix: give cgroup construction its own pre-create/recoverable transaction or make the exact
leaf identity durable in the same construction operation before control returns. Add a daemon-death
injection at this precise boundary and prove restart removes only the exact empty leaf and guardian.

### BRK-R2-B02-M02 — Major — the fresh process-loss oracle bypasses both shipping transaction entrypoints

Evidence:

- The new test does use separate OS processes plus production `BrokerFrame`, `BrokerRequest`,
  `BrokerResponse`, `BrokerServiceCore`, delivery codec, and `DurableLeaseStore`.
- Its daemon is nevertheless `run_process_fixture_daemon`, which decodes one frame and calls
  `service.handle` directly; it does not execute the shipping daemon's
  `accept_authenticated_request`, request-record replay transaction, response mapping, or
  `handle_one` ordering (`linux_broker_service_contract.rs:1203-1317` versus
  `rasen-linux-process-authority-broker.rs:324-423`).
- Its client reads an already encoded request from a test file and connects directly; it does not
  execute the shipping client's CLI parser, fresh request-id generation, broker challenge, retry,
  or response validation (`linux_broker_service_contract.rs:1319-1345` versus
  `rasen-linux-process-authority-broker-client.rs:38-56,361-468`).
- Consequently the parent oracle proves process isolation and service/store recovery, but not that
  the actual daemon/client transaction code preserves those semantics under the same kills.

Impact: a regression in the shipping operation tags, authentication handoff, request replay
record, `commit_prepared_delivery` ordering, client retry, or response mapping can leave this oracle
green. That is the acceptance boundary the remediation plan explicitly required after the earlier
in-memory fixture proved insufficient.

Required fix: extract the shipping daemon transaction and client call path into production modules
used unchanged by both binaries and the subprocess oracle, or run the real binaries against an
isolated test install layout. The focused oracle need not claim Section 9 cgroup truth, but it must
execute the same production transaction/authentication/parser code it claims to protect.

### BRK-R2-B02-M03 — Major acceptance residual — production controller replacement still has no durable operation owner

Evidence:

- Provider recovery is reachable only when replacement calls `prepare` with the same
  `context.operationId`; the ledger API requires that id for every read and exposes neither bounded
  enumeration nor `reconcileOrphans` (`provider.ts:457-509`;
  `preparation-delivery-ledger.ts:191-251,294-405`).
- The current coordinator still defaults operation ids to `randomUUID` and keeps reservations in
  an in-memory `Map` (`coordinator.ts:728-783,835-881`). No production SessionHost owner in the
  reviewed tree supplies a restart-stable preparation operation id to this bundle.
- The TypeScript replacement test manually reuses the same context object/operation id
  (`linux-process-authority-preparation-delivery.test.ts:313-353`). It proves the provider module
  can recover when the stable identity is already known; it does not prove a production replacement
  can discover or reproduce it.

Impact: the controller ledger is durable but undiscoverable after a real owner process restart
unless a future integration persists the operation id externally. A fresh default coordinator
selects a new UUID and leaves the old `Intent`/pending authority untouched.

Required disposition: keep this as an explicit acceptance/integration precondition. Wire the
existing operation-id seam to a durable SessionHost operation journal, or implement the designed
bounded orphan reconciliation before production selection. Because this Change deliberately does
not switch the production ProcessScope/SessionHost default, this finding does not authorize that
integration here; it prevents an end-to-end B02 closure claim.

## Closed subclaims in the reviewed delta

| Subclaim | Status | Evidence |
|---|---|---|
| Random `request_id` is attempt correlation only | **CLOSED in source** | Client generates a fresh id per process/call (`broker-client.rs:391-413`); recover lookup derives the stable delivery key from the operation binding (`broker_service.rs:624-650`). |
| Separate recovery capability | **CLOSED in source + focused tests** | Controller generates 256 bits and stores it only in the trusted ledger (`preparation-delivery-ledger.ts:311-329`); broker stores a domain-separated hash and constant-time compares it (`broker_protocol.rs:500-505`; `broker_service.rs:705-726`). |
| `PreparedPendingAck -> ReferenceStored -> ACK` | **CLOSED in source + TypeScript tests** | Broker commits response before delivery (`broker_service.rs:233-282`); controller stores reference before ACK (`provider.ts:502-509`); 7/7 focused TypeScript tests passed. |
| Lease committed before pending delivery can rebuild the response | **CLOSED in source + fixture test** | Startup `prepared_from_delivery` joins exact recovery/lease and uses the shared codec (`broker_service.rs:761-807,1033-1062`); dedicated restart test covers it (`linux_broker_service_contract.rs:929-985`). |
| Delivered replay retires provisional recovery | **CLOSED for provisional recovery** | Duplicate ACK and startup call `retire_delivered_recovery` idempotently (`broker_service.rs:684-759,1049-1057`); delivery tombstone retirement is separately OPEN in B02-B. |
| One shared Rust BCR1 codec | **CLOSED** | `BrokerClientReferenceWire` owns the only Rust `BCR1` encode/decode implementation (`broker_protocol.rs:593-676`), and `BrokerPrepared::encode_client_reference` delegates to it (`broker_service.rs:150-174`). |
| Missing packaged broker artifact fails before Intent | **CLOSED in source + TypeScript test** | Production omits delivery seams/ledger use unless artifact resolution succeeds (`provider.ts:728-783`); missing-artifact test returns typed unavailable and finds an empty delivery root (`linux-process-authority-preparation-delivery.test.ts:255-275`). |
| Trust-root replacement fails closed | **CLOSED for the tested object-lifetime replacement** | Ledger pins root dev/inode/realpath and revalidates around reads/commits (`preparation-delivery-ledger.ts:139-222,254-291`); replacement mutation passes. This is not a Section 9 or hostile-root claim. |

## Coverage map

```text
PREPARED DELIVERY CODE PATH
===========================
[+] Controller Intent
    +-- [TESTED] create-only two-process winner, same capability
    +-- [GAP/MAJOR] no durable production owner/discovery of operation id
[+] Broker Prepare
    +-- [TESTED] stable binding + separate recovery capability
    +-- [GAP/BLOCKER] same operation + different prepare digest creates a second key/authority
    +-- [GAP/MAJOR] create-leaf -> persist-leaf crash leaves an unowned leaf
[+] Response commit/recovery
    +-- [TESTED] lease-before-pending reconstruction with shared BCR1 codec
    +-- [TESTED] new request id recovers byte-identical pending response
[+] Controller ownership transfer
    +-- [TESTED] ReferenceStored precedes ACK; duplicate ACK retires provisional recovery
    +-- [GAP/BLOCKER] Delivered/Reconciled never leave the 64-record capacity
[+] OS process loss
    +-- [PARTIAL] separate test processes use production protocol/service/store
    +-- [GAP/MAJOR] shipping daemon/client transaction/auth/parser paths are bypassed

OUT-OF-SCOPE GATES
==================
BRK-R2-B06 absolute deadline: OPEN / not reranked here
BRK-R2-B01 ready-hook residual: OPEN / not reranked here
Section 9 installed root broker + writable cgroup-v2: OPEN / not run
Package/default/release/Linux terminal support: NOT CLAIMED
```

## Verification receipts

### Frozen source identities

```text
broker_protocol.rs                                  92db7789dad7255479e6ea998083000a258dabfe7408b5f8d3c17db380809346
broker_lease.rs                                     83f9f7569cee890d2f41d2657c9cf2d954c60dba67cb7c5596f9cc0cd9284090
broker_service.rs                                   84258a2164c3d2a8368cfde785610ab592c7f7aa1e22f35f9a5ebee03b179bbe
rasen-linux-process-authority-broker.rs             799f15ccd76ee7f4375592dcdcc351d8aeee33c26b7c145bdc93b9c4f7806f9e
rasen-linux-process-authority-broker-client.rs      baff2b08b8376aa25510d9e1ae43ad5bcab458c9afac6cbb8f1eced6308ec8ee
preparation-delivery-ledger.ts                      a7b9ca48fa6877174edf16eae6c47ea4e71cc249dfcf41e24752aca4e2aef28a
provider.ts                                         a3d80f3a9fc743cbd219fd9a35d4b36b9d9e9d5ba999e7dbe2b23bc358d43cc4
native-assembly.ts                                  5a94f5b38509bad712b555468be60b2d3f32e36ba1a80ea7e3e8bc3b9fa11918
linux-process-authority-preparation-delivery.test.ts 72ddc5f164a884ab5fc5318becfcf7f86d9f0b83a840ec1b39eed7d80cf1909e
linux_broker_service_contract.rs                    30adc2b276e9b8ff518dbf7f8e96b6db67d6e0df0a50fad2528b20a9937519c4
```

These match the fixer's declared freeze.

### Commands and outcomes

1. `cargo +stable fmt --all -- --check` — **PASS**.
2. `pnpm exec vitest run test/core/session-host/linux-process-authority-preparation-delivery.test.ts`
   — **PASS: 1 file, 7 tests**. An earlier invocation encountered host `ENOSPC` before collection;
   after free space recovered, the unchanged command passed and is the counted result.
3. Current static-musl protocol ELF, executed on WSL with `--test-threads=1` — **PASS: 6/6**.
   ELF: 12,462,040 bytes,
   SHA-256 `1146d867348db1ffcb65652beb5dacb8f4cae7961deb342a3a8dd91238f923c5`.
4. Fresh Cargo compilation with `CARGO_TARGET_DIR`, `TEMP`, and `TMP` on E plus
   `CARGO_INCREMENTAL=0` — **ENVIRONMENT BLOCKED** before compilation: E had approximately 0.9 MB
   free and Cargo returned OS error 112. It was not retried unchanged or counted as a gate.
5. Current static-musl lease ELF with `TMPDIR` forced to E-backed `/mnt/e/...` — **ENVIRONMENT
   INVALID**, because DrvFS did not preserve the exact Linux owner/mode required by the store. The
   protocol test (which creates no store root) passed; lease/service filesystem results under that
   mount are not counted. No non-E temp fallback was used, and the service process oracle was not
   relabelled as freshly rerun evidence.

Current preserved ELF identities (authored-run artifacts, independently hashed here):

```text
protocol  12462040  1146d867348db1ffcb65652beb5dacb8f4cae7961deb342a3a8dd91238f923c5
lease     13292968  e87b5a1807cbdac8bebc65e1ab3d8143184902a25041b4ff1e6ae0afa36c90db
service   14689616  5837f4a122bcbb1fd1937d26e9b173c9ef06656890fe338566e7c40f456399d5
```

## Durable findings

1. Do not close `BRK-R2-B02` until the broker itself enforces one exact binding per
   `preparationOperationId`; the controller ledger alone is not the authority trust boundary.
2. Treat the 64 bound as **active** delivery capacity. Terminal `Delivered` and safely
   `Reconciled` records need authenticated lifecycle retirement; retaining them forever is a
   deterministic availability failure.
3. Preserve the good ordering already present: exact pending response commit, controller
   `ReferenceStored`, lease-capability ACK, then provisional recovery retirement.
4. A test-only daemon/client that shares protocol/service/store is valuable but does not close a
   production transaction claim while it bypasses both shipping entrypoints.
5. Production controller replacement remains an explicit integration precondition until a durable
   operation owner can rediscover the same preparation id. This does not authorize switching the
   production default in this Change.
6. Keep `BRK-R2-B06`, residual `BRK-R2-B01`, Section 9, install/package/default/release, and Linux
   terminal-support gates open and independently reviewed.
