# Fresh review: Linux process-authority package/CI round 2

Date: 2026-08-06
Mode: dispatched, report-only, non-author review
Scope: package/build/export/CI delta only; Tasks 3.7 and 10.1-10.7 accounting candidates

## Verdict

**CLEAN FOR PACKAGE/CI SOURCE — the round-1 package/CI fixes close PKG-S1, PKG-S2, PKG-S3, P1, P2, P3, and P4 in source, and the short delta re-review closes PKG-M1. P5 and the final integrated receipts remain HOLD until the broker source is frozen.**

No Blocker or Major remains in the five package-owned files. The source review confirms that staged authority cannot self-sign changed executable bytes, native provenance is tied to an isolated snapshot and exact toolchain/config inputs, the protected broker job has no mutable GitHub Action, architecture and Windows assembly claims fail or resolve correctly, package/export replacement has a closed inventory, namespace denial cannot appear as a green actual-runtime gate, and the bundled `rust-lld` probe uses an explicit GNU flavor.

The exact current tree is not integration-green: the Windows cross-target `--check-only` reached the concurrent broker source and failed because `broker_guardian.rs` reads private field `PreparedPrimary.runtime_root`. This is outside the package-owned delta and confirms that the broker is not source-frozen; it must not be converted into P5 or final package evidence. The WSL native musl build passed the new `rust-lld -flavor gnu --version` seam and then failed only because the isolated WSL environment has no host `cc`. No toolchain or system package was installed.

Scope check: **CLEAN.** All five implementation files and the four-line workflow trigger correction remain inside the declared package/CI slice. No product default, ProcessScope integration, native implementation, task checkbox, run-state, workflow dispatch, administrative state, or external repository state was changed by this review.

## Standards axis

### PKG-M1 — Minor — RESOLVED — dedicated workflow path filters omitted two package-owned inputs

- Evidence: `.github/workflows/linux-process-authority.yml:4-28` triggers for the native crate, Linux provider source, build script, focused tests, and the workflow, but not `build.js` or `package.json`. Those files are package-owned inputs in this Change: `build.js:31-36` selects the Linux authority build, while `package.json:35-60` controls the npm inventory and the public build/check commands.
- Impact: a later change that only removes the build integration or weakens the npm exclusion boundary will run the repository-wide CI, but it will skip the dedicated Linux provider build/package workflow. The general CI is a mitigation, so this is Minor rather than Major; the named package gate is still not closed over all of its inputs.
- Required action (AUTO-FIX candidate for a non-author fixer): add `build.js` and `package.json` to both dedicated workflow path filters and extend the parsed workflow contract to assert their presence.
- Resolution: `.github/workflows/linux-process-authority.yml:9-10,20-21` now includes `build.js` and `package.json` exactly once in both `pull_request.paths` and `push.paths`. Removing exactly those four added lines reconstructs the previously reviewed workflow SHA-256 `ac46463416eac93f88bd6a2276a374d929c366fb3cece3987f5d76dd2ef8592a`, proving the fix introduced no other workflow delta. YAML parsing, strict UTF-8/no-BOM validation, exact path-set assertions, and the focused privilege-bound workflow test pass.

Standards count: **0 open findings; 1 historical Minor resolved.**

## Spec axis and round-1 closure matrix

| Item | Round-2 result | Evidence |
|---|---|---|
| PKG-S1 / S1 | **CLOSED in source** | `trustedReleaseInput()` requires a canonical release input outside staging plus an externally supplied exact SHA-256; staged helper/client bytes must match trusted length/hash and exact ELF64 little-endian target machine before manifests or build authority are written. WSL mutations for changed release input, changed bytes, and foreign ELF machine passed. |
| PKG-S2 / S2 | **CLOSED in source** | The build rejects compiler/linker overrides, copies all declared crate inputs into a private read-only snapshot, checks snapshot and live digests before/after Cargo, rejects ancestor Cargo config, creates a fresh `CARGO_HOME`, executes exact sysroot Cargo/rustc binaries, hashes config/toolchain/linker/environment identity, and uses locked explicit-target Cargo commands. The source-drift mutation passed. Final native artifact evidence remains held below. |
| PKG-S3 / S3 | **CLOSED in source** | The protected broker job uses only `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`; it provisions no mutable setup Action after entering the protected runner and verifies the preinstalled exact Rust/Cargo versions before sudo/key/cgroup probes. Ordinary and fork-triggered jobs have no privileged path. |
| P1 | **CLOSED** | Provider manifests are emitted per assembled architecture (`providers-linux-x64.json`, `providers-linux-arm64.json`). Arm64-only and dual-architecture WSL assembly tests prove every advertised path exists and no x64 path is substituted. |
| P2 | **CLOSED** | Authoritative assembly calls `assertAuthoritativeModeSupport()` and refuses Windows before writing a manifest that claims POSIX `0755`. The Windows package suite exercised the closed refusal; Windows plan/check evidence remains explicitly non-runtime. |
| P3 | **CLOSED in source** | Package and export contents are first built in mode-checked private trees, verified against exact inventories, then installed through rename/rollback replacement. Successful replacement removes stale architecture, foreign manifest, daemon, key, and export assets. A real `npm pack --dry-run --json --ignore-scripts` packlist excludes broker daemon/private/state/socket/service/lease material. |
| P4 | **CLOSED** | Namespace classification has a separate JSON-shaped output. The named actual-runtime job uses `if: always()` and exits `1` when policy is not `available`; the parsed workflow test proves an unexecuted kernel oracle cannot become a green runtime receipt. |
| P5 | **HOLD** | No digest observed before broker source freeze is final. The current exact-tree Windows cross-target command fails in concurrent broker code, so neither the older `c98040...80dd`, the fixer’s pre-freeze `9d3367...1843`, nor any review-time source hash closes P5. |
| `rust-lld` probe | **CLOSED in source** | The script invokes the bundled driver as `rust-lld -flavor gnu --version`. Direct WSL execution returned `LLD 20.1.5 ... (compatible with GNU linkers)`, and the native package command advanced past this probe before stopping at missing host `cc`. |

Spec count: **0 package-source findings.** P5 and final integration are explicit holds, not optimistic passes.

## Coverage map

```text
PACKAGE / BUILD PATHS
=====================
[+] trusted release -> staged bytes -> ELF validation -> manifests/table
    ├── [★★★ TESTED] externally pinned canonical release input
    ├── [★★★ TESTED] changed executable bytes fail closed
    └── [★★★ TESTED] wrong x64/arm64 ELF machine fails closed
[+] native source -> immutable snapshot -> isolated Cargo/toolchain
    ├── [★★★ TESTED] compiler override rejected
    ├── [★★★ TESTED] live-source drift after snapshot rejected
    ├── [★★  TESTED] exact sysroot/config/linker contract
    └── [HOLD] final frozen-tree native artifacts and digest
[+] architecture / filesystem authority
    ├── [★★★ TESTED] arm64-only and x64+arm64 manifests
    └── [★★★ TESTED] Windows authoritative assembly refuses 0755 claim
[+] private assembly/export replacement
    ├── [★★★ TESTED] stale architecture/manifest/privileged assets removed
    ├── [★★★ TESTED] actual npm dry-run packlist excludes privileged state
    └── [★★  REVIEWED] rename exception rollback and closed mode inventory

CI PATHS
========
[+] unprivileged Linux build/package job
    └── [★★ STATIC + LOCAL] locked build/test commands; no sudo
[+] actual namespace runtime gate
    └── [★★★ CONTRACT] denied/open state exits nonzero and remains machine-readable
[+] protected broker wiring
    └── [★★ STATIC] manual canonical-repo input + environment + labelled runner,
        full-SHA Action use, preinstalled pinned tools, explicit sudo/cgroup/install probes
[+] dedicated workflow trigger closure
    └── [★★★ TESTED] build.js and package.json appear exactly once in both
        pull_request and push path sets; four-line-only delta proved -> PKG-M1 CLOSED

Remote workflow execution: NOT RUN (review contract forbids dispatch).
Actual installed broker/cgroup-v2 acceptance: OPEN.
Clean distribution, release, and multi-OS acceptance: ECP-8, not inferred here.
```

## Task closure candidates for LEAD

- **10.2 remains a source-closure candidate:** helper/client manifests and exact per-architecture provider entries are included; privileged daemon/key/state/install assets remain outside implicit npm installation.
- **10.3 remains closed:** resolver and package mutation coverage is green.
- **10.5 and 10.6 are source-closure candidates:** PKG-M1 is resolved and the workflow source is closed over the package-owned inputs. Remote hosted and protected-runner execution remain separate evidence gates; Section 9 remains open regardless of source wiring.
- **Do not close 3.7, 10.1, or 10.4 from this report alone.** Their package source is present, but the final frozen-tree cross/native artifact receipt is unavailable while broker source is still changing and currently not cross-check clean. The separately installed broker daemon build/install truth also remains owned by the broker and Section 9 gates.
- **10.7 remains open.** Legacy focused tests and the legacy build-script hash are green, but the task calls for the full integration regression gate after source freeze.
- **P5 is not a task closure candidate.** Capture the final integrated source digest and helper/client artifact identities only after broker source freeze, then rerun Windows `--check-only` and native Linux packaging.

## Verification receipts

1. `pnpm exec vitest run` for artifact resolver, package/CI, legacy package, and legacy provenance — **47 passed, 0 failed, 0 skipped** (22 + 10 + 13 + 2).
2. `pnpm exec tsc --noEmit` — **passed**.
3. `pnpm exec eslint scripts/build-linux-process-authority.mjs test/core/session-host/linux-process-authority-package-ci.test.ts` — **passed**.
4. Node syntax, `package.json` parse, and workflow YAML parse — **passed**.
5. `node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json` — **1 passed, 0 failed, 0 issues**.
6. Windows `node scripts/build-linux-process-authority.mjs --check-only --target x86_64-unknown-linux-gnu` — **pre-freeze integration failed outside package ownership** at `broker_guardian.rs:547`, private field `PreparedPrimary.runtime_root`; no final digest emitted.
7. WSL `pnpm dlx vitest@3.2.6 run test/core/session-host/linux-process-authority-package-ci.test.ts` — **10 passed, 0 failed**.
8. WSL native musl build/export command — `rust-lld` probe passed, then **environment-open** at host build scripts because `linker cc not found`; no compiler was installed and no artifact/package success is claimed.
9. Direct WSL `rust-lld -flavor gnu --version` — **passed**, LLD 20.1.5 GNU-compatible driver.
10. x64 and arm64 `--plan` commands — exact architecture-correct artifact paths; both classified `cross-build-non-runtime`, `runtimeAccepted: false` on Windows.
11. Legacy `scripts/build-process-capsule.mjs` SHA-256 — `4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92`, unchanged from the accepted baseline.

Verification command groups: **11**. Remote workflow, broker install, sudo/cgroup mutation, push, PR, and release commands: **0**.

### Short delta re-review receipts

12. Parsed workflow assertion — `build.js` and `package.json` occur exactly once in both `pull_request.paths` and `push.paths`; no duplicate path exists — **passed**.
13. Delta identity proof — removing only those four path entries reconstructs prior reviewed workflow SHA-256 `ac46463416eac93f88bd6a2276a374d929c366fb3cece3987f5d76dd2ef8592a` — **passed**; no trigger-scope regression or unrelated workflow edit.
14. Strict UTF-8/no-BOM and YAML parse for `.github/workflows/linux-process-authority.yml`, Node syntax check for the package script, and focused workflow privilege-bound Vitest — **passed** (1 selected test passed, 9 unselected tests reported skipped by the filter).

Total verification command groups after delta re-review: **14**. P5 remains HOLD; no frozen-tree build receipt was claimed or rerun by this short review.

## Ownership and durable findings for LEAD

- The five package/CI file hashes remained exactly the fixer-recorded values throughout review; no concurrent package file changed underneath the review.
- This reviewer wrote only this report. No product, test, task, run-state, native, workflow source, package metadata, commit, stash, or external state was modified.
- PKG-M1 is resolved by an independently verified four-line trigger correction; no further package/CI source fix is open from round 2.
- Treat the Windows compile error as broker-source/freeze evidence, not a package regression and not final P5 evidence. Rerun only after broker fixes make the exact tree compile-clean.
- Treat the WSL missing `cc` result as an environment-open receipt. Do not install a host compiler under this review contract.
- Keep the installed broker/cgroup-v2 matrix, remote workflow receipts, final clean package/install matrix, closure integration, and ECP-8 release claims open.
