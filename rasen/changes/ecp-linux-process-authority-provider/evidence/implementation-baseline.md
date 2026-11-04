# Linux process-authority implementation baseline

Date: 2026-08-05

## Start identity and ownership boundary

- Implementation start HEAD: `81d0ea37770979c0b58b0e54735585fef3280e64`.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/`.
- Architecture replan SHA-256: `1d8196dc7e71e415e483a007b6bea6bd1a726361b58594599f53610f23d99a75`.
- Archived foundation code commit: `222eac509f5fb40ecce182c9eb7533ed754f310d`.
- Archived foundation accounting: `rasen/changes/archive/2026-08-05-ecp-platform-process-authority-foundation/archive.json`; authoritative archive transaction `eb60dbba-dee7-4d32-b004-440c58a7cef1`.
- Foundation archive commit in this cumulative branch: `81d0ea37770979c0b58b0e54735585fef3280e64`.

The targeted start status contains many pre-existing cumulative ECP Session-host, build, release, and helper files. This Change does not infer ownership from dirty/untracked status. It owns only the new Linux paths, explicit additive build/package deltas, its named tests, and this Change directory. It must not normalize, reset, clean, or broadly stage the shared worktree.

## Frozen common inputs

- Main common spec: `rasen/specs/process-authority-provider/spec.md` — SHA-256 `51e74c08f396d208d7b8591b1922889aa387e05bf2c7162e64002b0864757c33`.
- Shared provider conformance suite: `test/helpers/process-authority-provider-conformance.ts` — SHA-256 `370aa82811784ed53230f1f859316359e9db56d7f49ae046b45a252f41cb2262`.

Implementation must add a test/verification guard for both hashes. Linux provider-specific mutations live outside the shared suite.

## Legacy ProcessCapsule migration baseline

- `native/process-capsule/src/main.rs` — `79dc1ad0f19e5f1d087083707c5307d8523002c557995a6658146c64f0f41c8d`.
- `native/process-capsule/Cargo.lock` — `f00e64114e06f06b623880947c4ec4d33953218d901abdba3b2b2f1d32db8793`.
- `scripts/build-process-capsule.mjs` — `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92`.
- `src/core/session-host/process-capsule/resolver.ts` — `a1df4e2ed63167231c0207dbd4d5a5d8c8aa5bb4e44665e7b4cbe3d5624bbf91`.
- `src/core/session-host/process-capsule/native-process-scope.ts` — `0848c77b55d405afdf02b43c797986cb15193cca453b61fa7aa03d07209588fa`.
- `test/core/session-host/process-capsule-package.test.ts` — `3ed5945c5b17b711c783534281c4288242ab9b680e498135db3f344528a759e1`.
- `test/core/session-host/process-capsule-posix-replacement.test.ts` — `894a5119e480f4f904f6a5265adb82c48e83f2a31bc79f1b27b14f2f0e64e047`.

Those inputs describe legacy protocol v2 Linux `pidfd + process-group` behavior. This Change may test them as migration constraints, but must not reinterpret that tuple/reference as strong authority, edit its semantic meaning, remove PGID, or wire production defaults. Closure owns the later atomic migration.

## Planned implementation file map

- TypeScript provider/ledger/protocol/artifact boundary: `src/core/session-host/process-authority/linux/**`.
- Native Linux-only helper and broker sources: `native/linux-process-authority/**`.
- Linux-specific provider/conformance/ledger/resolver tests: new exact files under `test/core/session-host/` and Linux-only helpers under `test/helpers/`.
- Actual WSL/broker oracle runners: source-owned bounded scripts/tests with receipts outside product/package output.
- Additive build/package assembly: a new Linux-authority build script plus path-scoped deltas to `build.js`, `.github/workflows/release.yml`, and their exact contract tests only when required.
- Planning/evidence/handoff: `rasen/changes/ecp-linux-process-authority-provider/**`.

Excluded: existing ProcessScope/host default switching, legacy ProcessCapsule protocol/ref rewrite, PGID removal, macOS/MMAC, Windows provider, native closure, durable host, Session executor, unrelated temp output, safety stash, and ECP-8 release truth.

## Actual environment facts

### Windows build host

- Windows Rust: cargo `1.88.0`; installed targets include `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, and `aarch64-apple-darwin`.
- No Windows `clang`, `zig`, `x86_64-linux-gnu-gcc`, or `musl-gcc` was found.
- A Windows cross-target result is compile/build evidence only and cannot close an actual-Linux oracle.

### WSL2 primary runtime

- Distribution: Ubuntu `24.04.1 LTS`; WSL version 2.
- Kernel: `5.15.167.4-microsoft-standard-WSL2`, x86_64.
- Node `v22.21.0`; pnpm `9.15.9`.
- `unshare --user --map-root-user true`: exit 0.
- `unshare --user --map-root-user --pid --fork true`: exit 0.
- Python reports `os.pidfd_open` available.
- A Rasen-isolated user-local toolchain is installed under `/home/sayo/.local/share/rasen-{rustup,cargo}-1.28.2`; it does not modify the user's shell profile or default Rust environment.
- Installer: official `rustup-init` 1.28.2 for `x86_64-unknown-linux-gnu`, verified before execution with SHA-256 `20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c`.
- Toolchain: `rustc 1.88.0 (6b00bc388 2025-06-23)`, `cargo 1.88.0 (873a06493 2025-05-10)`, LLVM `20.1.5`; installed targets are `x86_64-unknown-linux-gnu` and `x86_64-unknown-linux-musl`.
- The pinned musl target successfully produced a native x86-64 static PIE with the bundled `rust-lld`. Actual crate build and execution remain open until the source-owned helper is available; no GNU `cc` was installed and no broker/cgroup claim follows from this setup.
- Cgroups use a hybrid hierarchy. `/sys/fs/cgroup/unified` is a cgroup-v2 mount, but it exposes no required controllers, `cgroup.events`, or `cgroup.kill`; the ordinary WSL configuration cannot close the broker gate.

These facts authorize no package, install, general-distribution, broker, release, or support claim.

## Named acceptance gates

| Gate | Initial state | Terminal evidence required |
|---|---|---|
| Common-contract preservation | open | frozen spec/suite hash guard plus unchanged shared conformance body |
| Platform-neutral Linux provider | open | exact descriptor/ref/ledger/protocol/resolver tests and static/package checks |
| WSL primary actual kernel | open | native helper plus namespace/pidfd/escape/root-empty/kill/abort/recovery/identity receipts on recorded WSL kernel |
| Broker/cgroup-v2 actual kernel | open | dedicated reconfigured WSL/VM/runner with required v2 controllers, authenticated installed broker, root-owned leaf, `cgroup.kill`, and `cgroup.events` receipts |
| Package/build matrix | open | adjacent artifacts, manifests, locked builds, clean package audits, and supported architecture receipts |
| Closure integration | blocked | Linux child local ship/archive, later removal of the legacy PGID claim and exact host/ProcessScope wiring in closure |
| ECP-8 release | blocked | clean-distribution actual claimed-OS matrix, remote CI, packaging/install and release truth |

No narrower gate result may be renamed or promoted to close a broader gate.
