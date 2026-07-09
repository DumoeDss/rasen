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

### Requirement: Retrying Temp-Directory Cleanup

Tests that create temp directories SHALL remove them via a retrying cleanup helper so a transient Windows `EBUSY`/locked-handle does not fail an otherwise-passing test.

#### Scenario: Cleanup retries on a busy handle

- **WHEN** a test tears down its temp directory through `cleanupTempPath()`
- **THEN** the removal uses `recursive`, `force`, and bounded retries with a short delay (`maxRetries: 5`, `retryDelay: 100`)
- **AND** a still-held handle is retried rather than immediately throwing
