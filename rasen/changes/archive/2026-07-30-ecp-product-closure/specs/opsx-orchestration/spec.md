## MODIFIED Requirements

### Requirement: Gate, Loop, Parallel, and Condition Interpretation

The LEAD SHALL interpret stage metadata: pause at gates, run loop stages as bounded loops (dispatching on `loop.kind`), run parallel-group stages concurrently, and skip stages whose condition is unmet. Under the reconciler engine, both loop kinds SHALL be driven through the canonical Run: the LEAD launches or resumes the Run, dispatches a role-isolated worker for each granted action, submits each result to the Run, and reads round, phase, findings, and outcome from the Run's view — the Run owns round counting, cap enforcement, actor separation, and termination for `review-cycle` exactly as it already does for `goal`. Under the legacy engine, the LEAD SHALL run the playbook's legacy loop protocol as before. The LEAD SHALL NOT keep an independent mechanical copy (round counters, cap checks, actor-separation verdicts, clean determinations) of any rule the canonical Run enforces.

#### Scenario: Gate pauses for the human

- **WHEN** a stage declares a `gate`
- **THEN** the LEAD SHALL pause after that stage, summarize what was done and what is next, and wait for human confirmation to continue, stop, or switch to manual

#### Scenario: Loop kind is dispatched

- **WHEN** a stage declares a `loop`
- **THEN** the LEAD SHALL narrow on `loop.kind`
- **AND** under the reconciler engine both `review-cycle` and `goal` SHALL be driven through the canonical Run's granted actions and view sections
- **AND** under the legacy engine `review-cycle` SHALL run the legacy bounded review→fix protocol and `goal` the legacy goal-loop protocol

#### Scenario: Review-cycle progression is owned by the canonical Run

- **WHEN** a `review-cycle` loop stage executes under the reconciler engine
- **THEN** rounds, phase order, the max-rounds cap, author ≠ verifier, and the clean/escalated outcome SHALL be enforced by the canonical Run
- **AND** the LEAD SHALL read them from the Run view's review-cycle section rather than tracking them itself
- **AND** a cap reached with open Blocker/Major findings SHALL surface as the Run's escalation, which the LEAD reports honestly

#### Scenario: Parallel group runs concurrently

- **WHEN** multiple stages share a `parallelGroup` and their conditions are met
- **THEN** the LEAD SHALL dispatch their workers concurrently and collect all results before proceeding

#### Scenario: Condition gates a stage

- **WHEN** a stage declares a `condition` that is not met for the current change
- **THEN** the LEAD SHALL skip that stage and record the skip

### Requirement: Change Directory Blackboard and Run-State

Stages SHALL hand off through the change directory (review material: proposal, design, tasks, delta specs) and the change's work directory (process ephemera: reports, run-state, handoff documents — the `change-work-dir` capability), and the LEAD SHALL maintain a run-state record; `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve BOTH locations as absolute paths from `rasen status --change <n> --json` — the `changeRoot` field for review material and the `workDir` field for ephemera — before writing any blackboard artifact or run-state, so that all paths taught by the workflow are interpreted relative to the selected Rasen root (including a `--store`-selected store root) and never relative to the current working directory. When the payload carries no `workDir`, or when a given ephemeron already exists in the change directory, the LEAD SHALL use the change directory for that file (the sticky-legacy fallback of the `change-work-dir` capability). For a reconciler-engine run, run-state SHALL be bounded to operational bookkeeping the canonical Run does not model — worker handles and transcripts, gate-policy freeze, retention mode, strategy attempts, session-relay generation — plus clearly-labeled read-only projections of canonical facts; mechanical truth (stage status, rounds, phases, findings, outcomes) SHALL live in the canonical Run Record, and run-state SHALL never be read back to make a progression decision the Run owns. For a legacy run, run-state remains the authoritative record exactly as before.

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to the change directory (review material) or the work directory (process ephemera) and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded

- **WHEN** the LEAD executes stages under the legacy engine
- **THEN** it SHALL record classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, and open findings
- **AND** this record SHALL support resume and observability

#### Scenario: Reconciler-engine run-state carries bookkeeping, not mechanical truth

- **WHEN** the LEAD executes stages under the reconciler engine
- **THEN** run-state SHALL record the engine, worker handles, gate-policy freeze, retention mode, and strategy attempts
- **AND** stage/round/phase/finding/outcome facts SHALL be read from the canonical Run view
- **AND** any such facts mirrored into run-state SHALL be labeled as projection and SHALL NOT drive progression

#### Scenario: Run-state written to the work directory

- **WHEN** the LEAD starts recording run-state for a change with no pre-existing `auto-run.json` and the status payload reports a `workDir`
- **THEN** the LEAD SHALL write `auto-run.json` into that work directory
- **AND** `rasen pipeline resume <change>` resolved to the same root SHALL read the run-state (`hasRunState: true`)

#### Scenario: Run-state written to the selected root

- **WHEN** the change lives in a store-selected or non-cwd Rasen root
- **THEN** the LEAD SHALL write `auto-run.json` into the absolute location resolved from `rasen status --change <n> --json` (the work directory, or the change directory under the sticky-legacy fallback)
- **AND** `rasen pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)
