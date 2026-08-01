# ci-test-harness Specification

## Purpose

This spec defines the cross-platform CI test matrix and the hardened CLI-spawn test harness that keeps Windows test runs from hanging or leaking processes. It governs `.github/workflows/ci.yml`'s PR/merge-group matrix, the `runCLI` test helper (`test/helpers/run-cli.ts`), global vitest teardown, and the retrying temp-directory cleanup helper (`test/helpers/temp-cleanup.ts`) used across CLI e2e/command tests. The spec exists to make Windows CLI-spawning tests reliable: bounded per-OS vitest workers, guaranteed process-tree termination on timeout, telemetry disabled in spawned CLIs, and retrying cleanup for transient locked-handle errors.

## Requirements

### Requirement: Cross-Platform Test Matrix on Pull Requests

CI SHALL run the repository test suite across a Linux/macOS/Windows matrix on pull requests and merge groups, with a bounded number of Vitest workers per operating system. In addition to the general matrix, CI SHALL run a dedicated file-placement archive fault/recovery suite on native `ubuntu-latest`, `macos-latest`, and `windows-latest` runners at the supported Node.js floor version. The required aggregate check SHALL pass only when both the general matrix and every dedicated native recovery leg succeed.

#### Scenario: Matrix runs on pull requests

- **WHEN** a pull request or merge group triggers CI
- **THEN** the general `test_matrix` job SHALL run on `ubuntu-latest`, `macos-latest`, and `windows-latest`
- **AND** the required test status SHALL pass only when every general and dedicated file-placement matrix leg succeeds

#### Scenario: Bounded Vitest workers per OS

- **WHEN** a general or focused test step runs on a matrix leg
- **THEN** the maximum number of Vitest workers SHALL be capped per OS, with a lower cap permitted on Windows
- **AND** the cap SHALL be supplied through the `VITEST_MAX_WORKERS` environment variable consumed by the Vitest configuration

#### Scenario: Archive recovery runs on three native hosts

- **WHEN** CI runs the dedicated file-placement recovery job
- **THEN** the explicit archive engine, fault-matrix, accounting, ephemera, and cleaner regression files SHALL run on native Windows, macOS, and Linux filesystems
- **AND** the job SHALL exercise the real temporary-filesystem cases in those files rather than substituting path-flavor helper assertions

#### Scenario: Remote evidence is claimed only from remote results

- **WHEN** local tests exercise `win32` and `posix` path helpers on one host
- **THEN** those results SHALL be recorded only as deterministic path-semantic evidence
- **AND** native Windows/macOS/Linux acceptance SHALL remain pending until the corresponding remote CI legs have actually completed successfully

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

### Requirement: Repository-wide test completion is bounded and auditable

The local test-result gate SHALL account for every discovered repository test file with a Vitest summary and an exit status produced within an externally enforced 480-second bound. A monolithic `pnpm test` run MAY provide that evidence. If it fails to produce a summary, diagnosis SHALL use direct sequential deterministic partitions that cover each discovered test file exactly once. A timeout, missing summary, nonzero exit, missing partition, duplicate partition assignment, or count mismatch SHALL keep the gate blocked and SHALL NOT be reported as a pass. Local read-only process observations are diagnostic only: without spawn-time OS lineage capability, process cleanliness SHALL be reported as `NOT EVALUATED`, and closure SHALL NOT perform bespoke/manual process termination. Process isolation and cleanup belong to CI/orchestration infrastructure, with the required remote jobs remaining the delivery gate.

#### Scenario: Monolithic suite completes honestly

- **WHEN** `pnpm test` terminates within its declared bound
- **THEN** release evidence SHALL record its command, elapsed time, test-file and test counts, skips, exit status, and final summary
- **AND** this result SHALL prove test completion only, not process lineage or process cleanliness

#### Scenario: No-summary run enters bounded diagnosis

- **WHEN** the repository-wide command reaches its bound without a Vitest summary
- **THEN** the run SHALL be recorded as a failure or unresolved hang rather than a pass
- **AND** diagnosis SHALL run direct deterministic bounded partitions before another full-suite claim is attempted
- **AND** it SHALL NOT automatically terminate processes through a closure-owned or manual cleanup procedure

#### Scenario: Partitioned aggregate proves complete coverage

- **WHEN** bounded partitions are used as the complete local gate
- **THEN** release evidence SHALL show that their manifest union equals the discovered test-file inventory and that their pairwise intersections are empty
- **AND** every partition SHALL terminate with a Vitest summary and successful exit status
- **AND** the aggregate SHALL report total passed, failed, skipped, and test-file counts

#### Scenario: Local process cleanliness is not inferred

- **WHEN** the local orchestrator lacks spawn-time OS lineage capability
- **THEN** release evidence SHALL report process cleanliness as `NOT EVALUATED`
- **AND** a read-only observation acquisition or parse failure SHALL NOT alter the independently recorded Vitest summary and exit facts
- **AND** it SHALL NOT be converted into a claim that descendants survived or did not survive

#### Scenario: Observed or suspected survivor keeps release blocked

- **WHEN** a bounded test invocation times out or a read-only diagnostic observes or raises a credible suspicion of a surviving CLI or Vitest process
- **THEN** release readiness SHALL remain blocked for CI/orchestration investigation
- **AND** local closure evidence SHALL NOT label that process invocation-owned without proof
- **AND** closure SHALL NOT use bespoke/manual termination to manufacture a clean result
