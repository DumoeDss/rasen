# goal-loop-workflow Specification

## Purpose
Define the goal-loop stage iteration model — a bounded modify→judge cycle driven by a measure or evaluate gate, with warm-reused implementer dispatch, stall detection, resume correctness, an authoritative round record, and the three registered backend goal-loop pipelines.

## Requirements
### Requirement: Goal-Loop Stage Iteration

A stage with `loop.kind: goal` SHALL repeat a modify→judge cycle: each round dispatches ONE implementer worker that edits code or prose toward the goal, followed by a gate that judges whether the stop condition is met. The loop SHALL stop when the gate is satisfied, and SHALL be bounded by `maxRounds` (default 5). The implementer SHALL be warm-reused across rounds (the same worker carries forward, like the review-cycle fixer) and SHALL NOT spawn child subagents.

#### Scenario: Loop runs until gate satisfied

- **WHEN** a goal-loop stage runs and a round's gate judges the condition met
- **THEN** the LEAD SHALL stop the loop and proceed to the next stage (the tail)
- **AND** SHALL record the satisfied gate result as the final round

#### Scenario: Loop is bounded by maxRounds

- **WHEN** a goal-loop stage reaches its `maxRounds` cap without the gate ever being satisfied
- **THEN** the LEAD SHALL proceed to the tail
- **AND** SHALL mark the outcome as `maxRounds-exhausted` in the run record and ship-log/report
- **AND** SHALL NOT report the goal as satisfied or passed

#### Scenario: Implementer is warm-reused across rounds

- **WHEN** successive rounds of a goal-loop stage execute within a live session
- **THEN** the LEAD SHALL dispatch the same implementer worker for each round (warm continuation)
- **AND** SHALL NOT spawn a fresh implementer per round
- **AND** when the implementer's context fills it SHALL follow the standard worker self-handoff (write a handoff document, return `HANDOFF`), after which the LEAD warm-seeds a successor and the loop continues

### Requirement: Goal Gate Kinds Are Mutually Exclusive

Each goal-loop pipeline SHALL declare exactly one gate kind — `measure` (a deterministic command whose stdout is parsed as JSON `{score, passed?, detail?}`) or `evaluate` (a natural-language success criterion judged by a fresh reviewer worker). The schema SHALL reject any goal loop that declares both or neither. The `measure` gate SHALL define a stop condition via `threshold` (a score threshold) and/or `target` (a passed-count target), with a `direction` (`gte` default, or `lte` for smaller-is-better metrics like latency/memory). The `evaluate` gate SHALL carry a `goal` string and an optional `rubric`.

#### Scenario: Measure gate parses and validates

- **WHEN** a goal-loop stage declares `gate: { kind: measure, threshold: <n>, direction: gte|lte }` or `gate: { kind: measure, target: <n> }`
- **THEN** the schema SHALL accept it
- **AND** at runtime the LEAD SHALL run the injected `command` and parse its stdout as `{score, passed?, detail?}`

#### Scenario: Measure gate without a stop condition is rejected

- **WHEN** a goal-loop stage declares `gate: { kind: measure }` with neither `threshold` nor `target`
- **THEN** schema validation SHALL fail with an error indicating the measure gate needs a threshold or target

#### Scenario: Evaluate gate dispatches a fresh reviewer

- **WHEN** a goal-loop stage declares `gate: { kind: evaluate, goal: <text>, rubric: <text>? }`
- **THEN** at runtime the LEAD SHALL dispatch a FRESH reviewer worker (distinct from the implementer) handed the goal, rubric, and current artifact
- **AND** the reviewer SHALL return structured `{satisfied: boolean, gaps: string[]}` — not free text

#### Scenario: Combination of gate kinds is rejected

- **WHEN** a goal-loop stage attempts to declare both a measure and an evaluate gate
- **THEN** the discriminated-union schema SHALL reject it, because the gate field accepts exactly one `kind`

### Requirement: Measure Gate Failure Does Not Deadlock

A measure gate whose command exits non-zero, times out (beyond `timeoutSec`, default 120), or emits unparseable stdout SHALL be recorded as a not-passed round with the error captured — the loop SHALL continue (subject to `maxRounds`) and SHALL NOT deadlock or crash.

#### Scenario: Non-zero exit recorded as error

- **WHEN** the measure command exits non-zero
- **THEN** the round SHALL be recorded with an `error` field capturing stderr
- **AND** the round SHALL be treated as not-passed
- **AND** the loop SHALL proceed to the next round or the cap

#### Scenario: Unparseable stdout recorded as error

- **WHEN** the measure command's stdout is not valid JSON or lacks the expected fields
- **THEN** the round SHALL be recorded with an `error` field describing the parse failure
- **AND** the round SHALL be treated as not-passed and the loop SHALL continue

### Requirement: Goal-Loop Progress and Stall Detection

A round "progresses" when (measure: the score moved favorably versus the prior round — `gte` increased or `lte` decreased) or (evaluate: the gap-set shrank or the gate became newly satisfied). Round 1 SHALL count as progress. `loopStallLimit` (default 2, gate-neutral) consecutive non-progressing rounds SHALL trigger a LEAD strategy review — the LEAD either warm-seeds a fresh implementer with a different approach or escalates — rather than silently burning further rounds.

#### Scenario: Stall streak triggers strategy review

- **WHEN** `loopStallLimit` consecutive rounds fail to progress
- **THEN** the LEAD SHALL initiate a strategy review (re-prompt with a different approach, or escalate)
- **AND** SHALL NOT silently continue burning rounds up to `maxRounds`

#### Scenario: Round one always counts as progress

- **WHEN** the first round of a goal-loop completes
- **THEN** it SHALL be counted as progress regardless of the gate result
- **AND** the stall streak SHALL begin counting from round two

### Requirement: Goal-Loop Resume Correctness

Resume of an interrupted goal-loop SHALL be driven by the authoritative last record in `goal-run.json`: if the last recorded round was satisfied the LEAD SHALL proceed to the tail without re-running; if the last recorded round was not-passed (round complete with a recorded judgment) the LEAD SHALL resume at `lastRound + 1` (a fresh dispatch seeded with the prior gap); if no round record exists the LEAD SHALL dispatch round 1. Before resuming a round the LEAD MAY re-run the gate once on the current tree to catch a flaky command or externally-fixed state.

#### Scenario: Resume after satisfaction goes to tail

- **WHEN** a goal-loop stage is resumed and the last record in `goal-run.json` shows a satisfied gate
- **THEN** the LEAD SHALL proceed to the tail stage
- **AND** SHALL NOT re-run any round

#### Scenario: Resume after a not-passed round continues at next round

- **WHEN** a goal-loop stage is resumed and the last record shows a complete, not-passed round
- **THEN** the LEAD SHALL dispatch round `lastRound + 1` seeded with the prior round's gap
- **AND** SHALL NOT re-run the already-recorded round

#### Scenario: Resume with no round record starts round one

- **WHEN** a goal-loop stage is resumed but `goal-run.json` has no round records (the define-goal stage completed but the iterate stage died before its first gate)
- **THEN** the LEAD SHALL dispatch round 1

### Requirement: Authoritative Round Record in goal-run.json

Each completed round SHALL append a record to the loop's run artifact (`loop.runArtifact`, default `goal-run.json`) in the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback) containing `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}`. This file SHALL be the authoritative loop spine that survives worker relay and session restart; `loopProgress` in run-state SHALL be a best-effort derived cache pointing to it via `historyRef`.

#### Scenario: Round record appended after each gate

- **WHEN** a goal-loop round's gate completes (satisfied, not-passed, or error)
- **THEN** a record SHALL be appended to the run artifact in the resolved location with the round number, the gate result, and the git tree fingerprint
- **AND** the record SHALL be readable by a successor worker after relay

#### Scenario: Legacy run continues in place

- **WHEN** a goal-loop resumes and its run artifact already exists in the change directory
- **THEN** subsequent round records SHALL continue to append to that file (sticky-legacy), keeping one authoritative spine

### Requirement: Three Backend Goal-Loop Pipelines Are Registered

The package SHALL ship three goal-loop pipelines, each homogeneous (one gate kind, one iterate-skill flavor, one tail), auto-discovered from `pipelines/<name>/pipeline.yaml`: `goal-loop-measure` (measure gate, code-edit iterate, ship → archive tail), `goal-loop-evaluate` (evaluate gate, code-edit iterate, ship → archive tail), and `goal-loop-research` (evaluate gate, prose/research iterate, a `report` tail instead of ship/archive, with a lower implementer handoff threshold for earlier relay).

#### Scenario: Goal-loop pipelines are listed and valid

- **WHEN** `rasen pipeline list --json` runs
- **THEN** it SHALL include `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research`
- **AND** each SHALL parse and pass all pipeline validators with a valid DAG

#### Scenario: Measure and evaluate pipelines share the ship tail

- **WHEN** `goal-loop-measure` and `goal-loop-evaluate` are loaded
- **THEN** their final stages SHALL be ship → archive (reusing the existing ship and archive skills)

#### Scenario: Research pipeline uses a report tail

- **WHEN** `goal-loop-research` is loaded
- **THEN** its final stage SHALL be a `report` stage invoking the goal-report skill (not ship/archive)
- **AND** it SHALL set a lower implementer handoff threshold so relay happens earlier under context pressure

### Requirement: Goal-Loop Run-State Fields Are Additive

`RunStateSchema` SHALL accept two optional additive fields for goal-loop runs: `loopConfig` (the injected effective gate config — gate kind, command/threshold or goal/rubric, maxRounds, loopStallLimit, workProduct) and `loopProgress` (a best-effort cache: current round, last score, stall streak, and a `historyRef` pointing to `goal-run.json`). These fields SHALL be optional so existing run-state files and readers remain unaffected.

#### Scenario: Existing run-state files still parse

- **WHEN** a run-state file written before goal-loop (no `loopConfig`/`loopProgress`) is read
- **THEN** `parseRunState` SHALL accept it unchanged
- **AND** the typed reader SHALL expose the existing fields as before

### Requirement: Evaluate Gate Has a Tier-C Author-Verifier Fallback

Step L (and goal-command's termination invariants) SHALL define the Tier-C degradation for an `evaluate` gate, since Step C's code-gate substitute (tests/lint/build) is meaningless for a subjective rubric. Under Tier C the author≠verifier invariant SHALL degrade to a second, freshly-reset single-context pass seeded ONLY with `goal` + `rubric` + the artifact under judgment (NOT the implementation transcript), recorded as the Tier-C fallback. If that is impossible, goal-loop-evaluate SHALL be declared unsupported under Tier C rather than allowing the implementer to self-certify.

#### Scenario: evaluate gate degrades on Tier C without self-certification

- **WHEN** the generated Step L evaluate branch (and goal-command invariants) is inspected
- **THEN** it SHALL state a Tier-C fallback: a freshly-reset single-context evaluation seeded only with goal + rubric + artifact
- **AND** SHALL forbid the implementer self-certifying the rubric under Tier C

### Requirement: Goal-Plan maxRounds Is Injected Into the Loop

Step L's Inject step SHALL copy `maxRounds` (and `loopStallLimit` if the planner set it) from `goal-plan.md` into `iterate.loopConfig`, alongside the gate config, so the planner's per-task round cap is honored rather than orphaned by the pipeline/schema default.

#### Scenario: planner round cap is honored

- **WHEN** the generated Step L Inject step is inspected
- **THEN** it SHALL copy `maxRounds` (and `loopStallLimit` when present) from goal-plan.md into the loop config
- **AND** SHALL NOT leave the planner-authored round cap unread

### Requirement: Loop runArtifact Is Honored

Step L SHALL read the loop's `runArtifact` field (falling back to `goal-run.json`) wherever it references the loop spine file, rather than hardcoding `goal-run.json`, so a pipeline that configures a different run artifact does not diverge from the file the LEAD reads and writes.

#### Scenario: configured runArtifact is used

- **WHEN** the generated Step L is inspected
- **THEN** it SHALL reference `loop.runArtifact` (fallback `goal-run.json`) for the authoritative loop spine
- **AND** SHALL NOT hardcode `goal-run.json` as the only spine filename

### Requirement: Define-Goal Gate Confirms Goal and Gate Generally

goal-command's define-goal gate guardrail SHALL be phrased to confirm the goal plus the gate — the measure command OR the evaluate goal/rubric — before any round runs, rather than naming only "the measure command," so the gate is not read as vacuous on evaluate/research runs that carry no command.

#### Scenario: define-goal gate applies to evaluate/research runs

- **WHEN** the generated goal-command define-goal guardrail is inspected
- **THEN** it SHALL confirm the goal + gate (measure command or evaluate goal/rubric) before any round
- **AND** SHALL NOT restrict the confirmation to a measure command only
