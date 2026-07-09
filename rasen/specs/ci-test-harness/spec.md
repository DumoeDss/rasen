# ci-test-harness Specification

## Purpose

This spec defines the cross-platform CI test matrix and the hardened CLI-spawn test harness that keeps Windows test runs from hanging or leaking processes. It governs `.github/workflows/ci.yml`'s PR/merge-group matrix, the `runCLI` test helper (`test/helpers/run-cli.ts`), global vitest teardown, and the retrying temp-directory cleanup helper (`test/helpers/temp-cleanup.ts`) used across CLI e2e/command tests. The spec exists to make Windows CLI-spawning tests reliable: bounded per-OS vitest workers, guaranteed process-tree termination on timeout, telemetry disabled in spawned CLIs, and retrying cleanup for transient locked-handle errors.

## Requirements

### Requirement: Cross-Platform Test Matrix on Pull Requests

CI SHALL run the test suite across a Linux/macOS/Windows matrix on pull requests and merge groups (not only on `push`), with a bounded number of vitest workers per operating system so that resource contention on the slower Windows runner does not cause flaky timeouts.

#### Scenario: Matrix runs on pull requests

- **WHEN** a pull request or merge group triggers CI
- **THEN** the `test_matrix` job runs on `ubuntu-latest`, `macos-latest`, and `windows-latest`
- **AND** a single required status check named `Test` passes only when every matrix leg succeeds

#### Scenario: Bounded vitest workers per OS

- **WHEN** the test step runs on a matrix leg
- **THEN** the maximum number of vitest workers is capped per OS (fewer workers on Windows than on Linux/macOS)
- **AND** the cap is supplied via the `VITEST_MAX_WORKERS` environment variable that the vitest config already reads

### Requirement: Hardened CLI-Spawn Test Harness

The `runCLI` test helper SHALL guarantee that a spawned CLI process cannot hang or leak a test worker, and SHALL disable telemetry in spawned CLIs so a keep-alive network socket cannot delay process exit.

#### Scenario: Every spawned CLI has a timeout and whole-tree termination

- **WHEN** a test spawns the CLI via `runCLI` and the process exceeds the timeout (default 30 s)
- **THEN** the helper terminates the entire process tree (via `taskkill /t /f` on Windows, or a process-group kill on POSIX)
- **AND** the returned/rejected result includes a descriptive timeout error with the invocation and stdout/stderr tails

#### Scenario: Telemetry is disabled in spawned CLIs

- **WHEN** the harness spawns a CLI
- **THEN** it sets `RASEN_TELEMETRY=0` in the child environment
- **AND** it preserves the test config/data isolation (`XDG_CONFIG_HOME`/`XDG_DATA_HOME`) already applied by the harness

#### Scenario: No worker is left alive after the suite

- **WHEN** the global vitest teardown runs
- **THEN** it calls `terminateActiveCliChildren()` to kill any still-registered spawned CLI processes
- **AND** it does not rely on a forced `process.exit` timer

### Requirement: Machine Data Root Isolation for Test Runs

The test harness SHALL guarantee that no test — in-process or spawned — writes the developer's or CI's real machine data root (`~/.rasen`). The vitest global setup SHALL force the machine data root to a per-run temporary directory before test workers execute, as a safety net that catches any suite which resolves the machine home without an explicit override. The temporary root SHALL be removed on global teardown. This safety net SHALL NOT replace per-test isolation: suites that resolve the machine home SHALL still pass an explicit per-test data directory where practical, and the global net exists to contain leaks, not to license unisolated writes.

#### Scenario: Global setup redirects the machine root before workers run

- **WHEN** the vitest global setup runs
- **THEN** it SHALL create a per-run temporary directory and set `RASEN_HOME` to it so every in-process `getGlobalDataDir()` resolves under the temporary root (inherited by forked workers)
- **AND** an in-process test that registers a project SHALL write the temporary root, never the real `~/.rasen`

#### Scenario: Temporary root removed on teardown

- **WHEN** the vitest global teardown runs
- **THEN** the per-run temporary machine root SHALL be removed (best-effort, using the retrying cleanup helper on a busy handle)

#### Scenario: Spawned-CLI isolation is preserved

- **WHEN** a test spawns the CLI via `runCLI`
- **THEN** the harness's existing `XDG_CONFIG_HOME`/`XDG_DATA_HOME` isolation and blanked `RASEN_HOME` for spawned CLIs SHALL still apply
- **AND** the global machine-root safety net SHALL NOT redirect a spawned CLI away from that isolation

### Requirement: Retrying Temp-Directory Cleanup

Tests that create temp directories SHALL remove them via a retrying cleanup helper so a transient Windows `EBUSY`/locked-handle does not fail an otherwise-passing test.

#### Scenario: Cleanup retries on a busy handle

- **WHEN** a test tears down its temp directory through `cleanupTempPath()`
- **THEN** the removal uses `recursive`, `force`, and bounded retries with a short delay (`maxRetries: 5`, `retryDelay: 100`)
- **AND** a still-held handle is retried rather than immediately throwing

### Requirement: Node Version Range Coverage

CI SHALL verify the declared supported Node version range (`engines.node >= 20.19.0`) at both ends: the existing per-OS legs run at the floor version, and at least one additional leg runs at the current Node major on Linux, so a break specific to a newer Node runtime is caught without exploding the matrix to a full OS × version grid.

#### Scenario: Floor version covered on every OS

- **WHEN** the `test_matrix` job runs
- **THEN** the `ubuntu-latest`, `macos-latest`, and `windows-latest` legs run the test suite on the `engines.node` floor version (20.19.0)

#### Scenario: Current Node major covered on Linux

- **WHEN** the `test_matrix` job runs
- **THEN** at least one additional `ubuntu-latest` leg runs the test suite on the current Node major (a version newer than the floor)
- **AND** that leg has a distinct matrix `label` so its status check name does not collide with the floor Linux leg

#### Scenario: Added leg does not touch the Windows flake surface

- **WHEN** the node-version coverage leg is added
- **THEN** it runs on Linux with the standard Linux vitest worker cap, and the Windows leg retains its reduced worker cap, so the added coverage does not aggravate the known Windows locked-handle flakiness
