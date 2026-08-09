# WSL primary topology independent review — round 4

Date: 2026-08-06\
Mode: fresh non-author, dispatched/report-only\
Scope: `WSL-R4-M02` and `WSL-R4-M03` only\
Verdict: **CLEAN — both scoped Major findings are closed**

## Scope and identities

This review read the Change proposal, design, delta spec, tasks, the original round-4 WSL finding,
the frozen WSL oracle remediation design, the fixer report, the complete topology test, and the
production lifecycle paths needed to verify what the tests observe. It made no product, test,
task, run-state, Direction, Git, stash, or WSL configuration change.

The reviewed current-tree identities were stable before and after execution:

```text
661b59992a375bc16d4990b365523e419d248166cd815bbccd76827399e2a23c  native/linux-process-authority/tests/linux_primary_topology_contract.rs
40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea  native/linux-process-authority/src/primary.rs
1d3102ea6815de86a067f1c7ab060332a9cfec100562ceeae0f0d1d046f5241c  native/linux-process-authority/src/lifecycle.rs
```

The topology change is test-only. No new application code path was introduced, so the generic
application-code coverage diagram does not apply.

## Independent verdicts

### `WSL-R4-M02` — **CLOSED** (original severity: Major; no residual finding)

`setsid_double_fork_survives_root_exit_until_exact_guardian_force` is a behavior-sensitive parent
oracle rather than a launch smoke test:

- The selector fixture performs two real `fork()` calls and a real `setsid()`
  (`linux_primary_topology_contract.rs:471-560`). Child A becomes the session leader, forks B, and
  exits; B waits until the kernel reports `getppid() == 1` before publishing facts.
- The parent asserts distinct root/session-leader/descendant PIDs, guardian reparenting, and exact
  SID/PGID relationships (`:183-242`). Removing `setsid`, either fork, the reparent wait, or the
  root-before-descendant ordering makes a defining assertion or barrier fail.
- The root waits only for B's pipe handshake and then returns without waiting for B. The parent
  receives exact root code 0 and requires `inspect() == root-exited` while B holds an open FIFO
  gate (`:229-245`).
- `terminate(250)` uses the public authority path. At the reviewed production digest graceful
  `SIGTERM` is sent only to a still-live exact root (`primary.rs:814-831`); this root has already
  exited. Force then targets the reopened guardian pidfd (`primary.rs:1972-1987`), not descendant
  PIDs.
- After `exact-scope-empty`, a kernel FIFO open returns `ENXIO`, proving B's reader is gone; the
  escape and individual-signal markers remain absent, while an independently launched
  `/bin/sleep 30` remains alive (`linux_primary_topology_contract.rs:245-260`).

The recorded RED was the same named parent before its selector fixture existed: it failed at the
explicit ready barrier with `0 passed, 1 failed`. The current fixture addition turns that same
parent GREEN. The final assertions are sensitive to all defining topology and control properties,
so the transition is not a test that merely changed its expected value.

This closes the missing actual-WSL detached `setsid` double-fork recursive-control oracle and is
sufficient for the LEAD to close finding `WSL-R4-M02` and Task `7.4`. It does not contribute a
standalone closure of Task `11.3`.

### `WSL-R4-M03` — **CLOSED** (original severity: Major; no residual finding)

`nested_pid_namespace_remains_live_after_root_exit_until_release` proves the required ordering on
the actual kernel:

- The authority root starts the exact `/usr/bin/unshare --user --pid --fork --mount-proc` command
  with the current topology ELF, waits only for the ready fact, and drops its `Child` handle
  without waiting (`linux_primary_topology_contract.rs:354-385`).
- Inside the nested namespace, the selected fixture asserts it is PID 1, forks a descendant, and
  has that descendant record PID 1 as its parent before blocking on an explicit release-file gate
  (`:388-433`).
- The parent validates `nested_init_pid == 1`, descendant PID greater than 1, and parent PID 1;
  then observes exact root code 0 and requires `inspect() == root-exited` while the release gate is
  still closed (`:294-340`). Thus root exit cannot alias scope empty while the gated nested
  namespace remains held.
- Only after the parent creates the release file may nested PID 1 reap the descendant and exit.
  The parent then consumes a real `ExactScopeEmpty` frame and verifies the journal still contains
  root code 0 (`:341-350`). The reviewed guardian source derives natural empty from
  `waitpid(-1, WNOHANG) -> ECHILD` and commits the exact terminal event (`primary.rs:956-1009`).

The recorded RED was the same named parent before either nested selector existed: it failed at the
ready barrier with `0 passed, 1 failed`. Adding the real nested fixtures made the same parent GREEN.
Removing nested PID namespace creation, PID-1/parent facts, the live release gate, root-without-wait
ordering, or the real exact-empty event causes a defining assertion or barrier to fail.

This closes the missing actual-WSL nested-PID-namespace-live-after-root-exit oracle and is
sufficient for the LEAD to close finding `WSL-R4-M03` and Task `7.6`. It does not close any other
Section 7 row.

## Exact-empty and polling boundary

No quiet-period, elapsed sleep, PID tree, PGID, session, or sampled-empty observation decides
success:

- `wait_until` sleeps only while waiting for explicit ready/release file barriers.
- `wait_for_root_exit` fails if `ExactScopeEmpty` appears before the held descendant is released.
- M02's force result is the exact guardian pidfd completion plus post-control authority inspection
  and FIFO reader disappearance.
- M03's natural result is the guardian's exact kernel child-set `ECHILD` transition and emitted
  `ExactScopeEmpty` frame.

## Fresh build and actual-WSL execution

Environment:

```text
WSL distribution: Ubuntu-24.04
kernel: 5.15.167.4-microsoft-standard-WSL2 x86_64
WSL uid: 1000 (unprivileged)
unshare: util-linux 2.39.3
Windows cross compiler: rustc 1.88.0 (6b00bc388 2025-06-23)
cross target: x86_64-unknown-linux-musl
linker: rust-lld
```

All generated target and temp data were placed on `E:`:

```powershell
$env:CARGO_TARGET_DIR='E:\tmp\rpa-wsl-topology-review-r4\target'
$env:TEMP='E:\tmp\rpa-wsl-topology-review-r4\temp'
$env:TMP='E:\tmp\rpa-wsl-topology-review-r4\temp'
$env:RUSTFLAGS='-C linker=rust-lld'

rustup run 1.88.0 cargo test --locked `
  --manifest-path native/linux-process-authority/Cargo.toml `
  --target x86_64-unknown-linux-musl `
  --test linux_primary_topology_contract --no-run --message-format=json
```

Build result: **PASS**. The exact freshly built artifact was:

```text
ELF 64-bit x86-64 static PIE, executed by WSL
13962776 bytes
a6b36ddda84b5318c0b4dbd7b72ab0daebf5ed7a8469b35a65e4a7fa32a21256
```

Fresh actual-WSL commands and results:

```text
<topology ELF> --exact setsid_double_fork_survives_root_exit_until_exact_guardian_force \
  --nocapture --test-threads=1
  1 passed, 0 failed, 0 ignored, 4 filtered

<topology ELF> --exact nested_pid_namespace_remains_live_after_root_exit_until_release \
  --nocapture --test-threads=1
  1 passed, 0 failed, 0 ignored, 4 filtered

<topology ELF> --nocapture --test-threads=1
  5 passed, 0 failed, 0 ignored, 0 filtered
```

The ELF's `--list` output contains exactly five libtest entries. Exactly two are parent acceptance
oracles. These three selector-only workload entries are plumbing and are excluded from acceptance
counts even though an unselected full run reports them `ok`:

- `setsid_double_fork_resistant_descendant_fixture`
- `nested_pidns_parent_exits_fixture`
- `nested_pidns_descendant_gate_fixture`

Therefore the acceptance claim is **2/2 named parent oracles**, not five independent oracles.

## Review boundaries and durable findings

Pre-Landing Review: **No scoped issues found.** Standards axis: pass. Spec axis: M02 and M03 pass.

1. Close only `WSL-R4-M02` / Task `7.4` and `WSL-R4-M03` / Task `7.6` from this report.
2. Keep `WSL-R4-M00`, `WSL-R4-M01`, `WSL-R4-M04` through `WSL-R4-M06`, Task `7.2`, Task `11.3`,
   installed broker/cgroup-v2 Section 9, package/install, closure, default selection, macOS, and
   ECP-8 claims open unless separately reviewed evidence closes them.
3. The current cross-build emitted out-of-scope broker-path unused-code/import warnings. They do
   not affect either topology verdict and remain owned by the active broker delivery work.
