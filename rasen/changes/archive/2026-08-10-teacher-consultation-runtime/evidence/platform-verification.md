# Exact Teacher Provider Verification Evidence

Date: 2026-08-10

The provider-neutral conformance result and native operating-system evidence are
reported separately. A transport-backed Adapter result is not presented as a
native kernel result.

## Unchanged provider-neutral harness

Command:

```text
npx vitest run test/core/session-host/process-authority-conformance.test.ts test/core/session-host/windows-process-authority-conformance.test.ts test/core/session-host/linux-process-authority-conformance.test.ts --reporter=verbose
```

Result: 3 files, 98/98 tests passed.

Evidence classification:

- deterministic Adapter: deterministic test evidence;
- Windows production Adapter with the conformance transport: cross-target
  Adapter simulation, not native Job Object evidence;
- Linux production Adapter with the conformance transport: cross-target Adapter
  simulation, not native PID-namespace evidence.

All three consumers used the same
`processAuthorityProviderConformanceSuite` without platform-specific assertion
weakening.

## Actual Windows host

Command:

```text
cargo test --manifest-path native/windows-process-authority/Cargo.toml
```

Result: 124/124 tests passed on the current Windows host: 91 crate tests, 15
Job Object kernel tests, 6 guardian lifecycle tests, 8 section-8 native gate
tests, and 4 section-9 discrimination tests. This is actual Windows kernel and
guardian evidence.

## Linux host status

The current Windows machine exposes a WSL Linux runtime, but that runtime has no
Rust toolchain and this worktree has no built Linux authority artifact. Linux
native tests were therefore not executed here. The 98-test result above remains
explicitly classified as cross-target Adapter simulation; it is not promoted to
actual Linux evidence. The Linux native gate remains an integration/CI gate on
an equipped Linux host.
