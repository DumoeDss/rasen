## MODIFIED Requirements

### Requirement: Profile definitions

The system SHALL support built-in `full` and `core` profiles, the current `custom` workflow selection, and reusable user-named profile snapshots. Each profile SHALL resolve to a workflow set and an expert set; only current catalog experts are selectable within a profile. Host-owned references SHALL arrive with their selected host and SHALL NOT occupy independent profile entries.

#### Scenario: Full profile contents

- **WHEN** profile is set to `full`
- **THEN** the profile SHALL include every workflow in `ALL_WORKFLOWS`
- **AND** SHALL include exactly the 12 current built-in experts
- **AND** SHALL NOT include the retired ids `codebase-design`, `tdd`, `prototype`, `navigator`, `workflow-review`, or `qa-only`

#### Scenario: Core profile contents

- **WHEN** profile is set to `core`
- **THEN** the profile SHALL include workflows `propose`, `explore`, `apply`, `sync`, `archive`, `auto-command`, and `help`
- **AND** SHALL include the quality-floor experts `review`, `cso`, `qa`, `benchmark`, and `design-review`

#### Scenario: Custom profile contents

- **WHEN** profile is set to `custom`
- **THEN** the profile SHALL include only current workflows and experts specified in the global config `workflows` array
- **AND** experts required by a selected workflow's dependency closure SHALL additionally be installed even when the array omits them
- **AND** stored retired ids SHALL follow the existing unknown-id warning/drop behavior rather than being reintroduced as selectable entries

### Requirement: Expert selection in the profile picker

The interactive profile picker SHALL present the 12 current built-in experts as selectable toggles in a group distinct from workflow toggles. An expert required by an already-selected workflow's dependency closure SHALL be shown as required and SHALL NOT be uncheckable. Consolidated host references and retired expert identities SHALL NOT appear as separate choices.

#### Scenario: Experts are toggleable in the picker

- **WHEN** the profile picker is displayed
- **THEN** the 12 surviving built-in experts SHALL appear as toggle choices alongside workflow toggles
- **AND** each expert SHALL be pre-selected when it is part of the current selection
- **AND** confirmation SHALL persist the selected current expert ids in the global config selection

#### Scenario: Required expert cannot be unchecked

- **WHEN** a selected workflow requires an expert via `requires.skills`
- **THEN** that expert SHALL be shown as required by that workflow
- **AND** the user SHALL NOT be able to remove it while the requiring workflow remains selected

#### Scenario: Localized expert picker metadata

- **WHEN** the picker renders experts in English, Japanese, or Simplified Chinese
- **THEN** each of the 12 surviving experts SHALL have a specific localized name and description rather than an id fallback
- **AND** all three expert metadata catalogs SHALL expose identical keys for exactly the current expert roster
- **AND** SHALL NOT expose entries for `codebase-design`, `tdd`, `prototype`, `navigator`, `workflow-review`, or `qa-only`

### Requirement: Expert installation is profile-governed and non-regressive

Installed current experts SHALL be governed by the resolved profile plus dependency closure, while existing installations that predate explicit expert selection SHALL retain every current built-in expert until the user re-selects experts or applies a profile. This non-regression rule SHALL NOT preserve generated directories for identities that have been retired from the built-in catalog; exact retired directories are cleaned independently during init/update.

#### Scenario: Existing install keeps all experts

- **WHEN** a project created before expert selection existed is updated
- **AND** the user has not re-selected experts
- **THEN** every current built-in expert SHALL remain installed independent of the active profile
- **AND** no current expert skill directory SHALL be removed by profile pruning
- **AND** exact directories for retired built-in identities SHALL still be removed by retirement cleanup

#### Scenario: Explicit re-selection makes the profile govern

- **WHEN** the user opens the profile picker and confirms an expert selection
- **THEN** the install SHALL be marked as having explicit expert selection
- **AND** subsequent updates SHALL install the profile-default plus closure expert set and prune unreferenced deselected current experts

#### Scenario: Fresh install is profile-scoped from the start

- **WHEN** a new project is initialized
- **THEN** its expert set SHALL be the active profile's default plus dependency closure
- **AND** a `core` install SHALL receive only the five quality-floor experts plus any closure-required experts
- **AND** host-owned references SHALL be generated with selected host skills rather than as experts
