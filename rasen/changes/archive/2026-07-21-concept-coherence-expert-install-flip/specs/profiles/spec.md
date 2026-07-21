## MODIFIED Requirements

### Requirement: Profile definitions
The system SHALL support built-in `full` and `core` profiles, the current `custom` workflow selection, and reusable user-named profile snapshots. Each profile SHALL resolve to a workflow set AND an expert set; experts are catalog units selectable within a profile like workflows.

#### Scenario: Full profile contents
- **WHEN** profile is set to `full`
- **THEN** the profile SHALL include every workflow in `ALL_WORKFLOWS`
- **AND** the profile SHALL include every built-in expert

#### Scenario: Core profile contents
- **WHEN** profile is set to `core`
- **THEN** the profile SHALL include workflows: `propose`, `explore`, `apply`, `sync`, `archive`, `auto-command`, `help`
- **AND** the profile SHALL include the quality-floor experts: `review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`

#### Scenario: Custom profile contents
- **WHEN** profile is set to `custom`
- **THEN** the profile SHALL include only the workflows and experts specified in the global config `workflows` array
- **AND** experts required by a selected workflow's dependency closure SHALL additionally be installed even when the array omits them

### Requirement: Named profile storage and validation

User-named profiles SHALL be stored as versioned YAML definitions under `<global-config-dir>/profiles/<name>.yaml` and SHALL contain only `version`, `delivery`, and `workflows`. The `workflows` list MAY name workflow ids and expert ids.

#### Scenario: Validate names and content before saving
- **WHEN** a profile is created or imported
- **THEN** its name SHALL be a lowercase portable slug of at most 64 characters
- **AND** `full`, `core`, and `custom` SHALL be reserved
- **AND** delivery SHALL be `both` or `skills`
- **AND** every entry SHALL be a unique current catalog id — a workflow id or an expert id
- **AND** unsupported versions, unknown ids, duplicate ids, and unknown fields SHALL fail without modifying an existing definition

#### Scenario: Saved profile is a snapshot
- **WHEN** user applies a named profile and later edits current settings with `rasen profile`
- **THEN** the saved definition SHALL remain unchanged

#### Scenario: A saved snapshot lists exactly the chosen ids
- **WHEN** a profile snapshot is normalized and saved
- **THEN** it SHALL list exactly the workflow and expert ids the user selected
- **AND** it SHALL NOT be auto-expanded with closure-pulled experts

## ADDED Requirements

### Requirement: Expert selection in the profile picker

The interactive profile picker SHALL present built-in experts as selectable toggles, in a group distinct from the workflow toggles, so a user can add or remove experts as part of a profile. An expert required by an already-selected workflow's dependency closure SHALL be shown as required and SHALL NOT be uncheckable.

#### Scenario: Experts are toggleable in the picker
- **WHEN** the profile picker is displayed
- **THEN** the built-in experts SHALL appear as toggle choices alongside the workflow toggles
- **THEN** each expert SHALL be pre-selected when it is part of the current selection
- **THEN** on confirmation, the selected experts SHALL be persisted in the global config selection

#### Scenario: Required expert cannot be unchecked
- **WHEN** a selected workflow requires an expert via its `requires.skills`
- **THEN** that expert SHALL be shown as required by that workflow
- **AND** the user SHALL NOT be able to remove it while the requiring workflow remains selected

#### Scenario: Localized expert picker metadata
- **WHEN** the picker renders experts
- **THEN** each built-in expert SHALL have a specific localized name and description rather than an id fallback in both English and Japanese
- **AND** the expert metadata catalog SHALL define an entry for every built-in expert in both languages

### Requirement: Expert installation is profile-governed and non-regressive

Installed experts SHALL be governed by the resolved profile plus dependency closure, but existing installs SHALL NOT lose experts when this behavior is introduced. The system SHALL treat an install as having explicit expert selection only after the user re-selects experts through the profile picker or applies a profile; until then, all built-in experts SHALL continue to be installed regardless of profile.

#### Scenario: Existing install keeps all experts
- **WHEN** a project created before expert selection existed is updated
- **AND** the user has not re-selected experts
- **THEN** every built-in expert SHALL remain installed, independent of the active profile
- **AND** no expert skill directory SHALL be removed

#### Scenario: Explicit re-selection makes the profile govern
- **WHEN** the user opens the profile picker and confirms an expert selection
- **THEN** the install SHALL be marked as having explicit expert selection
- **AND** subsequent updates SHALL install the profile-default plus closure expert set and prune unreferenced deselected experts

#### Scenario: Fresh install is profile-scoped from the start
- **WHEN** a new project is initialized
- **THEN** its expert set SHALL be the active profile's default plus dependency closure
- **AND** a `core` install SHALL therefore receive only the quality-floor experts plus any closure-required experts
