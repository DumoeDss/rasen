# Native Linux primary authority review — round 3

Date: 2026-08-06\
Mode: fresh independent, dispatched/report-only\
Verdict: **FAIL — 1 open finding (1 Blocker, 0 Major, 0 Minor, 0 Trivial)**

## Scope and integrity

This delta pass re-reviewed only the round-2 native-primary repairs for `NATIVE-B003`,
`NATIVE-B004`, and `NATIVE-M005`, their native tests, and the exact helper/WSL gates needed to
verify those repairs. Broker semantics, TypeScript implementation changes, common-contract code,
tasks, run-state, packaging, production default selection, and unrelated shared-worktree changes
were excluded. No product, test, task, run-state, commit, or broker file was modified.

Reviewed production hashes:

```text
primary.rs   330b8c76a344cf44589ab52ed5e0973664791e9f051b15c9c7f34b64d4dd7755
linux.rs     5541526feeda8cd5ee05a492f1cbf5b67d5210a85d3061d072e3489f391d07e5
protocol.rs  d84d86c4390a633f2c8b316ab449b2bd16aa7ad45e9d1742b3fccffdea0c0ca8
lifecycle.rs 1d3102ea6815de86a067f1c7ab060332a9cfec100562ceeae0f0d1d046f5241c
main.rs      d1969c503dac2743fc5894fe1231746644582b4be52b2be19df6eee521f3fdd1
runtime.rs   4a9376195ca3e50705a844130091018e3d4d29ba9a551a070b576d63b1e889d7
journal.rs   56ece3ba19409550ac01bcf824442d23f79fd56c8ebb65d94e2a79482b5a7a27
```

## Standards axis

### NATIVE-B005 — Blocker — the new helper-CLI oracle embeds a Windows-only helper path in a Linux test ELF

**Location:** `native/linux-process-authority/tests/linux_primary_contract.rs:416-425`

The forced-death test starts the production helper with
`Command::new(env!("CARGO_BIN_EXE_rasen-linux-process-authority"))`. During the required fresh
Windows-to-musl build, Cargo expands that macro to the Windows absolute path
`E:\review-native-primary-round-3-fresh\x86_64-unknown-linux-musl\debug\rasen-linux-process-authority`.
The resulting static Linux test ELF then runs on WSL, where that string is neither a Linux path nor
an executable discoverable through ordinary `PATH` lookup. The helper spawn fails with `ENOENT` at
line 425 before the oracle can inspect the guardian.

A fresh, unmodified execution of all 18 exact cross-built musl test ELFs on the actual WSL kernel
therefore produced:

```text
linux_primary_contract:
  guardian_forced_death_proves_teardown_without_fabricating_root_status ... FAILED
  called Result::unwrap() on Err: code 2, NotFound, "No such file or directory"

exact 18-ELF matrix:
  84 passed, 1 failed, 0 ignored
```

This is a test/evidence portability defect, not a reproduced product failure. As a control, a
temporary `PATH` alias mapped that exact embedded filename to the exact freshly built helper ELF;
the otherwise unchanged focused test then passed 1/1 on WSL. The alias was removed after the run.
It proves the helper behavior behind `NATIVE-B003`, but it cannot convert the unmodified 84/85 gate
into the claimed 85/85 receipt.

**Required fix:** resolve the sibling helper at test runtime from the current Linux test
executable/target layout, or accept one explicit validated runtime helper path for cross-built
oracles. Do not use the build-host absolute `CARGO_BIN_EXE_*` value as the runtime path inside a
foreign-target ELF. Rebuild in a fresh target and rerun all 18 exact ELFs without a compatibility
alias.

Standards result: **1 finding; worst Blocker.**

## Spec axis and round-2 closure ledger

| Finding | Round-3 status | Closure proof |
|---|---|---|
| `NATIVE-B003` forced guardian death lost at helper boundary | **CLOSED at the product boundary** | `AuthorityClient::inspect_evidence()` preserves kernel-proven empty independently from the missing root result (`primary.rs:138-170`, `280-307`). The helper emits `ExactScopeEmpty` kind `0x88` (`main.rs:119-135`) with RPJ1 event kinds `Prepared, Activated, ExactScopeEmpty` (`1,2,4`; sequence fields `1,2,3`) and no fabricated `RootExited`. `event-gap:` diagnostics map to failure code 4 (`protocol.rs:132-142`). The actual WSL focused helper-CLI control passed after correcting only executable discovery externally. |
| `NATIVE-B004` nondumpable replacement skipped namespace proof | **CLOSED** | `ReopenedAuthority` retains `GenerationOnly` when the namespace fd is inaccessible and `send_signal()` rejects that state (`linux.rs:13-61`, `165-201`). `control_on()` upgrades it only after the server-first HMAC challenge authenticates the full attested identity (`primary.rs:228-254`, `1484-1532`). Every signal site is dominated by kernel proof or this authenticated upgrade; endpoint/connect/challenge failures cannot authorize a signal. The actual nondumpable namespace-drift/broken-endpoint mutation passed and preserved the unrelated process. |
| `NATIVE-M005` pinned activation rejected scripts | **CLOSED** | Command and interpreter objects use `O_PATH|O_CLOEXEC|O_NOFOLLOW`; a separate readable script fd is the only launch descriptor whose CLOEXEC bit is cleared (`primary.rs:1047-1157`, `1266-1457`). Interpreter identity is canonicalized, pinned, and revalidated; recursive shebangs and `env`/PATH selection are rejected. Actual WSL tests passed for `/usr/bin/which.debianutils`, simultaneous script/interpreter pathname replacement, and a mode-0111 ELF. |

The lifecycle relaxation is bounded: codec validation accepts
`Prepared -> Activated -> ExactScopeEmpty` only as a closed terminal journal representation for
kernel teardown with root-result loss, while normal `GuardianMachine::descendants_empty()` still
requires a preceding exact `RootExited` event (`lifecycle.rs:83-94`, `218-248`, `328-338`). Prepared
abort remains the distinct `Prepared -> ExactScopeEmpty` path. No normal root-exit/natural-empty
semantic regression was found.

Spec result: **the three round-2 product requirements are implemented correctly; the mandatory
unmodified cross-built actual-kernel evidence gate remains open because of `NATIVE-B005`.**

## Verification receipts

Environment:

```text
WSL distribution: Ubuntu 24.04.1 LTS
Kernel: Linux 5.15.167.4-microsoft-standard-WSL2 x86_64
Rust/cargo: 1.88.0
```

Successful checks:

```text
rustup run stable cargo fmt --manifest-path native/linux-process-authority/Cargo.toml \
  --all -- --check
  pass (rustfmt from Rust 1.88 stable)

WSL pinned-1.88 cargo fmt --manifest-path native/linux-process-authority/Cargo.toml \
  --all -- --check
  pass

rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml
  Windows host: 52 passed, 0 failed

rustup run 1.88.0 cargo check --locked --all-targets \
  --target x86_64-unknown-linux-gnu \
  --manifest-path native/linux-process-authority/Cargo.toml
  pass, no warnings (Windows cross-check; non-runtime evidence)

RUSTFLAGS='-C linker=rust-lld' rustup run 1.88.0 cargo test --locked \
  --target x86_64-unknown-linux-musl --no-run \
  --manifest-path native/linux-process-authority/Cargo.toml
  pass from a fresh target; 18 test ELFs emitted
```

Actual WSL-kernel execution of those Windows-cross-built ELFs:

```text
18 exact static-musl test ELFs, serial --test-threads=1
84 passed, 1 failed, 0 ignored
primary: 20/21 (only NATIVE-B005 path lookup failed)
identity: 3/3
lifecycle: 5/5
protocol: 5/5
```

The ELFs were freshly cross-built on Windows but actually executed as Linux processes on the WSL
kernel. This is actual-kernel evidence for the reached mutations, not native-in-WSL build,
package/install, general-distribution, broker/cgroup-v2, or release evidence.

Focused control using the exact helper ELF with only the foreign build-host name mapped through a
temporary `PATH` entry:

```text
guardian_forced_death_proves_teardown_without_fabricating_root_status
  1 passed, 0 failed, 20 filtered out
```

The other new product mutations all executed in the unmodified primary binary and passed before
the final suite verdict: nondumpable drift/broken endpoint, canonical system script,
script/interpreter replacement, and execute-only ELF.

### Coverage diagram

```text
ROUND-2 DELTA COVERAGE
  [★★★ TESTED] forced guardian death -> helper 0x88 exact empty, no root status
  [★★★ TESTED] nondumpable namespace drift + broken endpoint -> no unrelated signal
  [★★★ TESTED] canonical interpreter script -> root exit 0
  [★★★ TESTED] script + interpreter pathname replacement -> pinned originals run
  [★★★ TESTED] mode-0111 ELF -> descriptor-only launch exits 0
  [★★★ TESTED] normal root exit remains distinct from later natural exact empty
  [GAP/BLOCKER] unmodified cross-built helper-CLI test cannot locate its helper on WSL

PRODUCT PATHS: 6/6 covered
MANDATORY UNMODIFIED EVIDENCE MATRIX: 84/85 tests green
GATE: FAIL
```

## Durable findings and retained gates

- Route `NATIVE-B005` to a non-author test fixer, then require a fresh, unmodified 18-ELF WSL
  rerun and a new non-author delta review.
- Do not reopen `NATIVE-B003`, `NATIVE-B004`, or `NATIVE-M005` unless the fixer changes their
  product seams; their current product behavior is closed by this pass.
- This report does not close or claim installed broker/cgroup-v2 runtime, package/install matrix,
  native ProcessScope/SessionHost integration, production-default switching, legacy PGID removal,
  general Linux distribution support, macOS strategy, ECP-8 release truth, ship, or archive.
