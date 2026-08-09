# WSL primary native-build gate — round 3

Date: 2026-08-05

## Reproducible native toolchain

- WSL2 distribution: `Ubuntu-24.04`.
- Isolated Rust/cargo/rustfmt: 1.88.0 beneath the recorded Rasen-only roots.
- Isolated native host linker/sysroot: official Zig 0.16.0 x86_64-linux, checksum-verified, with no profile, sudo, `/etc`, WSL configuration, cgroup, or system-package mutation.
- `cargo fmt --check` ran with the pinned 1.88 rustfmt and passed.

## Native locked test receipt

The crate compiled and linked inside WSL using the pinned Rust toolchain, Zig only as the native GNU host linker/sysroot, locked dependencies, an isolated target directory, and serial execution:

```text
cargo test --locked --target x86_64-unknown-linux-gnu -- --test-threads=1
23 passed, 0 failed, 0 ignored
```

The earlier ambient-temp fixture RED was fixed without weakening the production 100-byte Unix socket bound. Linux fixtures now atomically create a short euid-owned 0700 non-symlink test root; the positive test asserts the resulting socket is within the bound and the negative test explicitly proves an over-bound representative path is rejected with no partial scope.

## Native release artifact receipt

The exact source was also compiled inside WSL for the pinned Rust `x86_64-unknown-linux-musl` target. Native host build scripts used the isolated Zig linker; the final target link used the pinned Rust toolchain's self-contained `rust-lld` path.

Staged artifact:

```text
/home/sayo/.local/share/rasen-build/linux-process-authority-0.2.0-x86_64-musl/rasen-linux-process-authority
sha256 af309c4c2844cbc64d6169e28c73e8d68654ec99e5375ecb7730503f13f32e97
size 546280
mode 0755
uid/gid 1000/1000
ELF 64-bit x86-64 static-PIE, stripped, type DYN, no interpreter segment
```

Executing the staged ELF with an unsupported operation returned the expected closed `RPA1` failure frame rather than text or an open schema:

```text
525041310001ff0000000003000109
```

This decodes as magic `RPA1`, protocol v1, Failure kind, three-byte payload, failure schema v1, code 9 (`native-state-retained`).

## Remaining boundary

The native build/test/execution portion is GREEN. Task 7.2 remains unchecked until the source-owned build/export script emits and independently verifies the adjacent canonical manifest's exact length, artifact hash, source digest, compiler identity, mode, platform/provider/protocol/reference fields. Complete explicit Section 7 mutation coverage and broker/cgroup-v2 remain open.
