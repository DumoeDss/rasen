## ADDED Requirements

### Requirement: Status and apply instructions surface next workflows
The `rasen status` and `rasen instructions` (apply) surfaces SHALL emit the runtime-resolved next workflow(s) for the change, filtered to the installed workflow set. In `--json` output this SHALL be a `nextWorkflows` array of `{ workflow, reason }` objects (a field distinct from the existing `nextSteps` artifact-authoring string array). In human-readable output this SHALL be a trailing `Next:` hint line. When resolution yields no installed next workflow, `nextWorkflows` SHALL be an empty array and no `Next:` line SHALL be printed.

#### Scenario: Apply instructions JSON includes nextWorkflows on completion
- **WHEN** `rasen instructions apply --change <name> --json` is run for a change whose tasks are all complete
- **THEN** the payload SHALL include a `nextWorkflows` array whose entries each have a `workflow` (canonical id) and a `reason`
- **AND** under a `core` profile (no `verify`/`ship`) the entry SHALL be `archive`, not an uninstalled workflow

#### Scenario: Apply instructions JSON while blocked
- **WHEN** `rasen instructions apply --json` is run for a change blocked on missing artifacts
- **THEN** `nextWorkflows` SHALL point at the authoring continuation (e.g. `continue`, or the nearest installed authoring step)

#### Scenario: Status JSON includes nextWorkflows when artifacts are complete
- **WHEN** `rasen status --change <name> --json` is run and all artifacts are complete
- **THEN** the payload SHALL include a `nextWorkflows` entry for `apply`
- **AND** the pre-existing `nextSteps` string array SHALL remain unchanged in shape and meaning

#### Scenario: Human-readable Next hint
- **WHEN** the apply or status text output is printed and a next workflow resolves
- **THEN** a trailing `Next: <workflow> — <reason>` line SHALL be shown
- **AND** an internal `-command` suffix SHALL be stripped from the displayed workflow name
- **AND** any command the hint prints SHALL carry the active `--store`/`--project` flag when the surface was invoked in a store- or project-scoped root

Note: the current `Next:` hint prints only the bare workflow name and a
prose reason — never a runnable `rasen ...` command line, because under
skills-only delivery the next workflow is invoked as a skill in the user's
agent (e.g. `/rasen:verify`), not as a scoped `rasen` subcommand a
`--store`/`--project` flag would need to be threaded onto. The store/
project-flag clause above therefore has no antecedent today and is
vacuously satisfied; it stays in the requirement as a forward-looking
constraint in case a later change adds a runnable command to the hint.

#### Scenario: No next workflow installed
- **WHEN** resolution finds no installed downstream workflow
- **THEN** `nextWorkflows` SHALL be an empty array
- **AND** no `Next:` line SHALL be printed
