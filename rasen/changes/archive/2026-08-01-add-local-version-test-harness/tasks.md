## 1. Harness Contract and Test Seams

- [x] 1.1 Add the `scripts/local-version/` module and launcher layout with a machine-readable prepare interface.
- [x] 1.2 Add focused fixtures/tests for source and project resolution, CLI/UI version pairing, Windows/space-containing paths, and stable error diagnostics.
- [x] 1.3 Add tests proving target-project package files remain byte-identical and non-Node targets receive no harness package files.

## 2. Runtime Identity and Isolation

- [x] 2.1 Implement relevant-input content fingerprinting with platform/toolchain identity and deterministic cache metadata.
- [x] 2.2 Implement cache staging, bounded per-key locking, atomic publication, warm verification, and corrupt-entry fail-closed behavior.
- [x] 2.3 Implement stable source/project/version machine homes, isolated daemon ports, telemetry opt-out, and child-only environment overlays.

## 3. Paired Package Materialization

- [x] 3.1 Implement independent CLI/UI dependency preparation and builds using their existing package-manager contracts.
- [x] 3.2 Pack both local packages, install them beside each other in a private runtime, and preserve build logs/exit diagnostics.
- [x] 3.3 Validate installed manifests, CLI `--version`, UI entry assets, and the CLI's actual UI resolver before publishing the cache entry.
- [x] 3.4 Detect source changes across a cold build and discard/retry instead of publishing stale content.

## 4. User-Facing Launchers

- [x] 4.1 Implement the Rasen PowerShell launcher with source/project defaults, argument/stdio forwarding, and target exit-code propagation.
- [x] 4.2 Implement Codex and Claude PowerShell launchers that preserve profile-defined commands while exposing the local Rasen on `PATH`.
- [x] 4.3 Add launcher tests proving bare `rasen` resolution, environment restoration, agent argument forwarding, and global-version non-interference.

## 5. Documentation and Verification

- [x] 5.1 Document usage for arbitrary worktrees/projects, cold/warm cache behavior, local state paths, troubleshooting, and prototype migration.
- [x] 5.2 Run focused tests on Windows and add cross-platform path/process coverage suitable for the existing CI matrix.
- [x] 5.3 Run an end-to-end cold prepare, warm cache hit, real CLI/UI check, and mocked Codex/Claude session against an empty project.
