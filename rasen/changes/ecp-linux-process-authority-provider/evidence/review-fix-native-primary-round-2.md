# Native-primary review fixes — round 2

Date: 2026-08-06

## Scope and boundaries

This pass closes native-primary round-2 findings `NATIVE-B003`, `NATIVE-B004`, and
`NATIVE-M005`. It changes only the primary helper protocol/identity/launch implementation and its
native tests. TypeScript, Cargo dependencies, run state, task checkboxes, and broker semantics were
not changed. `tasks.md` remains read-only at 42/93.

The shared worktree also contained concurrent broker work. A crate-wide rustfmt invocation
mechanically formatted three untracked broker files before that overlap was noticed; no semantic
broker edit was made here, and later verification used the broker owner's completed workspace
state.

## NATIVE-B003 — exact empty survives root-result loss

### RED

- The new protocol oracle mapped
  `event-gap: exact namespace teardown is proven but root result was lost` to `ControlLoss`
  instead of `EventGap`.
- The new production-helper oracle killed the activated guardian and invoked the real helper
  `inspect` CLI. It returned a failure frame and exited unsuccessfully instead of returning the
  independently proven exact-empty fact.

### Fix

- `AuthorityClient::inspect_evidence` is now a public closed result:
  `Events` or `KernelExactEmptyRootResultLost`.
- A kernel-proven teardown after guardian loss is encoded as the backward-compatible journal
  sequence `Prepared -> Activated -> ExactScopeEmpty`. The missing `RootExited` event explicitly
  preserves the root-result gap while frame kind `0x88` preserves exact empty.
- This representation requires no TypeScript payload change: the existing native assembly accepts
  `ExactScopeEmpty` with the same `RPJ1` journal and maps it to `exact-scope-empty`.
- `NativeFailureCode::from_control_error` now recognizes the bounded `event-gap:` diagnostic
  prefix as code 4.

The focused helper forced-death and protocol mapping tests are GREEN. The journal contains no
fabricated root status, the namespace member cannot escape, and an unrelated process remains live.

## NATIVE-B004 — namespace proof gates every pidfd signal

### RED

The actual Linux mutation started an unrelated process, captured its boot/PID/start/namespace
identity, made it nondumpable, changed the expected namespace inode, removed the authentic guardian
endpoint, and called abort through that mutated reference. The old `EACCES => None` handling treated
the pidfd as fully reopened; the fallback killed and reaped the unrelated process, and the oracle
failed with `unverified pidfd control did not fail closed`.

### Fix

- `ReopenedAuthority` now records one of three namespace-proof states: kernel-pinned handle,
  generation-only, or authenticated.
- Proc namespace `EACCES` produces generation-only authority. That state may wait on the pinned
  pidfd and attempt the server-first handshake, but `send_signal` returns
  `native-state-retained` without issuing `pidfd_send_signal`.
- `AuthorityClient::control_on` upgrades generation-only authority only after the authentic
  guardian proves the HMAC challenge. The HMAC binds the complete immutable authority identity,
  including namespace device/inode.
- Missing endpoints, forged challenges, and wrong namespace attestations never upgrade the pidfd.

The exact nondumpable drift/broken-endpoint mutation is GREEN and proves the unrelated process
survives. Existing forged-server, terminal response-loss, resistant descendant, actual-signal, and
guardian-death oracles also remain GREEN.

## NATIVE-M005 — descriptor-pinned interpreter scripts and execute-only ELF

### RED

The reviewer reproduction showed `/usr/bin/which.debianutils` exiting 127: the old
`O_RDONLY|O_CLOEXEC` command fd reached `execveat(AT_EMPTY_PATH)`, where an interpreter script with
a close-on-exec descriptor fails with `ENOENT`. An execute-only local ELF could not even be prepared
because `O_RDONLY` failed.

### Fix

- Commands are pinned with `O_PATH|O_CLOEXEC|O_NOFOLLOW`; direct ELF still uses descriptor-only
  `execveat`, including mode `0111`.
- A separately opened readable descriptor performs bounded 256-byte shebang detection. Shebangs
  require an absolute interpreter; the canonical interpreter object is independently pinned with
  `O_PATH`, identity-checked, and rejected if recursive or if it selects through `env`/PATH.
- Script activation executes the pinned interpreter fd directly and passes the pinned readable
  script as `/proc/self/fd/<fd>`. Only that script fd has close-on-exec cleared for the interpreter
  handoff.
- Script, interpreter, command, and cwd descriptor identities are all revalidated immediately in
  the gated workload child before privilege drop and exec.

Linux oracles prove:

- canonical `/usr/bin/which.debianutils` exits 0 without implicit shell fallback;
- a local `0111` ELF exits 0;
- replacing both script and interpreter pathnames after prepare still executes the two pinned
  original objects and writes the expected marker.

## Verification receipts

Toolchains and runtime:

- Rust/cargo/rustfmt 1.88.0, locked dependencies;
- WSL2 Ubuntu 24.04 on the actual Linux kernel;
- Zig 0.16.0 used only as the isolated GNU host linker/sysroot;
- musl test ELFs linked with the pinned toolchain's `rust-lld`.

Results:

- focused RED/GREEN: helper forced death, event-gap mapping, nondumpable namespace drift with
  broken endpoint, canonical system script, script/interpreter replacement, and execute-only ELF;
- shared-worktree GNU Linux locked serial suite: 85 passed, 0 failed;
- 18 current static-musl test ELFs executed serially on WSL: 85 passed, 0 failed;
- focused primary: 21/21; identity: 3/3; lifecycle: 5/5; protocol: 5/5;
- Windows pinned locked host suite: 52 passed, 0 failed;
- pinned `x86_64-unknown-linux-gnu` all-target check: pass, no warnings;
- pinned rustfmt on the nine task-owned source/test files: pass;
- final pinned whole-crate rustfmt check after concurrent broker work settled: pass.

Final source hashes for the task-owned production files:

```text
primary.rs   330b8c76a344cf44589ab52ed5e0973664791e9f051b15c9c7f34b64d4dd7755
linux.rs     5541526feeda8cd5ee05a492f1cbf5b67d5210a85d3061d072e3489f391d07e5
protocol.rs  d84d86c4390a633f2c8b316ab449b2bd16aa7ad45e9d1742b3fccffdea0c0ca8
lifecycle.rs 1d3102ea6815de86a067f1c7ab060332a9cfec100562ceeae0f0d1d046f5241c
main.rs      d1969c503dac2743fc5894fe1231746644582b4be52b2be19df6eee521f3fdd1
```

Control hashes confirming untouched adjacent primary modules:

```text
runtime.rs 4a9376195ca3e50705a844130091018e3d4d29ba9a551a070b576d63b1e889d7
journal.rs 56ece3ba19409550ac01bcf824442d23f79fd56c8ebb65d94e2a79482b5a7a27
```
