# profiles Delta

## ADDED Requirements

### Requirement: The user-wide profile can name a saved profile

The user-wide (global) profile setting SHALL accept a saved profile name in addition to `full`, `core`, and `custom`. When the user-wide profile names a saved profile, every consumer of the user-wide selection — the update flow, initialization, drift detection, and the per-space enablement read for spaces that follow the user-wide profile — SHALL resolve the desired workflow set from that saved definition's stored workflow list (plus the same dependency closure every selection resolves through). When the named profile cannot be resolved on this machine (missing or invalid file), resolution SHALL fall back to the default `full` profile with a warning naming the profile and the reason — never a hard error, mirroring the existing unresolvable project-lock behavior — so a machine missing a profile file keeps working.

#### Scenario: Update follows a saved user-wide profile

- **WHEN** the user-wide profile is set to saved profile `my-set` and the update flow runs in a space with no override and no lock
- **THEN** the space's desired workflow set resolves from `my-set`'s stored workflow list plus dependency closure, not from `full`

#### Scenario: Unresolvable saved name degrades gracefully

- **WHEN** the user-wide profile names a saved profile that has been deleted, and the update flow runs
- **THEN** resolution falls back to the `full` profile's set and a warning names the unresolvable profile and why, with no hard failure

#### Scenario: Reserved values behave exactly as before

- **WHEN** the user-wide profile is `full`, `core`, or `custom`
- **THEN** resolution behaves exactly as before this capability existed, including the expert-selection migration behavior
