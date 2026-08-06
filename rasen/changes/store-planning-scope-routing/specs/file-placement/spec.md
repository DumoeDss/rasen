## MODIFIED Requirements

### Requirement: Seven file classes each land in their owner root

Every file a Change produces SHALL belong to exactly one of seven classes, and each class SHALL land at a fixed location returned by its owner scope—never from placement configuration:

- fixed planning files (`proposal.md`, `design.md`, `tasks.md`, `specs/`, `planning-context.md`) — project planning scope: `<changesDir>/<change>/`;
- design docs (office-hours, design-consultation, design-review, qa design docs, test plans, and design audits) — the selected project scope's project-design-docs location, or the Store scope's Store-design-docs location only for genuinely cross-project design;
- evidence (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`, `verification-report.md`, `ship-log.md`, and verification drivers delivered for re-running) — project planning scope: `<changeRoot>/evidence/`;
- handoff (handoff documents and relay prompts) — project planning scope: `<changeRoot>/handoff/`;
- probes (executable, reproducible investigation code and manifests) — execution root, by project convention with a fixed fallback;
- ephemera (run-state, raw logs/captures, caches, and regenerable intermediates) — execution root: `<executionRoot>/.rasen/changes/<change>/ephemera/`;
- coordination (cross-run and cross-worktree arbitration state) — machine root, CLI-owned and accessed only through `rasen` commands.

For a standalone project, the resolver returns the existing in-project locations. For a Store v2 project, `changesDir`, `changeRoot`, project design docs, evidence, and handoff SHALL be inside `rasen/projects/<projectId>/` in the selected Store planning checkout. Store-level design docs remain separate. The execution root is the code checkout/worktree the run operates on and SHALL NOT be inferred from a Store planning root; planning-only work has no execution root.

#### Scenario: Evidence lands with the change

- **WHEN** a dispatched expert or verification workflow produces a report for a Change
- **THEN** the report SHALL land under that scope's `<changeRoot>/evidence/`
- **AND** it SHALL remain with the Change through later Archive accounting

#### Scenario: Handoff lands with the change

- **WHEN** a worker or session writes a handoff document or relay prompt
- **THEN** the file SHALL land under that scope's `<changeRoot>/handoff/`

#### Scenario: Ephemera lands in the execution root

- **WHEN** run-state is first recorded for a Change with an execution worktree
- **THEN** it SHALL land under `<executionRoot>/.rasen/changes/<change>/ephemera/`
- **AND** whether it enters Git SHALL be governed solely by the user's `.gitignore`

#### Scenario: Store-selected run splits planning and execution landings

- **WHEN** a Change is planned in a Store v2 project partition and implemented in a project execution worktree
- **THEN** planning files, evidence, and handoff SHALL land in that Store project partition
- **AND** probes and ephemera SHALL land in the execution project without granting another Store member write access

#### Scenario: Planning-only work has no execution fallback

- **WHEN** a Store planning scope has no verified execution checkout
- **THEN** execution-owned locations SHALL be reported as unavailable
- **AND** no Store checkout or current directory SHALL be substituted as an execution root

### Requirement: Per-class landing resolvers are pure

Each planning-owned landing SHALL be resolved from a typed address on one frozen planning scope, and each execution-owned landing SHALL be resolved from one frozen execution context. Resolution SHALL return an absolute path without configuration branching, filesystem probing, or directory creation. Store v2 planning paths SHALL use the Foundation layout contract; standalone paths SHALL preserve the current layout. All construction and containment checks SHALL use the selected `win32`, `posix`, or native path implementation, and callers SHALL NOT supply arbitrary Store-relative path strings.

#### Scenario: Resolution needs no machine identity

- **WHEN** landing paths are resolved for a project with no machine-home registration
- **THEN** evidence, handoff, and—when execution authority exists—ephemera locations SHALL resolve from the planning and execution contexts alone
- **AND** resolution SHALL create no directory, registry entry, or identity

#### Scenario: Same typed address is deterministic

- **WHEN** the same typed address is resolved twice on one frozen scope
- **THEN** both results SHALL be the same canonical absolute path
- **AND** resolution SHALL not consult a changed current directory

#### Scenario: Windows and POSIX containment is explicit

- **WHEN** equivalent tests resolve Store project and standalone addresses with `win32` and `posix` path identity
- **THEN** each result SHALL use the selected platform's native path semantics
- **AND** traversal, separator, device-name, and case-alias inputs SHALL fail before access

### Requirement: Design-docs resolve from the planning root with a root-relative fallback

Office-hours, design-consultation, design-review, qa, and qa-only SHALL request either the project-design-docs or Store-design-docs typed address from the selected planning scope. Project work SHALL default to project design docs: standalone projects use their existing planning directory and Store-backed projects use their project partition. Store design docs SHALL be used only when the work is explicitly cross-project. When CLI scope resolution is unavailable for an unbound standalone project, the fallback SHALL remain anchored to the repository root, never the current working directory. A Store-backed or ambiguous scope SHALL fail rather than use a standalone fallback.

#### Scenario: Design doc lands in the planning root

- **WHEN** a project-level design workflow runs for an unbound standalone project
- **THEN** its document SHALL land in that project's existing design-docs directory

#### Scenario: Store-backed project design doc uses its partition

- **WHEN** the same workflow runs for project P bound to Store S
- **THEN** its document SHALL land in P's project-design-docs location inside S
- **AND** it SHALL not land in S's cross-project design-docs directory

#### Scenario: Cross-project design uses the Store address

- **WHEN** a design workflow explicitly covers multiple projects in Store S
- **THEN** it SHALL use S's Store-design-docs location
- **AND** no one member project's design-docs directory SHALL be selected implicitly

#### Scenario: Fallback is never cwd-relative

- **WHEN** standalone project docs are resolved from a subdirectory and CLI resolution is unavailable
- **THEN** the fallback SHALL be anchored at the repository root
- **AND** a Store-backed or ambiguous case SHALL report an error instead of using that fallback

### Requirement: Placement consumers freeze one explicit root context

Placement consumers SHALL resolve one planning scope and one execution context at their authority boundary and carry those capabilities unchanged to downstream consumers. The planning scope SHALL identify standalone or Store ownership, project identity, target line when applicable, layout, and explicit `win32` or `posix` path identity; the execution context SHALL identify the execution worktree and legacy machine-home owner when either exists. Planning-owned paths SHALL derive only from the planning scope's typed locations. Terminal execution paths and legacy-home lookup SHALL derive only from execution context. Unavailable authority SHALL remain unavailable rather than being inferred from current working directory, Store integration checkout, Store membership, branch names, or server launch roots.

#### Scenario: Store migration carries both roots

- **WHEN** an operation plans in a Store project scope and executes in a member worktree
- **THEN** every planning-owned destination SHALL derive from the frozen Store project scope
- **AND** every execution-owned destination and legacy-home lookup SHALL derive from the frozen member worktree context

#### Scenario: Consumer observes a frozen context

- **WHEN** current working directory, registration, Store membership, or binding changes after scope resolution
- **THEN** downstream read consumers SHALL continue using the frozen scope
- **AND** a mutation SHALL revalidate and fail as stale rather than silently redirect

#### Scenario: Missing execution authority is not guessed

- **WHEN** a terminal-state consumer receives planning scope without a usable execution root
- **THEN** it SHALL report terminal state as unavailable or absent
- **AND** it SHALL NOT inspect or write a guessed execution location

#### Scenario: Path flavor is deterministic on every host

- **WHEN** equivalent routing tests supply `win32` or `posix` identity flavor independently of the host operating system
- **THEN** comparison SHALL follow the supplied flavor
- **AND** construction SHALL use the corresponding platform path implementation rather than string concatenation
