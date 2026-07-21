## ADDED Requirements

### Requirement: Update installs and prunes experts by profile
The update command SHALL bring a project's installed experts into line with the resolved profile plus dependency closure: it SHALL install experts named by the profile or required by a selected workflow, and it SHALL remove an installed built-in expert only when that expert is neither in the resolved profile's expert set nor required by any selected workflow.

#### Scenario: Missing profile expert is installed
- **WHEN** user runs `rasen update`
- **AND** the resolved profile names an expert that is not installed in the project
- **THEN** the system SHALL install that expert's skill files

#### Scenario: Unreferenced deselected expert is removed
- **WHEN** user runs `rasen update`
- **AND** an installed built-in expert is neither in the resolved profile's expert set nor required by any selected workflow
- **AND** the install has explicit expert selection
- **THEN** the system SHALL remove that expert's skill directory

#### Scenario: Referenced expert is never removed
- **WHEN** user runs `rasen update`
- **AND** an installed expert is required by a selected workflow's `requires.skills`
- **THEN** the system SHALL retain that expert even when the active profile does not name it

### Requirement: One-time non-regressive expert migration
When an install predates expert selection, the update command SHALL preserve every installed built-in expert and SHALL explain, once, that experts are now selectable. It SHALL NOT remove any expert until the user has explicitly re-selected experts.

#### Scenario: Legacy install keeps all experts with a one-time notice
- **WHEN** user runs `rasen update` on a project whose config has no explicit expert selection
- **THEN** every built-in expert SHALL remain installed regardless of the active profile
- **AND** the system SHALL display a one-time notice that experts are now selectable via `rasen profile`
- **AND** no expert skill directory SHALL be removed by that run

#### Scenario: Notice does not repeat after explicit selection
- **WHEN** the user has re-selected experts through the profile picker
- **AND** user runs `rasen update`
- **THEN** the profile-default plus closure expert set SHALL govern
- **AND** the one-time experts-now-selectable notice SHALL NOT be shown again
