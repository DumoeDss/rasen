# Linux process-authority package and CI implementation evidence 1

Date: 2026-08-06

## Scope and boundary

This work unit implements the additive build/export/package/CI slice for Tasks 10.1-10.6 and the build-seam portion of 3.7. It does not edit the Linux native primary or broker implementation, the TypeScript provider/runtime/resolver, the common provider contract, the legacy ProcessCapsule build source, production defaults, tasks, or pipeline run-state.

No external workflow was dispatched. No runner, VM, broker, key, service, cgroup, release, push, or PR was created or modified.

## Delivered build and package seam

- `scripts/build-linux-process-authority.mjs` is a source-owned CLI with four closed operations: native Linux build, staged-only assembly, cross-target check-only, and plan inspection.
- Native build requires exact Rust `1.88.0`, exact Cargo `1.88.0`, `cargo build --locked --release`, an explicit Linux target, and an isolated temporary Cargo target root.
- The deterministic source digest covers `Cargo.toml`, `Cargo.lock`, `THIRD_PARTY.md`, and every regular `src/**` input in sorted path order. Symlinked or non-regular source input fails closed.
- Staged inputs require a canonical, closed provenance record, the exact local source digest, exact pinned compiler, exact Linux target/architecture, exact `0755` provenance, a bounded nonempty regular helper, and `native-build-non-runtime`. A Windows cross-built artifact cannot be promoted into package authority.
- Assembly writes the primary helper and unprivileged broker client, one adjacent canonical artifact manifest for each mode, the exact two-provider client manifest, and a deterministic build-pinned identity table into the compiled `dist/**` module. The source TypeScript table remains empty; only an authenticated build output acquires authority.
- The packaged build-pinned table contains exactly the unprivileged primary helper and broker client. The separately installed root broker daemon is not a package artifact or build identity.
- Export copies only helper, broker client, their adjacent manifests, and public provenance. It does not copy the privileged broker daemon, installer, private key, lease/state directory, socket, or systemd unit.
- `build.js` invokes the Linux-provider build only on an actual Linux build host, after TypeScript compilation. Non-Linux builds do not emit a runtime-selectable Linux artifact.
- `package.json` exposes explicit build/check commands. Existing `files: ["dist", ...]` includes the assembled helper/client/manifests while leaving `native/**` broker administration assets outside npm.

## Resolver and package mutation coverage

The existing adjacent-artifact resolver suite plus the new package/CI suite cover:

- missing helper and manifest, foreign platform/architecture, future schema/protocol/reference, wrong provider/mode/capability/executable mode/length/hash/source/compiler trust;
- helper/manifest/package-trust self-signing, non-canonical manifest, symlink, path escape, setuid/setgid/sticky or insecure ownership/mode, opened-file replacement, and build-authority mismatch;
- no PATH search, child-process resolver, shell, download, runtime compiler, ProcessCapsule reinterpretation, or legacy-helper fallback;
- deterministic dual-artifact reassembly, missing/empty staged artifact rejection, cross-build staging rejection, package inclusion, and privileged broker/private-state exclusion.

## CI trust boundary

`.github/workflows/linux-process-authority.yml` provides three separate jobs:

1. `linux-provider-primary` is an unprivileged Ubuntu job. It provisions pinned Rust, builds the helper and broker client natively, runs non-privileged native contracts, probes user/PID/mount namespace policy, and runs the actual primary target only when that probe succeeds. A denied probe writes an explicit `OPEN` gate summary; it is not called a passing runtime receipt.
2. `windows-linux-target-shape` installs the Linux Rust target, runs `cargo check --locked`, and labels the output `cross-build-non-runtime` with `runtimeAccepted: false`.
3. `broker-privileged-manual` is reachable only from `workflow_dispatch` in `DumoeDss/rasen`, with the exact `writable-cgroup-v2+sudo` acknowledgement, a protected environment, and a labelled self-hosted runner. It requires passwordless noninteractive sudo, writable cgroup-v2 controls, and the explicit installed broker binary/public manifest/private state/lease root/socket. Its final summary keeps Section 9 open. Ordinary PR, push, merge, and fork jobs contain no sudo path.

`cancel-in-progress` is false so a future protected authority operation is not interrupted by workflow concurrency.

## TDD receipts

Public seams were fixed before implementation: build/staging CLI output, package boundary, Windows cross-target classification, and parsed workflow permissions.

1. Initial RED: `pnpm exec vitest run test/core/session-host/linux-process-authority-package-ci.test.ts` — 4/4 failed because the script and workflow were absent.
2. Initial GREEN: the same command — 4/4 passed.
3. Staging-bound RED: the focused empty/cross-built test failed because an empty helper was accepted.
4. Staging-bound GREEN: empty length was bounded and both empty/cross-built cases passed.
5. Privileged-bound RED: the focused CI test failed because installed broker paths were not proven.
6. Privileged-bound GREEN: exact installed binary/manifest/key/lease/socket probes were added and the focused test passed.
7. Dual-artifact RED: the package seam failed because the newly landed broker client was absent from assembly.
8. Dual-artifact GREEN: helper and broker client now receive separate manifests, hashes, exports, and build-pinned identities; a missing client fails closed.

## Verification receipts

All commands ran from the isolated worktree on Windows PowerShell 5.1 unless named otherwise.

```text
pnpm exec vitest run \
  test/core/session-host/linux-process-authority-artifact-resolver.test.ts \
  test/core/session-host/linux-process-authority-package-ci.test.ts
  27 passed, 0 failed, 0 skipped

node scripts/build-linux-process-authority.mjs \
  --check-only --target x86_64-unknown-linux-gnu
  primary helper + broker client cargo check --locked: passed
  evidenceClassification: cross-build-non-runtime
  runtimeAccepted: false
  compiler: rustc 1.88.0 (6b00bc388 2025-06-23)
  sourceSha256 at final receipt: 4875fc23401b3e8437a7982469a3a784ca5f7d9be601014771a3bf896c82181a

pnpm exec tsc --noEmit
  passed

node --check scripts/build-linux-process-authority.mjs
pnpm exec eslint test/core/session-host/linux-process-authority-package-ci.test.ts
JSON.parse(package.json)
  all passed

rasen validate ecp-linux-process-authority-provider --strict --json
  1 passed, 0 failed, 0 issues

legacy scripts/build-process-capsule.mjs SHA-256
  4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92
  matches the recorded migration baseline; targeted legacy diff is empty
```

## Task evidence for LEAD

- 10.1: implemented and locally verified through deterministic staging assembly plus the pinned Windows target check. Actual Linux workflow execution remains a CI receipt, not a local claim.
- 10.2: implemented for npm helper/client/manifests/exact provider entries; privileged broker service/private material stays outside npm.
- 10.3: implemented by the 22 resolver mutations plus five package/CI contracts.
- 10.4: implemented; the installed Windows Linux target passed the final locked dual-binary cargo check and is explicitly non-runtime. The first dual-binary run exposed concurrent broker-client enum errors; its owner fixed them, and the superseding command above passed without warnings.
- 10.5: workflow implementation complete; hosted namespace-policy denial remains an explicit open gate until a real run.
- 10.6: protected manual-only wiring complete; no manual job was dispatched and no Section 9 acceptance is claimed.
- 3.7: the additive isolated build/export/staging seam is implemented without changing legacy ProcessCapsule source or meaning. Task 10.7 remains a later integration regression gate.

The LEAD remains the only writer of `tasks.md` and `.rasen/**` run-state.

## Truthful limitations

- The new Linux workflow was prepared but not pushed or run, so it has no remote receipt.
- This work unit did not rerun the new build CLI inside WSL. The isolated WSL Rust installation has no persistent host linker wrapper; no profile/system mutation or improvised linker receipt was introduced. Existing WSL round-3 native receipts predate this packaging script and are not relabelled as its execution.
- Broker production lifecycle and the installed cgroup-v2 Section 9 matrix remain open. A green manual wiring job would still be non-terminal until the named actual service/lifecycle/security receipts exist.
- Clean-distribution, multi-architecture package installation, closure integration, and ECP-8 release truth remain later gates.
