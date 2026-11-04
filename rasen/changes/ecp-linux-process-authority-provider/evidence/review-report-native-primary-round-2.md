# Native Linux primary authority review — round 2

Date: 2026-08-06\
Mode: fresh independent, dispatched/report-only\
Verdict: **FAIL — 3 open findings (2 Blocker, 1 Major; 0 Minor, 0 Trivial)**

## Scope and integrity

This pass re-reviewed only the round-1 native-primary/helper repair and its actual-kernel
oracles:

- `native/linux-process-authority/src/{primary,linux,runtime,authority,protocol,lifecycle,journal,main}.rs`
- the non-broker native primary/identity/journal/runtime/lifecycle/protocol tests
- the Change proposal, design, delta spec, tasks, round-1 review/fix evidence, and native-primary
  implementer/reviewer handoffs

Broker implementation, TypeScript implementation, common-contract code, tasks, run-state,
packaging, production default selection, and unrelated shared-worktree changes were excluded. No
product, test, task, run-state, or broker file was modified. The reviewed fixer hashes remained
exactly those recorded by `review-fix-native-primary-round-1.md`:

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

## Standards axis

### NATIVE-B003 — Blocker — forced guardian death is proven only by the library API, not by the production helper command

**Location:** `native/linux-process-authority/src/primary.rs:118-132`,
`native/linux-process-authority/src/main.rs:117-129`,
`native/linux-process-authority/src/protocol.rs:132-164`,
`native/linux-process-authority/tests/linux_primary_contract.rs:375-422`

The repair added the correct low-level distinction: `AuthorityClient::inspect()` maps
`InspectionEvidence::KernelExactEmpty` to exact empty, while `inspect_events()` returns an error
because the killed guardian cannot supply an exact root status. The actual helper's `inspect`
operation, however, calls only `client.inspect_events()`. It therefore discards the positive
kernel empty proof and returns a Failure frame. The diagnostic is even downgraded from the intended
event gap to control loss because `from_control_error` compares the exact string `event-gap`, while
the emitted error is `event-gap: exact namespace teardown is proven but root result was lost` and
has `NotFound` kind.

A fresh end-to-end WSL helper-CLI oracle prepared and activated `/usr/bin/sleep`, opened the real
runtime bridge, killed the exact outer guardian with `SIGKILL`, and invoked the built helper's
`inspect` command with the authentic attestation:

```text
forced_death_helper_inspect exit=70 kind=0xff payload=000106
```

`000106` is protocol v1 failure code 6 (`native-transport-lost`). Thus the 16/16 direct Rust test
matrix proves kernel teardown inside the library, but the source-owned helper boundary consumed by
the provider cannot report exact empty. Replacement reconciliation can retain the authority
forever after the named owner-death mutation, which is the original NATIVE-B003 failure.

**Minimum fix:** make the closed helper protocol preserve the two independent facts: exact
namespace empty is positively proven, while the root result is lost/event-gap. Do not force both
facts through `inspect_events()`, and do not encode the positive empty proof as only a Failure.
Correct the closed failure mapping as part of that seam. Add an end-to-end helper-command mutation
that kills the guardian, proves unrelated-process survival, and asserts that exact empty reaches
the helper consumer while the unavailable root result remains explicitly non-fabricated.

### NATIVE-B004 — Blocker — normal nondumpable replacement skips PID-namespace identity revalidation

**Location:** `native/linux-process-authority/src/primary.rs:484-485`,
`native/linux-process-authority/src/linux.rs:147-179`,
`native/linux-process-authority/tests/linux_identity_contract.rs:17-52`

The B1 repair makes every guardian nondumpable. Replacement reopen then attempts to open
`/proc/<pid>/ns/pid`, but treats `PermissionDenied` as success with `None`. In that branch it never
compares the live PID-namespace device/inode with the durable reference; only boot id, numeric PID,
and start ticks are reread around `pidfd_open`. A fresh WSL Linux probe confirms this is the normal
nondumpable behavior, not a theoretical fallback:

```text
nondumpable_child_prctl=0 ns_open_errno=13
```

The existing namespace-drift test uses the current, dumpable test process, so it exercises the
strict branch rather than the production guardian branch. Consequently the implementation cannot
prove the complete `(boot, PID, start, PID-namespace dev/inode)` tuple required before inspect or
destructive control. In a PID-reuse/start-tick collision, the newly opened pidfd may identify a
replacement namespace while the required namespace mismatch is ignored; subsequent endpoint loss
can drive the abort/terminate fallback to signal that unproven pidfd. This violates the explicit
identity-drift and unrelated-process-safety contract.

**Minimum fix:** `PermissionDenied` must not count as complete identity success. Supply a
provider-owned, replacement-reopenable way to prove the exact namespace device/inode despite the
nondumpable boundary, or return a retained identity/authority uncertainty and perform no signal.
Add an actual nondumpable-guardian mutation that changes the expected namespace identity, removes
or breaks the endpoint, and proves no destructive signal reaches the live process.

### NATIVE-M005 — Major — fd-pinned activation rejects valid executable scripts

**Location:** `native/linux-process-authority/src/primary.rs:1001-1087`,
`native/linux-process-authority/src/primary.rs:1125-1219`,
`native/linux-process-authority/tests/linux_primary_contract.rs:458-498`

The M2 repair successfully pins rename-replaced ELF executables and cwd objects, but opens the
command fd with `O_CLOEXEC` and launches it through `execveat(..., AT_EMPTY_PATH)`. Linux returns
`ENOENT` for an interpreter script in that combination because the script fd is closed across the
interpreter exec. The protocol/spec accepts an exact canonical regular executable and does not
declare an ELF-only workload restriction.

A fresh actual helper-CLI oracle prepared the canonical regular executable
`/usr/bin/which.debianutils` (mode 0755, POSIX shell script), opened the runtime, activated it with
argument `sh`, and decoded the durable root result:

```text
canonical_script_root_exit=127
```

The same fd-level WSL syscall oracle returned errno 2 (`ENOENT`). This is a plausible production
path for CLI and agent entrypoints, so the TOCTOU repair introduces a significant launch
regression even though the rename/cwd test is green.

**Minimum fix:** preserve descriptor-pinned, no-PATH/no-shell authority while supporting a pinned
interpreter script (or make a separately reviewed explicit ELF-only contract decision). A complete
script path should pin and revalidate both script and interpreter identities and keep only the
minimum descriptor required for interpreter handoff. Add an actual canonical-script activation
oracle; also cover an executable that is not readable if that remains an accepted Linux executable.

Standards result: **3 findings; worst Blocker.**

## Spec axis and round-1 closure ledger

| Round-1 finding | Round-2 status | Closure proof |
|---|---|---|
| NATIVE-B001 endpoint/terminal forgery | **CLOSED for the original chain** | The complete runtime root is overmounted in the workload mount view (`primary.rs:484`, `1298-1322`), the guardian is nondumpable, server-first HMAC proof precedes both capabilities (`primary.rs:625-649`, `1247-1296`), and bound dirfd-relative terminal/journal records require the scope key plus launch and complete recorded identity. Actual WSL `workload_mount_cannot_reach_control_or_durable_state` and forged-server zero-byte pre-auth tests passed. NATIVE-B004 is a distinct replacement-identity regression caused by the nondumpable repair. |
| NATIVE-B002 high inherited FD on `close_range` ENOSYS | **CLOSED** | `ENOSYS` snapshots `/proc/self/fd`, closes the actual non-allowlisted set, and verifies it (`primary.rs:1508-1591`). The seccomp-forced ENOSYS/fd-4096/lowered-RLIMIT actual WSL mutation passed. |
| NATIVE-B003 forced guardian death | **OPEN / REOPENED** | Direct-library kernel teardown and unrelated-process safety pass, but the production helper loses that exact-empty proof and returns `native-transport-lost`; see NATIVE-B003 above. |
| NATIVE-M001 stdin backpressure | **CLOSED** | Root stdin is nonblocking with a bounded 256 KiB queue and poll-driven partial writes (`primary.rs:31`, `776-861`). The non-reading stdin + 1 MiB stdout/stderr + independent termination actual mutation passed. |
| NATIVE-M002 executable/cwd pathname TOCTOU | **CLOSED for rename/path replacement** | Prepare holds command/cwd descriptors, revalidates dev/inode/mode, uses `fchdir` plus `execveat`, and the actual rename/replacement oracle executes the pinned ELF and old cwd. NATIVE-M005 records the newly introduced script regression. |
| NATIVE-M003 abort response loss | **CLOSED** | Terminal durability sets `self.exiting` before best-effort response delivery (`primary.rs:731-751`), and client abort waits for pidfd completion. The read-half-close mutation passed and left no live guardian or workload marker. |
| NATIVE-M004 persisted root numeric domain | **CLOSED** | Decode accepts only code `0..=255`, signal `1..=64`, and XOR (`lifecycle.rs:7-31`, `104-163`). Unit boundaries plus actual SIGTERM recovery passed. |

Regression checks requested by the dispatch:

- `setsid` plus nested PID namespace: actual WSL composite passed.
- explicit resistant `setpgid` orphan, root-exit-before-empty, and pidfd force: actual WSL passed.
- exact signal exit (`SIGTERM`): actual WSL passed.
- forced guardian death and unrelated host process survival: direct-library actual WSL passed, but the
  helper boundary remains blocked by NATIVE-B003.
- boot/start/PID/PID-namespace drift: dumpable-process actual tests passed; the normal nondumpable
  guardian path remains blocked by NATIVE-B004.
- no `killpg`, process-group authority, sampled descendant enumeration, shell launch, or native
  `PUBLISH` transition was found in the reviewed primary source.

Spec result: **2 required primary scenarios remain wrong at the actual helper/replacement boundary;
worst Blocker.**

## Verification receipts

Environment:

```text
WSL distribution: Ubuntu 24.04.1 LTS
Kernel: Linux 5.15.167.4-microsoft-standard-WSL2 x86_64
Pinned Rust/cargo: 1.88.0
```

Successful commands/results:

```text
rustup run stable cargo fmt --manifest-path native/linux-process-authority/Cargo.toml \
  --all -- --check
  Windows installed rustfmt: pass

WSL pinned-1.88 cargo fmt --manifest-path .../native/linux-process-authority/Cargo.toml \
  --all -- --check
  pass

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
  pass; 17 current static-PIE test ELFs emitted

Each of those exact 17 ELFs executed on WSL with --test-threads=1
  66 passed, 0 failed, 0 ignored
  primary: 16/16
  identity: 3/3
```

The 66/66 receipt is **actual WSL-kernel runtime evidence for the exercised mutations**, but its
ELFs were freshly cross-built on Windows; it is not a native-build, package, installed-broker,
distribution, or release claim. Pinned native-in-WSL build evidence remains the previously recorded
round-3 receipt and was not relabelled here.

### Coverage verdict

```text
PRIMARY FIX COVERAGE
  [TESTED] endpoint discovery/connect/unlink/rebind/journal/terminal workload attacks
  [TESTED] forged server receives zero capability bytes before server proof
  [TESTED] close_range ENOSYS + fd 4096 above lowered RLIMIT_NOFILE
  [TESTED] non-reading stdin + full stdout/stderr + independent termination
  [TESTED] executable/cwd rename replacement uses pinned ELF/cwd
  [TESTED] abort response loss leaves no guardian
  [TESTED] setpgid, setsid, nested namespace, signal exit, root/live descendant
  [GAP/BLOCKER] helper inspect loses forced-death exact-empty proof
  [GAP/BLOCKER] nondumpable replacement skips PID-namespace dev/inode proof
  [GAP/MAJOR] canonical executable script exits 127

GATE: FAIL
```

## Retained non-native-primary gates

Even after the three findings above are fixed and freshly re-reviewed, this report does not close
or claim:

- source-owned artifact export/adjacent manifest and authenticated package/install gates;
- the installed broker daemon/cgroup-v2 runtime and Section 9 actual runner;
- common/TypeScript publication crash-window or package assembly gates;
- native ProcessScope/SessionHost closure, production-default switching, or legacy PGID removal;
- general Linux distribution support, macOS strategy, ECP-8 release truth, ship, or archive.
