# goal-loop-validation Specification

## Purpose
The validation + documentation layer for the goal-loop feature — the deterministic test-coverage contract for the machinery gaps `goal-loop-core` left, the user-facing docs chapter, the office-hours design-doc update to the converged v4, and the end-to-end validation runbook for the prose-driven loop behavior.

## Requirements

### Requirement: Goal-Loop Deterministic Validation Suite

The test suite SHALL cover the goal-loop machinery surfaces that `goal-loop-core` did not exercise, as additions to the existing test files (no new test files). Each case SHALL assert deterministic output against the real goal-loop pipelines, schemas, and run-state code. The suite SHALL NOT duplicate the cases `goal-loop-core` already covers (schema parse/narrow, builtins list/parse/validate, `loopConfig` measure `timeoutSec`, skill-generation registration).

#### Scenario: pipeline show renders goal-loop measure gate metadata

- **WHEN** `openspec pipeline show goal-loop-measure` renders the human-readable stage meta for the `iterate` stage
- **THEN** the meta line SHALL include a goal-loop label naming the gate kind, e.g. `loop=goal[measure](max <N>, stall <L>)`
- **AND** SHALL NOT use the review-cycle label format

#### Scenario: pipeline show renders goal-loop evaluate gate metadata

- **WHEN** `openspec pipeline show goal-loop-evaluate` renders the `iterate` stage meta
- **THEN** the meta line SHALL include `loop=goal[evaluate](max <N>, stall <L>)`

#### Scenario: pipeline show still renders review-cycle unchanged

- **WHEN** `openspec pipeline show <pipeline>` renders a stage with a `review-cycle` loop
- **THEN** the meta line SHALL remain `loop=review-cycle(max <N>)` (zero regression)

#### Scenario: loopProgress round-trips through write and read

- **WHEN** a run-state with a `loopProgress` block (kind `goal`, round, lastScore, measurePassed, stallStreak, historyRef) is written and re-read
- **THEN** the re-read `loopProgress` SHALL equal the written values
- **AND** a run-state without `loopProgress` SHALL parse exactly as before (additive)

#### Scenario: evaluate-gate loopConfig round-trips

- **WHEN** a run-state with a `loopConfig` whose gate kind is `evaluate` (goal, rubric, maxRounds, loopStallLimit, workProduct `prose`) is written and re-read
- **THEN** the re-read `loopConfig` SHALL preserve the evaluate gate's goal and rubric
- **AND** SHALL narrow correctly on `gate.kind === 'evaluate'`

#### Scenario: measure gate with direction lte is covered

- **WHEN** a measure gate declares `direction: lte` (smaller-is-better, e.g. latency/memory)
- **THEN** the parsed/round-tripped config SHALL preserve `direction: 'lte'`
- **AND** the suite SHALL include at least one `lte` case alongside the `gte` cases goal-loop-core already covers

#### Scenario: measure gate with target stop condition is covered

- **WHEN** a measure gate declares a `target` (passed-count) stop condition instead of (or alongside) a `threshold`
- **THEN** the parsed config SHALL preserve the `target` value
- **AND** the suite SHALL include at least one `target`-driven case

#### Scenario: per-pipeline tail structure is asserted

- **WHEN** the three goal-loop pipelines are loaded
- **THEN** `goal-loop-measure` and `goal-loop-evaluate` SHALL end in `ship` then `archive` stages (each `model: sonnet`)
- **AND** `goal-loop-research` SHALL end in a single `report` stage (no ship/archive)
- **AND** `goal-loop-research` SHALL set a lowered implementer handoff threshold (0.35) for earlier relay

### Requirement: Goal-Loop Workflow Guide Chapter

The user-facing workflow guide (`docs/opsx-workflow-guide.md`) SHALL include a goal-loop chapter that lets a user discover and drive `/opsx:goal` without reading internal design docs. The chapter SHALL match the existing guide's section style and cover: the single `/opsx:goal` entry; LEAD classification keywords and the explicit selector / `--pipeline` override; the three backend pipelines and when each applies; the define-goal → iterate → tail flow for each (measure/evaluate → ship → archive; research → report); the `goal-run.json` authoritative record; and the resume model. It SHALL include a worked example for each of measure, evaluate, and research.

#### Scenario: Chapter is discoverable and complete

- **WHEN** a user reads `docs/opsx-workflow-guide.md`
- **THEN** the guide SHALL contain a goal-loop section covering the `/opsx:goal` command, the three backend pipelines, classification, `goal-run.json`, and resume
- **AND** the section SHALL include a worked example each for measure, evaluate, and research tasks

#### Scenario: Existing guide content is untouched

- **WHEN** the goal-loop chapter is added
- **THEN** the existing autopilot (§2) and per-stage-commands (§3) content SHALL remain unchanged

### Requirement: Goal-Loop Office-Hours Design Converged to v4

The design doc `openspec/office-hours/goal-loop-primitive.md` SHALL reflect the converged v4 design that shipped: a single user-facing entry (`/opsx:goal`) with a LEAD-classified family of three homogeneous backend pipelines (one gate type each — measure / evaluate / research), implementer-inline research with H.3 relay (not a research-sibling), the gate-neutral `loopStallLimit` field name, and `goal-run.json` as the authoritative loop spine. The doc SHALL NOT retain the superseded v3 single-pipeline design (combined measure+evaluate AND-semantics, conditional tail, generic iterate skill).

#### Scenario: v3 single-pipeline design is superseded

- **WHEN** the office-hours doc is read
- **THEN** it SHALL describe three homogeneous backend pipelines (one gate type each), not one combined-gate pipeline
- **AND** it SHALL describe implementer-inline research with relay, not a research-sibling subagent
- **AND** it SHALL use the field name `loopStallLimit` (gate-neutral), not `measureStallLimit`

### Requirement: Goal-Loop End-to-End Validation Runbook

The change directory SHALL include an end-to-end validation runbook (`goal-loop-e2e-runbook.md`) documenting how a human or future test harness validates the prose-driven loop behavior that vitest cannot reach: a sample measure task (a throwaway script emitting `{score, passed}` JSON), driving `/opsx:goal measure ...`, observing rounds append to `goal-run.json`, observing `maxRounds`-exhaustion marking (never reported as success), and kill + `openspec pipeline resume` exercising the satisfied / not-passed / no-record resume branches. The runbook SHALL be dated and reference the concrete artifacts by name.

#### Scenario: Runbook covers the full loop lifecycle

- **WHEN** a validator follows the runbook
- **THEN** it SHALL guide them through a measure task that runs multiple rounds, records each to `goal-run.json`, exhausts `maxRounds` with an honest `maxRounds-exhausted` outcome, and resumes correctly after an interrupt
- **AND** it SHALL cover the three resume branches (satisfied → tail; not-passed → lastRound+1; no record → round 1)
