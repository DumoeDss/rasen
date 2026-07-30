# change-work-dir Specification

## Purpose
Define the per-change external work directory: where process ephemera (run-state, handoff documents, expert/review reports, verification reports, ship logs) live once a project is registered in the machine home, how the CLI exposes the resolved location, and the sticky-legacy fallback that keeps changes already in flight working unchanged.
## Requirements
### Requirement: The home layout includes an archived-change work area

The machine-home layout SHALL include a work area for archived changes at `changes/archive/<archived-dir-name>/work` inside the project home, keyed by the archived directory's date-prefixed name, provided by the home layout owner (the project-home resolver) rather than derived by consumers. This area holds ephemera migrated from archived change directories and is distinct from live changes' work directories, so an archived change and a live change sharing a base name never share state.

#### Scenario: Archived work area is distinct from the live work directory

- **WHEN** the home layout resolves the archived-work location for `2026-07-06-foo` and the work directory for a live change `foo`
- **THEN** the two SHALL be different directories under the same project home

### Requirement: Migration completes the sticky-legacy lifecycle

Migrating a legacy ephemeron moves it from the change directory to the machine-home work location, after which the work-directory copy is the ONLY copy among the legacy locations: readers following the resolution chain (ephemera directory first, then the work directory, then the change directory — per the `file-placement` capability's sticky-legacy chain) SHALL find migrated state exactly as they find born-legacy state, with no reader changes required, and sticky-legacy writers SHALL keep updating a migrated file in place. Migration SHALL never create a state where one file exists in two locations.

#### Scenario: Resume reads migrated run-state

- **WHEN** a change's `auto-run.json` was migrated to its work directory and `rasen pipeline resume <change>` runs
- **THEN** resume SHALL read the migrated run-state (`hasRunState: true`) and report the work directory as its source

#### Scenario: Post-migration writes go external

- **WHEN** a workflow appends to a migrated change's run-state after migration
- **THEN** the writes SHALL target the file where it lives (the work directory), never a second copy elsewhere

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

