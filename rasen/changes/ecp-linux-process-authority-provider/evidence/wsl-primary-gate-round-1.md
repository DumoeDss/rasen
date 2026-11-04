# WSL primary actual-kernel gate — round 1

Date: 2026-08-05

## Environment and build route

- Runtime: WSL2 `Ubuntu-24.04`; the test binaries executed as Linux processes on that kernel.
- The isolated WSL Rust 1.88 toolchain could compile dependencies only after a host C linker is available. Its first locked native test attempt stopped before tests with `linker cc not found`.
- The toolchain's direct `rust-lld` could not substitute for a GNU sysroot because this minimal WSL image lacks glibc development objects/libraries. Passwordless sudo is unavailable, so no global WSL package or configuration change was made.
- To keep actual-kernel diagnosis moving without claiming a native-in-WSL build, the exact source was cross-built with pinned Windows Rust 1.88 for `x86_64-unknown-linux-musl` using `rust-lld`. The target component was added to that pinned toolchain, and `cargo test --locked --no-run` completed. The resulting static Linux test binaries were then executed serially in WSL. WSL `file` identified the composite test binary as an x86-64 static-PIE ELF; `readelf` reported `DYN` and no interpreter segment.
- This route is actual WSL runtime evidence but is not the still-open Task 7.2 native-in-WSL build receipt.

## Round-1 runtime receipt

The following binaries passed before the composite primary test:

- `authority_contract`: 3/3
- `lifecycle_contract`: 5/5
- `linux_identity_contract`: 2/2
- `linux_journal_contract`: 1/1

The non-ignored `linux_primary_contract` then produced a real RED:

```text
actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty ... FAILED
tests/linux_primary_contract.rs:76:6
prepare_primary(...).unwrap(): InvalidInput("prepared attestation contains a zero identity field")
```

The fixture-only `recursive_workload_fixture` passed. Execution stopped after this failing binary, so later binaries were not counted.

## Gate status

- Actual-kernel primary gate: RED, implementation defect returned to the native implementer; no task is closed by this receipt.
- Native-in-WSL locked build: blocked on a missing user-authorized linker/sysroot setup; no silent package installation or sudo bypass occurred.
- Broker/cgroup-v2, packaging, closure, and ECP-8 gates remain open.
