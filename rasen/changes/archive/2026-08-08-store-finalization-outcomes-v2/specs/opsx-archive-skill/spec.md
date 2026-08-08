## ADDED Requirements

### Requirement: The archive skill declares one explicit finalization outcome in a Store v2 scope

When the resolved scope is a Store v2 project, the generated archive skill SHALL stop deferring finalization and SHALL instead require the user to choose exactly one outcome from `landed`, `superseded`, `cancelled`, and `abandoned` before it plans anything. It SHALL NOT choose an outcome, infer one from the presence of a ship log, a merged pull request, or completed tasks, or default to `landed`. It SHALL collect the non-empty reason every non-landed outcome requires and the successor Change instance `superseded` requires, and SHALL pass them to the CLI rather than recording them in prose. It SHALL continue to refuse a legacy flat Store with the layout-migration diagnostic, and SHALL continue to perform all bookkeeping through the authoritative archive command, never moving a change directory, writing a spec, or hand-writing a record itself. Bulk archiving SHALL apply the same rule per change: every change in a batch carries its own declared outcome, and no outcome is reused across changes.

#### Scenario: The skill asks rather than assumes

- **WHEN** the archive skill runs against a Store v2 project change
- **THEN** it SHALL present the four outcomes and require an explicit choice
- **AND** it SHALL NOT preselect one from ship, merge, or task-completion state

#### Scenario: A non-landed outcome collects its reason before planning

- **WHEN** the user chooses `superseded`, `cancelled`, or `abandoned`
- **THEN** the skill SHALL collect a non-empty reason, and for `superseded` a successor Change instance, before invoking the CLI
- **AND** it SHALL pass them as command options rather than writing them into an artifact

#### Scenario: A batch never shares one outcome

- **WHEN** bulk archiving several changes in a Store v2 project
- **THEN** each change SHALL carry its own declared outcome
- **AND** the batch SHALL refuse as a whole when any member has none

#### Scenario: The legacy refusal survives

- **WHEN** the archive skill runs against a Store that has not declared layout version 2
- **THEN** it SHALL still refuse with the layout-migration diagnostic and name the migration command
- **AND** the outcome axis SHALL NOT make the legacy flat layout archivable
