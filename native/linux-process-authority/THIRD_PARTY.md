# Linux Process Authority Rust dependencies

This source-owned crate is MIT licensed. `Cargo.lock` is the exact provenance record for
all registry versions and checksums. Its SHA-256 after adding the broker is
`f7cf36db41d966cf9ea2300c99ee3dca5eb11a58f50ff93caf96ee552fe9dfe0`.

Direct runtime dependencies are pinned exactly in `Cargo.toml`: `libc 0.2.174`,
`sha2 0.10.9`, `ed25519-dalek 2.2.0`, `getrandom 0.3.3`, and `zeroize 1.9.0`. The full locked metadata set,
including target-specific and proc-macro/build-time transitive crates, is:

| Package | Version | License |
| --- | ---: | --- |
| `base64ct` | 1.8.3 | Apache-2.0 OR MIT |
| `block-buffer` | 0.10.4 | MIT OR Apache-2.0 |
| `cfg-if` | 1.0.4 | MIT OR Apache-2.0 |
| `const-oid` | 0.9.6 | Apache-2.0 OR MIT |
| `cpufeatures` | 0.2.17 | MIT OR Apache-2.0 |
| `crypto-common` | 0.1.7 | MIT OR Apache-2.0 |
| `curve25519-dalek` | 4.1.3 | BSD-3-Clause |
| `curve25519-dalek-derive` | 0.1.1 | MIT/Apache-2.0 |
| `der` | 0.7.10 | Apache-2.0 OR MIT |
| `digest` | 0.10.7 | MIT OR Apache-2.0 |
| `ed25519` | 2.2.3 | Apache-2.0 OR MIT |
| `ed25519-dalek` | 2.2.0 | BSD-3-Clause |
| `fiat-crypto` | 0.2.9 | MIT OR Apache-2.0 OR BSD-1-Clause |
| `generic-array` | 0.14.7 | MIT |
| `getrandom` | 0.2.17 | MIT OR Apache-2.0 |
| `getrandom` | 0.3.3 | MIT OR Apache-2.0 |
| `libc` | 0.2.174 | MIT OR Apache-2.0 |
| `pkcs8` | 0.10.2 | Apache-2.0 OR MIT |
| `proc-macro2` | 1.0.107 | MIT OR Apache-2.0 |
| `quote` | 1.0.47 | MIT OR Apache-2.0 |
| `r-efi` | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| `rand_core` | 0.6.4 | MIT OR Apache-2.0 |
| `rustc_version` | 0.4.1 | MIT OR Apache-2.0 |
| `semver` | 1.0.28 | MIT OR Apache-2.0 |
| `serde` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_core` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 |
| `signature` | 2.2.0 | Apache-2.0 OR MIT |
| `spki` | 0.7.3 | Apache-2.0 OR MIT |
| `subtle` | 2.6.1 | BSD-3-Clause |
| `syn` | 2.0.119 | MIT OR Apache-2.0 |
| `syn` | 3.0.3 | MIT OR Apache-2.0 |
| `typenum` | 1.20.1 | MIT OR Apache-2.0 |
| `unicode-ident` | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| `version_check` | 0.9.5 | MIT/Apache-2.0 |
| `wasi` | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wasi` | 0.14.7+wasi-0.2.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wasip2` | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wit-bindgen` | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `zeroize` | 1.9.0 | Apache-2.0 OR MIT |

No runtime download, runtime compiler, shell launcher, PATH-resolved authority helper, or
implicit broker installer is part of the crate. The administrative shell assets are
explicitly invoked install/uninstall tooling and are never called from provider prepare.
