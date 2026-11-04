# Native Linux broker review fix - round 2

Date: 2026-08-06
Mode: resumed fixer; shared-worktree, source-writing
Reviewed input: `review-report-native-broker-round-2.md`
Verdict: **all BRK-R2 source fixes are implemented and current gates are green; fresh non-author review is still required**

## Scope and integrity

This pass fixes `BRK-R2-B01` through `BRK-R2-B07` and `BRK-R2-M01` in the Linux
broker production boundary and its focused regressions. It also uses the previously approved
minimal `primary.rs` ready-hook seam needed to close the construction death window. The shared
worktree contains other ECP slices; none of their files was reverted or normalized. This fixer
did not edit `tasks.md` or `auto-run.json`.

The available environment still cannot execute the root-installed writable unified cgroup-v2
acceptance matrix. Section 9, production-default selection, package release support, and terminal
Linux support remain open and are not implied by the receipts below.

## Round-2 finding disposition

| Finding | Fix disposition | Production and regression evidence |
| --- | --- | --- |
| `BRK-R2-B01` construction death window | **Implemented; independent closure pending.** A root-owned construction record is created before guardian construction. The exact final `GuardianClientReference` is fsynced from `prepare_primary_with_ready_hook` after exact attestation construction and before the guardian readiness release. Recovery abort first uses that exact reference and falls back to exact pidfd identity kill/wait when the control socket is unavailable. | `broker_guardian.rs`: `begin_construction`, `write_construction_record`, `abort_recovery`; `primary.rs`: `prepare_primary_with_ready_hook` and the pre-readiness hook call. Actual WSL regression `pre_readiness_hook_failure_reaps_the_exact_inert_guardian` passed 1/1. This is the critical after-attestation/before-readiness kill point; a fresh reviewer may still require additional distinct before-fork/after-fork injections. |
| `BRK-R2-B02` prepared response loss and deadline split-brain | **Implemented; independent closure pending.** Requests carry one absolute monotonic deadline. Pending/completed request replay is durable, bounded, and keyed by request id plus request digest/caller. Pending prepare is reconciled exactly; a recovered Prepared result is made durable before delivery and its recovery record is retired only after the replayable response exists. | `broker_protocol.rs`, broker client, daemon request transaction path, `broker_lease.rs` request records, and `broker_service.rs::{recover_prepared_response,reconcile_pending_prepare,complete_prepared_delivery}`. `prepared_response_loss_replays_the_same_durable_authority` passed on Windows and WSL. |
| `BRK-R2-B03` hidden publication operation | **Implemented; independent closure pending.** The broker client no longer invents publication from the launch digest during activation. Publication is an explicit publisher-owned call carrying the closed `BrokerPublicationBinding`: preparation operation id, publication operation id, generation, canonical reference digest, and launch digest. Activation only verifies the persisted binding. | `native-assembly.ts::encodeBrokerPublicationBinding`, broker client `record_publication`, `broker_protocol.rs::BrokerPublicationBinding`, and the durable lease binding. Focused TypeScript provider/boundary tests and broker publication/activation tests passed. |
| `BRK-R2-B04` concurrent durable-state corruption | **Implemented; independent closure pending.** Every lease lifecycle transition is protected by a fixed 256-shard per-token mutex plus an fd-backed shard `flock`, so thread and daemon-restart writers share one transaction domain. Same request-id processing also uses a fixed 256-shard daemon transaction lock; replay storage is bounded to 4,096 records and prunes completed records before admitting more. | `broker_lease.rs::with_token_lock`, daemon `request_locks`, and `broker_service.rs::with_request_token`. `concurrent_publish_and_abort_cannot_resurrect_a_terminal_lease` and `concurrent_activate_and_terminate_converge_without_phase_resurrection` passed on Windows and WSL. |
| `BRK-R2-B05` terminal history loss/fabrication | **Implemented; independent closure pending.** Authenticated cleanup tombstones retain either the exact closed guardian journal or the explicit `EventGap` state. Inspect/terminate replay returns that authentic journal or EventGap and never synthesizes an abort-shaped empty history. | `broker_lease.rs::LeaseTerminalHistory`, `broker_service.rs::replay_terminal`, broker response `EventGap`, and `inspection_durably_orders_exact_root_exit_then_natural_empty_and_replay`. |
| `BRK-R2-B06` zero grace and fixed two-second timeout | **Implemented; independent closure pending.** `Abort` and `Terminate { grace_ms }` are distinct operations. Zero grace is valid. Grace is a policy interval while the absolute monotonic request deadline is the phase budget; socket and guardian/cgroup waits use remaining time. | Broker protocol/client/service deadline code, zero-grace codec regression, and zero-grace terminal/concurrency service regressions. The formerly flaky default-parallel Windows crate gate now passed 58/58. |
| `BRK-R2-B07` pathname replacement during removal | **Implemented for the broker's trusted management domain; Section 9 remains open.** `FsCgroupKernel` has one service-domain administrative mutex covering create, bind, and remove pathname mutation; daemon lifetime singleton plus uninstall singleton extend the management protocol across service processes. Removal revalidates exact inode/name under that domain. | `broker_cgroup.rs::administrative_lock` and `replacement_during_remove_is_rejected_before_destructive_cleanup`, passed on Windows and WSL. An arbitrary external root process is outside this mutex; only the real privileged Section 9 replacement oracle can make the terminal claim. |
| `BRK-R2-M01` post-use uninstall | **Implemented; independent closure pending.** The stopped-service singleton now invokes a root-only Rust cleanup command. The durable store is strictly decoded; any recovery, pending request, retained/unauthenticated lease, or malformed state is refused. Only authenticated `CleanupComplete + ExactEmpty` tombstones, completed replay records, and their shard locks are removed. | broker daemon `clean-uninstall-state`, `broker_lease.rs::clear_authenticated_terminal_state`, `uninstall.sh`, and `uninstall_cleanup_accepts_only_authenticated_terminal_state`. Shell syntax and focused admin/lease tests passed. |

## Minimal cross-ownership primary seam

The primary API change is additive and bounded:

- existing `prepare_primary(...)` remains and delegates to a no-op hook;
- new `prepare_primary_with_ready_hook(...)` receives `&PreparedPrimary` only after exact
  attestation construction and before final guardian identity/readiness release;
- a hook failure follows the existing construction failure cleanup and reaps the exact guardian;
- broker code fsyncs the exact encoded reference inside that hook and verifies the returned
  reference is byte-identical.

Current SHA-256 values:

```text
primary.rs                   40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea
linux_primary_contract.rs    741df44df9dfdb5e0cc5e1c5b7b6609e830b436f5be0fc742950b8235838403b
broker_guardian.rs           0d22e991ad54e2a6f63fe0f7ae922e09641ec90a259b2045ae700ebb13cf7472
broker_cgroup.rs             4504dfe100c89c0346c005a40817c99fcf71b91c5f076fa22f8b3cd3ed2af2f1
broker_lease.rs              cbf9ce4049d355b9a1f064f846b9d9787d6a8ba07e4334ff995e62a3ca6ec9cd
broker_service.rs            1fc7cff8a3344e73ef09be16a2be02766bc6a6d55c89296e08c60ae0acee6579
```

Fresh primary delta review must use these current hashes. Older primary review findings
`NATIVE-B003`, `NATIVE-B004`, `NATIVE-M005`, and `NATIVE-B005` are not reopened by this report;
the reviewer should inspect only the additive ready-hook delta and its regression.

## Verification receipts

### Rust host, formatting, and cross-target compilation

```text
cargo test --locked --no-run
  PASS

cargo test --locked
  Windows default-parallel: 58 passed, 0 failed, 0 ignored

broker-focused Windows serial matrix
  44 passed, 0 failed, 0 ignored
  Linux-only peer harness selected 0 tests on Windows

cargo check --locked --all-targets --target x86_64-unknown-linux-gnu
  PASS, no warnings

WSL pinned Rust 1.88 cargo fmt --all -- --check
  PASS; rustc/cargo 1.88.0, rustfmt 1.8.0-stable
```

The Windows minimal pinned toolchain has no `cargo-fmt` component, so no component was installed
or changed. Formatting used the already recorded isolated WSL toolchain roots.

### Fresh actual-WSL static-musl matrix

Fresh isolated Windows cross-build roots:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-broker-r2-20260806-2
TEMP/TMP=E:\tmp\rpa-broker-r2-temp-20260806-2
RUSTFLAGS=-C linker=rust-lld
target=x86_64-unknown-linux-musl
```

Cargo emitted exactly 18 test ELFs. They were executed directly as Linux processes on
`Ubuntu-24.04` / WSL2, serially with `--test-threads=1`:

```text
18 ELF integrated matrix: 93 passed, 0 failed, 0 ignored
broker subset:             45 passed, 0 failed, 0 ignored
primary subset:            23 passed, 0 failed, 0 ignored
ready-hook focused:         1 passed, 0 failed, 22 filtered out
```

This is actual non-privileged Linux-kernel evidence for the reached paths. It is not a
root-installed broker, writable unified cgroup-v2, package-release, or general-distribution
receipt.

### TypeScript, administrative, package, and Change gates

```text
pnpm exec vitest run <four Linux provider/resolver/boundary/package-ci suites>
  4 files, 49 passed, 0 failed

pnpm exec tsc --noEmit --pretty false
  PASS

focused ESLint for native assembly/provider/provider test
  PASS

sh -n install.sh && sh -n uninstall.sh
  PASS; neither script was executed with privilege

node scripts/build-linux-process-authority.mjs --check-only --target x86_64-unknown-linux-gnu
  PASS; cross-build-non-runtime, runtimeAccepted=false
  current source SHA-256: 2cf6d54e8c05164c54b5800c3e2e1213865eb400c43c8eef73983f38d24bd151

node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json
  PASS; 1/1 valid, 0 issues
```

## Iteration notes

- The first current GNU check exposed a Linux-only compile error where broker code read private
  `PreparedPrimary.runtime_root`; the fix reuses the already captured immutable request runtime
  root and does not expand the primary public API.
- The same check exposed two test-only trait-bound mistakes (`unwrap_err` and `assert_eq`) in the
  new Linux-only hook regression; explicit matching fixed them without changing product types.
- The first WSL hook run stopped at the test fixture's closed short-label guard. The label was
  reduced from `ready-hook` to `rhk`, then a fresh target was rebuilt and passed.

## Retained non-terminal gate

No authorized environment currently supplies a root-installed broker and writable unified
cgroup-v2 service subtree with the required controller, `cgroup.events`, and `cgroup.kill`.
Therefore tasks 9.1-9.7 and the associated independent security/terminal acceptance gate must
remain open. In particular, the current administrative mutex does not constrain an arbitrary
external root controller; replacement-during-real-remove must be proved in Section 9.

## Re-review request

Dispatch a fresh non-author broker reviewer against this live source and `BRK-R2-B01` through
`BRK-R2-B07` plus `BRK-R2-M01`. Separately dispatch a fresh non-author primary delta reviewer over
the exact `primary.rs` / `linux_primary_contract.rs` ready-hook delta and the hashes above. Only
those reviews may mark the findings closed. Keep Section 9 open regardless of source-review
cleanliness.
