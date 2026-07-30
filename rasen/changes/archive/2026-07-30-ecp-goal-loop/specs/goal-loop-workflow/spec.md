## MODIFIED Requirements

### Requirement: Goal-Loop Stage Iteration

A stage with `loop.kind: goal` SHALL repeat a work→judge cycle driven by the deterministic reconciler. Each round dispatches ONE work-phase action followed by ONE judge-phase action. The loop SHALL stop when the judge returns satisfied/passed, and SHALL be bounded by `maxRounds` (default 5). The reconciler SHALL own round advancement, phase sequencing, cap enforcement, and exit policy — the prompt/skill SHALL NOT maintain a second mechanical state machine. The work-phase agent SHALL be warm-reused across rounds and SHALL NOT spawn child subagents.

#### Scenario: Loop runs until gate satisfied

- **WHEN** a goal-loop Run's judge phase returns satisfied/passed = true
- **THEN** the reconciler SHALL mark the bounded-loop as satisfied and contribute it to the succeeded set
- **AND** the downstream stages (tail) SHALL become eligible for admission

#### Scenario: Loop is bounded by maxRounds

- **WHEN** a goal-loop Run's judge phase returns not-satisfied in the final round (round = maxRounds)
- **THEN** the reconciler SHALL emit an escalate candidate with the exhausted outcome
- **AND** the Run SHALL NOT report the goal as satisfied or passed

#### Scenario: Reconciler owns phase sequencing

- **WHEN** a work-phase action completes with a valid domain result
- **THEN** the reconciler SHALL emit an admit candidate for the judge phase of the same round
- **AND** the skill/prompt SHALL NOT independently decide which phase runs next

#### Scenario: Implementer is warm-reused across rounds

- **WHEN** successive rounds of a goal-loop stage execute within a live session
- **THEN** the LEAD SHALL dispatch the same implementer worker for each round (warm continuation)
- **AND** SHALL NOT spawn a fresh implementer per round
- **AND** when the implementer's context fills it SHALL follow the standard worker self-handoff (write a handoff document, return `HANDOFF`), after which the LEAD warm-seeds a successor and the loop continues

### Requirement: Goal-Loop Progress and Stall Detection

A round "progresses" when (measure: the score moved favorably versus the prior round — `gte` increased or `lte` decreased) or (evaluate: the gap-set shrank or the gate became newly satisfied). Round 1 SHALL count as progress. Consecutive non-progressing rounds SHALL increment a stall streak tracked in the goal-cycle domain reducer state. The stall streak SHALL be reconstructable from the frozen plan and committed Record alone. Moving the streak into the reducer SHALL NOT remove the acting rule it exists to serve: `loopStallLimit` (default 2, gate-neutral) consecutive non-progressing rounds SHALL still trigger a LEAD strategy review — warm-seed a fresh implementer with a different approach, or escalate — rather than silently burning further rounds.

#### Scenario: Stall streak triggers strategy review

- **WHEN** `loopStallLimit` consecutive rounds fail to progress
- **THEN** the LEAD SHALL initiate a strategy review (re-prompt with a different approach, or escalate)
- **AND** SHALL NOT silently continue burning rounds up to `maxRounds`

#### Scenario: Stall streak tracked in domain reducer

- **WHEN** consecutive rounds fail to progress
- **THEN** the goal-cycle domain reducer SHALL increment the stall streak in the committed state
- **AND** the stall streak SHALL be visible in the `goal/1` projection section

#### Scenario: Round one always counts as progress

- **WHEN** the first round of a goal-loop completes
- **THEN** it SHALL be counted as progress regardless of the gate result
- **AND** the stall streak SHALL begin counting from round two

### Requirement: Goal-Loop Resume Correctness

Resume of an interrupted goal-loop Run SHALL be driven entirely by the frozen plan and committed canonical Record. The reconciler SHALL reconstruct the exact same goal-cycle state (round, phase, score, gaps, stall streak) and next-ready action from committed events. The legacy `goal-run.json` file SHALL NOT be consulted during resume of a reconciler-engine Run. Completed actions SHALL NOT be re-admitted.

#### Scenario: Resume after satisfaction goes to tail

- **WHEN** a goal-loop Run is resumed and the committed Record shows a satisfied judge result
- **THEN** the reconciler SHALL project the bounded-loop as satisfied in the succeeded set
- **AND** SHALL NOT re-admit any work or judge phase

#### Scenario: Resume after a not-passed round continues at next round

- **WHEN** a goal-loop Run is resumed and the committed Record shows a complete, not-passed judge result with rounds remaining
- **THEN** the reconciler SHALL emit an admit candidate for the next round's work phase
- **AND** SHALL NOT re-admit the already-completed round

#### Scenario: Resume reconstructs state from Record only

- **WHEN** a goal-loop Run is resumed after a process restart
- **THEN** the system SHALL reconstruct round, phase, score, and stall streak from plan + Record
- **AND** SHALL NOT read `goal-run.json` to determine the next action

#### Scenario: Resume with no round record starts round one

- **WHEN** a goal-loop is resumed but no round has been committed yet (the define-goal stage completed but the iterate stage died before its first gate)
- **THEN** round 1 SHALL be dispatched — the reconciler emitting the round-1 work admit candidate for a reconciler-engine Run, the LEAD dispatching round 1 on the legacy path

### Requirement: Authoritative Round Record in goal-run.json

The canonical Record SHALL be the authoritative loop spine. Each committed goal-cycle event (work result, judge result) SHALL be recorded as a committed action in the canonical Record. The legacy `goal-run.json` file SHALL be a compatibility projection derived from the Record, NOT an independent authoritative source. A new Run SHALL NOT be back-driven by `goal-run.json`. The management API read path SHALL project per-round records from the Record into the legacy `{round, score?, measurePassed?, evaluateSatisfied?, gaps?}` shape for backward compatibility.

#### Scenario: Canonical Record is authoritative

- **WHEN** a goal-loop round's work and judge phases complete
- **THEN** the results SHALL be committed as actions in the canonical Record
- **AND** the Record SHALL be the sole source from which loop state is reconstructed

#### Scenario: goal-run.json projected for backward compatibility

- **WHEN** a management API consumer requests goal-loop run details for a reconciler-engine Run
- **THEN** the response SHALL include per-round records derived from the canonical Record
- **AND** the projection SHALL match the legacy shape
- **AND** the projection SHALL NOT be writable or back-drive the Run

#### Scenario: Round record appended after each gate

- **WHEN** a goal-loop round's gate completes (satisfied, not-passed, or error)
- **THEN** a record carrying the round number, the gate result, and the git tree fingerprint SHALL be available in the run artifact's resolved location — appended directly on the legacy path, derived from the canonical Record on the reconciler path
- **AND** the record SHALL be readable by a successor worker after relay

#### Scenario: Legacy run continues in place

- **WHEN** a goal-loop resumes and its run artifact already exists in the change directory
- **THEN** subsequent round records SHALL continue to resolve to that file (sticky-legacy), keeping one spine rather than splitting across two locations
