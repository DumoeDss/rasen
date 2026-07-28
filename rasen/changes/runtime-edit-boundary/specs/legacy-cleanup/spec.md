## ADDED Requirements

### Requirement: Retired edit-boundary artifacts are pruned exactly

Init and update SHALL, before an up-to-date short circuit, remove the exact
installed directories `rasen-freeze`, `rasen-guard`, and `rasen-unfreeze`
from each configured tool skills root. They SHALL remove only the exact legacy
`freeze-dir.txt` state file from recognized old state roots and SHALL never
recursively remove the containing directory or unrelated hooks/state.

#### Scenario: Previously installed boundary skills are healed on update

- **WHEN** update finds one or more of the three exact retired directories
- **THEN** it SHALL remove them even when no other workflow needs refresh
- **AND** it SHALL preserve a user directory with a similar name

#### Scenario: Legacy state cleanup is scoped and idempotent

- **WHEN** old `freeze-dir.txt` exists in a recognized old state root
- **THEN** init/update SHALL remove that exact file
- **AND** repeated cleanup SHALL succeed without removing sibling files
