# profiles Delta

## ADDED Requirements

### Requirement: Project profile lock

The project config (`rasen/config.yaml`) MAY name a locked profile — `full`, `core`, or a saved named profile — for the project. When a lock is present, every command that resolves the project's workflow selection (update, extend-mode init, drift detection, and the management API) SHALL resolve the selection from the locked profile instead of the user-wide profile. A locked named profile SHALL resolve to its saved definition's workflow and expert ids plus dependency closure; a locked built-in profile SHALL resolve exactly as if it were the user-wide profile. A lock that cannot be resolved SHALL produce a warning and fall back to the user-wide profile rather than failing the command. Resolving a lock SHALL never modify machine-global configuration.

#### Scenario: Locked named profile governs the project

- **WHEN** a project's config carries `profile: team-web` naming a saved profile and the user-wide profile is `full`
- **THEN** the project's desired selection resolves from the `team-web` definition's ids plus dependency closure
- **AND** the user-wide profile does not influence the result

#### Scenario: Locked built-in profile governs the project

- **WHEN** a project's config carries `profile: core` and the user-wide profile is `full`
- **THEN** the project's desired selection resolves to the `core` profile's workflow and expert sets, exactly as if `core` were the user-wide profile

#### Scenario: Lock naming a missing profile falls back with a warning

- **WHEN** a project's config carries `profile: <name>` and no saved definition with that name exists on this machine
- **THEN** a warning names the missing profile and states that the user-wide profile is used instead
- **AND** the command succeeds using the user-wide profile

#### Scenario: Locked custom is treated as an unresolvable lock

- **WHEN** a project's config carries `profile: custom`
- **THEN** a warning states that `custom` cannot be locked
- **AND** selection resolves from the user-wide profile

#### Scenario: Drift detection evaluates the locked profile

- **WHEN** drift detection runs for a project carrying a profile lock whose installed set matches the locked profile's resolved closure
- **THEN** no drift is reported, even though the installed set differs from the user-wide profile's resolved set

#### Scenario: Resolving a lock leaves global config unchanged

- **WHEN** any command resolves a project's selection through a profile lock
- **THEN** the machine-global config file is not modified by that resolution

### Requirement: Update a saved profile definition

The system SHALL let the user edit an existing saved named profile definition in place with `rasen profile update [name]`: the workflow and expert picker opens seeded from the stored definition, and on confirmation the new selection is saved back to the same definition. Editing a definition SHALL leave the current user-wide selection and all project files unchanged; projects locked to the profile pick up the new contents on their next `rasen update`.

#### Scenario: Edit a saved profile

- **WHEN** user runs `rasen profile update team-web` in an interactive terminal, changes the selection in the picker, and confirms
- **THEN** the saved definition SHALL list exactly the newly chosen workflow and expert ids
- **AND** the current user-wide selection SHALL remain unchanged
- **AND** the output SHALL state that projects locked to `team-web` apply the change on their next `rasen update`

#### Scenario: Prompted selection when no name is given

- **WHEN** user runs `rasen profile update` without a name in an interactive terminal and saved profiles exist
- **THEN** the system SHALL offer the saved profiles for selection
- **WHEN** no saved profiles exist
- **THEN** the command SHALL fail stating there are no saved profiles

#### Scenario: Update requires an interactive terminal

- **WHEN** user runs `rasen profile update` (with or without a name) outside a TTY
- **THEN** the command SHALL fail with exit code 1 explaining that editing a profile requires an interactive terminal

#### Scenario: Built-in and reserved names cannot be edited

- **WHEN** user runs `rasen profile update full`, `rasen profile update core`, or `rasen profile update custom`
- **THEN** the command SHALL fail stating that built-in or reserved profiles cannot be edited

#### Scenario: Unknown profile name

- **WHEN** user runs `rasen profile update <name>` and no saved definition with that name exists
- **THEN** the command SHALL fail naming the unknown profile

#### Scenario: Declining the confirmation leaves the definition unchanged

- **WHEN** user opens the editor via `rasen profile update <name>` and declines the save confirmation
- **THEN** the saved definition SHALL remain byte-for-byte unchanged
- **AND** the output SHALL state that the update was cancelled

#### Scenario: Localized update command output

- **WHEN** the resolved CLI locale is Japanese or Simplified Chinese
- **THEN** the update subcommand's prompts, confirmations, results, and errors SHALL be displayed in the resolved locale, with entries present in all three locale catalogs

## MODIFIED Requirements

### Requirement: A project-scope selection override takes precedence over the profile

When a project's configuration carries a workflow selection override, the desired workflow set for that project SHALL resolve from the override list verbatim plus dependency closure, taking precedence over a project profile lock and over the user-wide profile (`full`, `core`, `custom`, or a named profile) and independent of the expert-selection migration marker. When both an override and a profile lock are present, the override SHALL govern and a warning SHALL name the shadowed lock. When neither an override nor a lock is present, resolution SHALL be unchanged from today. `rasen profile` SHALL continue to edit only machine-global state — the user-wide selection and saved profile definitions; an override or a lock is created and removed through project-scope configuration, not through the profile editor — and the profile editor's project-drift warning SHALL name an active override rather than presenting the intentional difference as unapplied global config.

#### Scenario: Override wins over the user-wide profile

- **WHEN** the user-wide profile is `full` and a project's config carries a workflow selection override listing a subset
- **THEN** the desired set for that project resolves from the subset plus its dependency closure

#### Scenario: Override shadows a profile lock with a warning

- **WHEN** a project's config carries both a `workflows` override and a `profile` lock
- **THEN** the desired set resolves from the override list plus dependency closure
- **AND** a warning names the profile lock as shadowed by the override

#### Scenario: Profile editor leaves overrides alone

- **WHEN** the user edits the selection through `rasen profile`
- **THEN** only the user-wide selection changes, and every project override remains as it was

#### Scenario: Drift evaluates the per-project effective selection

- **WHEN** drift detection runs for a project carrying an override whose installed set matches the override's resolved closure
- **THEN** no drift is reported, even though the installed set differs from the user-wide profile's resolved set
