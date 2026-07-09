## MODIFIED Requirements

### Requirement: Ship Execution

Ship SHALL run tests, push the branch, and create a PR using a self-contained execution contract absorbed into the `/opsx:ship` workflow template. It SHALL NOT delegate to a gstack `/ship` expert skill.

#### Scenario: Merge base branch before tests

- **WHEN** the ship phase executes
- **THEN** the system SHALL fetch and merge the base branch into the feature branch before running tests
- **AND** if the merge produces conflicts that cannot be resolved automatically, the system SHALL stop and surface the conflicts

#### Scenario: Run tests and stop on failure

- **WHEN** the ship phase executes
- **THEN** the system SHALL run the project's detected test command against the merged code
- **AND** if any in-branch test fails, the system SHALL stop and NOT push

#### Scenario: Fresh-verification gate before push

- **WHEN** code changed after the test run (for example, from review fixes)
- **THEN** the system SHALL re-run the tests and require fresh passing evidence before pushing

#### Scenario: Push and create PR

- **WHEN** tests pass and the working state is verified
- **THEN** the system SHALL push the branch to the remote with upstream tracking
- **AND** SHALL create a pull request via `gh pr create`
- **AND** the ship phase SHALL complete without invoking any gstack `/ship` expert skill

#### Scenario: Documentation sync is inline, not delegated

- **WHEN** the ship workflow reaches its post-ship documentation-sync step
- **THEN** it SHALL carry a minimal inline instruction to update project documentation to match the release
- **AND** it SHALL NOT reference or point at a `/document-release` skill
