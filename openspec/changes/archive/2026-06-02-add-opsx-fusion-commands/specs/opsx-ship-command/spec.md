# opsx-ship-command Specification

## Purpose
Defines the `/opsx:ship` release workflow command that merges gstack /ship and /land-and-deploy into a single OpenSpec-aware shipping pipeline.

## ADDED Requirements

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

Ship SHALL invoke gstack /ship (or fallback to git+gh) to test, push, and create a PR.

#### Scenario: Ship via gstack /ship

- **WHEN** the ship phase executes
- **AND** gstack /ship skill is available
- **THEN** the system SHALL invoke /ship to run tests, push the branch, and create a pull request

#### Scenario: Ship fallback to git+gh

- **WHEN** the ship phase executes
- **AND** gstack /ship skill is not available or fails
- **THEN** the system SHALL fallback to direct git and gh CLI commands
- **AND** SHALL run tests, push the branch, and create a PR via `gh pr create`

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
