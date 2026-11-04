# WSL current-source native build and manifest receipt — round 5

Date: 2026-08-06

## Boundary

This receipt closes only Task 7.2. It uses the source-owned build/export route on the current tree,
verifies the adjacent canonical primary manifest independently, and executes that exact helper on
the same WSL kernel. It does not close any other Section 7 mutation, the installed-broker/cgroup-v2
gate, package-install support, production default selection, closure, or ECP-8 release truth.

## Reproducible environment

- WSL distribution: `Ubuntu-24.04`.
- Rust/cargo roots: `/home/sayo/.local/share/rasen-rustup-1.28.2` and
  `/home/sayo/.local/share/rasen-cargo-1.28.2`.
- Compiler: `rustc 1.88.0 (6b00bc388 2025-06-23)`.
- Cargo: `cargo 1.88.0 (873a06493 2025-05-10)`.
- Host build-script linker: exact explicit
  `/home/sayo/.local/share/zig-x86_64-linux-0.16.0/zig`, version `0.16.0`, through a private
  build-owned `cc` wrapper.
- Final musl linker: the pinned Rust sysroot's `rust-lld`.
- Build, source snapshot, fresh Cargo home, target, package, and export roots were isolated beneath
  `/home/sayo/.local/share/rasen-build/rasen-linux-7-2-j1LrNU`.
- Windows proxy variables were removed only from the WSL build child because the inherited
  `127.0.0.1:7890` CONNECT path stalled after connection establishment. Direct WSL crates.io access
  returned HTTP 200. No profile or system network configuration changed.

The first authoritative assembly attempt correctly rejected `/mnt/e` because DrvFS did not
preserve exact `0755`. The successful run used WSL ext4, whose mode semantics satisfy the build
contract.

## Source-owned build command

The WSL child set the roots above and ran:

```text
/usr/bin/node scripts/build-linux-process-authority.mjs \
  --target x86_64-unknown-linux-musl
```

The script used a read-only source snapshot, a fresh private Cargo home, locked dependencies, a
private target root, and the current source digest before and after compilation.

Build result:

```text
evidenceClassification: package-integrity-non-runtime
sourceSha256: 49c327ca968e7b2f40ea4a23f0a2cf3cd014732635afec8b3112d3d3c1146540
releaseInputSha256: 0f1f827f06bfe8996b496024110e27e1126b0ddfa3fb156f763b2c9cea87e397
privilegedBrokerIncluded: false
```

## Adjacent primary manifest verification

Exact helper:

```text
/home/sayo/.local/share/rasen-build/rasen-linux-7-2-j1LrNU/package/dist/native/linux-x64/rasen-linux-process-authority-helper
```

Independent Node verification reparsed the artifact and provider manifests and required their
serialized JSON plus newline to equal the source text. Every check passed:

```text
canonical: true
length: 573320
sha256: 81fa695bbf09a2d806edfe81e1b7ed33b2ef72b0c87507eebd22b4397c8ff93e
sourceSha256: 49c327ca968e7b2f40ea4a23f0a2cf3cd014732635afec8b3112d3d3c1146540
compiler: rustc 1.88.0 (6b00bc388 2025-06-23)
executableMode: 0755
platform: linux
arch: x64
mode: user-pidns
providerId: rasen.linux.user-pidns
capabilityId: rasen-recursive-process-scope/1
protocolVersion: 1
providerReferenceVersion: 1
artifactFile: rasen-linux-process-authority-helper
provider manifest exact reference: true
```

`file` and `readelf -h` identified the same bytes as an ELF64 x86-64 static PIE, stripped, type
`DYN`, with no foreign launcher involved.

## Same-kernel execution

The exact staged helper received an unknown closed-protocol operation. It executed on WSL, returned
the expected process status `70`, and emitted the exact closed failure frame:

```text
525041310001ff0000000003000109
```

The frame is the expected `RPA1` protocol-v1 failure with native-state-retained code 9. The
response assertion passed. This establishes current-source native build, adjacent manifest
identity, and same-kernel executable truth only.
