# space-workflow-enablement Delta Specification

## ADDED Requirements

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
