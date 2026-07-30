## ADDED Requirements

### Requirement: Reconciler executes goal-cycle bounded-loop nodes

The deterministic reconciler SHALL recognize `bounded-loop` plan nodes with a `goal-cycle` body, project goal progress from the frozen plan and committed Record, and emit the correct typed candidate action for the next work or judge phase. When the goal loop reaches `satisfied`, the bounded-loop node SHALL contribute to the succeeded set so downstream dependencies may proceed. When the goal loop reaches `exhausted`, the reconciler SHALL emit an escalate candidate with the loop's exhausted outcome. The reconciler SHALL guard `finishCandidate` so a goal-cycle bounded-loop with remaining work never allows the Run to premature-finish.

#### Scenario: First work phase admitted on start

- **WHEN** a Run with one goal-cycle bounded-loop node (no root atomic dependencies) is started
- **THEN** the reconciler SHALL emit exactly one `admit` candidate for the round-1 work phase nodeId
- **AND** the admit SHALL carry the work phase's admissionKind and workspace access
- **AND** the finish candidate SHALL NOT fire (the bounded-loop has remaining work)

#### Scenario: Satisfied exit contributes to succeeded set

- **WHEN** the goal loop reaches `satisfied` (judge returned passed/satisfied = true)
- **THEN** the reconciler SHALL add the bounded-loop nodeId to the succeeded set
- **AND** SHALL NOT emit a new admit candidate for the bounded-loop
- **AND** a downstream finish node or implicit finish SHALL become eligible

#### Scenario: Exhausted maps to escalate

- **WHEN** the goal loop reaches `exhausted` (round cap hit without satisfaction)
- **THEN** the reconciler SHALL emit an `escalate` candidate with the bounded-loop's `outcomes.exhausted` code
- **AND** the Run SHALL NOT finish as completed

#### Scenario: Judge phase admitted after work completes

- **WHEN** a round-1 work-phase action completes with a valid domain result
- **THEN** the reconciler SHALL emit an `admit` candidate for the round-1 judge phase nodeId
- **AND** the admit SHALL carry the judge phase's admissionKind and workspace access

#### Scenario: Next round admitted after unsatisfied judge

- **WHEN** a judge-phase action completes with satisfied/passed = false and rounds remain
- **THEN** the reconciler SHALL emit an `admit` candidate for the next round's work phase nodeId
- **AND** the round number SHALL increment by 1

### Requirement: Three domain result contracts with Zod validation

Each goal-cycle variant SHALL define typed result contracts validated by Zod schemas before commit. The `measure` variant SHALL accept `MeasureJudgeResult` (`goal-cycle/measure-judge/1`) with `score`, `threshold`, `direction`, and `passed` fields. The `evaluate` variant SHALL accept `EvaluateJudgeResult` (`goal-cycle/evaluate-judge/1`) with `satisfied`, `gaps`, and `criteria` fields. The `research` variant SHALL accept `ResearchJudgeResult` (`goal-cycle/research-judge/1`) with `satisfied`, `gaps`, and `qualityAssessment` fields. All three variants SHALL accept `GoalWorkResult` or `ResearchWorkResult` for the work phase. A result that does not match its variant's schema SHALL be rejected with `malformed_goal_cycle_result` without mutating the Record.

#### Scenario: Valid measure judge result accepted

- **WHEN** a measure-variant judge-phase completion carries `{ score: 0.92, threshold: 0.85, direction: "gte", passed: true }`
- **THEN** the result SHALL pass schema validation and the Record SHALL advance to satisfied

#### Scenario: Invalid judge result rejected

- **WHEN** an evaluate-variant judge-phase completion carries `{ satisfied: "yes" }` instead of a boolean
- **THEN** the completion SHALL be rejected with code `malformed_goal_cycle_result`
- **AND** the Record SHALL remain at its pre-completion state

#### Scenario: Wrong-variant result rejected

- **WHEN** a measure-variant judge phase receives an evaluate-judge contract
- **THEN** the completion SHALL be rejected with code `malformed_goal_cycle_result`

### Requirement: Same-actor work and judge separation

The system SHALL reject a judge-phase completion whose actor identity matches the work-phase actor that produced the preceding work result in the same round. The actor-separation invariant SHALL be enforced before commit, not after.

#### Scenario: Worker cannot self-judge

- **WHEN** the same actor (by `identityDigest`) submits both the work-phase result and the judge-phase result in the same round
- **THEN** the judge completion SHALL be rejected with code `goal_cycle_actor_separation`
- **AND** the Record SHALL remain at the post-work state

### Requirement: Round cap produces explicit exhausted outcome

When the goal loop reaches its max-iterations limit without the judge returning satisfied/passed, the system SHALL produce an explicit `exhausted` outcome mapped to a terminal escalated state. The Run SHALL NOT silently loop, stall, or finish as completed.

#### Scenario: Max rounds reached without satisfaction

- **WHEN** the judge phase completes in the final round with satisfied/passed = false
- **THEN** the goal loop SHALL reach `exhausted`
- **AND** the reconciler SHALL emit an escalate candidate
- **AND** the Record terminal SHALL be escalated with the exhausted outcome code

### Requirement: Goal projection section

The projector SHALL emit a `goal/1` view section when the plan contains a goal-cycle bounded-loop. The section SHALL include variant, round, phase, outcome, last score (measure), last gaps (evaluate/research), stall streak, budget (used/max), and wait reason. CLI, Management API, and Operations SHALL consume the same `ChangeRunView` section.

#### Scenario: Goal section shows current round and budget

- **WHEN** a goal-cycle Run is in round 2 of 5 at the judge phase with lastScore = 0.72
- **THEN** the goal section SHALL show `{ round: 2, phase: "judge", budget: { used: 2, max: 5 }, lastScore: 0.72 }`
- **AND** the same section SHALL be projected by CLI status, Management API, and Operations

#### Scenario: Terminal goal section shows outcome

- **WHEN** a goal-cycle Run reaches satisfied after 3 rounds
- **THEN** the goal section SHALL show `{ round: 3, outcome: "satisfied" }`
- **AND** the root-dag section SHALL show the bounded-loop in the succeeded set

### Requirement: Restart at quiescent boundaries is deterministic

After a process restart at any goal-cycle quiescent boundary (after work commit, after judge commit), the system SHALL reconstruct the exact same goal-cycle state and next-ready action from the frozen plan and committed Record. Completed actions SHALL NOT be re-admitted, and score, gaps, and stall state SHALL remain deterministic.

#### Scenario: Crash after work commit, resume admits judge

- **WHEN** a process restarts after a work-phase result was committed but before the judge was admitted
- **THEN** resume SHALL reconstruct the goal-cycle state at round N, phase judge
- **AND** SHALL emit an admit candidate for the judge phase
- **AND** SHALL NOT re-admit the completed work phase

#### Scenario: Crash after judge commit, resume admits next round work

- **WHEN** a process restarts after a judge-phase result was committed (not satisfied) but before the next round's work was admitted
- **THEN** resume SHALL reconstruct the goal-cycle state at round N+1, phase work
- **AND** SHALL emit an admit candidate for the new work phase

### Requirement: Three goal-loop built-ins migrate to reconciler Runs

The three goal-loop built-in pipelines (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`) SHALL normalize from their v1 `loop: { kind: goal }` declaration to v2 BoundedLoop + goal-cycle body definitions. The reconciler SHALL execute these as real Runs with hierarchical identity, typed results, and deterministic recovery. The v1 YAML SHALL remain unchanged for legacy engine compatibility.

#### Scenario: goal-loop-measure normalizes to goal-cycle bounded-loop

- **WHEN** `goal-loop-measure` is prepared for a reconciler-engine Run
- **THEN** the normalized definition SHALL contain a BoundedLoop with `goal-cycle` body, variant `measure`
- **AND** the body SHALL declare work and judge phases
- **AND** the plan SHALL lower to a bounded-loop RuntimePlan node

#### Scenario: goal-loop-research uses report-only tail

- **WHEN** `goal-loop-research` is prepared for a reconciler-engine Run
- **THEN** the normalized definition SHALL contain a BoundedLoop with `goal-cycle` body, variant `research`
- **AND** the downstream stages SHALL include only a report stage (not ship/archive)
- **AND** the implicit finish outcome SHALL be `goal-loop-research-completed`

### Requirement: Legacy goal-run.json is a compatibility projection

The legacy `goal-run.json` SHALL become a read-only compatibility projection derived from the canonical Record. It SHALL NOT back-drive a new Run. New Runs started under the reconciler engine SHALL reconstruct goal-loop state entirely from the frozen plan and committed Record, without reading `goal-run.json`.

#### Scenario: New Run does not read goal-run.json on resume

- **WHEN** a reconciler-engine goal-loop Run is resumed after a crash
- **THEN** the system SHALL reconstruct state from plan + Record only
- **AND** SHALL NOT read `goal-run.json` to determine the next action

#### Scenario: goal-run.json projected from Record for backward compatibility

- **WHEN** a management API consumer requests goal-loop run details
- **THEN** the response SHALL include per-round records derived from the canonical Record
- **AND** the projection SHALL match the legacy `{round, score?, measurePassed?, evaluateSatisfied?, gaps?}` shape

### Requirement: Measure gate failure does not deadlock

A measure judge result whose command exited non-zero, timed out, or emitted unparseable output SHALL be recorded as a not-passed round — the loop SHALL continue (subject to maxIterations) and SHALL NOT deadlock or crash. The error detail SHALL be captured in the judge result.

#### Scenario: Command failure recorded as not-passed

- **WHEN** the measure command exits non-zero during the judge phase
- **THEN** the judge result SHALL carry `passed: false` with error detail
- **AND** the loop SHALL proceed to the next round or the cap

### Requirement: rasen-goal is a thin launcher

The `rasen-goal` skill SHALL select the goal-loop variant, read `goal-plan.md` for gate configuration, start the canonical Run via `rasen pipeline start`, and report progress from the `goal/1` projector section. It SHALL NOT own round counters, phase sequencing, cap enforcement, stall detection, or `goal-run.json` writing — those mechanics are owned by the reconciler.

#### Scenario: Launcher starts canonical Run

- **WHEN** a user invokes `rasen-goal` with a measure task
- **THEN** the skill SHALL classify the variant and start the canonical `goal-loop-measure` pipeline Run
- **AND** SHALL report progress by reading the `ChangeRunView` goal section

#### Scenario: Launcher does not own loop state

- **WHEN** the generated `rasen-goal` skill body is inspected
- **THEN** it SHALL NOT contain round counters, phase sequencing, maxRounds enforcement, or goal-run.json writing
- **AND** it SHALL delegate all mechanical progression to `rasen pipeline start` / `rasen pipeline resume`
