# WSL primary toolchain provision receipt

Date: 2026-08-05

## Boundary

This receipt provisions only a Rasen-specific, user-local Linux build toolchain. It does not modify the shell profile, the default Rust installation, `/etc`, `.wslconfig`, the WSL kernel command line, cgroup mounts, or broker service state.

- Distribution: `Ubuntu-24.04`
- Install roots: `/home/sayo/.local/share/rasen-rustup-1.28.2`, `/home/sayo/.local/share/rasen-cargo-1.28.2`, and `/home/sayo/.local/share/zig-x86_64-linux-0.16.0`
- Installer source: `https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init`
- Official installer SHA-256: `20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c`
- Installer flags: `-y --no-modify-path --profile minimal --default-toolchain 1.88.0`
- Added target: `x86_64-unknown-linux-musl`
- Native linker/sysroot fallback: official Zig 0.16.0 x86_64-linux tarball, SHA-256 `70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00`, verified before extraction. The exact downloaded archive was removed after extraction.

Every invocation sets both `RUSTUP_HOME` and `CARGO_HOME` to the roots above; no ambient toolchain is accepted.

## Verified outputs

```text
rustc 1.88.0 (6b00bc388 2025-06-23)
binary: rustc
commit-hash: 6b00bc3880198600130e1cf62b8f8a93494488cc
commit-date: 2025-06-23
host: x86_64-unknown-linux-gnu
release: 1.88.0
LLVM version: 20.1.5

cargo 1.88.0 (873a06493 2025-05-10)

zig 0.16.0

x86_64-unknown-linux-gnu
x86_64-unknown-linux-musl
```

The pinned musl target and bundled `rust-lld` produced an x86-64 static PIE in an isolated temporary directory:

```text
ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), static-pie linked
```

The temporary probe was removed by its exact-directory trap. The source-owned helper did not yet exist at provision time, so its locked native build and execution remain open. No broker/cgroup-v2 or release-support conclusion follows from this receipt.
