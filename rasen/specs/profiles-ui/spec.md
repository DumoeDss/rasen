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

### Requirement: Enabling a workflow cascades its strong dependencies into the draft

When the user switches a workflow ON in an editable profile's membership, the draft SHALL also gain every workflow in that workflow's strong dependency closure (as served by the workflow dependency-graph read) that is not already a member, and the page SHALL state which workflows were auto-added and for which workflow. Switching a workflow OFF SHALL never cascade — only that workflow leaves the draft, and any dependents are left for the user to handle. The cascade edits the draft only; Save/Discard semantics are unchanged, and save-time normalization remains the final authority on the stored list.

#### Scenario: Enable pulls strong dependencies

- **WHEN** the user switches ON a driver workflow whose pipelines require other workflows' skills (for example the auto driver)
- **THEN** the draft additionally gains the strong closure (for example propose, apply, review-cycle, ship, archive, retro, and the always-dispatched review expert), and a note names the auto-added workflows and the workflow that required them

#### Scenario: Disable never cascades

- **WHEN** the user switches OFF a workflow that other draft members strongly depend on
- **THEN** only that workflow leaves the draft, no dependent is switched off, and saving still re-adds anything the stored closure requires (visibly, per the existing snap-back behavior)

#### Scenario: Cascade additions are already-on tolerant

- **WHEN** the user enables a workflow whose strong dependencies are all already in the draft
- **THEN** the draft gains only the toggled workflow and no auto-added note appears

### Requirement: Weakly associated experts are hinted, not auto-enabled

An expert workflow that condition-gated pipeline stages of a draft member would use SHALL carry a visible hint naming what it enhances (for example "enhances auto"), so the user understands the association before deciding. A weak association alone SHALL NOT auto-enable the expert; an expert that is also in an enabled workflow's strong closure is enabled by the cascade like any strong dependency. The hint SHALL appear only on the Profiles page's membership editor — the Workflows page presentation is unchanged.

#### Scenario: Conditional expert shows an enhances hint

- **WHEN** the draft contains a workflow whose pipelines dispatch an expert only under a condition (for example the security expert in the full-feature pipeline)
- **THEN** that expert's card shows a hint naming the workflow it enhances, and the expert is not auto-added by enabling that workflow

#### Scenario: Strongly required expert still cascades

- **WHEN** the user enables a workflow whose strong closure includes an expert (for example the review expert)
- **THEN** that expert is auto-added by the cascade even if it also appears as a weak enhancer elsewhere

### Requirement: Bulk membership selection

An editable profile's membership editor SHALL offer two bulk actions: Select all, which adds every selectable (non-internal) workflow to the draft, and Invert, which flips the membership of every selectable workflow. Both act on the draft only, are unavailable for read-only profiles, and are announced by the same unsaved-changes indication as individual toggles.

#### Scenario: Select all fills the draft

- **WHEN** the user activates Select all on an editable profile
- **THEN** every selectable workflow's switch is ON in the draft and the unsaved-changes indication shows (unless the draft was already full)

#### Scenario: Invert flips the draft

- **WHEN** the user activates Invert with some workflows ON
- **THEN** every selectable workflow's membership flips (ON becomes OFF and vice versa) in the draft — so Invert right after Select all clears the selection

#### Scenario: Read-only profiles offer no bulk actions

- **WHEN** the user views a built-in or broken profile
- **THEN** neither Select all nor Invert is offered

