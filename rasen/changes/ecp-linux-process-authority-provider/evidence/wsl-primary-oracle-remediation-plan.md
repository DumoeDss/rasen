# WSL primary oracle remediation plan

Date: 2026-08-06\
Mode: read-only remediation design; no source, test, task, run-state, or external-system mutation\
Input findings: `WSL-R4-M00` through `WSL-R4-M06`\
Recommendation: **stabilize the ready/deadline construction seam first, then add four ordered oracle batches at the deepest existing lifecycle seams**

## Scope and acceptance locks

This plan consumes the Change proposal, design, delta spec, tasks, WSL gate rounds 1–4,
`review-report-native-primary-seam-round-1.md`, and
`ready-hook-seam-remediation-plan.md`. It also traces the current TypeScript coordinator,
provider, publication ledger, native assembly and their tests, plus the Rust primary construction,
guardian lifecycle, durable journal, and current actual-WSL tests.

It closes only the missing acceptance paths named `WSL-R4-M00` through `WSL-R4-M06`. It does not
redesign the broker, package/release flow, common provider contract, ProcessScope default, or host
integration. It does not make Section 9, distribution, macOS, closure, or ECP-8 claims.

The following locks apply to every batch:

- Recursive authority remains the PID-namespace guardian (and the separately selected broker
  cgroup where applicable). A PGID, session, `/proc` PID tree, descendant sample, or quiet polling
  interval is never authority or an empty proof.
- Native state remains `inert`; there is no native `Published` event and no `PUBLISH` frame.
  Publication truth comes only from the authentic TypeScript publication ledger through the
  common publisher seam.
- No production argv, environment variable, launch field, protocol frame, filesystem selector, or
  provider factory option may select a test fault. Test selectors may exist only in test binaries
  or test fixtures that the production provider cannot invoke.
- Every actual-WSL oracle must execute a real Linux process on the recorded WSL kernel. A fake
  transport, cross-target compile, or Windows-host assertion can support the proof but cannot be
  counted as the terminal oracle.
- Fixture entry-point `ok` lines are not acceptance counts. Only parent tests that drive the
  selector and assert externally observable outcomes count.

## Design decision: one deep construction seam, not per-syscall ports

Two tempting approaches are rejected:

1. Adding injectable ports for `clone`, mapping writes, proc checks, pidfd, every journal write, and
   every provider operation would spread one transaction's ordering rules across a large shallow
   Interface. It would also encourage tests to assert implementation calls rather than lifecycle
   outcomes.
2. Adding a helper environment variable or argv fault selector would make the production artifact
   capable of selecting a non-production execution path. That violates the closed helper
   Interface and would make an oracle itself a new authority input.

The recommended shape is:

- The ready/deadline work replaces `prepare_primary_with_ready_hook` with the internal
  deadline-aware recoverable-prepare/pre-readiness-permit module described in
  `ready-hook-seam-remediation-plan.md`.
- That same module owns one **internal, closed, test-only checkpoint observer**. It names lifecycle
  checkpoints, not syscalls. Assertions still cross the normal prepare/reference/inspect/abort
  Interface. It is compiled only into crate-local tests or is exposed through a test-only module
  absent from the production Linux index.
- `GuardianMachine`/`GuardianEvent` remain the in-process lifecycle Interface;
  `DurableJournal` remains the durable local Interface; and the real `Guardian::reap_children`
  path remains the actual-kernel final-child oracle.
- The TypeScript replacement tests use the existing coordinator publisher Interface,
  `LinuxAuthorityPublicationLedger`, provider bundle, and real native assembly. The only added
  test seam should be a way for `native-assembly.ts` to construct its existing adapter from an
  explicitly resolved, manifest-verified test package root on actual Linux. It must not permit
  dependency injection into the production bundle.

This keeps the modules deep: construction owns partial cleanup, lifecycle owns legal transitions,
the journal owns atomic durable state, the ledger owns common publication truth, and the native
assembly owns exact ELF invocation.

## Dependency classification and seam ownership

| Finding | Dependency class | Terminal dependency | Deepest seam that owns it |
| --- | --- | --- | --- |
| `M00` partial construction | in-process ordering; local-substitutable files/socket/pipes; real-kernel namespace/pidfd cleanup | Real WSL for clone, PID namespace, proc and pidfd checkpoints | `primary.rs::prepare_primary_recoverable_until` and its transaction guard; reuse the pre-readiness permit/checkpoint, not the old callback |
| `M01` terminal state machine | in-process event codec; local-substitutable durable files; real-kernel `waitpid` child-set race | Real WSL for final-child order; local filesystem is sufficient for crash-layout mutations | `lifecycle.rs::{GuardianMachine, GuardianEvent}`, `journal.rs::DurableJournal`, and `primary.rs::Guardian::reap_children` |
| `M02` detached double fork | real-kernel | `fork`, `setsid`, reparenting, pidfd guardian force on WSL | Existing primary guardian plus a test-binary workload fixture in `linux_primary_contract.rs` |
| `M03` nested live work | real-kernel | Nested user/PID/mount namespace and ancestor reaping on WSL | Existing primary guardian plus a test-binary root fixture that starts `/usr/bin/unshare` |
| `M04` published abort | in-process coordinator state; local-substitutable ledger; real-kernel inert guardian | Real TypeScript process, authentic ledger, exact helper ELF and WSL namespace | `PreparedProcessAuthority.publish`, shared `abort`, `LinuxAuthorityPublicationLedger`, primary provider bundle |
| `M05` unavailable configuration | in-process error mapping; process-local real-kernel seccomp mutations | WSL kernel returning `EPERM`/`ENOSYS`; no global host mutation | Production `prepare_primary` plus `NativeFailureCode::from_prepare_error`; TypeScript mapping remains at `native-assembly.ts::failureOutcome`/provider prepare |
| `M06` publication windows | in-process coordinator state; local-substitutable ledger; real process death and real-kernel guardian | Two real Node controller processes plus authentic ledger and helper ELF on WSL | Common `prepared.publish`, `createLinuxAuthorityPublicationPublisher`, provider `inspect`/`abort`, native helper |

None of `M00`–`M06` requires initial-namespace root, installed broker authority, writable cgroup v2,
`sudo`, a VM, or WSL reconfiguration. Section 9 still requires separately authorized privileged
authority and remains out of scope.

## Prerequisite batch — land the ready/deadline seam first

This is a hard dependency, not an eighth WSL finding.

`NATIVE-SEAM-R1-M01` and `NATIVE-SEAM-R1-M02` already require replacement of the callback-shaped
ready hook with a deadline-aware pre-readiness permit and one recoverable-prepare supervisor. The
M00 matrix must be built on that final seam because it needs to observe and fail the same mapping,
`N`, identity, pidfd, identity-transfer, and `R` transaction. Implementing M00 against
`prepare_primary_with_ready_hook` would duplicate work around an Interface that should be deleted.

Required order:

1. Implement and independently close the ready-hook deadline and ordering findings.
2. Freeze the resulting `prepare_primary_recoverable_until`, absolute deadline, transaction
   cleanup, and internal checkpoint vocabulary.
3. Add M00 fault rows to that checkpoint vocabulary only where a lifecycle point is otherwise
   unobservable. Do not add a second callback, deadline, worker supervisor, or guardian cleanup
   algorithm.

Task `4.7` remains open until both the ready-hook review and the M00 matrix are independently clean.

## Batch 1 — partial construction and terminal state-machine matrices

### `WSL-R4-M00`: exact partial-construction matrix

#### RED oracle

Add a table-driven oracle named
`partial_construction_failure_matrix_reaps_guardian_and_keeps_workload_inert`. It must fail on the
current source because only the ready-hook error and incidental construction failures are covered.

Candidate placement:

- preferred: a crate-local `#[cfg(test)]` module beside the private construction transaction in
  `native/linux-process-authority/src/primary.rs`, so no test control becomes public;
- if the finalized permit needs an integration-test adapter, use a direct test-only export from
  `primary.rs` that is absent from `src/lib.rs` production/public wiring and cannot be selected by
  the helper binary;
- retain and strengthen the existing
  `native/linux-process-authority/tests/linux_primary_contract.rs::pre_readiness_hook_failure_reaps_the_exact_inert_guardian`
  under the permit's final name rather than duplicating it.

Candidate closed checkpoints (names may follow the finalized permit module, but the rows may not
be collapsed):

```text
scope-created
scope-dir-opened
private-listener-bound
handshake-pipes-created
guardian-cloned
mapping-complete
child-N-received
proc-and-namespace-revalidated
pidfd-opened-and-revalidated
attestation-encoded
pre-readiness-permit-held
identity-length-transferred
identity-body-transferred
child-identity-revalidated
journal-created
runtime-hidden-and-nondumpable
child-R-received
final-parent-revalidation
```

Use real filesystem setup for runtime-root/scope/socket failures and the internal observer only for
otherwise unreachable transitions. Child-side checkpoints must report through the existing closed
handshake/permit supervision; they must not use an environment selector in the helper.

Every row asserts all of the following through normal observable Interfaces:

- the call returns a typed failure and no prepared reference;
- the exact known guardian is `AbsentSameBoot` (or no guardian was ever created);
- the caller-mapped worker, where applicable, is reaped;
- the per-scope directory and socket/journal partials are absent, and the runtime root contains no
  retained unaccounted scope;
- `/usr/bin/touch <workload-marker>` never ran;
- an unrelated `/usr/bin/sleep` remains alive where the row performs destructive reconciliation;
- no PGID/PID-tree enumeration is introduced.

The final row must inject after `R` but before return/final parent revalidation. It is essential:
the matrix is not complete if it proves only failures before the guardian becomes control-ready.
If that RED reveals that no final parent revalidation exists, add it inside the same transaction
before ownership is returned; do not patch the test expectation.

Likely code locations/functions:

- `native/linux-process-authority/src/primary.rs`:
  `prepare_primary`, finalized `prepare_primary_recoverable_until`, `ChildContext`, `child_main`,
  deadline-aware `expect_byte`/bounded write helpers, and the transaction's exact cleanup guard;
- `native/linux-process-authority/src/runtime.rs::PrivateScope::create` only if an RAII ownership
  fix is required by RED; do not add a general filesystem port;
- `native/linux-process-authority/tests/linux_primary_contract.rs`: strengthened permit-error
  marker assertion and actual-WSL focused receipt.

Expected closure: `WSL-R4-M00`; contributes to Task `4.7`, which closes only when the separate
`NATIVE-SEAM-R1-M01/M02` review is also clean.

### `WSL-R4-M01`: final-child and terminal crash matrix

#### RED oracles

Add three non-overlapping oracles:

1. `root_status_corruption_matrix_is_retained_and_never_empty` in
   `native/linux-process-authority/tests/lifecycle_contract.rs`.
2. `final_child_exit_orders_root_status_before_exact_empty` in
   `native/linux-process-authority/tests/linux_primary_contract.rs`.
3. `terminal_record_crash_matrix_reopens_without_optimistic_state` in
   `native/linux-process-authority/tests/linux_journal_contract.rs` or a crate-local journal test
   module when private write checkpoints are required.

The root-status matrix covers none/both branches, negative and out-of-range code/signal, invalid
tag, status on a non-exit event, missing status on `RootExited`, reserved bytes, duplicate/gapped
sequence, invalid transition, truncation, trailing bytes, and corruption of the authenticated
bound record. Assertions use `RootExit::try_from_parts`, `GuardianEvent::decode_journal`, and
replacement observation; none may yield `ExactScopeEmpty` from malformed status.

The real final-child test launches a workload fixture with a root and at least two descendants
held on explicit pipes. Release orders are root-first, final-child-first, and simultaneous. For
each row, the actual runtime stream must show exactly one exact root result before one exact-empty
event, while `inspect()` remains `root-exited` whenever a child is still held. A sleep-only timing
window is not the oracle.

The terminal crash matrix belongs at `journal.rs::atomic_write_at`, but the assertion surface stays
`DurableJournal::{read_bound, append, commit_terminal}` and `AuthorityClient::inspect_evidence`.
A private test observer may stop a forked test writer at:

```text
before exact-empty journal temp creation
after journal temp write, before file fsync
after journal file fsync, before rename
after journal rename, before directory fsync
after exact-empty journal durability, before terminal temp creation
after terminal file fsync, before rename
after terminal rename, before directory fsync
after terminal directory fsync, before guardian exit
```

The parent kills that test writer at the barrier and reopens the result. An authenticated complete
record may be consumed; a partial/missing/corrupt record must be rejected or combined only with the
real same-boot namespace-init teardown proof. Root status may be reported only if its authenticated
journal event survived. No crash row may fabricate a code, signal, or quiet-period empty.

Likely code locations/functions:

- `native/linux-process-authority/src/lifecycle.rs`:
  `RootExit::try_from_parts`, `GuardianEvent::{encode_journal,decode_journal}`,
  `GuardianMachine::{root_exited,descendants_empty}`;
- `native/linux-process-authority/src/journal.rs`:
  `DurableJournal::{append,commit_terminal,read_bound}` and private `atomic_write_at`;
- `native/linux-process-authority/src/primary.rs`:
  `Guardian::reap_children`, `finish_exact_empty`, and `AuthorityClient::inspect_evidence` only if a
  RED exposes product behavior;
- the three tests named above.

Expected closure: `WSL-R4-M01` and Task `5.8` after a fresh non-author review.

## Batch 2 — detached double-fork and nested-live actual-WSL oracles

These are product-interface oracles. They should require no new production seam.

### `WSL-R4-M02`: detached `setsid` double fork survives root exit and is recursively killed

#### RED oracle

Add
`setsid_double_fork_survives_root_exit_until_exact_guardian_force` to
`native/linux-process-authority/tests/linux_primary_contract.rs`, plus a test-binary-only workload
entry point `setsid_double_fork_resistant_descendant_fixture`.

Fixture sequence:

1. The authority root forks child A.
2. Child A calls real `setsid()`, forks child B, then exits.
3. Child B ignores `SIGTERM`, writes a ready marker containing its actual PID/session/PGID facts,
   waits long enough to write a separate escape marker if it survives, and remains reparented to
   the namespace guardian.
4. The authority root waits only for the ready handshake, then exits code 0 without waiting for B.

Parent assertions:

- a `RootExited(Code(0))` event arrives while B's ready marker proves it is alive and its PGID/session
  differ from the authority root;
- `inspect()` is `root-exited`, not empty;
- `terminate()` targets only the revalidated guardian pidfd and returns exact empty;
- B never writes its delayed escape marker;
- an unrelated process outside the namespace survives;
- no descendant PID is signalled individually by the provider.

Do not reuse the existing `unshare ... '& wait'` command: its explicit wait is precisely why M02
is open.

Expected closure: `WSL-R4-M02` and Task `7.4`; contributes to `11.3` only after the complete Section
7 rerun.

### `WSL-R4-M03`: nested PID namespace remains live after authority root exit

#### RED oracle

Add
`nested_pid_namespace_remains_live_after_root_exit_until_release` to
`native/linux-process-authority/tests/linux_primary_contract.rs`, plus a test-binary-only root
fixture `nested_pidns_parent_exits_fixture`.

The authority root fixture starts the exact `/usr/bin/unshare --user --pid --fork --mount-proc`
child. Inside it, nested PID 1 starts a descendant, writes a ready marker, and waits on an explicit
release file/pipe. The authority root observes the ready marker and exits without waiting for
`unshare`. The parent test then requires:

- exact root exit occurs while the nested ready process remains observable;
- the outer guardian reports `root-exited`, never empty, while the release gate is closed;
- releasing the gate lets nested init/descendant exit naturally;
- only then does the outer guardian's real `waitpid(-1, WNOHANG) -> ECHILD` path produce exact
  empty;
- no PGID/session or sampled `/proc` tree determines the result.

Use marker/pipe barriers for ordering; elapsed sleep is only a bounded timeout. This test requires
the current unprivileged WSL namespace capability but no privileged authority.

Expected closure: `WSL-R4-M03` and Task `7.6`; contributes to `11.3` only after the complete Section
7 rerun.

## Batch 3 — real TypeScript publisher/ledger plus real helper

### Shared integrated test harness

Add one actual-Linux test file, preferably
`test/core/session-host/linux-process-authority-wsl-oracles.test.ts`, and one child-controller
fixture, preferably `test/fixtures/linux-process-authority-wsl-controller.mjs`.

The test must use:

- `ProcessAuthorityProviderRegistry` and `createProcessAuthorityCoordinator`;
- the exact primary provider descriptor;
- `createLinuxAuthorityPublicationLedger` and the bundle's `publishAuthority`;
- a real Linux primary native assembly invoking a manifest-verified current helper ELF;
- a caller-owned mode-0700 state root under a trusted home ancestor, with any persisted reference
  file mode 0600 and removed during cleanup.

The narrow candidate source refactor is in
`src/core/session-host/process-authority/linux/native-assembly.ts`: factor the current private
`createLinuxNativeAssembly` implementation around an already exact resolved artifact and add a
direct-module test-only constructor such as
`createLinuxPrimaryNativeAssemblyForTesting(runtimeRoot, resolutionOptions, buildAuthority)`.
It must internally call `resolveLinuxProcessAuthorityArtifactForTesting`; it must remain absent
from `linux/index.ts`, and `createLinuxPrimaryProcessAuthorityProviderBundle` must continue to
forbid injection. Reuse `LinuxAuthorityNativeTransport` and `LinuxAuthorityRuntimeOpener`; do not
duplicate framing or spawn logic in the test.

The helper/manifest input must be produced by the source-owned current-tree native/package staging
route into an isolated E-drive/WSL-visible directory. Batch 3 can consume that exact staged input,
but it must not itself claim Task `7.2`; the package owner still owns the final native
build/export/adjacent-manifest receipt.

### `WSL-R4-M04`: actual published-inert abort

#### RED oracle

Add `actual_wsl_published_inert_abort_keeps_workload_closed`.

Sequence:

1. Prepare `/usr/bin/touch <must-not-exist>` through the real coordinator/provider/helper.
2. Publish through the bundle's authentic publisher and require the common result
   `published-inert`.
3. Construct a replacement ledger/provider bundle over the same state root and require real native
   `inert` plus authentic ledger lookup to report `published-inert`.
4. Abort without ever calling activate.
5. Require exact empty, guardian absence/reconciled terminal state, and absent workload marker.

The native journal must still contain no `Published` transition, and provider activation must still
contain no ledger commit. Existing source guards remain supporting evidence; this test supplies the
missing actual-WSL product path.

Expected closure: `WSL-R4-M04` supplies the missing published-abort row of Task `7.8`. The task may
close only after the reviewer also confirms the already-green natural/code/signal/root-live/force/
prepared-abort rows on the same current tree.

### `WSL-R4-M06`: both controller-replacement publication windows

#### RED oracles

Add two explicit tests (or an `it.each` whose receipt reports both names):

- `actual_wsl_replacement_recovers_commit_before_ack_as_published_inert`;
- `actual_wsl_replacement_recovers_ack_before_activate_as_published_inert`.

The controller child persists the sensitive reference only under the private test root and reports
barriers through a private IPC/file gate that is fsynced before notification.

Commit-before-ack window:

1. Child prepares and writes the canonical common reference.
2. Its wrapper publisher calls the authentic bundle publisher to completion (ledger commit and
   fsync), writes `ledger-committed`, then blocks before returning the acknowledgement to
   `prepared.publish`.
3. Parent kills and reaps the controller at that barrier.
4. A new controller opens the same state/ledger and exact helper reference, obtains
   `published-inert`, proves the marker absent, and aborts to exact empty.

Acknowledgement-before-activate window:

1. Child completes `prepared.publish(bundle.publishAuthority)` and requires the returned
   `published-inert` object.
2. It writes `acknowledged`, then blocks without calling `activate`.
3. Parent kills and reaps it at that barrier.
4. Replacement again requires durable `published-inert`, absent workload marker, and exact abort.

The controller process—not merely a JavaScript object—is replaced. The ledger files alone are not
the oracle: replacement must also inspect/control the same real inert native guardian. Do not add a
provider-side recovery activation capability; abort/reconcile is the allowed action.

Expected closure: `WSL-R4-M06` and Task `7.10`; contributes to `11.3` after the complete fresh
Section 7 run.

## Batch 4 — deterministic unavailable-configuration mutations

### `WSL-R4-M05`: process-local actual-kernel denial matrix

Global mutation is unnecessary and forbidden. Do not write sysctls, remount the ordinary WSL
`/proc`, edit `.wslconfig`, stop WSL, use `sudo`, or disable namespaces for other sessions.

#### RED oracle

Add `unavailable_configuration_matrix_fails_closed_without_global_mutation` to
`native/linux-process-authority/tests/linux_primary_contract.rs`, driven through a fresh selected
test-process fixture such as `unavailable_configuration_fixture` for each row. The fixture—not the
production helper—may receive a private test selector. It sets `PR_SET_NO_NEW_PRIVS` and installs a
bounded seccomp BPF filter, then calls the production `prepare_primary` implementation.

Required real-kernel rows:

| Row | Process-local mutation | Expected native classification |
| --- | --- | --- |
| namespace unavailable | reject namespace-bearing `clone` with `EPERM` | `NativeFailureCode::Unavailable` |
| mapping denied | after pre-opened immutable launch inputs, reject mapping-write `openat` flags with `EACCES` | `Unavailable` |
| proc/private mount denied | reject `mount` with `EPERM` (inherited by the namespace child) | `Unavailable` |
| pidfd missing | reject `pidfd_open` with `ENOSYS` | `Unavailable` |

The mapping filter must match write flags, not all `openat`, so cleanup/revalidation is still
observable. Each mutation runs in a new process because seccomp is irreversible for that process.
For every row assert: no prepared reference, empty/reconciled runtime root, absent workload marker,
no live exact guardian, no broker contact, and no destructive signal to an unrelated process.

Also run the existing TypeScript
`surfaces native prerequisite denial as a typed prepare-unavailable result` and native assembly
failure-code mapping tests. If the real native errno currently maps to `Uncertain`, the product fix
belongs in `protocol.rs::NativeFailureCode::from_prepare_error`; do not weaken the oracle or add a
test-only remap.

Candidate files/functions:

- `native/linux-process-authority/tests/linux_primary_contract.rs`: parent matrix, isolated fixture,
  no-new-privileges/seccomp helpers;
- `native/linux-process-authority/src/protocol.rs::NativeFailureCode::from_prepare_error` only if RED
  exposes incorrect mapping;
- `native/linux-process-authority/src/primary.rs` cleanup transaction only if a row leaves a live
  guardian or partial scope;
- `src/core/session-host/process-authority/linux/native-assembly.ts::failureOutcome` and
  `provider.ts::createPreparedReference` are supporting TypeScript mapping seams, not places to
  fake the kernel result.

Expected closure: `WSL-R4-M05` and the missing unavailable-configuration half of Task `7.9`. The
reviewer must also rerun the existing boot/PID/start/namespace/capability/unrelated-replacement
identity-drift oracles before checking the whole task.

## Privilege and environment decision table

| Work | Current unprivileged WSL? | External privileged authority? | Notes |
| --- | --- | --- | --- |
| M00 construction matrix | Yes | No | Existing user/PID/mount namespaces and pidfd suffice |
| M01 state/journal/final-child | Yes | No | Local private filesystem plus real WSL child reaping |
| M02 double fork/setsid | Yes | No | Pure workload syscalls inside the authority namespace |
| M03 nested PID namespace | Yes | No | Current `unshare --user --pid --fork --mount-proc` capability already proved |
| M04 published abort | Yes | No | Needs current manifest-verified helper staging, not admin |
| M05 unavailable mutations | Yes | No | `no_new_privs` seccomp filters are process-local; no host policy mutation |
| M06 publication windows | Yes | No | Real Node process kill/replacement under caller-owned private state |
| Section 9 broker/cgroup v2 | No | **Yes, separately authorized** | Hybrid WSL lacks controllers, `cgroup.events`, `cgroup.kill`, writable isolated service subtree |

If any M00–M06 implementation proposes global WSL configuration or broker privilege, stop: that is
a seam-placement error, not a necessary acceptance dependency.

## Recommended dependency order

1. **Ready/deadline prerequisite:** implement and independently re-review the pre-readiness permit,
   absolute deadline, worker/guardian reconciliation, and ordering oracle.
2. **Batch 1 / M00+M01:** freeze construction and terminal state machines with complete injected,
   local-filesystem, and real final-child matrices.
3. **Batch 2 / M02+M03:** add the two missing actual-WSL workload topologies without changing
   production Interfaces.
4. **Current helper staging dependency:** package owner emits the exact current helper/manifest into
   an isolated test package root. This is consumed by Batch 3 and remains separately accountable
   to Task `7.2`.
5. **Batch 3 / M04+M06:** run real TypeScript publisher/ledger/provider/helper and both process
   replacement windows.
6. **Batch 4 / M05:** run irreversible-per-process seccomp fixtures only after the final construction
   cleanup transaction is stable.
7. **Fresh non-author WSL review:** rerun all Section 7 parent oracles, verify zero hidden skips, and
   publish a new gate report. Only then update task accounting.

Batch 2 can be implemented while the package staging dependency is prepared. Batch 3 must not use a
historical helper digest. Batch 4 must not be used to compensate for missing M00 cleanup rows.

## Fresh review commands and evidence requirements

All target/temp roots must be on `E:` (or `/mnt/e`) because the Windows system volume is full. Use
the already provisioned, explicitly pinned WSL toolchain; do not accept ambient cargo/rustc.

From WSL, with `<WT>` bound to the exact worktree and an E-drive target root:

```sh
export RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2
export CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2
export CARGO_TARGET_DIR=/mnt/e/tmp/rpa-wsl-oracle-review/target
export TMPDIR=/mnt/e/tmp/rpa-wsl-oracle-review/tmp
mkdir -p "$CARGO_TARGET_DIR" "$TMPDIR"
cd <WT>

"$CARGO_HOME/bin/cargo" fmt \
  --manifest-path native/linux-process-authority/Cargo.toml --all -- --check

"$CARGO_HOME/bin/cargo" test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu \
  --test lifecycle_contract -- --test-threads=1 --nocapture

"$CARGO_HOME/bin/cargo" test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu \
  --test linux_journal_contract -- --test-threads=1 --nocapture

"$CARGO_HOME/bin/cargo" test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu \
  --test linux_primary_contract -- --test-threads=1 --nocapture

"$CARGO_HOME/bin/cargo" test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu -- --test-threads=1
```

If the recorded isolated Zig linker wrapper is still required for the GNU target, use the exact
round-3 wrapper/sysroot receipt; do not install a system compiler or silently change linker
provenance.

Run the integrated TypeScript actual-Linux file explicitly, not as an unreported skip:

```sh
RASEN_ACTUAL_WSL_ORACLE=1 pnpm exec vitest run \
  test/core/session-host/linux-process-authority-wsl-oracles.test.ts \
  --pool=forks --maxWorkers=1

pnpm exec vitest run \
  test/core/session-host/linux-process-authority-provider.test.ts \
  test/core/session-host/linux-process-authority-publication-ledger.test.ts \
  test/core/session-host/process-authority-lifecycle.test.ts \
  --pool=forks --maxWorkers=1

pnpm exec tsc --noEmit
pnpm exec eslint \
  src/core/session-host/process-authority/linux \
  test/core/session-host/linux-process-authority-wsl-oracles.test.ts \
  test/fixtures/linux-process-authority-wsl-controller.mjs
```

Then rebuild the exact current-tree musl artifacts with E-drive roots and execute every emitted test
ELF on WSL serially, using the same zero-hidden-skip accounting as round 4. The report must record:

- source hashes and exact helper/manifest hash, size, mode, compiler and source digest;
- WSL distribution/kernel and pinned Rust/cargo/linker identities;
- named parent-test counts for every M00–M06 row;
- zero ignored tests and an explicit list of selector entry points excluded from acceptance counts;
- proof that the TypeScript test used a real Linux Node process and the helper used a real ELF fd;
- confirmation that no Section 9, package-install, default-selection, closure, or release claim was
  inferred.

Finally run strict Change validation and the existing no-fallback/source guards. Validation passing
does not close an actual-kernel row by itself.

## Finding-to-task closure map

| Finding | RED oracle(s) | Task closure contribution |
| --- | --- | --- |
| `WSL-R4-M00` | partial construction checkpoint matrix + strengthened permit error marker | `4.7`, only jointly with clean `NATIVE-SEAM-R1-M01/M02` review |
| `WSL-R4-M01` | root corruption, final-child order, terminal crash matrices | `5.8` |
| `WSL-R4-M02` | detached `setsid` double-fork resistant descendant | `7.4` |
| `WSL-R4-M03` | nested PID namespace held live after authority root exit | `7.6` |
| `WSL-R4-M04` | real publisher-led published-inert abort | missing published-abort row of `7.8` |
| `WSL-R4-M05` | process-local namespace/mapping/mount/pidfd denial matrix | missing unavailable row of `7.9` |
| `WSL-R4-M06` | commit-before-ack and ack-before-activate controller replacement | `7.10` |

Task `11.3` may close only after M02–M06, the already-green Section 7 rows, and the package-owned
current-tree `7.2` receipt are all rerun fresh. A new `7.11` summary should supersede round 4 only
after that review. M00/M01 are required Change gates even though they are not substitutes for
Section 7 actual-kernel accounting.

## Review invariants and rollback boundaries

- Ordinary `prepare_primary` retains its external Interface; broker-only permit/deadline logic does
  not enter ordinary primary behavior.
- There is one construction transaction and one absolute prepare deadline. M00 adds observations,
  not a second cleanup or deadline implementation.
- Fault selectors exist only in tests. Production helper argv/env/frame schemas remain closed.
- The double-fork and nested tests prove topology with barriers and kernel facts, not sleeps or PID
  tree sampling.
- The publisher tests cross the common publisher Interface and authentic ledger; writing ledger
  files directly is not a valid M04/M06 oracle.
- Replacement recovers only `published-inert` and may abort/reconcile. It never gains hidden
  recovery activation.
- Seccomp mutations are confined to disposable fixture processes. No global WSL state is changed.
- No test or source adds `PUBLISH`, native `Published`, PGID authority, process-tree authority, or
  descendant signalling.

Rollback is batch-local after the ready/deadline prerequisite is integrated: oracle fixtures and
private test observers may be removed without changing provider semantics. If a RED requires a
product fix, roll back its test and fix together only if abandoning the task; never retain a
production fault selector or half of the construction permit/supervisor.

## Durable findings

1. `M00` and the ready-hook findings are the same construction topology at different proof depth.
   They require one shared pre-readiness transaction seam, ordered ready/deadline remediation first,
   not parallel callback-based implementations.
2. `M04/M06` cannot be closed by native tests or ledger-only tests. The terminal oracle is a real
   controller replacement that reopens the authentic ledger and the same real inert WSL guardian.
3. Every unavailable prerequisite required by `M05` can be mutated inside a disposable
   unprivileged WSL process. Privileged/global WSL changes are neither necessary nor acceptable;
   only the separate Section 9 broker gate needs new external authority.
