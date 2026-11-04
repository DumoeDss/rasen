# Native Linux primary authority implementation evidence 1

Date: 2026-08-05

## Boundary and result

This work unit adds only the independent `native/linux-process-authority` crate and this
named evidence/handoff pair. It does not modify the legacy ProcessCapsule, TypeScript
adapter, common suite, publication ledger, broker/install assets, build/package/release
assembly, defaults, macOS, Windows, Direction, portfolio, or Change task checkboxes.

The implemented native primary path now has:

- a source-owned Rust 1.88 crate, committed lockfile, exact `libc = 0.2.174` and
  `sha2 = 0.10.9`, dependency checksums, license accounting, Linux helper binary, and
  crate-local `/target/` exclusion;
- closed `RPA1` protocol v1 frames, provider-reference v1, bounded prepare/launch/control
  codecs, exact code-XOR-signal status, monotonic `RPJ1` journal v1, and fixed native
  failure codes;
- a native-owned random `scope_id[16]` (the common/provider generation), independent
  `scope_capability[32]` and `control_capability[32]`, constant-time guardian validation
  of both capabilities, and no independent duplicate generation field;
- native SHA-256 of the exact running `/proc/self/exe`, comparison with the expected
  adjacent artifact digest, a distinct source digest field, and a native canonical launch
  digest;
- a provider-owned 0700 runtime/scope directory, bounded derived 0600 Unix socket,
  symlink/owner/type/canonical-path checks, and cleanup of every pre-clone/clone/handshake
  failure owned by this helper;
- real `CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNS`, `setgroups=deny`, one caller uid/gid
  mapping, recursive-private mount propagation, a new namespace-correct proc mount, and a
  ready guardian that proves PID 1 from the inside before prepare returns;
- outer boot/PID/start-ticks/PID-namespace device+inode attestation, pidfd open/signal-0/
  poll proof, post-open complete identity revalidation, and child-view comparison before
  returning prepared-inert; the private parent/guardian bootstrap uses its own closed `RBI1`
  identity codec rather than fabricating a full prepared attestation;
- strict descriptor closure, `/dev/null` guardian stdio, a still-closed root activation
  gate, no shell/PATH lookup, canonical absolute executable/cwd validation, exact `execve`,
  and separate framed stdin/stdout/stderr runtime relay;
- exactly-once activation, PID-namespace-init `waitpid(-1, WNOHANG)` reaping, exact root
  status before a separate `ECHILD` empty proof, fsynced atomic journal/terminal ordering,
  output drain before terminal empty, and no native Published/PUBLISH transition;
- replacement inspect, inert abort, graceful root terminate followed by exact guardian
  `pidfd_send_signal(SIGKILL)` after the grace bound, pidfd wait/reap, terminal recovery,
  and no `/proc` descendant walk, PID tree, process group, `killpg`, or individual
  descendant signalling;
- executable helper commands `prepare`, persistent `open-runtime`, `activate`, `inspect`,
  `abort`, and `terminate`. Sensitive attestation bytes travel only in stdin RPA1 frames;
  only the trusted runtime root and non-secret digest/duration arguments use argv.

## Change task coverage

These are implementation references, not global checkbox claims in the shared Change:

- 3.1: native primary crate/lock/dependency/license/helper portion only. The broker binary
  and its Ed25519 dependency remain another work unit.
- 3.2-3.4: native helper protocol, launch snapshot decoder/digest, and private runtime
  derivation implemented.
- 4.1-4.5: native primary namespace/mapping/mount/proc/FD/readiness/attestation portions
  implemented; TypeScript transaction work is separate.
- 4.7-4.8: partial-construction cleanup plus source-owned Linux actual-kernel oracle added;
  the WSL execution receipt is still open.
- 5.1-5.7: native guardian/runtime/reaping/journal/terminal/pidfd portions implemented.
- 5.8: state-machine and one composite actual-kernel mutation test added; the Linux run is
  still open.
- 6.2-6.7: native reference/control/reopen/inspect/abort/terminate portions implemented;
  TypeScript provider/common mapping remains separate.
- 6.10: helper-native state stays inert and has no Published/PUBLISH frame; publication
  ledger enforcement is outside this native work unit.
- 11.2: Windows host unit tests, Linux target compilation, stable rustfmt, metadata and
  static boundary checks are complete. Pinned-rustfmt, actual Linux execution, musl
  artifact/provenance and later broker/package gates remain open.

## TDD evidence

The implementation was driven through explicit RED/GREEN seams:

1. `cargo test --locked ...` failed on missing `protocol`/`lifecycle`; closed frames,
   immutable prepare decoding and the guardian state machine made it green.
2. The next RED failed on missing `authority`/`runtime`; versioned identities,
   attestation/control codecs and private scope creation made it green.
3. The next RED failed on missing abort, journal and Linux identity seams; durable records,
   pidfd and exact proc identity made it green.
4. Capability/artifact contract tests failed on absent `scope_capability`,
   `artifact_digest` and control scope capability; native generation/codec validation made
   them green.
5. Launch-digest RED failed with no `LaunchSpec::digest`; native SHA-256 canonicalization
   made it green.
6. Linux primary RED failed on an unresolved `primary` module; real namespace prepare,
   guardian, runtime and control paths made Linux all-target compilation green.
7. A lifecycle RED showed root-exit immediately aliasing empty; root status and kernel
   `ECHILD` proof are now two separately journaled transitions.
8. Native failure RED failed on missing closed failure types; the fixed v1+u8 failure
   payload and frozen diagnostic-code mapping made it green.
9. The first actual WSL musl run reached `linux_primary_contract` and failed because the
   internal identity bootstrap had reused PreparedAttestation with equal placeholder
   artifact/source digests. The real nonzero/distinct validation correctly rejected that
   fabricated object but its old aggregate error text said "zero identity field". A new
   platform-neutral RED required a dedicated closed identity codec; `RBI1` now carries only
   the validated AuthorityIdentity, and attestation validation reports zero versus conflated
   fields precisely. No zero/distinct validation was weakened.
10. A second native-in-WSL locked Cargo run, using isolated Zig 0.16 with Rust 1.88,
    compiled and executed the tests and reached `linux_runtime_contract` after 18 passes.
    Its positive private-scope fixture inherited an ambient Cargo `TMPDIR` long enough to
    exceed the intentional 100-byte Unix-socket bound. Production fail-closed behavior was
    correct; the fixture was ambient-path dependent. All Linux filesystem tests now create
    collision-free `/tmp/rpa-<pid>-<sequence>-<label>` roots atomically, chmod and verify
    them as exact caller-owned 0700 non-symlink directories, and assert the root stays short.
    The negative test still explicitly constructs and asserts a >100-byte representative
    socket path, requires rejection, and proves no partial scope directory remains. The
    100-byte production bound was not changed.

The Linux-only composite test is not ignored. On a real Linux kernel it exercises wrong
artifact rejection without a scope, prepare-before-workload, both capability mismatches,
identity drift, inert abort, `/usr/bin/true` natural empty, root-exit-before-empty,
`setsid`, an orphaned nested PID namespace, exact `ECHILD`, activation replay rejection,
graceful termination and terminal reopening.

## Verification receipts

Windows host identity: `rustc 1.88.0 (6b00bc388 2025-06-23)`, `cargo 1.88.0
(873a06493 2025-05-10)`.

Successful commands:

```text
rustup run stable cargo fmt --manifest-path native/linux-process-authority/Cargo.toml
rustup run stable cargo fmt --check --manifest-path native/linux-process-authority/Cargo.toml
  rustfmt 1.8.0-stable (6b00bc3880 2025-06-23): pass

cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml
  Windows-executed platform-neutral tests: 14 passed, 0 failed, 0 ignored
  Linux-only test binaries: selected out by target cfg; this is not Linux runtime evidence

cargo check --locked --all-targets --target x86_64-unknown-linux-gnu \
  --manifest-path native/linux-process-authority/Cargo.toml
  pass, no warnings; all 23 Linux test functions compile

cargo metadata --locked --format-version 1 \
  --manifest-path native/linux-process-authority/Cargo.toml
  pass; lockfile SHA-256 dc620bfc0ee30a9efe00f6e8de0f0bec523ff09e006200954eabe169b00b739e

git check-ignore -v native/linux-process-authority/target
  native/linux-process-authority/.gitignore:1:/target/
```

The active pinned Windows 1.88 minimal toolchain does not have `cargo-fmt.exe`; its direct
`cargo fmt --check` therefore reports a missing component. No toolchain was installed or
changed. Stable rustfmt formats the source cleanly, while the pinned 1.88 fmt gate remains
for the already isolated WSL toolchain/workflow.

Static production-source search found no `Command::new`, `/bin/sh`, `/bin/bash`, `killpg`,
`setpgid`, process-group authority, or `/proc/.../task` descendant enumeration. It did find
the required clone flags, `MS_PRIVATE`, pidfd open/send, PID1 `waitpid(-1)`, and `ECHILD`.

## Actual Linux RED and rerun still required

The parent ran the pinned Rust 1.88 Windows-built musl test binaries on the recorded Ubuntu
24.04 WSL kernel. Four test binaries passed before `linux_primary_contract`;
`recursive_workload_fixture` also passed. The strongest test reached its first real Prepare
and exposed the bootstrap-codec bug described above at the former line 76. This is genuine
actual-kernel evidence, not cross-check evidence, but the suite stopped at RED and therefore
does not close the primary gate.

The rebuilt native-in-WSL locked Cargo path then used isolated Zig 0.16 and Rust 1.88 and
reached the runtime tests after 18 passes. The positive runtime fixture exposed only its
ambient long-`TMPDIR` dependency; production rejected the over-bound socket path exactly as
specified. The fixture is now short/private/deterministic while the explicit over-bound
negative remains.

After rebuilding with both fixes, the parent must rerun the same full locked suite serially
and retain the complete output:

```text
RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2 \
CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2 \
/home/sayo/.local/share/rasen-cargo-1.28.2/bin/cargo test --locked \
  --manifest-path <WSL_WORKTREE>/native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu -- --test-threads=1
```

Then run pinned fmt/check and the already-provisioned musl static-PIE build using the
source-owned invocation selected by the parent. Until those receipts pass, this work unit
does not claim actual Linux primary closure, artifact packaging, broker capability,
distribution support, ECP-8 release support, ship, or archive.
