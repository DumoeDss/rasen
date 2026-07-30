## MODIFIED Requirements

### Requirement: Orchestrated Execution via the Pipeline Playbook

Auto SHALL execute the selected pipeline by interpreting its DAG through the `rasen-orchestration` playbook, dispatching each stage to a role-isolated worker, rather than performing the stages itself in a single context. Before executing any stage, auto SHALL resolve the effective engine per the engine-selection policy (`--engine` flag over `runs.engine` configuration over the `auto` default, gated by the pipeline's reported engine support) and SHALL display the effective engine and its source at run start alongside the gate and selection policy lines. For a reconciler-engine run, auto SHALL launch one canonical Run for the pipeline and drive every stage through it — the canonical Run owns all mechanical progression (stage sequencing, loop rounds and caps, actor separation, terminal outcomes), and auto's job is selection, launch, per-action worker dispatch, and result submission. For a legacy-engine run, auto SHALL execute the playbook's legacy path exactly as before. Auto SHALL NOT maintain its own copy of any mechanical rule the selected engine already enforces.

#### Scenario: Stages dispatched to workers

- **WHEN** auto executes a selected pipeline
- **THEN** the LEAD SHALL dispatch each stage (including `office-hours`, `propose`, and `apply`) to a worker of the stage's role, honoring gates, loops, parallel groups, and conditions per `rasen-orchestration`
- **AND** the LEAD SHALL itself not author stage outputs, but coordinate and record them

#### Scenario: Reconciler-engine run is driven through the canonical Run

- **WHEN** the effective engine for the run is `reconciler`
- **THEN** auto SHALL create the canonical Run at launch and obtain each stage's work by resuming that Run's ready frontier
- **AND** auto SHALL submit each worker's result to the canonical Run rather than advancing any stage itself
- **AND** progress questions (current round, phase, open findings, outcome) SHALL be answered from the canonical Run view, not from auto's own accounting

#### Scenario: Engine display at run start

- **WHEN** an auto run starts
- **THEN** the output SHALL include the effective engine and its deciding source (e.g. `Engine: reconciler (auto)`)

#### Scenario: Legacy engine keeps the existing playbook behavior

- **WHEN** the effective engine for the run is `legacy` (explicit configuration, or `auto` with the reconciler unsupported for the pipeline)
- **THEN** auto SHALL execute the playbook's legacy path with unchanged behavior
- **AND** the displayed engine line SHALL state why legacy was selected

### Requirement: DAG State Resume

On invocation for an existing change, auto SHALL determine where to resume from, honoring the engine recorded for that run. For a reconciler-engine run, the canonical Run is the resume truth: auto SHALL resume by reading the canonical Run's ready frontier and SHALL NOT reconstruct progress from artifact presence or run-state stage ticks. For a legacy run (or where no canonical Run exists), auto SHALL determine the next incomplete stage from the change's artifacts and the LEAD run-state via the registry's resume surface, as before. A change SHALL never be resumed under a different engine than the one that owns it.

#### Scenario: Resume from run-state

- **WHEN** `/rasen-auto` is invoked for an existing change with legacy run-state and no canonical Run
- **THEN** auto SHALL determine the next incomplete stage (e.g. via `rasen pipeline resume <change> --json`) using artifact presence plus the run-state record
- **AND** SHALL resume from that stage rather than restarting

#### Scenario: Resume a reconciler-engine run from the canonical frontier

- **WHEN** `/rasen-auto` is invoked for an existing change that has an active reconciler-engine Run
- **THEN** auto SHALL resume by reading that Run's ready frontier (e.g. via `rasen pipeline resume-run <change> <pipeline> --json`)
- **AND** artifact presence and run-state ticks SHALL NOT override the canonical frontier

#### Scenario: Engine ownership is respected on resume

- **WHEN** a change is owned by one engine and auto is invoked
- **THEN** auto SHALL continue under the owning engine
- **AND** SHALL surface — not bypass — any engine-ownership conflict the runtime reports
