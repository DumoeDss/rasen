# cli-artifact-workflow Specification

## Purpose
Define artifact workflow CLI behavior (`status`, `instructions`, `templates`, and setup flows) for scaffolded and active changes.
## Requirements
### Requirement: Status Command

The system SHALL display artifact completion status for a change, including scaffolded (empty) changes.

> **Fixes bug**: Previously required `proposal.md` to exist via `getActiveChangeIds()`.

#### Scenario: Show status with all states

- **WHEN** user runs `rasen status --change <id>`
- **THEN** the system displays each artifact with status indicator:
  - `[x]` for completed artifacts
  - `[ ]` for ready artifacts
  - `[-]` for blocked artifacts (with missing dependencies listed)

#### Scenario: Status shows completion summary

- **WHEN** user runs `rasen status --change <id>`
- **THEN** output includes completion percentage and count (e.g., "2/4 artifacts complete")

#### Scenario: Status JSON output

- **WHEN** user runs `rasen status --change <id> --json`
- **THEN** the system outputs JSON with changeName, schemaName, isComplete, and artifacts array

#### Scenario: Status JSON includes apply requirements

- **WHEN** user runs `rasen status --change <id> --json`
- **THEN** the system outputs JSON with:
  - `changeName`, `schemaName`, `isComplete`, `artifacts` array
  - `applyRequires`: array of artifact IDs needed for apply phase

#### Scenario: Status on scaffolded change

- **WHEN** user runs `rasen status --change <id>` on a change with no artifacts
- **THEN** system displays all artifacts with their status
- **AND** root artifacts (no dependencies) show as ready `[ ]`
- **AND** dependent artifacts show as blocked `[-]`

#### Scenario: Missing change parameter

- **WHEN** user runs `rasen status` without `--change`
- **THEN** the system displays an error with list of available changes
- **AND** includes scaffolded changes (directories without proposal.md)

#### Scenario: Unknown change

- **WHEN** user runs `rasen status --change unknown-id`
- **AND** directory `rasen/changes/unknown-id/` does not exist
- **THEN** the system displays an error listing all available change directories

### Requirement: Next Artifact Discovery

The workflow SHALL use `rasen status` output to determine what can be created next, rather than a separate next-command surface.

#### Scenario: Discover next artifacts from status output

- **WHEN** a user needs to know which artifact to create next
- **THEN** `rasen status --change <id>` identifies ready artifacts with `[ ]`
- **AND** no dedicated "next command" is required to continue the workflow

### Requirement: Instructions Command

The system SHALL output enriched instructions for creating an artifact, including for scaffolded changes.

#### Scenario: Show enriched instructions

- **WHEN** user runs `rasen instructions <artifact> --change <id>`
- **THEN** the system outputs:
  - Artifact metadata (ID, output path, description)
  - Template content
  - Dependency status (done/missing)
  - Unlocked artifacts (what becomes available after completion)

#### Scenario: Instructions JSON output

- **WHEN** user runs `rasen instructions <artifact> --change <id> --json`
- **THEN** the system outputs JSON matching ArtifactInstructions interface

#### Scenario: Unknown artifact

- **WHEN** user runs `rasen instructions unknown-artifact --change <id>`
- **THEN** the system displays an error listing valid artifact IDs for the schema

#### Scenario: Artifact with unmet dependencies

- **WHEN** user requests instructions for a blocked artifact
- **THEN** the system displays instructions with a warning about missing dependencies

#### Scenario: Instructions on scaffolded change

- **WHEN** user runs `rasen instructions proposal --change <id>` on a scaffolded change
- **THEN** system outputs template and metadata for creating the proposal
- **AND** does not require any artifacts to already exist

### Requirement: Templates Command
The system SHALL show resolved template paths for all artifacts in a schema.

#### Scenario: List template paths with default schema
- **WHEN** user runs `rasen templates`
- **THEN** the system displays each artifact with its resolved template path using the default schema

#### Scenario: List template paths with custom schema
- **WHEN** user runs `rasen templates --schema tdd`
- **THEN** the system displays template paths for the specified schema

#### Scenario: Templates JSON output
- **WHEN** user runs `rasen templates --json`
- **THEN** the system outputs JSON mapping artifact IDs to template paths

#### Scenario: Template resolution source
- **WHEN** displaying template paths
- **THEN** the system indicates whether each template is from user override or package built-in

### Requirement: New Change Command
The system SHALL create new change directories with validation.

#### Scenario: Create valid change
- **WHEN** user runs `rasen new change add-feature`
- **THEN** the system creates `rasen/changes/add-feature/` directory

#### Scenario: Invalid change name
- **WHEN** user runs `rasen new change "Add Feature"` with invalid name
- **THEN** the system displays validation error with guidance

#### Scenario: Duplicate change name
- **WHEN** user runs `rasen new change existing-change` for an existing change
- **THEN** the system displays an error indicating the change already exists

#### Scenario: Create with description
- **WHEN** user runs `rasen new change add-feature --description "Add new feature"`
- **THEN** the system creates the change directory with description in README.md

#### Scenario: Pipeline run-state initializes in the execution root

- **WHEN** user runs `rasen new change add-feature --pipeline small-feature`
- **THEN** the change's initial run-state SHALL be created in the execution root's ephemera directory (`<executionRoot>/.rasen/changes/add-feature/ephemera/`), never in the machine-home work directory
- **AND** creating a change with the same name in a different worktree of the same project SHALL succeed (per-worktree run-state)

### Requirement: Schema Selection
The system SHALL support custom schema selection for workflow commands.

#### Scenario: Default schema
- **WHEN** user runs workflow commands without `--schema`
- **THEN** the system uses the "spec-driven" schema

#### Scenario: Custom schema
- **WHEN** user runs `rasen status --change <id> --schema tdd`
- **THEN** the system uses the specified schema for artifact graph

#### Scenario: Unknown schema
- **WHEN** user specifies an unknown schema
- **THEN** the system displays an error listing available schemas

### Requirement: Output Formatting
The system SHALL provide consistent output formatting.

#### Scenario: Color output
- **WHEN** terminal supports colors
- **THEN** status indicators use colors: green (done), yellow (ready), red (blocked)

#### Scenario: No color output
- **WHEN** `--no-color` flag is used or NO_COLOR environment variable is set
- **THEN** output uses text-only indicators without ANSI colors

#### Scenario: Progress indication
- **WHEN** loading change state takes time
- **THEN** the system displays a spinner during loading

### Requirement: Experimental Isolation
The system SHALL implement artifact workflow commands in isolation for easy removal.

#### Scenario: Single file implementation
- **WHEN** artifact workflow feature is implemented
- **THEN** all commands are in `src/commands/artifact-workflow.ts`

#### Scenario: Help text marking
- **WHEN** user runs `--help` on any artifact workflow command
- **THEN** help text indicates the command is experimental

### Requirement: Schema Apply Block

The system SHALL support an `apply` block in schema definitions that controls when and how implementation begins.

#### Scenario: Schema with apply block

- **WHEN** a schema defines an `apply` block
- **THEN** the system uses `apply.requires` to determine which artifacts must exist before apply
- **AND** uses `apply.tracks` to identify the file for progress tracking (or null if none)
- **AND** uses `apply.instruction` for guidance shown to the agent

#### Scenario: Schema without apply block

- **WHEN** a schema has no `apply` block
- **THEN** the system requires all artifacts to exist before apply is available
- **AND** uses default instruction: "All artifacts complete. Proceed with implementation."

### Requirement: Apply Instructions Command

The system SHALL generate schema-aware apply instructions via `rasen instructions apply`.

#### Scenario: Generate apply instructions

- **WHEN** user runs `rasen instructions apply --change <id>`
- **AND** all required artifacts (per schema's `apply.requires`) exist
- **THEN** the system outputs:
  - `contextFiles` mapping artifact IDs to arrays of concrete paths for all existing artifacts
  - Schema-specific instruction text
  - Progress tracking file path (if `apply.tracks` is set)

#### Scenario: Apply blocked by missing artifacts

- **WHEN** user runs `rasen instructions apply --change <id>`
- **AND** required artifacts are missing
- **THEN** the system indicates apply is blocked
- **AND** lists which artifacts must be created first

#### Scenario: Apply instructions JSON output

- **WHEN** user runs `rasen instructions apply --change <id> --json`
- **THEN** the system outputs JSON with:
  - `contextFiles`: object mapping artifact IDs to arrays of concrete paths for existing artifacts
  - `instruction`: the apply instruction text
  - `tracks`: path to progress file or null
  - `applyRequires`: list of required artifact IDs

### Requirement: Tool selection flag

The `artifact-experimental-setup` command SHALL accept a `--tool <tool-id>` flag to specify the target AI tool.

#### Scenario: Specify tool via flag

- **WHEN** user runs `rasen artifact-experimental-setup --tool cursor`
- **THEN** skill files are generated in `.cursor/skills/`
- **AND** command files are generated using Cursor's frontmatter format

#### Scenario: Missing tool flag

- **WHEN** user runs `rasen artifact-experimental-setup` without `--tool`
- **THEN** the system displays an error requiring the `--tool` flag
- **AND** lists valid tool IDs in the error message

#### Scenario: Unknown tool ID

- **WHEN** user runs `rasen artifact-experimental-setup --tool unknown-tool`
- **AND** the tool ID is not in `AI_TOOLS`
- **THEN** the system displays an error listing valid tool IDs

#### Scenario: Tool without skillsDir

- **WHEN** user specifies a tool that has no `skillsDir` configured
- **THEN** the system displays an error indicating skill generation is not supported for that tool

#### Scenario: Tool without command adapter

- **WHEN** user specifies a tool that has `skillsDir` but no command adapter registered
- **THEN** skill files are generated successfully
- **AND** command generation is skipped with informational message

### Requirement: Output messaging

The setup command SHALL display clear output about what was generated.

#### Scenario: Show target tool in output

- **WHEN** setup command runs successfully
- **THEN** output includes the target tool name (e.g., "Setting up for Cursor...")

#### Scenario: Show generated paths

- **WHEN** setup command completes
- **THEN** output lists all generated skill file paths
- **AND** lists all generated command file paths (if applicable)

#### Scenario: Show skipped commands message

- **WHEN** command generation is skipped due to missing adapter
- **THEN** output includes message: "Command generation skipped - no adapter for <tool>"

### Requirement: Status JSON provides planning context
The status command SHALL provide machine-readable planning context for changes.

#### Scenario: Reporting next steps
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** the output SHALL include next step guidance for agents
- **AND** the guidance SHALL use plain action language

### Requirement: Status JSON action context
The status command SHALL expose action context that lets agents act without hardcoded filesystem assumptions. The action context SHALL state separately the roots where planning artifacts may be written, the roots where code may be written, and the roots that may only be read, together with the constraints the agent is expected to respect, and SHALL carry a version identifying which contract it is reporting. Planning write access SHALL name the planning directories rather than a whole repository root, and no user home directory SHALL appear in any of the three lists. When the change is being worked on inside a session that records a planning space and an execution project separately, the reported roots SHALL reflect that split rather than collapsing to a single editable root. A consumer reading the earlier single-list form SHALL keep working through a compatibility view that never grants a root the earlier form would not have granted for that same context.

#### Scenario: Repo-local action context
- **GIVEN** the change is repo-local
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** status JSON SHALL preserve existing artifact status behavior
- **AND** it SHALL report a repo-local planning home for agents that use action context
- **AND** the action context SHALL report the project's planning directories as its planning write roots and that same checkout as its code write root

#### Scenario: Store planning with project execution reports both roots
- **GIVEN** the change is planned in a Store while a project checkout is being worked on
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** the action context SHALL report the Store's planning directories as planning write roots and the selected checkout as the code write root
- **AND** no other member checkout of that Store SHALL appear in any write list

#### Scenario: Planning-only reports no code write root
- **GIVEN** the session plans in a Store and works on no project
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** the action context SHALL report an empty set of code write roots
- **AND** it SHALL still report the Store's planning directories as planning write roots

#### Scenario: The compatibility view never widens access
- **WHEN** a consumer reads the earlier single-list form of the action context for any context shape
- **THEN** every root it receives SHALL be one the earlier form would also have granted
- **AND** a context that cannot be expressed in the earlier form without widening it SHALL report a version identifying the newer contract instead

### Requirement: Instructions use resolved planning paths
Artifact and apply instructions SHALL use resolved planning paths rather than hardcoded repo-local change paths.

#### Scenario: Repo-local artifact instructions
- **GIVEN** the change is repo-local
- **WHEN** a user runs `rasen instructions <artifact> --change <id> --json`
- **THEN** instruction output SHALL preserve existing repo-local paths

### Requirement: Workflow skills use CLI artifact context
Generated workflow skills SHALL use Rasen CLI output as the source of truth for artifact locations.

#### Scenario: Skills inspect status before artifact work
- **WHEN** a generated workflow skill needs to inspect or create artifacts for a change
- **THEN** it SHALL instruct the agent to run `rasen status --change <id> --json`
- **AND** it SHALL use returned planning context and artifact paths rather than assuming a repo-local change path

#### Scenario: Skills use instructions before writing artifacts
- **WHEN** a generated workflow skill is about to create or update an artifact
- **THEN** it SHALL instruct the agent to run `rasen instructions <artifact> --change <id> --json`
- **AND** it SHALL write to the resolved artifact path returned by the command

### Requirement: Status payload carries the resolved archive timing

`rasen status --change <n> --json` SHALL include an `archive` object carrying the resolved archive timing (`{ timing: "on-merge" | "in-ship" }`), with the default already applied, so workflow templates read one authoritative value from the payload they already consume instead of parsing config themselves. The field is additive; resolving it SHALL NOT invoke git or `gh` and SHALL NOT write anywhere.

#### Scenario: Status exposes the resolved timing

- **WHEN** `rasen status --change <n> --json` runs in a project whose config sets `archive.timing: in-ship`
- **THEN** the payload SHALL include `archive.timing` = `in-ship`

#### Scenario: Default exposed when unconfigured

- **WHEN** the project config has no `archive` block
- **THEN** the payload SHALL include `archive.timing` = `on-merge`
- **AND** the command SHALL perform no writes and no git/gh invocations for this field

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
agent (e.g. `/rasen-verify-change`), not as a scoped `rasen` subcommand a
`--store`/`--project` flag would need to be threaded onto. The store/
project-flag clause above therefore has no antecedent today and is
vacuously satisfied; it stays in the requirement as a forward-looking
constraint in case a later change adds a runnable command to the hint.

#### Scenario: No next workflow installed
- **WHEN** resolution finds no installed downstream workflow
- **THEN** `nextWorkflows` SHALL be an empty array
- **AND** no `Next:` line SHALL be printed

### Requirement: Change-scoped workflow payloads carry the per-class landing directories

The change-scoped workflow surfaces (`rasen status --change <n> --json`, `rasen instructions <artifact> --change <n> --json`, and the apply-instructions payload) SHALL expose the change's per-class landing directories as absolute paths: `evidenceDir` (`<changeRoot>/evidence`), `handoffDir` (`<changeRoot>/handoff`), and `ephemeraDir` (`<executionRoot>/.rasen/changes/<n>/ephemera`). These fields SHALL always be present (they derive from the planning and execution roots, needing no machine identity). The legacy `workDir` field SHALL additionally be present, probe-only, when the project already has a machine identity — absent otherwise — so sticky-legacy readers can check the legacy location. No surface SHALL mint machine identity or create directories to produce these fields.

#### Scenario: Payloads include the landing directories

- **WHEN** `rasen status --change <n> --json` or an instructions payload is produced
- **THEN** the JSON SHALL include absolute `evidenceDir`, `handoffDir`, and `ephemeraDir` paths
- **AND** the paths SHALL be correct on Windows and POSIX platforms

#### Scenario: Landing directories resolve without machine identity

- **WHEN** the project has no machine identity
- **THEN** the payload SHALL still include `evidenceDir`, `handoffDir`, and `ephemeraDir`
- **AND** SHALL omit `workDir` entirely
- **AND** the command SHALL perform no writes

### Requirement: Status payload reports the fixed archive location and legacy archives

`rasen status --change <n> --json`'s `archive` object SHALL carry `archiveDir` — the absolute in-repo archive directory (`<planningRoot>/rasen/changes/archive`), always present — and, when a machine home resolves by read-only probe and its archive area exists, `legacyArchiveDir` naming the machine-home archive for legacy discovery. The object SHALL NOT carry a `destination` axis. Resolving these fields SHALL NOT write anywhere and SHALL NOT invoke git or `gh`.

#### Scenario: Status exposes the fixed archive location

- **WHEN** `rasen status --change <n> --json` runs
- **THEN** the payload's `archive` object SHALL include the absolute in-repo `archiveDir`
- **AND** SHALL NOT include a `destination` field

#### Scenario: Legacy archives surfaced read-only

- **WHEN** the project's machine home holds archives from the retired external destination
- **THEN** the payload SHALL include `legacyArchiveDir`
- **AND** the command SHALL perform no writes to produce it

