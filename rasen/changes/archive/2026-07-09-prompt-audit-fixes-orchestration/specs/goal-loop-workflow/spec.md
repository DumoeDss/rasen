## ADDED Requirements

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
