# profiles-ui Specification

## Purpose
TBD - created by archiving change ui-profile-workflow-split. Update Purpose after archive.
## Requirements
### Requirement: A Profiles page manages named profile definitions

The UI SHALL offer a space-agnostic Profiles page, reachable from the main navigation like the Workflows page, that lists every available profile (built-in `full` and `core` plus saved profiles) and lets the user select one to view. The page SHALL let the user create a new saved profile (name validated with immediate feedback, membership seeded from the currently selected profile so "duplicate then adjust" is the natural flow) and delete a saved profile behind an explicit confirmation whose copy states that spaces locked to it will fall back to the user-wide profile on their next apply. Built-in profiles SHALL be viewable but not editable or deletable, offering "duplicate to edit" instead. Editing a profile's membership SHALL only change the saved definition — the page SHALL NOT install or uninstall anything; the page SHALL say where switching takes effect (a space's Config page).

#### Scenario: Profiles reachable from anywhere

- **WHEN** the user opens the Profiles page from the navigation, with or without a space in the URL
- **THEN** the page lists `full`, `core`, and every saved profile, and selecting one shows its workflow membership

#### Scenario: Create seeds from the selected profile

- **WHEN** the user views `core` and creates a new profile named `my-set`
- **THEN** the new profile starts with `core`'s membership, is saved through the management API, and becomes the selected, editable profile

#### Scenario: Built-ins are read-only

- **WHEN** the user selects `full` or `core`
- **THEN** the membership renders without editable switches and no save or delete is offered, with duplicate-to-edit as the offered path

#### Scenario: Delete warns about locked spaces

- **WHEN** the user deletes a saved profile
- **THEN** the confirmation states that any space locked to it will follow the user-wide profile after its next apply, and only an explicit confirmation performs the delete

### Requirement: Profile membership is edited with the shared sectioned card presentation

The Profiles page body SHALL present the workflow library in the same category sections and uniform cards as the Workflows page (Driver with internal plumbing behind a disclosure, Task, Expert), reusing the shared presentation rather than a copy. For an editable profile, each selectable card SHALL carry a corner switch reflecting membership in the profile's draft list; internal workflows carry no switch. Edits SHALL be a draft: the page SHALL show an unsaved-changes indication, offer Save and Discard, and only Save SHALL persist through the management API. After a save, the switches SHALL re-render from the server's normalized definition, so a dependency the server re-added through closure expansion is visibly ON rather than silently stored.

#### Scenario: Switches edit the draft only

- **WHEN** the user toggles several cards on an editable profile without saving
- **THEN** the page marks the profile as having unsaved changes and the saved definition is unchanged until Save

#### Scenario: Closure re-addition is visible after save

- **WHEN** the user switches OFF a workflow that an enabled workflow's dependency closure requires and saves
- **THEN** the saved response re-renders that workflow's switch ON

#### Scenario: Discard returns to the stored definition

- **WHEN** the user has unsaved membership edits and chooses Discard
- **THEN** the switches return to the stored definition and the unsaved-changes indication clears

#### Scenario: Saving a profile does not re-apply locked spaces

- **WHEN** the user saves membership changes to a profile that some space's configuration locks
- **THEN** no install or uninstall runs anywhere, and the page states that spaces locked to the profile apply the change on their next apply — the same contract as the CLI's `profile update`

