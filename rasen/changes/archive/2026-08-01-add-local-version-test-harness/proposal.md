## Why

Rasen maintainers need to keep a stable global release for daily work while exercising incompatible local development versions against real projects. The current ad-hoc link scripts hard-code one version, mutate the target project's Node manifests, and can silently omit the separately packaged UI or share machine state and daemon ports across versions.

## What Changes

- Add a repository-owned local-version harness that prepares an isolated, release-faithful runtime from any Rasen source worktree.
- Build, pack, install, and validate the CLI and UI as one local compatibility pair without modifying the target project's `package.json`, lockfile, or `node_modules`.
- Cache immutable prepared runtimes by source content and toolchain identity while keeping machine data and daemon selection isolated per source version and target project.
- Provide thin PowerShell launchers for running Rasen commands and starting Codex or Claude with the prepared runtime first on `PATH`.
- Preserve the user's global Rasen, normal machine home, agent authentication/configuration, and parent-shell environment.
- Document local-version usage, cache behavior, failure diagnostics, and the relationship to the existing release checks.

## Capabilities

### New Capabilities

- `local-version-test-harness`: Prepare and launch isolated local Rasen CLI/UI versions against arbitrary projects and agent sessions.

### Modified Capabilities

None.

## Impact

- New developer tooling under `scripts/local-version/` and focused tests under `test/scripts/`.
- Reuses the root and `packages/ui` package/build contracts plus the existing CLI UI resolver behavior.
- Creates cache, staging, runtime, home, and metadata directories under a dedicated machine-local harness root; does not change global installation state.
- Adds no production CLI command and no runtime dependency to the published `@atelierai/rasen` package.
