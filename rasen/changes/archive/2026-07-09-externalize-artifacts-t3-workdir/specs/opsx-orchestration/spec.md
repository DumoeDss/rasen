# opsx-orchestration Specification (delta)

## MODIFIED Requirements

### Requirement: Change Directory Blackboard and Run-State

Stages SHALL hand off through the change directory (review material: proposal, design, tasks, delta specs) and the change's work directory (process ephemera: reports, run-state, handoff documents — the `change-work-dir` capability), and the LEAD SHALL maintain a run-state record; `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve BOTH locations as absolute paths from `openspec status --change <n> --json` — the `changeRoot` field for review material and the `workDir` field for ephemera — before writing any blackboard artifact or run-state, so that all paths taught by the workflow are interpreted relative to the selected OpenSpec root (including a `--store`-selected store root) and never relative to the current working directory. When the payload carries no `workDir`, or when a given ephemeron already exists in the change directory, the LEAD SHALL use the change directory for that file (the sticky-legacy fallback of the `change-work-dir` capability).

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to the change directory (review material) or the work directory (process ephemera) and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded

- **WHEN** the LEAD executes stages
- **THEN** it SHALL record classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, and open findings
- **AND** this record SHALL support resume and observability

#### Scenario: Run-state written to the work directory

- **WHEN** the LEAD starts recording run-state for a change with no pre-existing `auto-run.json` and the status payload reports a `workDir`
- **THEN** the LEAD SHALL write `auto-run.json` into that work directory
- **AND** `openspec pipeline resume <change>` resolved to the same root SHALL read the run-state (`hasRunState: true`)

#### Scenario: Run-state written to the selected root

- **WHEN** the change lives in a store-selected or non-cwd OpenSpec root
- **THEN** the LEAD SHALL write `auto-run.json` into the absolute location resolved from `openspec status --change <n> --json` (the work directory, or the change directory under the sticky-legacy fallback)
- **AND** `openspec pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)
