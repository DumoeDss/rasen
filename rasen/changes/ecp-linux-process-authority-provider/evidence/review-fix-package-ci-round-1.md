# Linux process-authority package/CI review fix round 1

Date: 2026-08-06
Mode: non-author fixer, source remediation only
Review source: `review-report-package-ci-round-1.md`

## Scope and boundary

This round remediates the package/CI review findings in the five package-owned files below. It does not edit the native primary or broker implementation, the TypeScript runtime/provider, `tasks.md`, `.rasen/**`, or pipeline run-state. No workflow was dispatched, and no commit, push, PR, runner, broker, key, service, cgroup, or other administrative state was created or modified.

- `.github/workflows/linux-process-authority.yml`
- `build.js`
- `package.json`
- `scripts/build-linux-process-authority.mjs`
- `test/core/session-host/linux-process-authority-package-ci.test.ts`

## Finding disposition

### Closed in source

- **PKG-S1 / S1 — CLOSED.** Staged-only assembly now consumes a separate release input outside staging, requires its externally pinned `RASEN_LINUX_PROCESS_AUTHORITY_RELEASE_INPUT_SHA256`, verifies the exact artifact byte length and SHA-256, validates ELF64/little-endian/target-machine identity, and accepts only canonical provenance bound to that pinned input. Changing staged executable bytes without changing the trusted release input fails closed.
- **PKG-S2 / S2 — CLOSED.** Native builds reject build-affecting compiler/linker overrides, copy the exact source inputs into a read-only snapshot, bind live and snapshot pre/post digests, reject ancestor Cargo configuration, use a fresh isolated `CARGO_HOME`, resolve the sysroot through the pinned rustup shim, and then execute/hash the exact sysroot `rustc` and `cargo`. Provenance records the exact linker hash/version; musl uses the bundled `rust-lld`, while GNU uses the exact resolved `cc`.
- **PKG-S3 / S3 — CLOSED.** The privileged broker job pins checkout to `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`, requires an already installed exact Rust/Cargo toolchain, and executes no mutable action after sudo/key authority becomes available.
- **P1 — CLOSED.** Provider manifests are architecture-specific (`providers-linux-x64.json` and `providers-linux-arm64.json`); arm64 no longer advertises x64 artifact paths.
- **P2 — CLOSED.** Authoritative Windows assembly fails closed because Node on Windows cannot prove preservation of POSIX `0755`; Windows remains a compile/shape-only, non-runtime path.
- **P3 — CLOSED.** Package and export assembly now use private closed inventories and transactional replacement with rollback. Stale Linux architectures, foreign manifests, daemon/key/state/socket/service/lease assets, and unknown files are removed or excluded. A real `npm pack --dry-run --json --ignore-scripts` audit proves forbidden assets are absent.
- **P4 — CLOSED.** Namespace classification is emitted separately in machine-readable form. The actual runtime gate uses `always()` and exits nonzero when policy remains open, so an unexecuted actual-kernel gate cannot appear green.
- **Native musl linker-version integration defect — CLOSED in source.** The first native rerun proved that the bundled `rust-lld` generic driver rejects a bare `--version`. A focused assertion was added RED, then the exact linker probe was changed to `rust-lld -flavor gnu --version` and the test passed GREEN. The subsequent native build advanced through that seam.

### Held for broker-stable integration evidence

- **P5 — HOLD.** The final source digest and artifact hashes must be taken only after the concurrent broker migration is compile-clean. The historical digest `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd` predates the current broker migration and is not final evidence.
- **Final integrated `--check-only` receipt — HOLD for source freeze.** A compile-clean pre-freeze run passed with source SHA-256 `9d33671c63184dbfa2280a090bfbd2e512e9a6c625a93de2fb395d2ffeb21843`; do not label that digest final while broker round-2 edits continue.
- **Final full WSL package suite — HOLD for source freeze.** The exact-current pre-freeze suite passed 10/10 after the linker-probe fix; repeat on the frozen tree for the final integrated receipt.
- **Final native musl package/export receipt — HOLD for environment and source freeze.** The source is compile-clean and the fixed `rust-lld` probe passes, but the isolated WSL environment has no `cc`, `gcc`, or `clang` for dependency host build scripts. The rerun failed closed with `linker cc not found`. No system package, profile, or persistent wrapper was installed.

The package/CI source remediation is complete. These holds are evidence-integration dependencies, not remaining package/CI source defects.

## Verification receipts

- Windows exact-current package/CI suite: **10 passed, 0 failed**.
- Compile-clean pre-freeze Windows `--check-only`: **passed** for both binaries; `cross-build-non-runtime`, `runtimeAccepted: false`, source SHA-256 before/after `9d33671c63184dbfa2280a090bfbd2e512e9a6c625a93de2fb395d2ffeb21843`.
- Exact-current pre-freeze WSL package/CI suite after the linker-probe fix: **10 passed, 0 failed**.
- Exact-current WSL focused immutable-snapshot/concurrent-source-mutation test: **1 passed, 0 failed**.
- Exact-current WSL focused private atomic package/export replacement test: **1 passed, 0 failed**.
- Resolver + package + legacy suite: **47 passed, 0 failed** (resolver 22, package/CI 10, ProcessCapsule package 13, ProcessCapsule provenance 2).
- `pnpm exec tsc --noEmit`: **passed**.
- `pnpm exec eslint scripts/build-linux-process-authority.mjs test/core/session-host/linux-process-authority-package-ci.test.ts`: **passed**.
- `node --check scripts/build-linux-process-authority.mjs`: **passed**.
- `package.json` JSON parse and workflow YAML parse: **passed**.
- `node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json`: **1 passed, 0 failed, 0 issues**.
- Earlier full Linux/WSL package suite: **10 passed**, but it predates the final release-pin and transactional hardening and is not the final integrated receipt.

Native musl integration TDD and environment receipt:

- RED: focused linker contract assertion failed because the script used a bare `rust-lld --version`.
- GREEN: the focused assertion passed after using the explicit GNU flavor.
- Native retry: the version seam passed; Cargo then failed while linking host build scripts because the WSL environment has no host C compiler driver. This is an environment-open receipt, not a package success and not a native-source failure.

Legacy ProcessCapsule build script SHA-256 remains `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92`; no legacy source or meaning was changed by this round.

## Exact package/CI file identities

```text
ac46463416eac93f88bd6a2276a374d929c366fb3cece3987f5d76dd2ef8592a  .github/workflows/linux-process-authority.yml
498cbfadab26af32a1f56215fd84852d07c63e739aa00387403ee1d1b90cb175  build.js
771fc049501d7cccd6bd66bf4f5ccaa64b12abba219470b5215ba11e63d85e3b  package.json
7607040851b2ab7f1944e8d9c07e90394392cb72b8d271a3e5484a9bbec6a07a  scripts/build-linux-process-authority.mjs
ae913949f9672bf387ee1ca97405cf82ff9e9cf2360dd32c66f0c9a6fcabbfe8  test/core/session-host/linux-process-authority-package-ci.test.ts
```

## Stable final-integration rerun commands

Windows non-runtime check-only receipt:

```powershell
$env:RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT='E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\.tmp-linux-authority-package-ci'
node scripts/build-linux-process-authority.mjs --check-only --target x86_64-unknown-linux-gnu
```

Native WSL musl package/export receipt:

```text
wsl.exe -d Ubuntu-24.04 --cd /mnt/e/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle -- env \
  PATH=/home/sayo/.local/share/rasen-cargo-1.28.2/bin:/usr/bin:/bin \
  RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2 \
  RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT=/tmp/rasen-linux-package-final-temp \
  RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT=/tmp/rasen-linux-package-final-output \
  RASEN_LINUX_PROCESS_AUTHORITY_EXPORT_DIR=/tmp/rasen-linux-package-final-export \
  node scripts/build-linux-process-authority.mjs \
  --target x86_64-unknown-linux-musl
```

Full WSL package suite:

```text
wsl.exe -d Ubuntu-24.04 -- bash -lc \
  'cd /mnt/e/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle &&
   pnpm dlx vitest@3.2.6 run test/core/session-host/linux-process-authority-package-ci.test.ts'
```

## LEAD accounting note

The LEAD may treat S1-S3, P1-P4, and the musl linker-version defect as source-remediated. Do not close P5 or present final Linux package integration evidence until broker source freeze and a host-linker-capable native environment allow the held receipts to be captured from the exact frozen tree.
