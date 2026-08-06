## MODIFIED Requirements

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
