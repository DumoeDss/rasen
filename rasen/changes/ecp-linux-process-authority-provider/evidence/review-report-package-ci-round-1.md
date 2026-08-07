# Fresh review: Linux process-authority package/CI round 1

Date: 2026-08-06
Mode: dispatched, report-only, non-author review
Scope: Tasks 3.7 and 10.1-10.6 only

## Verdict

**FAIL — 8 findings: 3 Blocker, 3 Major, 2 Minor.**

The current primary helper and broker client compile for the installed Linux target and the focused suites are green, but the build/package trust chain is not yet truthful enough to pin executable authority. Staged assembly can bless arbitrary bytes, native-build provenance is not bound to an immutable source/toolchain snapshot, the protected broker job executes mutable action code with passwordless sudo and broker private state present, and the arm64/Windows/stale-output paths do not satisfy their declared package identity.

Scope check: **REQUIREMENTS MISSING.** The five implementation files are in the declared package/CI slice and no product default, ProcessScope integration, native primary/broker implementation, tasks, or run-state was edited by this work unit. Missing behavior is limited to the claimed build/provenance/package/CI requirements below.

## Standards axis

### S1 — Blocker — staged assembly self-signs arbitrary executable bytes

- Evidence: `scripts/build-linux-process-authority.mjs:171-238` accepts any nonempty regular helper and broker-client file plus an unauthenticated text `provenance.json`. That provenance contains no artifact length/hash, and `assemble()` then computes new hashes and writes both manifests and the build-pinned authority table at `scripts/build-linux-process-authority.mjs:311-356`.
- Concrete oracle: the green package test intentionally stages plain text (`test/core/session-host/linux-process-authority-package-ci.test.ts:70-91`) and the assembler promotes it as Linux x64 authority. Altering staged bytes while leaving the claimed native provenance unchanged is therefore accepted.
- Impact: corruption or replacement between native export and final assembly becomes a runtime-selectable executable whose manifest and compiled trust table are freshly self-consistent. This is an executable supply-chain hole and violates the exact source/compiler/hash truth required by Tasks 3.7/10.1/10.2.
- Required action (ASK/non-author fixer): bind helper and client length/hash into a non-self-referential trusted release input or attestation and verify it before assembly; also validate the actual ELF class/machine/target. Add a mutation that changes either staged binary without changing its trusted origin record and requires a closed failure.

### S2 — Blocker — native provenance is not bound to the bytes Cargo actually compiled

- Evidence: `scripts/build-linux-process-authority.mjs:445-487` invokes Cargo against the live shared crate and calculates `sourceDigest()` only after Cargo returns. The source tree is not snapshotted, a pre-build digest is not compared with a post-build digest, and Cargo-influencing inputs such as `RUSTC`, `RUSTC_WRAPPER`, Cargo config, flags, and linker selection are neither isolated nor recorded. `toolchain()` at lines 398-407 checks the `rustc` found on PATH, not necessarily the compiler Cargo is configured to invoke.
- Impact: a concurrent edit or compiler-wrapper/config change can silently produce bytes from one input set while the manifest records a different final source/compiler identity. This worktree actually has concurrent native owners, so the race is not hypothetical. Silent provenance corruption is a Blocker.
- Required action (ASK/non-author fixer): build from a read-only isolated source snapshot whose digest is computed before execution, or at minimum require identical before/after digests and fail on drift; invoke an exact verified Cargo/rustc toolchain in an isolated Cargo configuration and record every build-affecting identity needed by the provenance claim. Add concurrent-source and compiler-override mutations.

### S3 — Blocker — protected broker runner executes mutable action code with root/key authority available

- Evidence: `.github/workflows/linux-process-authority.yml:168-185` first proves passwordless `sudo` and the installed broker private state, then executes `dtolnay/rust-toolchain@stable`. The `stable` ref is mutable third-party code; the checkout/setup action refs in the same privileged job are also tag refs rather than immutable reviewed SHAs.
- Impact: an upstream tag compromise can run arbitrary code on the persistent labelled self-hosted runner, use passwordless sudo, and read or corrupt the broker key/state/lease/socket authority. The repository/manual-input/environment/runner-label checks do not constrain code inside a mutable action.
- Required action (ASK/non-author fixer): remove network-fetched setup actions from the privileged job by preinstalling and verifying the pinned toolchain on the protected runner, or pin every action used by that job to a reviewed full commit SHA. Keep the exact version check inside the job.

Standards count: **3 findings; worst = Blocker.**

## Spec axis

### P1 — Major — arm64 assembly emits an x64 provider manifest

- Evidence: `targetIdentity()` supports `linux-arm64` at `scripts/build-linux-process-authority.mjs:83-90`, and `--plan --target aarch64-unknown-linux-gnu` reports an arm64 artifact path. `providerManifest()` nevertheless hard-codes both entries to `dist/native/linux-x64/**` at lines 264-287, regardless of the artifacts being assembled.
- Impact: an arm64-only build publishes provider entries that point to missing x64 files; a multi-architecture staging build publishes only the x64 provider paths. This breaks the exact manifest-bound provider tuple on a supported architecture.
- Required action (ASK/non-author fixer): generate architecture-correct provider manifest(s) from the assembled identities and add arm64-only plus dual-architecture assembly tests that resolve every advertised path exactly once.

### P2 — Major — Windows staged assembly declares 0755 but writes 0666

- Evidence: `copyMode755()` skips `chmod` on Windows at `scripts/build-linux-process-authority.mjs:305-309`, while `manifestFor()` always declares `executableMode: '0755'` at lines 241-261. The package test also skips its output-mode assertion on Windows at `test/core/session-host/linux-process-authority-package-ci.test.ts:147-149`.
- Concrete oracle: on this Windows host, `fs.writeFileSync(..., { mode: 0o755 })` produced mode `0666`. The authoritative staged assembly therefore emits bytes whose filesystem/package mode contradicts their manifest; a later Linux resolver requires exact 0755.
- Impact: the Task 10.4 Windows package-shape path can produce an install that cannot become Linux authority, despite a self-consistent hash/table.
- Required action (ASK/non-author fixer): either prohibit authoritative package assembly on filesystems that cannot preserve the Linux executable mode, or assemble a package/archive format that explicitly preserves and verifies POSIX 0755. Add an installed-package mode oracle rather than skipping it on Windows.

### P3 — Major — assembly/export results depend on stale destination contents

- Evidence: `assemble()` at `scripts/build-linux-process-authority.mjs:311-378` writes allowed files into existing `dist/native` and export directories without rejecting, cleaning, or atomically replacing the owned output tree. The deterministic test reuses a clean tree and compares only the expected files; it never injects an old daemon, key, state, service, foreign architecture, or manifest.
- Impact: direct `build:linux-authority`, staged-only assembly, or a reused export root can retain a previously present privileged broker daemon/private asset. Because `package.json` includes all of `dist`, that stale file can enter npm even though the current run reports `privilegedBrokerIncluded: false`. Output is also not deterministic from inputs alone.
- Required action (ASK/non-author fixer): assemble the complete owned output in a new private temporary tree, verify its closed file inventory, then atomically replace the destination; apply the same closed-tree rule to export. Add stale privileged/unknown file mutations and inspect the actual npm packlist.

### P4 — Minor — namespace-policy denial is OPEN only in prose while the named job succeeds

- Evidence: `.github/workflows/linux-process-authority.yml:80-113` records `state=open`, skips the actual primary test, then continues package tests and artifact upload; no final machine-readable gate prevents the `linux-provider-primary` job from concluding green.
- Impact: humans reading the step summary see `OPEN`, but branch protection or later automation sees the same successful check as a run that executed the actual-kernel test. This can accidentally promote build evidence into runtime-gate evidence.
- Required action (AUTO-FIX candidate): split build/package and actual-kernel gates into separately named jobs or publish/consume an explicit machine-readable open outcome whose check cannot be interpreted as a passed actual-primary gate.

### P5 — Minor — implementation evidence source digest is stale after concurrent native integration

- Evidence: `evidence/implementation-package-ci-1.md` records final source SHA-256 `4875fc23401b3e8437a7982469a3a784ca5f7d9be601014771a3bf896c82181a`. After the broker/native final hardening landed, this reviewer reran the dual-binary check on the new tree and obtained `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd`.
- Impact: the historical receipt is useful but cannot be presented as the final integrated source identity.
- Required action (AUTO-FIX candidate): supersede the old hash in final integration evidence with the fresh command, exact tree state, and artifact hashes; do not rewrite the historical receipt as though it ran later.

Spec count: **5 findings; worst = Major.**

## Coverage map

```text
BUILD/PACKAGE CODE PATH COVERAGE
================================
[+] CLI parse + target plan
    ├── [★★ TESTED] x64 plan / closed operations
    └── [GAP] arm64 assembly/provider-manifest path -> P1
[+] source/toolchain identity
    ├── [★★ TESTED] exact Rust/Cargo version and locked dual-bin cargo check
    └── [GAP] immutable source snapshot + Cargo compiler/config binding -> S2
[+] staged artifact import
    ├── [★★ TESTED] missing client, empty helper, cross-build label rejection
    └── [GAP] exact byte origin, ELF machine, transfer tamper -> S1
[+] assemble/export
    ├── [★★ TESTED] known x64 helper/client/manifests/table reassemble identically
    ├── [GAP] closed/clean destination and actual npm packlist -> P3
    └── [GAP] Windows installed executable mode -> P2
[+] runtime artifact resolver
    └── [★★★ TESTED] 22 mutations: tuple, version, mode, length/hash/source,
        self-consistent replacement, symlink/escape, opened-FD replacement,
        no PATH/download/compiler/shell/legacy fallback
[+] build.js/package metadata
    ├── [★★ STATIC] Linux-only authority build; native admin tree not in files list
    └── [GAP] clean installed package oracle is deferred

CI GATE COVERAGE
================
[+] hosted Linux primary
    ├── [★★ STATIC] pinned Rust version, locked build/tests, no scripted sudo
    └── [GAP] policy denial remains green to machine consumers -> P4
[+] Windows Linux-target shape
    ├── [★★★ TESTED] current helper+broker-client cargo check passes, non-runtime
    └── [GAP] authoritative staged/package mode truth -> P2
[+] protected broker wiring
    ├── [★★ STATIC] base repo + workflow_dispatch + exact input + environment +
        labelled self-hosted runner + explicit sudo/cgroup/install prerequisites
    └── [GAP] immutable action code in root/key-bearing job -> S3

Remote workflow execution: NOT RUN (review contract forbids dispatch).
Actual namespace/cgroup-v2 acceptance: OPEN, not inferred from static review.
```

## Task closure candidates

- **10.3 candidate for LEAD closure:** the current resolver implementation and 22 focused mutation cases cover the enumerated runtime resolver failures, including build-pinned anti-self-signing at runtime. This does not waive S1, which is the earlier package-authority creation boundary.
- **Do not close 3.7, 10.1, 10.2, 10.4, 10.5, or 10.6** in round 1. S1/S2/P1/P2/P3 block the build/export/package claims, P4 leaves the CI gate conclusion ambiguous, and S3 blocks privileged runner wiring.
- Task 10.7 remains correctly open; it was outside the implementation claim.

## Verification receipts

- `pnpm exec vitest run test/core/session-host/linux-process-authority-artifact-resolver.test.ts test/core/session-host/linux-process-authority-package-ci.test.ts` — **27 passed, 0 failed, 0 skipped**.
- `node scripts/build-linux-process-authority.mjs --check-only --target x86_64-unknown-linux-gnu` — **passed twice** for both primary helper and broker client as the concurrent broker delta stabilized; final receipt is `cross-build-non-runtime`, `runtimeAccepted: false`, current source SHA-256 `c98040d5b05e9643654bf8109082b0a2e5781699735c5ab59961e7acd85780dd`.
- `node scripts/build-linux-process-authority.mjs --plan --target aarch64-unknown-linux-gnu` — reported `dist/native/linux-arm64/...`; static provider manifest still points to x64 (P1).
- `pnpm exec vitest run test/core/session-host/process-capsule-package.test.ts test/core/session-host/process-capsule-provenance.test.ts` — **15 passed, 0 failed, 0 skipped**.
- Legacy `scripts/build-process-capsule.mjs` SHA-256 — `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92`, exactly matching the recorded baseline. Legacy protocol/capability assertions remain protocol v2 with Linux `pidfd + process-group`; no legacy source/manifest reinterpretation was found.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm exec eslint test/core/session-host/linux-process-authority-package-ci.test.ts` — passed.
- `node --check scripts/build-linux-process-authority.mjs` — passed.
- `JSON.parse(package.json)` and YAML parse of `.github/workflows/linux-process-authority.yml` — passed.
- `node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json` — **1 passed, 0 failed, 0 issues**.
- Windows mode probe — requested `0755`, observed `0666` (P2).

## Dirty-worktree and ownership check

- Review remained inside the isolated `wip/ecp-shared-bounded-loop-lifecycle-resume` worktree and made no product/test/task/run-state/native edits.
- The five package/CI target files retained stable SHA-256 values throughout review: script `e65ffd6f...dc43`, workflow `76f5d9b4...2252`, package test `c890a40f...625e`, `build.js` `498cbfad...175`, and `package.json` `286f3df4...f22`.
- The safety stash was not modified or removed. None of the five target paths appeared in its tracked or untracked trees.
- Concurrent broker/native changes were consumed only through the fresh check-only receipt; no concurrent file was reverted, normalized, formatted, or claimed as reviewer work.

## Durable findings for LEAD

1. Route S1/S2/P1/P2/P3 to the package/CI non-author fixer before another fresh review.
2. Treat S3 as a security gate: the protected broker job must not run mutable action code while sudo and broker private state are available.
3. Decide whether P4 should fail/skip a dedicated runtime check or publish another machine-readable OPEN state; do not let a green build job close Section 7.
4. Refresh final integrated provenance after native/broker stabilization; the implementation evidence hash is historical, not current.
5. No GitHub workflow, broker install, cgroup operation, push, PR, or external write was performed.
