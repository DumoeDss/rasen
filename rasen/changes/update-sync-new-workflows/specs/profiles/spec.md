## ADDED Requirements

### Requirement: Profile editor surfaces available-but-unselected built-in workflows

When the interactive profile editor opens, it SHALL surface, before the checkbox picker, which built-in workflows are available in the catalog but not part of the current selection, so a user can find and add a newly-available workflow without scrolling through a paginated list of already-checked rows. This summary SHALL be Rasen-owned text displayed in the resolved CLI locale.

#### Scenario: Editor names an unselected built-in workflow
- **WHEN** the user runs `rasen profile`, the current selection is `custom`, and a built-in workflow such as `audit` is in the catalog but not in the current selection
- **THEN** the editor SHALL display, before the picker, that the workflow is available and not currently selected

#### Scenario: No note when every built-in is selected
- **WHEN** the current selection already contains every built-in workflow (for example a `full` profile)
- **THEN** the editor SHALL NOT display an available-but-unselected note

### Requirement: Profile picker checkbox state reflects the stored selection

The interactive profile picker SHALL pre-select a built-in workflow if and only if it is part of the current resolved selection or is required by a selected workflow's dependency closure. A built-in workflow that is neither in the stored selection nor required by any selected workflow SHALL be presented unchecked, so the displayed state never claims a workflow is selected when it is not.

#### Scenario: Unselected new workflow renders unchecked
- **WHEN** the profile picker is displayed for a `custom` selection that does not include a built-in workflow such as `audit`, and no selected workflow requires it
- **THEN** the `audit` row SHALL be presented unchecked

#### Scenario: Confirming the picker unchanged does not add an unselected workflow
- **WHEN** the picker opens for a `custom` selection that omits a built-in workflow and the user confirms without changing the selection
- **THEN** the omitted workflow SHALL remain absent from the saved selection
