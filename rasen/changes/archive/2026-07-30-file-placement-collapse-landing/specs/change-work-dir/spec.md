## MODIFIED Requirements

### Requirement: Migration completes the sticky-legacy lifecycle

Migrating a legacy ephemeron moves it from the change directory to the machine-home work location, after which the work-directory copy is the ONLY copy among the legacy locations: readers following the resolution chain (ephemera directory first, then the work directory, then the change directory — per the `file-placement` capability's sticky-legacy chain) SHALL find migrated state exactly as they find born-legacy state, with no reader changes required, and sticky-legacy writers SHALL keep updating a migrated file in place. Migration SHALL never create a state where one file exists in two locations.

#### Scenario: Resume reads migrated run-state

- **WHEN** a change's `auto-run.json` was migrated to its work directory and `rasen pipeline resume <change>` runs
- **THEN** resume SHALL read the migrated run-state (`hasRunState: true`) and report the work directory as its source

#### Scenario: Post-migration writes go external

- **WHEN** a workflow appends to a migrated change's run-state after migration
- **THEN** the writes SHALL target the file where it lives (the work directory), never a second copy elsewhere

## ADDED Requirements

### Requirement: The CLI reports the legacy work directory probe-only; agents never derive it

The resolved absolute legacy work directory SHALL be exposed only via the CLI: `rasen status --change <n> --json` SHALL include a top-level `workDir` field when the project already has a machine identity, and the artifact-instructions and apply-instructions payloads SHALL include the same field. ALL surfaces — including the instructions surfaces — SHALL resolve it probe-only: no surface SHALL mint machine identity, register the project, or create the machine-home work directory on behalf of this field. Workflow templates SHALL consume the CLI-reported `workDir` (and the per-class landing directories of the `cli-artifact-workflow` capability) and SHALL NOT construct machine-home paths themselves.

#### Scenario: Status exposes the legacy work directory

- **WHEN** `rasen status --change <n> --json` runs for a change in a registered project
- **THEN** the payload SHALL include an absolute `workDir` path for that change

#### Scenario: No surface mints identity for the work directory

- **WHEN** `rasen instructions <artifact> --change <n> --json` runs in a project that has no machine identity yet
- **THEN** the project SHALL NOT be registered and no machine home SHALL be created
- **AND** the payload SHALL omit `workDir` while still carrying the per-class landing directories, which need no identity

#### Scenario: Read-only surfaces never mutate

- **WHEN** `rasen status --change <n> --json` runs in a project that has no machine identity
- **THEN** the payload SHALL omit `workDir`
- **AND** the command SHALL NOT mint identity, write to the registry, or create a machine-home directory for this field

#### Scenario: Root-scoped context shows the machine home

- **WHEN** `rasen context --json` runs for a registered project
- **THEN** the root object SHALL include the project's machine-home location (`machineHome`), and SHALL omit it for unregistered projects without side effects

### Requirement: The work directory is a legacy-read location

The machine-home work directory (`<machineHome>/changes/<change>/work`) SHALL be a legacy-read location only: files that already live there SHALL keep working (readers find them via the sticky-legacy chain; writers update them in place), but no workflow SHALL create a NEW file there. New files land per the `file-placement` capability: run-state and other ephemera in the execution root's ephemera directory, reports in `<changeRoot>/evidence/`, handoff documents in `<changeRoot>/handoff/`.

#### Scenario: In-flight change keeps its work-directory state

- **WHEN** a change already has `auto-run.json` or reports in its machine-home work directory
- **THEN** readers SHALL continue to find and use those files
- **AND** writers SHALL update them in place rather than creating a second copy at the terminal location

#### Scenario: New files never land in the work directory

- **WHEN** a change with no pre-existing work-directory state records run-state, writes reports, or produces handoff documents
- **THEN** those files SHALL be created at their terminal locations per the `file-placement` capability
- **AND** the machine-home work directory SHALL NOT gain new files

## REMOVED Requirements

### Requirement: The CLI reports the resolved work directory; agents never derive it

**Reason**: Its core assertion — that the instructions surfaces establish project identity (mint once, then reuse) — is retired: no surface mints machine identity for this field any more, because nothing new lands in the work directory. The probe-only reporting contract is restated under its own name in the added requirement above.

**Migration**: None for readers — `workDir` is still reported when a machine identity already exists. A project without one now simply never gains one from a workflow surface.

### Requirement: Each change has an external work directory for process ephemera

**Reason**: The machine-home work directory stops being a landing point. Per the `file-placement` capability, ephemera lands in the execution root, and reports/handoff land with the change in the planning root — locations that enter code history, survive checkout, and are per-worktree by construction (fixing the reproduced cross-worktree run-state collision).

**Migration**: Existing work-directory files stay readable in place via the sticky-legacy chain; child B's one-shot migrator moves them to their terminal locations.

### Requirement: Sticky-legacy fallback keeps old changes working

**Reason**: Superseded by the three-location sticky-legacy chain (ephemera directory → machine-home work directory → change directory) defined with the legacy-read requirement above and consumed by every reader; the old two-location formulation described the work directory as the preferred write target, which is no longer true.

**Migration**: Readers adopt the three-location chain; a file keeps living where it already exists (one file's state is never split across locations).

### Requirement: Bulky raw research is directed to the work directory

**Reason**: Raw research material is ephemera; its landing moves to the execution root's ephemera `research/` area per the `file-placement` capability.

**Migration**: Guidance re-targets `<executionRoot>/.rasen/changes/<change>/ephemera/research/`; existing work-directory research remains readable until child B migrates it.
