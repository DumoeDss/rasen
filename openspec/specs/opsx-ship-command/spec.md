# opsx-ship-command Specification

## Purpose
Provide the `/opsx:ship` command — pre-flight checks, ship execution, a PR body derived from the proposal, a ship log, and optional land-and-deploy.

## Requirements
### Requirement: Ship Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for ship in `src/core/templates/workflows/ship.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getShipCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxShipCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

### Requirement: Pre-Flight Checks

Pre-flight checks SHALL verify readiness before shipping.

#### Scenario: Verification status check

- **WHEN** the ship command starts
- **THEN** the system SHALL check whether verification has been run for the change
- **AND** if no verification report exists, the system SHALL warn the user and prompt for confirmation to proceed

#### Scenario: Task completion check

- **WHEN** the ship command starts
- **THEN** the system SHALL read `tasks.md` and verify all tasks are marked complete
- **AND** if incomplete tasks exist, the system SHALL list them and prompt the user for confirmation

#### Scenario: Clean git status check

- **WHEN** the ship command starts
- **THEN** the system SHALL verify the git working tree is clean (no uncommitted changes)
- **AND** if uncommitted changes exist, the system SHALL prompt the user to commit or stash before proceeding

#### Scenario: All pre-flight checks pass

- **WHEN** all pre-flight checks pass
- **THEN** the system SHALL proceed to the ship phase without additional prompts

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

### Requirement: PR Body from Proposal

PR body SHALL include the proposal summary from the change's `proposal.md`.

#### Scenario: PR body generation with proposal

- **WHEN** creating a pull request
- **AND** `openspec/changes/<name>/proposal.md` exists
- **THEN** the PR body SHALL include the "Why" and "What Changes" sections from `proposal.md`
- **AND** the PR title SHALL be derived from the change name or proposal summary

#### Scenario: PR body generation without proposal

- **WHEN** creating a pull request
- **AND** no `proposal.md` exists for the change
- **THEN** the PR body SHALL be generated from commit messages and change name
- **AND** the system SHALL note that no proposal was available

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change directory with shipping details.

#### Scenario: Ship log written after successful PR creation

- **WHEN** a PR is successfully created
- **THEN** the system SHALL write `openspec/changes/<name>/ship-log.md`
- **AND** the log SHALL include: PR URL, branch name, timestamp, and deployment status (pending)

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes
- **THEN** the system SHALL update `ship-log.md` with deployment status and production verification results

### Requirement: Optional Land-and-Deploy

Optional land-and-deploy SHALL merge the PR, wait for CI, deploy, and verify production.

#### Scenario: Land-and-deploy invocation

- **WHEN** the user opts into land-and-deploy after PR creation
- **THEN** the system SHALL merge the PR after CI passes
- **AND** SHALL wait for deployment to complete
- **AND** SHALL run production verification checks

#### Scenario: CI failure during land-and-deploy

- **WHEN** CI checks fail after merge
- **THEN** the system SHALL report the failure
- **AND** SHALL NOT proceed with deployment
- **AND** SHALL update `ship-log.md` with the failure details

#### Scenario: User declines land-and-deploy

- **WHEN** the user declines land-and-deploy
- **THEN** the system SHALL stop after PR creation
- **AND** `ship-log.md` SHALL reflect that deployment was deferred

