## MODIFIED Requirements

### Requirement: Ship Execution

Ship SHALL commit, integrate, and deliver according to the resolved delivery mode, using a self-contained execution contract absorbed into the `/opsx:ship` workflow template. Tests SHALL be gated on evidence rather than run unconditionally. It SHALL NOT delegate to a gstack `/ship` expert skill.

#### Scenario: Merge base branch only in pr mode

- **WHEN** the ship phase executes in `pr` mode
- **THEN** the system SHALL fetch and merge the resolved integration base (the existing PR's base, an explicit base argument, or fork-point inference — never a blind repository default) into the current branch before the test gate
- **AND** if the merge produces conflicts that cannot be resolved automatically, the system SHALL stop and surface the conflicts

#### Scenario: No base merge outside pr mode

- **WHEN** the ship phase executes in `push` or `local` mode
- **THEN** the system SHALL NOT fetch or merge any base branch

#### Scenario: Evidence-based test gate

- **WHEN** the ship phase reaches the test gate
- **THEN** the system SHALL run the project's detected test command only if at least one holds: (a) the base merge introduced new commits, (b) no green test evidence exists for the current code state — i.e. no recorded passing test run (review report, review-cycle report, or run-state) whose recorded content tree fingerprint (`git rev-parse HEAD^{tree}`) matches the current tree fingerprint, or (c) the user explicitly requests it
- **AND** if tests run and any in-branch test fails, the system SHALL stop and NOT deliver

#### Scenario: Tests skipped on fresh evidence

- **WHEN** green test evidence exists for the current code state and the base merge introduced nothing new
- **THEN** the system SHALL skip the test run
- **AND** SHALL record the skip and the evidence source in the ship log

#### Scenario: Fresh-verification gate before delivery

- **WHEN** code changed after the last green test run (for example, from review fixes or lint fixes during commit)
- **THEN** the system SHALL re-run the tests and require fresh passing evidence before delivering

#### Scenario: Deliver per mode

- **WHEN** the test gate is satisfied
- **THEN** in `pr` mode the system SHALL push the branch with upstream tracking and create a pull request via `gh pr create`; in `push` mode it SHALL push the current branch without creating a PR; in `local` mode it SHALL NOT push and SHALL record that delivery is deferred to the portfolio/parent level
- **AND** the ship phase SHALL complete without invoking any gstack `/ship` expert skill

#### Scenario: Documentation sync is inline, not delegated

- **WHEN** the ship workflow reaches its post-ship documentation-sync step
- **THEN** it SHALL carry a minimal inline instruction to update project documentation to match the release
- **AND** it SHALL NOT reference or point at a `/document-release` skill

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change directory with shipping details, aware of the delivery mode.

#### Scenario: Ship log written after delivery in any mode

- **WHEN** the ship phase completes delivery (PR created, branch pushed, or local commit recorded)
- **THEN** the system SHALL write `openspec/changes/<name>/ship-log.md`
- **AND** the log SHALL include: the delivery mode, branch name, commit, the content tree fingerprint (`git rev-parse HEAD^{tree}`) of that commit, timestamp, the test decision (ran green, or skipped with the evidence source and the matched tree fingerprint), the PR URL in `pr` mode, and the deferral note in `local` mode

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes
- **THEN** the system SHALL update `ship-log.md` with deployment status and production verification results
