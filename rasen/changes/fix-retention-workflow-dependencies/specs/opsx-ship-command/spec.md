## ADDED Requirements

### Requirement: Ship exposes an available retention handoff

The ship workflow SHALL treat `rasen-retain` as its canonical post-ship retention handoff. A profile that installs `rasen-ship` SHALL also make `rasen-retain` available through workflow dependency closure, and post-ship guidance for a later archive SHALL present retention before archive so the selected profile policy can complete first.

#### Scenario: Standalone ship profile can continue to retention

- **WHEN** a user installs a profile containing `ship-command` without `auto-command` and invokes `rasen-ship`
- **THEN** `rasen-retain` SHALL be installed and available as the next retention step
- **AND** the user SHALL NOT be directed to an absent skill

#### Scenario: On-merge delivery orders retention before archive guidance

- **WHEN** a push, local, or merged PR delivery has completed under `archive.timing: on-merge`
- **THEN** post-ship guidance SHALL direct the selected retention operation before the archive action
- **AND** archive SHALL remain a separate later action after retention

#### Scenario: Retention off remains a valid handoff

- **WHEN** standalone ship hands off to `rasen-retain` while the active profile retention mode is `off`
- **THEN** retention SHALL complete successfully as a no-op
- **AND** the user MAY continue to archive without a retrospective or learned-skill mutation
