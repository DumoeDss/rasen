## MODIFIED Requirements

### Requirement: Change Directory Blackboard and Run-State

Stages SHALL hand off through the change directory, and the LEAD SHALL maintain a run-state record; `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve the change directory as an absolute path from `openspec status --change <n> --json` (the `changeRoot` field) before writing any blackboard artifact or run-state, so that all `openspec/changes/<name>/` paths taught by the workflow are interpreted relative to the selected OpenSpec root (including a `--store`-selected store root) and never relative to the current working directory.

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to the change directory as an OpenSpec artifact and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded

- **WHEN** the LEAD executes stages
- **THEN** it SHALL record classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, and open findings
- **AND** this record SHALL support resume and observability

#### Scenario: Run-state written to the selected root

- **WHEN** the change lives in a store-selected or non-cwd OpenSpec root
- **THEN** the LEAD SHALL write `auto-run.json` into the absolute change directory reported by `openspec status --change <n> --json`
- **AND** `openspec pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)
