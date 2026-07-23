# space-workflow-enablement Specification

## Purpose
Let one space carry its own workflow selection: a project-scope override of the user-wide profile, honored by apply and drift, so enabling or disabling a workflow in one space never changes any other space.

## ADDED Requirements

### Requirement: A space can carry its own workflow selection

A space's project configuration SHALL be able to carry an explicit workflow selection list that overrides the user-wide profile for that space only. When the override is present, the space's desired workflow set SHALL resolve from the override list verbatim (plus the dependency closure every selection resolves through — a selected workflow's required workflows and experts are always included); the user-wide profile and its expert-selection migration behavior SHALL NOT contribute. When no override is present, the space SHALL follow the user-wide profile exactly as before this capability existed.

#### Scenario: Override replaces the profile for that space

- **WHEN** a space's project config carries a workflow selection override and the user-wide profile is `full`
- **THEN** the space's desired workflow set is the override list plus its dependency closure, not the full profile's set

#### Scenario: Spaces without an override are unaffected

- **WHEN** one space carries an override and a second space does not
- **THEN** the second space's desired workflow set resolves from the user-wide profile exactly as it did before, and changes to the first space's override never alter it

#### Scenario: Closure still applies to an override

- **WHEN** an override selects a workflow whose dependency closure requires an expert the override omits
- **THEN** the space's desired set includes that expert

### Requirement: Apply and drift honor the per-space selection

Applying workflows to a space (the update flow) SHALL install and remove skill artifacts against that space's effective selection — the override when present, the user-wide profile otherwise — and profile drift detection SHALL evaluate the same per-space effective selection, so a space that intentionally differs from the user-wide profile is never reported as drifted and is never reverted by an apply.

#### Scenario: Update applies the override

- **WHEN** the user runs the update flow in a space whose override omits a workflow the user-wide profile includes
- **THEN** that workflow's skill artifacts are not installed in the space (and are removed if present), while other spaces keep it

#### Scenario: An intentional difference is not drift

- **WHEN** a space's installed set matches its own override but differs from the user-wide profile
- **THEN** drift detection reports no drift for that space

#### Scenario: Real drift is still detected against the override

- **WHEN** a space's installed set differs from its own override's resolved closure
- **THEN** drift detection reports the difference

### Requirement: A space can be reset to follow the user-wide profile

Removing a space's workflow selection override SHALL return the space to following the user-wide profile, and the next apply SHALL reconcile the space's installed artifacts to the profile's resolved set.

#### Scenario: Reset restores profile-following behavior

- **WHEN** a space's override is removed and the update flow runs in that space
- **THEN** the space's installed workflows match the user-wide profile's resolved set, exactly as a space that never had an override

### Requirement: The CLI names an active override where it reports selection state

Where the CLI reports selection state for a project — the update flow's profile notes and the profile editor's project-drift warning — it SHALL name that the project carries its own workflow selection when an override is active, so a CLI user is never left believing an intentionally different space is misconfigured.

#### Scenario: Update in an overridden space says so

- **WHEN** the update flow runs in a space carrying an override
- **THEN** its output states the space uses its own workflow selection rather than the user-wide profile
