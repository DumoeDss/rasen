# Cross-target evidence and ECP-8 runtime obligations

## ECP-7 compile-only evidence

Executed on Windows x64; neither command is runtime evidence:

```text
cargo +1.88.0 check --manifest-path native/process-capsule/Cargo.toml --locked --target x86_64-unknown-linux-gnu
cargo +1.88.0 check --manifest-path native/process-capsule/Cargo.toml --locked --target aarch64-apple-darwin
```

Both completed successfully after the 56-byte macOS ABI and exact POSIX group
replacement changes.

## Mandatory actual Linux acceptance in ECP-8

Run on the clean release branch and record OS/kernel, architecture, helper
SHA-256, opaque ref protocol/capability, controller/root/supervisor/group facts,
foreign mutation receipt, termination receipt, and unrelated-process survival:

```text
pnpm exec vitest run test/core/session-host/process-capsule-posix-replacement.test.ts test/core/session-host/process-capsule-native.test.ts --maxWorkers=1 --minWorkers=1
```

Expected semantic receipts: exact old group becomes `closed`; controller or
supervisor birth mutation is `foreign`/uncertain with zero signals; resistant
root and descendant die; the unrelated process remains alive.

## Mandatory actual macOS acceptance in ECP-8

Run on the clean release branch and record macOS version, architecture, helper
SHA-256, same-second unique identities, foreign/unavailable results, group facts
and termination receipts:

```text
pnpm exec vitest run test/core/session-host/process-capsule-macos-identity.test.ts test/core/session-host/process-capsule-posix-replacement.test.ts test/core/session-host/process-capsule-native.test.ts --maxWorkers=1 --minWorkers=1
```

Expected semantic receipts: multiple same-second processes have distinct kernel
unique births; different-birth control signals nothing; unavailable identity
fails before activation; exact resistant group cleanup closes the scope while
the unrelated process survives.

These actual Linux/macOS commands were not executed in this Windows worktree.
Their absence does not become a passing result and blocks the corresponding
ECP-8 release/support claim until the real runners pass.
