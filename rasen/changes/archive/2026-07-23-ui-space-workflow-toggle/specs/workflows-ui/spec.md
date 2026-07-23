# workflows-ui Delta

## ADDED Requirements

### Requirement: The page offers per-space workflow enablement

The Workflows page SHALL let the user pick one of their spaces and, with a space picked, show each workflow card's enabled state in that space and a toggle to enable or disable it there — performed through the per-space enablement endpoints, never by the browser touching the filesystem. Toggling SHALL affect only the picked space. The page SHALL state visibly whether the picked space follows the user-wide profile or its own selection; a space using its own selection SHALL offer a reset back to the user-wide profile behind an explicit confirmation, since resetting discards the space's own list. Units the library manages automatically carry no toggle: internal workflows, invalid entries, and units enabled only because an enabled workflow's dependency closure requires them (the card says the unit is required by an enabled workflow instead of offering a disable that the apply would immediately undo). While an enablement mutation is in flight the page SHALL prevent submitting another, and every failure SHALL show the CLI's own error message verbatim. With no space picked, the page remains exactly the user-wide library manager it is today.

#### Scenario: Toggle enables a workflow in the picked space only

- **WHEN** the user picks a space and enables a workflow that was disabled there
- **THEN** the card reflects the enabled and installed state from the server's post-apply response, and no other space's state is changed

#### Scenario: Override state is visible with a reset

- **WHEN** the picked space carries its own selection override
- **THEN** the page states the space uses its own selection and offers a reset to the user-wide profile, which takes effect only after an explicit confirmation

#### Scenario: Closure-required unit offers no disable

- **WHEN** the picked space has a workflow enabled whose closure requires an expert
- **THEN** that expert's card shows it is required by an enabled workflow and offers no disable toggle

#### Scenario: No space picked keeps today's page

- **WHEN** the user has not picked a space
- **THEN** the page shows the user-wide library with its existing management actions and no enablement toggles
