## ADDED Requirements

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
