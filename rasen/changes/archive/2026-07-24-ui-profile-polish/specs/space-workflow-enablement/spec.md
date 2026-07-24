# space-workflow-enablement Delta

## MODIFIED Requirements

### Requirement: A space can be switched to a profile over the enablement API

The per-space enablement API SHALL offer mutations that switch a space to a named profile and back: setting a space's profile writes the space's profile lock to `full`, `core`, or a saved profile name (unknown names and `custom` are refused), and clearing it removes the lock so the space follows the user-wide profile again. Because a space's own workflow selection override always shadows a profile lock, setting a profile SHALL also remove the space's override in the same mutation — a profile switch takes effect immediately rather than being silently shadowed. Clearing the profile SHALL NOT touch an override — clearing the lock alone is a deliberate lock-only operation. Returning a space that carries its own override to the user-wide profile therefore requires a distinct follow-global mutation, which SHALL remove BOTH the workflow selection override AND the profile lock atomically in one write, so the space genuinely follows the user-wide profile (clearing only the lock would be shadowed by the surviving override, and clearing only the override would reveal any lock beneath it). Like the existing enable/disable/reset mutations, a profile switch and the follow-global mutation SHALL apply immediately (install/remove through the same bounded apply flow), SHALL return the space's fresh post-apply state, SHALL refuse a second mutation while one is in flight, and on an apply failure SHALL report the error together with the space's actual post-write state.

#### Scenario: Setting a profile locks and applies

- **WHEN** a client sets a space's profile to a saved profile name
- **THEN** the space's configuration carries that profile lock, its workflow selection override (if any) is removed, the apply runs, and the response reflects the profile's resolved workflow set

#### Scenario: Unknown or non-lockable profile refused

- **WHEN** a client sets a space's profile to `custom` or to a name that is neither built-in nor saved
- **THEN** the mutation is refused with a message naming the problem and nothing is written

#### Scenario: Clearing returns the space to the user-wide profile

- **WHEN** a client clears the profile of a space that carries a profile lock and no override
- **THEN** the lock is removed, the apply runs, and the response shows the space following the user-wide profile

#### Scenario: Follow-global clears both the override and the lock

- **WHEN** a client issues the follow-global mutation for a space that carries both its own workflow selection override and a profile lock
- **THEN** both the override and the lock are removed in one write, the apply runs, and the response shows the space following the user-wide profile — where clearing only the lock would have left the override still governing
