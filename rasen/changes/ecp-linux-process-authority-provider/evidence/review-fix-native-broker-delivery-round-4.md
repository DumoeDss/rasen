# Native broker prepared-delivery recovery fix — round 4

Date: 2026-08-06\
Role: design-level review-loop fixer for `BRK-R2-B02-A`, `BRK-R2-B02-B`,
`BRK-R2-B02-M01`, `BRK-R2-B02-M02`, and `BRK-R2-B02-M03`\
Status: implementation complete and focused gates green; this fixer does not close the findings

## Design addendum

1. **Operation identity is broker-owned and prepare-digest independent.** The durable store owns a
   secondary operation record keyed by a domain-separated hash of caller uid, broker install id,
   broker key id, and `preparationOperationId`. Creation and comparison run under the global
   delivery-store transaction lock before a delivery record or authority exists. The operation
   record binds the complete delivery key, prepare/launch digest, recovery-capability hash, and
   original absolute deadline. Exact replay reuses it; any differing field is identity drift and
   cannot create a second guardian, leaf, recovery, delivery, or lease.
2. **The capacity bound covers only active ownership.** Active delivery phases and a `Delivered`
   record whose lease is non-terminal are never pruned. Authenticated exact terminal lease cleanup
   removes its matching `Delivered` record and operation record under delivery-before-token lock
   order. Only `Reconciled` records whose recovery/lease/leaf/guardian absence has been positively
   established may become bounded operation tombstones and may later be pruned as a pair. More
   than 64 successful or failed lifecycles must remain available across restart and uninstall.
3. **Leaf construction is journaled before creation.** A deterministic, broker-derived leaf name is
   persisted as a `LeafCreating` recovery transition before `create_leaf`. Restart can derive the
   one candidate path without trusting a caller path, pin its identity, and remove only that exact
   empty leaf after guardian reconciliation. `LeafPrepared` then commits the inode-bearing
   identity; no create-to-record ownership gap remains.
4. **Process-loss tests share shipping transaction modules.** Authentication, request replay,
   dispatch/commit ordering, response mapping, client parsing, challenge verification, and fresh
   attempt-id generation move behind production library seams called unchanged by both binaries
   and the subprocess oracle. A direct `service.handle` plus request-file shortcut is retained only
   as a lower-level service fixture and cannot be the shipping acceptance oracle.
5. **Controller ownership is durably discoverable without switching defaults.** The Linux delivery
   ledger exposes bounded, trust-root-validated enumeration and orphan reconciliation input, so a
   replacement owner can discover `Intent`/`ReferenceStored` work without remembering an ephemeral
   UUID. This Change does not wire ProcessScope or SessionHost defaults; closure must supply the
   production owner and consume this explicit interface.

## Claim boundary

Focused source/tests and actual unprivileged WSL execution may close these implementation seams.
They do not substitute for Section 9: root installation, writable unified cgroup v2, real
`cgroup.kill`, populated-leaf convergence, or privileged broker restart remain open until an
authorized runner supplies those facts.

## Finding implementation result

| Finding | Implemented result | Evidence boundary |
| --- | --- | --- |
| `BRK-R2-B02-A` | A broker-owned operation index binds caller uid, broker install/key identities, `preparationOperationId`, launch/prepare digest, recovery capability hash, and the original absolute deadline. Exact replay reuses one authority; drift fails before a second authority can be created. | Host lease/service tests cover replay, restart, digest drift, and concurrent creation. |
| `BRK-R2-B02-B` | Active ownership is never evicted. Exact terminal cleanup converts the matching delivery/operation pair into a bounded reconciled tombstone, allowing more than 64 completed or failed lifecycles without exhausting the 64-active-operation bound. | Host lease tests cover 64-plus terminal/failed lifecycles across restart. |
| `BRK-R2-B02-M01` | Recovery persists deterministic `LeafCreating` ownership before `create_leaf`; restart derives and pins the single broker-owned candidate and removes only that proven exact empty leaf. | Host cgroup/service tests cover restart between create and inode commit plus replacement drift. |
| `BRK-R2-B02-M02` | Shipping authentication, replay, dispatch/commit ordering, response framing/parsing, and fresh attempt ids live in `broker_daemon_transaction.rs` and `broker_client_transaction.rs`. Both installed binaries call those modules unchanged, and the subprocess oracle uses the same seams. | Host service/admin contracts and the prior actual-WSL transaction receipt cover the shared route. |
| `BRK-R2-B02-M03` | The controller ledger exposes branded, bounded, root-identity-validated orphan discovery and sequential reconciliation. A fresh controller process needs only the durable ledger root, not a remembered operation UUID. | TypeScript fresh-process, drift, capacity, and cancellation mutations pass. Production owner/default wiring remains an integration responsibility. |

## M03 controller recovery surface

`LinuxBrokerPreparationDeliveryLedger.discoverPendingOrphans()` streams directory enumeration and
accepts at most 64 pending operations. Before returning an orphan it validates the pinned root,
regular-file identity, owner/mode, file size, closed filename grammar, immutable phase chain, and
filename hash against the operation id embedded in the record. Valid uncommitted temporary files
are recognized but never promoted. Only `Intent` and `ReferenceStored` are returned;
`Acknowledged` is terminal for controller discovery.

`reconcileOrphans(context, reconcile)` is a sequential bounded callback seam. It rejects invalid
contexts/callbacks and checks abort/deadline before and after discovery and around every callback.
`createLinuxBrokerPreparationDeliveryRecovery(ledger)` exposes the narrow branded
`LinuxBrokerPreparationDeliveryRecovery` capability and rejects forged/unbranded ledgers. A Linux
provider bundle exposes optional `preparationDeliveryRecovery` only when durable broker delivery
is active.

The fresh-process oracle passes only the ledger root to a new Node process. That process discovers
one `Intent` and one `ReferenceStored` operation without receiving either UUID, omits an
`Acknowledged` operation, rejects filename/record identity drift, rejects a forged capability,
fails closed at 65 pending entries before calling the reconciler, and invokes no callback when the
context is cancelled.

## Verification receipts

### Windows host Rust

All Rust target and temporary output stayed on `E:` and incremental compilation was disabled:

```text
CARGO_TARGET_DIR=<worktree>/.cargo-target-broker-r4
CARGO_INCREMENTAL=0
TEMP=TMP=E:\tmp\rpa-broker-delivery-r4-host-temp
rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml

69 passed, 0 failed, 0 ignored
```

The full run includes 12 lease-store tests and 17 broker-service tests. It covers operation drift,
64-plus reclamation, `LeafCreating` restart, response loss, daemon restart, ACK replay, concurrent
terminal races, and the shared daemon/client transaction path.

M02 moved authenticated lifecycle handling out of the daemon/client binaries. The full run found
an old source-layout assertion in `linux_broker_admin_contract.rs`; the contract now verifies that
the binaries assemble the shared transaction engines, that the shared daemon module owns
authentication/open-runtime/dispatch/reference encoding, and that every closed client command is
both parsed by the shared client module and dispatched by the binary. After whole-crate formatting:

```text
rustup run stable cargo fmt \
  --manifest-path native/linux-process-authority/Cargo.toml --all -- --check
PASS

rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --test linux_broker_admin_contract
7 passed, 0 failed, 0 ignored
```

### TypeScript controller/provider

```text
pnpm exec vitest run \
  test/core/session-host/linux-process-authority-preparation-delivery.test.ts \
  test/core/session-host/linux-process-authority-provider.test.ts

2 files, 27 passed, 0 failed
  preparation-delivery: 12/12
  provider:             15/15

pnpm exec tsc --noEmit --pretty false
PASS

pnpm exec eslint \
  src/core/session-host/process-authority/linux/preparation-delivery-ledger.ts \
  src/core/session-host/process-authority/linux/provider.ts \
  test/core/session-host/linux-process-authority-preparation-delivery.test.ts
PASS
```

### Prior actual-WSL receipt

The earlier Round-4 transaction pass executed the focused shared shipping transaction suite as
real Linux processes on WSL and recorded **18/18 passed**. This final leaf did not rerun WSL. The
only later native changes were whole-crate rustfmt output and the host static-source contract update;
there was no later production semantic edit. The receipt is therefore retained as prior
actual-kernel evidence, not relabeled as a byte-identical final-tree or privileged Section 9 run.

## Encoding, cache, and scoped-state audit

Strict UTF-8 decoding and explicit no-BOM checks passed for all 16 Round-4 production/test files
listed below. No replacement characters or checked mojibake signatures were present.

The host Rust run reused the rebuildable untracked cache at
`<worktree>/.cargo-target-broker-r4`; `CARGO_INCREMENTAL=0` was set for every recorded test command.
The cache was not treated as evidence and was not deleted in this shared worktree. No source,
test, Change, Direction, run-state, Git/stash, commit, or PR operation was performed as cache
cleanup.

The scoped Git audit shows the Round-4 native, TypeScript, and test files remain untracked inside
the dedicated shared worktree, consistent with the surrounding resumed implementation. No file
from the clean primary `dev/0.2.0` worktree was touched.

## Final implementation hashes

```text
broker_cgroup.rs                                       750201e78f7df59cbda10ddf5f0cf707cd1cdee8b299b6fbfac380126a6bb706
broker_lease.rs                                        fc00ee24a6a71805a0a167f7a525e534156e76f2446ef14e637fb308b279078f
broker_service.rs                                      d31d5231d5e06983236143d05bf16c67559076700623f711120b32d23d575aae
broker_protocol.rs                                     6b1e4fb804128549e23f8e6c2c2c88dc70d3fe54300fa674d445927610d9ac8a
broker_transport.rs                                    51e5f2e899bf796503290cedf27b3b02d1fd4c112b41e5584cc64117379a09c5
broker_daemon_transaction.rs                           df357a8ba88127cdc02cfbc1dc4f34e7ee8b38645d6c39c2f92ee02496c74002
broker_client_transaction.rs                           ee6530bba2f4441d53805fff108252320529495c31e79a8fb429c211d47055ef
bin/rasen-linux-process-authority-broker.rs            fa0559c0564b620167ddea6814d21448bda8062d2a8269e20bc4b86ce40ed741
bin/rasen-linux-process-authority-broker-client.rs     086c6a9305294cf23d859856bf89319663140a563879e9ed603644dd56e431a6
linux_broker_lease_contract.rs                         6ed8c27736bb3b037f8b03c93247409b8b5ce7b67cfde59b7e71e1fda37fa30a
linux_broker_cgroup_contract.rs                        66c4caa436d429893e664350f053375acae332b54f233e0dfb1bb6419b872e31
linux_broker_service_contract.rs                       9837af2c5aa1506b34322934f523c54232954cd295c4a90ebc049cc4825cd878
linux_broker_admin_contract.rs                         f35427a9fba9452755fd6c9e2ee380f13de22b2daa99e9d2a64996519dde665a
preparation-delivery-ledger.ts                         56b3b6c15f01992ce2d36e9100de0f40e85db51e8d01fcc3fa90e4ffe216fb51
provider.ts                                            258d844126fb6c1b424017b07110e1246a5fa670bb93365efc389c4ecae5678f
linux-process-authority-preparation-delivery.test.ts   db49ce92c569be46e08c2cc7be9831db1fbae89e28f5c1bc596ffa013cfc80b9
```

## Still open and not claimed

- A production ProcessScope/SessionHost owner must consume `preparationDeliveryRecovery`; this
  focused Change intentionally does not switch provider/default selection.
- Section 9 still requires an authorized root-installed broker on a writable unified cgroup-v2
  hierarchy, real populated-leaf convergence, real `cgroup.kill`, privileged daemon restart, and
  independent security review.
- Package/release closure, production-default selection, terminal Linux support, macOS provider
  completion, and the deferred MMAC decision are outside this finding fix.
- A fresh non-author reviewer must decide whether `BRK-R2-B02-A/B` and `M01/M02/M03` can be closed.

## Durable findings for re-review

1. Durable operation identity must be broker-owned and checked before authority creation; an
   attempt-local request id or caller-owned remembered UUID cannot be the recovery index.
2. Capacity is an active-ownership bound, not a lifetime-history bound. Exact terminal proof must
   reclaim delivery and operation ownership together without evicting ambiguous work.
3. Recovery must journal the deterministic leaf candidate before kernel creation, and shipping
   process-loss tests must share the exact production transaction modules.
4. Controller recovery is only complete when a fresh owner can discover bounded pending work from
   the trust root alone; exposing the seam does not by itself supply the production owner.
