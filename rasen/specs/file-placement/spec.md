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
- **AND** the archive engine SHALL include it in the verified payload and final recursive evidence accounting

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

### Requirement: Archive dispositions classify every change-produced file

At archive time, every file a change has produced SHALL be classified into exactly one of four dispositions, determined by the file's class (per the seven-class model) and never by free-form judgment:

- **归档 (archive)**: 固定规划文件 (proposal.md, design.md, tasks.md, specs/, planning-context.md), evidence, and unabsorbed handoff — these travel in the verified archive payload.
- **清理 (clean)**: ephemera (run-state, raw logs, caches, regenerable intermediates) — deleted only from the complete cleaner plan with actual outcomes recorded.
- **静置 (leave)**: probes — not moved, copied, or deleted; the archive records each contained execution-root-relative path and its verified code commit.
- **out-of-scope**: design-docs (root-level, outlives any single change) and coordination (CLI lifecycle) — archive disposition logic does not scan them.

One archive engine SHALL own the complete classification and apply it for direct CLI, single-change skill, bulk skill, and in-ship archive entry points. Each entry point SHALL produce the same disposition and accounting for the same plan. The classification order (use-and-lifecycle first) governs borderline files.

#### Scenario: Evidence and planning files travel with the archive

- **WHEN** a change with `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `evidence/review-report.md` is archived
- **THEN** all of these SHALL appear in the verified archive payload
- **AND** their source SHALL remain available until publication and accounting are durable

#### Scenario: Probes are left in place and recorded

- **WHEN** a change with probe code at an execution-root path is archived
- **THEN** the probe directory SHALL NOT be moved, copied, or deleted
- **AND** the archive SHALL record the contained execution-root-relative path and a commit verified in that execution repository

#### Scenario: design-docs are not scanned

- **WHEN** the disposition logic runs at archive time
- **THEN** it SHALL NOT scan or classify `<planningRoot>/rasen/design-docs/`
- **AND** it SHALL NOT scan or classify machine-root coordination state

#### Scenario: Every entry point has the same disposition

- **WHEN** equivalent changes are archived through direct CLI, single archive, bulk archive, and in-ship workflows
- **THEN** every path SHALL receive the same archive, clean, leave, or out-of-scope disposition
- **AND** each successful archive SHALL contain the same form of accounting

### Requirement: Ephemera cleaner uses a whitelist by filename, never discretionary deletion

The ephemera cleaner SHALL delete only files whose names match a known whitelist of regenerable ephemera and whose content, when the filename denotes structured run-state, matches a schema supported by this Rasen version. It SHALL preserve every unknown, malformed, or unsupported entry byte-for-byte and report its exact path. It SHALL never recursively delete the ephemera directory or any part of the machine root.

The whitelist SHALL cover:

- **Run-state and control state**: `auto-run.json`, `portfolio-run.json`, `goal-run.json`, change-level `.signal`, `.lock`, `.heartbeat`, and `expert-selection-explicit.json`.
- **Regenerable raw material**: `*.log`, `raw-*.json`, `benchmark-*.json` at the ephemera directory's top level.

Before classifying a known structured run-state file as deletable, the cleaner SHALL parse it and validate it against that filename's supported schema and version markers. A versionless legacy shape SHALL be deletable only when the supported parser explicitly accepts that shape. Unknown fields accepted by a supported schema do not by themselves make a record a future version.

The cleaner SHALL preserve and report:

- Unknown filenames not in the whitelist.
- State files carrying an explicit version marker newer than or otherwise unsupported by this Rasen version.
- Malformed entries, including known state filenames whose JSON or schema is invalid.
- Nested directory entries and their contents.
- Symlinks and other non-regular filesystem entries.

Before any deletion, the cleaner SHALL recursively inspect the complete ephemera tree for source-code signals using the product's explicit manifest-name, source-directory, and source-extension lists. Discovery of a source manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `build.rs`, `rust-toolchain.toml`) or a source-tree structure at any depth SHALL abort cleaning for that change, preserve every entry, and report every discovered signal. A filesystem inspection error other than absence, including `EACCES`, `EPERM`, and `EIO`, SHALL produce an explicit blocked/error result and SHALL NOT be interpreted as an empty directory.

Every file deleted by the cleaner SHALL be listed in `archive.json`'s `ephemeraDiscarded` array. Every file preserved and reported SHALL appear in the archive output (human mode) or the JSON result's `ephemeraPreserved` array (JSON mode) so a human can judge it.

#### Scenario: Valid known run-state is deleted and accounted

- **WHEN** the ephemera directory contains schema-valid, supported `auto-run.json` and `portfolio-run.json` files
- **THEN** both files SHALL be deleted
- **AND** both filenames SHALL appear in `archive.json`'s `ephemeraDiscarded` array

#### Scenario: Malformed known run-state is preserved

- **WHEN** `auto-run.json`, `portfolio-run.json`, or `goal-run.json` contains invalid JSON or does not match its supported schema
- **THEN** the cleaner SHALL preserve the file byte-for-byte
- **AND** the cleaner SHALL report its exact path and validation reason

#### Scenario: Future-version known run-state is preserved

- **WHEN** a known run-state file carries an explicit version marker that this Rasen version does not support
- **THEN** the cleaner SHALL preserve the file byte-for-byte
- **AND** the cleaner SHALL report that its version is unsupported

#### Scenario: Unknown file is preserved and reported

- **WHEN** the ephemera directory contains a file named `custom-experiment.json` that is not in the whitelist
- **THEN** the file SHALL be left in place byte-for-byte
- **AND** its exact path SHALL be reported in the archive output

#### Scenario: Nested source tree aborts all cleaning

- **WHEN** the ephemera directory contains a valid deletable run-state file and a nested source-tree signal such as `research/probe/src/main.ts`
- **THEN** the cleaner SHALL recursively discover and report the source-tree signal before deletion
- **AND** no ephemera entry, including the otherwise deletable run-state file, SHALL be deleted

#### Scenario: Nested non-source directory is preserved

- **WHEN** the ephemera directory contains a subdirectory `research/data/` with no source-code signal
- **THEN** the subdirectory and all its contents SHALL be left in place
- **AND** its path SHALL be reported in the archive output

#### Scenario: Permission or I/O failure blocks cleaning

- **WHEN** any directory or candidate file needed for complete classification fails to read with `EACCES`, `EPERM`, or `EIO`
- **THEN** the cleaner SHALL report the failed path and error
- **AND** no ephemera file SHALL be deleted for that change

#### Scenario: Windows paths retain exact identity

- **WHEN** cleaning runs on Windows with nested paths containing drive letters and backslash separators
- **THEN** containment checks and on-disk access SHALL use platform-native path semantics
- **AND** reported paths SHALL identify the same entries deterministically without relying on a forward-slash filesystem path

### Requirement: Handoff absorption is the sole discretionary point at archive

At archive time, handoff contents SHALL receive an absorption judgment: a handoff document whose dead-ends and eliminated hypotheses are already absorbed by `design.md` or evidence has outcome `absorbed`; one whose content is not absorbed has outcome `preserved` and lands under the archive's `evidence/handoff/`.

The default SHALL be preservation. The skill SHALL record judgment as versioned, change-bound intent without deleting or moving the active handoff. The archive engine SHALL validate the complete handoff inventory, allowed outcomes, and contained relative paths before applying those decisions only to the staged payload. If no judgment is supplied, the handoff directory SHALL travel unchanged and `handoffAbsorbed` SHALL record that no judgment was made. A malformed, future-version, incomplete, escaping, or unreadable sidecar SHALL block archive rather than be treated as absent.

#### Scenario: Absorbed handoff is omitted from the staged archive and recorded

- **WHEN** a handoff document's dead-ends and eliminated hypotheses are already covered by `design.md` or evidence
- **THEN** the validated staged payload SHALL omit the handoff document
- **AND** its active source SHALL remain until archive completion
- **AND** its path SHALL appear in `handoffAbsorbed` with an `absorbed` outcome

#### Scenario: Unabsorbed handoff moves within the staged payload

- **WHEN** a handoff document contains knowledge not yet absorbed by `design.md` or evidence
- **THEN** the staged payload SHALL place it under `evidence/handoff/`
- **AND** its active source SHALL remain until archive completion
- **AND** its path SHALL appear in `handoffAbsorbed` with a `preserved` outcome

#### Scenario: No absorption judgment preserves everything

- **WHEN** the CLI archives a change with no sidecar
- **THEN** only sidecar `ENOENT` SHALL select the no-judgment state
- **AND** the complete `handoff/` directory SHALL travel unchanged
- **AND** `handoffAbsorbed` SHALL distinguish no judgment from a completed empty judgment

#### Scenario: Invalid handoff intent blocks archive

- **WHEN** the sidecar is malformed, names another change, omits an inventoried handoff, uses an unknown outcome, or contains an absolute or escaping path
- **THEN** the archive plan SHALL report a blocker
- **AND** no handoff, ephemera, active change, or archive target SHALL be mutated

### Requirement: archive.json records disposition accounting without the planning-root commit hash

Every successful archive SHALL contain an `archive.json` file recording:

- `change`: the semantic change name.
- `archivedAt`: ISO-8601 timestamp.
- `codeCommit`: the execution root's confirmed HEAD commit SHA, or `null` only for a confirmed non-Git execution root.
- `planningBranch`: the planning root's current branch, or `null` for a confirmed non-Git or detached planning root.
- `planningTreeState`: `clean` or `dirty`.
- `evidence`: stable relative paths and SHA-256 hashes for every file recursively contained by the finalized `evidence/` tree.
- `probes`: validated execution-root-relative paths and commits that exist as commit objects in the execution repository.
- `handoffAbsorbed`: the validated handoff judgment outcome, with a distinct no-judgment state.
- `ephemeraDiscarded`: only the cleaner candidates actually disposed during this transaction.
- `missing`: expected but absent evidence items.

The finalized evidence tree SHALL include staged handoff preservation, the archive section of `ship-log.md`, and quality-report capture before hashing. No successful workflow SHALL mutate a hashed evidence file afterward. `archive.json` SHALL NOT record the planning-root commit hash because that would be an unclosable self-reference. Confirmed non-Git states may use their defined null/clean representation; Git ambiguity, command failure, permission/I/O failure, evidence read failure, or hash drift SHALL block or leave the transaction journaled rather than silently producing null, clean, or an incomplete inventory.

#### Scenario: archive.json carries codeCommit and branch, not planning commit

- **WHEN** `archive.json` is finalized during archive
- **THEN** it SHALL carry the confirmed execution `codeCommit`, `planningBranch`, and `planningTreeState`
- **AND** it SHALL NOT carry any field whose value is the planning-root commit SHA

#### Scenario: Final recursive evidence hashes are recorded

- **WHEN** the finalized archive contains top-level and nested evidence files
- **THEN** every file SHALL appear in the `evidence` array with a stable relative path and SHA-256 hash
- **AND** re-hashing the successful archive SHALL reproduce every recorded digest

#### Scenario: Missing items are listed honestly

- **WHEN** a change is archived without a ship log or verification report
- **THEN** `archive.json`'s `missing` array SHALL list those absent items

#### Scenario: Git or evidence uncertainty fails closed

- **WHEN** a Git query or relevant evidence read fails for a reason other than a confirmed non-Git root or `ENOENT` evidence directory
- **THEN** archive SHALL report the exact failed operation and path
- **AND** SHALL NOT finalize `archive.json` with guessed values or a partial evidence inventory

#### Scenario: Later workflow steps do not invalidate evidence

- **WHEN** a successful archive has recorded the ship-log hash in `archive.json`
- **THEN** single, bulk, and in-ship workflows SHALL perform no later append or rewrite of that ship log
- **AND** the recorded hash SHALL remain valid after the workflow reports completion

### Requirement: Archive publication is recoverable and source-last

Archive publication SHALL preserve the active change and its execution-root ephemera until a verified archive payload and a durable recovery record exist. A successful archive SHALL contain final disposition accounting; an interrupted archive SHALL leave either the active state unchanged or a journal that identifies the exact transaction phase, surviving source and destination paths, and safe resume action. Publication SHALL never overwrite an existing archive.

The archive payload SHALL be staged and verified before it becomes the final date-prefixed archive. Cross-device fallback, when required by a supported publication primitive, SHALL run only for the explicit cross-device condition, create destinations without clobbering, verify the complete copy, and remove the source last. Permission and I/O errors SHALL remain failures and SHALL NOT trigger fallback.

#### Scenario: Failure before publication preserves active state

- **WHEN** staging, evidence hashing, Git inspection, or accounting fails before the archive is published
- **THEN** the active change and every ephemera entry SHALL remain available
- **AND** no final archive SHALL be reported as complete

#### Scenario: Failure after publication is journaled

- **WHEN** a failure occurs after a staged archive is published but before final cleanup completes
- **THEN** the active source SHALL remain available
- **AND** the published archive SHALL contain a recovery record identifying the transaction and incomplete phase
- **AND** a retry SHALL resume only when the recorded plan identity matches

#### Scenario: Concurrent target is never overwritten

- **WHEN** an archive target appears after planning or an unrelated target already occupies the date-prefixed path
- **THEN** archive apply SHALL preserve the active change and existing target byte-for-byte
- **AND** SHALL report a target conflict rather than merging with or replacing the target

#### Scenario: Permission failure does not use cross-device fallback

- **WHEN** archive publication fails with `EPERM`, `EACCES`, or `EIO`
- **THEN** the operation SHALL fail with the original error
- **AND** no cross-device copy fallback SHALL run
- **AND** the active source SHALL remain available

#### Scenario: Native paths preserve transaction identity

- **WHEN** equivalent archives are planned on Windows, macOS, and Linux
- **THEN** staging, containment, target identity, and journal paths SHALL use platform-native path semantics
- **AND** a transaction SHALL resolve the same semantic archive without depending on one platform's separator or case rules

### Requirement: Placement consumers freeze one explicit root context

Placement consumers SHALL resolve one context at their authority boundary when
a command or read model can operate with different planning and execution
roots, and SHALL carry that
context unchanged to every placement consumer. The context SHALL identify the
planning root, execution root when one exists, legacy machine-home owner, and
explicit `win32` or `posix` path-identity flavor. Planning-owned paths SHALL
derive only from the planning root; terminal execution paths and legacy-home
lookup SHALL derive only from the execution context. A downstream consumer
SHALL treat unavailable execution authority as unavailable rather than infer a
replacement from the current working directory, planning root, Store
membership, or server launch root.

#### Scenario: Store migration carries both roots

- **WHEN** a migration plans in a Store and executes in a member worktree
- **THEN** every planning-owned destination SHALL derive from the frozen Store
  root
- **AND** every execution-owned destination and legacy-home lookup SHALL derive
  from the frozen member worktree root

#### Scenario: Consumer observes a frozen context

- **WHEN** current working directory, registration, or Store membership changes
  after a migration preview or session launch
- **THEN** downstream apply and read consumers SHALL continue using the context
  frozen at that authority boundary

#### Scenario: Missing execution authority is not guessed

- **WHEN** a terminal-state consumer receives planning context without a usable
  execution root
- **THEN** it SHALL report terminal state as unavailable or absent
- **AND** SHALL NOT inspect or write a guessed execution location

#### Scenario: Path flavor is deterministic on every host

- **WHEN** equivalent routing tests supply `win32` or `posix` identity flavor
  independent of the host operating system
- **THEN** path comparison SHALL follow the supplied flavor
- **AND** path construction SHALL use the corresponding platform path API or
  the native path module rather than string concatenation
