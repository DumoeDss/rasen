# WSL primary topology oracle fix — round 4

Date: 2026-08-06\
Role: fresh review-loop fixer\
Scope: `WSL-R4-M02`, `WSL-R4-M03` only\
Verdict: **IMPLEMENTED AND ACTUAL-WSL GREEN; finding/task closure still requires fresh non-author review**

## Boundary and changed surface

The implementation adds one integration-test binary:

- `native/linux-process-authority/tests/linux_primary_topology_contract.rs`

No production Rust/TypeScript source, protocol, argv/environment schema, `tasks.md`, run-state,
portfolio, Direction, Git, stash, or external WSL configuration was changed. The tests use the
public primary authority lifecycle (`prepare_primary`, runtime open, activate, inspect, terminate)
plus selector-only test-binary workloads. The relevant production authority source remained:

```text
40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea  native/linux-process-authority/src/primary.rs
```

The final topology test source is strict UTF-8 without BOM:

```text
661b59992a375bc16d4990b365523e419d248166cd815bbccd76827399e2a23c  native/linux-process-authority/tests/linux_primary_topology_contract.rs
19572 bytes
```

## Vertical TDD receipts

### M02 — detached `setsid` double fork

RED was executed before adding the fixture selector. The parent oracle used the real helper path
and failed at its explicit ready barrier because the selected workload did not exist yet:

```text
target: E:\tmp\rpa-wsl-topology-r4-red-m02
WSL command: <linux_primary_topology_contract ELF> \
  --exact setsid_double_fork_survives_root_exit_until_exact_guardian_force \
  --nocapture --test-threads=1

result: FAILED; double-fork ready barrier timed out
count: 0 passed, 1 failed, 0 ignored
```

After adding only the selector-only workload fixture, the same named parent became GREEN on the
actual WSL kernel:

```text
count: 1 passed, 0 failed, 0 ignored
```

The final parent oracle proves:

- the authority root forks A; A performs real `setsid()`, forks B, and exits;
- B waits until actual `getppid()` is namespace PID 1 before atomically publishing a closed fact
  record;
- the record proves root, session leader, and B are distinct, B is reparented to PID 1, and B's
  actual SID and PGID equal A's session-leader PID while differing from the authority root's SID
  and PGID;
- the root consumes a pipe barrier and exits code 0 without waiting for B;
- the runtime emits exact root exit while B holds an explicit FIFO gate, and `inspect()` remains
  `root-exited` rather than empty;
- `terminate()` converges through the revalidated authority to `exact-scope-empty`;
- `/bin/sleep 30`, launched outside the authority, remains live and is then explicitly cleaned up;
- after exact empty the FIFO has no surviving reader (`open(O_WRONLY|O_NONBLOCK)` returns `ENXIO`),
  and neither the escape marker nor the auxiliary direct-`SIGTERM` marker exists.

The no-individual-descendant-signal claim does not rest on the marker alone. At the recorded
production digest, `Guardian::handle_control` sends graceful `SIGTERM` only to the exact root PID
when it has not exited; `wait_or_kill_authority` applies force through the reopened guardian pidfd.
In this oracle the root has already exited, so the direct-signal marker is supporting mutation
evidence only. No quiet-period or sampled PID tree decides empty: there is no post-termination
sleep, and the terminal authority observation plus FIFO-reader liveness are the deciding oracles.

### M03 — nested PID namespace live after root exit

RED was again executed before adding either nested fixture selector:

```text
target: E:\tmp\rpa-wsl-topology-r4-red-m03
WSL command: <linux_primary_topology_contract ELF> \
  --exact nested_pid_namespace_remains_live_after_root_exit_until_release \
  --nocapture --test-threads=1

result: FAILED; nested PID namespace ready barrier timed out
count: 0 passed, 1 failed, 0 ignored
```

After adding the two selector-only fixture entries, the named parent became GREEN on WSL:

```text
count: 1 passed, 0 failed, 0 ignored
```

The outer authority root starts exactly:

```text
/usr/bin/unshare --user --pid --fork --mount-proc \
  <current topology test ELF> --exact nested_pidns_descendant_gate_fixture --nocapture
```

The new nested PID 1 forks a descendant. That descendant atomically records actual PID facts and
holds an explicit release-file gate. The record proves nested init PID 1, descendant PID greater
than 1, and descendant parent PID 1. The authority root observes only the ready barrier and exits
without waiting for the `unshare` child. The parent then proves exact root code 0 and
`inspect() == root-exited` while the gate is closed. Only after writing the release file does the
nested init reap its descendant, exit naturally, and allow the outer guardian's real child-set
reaping path to emit `exact-scope-empty`. No terminate call, PGID/session fact, `/proc` tree sample,
or elapsed quiet period decides the result.

All sleeps in this file are bounded polling timeouts for explicit file/readiness barriers; none is
used as evidence that the authority is empty.

## Final current-tree build and actual-WSL execution

Environment:

```text
Windows compiler: rustc 1.88.0 (6b00bc388 2025-06-23)
host: x86_64-pc-windows-msvc; LLVM 20.1.5
cross target: x86_64-unknown-linux-musl
linker: rust-lld via RUSTFLAGS=-C linker=rust-lld
WSL distribution: Ubuntu 24.04.1 LTS
kernel: Linux 5.15.167.4-microsoft-standard-WSL2 x86_64 GNU/Linux
unshare: util-linux 2.39.3
```

All target and temp output was on `E:`:

```powershell
$env:CARGO_TARGET_DIR='E:\tmp\rpa-wsl-topology-r4-final\target'
$env:TEMP='E:\tmp\rpa-wsl-topology-r4-final\temp'
$env:TMP='E:\tmp\rpa-wsl-topology-r4-final\temp'
$env:RUSTFLAGS='-C linker=rust-lld'

rustup run 1.88.0 cargo build --locked `
  --manifest-path native/linux-process-authority/Cargo.toml `
  --target x86_64-unknown-linux-musl `
  --bin rasen-linux-process-authority

rustup run 1.88.0 cargo test --locked `
  --manifest-path native/linux-process-authority/Cargo.toml `
  --target x86_64-unknown-linux-musl `
  --test linux_primary_topology_contract --no-run
```

Both commands passed. The build emitted only concurrent broker-path warnings about an unused
`take_u64` function and unused broker-client `PrepareRequest` import; neither warning originates in
or is hidden by the topology test.

Final actual-WSL serial results from the same ELF:

```text
setsid_double_fork_survives_root_exit_until_exact_guardian_force
  1 passed, 0 failed, 0 ignored, 4 filtered

nested_pid_namespace_remains_live_after_root_exit_until_release
  1 passed, 0 failed, 0 ignored, 4 filtered

named parent-oracle total
  2 passed, 0 failed, 0 ignored

complete topology test binary
  5 passed, 0 failed, 0 ignored, 0 filtered
```

Artifact identities:

```text
test ELF:
  E:\tmp\rpa-wsl-topology-r4-final\target\x86_64-unknown-linux-musl\debug\deps\linux_primary_topology_contract-b5a8c032ac802d0a
  13962776 bytes
  a6b36ddda84b5318c0b4dbd7b72ab0daebf5ed7a8469b35a65e4a7fa32a21256
  ELF 64-bit x86-64 static PIE, actual execution on WSL

sibling primary helper ELF:
  E:\tmp\rpa-wsl-topology-r4-final\target\x86_64-unknown-linux-musl\debug\rasen-linux-process-authority
  10957192 bytes
  76742b690653c7062c35bd31bd1e03f4ce2061232b0f11ed05b763a1c38e8e4b
```

Windows host-only check was also explicit:

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --test linux_primary_topology_contract -- --nocapture

0 passed, 0 failed, 0 ignored
```

The Windows result is a platform-gated compile/test receipt only and is not acceptance evidence.

## Zero-hidden-skip and claim accounting

The full Linux test binary contains five libtest entries. Exactly two are parent acceptance
oracles. The following three are selector-only subprocess entry points and are excluded from the
acceptance count even though the unselected top-level libtest run reports them `ok`:

- `setsid_double_fork_resistant_descendant_fixture`
- `nested_pidns_parent_exits_fixture`
- `nested_pidns_descendant_gate_fixture`

There are zero ignored tests. Each parent was also run by exact name so fixture `ok` lines cannot
inflate the claimed count. No hidden platform skip contributes to the two-parent WSL result.

This evidence is a candidate remediation for `WSL-R4-M02` / Task `7.4` and `WSL-R4-M03` / Task
`7.6`. It does not self-close either finding/task. It does not establish the complete Section 7 or
Task `11.3` matrix, native-package Task `7.2`, installed broker/cgroup-v2 Section 9, distribution or
install support, default selection, ProcessScope/SessionHost closure, macOS, or ECP-8 release truth.

## Durable findings

1. Detached topology must be proven before root exit by kernel PID/SID/PGID/reparent facts; a
   background command followed by shell `wait` cannot exercise the missing recursive-force row.
2. Nested PID namespace truth needs a release-controlled nested PID 1 and descendant. Merely
   observing root-exited before a later empty event is insufficient if the root itself waited for
   the nested work.
3. Test-binary fixture entries are execution plumbing, not acceptance oracles. Future WSL summaries
   must continue counting named parents separately from selector-only `ok` lines.
