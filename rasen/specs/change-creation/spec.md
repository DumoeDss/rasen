# change-creation Specification

## Purpose
Provide programmatic utilities for creating and validating Rasen change directories.
## Requirements
### Requirement: Change Creation
The system SHALL provide a function to create new change directories programmatically.

#### Scenario: Create change
- **WHEN** `createChange(projectRoot, 'add-auth')` is called
- **THEN** the system creates `rasen/changes/add-auth/` directory

#### Scenario: Duplicate change rejected
- **WHEN** `createChange(projectRoot, 'add-auth')` is called and `rasen/changes/add-auth/` already exists
- **THEN** the system throws an error indicating the change already exists

#### Scenario: Creates parent directories if needed
- **WHEN** `createChange(projectRoot, 'add-auth')` is called and `rasen/changes/` does not exist
- **THEN** the system creates the full path including parent directories

#### Scenario: Invalid change name rejected
- **WHEN** `createChange(projectRoot, 'Add Auth')` is called with an invalid name
- **THEN** the system throws a validation error

### Requirement: Change Name Validation
The system SHALL validate change names follow kebab-case conventions.

#### Scenario: Valid kebab-case name accepted
- **WHEN** a change name like `add-user-auth` is validated
- **THEN** validation returns `{ valid: true }`

#### Scenario: Numeric suffixes accepted
- **WHEN** a change name like `add-feature-2` is validated
- **THEN** validation returns `{ valid: true }`

#### Scenario: Single word accepted
- **WHEN** a change name like `refactor` is validated
- **THEN** validation returns `{ valid: true }`

#### Scenario: Uppercase characters rejected
- **WHEN** a change name like `Add-Auth` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

#### Scenario: Spaces rejected
- **WHEN** a change name like `add auth` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

#### Scenario: Underscores rejected
- **WHEN** a change name like `add_auth` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

#### Scenario: Special characters rejected
- **WHEN** a change name like `add-auth!` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

#### Scenario: Leading hyphen rejected
- **WHEN** a change name like `-add-auth` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

#### Scenario: Trailing hyphen rejected
- **WHEN** a change name like `add-auth-` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

#### Scenario: Consecutive hyphens rejected
- **WHEN** a change name like `add--auth` is validated
- **THEN** validation returns `{ valid: false, error: "..." }`

### Requirement: Proposal seeding flag on new change
`rasen new change` SHALL accept a `--proposal <text>` option that writes a minimal `proposal.md` into the created change directory, containing the change name as title and the provided text under a Why section, marked as a submission seed to be developed. A change created with `--proposal` SHALL therefore satisfy the workflow's active-change definition (`getActiveChangeIds`, which requires `proposal.md`) immediately after creation. The flag SHALL be independent of `--description` (which continues to seed `README.md` unchanged) and SHALL appear in the completions command registry and in both the `en` and `ja` locale catalogs.

#### Scenario: Proposal seed makes the change active
- **WHEN** `rasen new change my-feature --proposal "Add feature X"` succeeds
- **THEN** `rasen/changes/my-feature/proposal.md` exists containing the provided text, and the change is listed by commands that enumerate via `getActiveChangeIds`

#### Scenario: Without the flag behavior is unchanged
- **WHEN** `rasen new change my-feature` is run without `--proposal`
- **THEN** no `proposal.md` is created, matching existing behavior

#### Scenario: Empty proposal text rejected
- **WHEN** `rasen new change my-feature --proposal ""` (or whitespace-only) is run
- **THEN** the command fails with an explicit error and no change is left in a silently-inactive state

#### Scenario: Flag is discoverable and localized
- **WHEN** the completions command registry and locale catalogs are checked
- **THEN** the `--proposal` flag has a registry entry under `new change` and description strings in both `en` and `ja` catalogs

