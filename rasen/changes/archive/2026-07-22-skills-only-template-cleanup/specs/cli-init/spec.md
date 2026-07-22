## MODIFIED Requirements

### Requirement: Init output uses the rasen namespace

All init success output, next-step hints, and generated artifact references SHALL use the rasen namespace: workflows are referenced by their canonical skill-directory name (`rasen-*`, e.g. `rasen-propose`), the workspace as `rasen/`, and skill directories as `rasen-*`. Next-step hints SHALL NOT use the `/rasen:*` colon form — project skills surface under the skill-directory name on every tool.

#### Scenario: Success message references rasen commands

- **WHEN** `rasen init` completes successfully
- **THEN** the next-step hints reference workflows by their canonical `rasen-*` skill name and the `rasen/` workspace
- **AND** no hint SHALL use a `/rasen:*` colon-form reference

### Requirement: Smart defaults init flow
The init command SHALL work with sensible defaults and tool confirmation, minimizing required user input. Interactive selection and non-interactive auto-selection SHALL consider only adapted agents; detected directories for unadapted agents SHALL NOT be offered or auto-selected.

#### Scenario: Init with detected tools (interactive)
- **WHEN** user runs `rasen init` interactively and adapted tool directories are detected
- **THEN** the system SHALL show detected adapted tools pre-selected
- **THEN** the system SHALL ask for confirmation (not full selection)
- **THEN** the system SHALL use the default profile (`core`)

#### Scenario: Init with no detected tools (interactive)
- **WHEN** user runs `rasen init` interactively and no adapted tool directories are detected
- **THEN** the system SHALL prompt for tool selection from the adapted tools
- **THEN** the system SHALL use the default profile (`core`)

#### Scenario: Non-interactive with detected tools
- **WHEN** user runs `rasen init` non-interactively (e.g., in CI)
- **AND** adapted tool directories are detected
- **THEN** the system SHALL use the detected adapted tools automatically without prompting
- **AND** SHALL ignore detected directories for unadapted tools
- **THEN** the system SHALL use the default profile

#### Scenario: Non-interactive with no detected tools
- **WHEN** user runs `rasen init` non-interactively
- **AND** no tool directories are detected
- **THEN** the system SHALL fail with exit code 1
- **AND** display message to use `--tools` flag

#### Scenario: Non-interactive with explicit tools
- **WHEN** user runs `rasen init --tools claude`
- **THEN** the system SHALL use specified tools
- **THEN** the system SHALL NOT prompt for any input

#### Scenario: Interactive with explicit tools
- **WHEN** user runs `rasen init --tools claude` interactively
- **THEN** the system SHALL use specified tools (ignoring auto-detection)
- **THEN** the system SHALL NOT prompt for tool selection
- **THEN** the system SHALL proceed with the default profile

#### Scenario: Init success message (propose installed)
- **WHEN** init completes successfully
- **AND** `propose` is in the active profile
- **THEN** the system SHALL display the success message: "Start your first change: run the rasen-propose skill with \"your idea\"" using the canonical skill-directory name for every tool

#### Scenario: Init success message (propose not installed, new installed)
- **WHEN** init completes successfully
- **AND** `propose` is NOT in the active profile
- **AND** `new` is in the active profile
- **THEN** the system SHALL display the success message: "Start your first change: run the rasen-new-change skill with \"your idea\"" using the canonical skill-directory name for every tool

#### Scenario: Init success message (neither propose nor new)
- **WHEN** init completes successfully
- **AND** neither `propose` nor `new` is in the active profile
- **THEN** the system SHALL display: "Done. Run 'rasen config profile' to configure your workflows."
