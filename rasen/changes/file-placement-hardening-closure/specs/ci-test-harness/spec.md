## MODIFIED Requirements

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

## ADDED Requirements

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
