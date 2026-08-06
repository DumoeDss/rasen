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

The system SHALL create a new Change through the resolved project planning scope with validation and no-clobber publication. Standalone projects SHALL retain their existing Change path and metadata compatibility. Store v2 creation SHALL require Store, project, stable target-line, and verified planning-worktree authority, SHALL create the Change in the selected project partition, and SHALL write Foundation v2 portable identity metadata. A caller SHALL NOT supply or override the identity seed, scope identity, or Change-instance identity.

#### Scenario: Create valid change

- **WHEN** a user runs `rasen new change add-feature` in a standalone project
- **THEN** the system SHALL create `rasen/changes/add-feature/` in that project
- **AND** existing standalone metadata behavior SHALL be preserved

#### Scenario: Create valid Store v2 Change

- **WHEN** a user runs `rasen new change add-feature --store S --project P --target-line L` with verified planning-worktree authority
- **THEN** the system SHALL create `add-feature` in S's project P active-Changes location
- **AND** `.openspec.yaml` SHALL carry a verified v2 identity for S, P, and L

#### Scenario: Invalid change name

- **WHEN** a user runs `rasen new change "Add Feature"` with an invalid name
- **THEN** the system SHALL display a validation error with guidance
- **AND** no Change location SHALL be created

#### Scenario: Duplicate change name

- **WHEN** a user creates a Change whose scope-resolved active location already exists
- **THEN** the system SHALL display an error indicating the Change already exists in that scope
- **AND** it SHALL not inspect another project partition as a fallback

#### Scenario: Create with description

- **WHEN** a user runs `rasen new change add-feature --description "Add new feature"`
- **THEN** the system SHALL create the Change with the description in `README.md`

#### Scenario: Store mutation authority is incomplete

- **WHEN** Store v2 creation lacks a project, target line, or verified planning worktree
- **THEN** the command SHALL fail with the corresponding stable planning-scope diagnostic
- **AND** it SHALL not write to the Store integration checkout or a flat Store directory

#### Scenario: Pipeline run-state initializes in the execution root

- **WHEN** a user runs `rasen new change add-feature --pipeline small-feature`
- **THEN** the Change's initial run-state SHALL be created in the execution root's ephemera directory (`<executionRoot>/.rasen/changes/add-feature/ephemera/`), never in the machine-home work directory
- **AND** creating a Change with the same name in a different execution worktree SHALL keep run-state isolated by that worktree

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

The status command SHALL provide machine-readable planning context for a Change. The context SHALL identify the scope kind, planning owner, Store/project/target-line facts when applicable, layout generation, planning-scope identity when derivable, planning intent, and scope-resolved artifact locations. Facts that cannot be proven SHALL be absent and SHALL NOT be guessed from a branch name or directory. Existing planning-home and root fields MAY remain as compatibility projections and SHALL be derived from the same scope.

#### Scenario: Reporting next steps

- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** the output SHALL include next-step guidance for agents
- **AND** the guidance SHALL use plain action language

#### Scenario: Store project status reports complete scope

- **WHEN** status reads a Change in a Store v2 project scope
- **THEN** its JSON SHALL identify the Store, project, target line, scope identity, layout, and resolved Change location
- **AND** it SHALL distinguish the planning checkout from the execution checkout when both are known

#### Scenario: Aggregate status cannot guess a project

- **WHEN** status receives only a Store aggregate scope for a named Change
- **THEN** it SHALL fail with `project_scope_required`
- **AND** it SHALL not search all projects for a coincidental matching Change id

### Requirement: Status JSON action context

The status command SHALL expose action context that lets agents act without hardcoded filesystem assumptions. The action context SHALL separately state the exact planning directories that may be written, the execution roots where code may be written, and roots that may only be read, together with the constraints the agent must respect and a version identifying the contract. Store v2 planning write roots SHALL be limited to the selected project partition and named Change locations returned by the planning scope; a Store repository root or another project partition SHALL NOT be granted. No user home directory SHALL appear in any list. When a session records planning and execution separately, the reported roots SHALL preserve that split. The earlier single-list form SHALL remain available only as a compatibility view that never grants a root the earlier contract would not have granted.

#### Scenario: Repo-local action context

- **GIVEN** the Change is repo-local
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** status JSON SHALL preserve existing artifact status behavior
- **AND** it SHALL report the standalone planning directories as planning write roots and that checkout as the code write root

#### Scenario: Store project context grants only its partition

- **GIVEN** the Change is planned in Store S for project P
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** planning write roots SHALL be locations inside S's P partition in the selected planning worktree
- **AND** S's repository root, every other project partition, and every other member checkout SHALL be absent from the write lists

#### Scenario: Store planning with project execution reports both roots

- **GIVEN** the Change is planned in a Store worktree while a project execution worktree is being used
- **WHEN** status JSON is produced
- **THEN** its planning roots SHALL come from the planning scope and its code root SHALL be the selected execution worktree
- **AND** neither side SHALL be inferred from the other

#### Scenario: Planning-only reports no code write root

- **GIVEN** the session has project planning authority but no execution project
- **WHEN** status JSON is produced
- **THEN** the action context SHALL report an empty set of code write roots
- **AND** it SHALL retain only the selected project's authorized planning write roots

#### Scenario: The compatibility view never widens access

- **WHEN** a consumer reads the earlier single-list form for any context shape
- **THEN** every root it receives SHALL be one the earlier form would also have granted for that same context
- **AND** an unprojectable context SHALL report a newer version rather than broadening the list

### Requirement: Instructions use resolved planning paths

Artifact and apply instructions SHALL use the selected planning scope's resolved Change and artifact locations rather than hardcoded repo-local or flat Store paths. Store v2 instructions SHALL carry the same Store, project, target-line, and scope facts as status. Instructions SHALL be read-only: generating them SHALL not create a scope, catalog, identity, or directory that was missing.

#### Scenario: Repo-local artifact instructions

- **GIVEN** the Change is repo-local
- **WHEN** a user runs `rasen instructions <artifact> --change <id> --json`
- **THEN** instruction output SHALL preserve existing repo-local paths

#### Scenario: Store v2 artifact instructions

- **GIVEN** the Change belongs to Store S, project P, and target line L
- **WHEN** artifact or apply instructions are requested
- **THEN** every resolved output and dependency path SHALL be inside the scope-resolved P Change
- **AND** the payload SHALL identify S, P, and L without deriving any of them from the path

#### Scenario: Instructions and status agree

- **WHEN** status and instructions address the same Change through equivalent selectors
- **THEN** their planning scope facts, Change root, and shared artifact paths SHALL be identical

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

The change-scoped workflow surfaces (`rasen status --change <n> --json`, `rasen instructions <artifact> --change <n> --json`, and apply instructions) SHALL expose absolute scope-resolved per-class landing directories: `evidenceDir` (`<changeRoot>/evidence`), `handoffDir` (`<changeRoot>/handoff`), and `ephemeraDir` (`<executionRoot>/.rasen/changes/<n>/ephemera`). Store v2 `changeRoot`, evidence, and handoff SHALL be inside the selected project partition; ephemera SHALL remain execution-owned. These fields SHALL derive without machine identity. The legacy `workDir` field SHALL additionally be present, probe-only, when the execution project already has machine identity, so sticky-legacy readers can inspect that location. No surface SHALL mint machine identity or create directories to produce these fields.

#### Scenario: Payloads include the landing directories

- **WHEN** status or instructions is produced for a Change
- **THEN** JSON SHALL include absolute `evidenceDir`, `handoffDir`, and `ephemeraDir` paths correct for its planning and execution scopes
- **AND** the paths SHALL be correct on Windows and POSIX platforms

#### Scenario: Store v2 planning and execution landings stay split

- **WHEN** a Store v2 Change uses a separate project execution worktree
- **THEN** evidence and handoff SHALL resolve in the Store project Change
- **AND** ephemera SHALL resolve in the execution worktree without using the Store path as a fallback

#### Scenario: Landing directories resolve without machine identity

- **WHEN** the execution project has no machine identity
- **THEN** the payload SHALL still include `evidenceDir`, `handoffDir`, and `ephemeraDir`
- **AND** it SHALL omit `workDir` and perform no writes

### Requirement: Status payload reports the fixed archive location and legacy archives

`rasen status --change <n> --json`'s `archive` object SHALL carry the absolute Archive location returned by the selected planning scope. A standalone or legacy project SHALL report its existing in-repo Archive directory; a Store v2 project Change SHALL report the selected project's stable target-line Archive directory. The object SHALL NOT carry a destination axis. When the execution project's machine home resolves by read-only probe and its legacy archive area exists, `legacyArchiveDir` SHALL name that area for legacy discovery. Resolving these fields SHALL not write or invoke Git or `gh`.

#### Scenario: Status exposes the fixed archive location

- **WHEN** status runs for a standalone Change
- **THEN** `archive.archiveDir` SHALL identify that project's existing in-repo Archive directory
- **AND** no `destination` field SHALL be present

#### Scenario: Store v2 status exposes target-line Archive location

- **WHEN** status runs for a Store v2 Change with verified target line L
- **THEN** `archive.archiveDir` SHALL identify that project's Archive line L in the selected Store planning checkout
- **AND** it SHALL not identify a root-level Store Archive

#### Scenario: Missing target line does not invent an Archive path

- **WHEN** a Store project read cannot prove the Change's target line
- **THEN** status SHALL report `target_line_required`
- **AND** it SHALL not substitute the project Archive parent or a branch-derived name

#### Scenario: Legacy archives surfaced read-only

- **WHEN** the execution project's machine home holds archives from the retired external destination
- **THEN** the payload SHALL include `legacyArchiveDir`
- **AND** the command SHALL perform no writes to produce it
