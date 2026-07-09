# change-work-dir Specification

## Purpose
Define the per-change external work directory: where process ephemera (run-state, handoff documents, expert/review reports, verification reports, ship logs) live once a project is registered in the machine home, how the CLI exposes the resolved location, and the sticky-legacy fallback that keeps changes already in flight working unchanged.

## Requirements
### Requirement: Each change has an external work directory for process ephemera

For a project registered in the machine home (the `project-registry` capability), each change SHALL have a per-change work directory at `changes/<change-name>/work` inside the project's machine home, holding the change's process ephemera: run-state (`auto-run.json`, `portfolio-run.json`, the goal-loop run artifact — `loop.runArtifact`, default `goal-run.json`), handoff documents and relay prompts (`handoff/`), expert and review reports (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`), `verification-report.md`, and `ship-log.md`. These files SHALL live outside the repository working tree from the moment they are created, requiring no git bookkeeping (no commits, no gitignore entries). Review material (proposal, design, tasks, delta specs) and knowledge documents (office-hours, research) are NOT process ephemera and SHALL remain in the change directory / planning root. All work-directory paths SHALL be constructed with the platform path module (Windows and POSIX).

#### Scenario: Ephemera leave git status clean

- **WHEN** a change is driven through a workflow that records run-state, writes reports, or produces handoff documents, and the tooling is current
- **THEN** those files SHALL be created under the change's work directory, not under the repository's changes directory
- **AND** `git status` SHALL show no untracked or modified files caused by process ephemera

#### Scenario: Work directory is GC-safe by construction

- **WHEN** the machine-home garbage collector (`doctor --gc`) evaluates directories under the projects area
- **THEN** work directories SHALL be inside a registered project home and SHALL NOT be treated as unreferenced orphans while the project's registry entry lives

#### Scenario: Work directory is shared across git worktrees

- **WHEN** two git worktrees of the same repository drive the same change
- **THEN** both SHALL resolve the same work directory (worktrees share one project home)
- **AND** run-state written from one worktree SHALL be readable from the other, and SHALL survive `git clean -fdx` in either

### Requirement: The CLI reports the resolved work directory; agents never derive it

The resolved absolute work directory SHALL be exposed only via the CLI: `rasen status --change <n> --json` SHALL include a top-level `workDir` field when resolvable, and the artifact-instructions and apply-instructions payloads SHALL include the same field. The instructions surfaces SHALL establish project identity when it does not exist yet (mint once, then reuse); purely informational surfaces (`status`, `pipeline resume`, `context`) SHALL only probe and SHALL NOT write to the repository or the registry. Workflow templates SHALL consume the CLI-reported `workDir` and SHALL NOT construct machine-home paths themselves.

#### Scenario: Status exposes the work directory

- **WHEN** `rasen status --change <n> --json` runs for a change in a registered project
- **THEN** the payload SHALL include an absolute `workDir` path for that change
- **AND** the human-readable output SHALL show the work directory

#### Scenario: Instructions establish identity once

- **WHEN** `rasen instructions <artifact> --change <n> --json` runs in a project that has no machine identity yet
- **THEN** the project SHALL be registered (identity minted, home created) and the payload SHALL include `workDir`
- **AND** subsequent calls SHALL reuse the existing registration without further repository writes

#### Scenario: Read-only surfaces never mutate

- **WHEN** `rasen status --change <n> --json` runs in a project that has no machine identity
- **THEN** the payload SHALL omit `workDir`
- **AND** the command SHALL NOT write to the repository, the registry, or the file system

#### Scenario: Root-scoped context shows the machine home

- **WHEN** `rasen context --json` runs for a registered project
- **THEN** the root object SHALL include the project's machine-home location (`machineHome`), and SHALL omit it for unregistered projects without side effects

### Requirement: Sticky-legacy fallback keeps old changes working

Ephemera placement SHALL degrade gracefully: readers SHALL look for an ephemeron in the work directory first and fall back to the change directory; a file that already exists in the change directory SHALL continue to live there (writers update it in place rather than creating a second copy in the work directory); new files SHALL be created in the work directory. When no `workDir` is available (unregistered project, older CLI payload), all reads and writes SHALL use the change directory exactly as before this capability existed. Archived changes SHALL NOT be migrated or rewritten.

#### Scenario: In-flight change keeps its legacy run-state

- **WHEN** a change already has `auto-run.json` in its change directory and the work directory does not contain one
- **THEN** run-state updates SHALL continue to target the change-directory file
- **AND** readers SHALL find and use that file

#### Scenario: New change is external from birth

- **WHEN** a change with no pre-existing ephemera starts recording run-state or reports and `workDir` is reported
- **THEN** those files SHALL be created in the work directory and the change directory SHALL stay free of them

#### Scenario: Missing workDir degrades to legacy behavior

- **WHEN** a workflow consumes a status/instructions payload that carries no `workDir`
- **THEN** it SHALL read and write ephemera in the change directory, matching pre-capability behavior byte-for-byte

### Requirement: Bulky raw research is directed to the work directory

Change-scoped research remains committed review material, but propose/explore guidance SHALL direct bulky raw research material (scratch probing logs, fetched corpora, long transcripts) to a `research/` area inside the work directory, with conclusions distilled into the committed design or research documents.

#### Scenario: Raw dumps stay out of the PR

- **WHEN** the generated propose/explore guidance is inspected
- **THEN** it SHALL state that bulky raw research goes to the work directory's `research/` area
- **AND** SHALL state that distilled conclusions belong in the committed change artifacts

### Requirement: The home layout includes an archived-change work area

The machine-home layout SHALL include a work area for archived changes at `changes/archive/<archived-dir-name>/work` inside the project home, keyed by the archived directory's date-prefixed name, provided by the home layout owner (the project-home resolver) rather than derived by consumers. This area holds ephemera migrated from archived change directories and is distinct from live changes' work directories, so an archived change and a live change sharing a base name never share state.

#### Scenario: Archived work area is distinct from the live work directory

- **WHEN** the home layout resolves the archived-work location for `2026-07-06-foo` and the work directory for a live change `foo`
- **THEN** the two SHALL be different directories under the same project home

### Requirement: Migration completes the sticky-legacy lifecycle

Migrating a legacy ephemeron moves it from the change directory to the resolved work location, after which the work-directory copy is the ONLY copy: workDir-first readers (run-state resolution, ship's evidence pre-flight, archive gates, retro) SHALL find migrated state exactly as they find born-external state, with no reader changes required, and sticky-legacy writers SHALL treat the change as born-external from then on (no legacy file remains to stick to). Migration SHALL never create the both-copies-exist state the sticky-legacy policy guards against.

#### Scenario: Resume reads migrated run-state

- **WHEN** a change's `auto-run.json` is migrated to its work directory and `rasen pipeline resume <change>` runs
- **THEN** resume SHALL read the migrated run-state (`hasRunState: true`) and report the work directory as its source

#### Scenario: Post-migration writes go external

- **WHEN** a workflow appends to a migrated change's run-state or reports after migration
- **THEN** the writes SHALL target the work directory (no change-directory copy exists to stick to)
