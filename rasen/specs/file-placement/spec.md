# file-placement Specification

## Purpose
Define the seven-class file placement model — every file a change produces belongs to exactly one of seven classes (review-material, design-docs, evidence, handoff, probes, ephemera, coordination), each owned by one of three roots (planning, execution, machine) with a fixed landing path and no placement configuration — and the core invariant that any path an agent reads or writes with its own file tools must lie inside the planning root or the execution root, leaving the machine root for CLI-owned state only.
## Requirements
### Requirement: Agent-written files land inside the planning root or the execution root

Every path an agent reads or writes with its own file tools (Read/Write/Edit/Glob/Grep) SHALL be inside the planning root or the execution root. The machine root (`~/.rasen/`, overridable via `RASEN_HOME`) SHALL hold CLI-owned state only: agents SHALL never reference machine-root paths directly and SHALL access machine-root state only through `rasen` command input and output. Generated workflow and expert templates SHALL NOT instruct agents to construct, create, or append to machine-root paths. A root being visible to an agent process (for example via `--add-dir`) SHALL NOT be treated as authorization to write it.

#### Scenario: Generated templates carry no direct machine-root writes

- **WHEN** the generated expert and workflow templates are inspected
- **THEN** no template SHALL instruct the agent to create or append to a path under the machine root
- **AND** the office-hours quality-telemetry append to `~/.rasen/analytics/spec-review.jsonl` SHALL be absent from the generated template

#### Scenario: Landing points are taught as CLI-reported paths

- **WHEN** a generated template directs an agent where to write a report, handoff document, or run-state file
- **THEN** the location SHALL be a CLI-reported planning-root or execution-root path, never a path derived from `machineHome`

### Requirement: Seven file classes each land in their owner root

Every file a change produces SHALL belong to exactly one of seven classes, and each class SHALL land at a fixed location derived from its owner root — never from configuration:

- 固定规划文件 (proposal.md, design.md, tasks.md, specs/, planning-context.md) — planning root: `<planningRoot>/rasen/changes/<change>/`
- design-docs (office-hours / design-consultation / design-review / qa design docs, test plans, design audits) — planning root, root-level: `<planningRoot>/rasen/design-docs/`
- evidence (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`, `verification-report.md`, `ship-log.md`, and verification drivers delivered for re-running) — planning root: `<changeRoot>/evidence/`
- handoff (handoff documents, relay prompts) — planning root: `<changeRoot>/handoff/`
- probes (executable, reproducible investigation code and its manifests) — execution root, by project convention with a fixed fallback
- ephemera (run-state such as `auto-run.json` / `portfolio-run.json` / goal-loop run artifacts, raw logs and captures, caches, regenerable intermediates) — execution root: `<executionRoot>/.rasen/changes/<change>/ephemera/`
- coordination (cross-run / cross-worktree arbitration state) — machine root, CLI-owned, accessed only through `rasen` commands

The execution root is the code checkout/worktree the run operates on: for an in-repo project it equals the planning root; for a store-selected run it is the selected code project or worktree; running inside a store checkout with no code project, the store checkout itself is the execution root.

#### Scenario: Evidence lands with the change

- **WHEN** a dispatched expert or verification workflow produces a report for a change
- **THEN** the file SHALL land under `<changeRoot>/evidence/`
- **AND** the existing archive flow SHALL carry it with the change directory without any archive-side change

#### Scenario: Handoff lands with the change

- **WHEN** a worker or session writes a handoff document or relay prompt
- **THEN** the file SHALL land under `<changeRoot>/handoff/`

#### Scenario: Ephemera lands in the execution root

- **WHEN** run-state is first recorded for a change
- **THEN** the file SHALL land under `<executionRoot>/.rasen/changes/<change>/ephemera/`
- **AND** whether it enters Git SHALL be governed solely by the user's `.gitignore` (Rasen writes no ignore rules)

#### Scenario: Store-selected run splits planning and execution landings

- **WHEN** a change is driven with a store-selected planning root and a code project as the working directory
- **THEN** planning files, evidence, and handoff SHALL land in the store
- **AND** ephemera SHALL land in the code project's `.rasen/changes/<change>/ephemera/`

### Requirement: Per-class landing resolvers are pure

Each class's landing path SHALL be derivable by a pure resolver — owner root plus change name (plus probe name where applicable) in, absolute path out — with no configuration branch, no filesystem probing, and no directory creation. Consumers create what they use. All paths SHALL be built with the platform path module (Windows and POSIX).

#### Scenario: Resolution needs no machine identity

- **WHEN** a landing path is resolved for a project that has no machine-home registration
- **THEN** the evidence, handoff, and ephemera locations SHALL resolve successfully from the planning and execution roots alone
- **AND** resolution SHALL create no directories, registry entries, or identity

### Requirement: Zero placement configuration

No configuration key or command SHALL select where any file class lands. There SHALL be no `rasen placement` command surface and no `placement:` configuration block; `archive.destination` SHALL NOT be accepted by `rasen config set` (its compatibility read is defined by the `config-loading` capability). The only placement-adjacent decisions left to the user SHALL be `.gitignore` content and what to do with probes after archive — neither goes through Rasen.

#### Scenario: No placement command surface

- **WHEN** `rasen placement` (or any subcommand of it) is invoked
- **THEN** the CLI SHALL report an unknown command, as it does for any command that does not exist

#### Scenario: Destination key is not settable

- **WHEN** `rasen config set archive.destination external` runs in any scope
- **THEN** the command SHALL reject the key as not settable

### Requirement: Probes land by project convention with a fixed fallback

Guidance for placing probe/prototype/harness code SHALL direct agents to the project's own conventions first — an existing `experiments/`, `prototypes/`, `tools/`, or `fixtures/` directory, or a module-adjacent location matching the project's layout — and only when no project convention is identifiable, to the fixed fallback `<executionRoot>/.rasen/probes/<change>/<probe>/`. Probe landing SHALL have no external/machine-root option.

#### Scenario: Project convention preferred

- **WHEN** probe code is placed in a project that has an `experiments/` directory
- **THEN** the guidance SHALL direct the probe into the project's conventional location rather than the fallback

#### Scenario: Fallback when no convention is identifiable

- **WHEN** no project convention can be identified
- **THEN** the probe SHALL land at `<executionRoot>/.rasen/probes/<change>/<probe>/`

### Requirement: Design-docs resolve from the planning root with a root-relative fallback

The design-docs directory used by office-hours, design-consultation, design-review, qa, and qa-only SHALL resolve to `<planningRoot>/rasen/design-docs/`, derived from the CLI-reported planning root. When the CLI resolution is unavailable, the fallback SHALL also be root-relative (derived from the repository root), never relative to the current working directory. Design-docs are root-level: they belong to no single change and SHALL NOT be placed under a change directory or the machine root.

#### Scenario: Design doc lands in the planning root

- **WHEN** an office-hours session writes a design document
- **THEN** it SHALL land under `<planningRoot>/rasen/design-docs/`
- **AND** prior-design discovery (`ls`/`grep` over the docs directory) SHALL operate on the same location

#### Scenario: Fallback is never cwd-relative

- **WHEN** the docs directory is resolved from a subdirectory of the project and the CLI resolution is unavailable
- **THEN** the resolved fallback SHALL be anchored at the repository root, not the current working directory

### Requirement: Bulky raw research lands in the ephemera area

Propose/explore guidance SHALL direct bulky raw research material (scratch probing logs, fetched corpora, long transcripts) to a `research/` area inside the change's ephemera directory, with conclusions distilled into the committed change artifacts.

#### Scenario: Raw dumps stay out of the PR and the machine root

- **WHEN** the generated propose/explore guidance is inspected
- **THEN** it SHALL direct bulky raw research to the ephemera directory's `research/` area
- **AND** SHALL state that distilled conclusions belong in the committed change artifacts

### Requirement: Scheduling identifiers never appear in landing paths

Scheduling and DAG-internal identifiers (`g-003`-style node ids, slice ids, worker ids) SHALL appear only in run-state, portfolio metadata, and scheduling UI. Change directories, probe directories, archive directories, and every other landing path SHALL use semantic kebab-case names. Orchestration SHALL create child changes under semantic names; a portfolio node MAY carry a scheduling id in metadata alongside the semantic change name.

#### Scenario: Decompose children get semantic names

- **WHEN** the LEAD fans out a decomposed portfolio
- **THEN** each child change SHALL be created with a semantic kebab-case name
- **AND** any scheduling id for the node SHALL live only in the portfolio run-state metadata

### Requirement: One Git worktree resolves one workspace identity

Machine-root state scoped to a workspace SHALL be keyed by a workspace identity that distinguishes Git worktrees of the same project: a human-readable semantic project name plus a short anti-collision id derived from the canonicalized worktree path. Two worktrees of one project SHALL NOT share per-change agent-visible state through a common project home. The CLI SHALL expose the derived workspace identity read-only (via `rasen context --json`); machine-root `workspaces/<workspace-identity>/` state SHALL be created only by an actual coordination writer, not speculatively.

#### Scenario: Same-named changes in two worktrees do not collide

- **WHEN** two worktrees of one project each create a change with the same name using `rasen new change <name> --pipeline <p>`
- **THEN** both creations SHALL succeed
- **AND** each worktree's run-state SHALL live in its own execution root

#### Scenario: Workspace identity is observable

- **WHEN** `rasen context --json` runs inside a linked worktree of a registered project
- **THEN** the payload SHALL include the derived workspace identity, distinct from the identity derived in the main worktree

#### Scenario: No speculative workspace state

- **WHEN** the CLI resolves a workspace identity and no coordination feature has written workspace-scoped state
- **THEN** no `workspaces/` directory SHALL be created under the machine root

### Requirement: Classification asks use-and-lifecycle first

Classifying a file or directory into the seven classes SHALL ask, in order: does it outlive changes as design material (design-docs)? is it delivered with the Archive for later re-running or review (evidence — executables allowed; the test is "re-run by later readers", not "is it source")? is it source or a verification project delivered into code history (probes)? is it relay knowledge for successor workers/sessions (handoff)? is it cross-run/cross-worktree arbitration state (coordination)? otherwise it is recovery/regenerable material (ephemera). The first question SHALL NOT be "is it source".

#### Scenario: A verification harness classifies as evidence

- **WHEN** a `verification/` directory holding `verify.sh` and its `README.md` is classified
- **THEN** it SHALL classify as evidence (delivered with the Archive for re-running), not as probes, despite containing executable code

