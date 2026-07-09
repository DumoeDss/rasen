## MODIFIED Requirements

### Requirement: Directory Creation

The command SHALL create the rasen workspace directory structure with config file.

#### Scenario: Creating rasen workspace structure

- **WHEN** `rasen init` is executed
- **THEN** create the following directory structure:
```
rasen/
├── config.yaml
├── specs/
└── changes/
    └── archive/
```

### Requirement: Safety Checks
The command SHALL perform safety checks to prevent overwriting existing structures and ensure proper permissions.

#### Scenario: Detecting existing initialization
- **WHEN** the `rasen/` directory already exists
- **THEN** inform the user that rasen is already initialized, skip recreating the base structure, and enter an extend mode
- **AND** continue to the AI tool selection step so additional tools can be configured
- **AND** display the existing-initialization error message only when the user declines to add any AI tools

### Requirement: Config File Generation

The command SHALL create a rasen config file with schema settings.

#### Scenario: Creating config.yaml

- **WHEN** initialization completes
- **AND** config.yaml does not exist
- **THEN** create `rasen/config.yaml` with default schema setting
- **AND** display config location in output

#### Scenario: Preserving existing config.yaml

- **WHEN** initialization runs in extend mode
- **AND** `rasen/config.yaml` already exists
- **THEN** preserve the existing config file
- **AND** display "(exists)" indicator in output

## ADDED Requirements

### Requirement: Init output uses the rasen namespace

All init success output, next-step hints, and generated artifact references SHALL use the rasen namespace: slash commands as `/rasen:*`, the workspace as `rasen/`, and skill directories as `rasen-*`.

#### Scenario: Success message references rasen commands

- **WHEN** `rasen init` completes successfully
- **THEN** the next-step hints reference `/rasen:*` commands and the `rasen/` workspace
- **AND** no hint references `/opsx:*` or an `openspec/` path
