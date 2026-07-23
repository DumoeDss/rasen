## ADDED Requirements

### Requirement: Newly-available built-in workflows are surfaced, not silently dropped

When `rasen update` resolves the desired workflow set from a frozen selection — a `custom` profile or a project-scope workflow override, whose stored list is a snapshot of the catalog as it was when the user last chose — and the current catalog contains a built-in workflow that was added after that selection was saved and is therefore not in the resolved set, the command SHALL surface that workflow to the user and point them to `rasen profile` to add it. The command SHALL NOT modify the stored selection to absorb the workflow; the selection remains exactly what the user chose. A `full` or `core` profile, which resolves against the live catalog and already includes every built-in workflow, SHALL NOT produce this note.

The command SHALL distinguish a genuinely new workflow from one the user deliberately deselected, so a deliberate omission is not re-surfaced on every update: only a built-in workflow that was not known when the selection was last saved SHALL be surfaced. On a stored selection that predates this behavior, the first `update` SHALL record the currently-known built-in workflows without surfacing any note, so no pre-existing omission is surprised onto the user; only a workflow added after that point SHALL be surfaced thereafter.

#### Scenario: New built-in workflow surfaced for a custom profile
- **WHEN** the global profile is `custom`, the stored selection was saved when the catalog did not contain a built-in workflow such as `audit`, and the current catalog contains it
- **THEN** `rasen update` SHALL display a note that the new built-in workflow is available and SHALL direct the user to `rasen profile` to add it
- **AND** the stored `custom` selection SHALL remain unchanged
- **AND** the new workflow's skill directory SHALL NOT be installed until the user selects it

#### Scenario: Deliberately deselected workflow is not re-surfaced
- **WHEN** a `custom` selection omits a built-in workflow that was already known when the selection was saved
- **THEN** `rasen update` SHALL NOT surface that workflow as newly available

#### Scenario: Full profile picks up new built-ins without a note
- **WHEN** the profile is `full` and the catalog gains a new built-in workflow
- **THEN** `rasen update` SHALL install that workflow as part of the resolved set
- **AND** SHALL NOT display the newly-available note

#### Scenario: Pre-existing selection is not surprised on first update
- **WHEN** a stored `custom` selection predates this behavior and omits one or more built-in workflows the catalog already contains
- **THEN** the first `rasen update` after upgrade SHALL record the currently-known built-in workflows and SHALL NOT surface any of those omissions
- **AND** a built-in workflow added to the catalog after that point SHALL be surfaced on a later `update`
