# safety-hook Specification

## Purpose
Provide a safety-check hook script that detects destructive patterns against a safe-target whitelist with a defined exit-code convention, plus init instructions for configuring the hook.

## Requirements
### Requirement: Safety Check Script

The system SHALL provide `hooks/safety-check.sh` that detects destructive command patterns.

#### Scenario: Script file location

- **WHEN** the safety hook is distributed with Rasen
- **THEN** the script SHALL be located at `hooks/safety-check.sh`
- **AND** the script SHALL be executable (chmod +x)

#### Scenario: Script receives command input

- **WHEN** the safety hook is invoked
- **THEN** it SHALL receive the command string to evaluate as input
- **AND** SHALL analyze the command for destructive patterns

### Requirement: Destructive Pattern Detection

The hook SHALL detect the following destructive command patterns.

#### Scenario: File system destruction detected

- **WHEN** the command matches `rm -rf` (recursive forced deletion)
- **THEN** the hook SHALL flag the command as destructive
- **AND** SHALL exit with code 2

#### Scenario: Database destruction detected

- **WHEN** the command matches `DROP TABLE`, `DROP DATABASE`, or `TRUNCATE`
- **THEN** the hook SHALL flag the command as destructive
- **AND** SHALL exit with code 2

#### Scenario: Git destructive operations detected

- **WHEN** the command matches `git push --force`, `git reset --hard`, `git checkout .`, or `git restore .`
- **THEN** the hook SHALL flag the command as destructive
- **AND** SHALL exit with code 2

#### Scenario: Infrastructure destruction detected

- **WHEN** the command matches `kubectl delete` or `docker system prune`
- **THEN** the hook SHALL flag the command as destructive
- **AND** SHALL exit with code 2

#### Scenario: Non-destructive command allowed

- **WHEN** the command does not match any destructive pattern
- **THEN** the hook SHALL exit with code 0

### Requirement: Safe Target Whitelist

Safe targets SHALL be whitelisted so that deletion of common build artifacts is permitted.

#### Scenario: Whitelisted directory deletion

- **WHEN** the command is `rm -rf` targeting one of: `node_modules`, `dist`, `.next`, `__pycache__`, `build`, `coverage`, `.cache`, `.turbo`, `.tsbuildinfo`
- **THEN** the hook SHALL treat the command as safe
- **AND** SHALL exit with code 0

#### Scenario: Non-whitelisted directory deletion

- **WHEN** the command is `rm -rf` targeting a directory NOT in the whitelist
- **THEN** the hook SHALL treat the command as destructive
- **AND** SHALL exit with code 2

#### Scenario: Whitelisted target within path

- **WHEN** the command is `rm -rf ./some/path/node_modules`
- **THEN** the hook SHALL recognize the whitelisted target regardless of path prefix
- **AND** SHALL exit with code 0

### Requirement: Exit Code Convention

Exit code 0 SHALL indicate safe, exit code 2 SHALL indicate destructive pattern detected.

#### Scenario: Safe command exit code

- **WHEN** the command is determined to be safe
- **THEN** the hook SHALL exit with code 0

#### Scenario: Destructive command exit code

- **WHEN** the command is determined to be destructive
- **THEN** the hook SHALL exit with code 2
- **AND** SHALL output a warning message describing the detected destructive pattern

### Requirement: Init Instructions for Hook Configuration

`rasen init` SHALL print instructions for configuring the safety hook.

#### Scenario: Init displays hook configuration guidance

- **WHEN** `rasen init` completes
- **THEN** the output SHALL include instructions for configuring the safety hook in Claude Code's `.claude/settings.json`
- **AND** the instructions SHALL provide a copy-paste ready configuration snippet for the `PreToolUse` hook

#### Scenario: Init does not auto-modify settings

- **WHEN** `rasen init` runs
- **THEN** the system SHALL NOT automatically modify `.claude/settings.json`
- **AND** SHALL only display instructions for the user to configure manually

