# Native broker prepared-delivery recovery fix — round 3

Date: 2026-08-06\
Role: review-loop fixer for `BRK-R2-B02`\
Verdict: **IMPLEMENTED AND FOCUSED GATES GREEN; finding closure requires fresh non-author review**

## Scope and boundaries

This round closes the controller-visible prepared-delivery seam described by
`broker-delivery-recovery-remediation-plan.md`:

- the controller commits one durable `Intent` before any broker-client prepare process;
- the daemon indexes delivery by the exact preparation identity plus a separate 256-bit recovery
  capability, while random request ids remain attempt-local;
- a replacement client uses a new request id to recover the byte-identical committed reference;
- the controller commits `ReferenceStored` before ACK;
- ACK response loss is replayed idempotently, and provisional recovery is retired only after the
  broker has durably accepted the exact ACK;
- recovered authority remains inert and publication is still a separate publisher-owned phase.

No `tasks.md`, run-state, Direction, portfolio state, Git/stash, commit, production default, macOS
decision, or MMAC policy was changed by this fixer.

## Controller implementation

The controller integration is implemented in:

- `src/core/session-host/process-authority/linux/preparation-delivery-ledger.ts`
- `src/core/session-host/process-authority/linux/provider.ts`
- `src/core/session-host/process-authority/linux/native-assembly.ts`
- `test/core/session-host/linux-process-authority-preparation-delivery.test.ts`

`LinuxBrokerPreparationDeliveryLedger` now stores three immutable phase files (`Intent`,
`ReferenceStored`, and `Acknowledged`) instead of replacing one mutable record. Each phase is
written to a mode-0600 temporary file, fsynced, and installed by a same-directory hard link with
create-only semantics. Concurrent writers can observe the winner but cannot overwrite it. The
trusted root's real path, device, inode, owner, and mode are pinned and revalidated around reads and
commits. Phase gaps, changed binding, changed reference, root replacement, malformed provenance,
and integrity drift fail closed.

A real two-process Node mutation starts two replacement controllers against one empty root and one
operation. Exactly one reports `created: true`, the other reports `created: false`, and both recover
the same capability. The final directory contains exactly one immutable file per phase and no
mutable `.delivery` record or temporary debris.

Production broker construction with a missing packaged broker client previously threw before the
provider could report availability because the fallback transport was incorrectly forced through
the durable-delivery seams. Production assembly now enables those seams only after the exact broker
client artifact resolves. With the artifact absent, prepare returns typed `authority-unavailable`
and the delivery ledger remains empty; no client or workload starts and no unrecoverable intent is
left behind.

## Native process-loss oracle

`native/linux-process-authority/tests/linux_broker_service_contract.rs` adds a Linux-only process
oracle that uses separate daemon and client OS processes with the production `BrokerFrame`,
`BrokerRequest`, `BrokerResponse`, delivery codecs, durable store, and `BrokerServiceCore`:

1. kill the first client after prepared response commit and before response delivery;
2. kill/restart the daemon;
3. recover with a new request id and prove the response body is byte-identical;
4. kill the ACK client after ACK commit and before response delivery;
5. kill/restart the daemon and replay ACK with another request id;
6. prove exactly one lease and one delivery remain, delivery is `Delivered`, and provisional
   recovery is empty.

The daemon/client entrypoints are test-only subprocess selectors rather than the root-installed
shipping binaries. They are genuine separate OS processes and execute the production frame,
codec, service, and store implementation, but they bypass the installed daemon's socket
authentication/bootstrap and the shipping broker-client CLI parser. A fresh non-author reviewer
must decide whether this satisfies the remediation plan's “real broker-client and daemon framing”
wording. This fixer does not self-close that wording or the installed-broker Section 9 gate.

## Verification receipts

### TypeScript RED to GREEN

The missing-artifact regression was executed before the fix:

```text
linux-process-authority-preparation-delivery.test.ts
  5 tests: 4 passed, 1 failed
  failure: Linux broker transport lacks durable preparation delivery seams
```

Final focused file:

```text
pnpm exec vitest run \
  test/core/session-host/linux-process-authority-preparation-delivery.test.ts

  7 passed, 0 failed
```

Combined current-tree gate:

```text
pnpm exec vitest run \
  test/core/session-host/linux-process-authority-preparation-delivery.test.ts \
  test/core/session-host/linux-process-authority-provider.test.ts \
  test/core/session-host/linux-process-authority-publication-ledger.test.ts \
  test/core/session-host/linux-process-authority-artifact-resolver.test.ts

  4 files, 57 passed, 0 failed

pnpm exec tsc --noEmit
  PASS

pnpm exec eslint \
  src/core/session-host/process-authority/linux/preparation-delivery-ledger.ts \
  src/core/session-host/process-authority/linux/provider.ts \
  test/core/session-host/linux-process-authority-preparation-delivery.test.ts
  PASS
```

### Rust build, formatting, and actual WSL execution

The pinned Windows 1.88 minimal toolchain has no `cargo-fmt` component. No component was installed
or changed. The already provisioned isolated WSL Rust 1.88 toolchain ran whole-crate
`cargo fmt --all -- --check` successfully.

The WSL environment still has no native `cc`; a direct WSL Cargo test therefore stopped while
linking host build scripts. This is an environment limitation, not a passing or failing runtime
oracle. The exact current tree was rebuilt with pinned Windows Rust/cargo 1.88 for
`x86_64-unknown-linux-musl`, locked dependencies, `CARGO_INCREMENTAL=0`, and
`RUSTFLAGS=-C linker=rust-lld`. Cross-build succeeded; it is build evidence only. The emitted
static Linux ELFs were then executed as real WSL Linux processes with `--test-threads=1`:

```text
linux_broker_protocol_contract: 6 passed, 0 failed, 0 ignored
linux_broker_lease_contract:    11 passed, 0 failed, 0 ignored
linux_broker_service_contract:  15 passed, 0 failed, 1 intentionally ignored
```

The ignored service entry is only the subprocess selector
`broker_delivery_process_fixture`; it is invoked by the named parent process oracle and is not
counted as an acceptance test. The parent
`client_and_daemon_process_loss_recover_and_ack_one_prepared_delivery` passed.

Current ELF identities:

```text
protocol  12462040 bytes  1146d867348db1ffcb65652beb5dacb8f4cae7961deb342a3a8dd91238f923c5
lease     13292968 bytes  e87b5a1807cbdac8bebc65e1ab3d8143184902a25041b4ff1e6ae0afa36c90db
service   14689616 bytes  5837f4a122bcbb1fd1937d26e9b173c9ef06656890fe338566e7c40f456399d5
```

## Production-source freeze and current hashes

No production Rust source was edited after the process oracle was added. The current production
Rust surface is frozen for non-author review at:

```text
broker_protocol.rs                                     92db7789dad7255479e6ea998083000a258dabfe7408b5f8d3c17db380809346
broker_lease.rs                                        83f9f7569cee890d2f41d2657c9cf2d954c60dba67cb7c5596f9cc0cd9284090
broker_service.rs                                      84258a2164c3d2a8368cfde785610ab592c7f7aa1e22f35f9a5ebee03b179bbe
bin/rasen-linux-process-authority-broker.rs            799f15ccd76ee7f4375592dcdcc351d8aeee33c26b7c145bdc93b9c4f7806f9e
bin/rasen-linux-process-authority-broker-client.rs     baff2b08b8376aa25510d9e1ae43ad5bcab458c9afac6cbb8f1eced6308ec8ee
```

Current controller/test hashes:

```text
preparation-delivery-ledger.ts                         a7b9ca48fa6877174edf16eae6c47ea4e71cc249dfcf41e24752aca4e2aef28a
provider.ts                                            a3d80f3a9fc743cbd219fd9a35d4b36b9d9e9d5ba999e7dbe2b23bc358d43cc4
native-assembly.ts                                     5a94f5b38509bad712b555468be60b2d3f32e36ba1a80ea7e3e8bc3b9fa11918
linux-process-authority-preparation-delivery.test.ts   72ddc5f164a884ab5fc5318becfcf7f86d9f0b83a840ec1b39eed7d80cf1909e
linux_broker_service_contract.rs                       30adc2b276e9b8ff518dbf7f8e96b6db67d6e0df0a50fad2528b20a9937519c4
```

## Rebuildable cache cleanup

LEAD removed only rebuildable Rust incremental caches after verifying their absolute paths:

```text
target/debug/incremental                              145798183 bytes
target/x86_64-unknown-linux-gnu/debug/incremental    166910954 bytes
target/x86_64-unknown-linux-musl/debug/incremental   296218561 bytes
total                                                 608927698 bytes
```

Source, test ELFs, Change evidence, and test output were preserved.

## Durable findings and re-review request

1. Durable delivery identity must be the preparation operation plus exact prepare binding and a
   separate recovery capability; a random client request id is only attempt correlation.
2. `ReferenceStored` must precede ACK, and broker provisional recovery must survive until exact ACK
   acceptance. ACK response delivery is never the durable boundary.
3. Controller phase state must be append-only or protected by an actual cross-process transaction;
   read/compare/rename is not CAS, and Windows unlink-before-rename can erase the only record.
4. Missing packaged artifacts must return typed unavailable before a delivery intent is created.
5. Dispatch a fresh non-author broker reviewer over `BRK-R2-B02`, the exact hashes above, the
   process-oracle caveat, and the controller immutable-ledger delta. Keep Section 9 and all broader
   release/default/integration claims open regardless of this focused verdict.
