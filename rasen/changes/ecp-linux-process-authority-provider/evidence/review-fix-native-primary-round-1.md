# Native Linux primary authority review fix — round 1

- Date: 2026-08-06
- Source review: `review-report-native-primary-round-1.md`
- Review result addressed: 3 Blocker, 4 Major
- Repair verdict: **PASS for the seven native-primary findings; broader Change gates remain open**

## Scope and interrupted-state audit

This repair stayed inside the assigned native-primary surface:

- `native/linux-process-authority/src/{primary,linux,runtime,authority,protocol,lifecycle,journal,main}.rs`
- the existing non-broker native tests and `tests/support/mod.rs`
- this evidence file and `handoff/implementer-native-primary-1.md`

No broker-owned source, Cargo dependency, TypeScript, task, run-state, production default,
legacy ProcessCapsule, packaging, Direction, or release file was edited by this repair.

The interrupted worktree could not be treated as complete. The original review hashes had changed
and partial implementations of server-first authentication, bound durable records, nonblocking
stdin, fd-pinned launch, and same-boot absence recovery were already present. Windows host tests
and Linux cross-check compiled, but the required finding-specific actual mutations were absent.
The first new serial WSL run produced six failures, proving the interrupted state still contained
real implementation and fixture defects.

## Finding closure

### B1 — workload control/journal forgery: closed

- The listener and trusted scope dirfd are opened before clone. After journal creation, the
  guardian overmounts the complete runtime root with an inaccessible private tmpfs before
  readiness, becomes nondumpable, and gives the workload zero capabilities in the authority user
  namespace.
- The guardian sends a fresh server-first nonce plus keyed authentication before the client sends
  either capability. A forged same-uid pathname server receives zero request bytes before proof
  and cannot produce the keyed challenge.
- Journal and terminal records are dirfd-relative, no-follow, atomic/fsynced, and authenticated over
  scope id, scope capability, launch digest, and complete boot/PID/start/PID-namespace identity.
- Live terminal recovery is accepted only after the already-revalidated guardian pidfd completes.
  Same-boot absence distinguishes a gone authority from a live reused PID. A missing terminal may
  prove namespace empty, but `inspect_events` returns `event-gap` rather than inventing root status.
- Actual workload mutation `workload_mount_cannot_reach_control_or_durable_state` discovers the
  pathname through `/proc/net/unix` and fails every connect, unlink, rebind, journal-write, and
  terminal-write attempt while the authentic scope completes normally.

### B2 — `close_range` ENOSYS/high-FD escape: closed

- Exact descriptor closure uses `close_range` when available. `ENOSYS` switches to a snapshot of
  the actual `/proc/self/fd` set, closes everything outside the exact allowlist, and verifies both
  allowlist presence and unintended-fd absence.
- The actual mutation installs a seccomp filter that returns `ENOSYS` only for `close_range`, opens
  non-CLOEXEC fd 4096, lowers `RLIMIT_NOFILE` to 64, and proves successful guardian preparation plus
  `EBADF` inside the executed workload. The direct fallback unit mutation covers the same
  high-fd/lowered-limit boundary.

### B3 — forced guardian death recovery: closed for the native finding

- Inspect retains the revalidated `ReopenedAuthority`/pidfd across endpoint loss, waits for positive
  pidfd completion, reaps its child when applicable, and then evaluates the authenticated terminal
  or same-boot absence oracle.
- Unexpected PID-namespace-init death returns exact namespace empty only from that kernel/identity
  proof. If the guardian could not durably record root status, event inspection returns `event-gap`;
  it never fabricates a code or signal.
- `guardian_forced_death_proves_teardown_without_fabricating_root_status` kills the live guardian
  with `SIGKILL`, proves the workload marker stays absent, proves an unrelated host process remains
  alive, observes exact empty, then observes same-boot absence and root-result loss.
- The actual matrix also covers explicit `setpgid()` with a resistant orphan descendant,
  root-exited-before-empty, exact pidfd force, actual signal exit, and boot/start/PID-namespace/PID
  replacement drift without targeting the unrelated replacement.

Publication-ledger acknowledgement/activation crash windows remain a TypeScript durable-ledger
gate; they are not relabelled as native evidence here. This keeps the broader Section 7/Change
status non-terminal without leaving the B3 native owner-death defect unfixed.

### M1 — blocking stdin stalls control: closed

- Root stdin is nonblocking. The guardian owns a fixed 256 KiB pending queue, polls `POLLOUT`,
  handles partial writes, and applies deterministic fail-closed input/runtime closure at the bound.
- `bounded_nonblocking_stdin_cannot_freeze_output_reaping_or_terminate` combines a non-reading root,
  more than pipe capacity of input, simultaneous 1 MiB stdout and stderr streams, and an independent
  terminate that must converge within its bound.

### M2 — executable/cwd replacement after prepare: closed

- Prepare opens exact executable and cwd descriptors, records device/inode/mode, and revalidates the
  held objects before release.
- Root launch uses `fchdir` and `execveat(AT_EMPTY_PATH)` on those descriptors after the activation
  gate; it does not resolve the mutable path again.
- The actual mutation replaces both pathname inodes between prepare and activate. The pinned old
  shell executes in the pinned old cwd and reads the old sentinel; the replacements are ignored.

### M3 — abort response loss leaks terminal guardian: closed

- Inert abort appends/fsyncs terminal state and sets the guardian exit decision before best-effort
  response delivery. Response failure cannot restore the event loop.
- Client abort still waits for exact guardian pidfd completion before returning.
- The actual mutation sends authenticated abort, shuts down the caller read half before response,
  proves pidfd completion and same-boot absence, then repeats abort idempotently with no workload
  marker and no live guardian.

### M4 — impossible durable code/signal values: closed

- Durable exit code is limited to `0..=255`; signal is limited to `1..=64`, with code XOR signal
  retained.
- Unit boundaries cover code 255/256 and signal 0/64/65. The actual WSL mutation proves a real
  `SIGTERM` root result survives journal/terminal recovery as signal 15.

## TDD repair trace

The regression work proceeded as vertical actual-kernel slices:

1. The first WSL primary run was RED: 8 passed, 6 failed. It exposed an upper capability-word
   `capset` bug causing pre-exec code 126, a forced-death zombie/reap gap, and two test-fixture setup
   errors (high-fd soft limit and a noncanonical shell path).
2. The next run was RED: 12 passed, 2 failed. All finding-specific paths except the pre-existing
   nested namespace oracle and canonical signal fixture were green.
3. The next run was RED: 13 passed, 1 failed. The remaining nested mapping attempted to map parent
   UID 0, which Linux 5.15 correctly requires `CAP_SETFCAP` for. Retaining that capability would
   weaken B1, so the workload was reduced to zero capabilities and the oracle switched to an
   unmapped unprivileged nested user/PID namespace with inherited-pipe proof.
4. The primary matrix became GREEN at 14/14. The complete ELF matrix then found one stale duplicate
   high-fd unit fixture, which was fixed by raising its soft limit before `dup2`.
5. Explicit `setpgid` and complete identity-drift mutations were added, then the final primary and
   identity matrices passed 16/16 and 3/3 respectively. The complete current ELF matrix passed
   66/66.

## Verification receipts

Environment:

- Windows pinned toolchain: cargo/rustc 1.88.0.
- WSL distribution: Ubuntu 24.04.1 LTS.
- Actual runtime kernel: `Linux 5.15.167.4-microsoft-standard-WSL2 x86_64 GNU/Linux`.
- Primary test ELF: x86-64 static PIE, musl cross-built with pinned Rust 1.88 and `rust-lld`, then
  executed as a Linux process on the WSL kernel.
- Final primary ELF SHA-256: `5e2dba6d8f3bd2ea9efc997762f77b4705a2dceb3cadcc2abc99850115bbc47d`.

Commands and results:

```text
RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2 \
CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2 \
cargo fmt --manifest-path native/linux-process-authority/Cargo.toml --all -- --check
  pinned rustfmt 1.8.0-stable from Rust 1.88.0: pass

rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml
  Windows host: 40 passed, 0 failed

rustup run 1.88.0 cargo check --locked --all-targets \
  --target x86_64-unknown-linux-gnu \
  --manifest-path native/linux-process-authority/Cargo.toml
  pass, no warnings

RUSTFLAGS='-C linker=rust-lld' rustup run 1.88.0 cargo test --locked \
  --target x86_64-unknown-linux-musl --no-run \
  --manifest-path native/linux-process-authority/Cargo.toml
  pass; 17 current test ELFs emitted

Each emitted ELF executed under WSL with --test-threads=1
  66 passed, 0 failed, 0 ignored
  primary: 16/16
  identity: 3/3
  journal: 1/1
  runtime: 3/3
  lifecycle: 5/5
  protocol: 5/5
  authority: 4/4
  lib/main and concurrent broker targets: 29/29
```

Static primary-source search found no `killpg`, process-group authority, `/proc/.../task`
descendant enumeration, shell launch, or native `PUBLISH` transition.

## Final source identity

```text
primary.rs   8a319ecfe1bfbeadfa8d1c72d4a9324c94a1c7b351706fbd42d1b8b04bb4ee9b
linux.rs     299d1f00f619842b4dfebdf6267ebf4ad952a7999543667f8ce1bfba09cac991
runtime.rs   4a9376195ca3e50705a844130091018e3d4d29ba9a551a070b576d63b1e889d7
authority.rs c9ba0664116264a51b4f10f6abc511cc7b568af691014e72156736d987ec4d6b
protocol.rs  f3f373f1ccb1d715962de5327ed6733690cb9140f88a2cb3d60776cd257f8ec0
lifecycle.rs df05dc05571877697da2cfb226f063f6a918df498838561766c772e1b8b0451f
journal.rs   56ece3ba19409550ac01bcf824442d23f79fd56c8ebb65d94e2a79482b5a7a27
main.rs      396d50cb8bfeff0387cdeda4c1ed765e2589481417de378c4f0dc510290440a3
```

The test hashes are recorded in the updated implementer handoff after the final test-only coverage
addition.

## Retained non-terminal gates

This repair does not close or claim:

- TypeScript durable publication commit-before-ack/ack-before-activate actual crash-window closure;
- source-owned artifact manifest/export and authenticated package/install gates;
- a real installed authenticated broker with writable cgroup v2 and its Section 9 matrix;
- general Linux distribution support, closure integration/default switching, ECP-8 release truth,
  local ship, or archive.

No task checkbox was changed. The Change remains non-terminal.
