# Windows Process Authority Rust dependencies

This source-owned crate is MIT licensed and has **zero external dependencies**, direct or
transitive. `Cargo.lock` records exactly one package — this crate itself — and is the exact
provenance record.

| Package | Version | License | Origin |
| --- | ---: | --- | --- |
| `rasen-windows-process-authority` | 0.2.0 | MIT | this repository |

There is no registry package, no build script, no proc-macro, and no vendored source.

## Why zero dependencies

Decision 1 of `rasen/changes/ecp-windows-process-authority-provider/design.md` rejects
`windows-sys` / `windows` for this crate: a generated binding adds a large dependency surface
to a security-critical minimal artifact, and it weakens rather than strengthens the
"every declared foreign item is proven against the real kernel" obligation that `F-L2-09`
demands.

The cost is carried explicitly:

- Windows ABI access is hand-declared `extern "system"` in `src/sys.rs`, against `kernel32`,
  `advapi32` and `ntdll` only. `src/sys.rs` carries the declared-item table mapping each item
  to the SDK definition it mirrors (task 3.2).
- SHA-256 is implemented in-crate (`src/sha256.rs`) and validated against the NIST FIPS 180-4
  published vectors plus a long-message vector, because the digest is load-bearing for the
  launch snapshot and for the reference identity.
- Randomness comes from the operating system (`advapi32!SystemFunction036`, the
  `RtlGenRandom` entry point), never from a user-space PRNG seeded by a clock.

## Toolchain

Pinned to the same toolchain as the Linux sibling crate:

```
rustc 1.88.0 (6b00bc388 2025-06-23)
cargo 1.88.0 (873a06493 2025-05-10)
```

Supported targets: `x86_64-pc-windows-msvc` (runtime evidence) and
`aarch64-pc-windows-msvc` (cross-build shape evidence only; no runtime claim).
