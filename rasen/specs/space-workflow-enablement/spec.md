# space-workflow-enablement Specification

## Purpose
Let one space carry its own workflow selection: a project-scope override of the user-wide profile, honored by apply and drift, so enabling or disabling a workflow in one space never changes any other space.
## Requirements
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

### Requirement: A space can be switched to a profile over the enablement API

The per-space enablement API SHALL offer mutations that switch a space to a named profile and back: setting a space's profile writes the space's profile lock to `full`, `core`, or a saved profile name (unknown names and `custom` are refused), and clearing it removes the lock so the space follows the user-wide profile again. Because a space's own workflow selection override always shadows a profile lock, setting a profile SHALL also remove the space's override in the same mutation — a profile switch takes effect immediately rather than being silently shadowed. Clearing the profile SHALL NOT touch an override. Like the existing enable/disable/reset mutations, a profile switch SHALL apply immediately (install/remove through the same bounded apply flow), SHALL return the space's fresh post-apply state, SHALL refuse a second mutation while one is in flight, and on an apply failure SHALL report the error together with the space's actual post-write state.

#### Scenario: Setting a profile locks and applies

- **WHEN** a client sets a space's profile to a saved profile name
- **THEN** the space's configuration carries that profile lock, its workflow selection override (if any) is removed, the apply runs, and the response reflects the profile's resolved workflow set

#### Scenario: Unknown or non-lockable profile refused

- **WHEN** a client sets a space's profile to `custom` or to a name that is neither built-in nor saved
- **THEN** the mutation is refused with a message naming the problem and nothing is written

#### Scenario: Clearing returns the space to the user-wide profile

- **WHEN** a client clears the profile of a space that carries a profile lock and no override
- **THEN** the lock is removed, the apply runs, and the response shows the space following the user-wide profile

### Requirement: The enablement read names the governing profile lock

The per-space enablement read SHALL report, alongside the existing mode (user-wide profile, own selection, or locked profile), the name of the profile lock when one governs the space — so a client can show *which* profile the space is locked to, not merely that a lock exists.

#### Scenario: Locked space names its profile

- **WHEN** a client reads enablement state for a space locked to saved profile `my-set`
- **THEN** the response's mode is the locked-profile mode and carries the name `my-set`

#### Scenario: Unlocked space carries no lock name

- **WHEN** a client reads enablement state for a space with no profile lock
- **THEN** the response carries no lock name

