## 1. Lockstep Version Contract

- [x] 1.1 Set the UI package and lockfile to the root CLI version `0.1.5`.
  - The standalone UI lockfile records only its dependency graph, not the package's own version; the manifest changed and frozen-install verification covers lockfile consistency.
- [x] 1.2 Add a cross-platform release helper that validates canonical CLI/UI/tag version equality.
- [x] 1.3 Add tests for matching versions, drift, malformed/four-component versions, and tag mismatch.

## 2. Curated Release Notes

- [x] 2.1 Bound the Rasen-owned section of `CHANGELOG.md` with explicit history markers.
- [x] 2.2 Extend the release helper to extract exactly one matching version section and write GitHub Release notes.
- [x] 2.3 Test missing markers, missing/duplicate release sections, and exclusion of retained upstream history.

## 3. Paired Package Verification

- [x] 3.1 Add a paired pack guard that verifies root CLI `--version`, UI manifest version, and `package/dist/index.html` using cross-platform temporary paths.
- [x] 3.2 Add a root package script and focused tests for the paired pack guard.

## 4. Unified Release Workflow

- [x] 4.1 Update the release job to install, test, build, pack, and upload both packages with curated notes.
- [x] 4.2 Replace CLI-only npm publication with one guarded CLI-then-UI provenance publication job.
- [x] 4.3 Keep site notification dependent on successful GitHub Release creation and independent of the optional npm channel.
- [x] 4.4 Add static workflow assertions for paired build order, token gating, two publishes, release notes, and notification dependencies.

## 5. Documentation and Verification

- [x] 5.1 Document lockstep 0.1.x servicing, including UI-only fixes advancing both packages by one normal patch.
- [ ] 5.2 Run release-helper tests, CLI and UI tests/builds, both frozen installs, paired pack verification, workflow syntax checks, and Windows-sensitive path tests.
  - Release tests (18/18), CLI/UI builds, UI tests (410/410), both frozen installs, paired packs, YAML parsing, and Windows npm execution passed. The full CLI suite exceeded 15 minutes in the shared workstation while another worktree's Vitest run was active; the release workflow retains the clean-runner CLI test gate.
- [x] 5.3 Validate the Rasen change artifacts without creating or pushing a Rasen release tag.
