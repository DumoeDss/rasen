# Native Linux primary authority review — round 1

Date: 2026-08-05\
Mode: fresh independent, dispatched/report-only\
Verdict: **FAIL — 7 findings (3 Blocker, 4 Major; 0 Minor, 0 Trivial)**

## Scope and integrity

Reviewed only the requested primary surface:

- `native/linux-process-authority/src/{primary,linux,runtime,authority,protocol,lifecycle,journal,main}.rs`
- the eight existing non-broker native test/support files
- `design.md`, `specs/linux-process-authority-provider/spec.md`, `tasks.md`
- `implementation-native-primary-1.md` and WSL primary gate rounds 1–2

Concurrent broker files and the Cargo dependency delta were deliberately excluded. No product,
test, task, runstate, or broker file was modified. The reviewed source hashes stayed stable across
the review; notably `primary.rs` was
`873c7d26cc67914aaa3d714470e1f88b369b8bba22db0f5d937a5a7cde33683f` and `runtime.rs`
was `f3f5b95655492a86a6c85dadaf49fe1cbc9a2b26afe614d9bc900ba84ecdc195`.

## Blocker findings

### B1. The workload can replace the control endpoint or terminal record and forge exact-empty

**Location:** `native/linux-process-authority/src/runtime.rs:21-29`,
`native/linux-process-authority/src/primary.rs:117-126`,
`native/linux-process-authority/src/primary.rs:513-534`,
`native/linux-process-authority/src/primary.rs:955-966`,
`native/linux-process-authority/src/primary.rs:970-978`,
`native/linux-process-authority/src/journal.rs:58-80`

**Requirement:** design lines 60–62 and 82 require a private endpoint/state root inaccessible to
the workload; spec lines 49–75 and 141–167 require authentic durable truth and capability-backed
control before exact empty can be reported.

**Failure/exploit chain:**

1. The child maps namespace UID 0 to the invoking EUID. Linux therefore maps workload filesystem
   permission checks back to the same host UID that owns the `0700` runtime/scope directories.
2. `PrivateScope::create` only rejects an ancestor/descendant relationship with the initial cwd;
   the new mount namespace never hides or overmounts the provider runtime root.
3. The guardian shares the host network namespace. The bound pathname is disclosed by
   `/proc/net/unix`, so random scope-id naming does not keep the path secret.
4. The workload has write/search permission on the same-UID scope directory. It can unlink
   `control.sock`, bind its own same-UID `0600` socket, and pass `validate_control_socket`.
5. The replacement endpoint receives both capabilities in the first request and can reply with a
   syntactically valid `Observation` containing `Prepared -> ExactScopeEmpty`; `inspect_events`
   accepts that while the real guardian/workload is still live. It can also impersonate
   `RuntimeReady`/`Activated` and capture runtime traffic.
6. An even shorter path is to create a valid `terminal.bin`, unlink the real socket, and let
   `inspect_events` fall back to `read_terminal_events`. Terminal recovery checks only same UID,
   mode, size, and event grammar; it neither authenticates/binds the record to the exact scope nor
   requires the revalidated guardian pidfd to have completed. The common layer can therefore
   release a live scope and leave runaway descendants.

Linux's documented mechanics support this chain: pathname sockets use directory/socket
permissions, `/proc/net/unix` exposes the bound path, and a user-namespace process's mapped ID is
used for file permission checks:
[unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html),
[proc_pid_net(5)](https://man7.org/linux/man-pages/man5/proc_pid_net.5.html), and
[user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html).

**Minimum fix:** make the whole control/journal state unreachable in the workload's mount view,
not merely outside its cwd. Bind/open the endpoint and a trusted state dirfd before clone, hide the
runtime tree inside the child mount namespace, make the guardian nondumpable, and use dirfd-relative
`openat2`/`renameat` operations with no-follow/beneath constraints. Add server-first authentication
that proves an independent guardian secret before the client transmits control capabilities, bind
terminal records to scope/generation/identity/launch, and require pidfd completion or the specified
same-boot absence oracle before terminal exact-empty is accepted. Add an actual workload mutation
that discovers `/proc/net/unix`, attempts connect/unlink/rebind/journal replacement, and must fail.

### B2. The `close_range` ENOSYS fallback can pass arbitrary inherited descriptors into workload exec

**Location:** `native/linux-process-authority/src/primary.rs:1080-1113`,
`native/linux-process-authority/src/primary.rs:827-920`

**Requirement:** design lines 60–62 and task 4.4 require transfer of only the minimum intended
descriptors and closure of every unintended inherited descriptor before workload code.

**Failure/exploit chain:**

1. On kernels before Linux 5.9, `close_range` returns `ENOSYS`; pidfd-capable Linux 5.4 is therefore
   a plausible primary-provider host.
2. The fallback closes only through `_SC_OPEN_MAX`. A launcher can open a non-CLOEXEC descriptor at
   a high number and then lower `RLIMIT_NOFILE`; lowering the limit does not close the existing high
   descriptor.
3. Both guardian setup and the root pre-exec path use this fallback. The high descriptor survives
   both passes and `execve`, exposing an unrelated host file/socket/capability directly to untrusted
   workload code. The implementation nevertheless reports prepared/activated success.

The Linux manual documents `close_range` as Linux 5.9 and recommends enumerating
`/proc/self/fd` when the syscall is unavailable:
[close_range(2)](https://man7.org/linux/man-pages/man2/close_range.2.html).

**Minimum fix:** fail availability closed on `ENOSYS`, or enumerate and close the actual fd set via
the already-correct `/proc/self/fd` while preserving only an exact allowlist; then verify the final
set. Add an ENOSYS/high-fd/lowered-rlimit actual mutation proving a secret non-CLOEXEC fd is absent
from both guardian and workload.

### B3. Forced guardian death has no positive teardown recovery path, and Section 7 is still open

**Location:** `native/linux-process-authority/src/primary.rs:117-126`,
`native/linux-process-authority/src/primary.rs:185-210`,
`native/linux-process-authority/src/linux.rs:103-127`,
`rasen/changes/ecp-linux-process-authority-provider/tasks.md:49-50`,
`rasen/changes/ecp-linux-process-authority-provider/tasks.md:69-78`,
`rasen/changes/ecp-linux-process-authority-provider/evidence/wsl-primary-gate-round-2.md:29-32`

**Requirement:** spec lines 95–117 and design lines 88–94 require exact kernel/identity teardown
classification for unexpected PID-namespace-init death, while retaining uncertainty only when that
proof cannot complete. Section 7 requires dedicated actual-kernel mutations before acceptance.

**Failure chain:**

1. `control` can open and revalidate the exact pidfd, but any subsequent endpoint failure drops that
   handle when it returns `Err`.
2. If PID 1 is forcibly killed before `commit_terminal`, replacement `inspect_events` either cannot
   reopen the now-absent PID or finds no terminal. It returns transport/not-found indefinitely even
   though Linux PID-namespace-init teardown has killed every namespace member and the authentic
   same-boot reference supplies the specified absence proof inputs.
3. There is no implementation of the expected-absence/no-conflicting-identity teardown oracle, so
   reconciliation cannot converge and the authority leaks permanently.
4. The existing WSL round-2 evidence explicitly leaves forced guardian death/unrelated-process
   survival, explicit `setpgid`, complete boot/PID/namespace drift, exact signal exit, publication
   crash-window replacement, and native-in-WSL locked build open. The composite test cannot stand
   in for those named oracles, so the mandatory actual primary gate remains failing/open.

**Minimum fix:** preserve the revalidated pidfd across endpoint failure and implement the exact
same-boot absent-versus-reused guardian decision required by the design, including root-result loss
classification without fabricating it. Then run dedicated serial WSL mutations for every item named
above, with forced guardian death proving pidfd completion, exact teardown, and unrelated-process
survival. Keep Section 7 and the Change non-terminal until those receipts are green.

## Major findings

### M1. Blocking stdin relay can freeze reaping and every control operation

**Location:** `native/linux-process-authority/src/primary.rs:450-509`,
`native/linux-process-authority/src/primary.rs:650-680`,
`native/linux-process-authority/src/primary.rs:1116-1122`

**Failure chain:** workload stdin is a blocking pipe. If the workload does not read and the runtime
sends more than pipe capacity, `stdin.write_all` blocks the guardian's only event-loop thread. The
same thread can no longer drain stdout/stderr, reap PID 1 children, accept inspect/abort/terminate,
or reach `ECHILD`. New terminate calls connect and then time out; `WouldBlock` is not an absence
fallback, so the exact pidfd force path is never reached. A non-reading workload plus normal streamed
input can therefore retain an authority forever.

**Minimum fix:** make root stdin nonblocking, maintain a fixed bounded pending-input queue, poll
`POLLOUT`, define deterministic backpressure/close behavior, and keep control/reap processing
independent of runtime I/O. Add an actual test with a non-reading root, more than pipe capacity of
input, simultaneous full stdout/stderr, and a terminate that must still converge.

### M2. Prepare validates launch pathnames but activation executes whatever occupies them later

**Location:** `native/linux-process-authority/src/protocol.rs:280-315`,
`native/linux-process-authority/src/primary.rs:247-266`,
`native/linux-process-authority/src/primary.rs:827-897`,
`native/linux-process-authority/src/primary.rs:930-952`

**Failure chain:** prepare canonicalizes/checks command and cwd once, while the launch digest binds
only the pathname/args/env bytes. After durable publication but before activation, a concurrent
same-user rename can replace the executable or cwd with another canonical object. The gate later
uses pathname `chdir` and `execve` without revalidation, so code/state not represented by the
prepared launch snapshot executes inside an otherwise authentic authority.

**Minimum fix:** open and attest exact executable and cwd descriptors during prepare, retain only
those intended descriptors, revalidate their stable identity immediately before release, then use
`fchdir` plus `execveat`/`fexecve` rather than resolving the path again. Add rename/symlink/inode
replacement mutations between prepare and activate. Linux documents O_PATH/fd-based execution in
[open(2)](https://man7.org/linux/man-pages/man2/openat.2.html).

### M3. An abort response write failure leaves a terminal exact-empty guardian that can never exit

**Location:** `native/linux-process-authority/src/primary.rs:130-156`,
`native/linux-process-authority/src/primary.rs:513-534`,
`native/linux-process-authority/src/primary.rs:614-626`

**Failure chain:** abort advances the machine, fsyncs the journal and terminal, then writes the
response; `self.exiting = true` is set only after that fallible write. If the caller dies/half-closes
after sending abort, `write_frame` can fail. `accept_control` sends a best-effort failure and resumes
the event loop with the machine already at exact-empty but `exiting == false`. Repeated abort is
rejected as out of order, terminate has no root, and the guardian becomes immortal. A replacement
also accepts the terminal shortcut at lines 133–140 without waiting for pidfd completion, so common
cleanup can report success while leaking PID 1.

**Minimum fix:** make the post-terminal exit decision non-fallible and independent of response
delivery; close the listener/set exiting before best-effort response delivery. Terminal-shortcut
abort must still wait for exact guardian pidfd completion. Add a crash/half-close mutation at each
terminal commit/response boundary and prove no live guardian remains.

### M4. Durable root status accepts impossible Linux code/signal values as exact truth

**Location:** `native/linux-process-authority/src/lifecycle.rs:15-24`,
`native/linux-process-authority/src/lifecycle.rs:98-155`

**Failure chain:** `RootExit::try_from_parts` accepts every nonnegative `i32` as an exit code and
every positive `i32` as a signal. A structurally valid but corrupt terminal can therefore claim code
`2147483647` or signal `1000000`; journal decode treats it as authentic exact root truth instead of
`event-gap`/`control-loss`. Actual `waitpid` emission is narrower, but recovery is precisely where
closed validation must reject impossible persisted states.

**Minimum fix:** bound decoded exit code to the Linux wait-status domain and signal to the supported
Linux signal range, while retaining XOR enforcement. Add boundary mutations for 255/256, zero
signal, maximum real-time signal, and one-past-maximum.

## Verified primary invariants (no finding in the reviewed code)

| Area | Evidence |
|---|---|
| clone/map ordering | Child blocks on `M`; parent writes `setgroups=deny`, exact UID/GID maps, then releases it (`primary.rs:306-343`, `970-997`). |
| private mount/proc | Recursive `MS_PRIVATE` precedes a new proc mount; child verifies `/proc/self` and `/proc/1` are the same PID namespace and self is PID 1 (`primary.rs:1000-1043`). |
| live pidfd TOCTOU | Reopen compares boot/start/ns before and after pidfd + namespace-handle open and signals only the pidfd (`linux.rs:103-127`). The absent/death path is B3. |
| normal PID 1 reaping | `waitpid(-1, WNOHANG)` records root status separately and publishes empty only after `ECHILD` (`primary.rs:722-767`). |
| normal journal ordering | Each event and terminal copy uses temp-write, file fsync, rename, and parent-dir fsync (`journal.rs:84-129`). Authenticity/recovery exposure is B1. |
| root status XOR | The in-memory/event grammar enforces exactly one code-or-signal branch; persisted numeric domain validation is M4. |
| ordinary partial prepare cleanup | Post-clone construction failures kill/reap the direct child before deleting its fresh scope (`primary.rs:324-355`). Abort transport cleanup is M3. |

## Verification receipts and coverage verdict

- `rustup run stable rustfmt --edition 2021 --check` on the eight exact reviewed source files:
  **pass**.
- Fresh WSL2 kernel identity: Linux `5.15.167.4-microsoft-standard-WSL2`, Ubuntu 24.04 distro.
- A fresh isolated WSL `cargo test --locked --target x86_64-unknown-linux-musl --
  --test-threads=1` did **not** reach tests because the native host linker `cc` is still absent.
  No new green runtime claim is made. The concurrent Cargo/broker dependency surface observed by
  that command was not reviewed or used for findings.
- Existing round-2 evidence remains 23/23 for its composite oracle, but its own line 32 correctly
  records the still-open Section 7 cases. Those gaps are acceptance-blocking, not silently credited.

### Coverage summary

```text
PRIMARY PATH COVERAGE
  [TESTED] user+PID+mount prepare, uid/gid maps, proc, pidfd, inert abort
  [TESTED] normal code-0 root exit -> ECHILD -> terminal empty
  [TESTED] setsid + nested PID namespace descendant in one composite fixture
  [GAP/B1] workload endpoint/path/journal attack and capability-exfiltration mutation
  [GAP/B2] close_range ENOSYS + inherited high-fd mutation
  [GAP/B3] guardian SIGKILL + unrelated-process survival + replacement recovery
  [GAP/B3] explicit setpgid, complete identity drift, actual signal exit, publish crash windows
  [GAP/M1] stdin backpressure with concurrent output/control/termination
  [GAP/M2] command/cwd replacement between prepare and activation
  [GAP/M3] abort caller death at terminal/response crash points
  [GAP/M4] impossible persisted code/signal bounds

GATE: FAIL
```
