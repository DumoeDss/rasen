## ADDED Requirements

### Requirement: Known built-in workflows baseline

The global configuration SHALL record the set of built-in workflow ids that were known when the workflow selection was last saved, so `rasen update` can distinguish a workflow newly added to the catalog from one the user deliberately deselected. This baseline SHALL be written whenever a selection is persisted — applying a profile through the editor, `rasen init`, and existing-user migration — capturing the built-in workflow ids present at that moment. The field SHALL be optional and additive: a configuration written by an older version that lacks it SHALL be read without error, and a configuration missing it SHALL be seeded with the currently-known built-in workflow ids on first read by `update`, without emitting any notice, so no pre-existing omission is surprised onto the user.

#### Scenario: Baseline recorded when a selection is saved
- **WHEN** the user applies a profile through the interactive editor
- **THEN** the global config SHALL record the built-in workflow ids known at that time as the baseline

#### Scenario: Legacy config without a baseline is tolerated and seeded
- **WHEN** `rasen update` reads a global config that has no known-built-in-workflows baseline
- **THEN** the command SHALL succeed
- **AND** SHALL seed the baseline with the currently-known built-in workflow ids
- **AND** SHALL NOT surface any workflow as newly available on that run
