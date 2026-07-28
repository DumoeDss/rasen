## ADDED Requirements

### Requirement: Goal Skill Prompts Carry Fidelity and Completion-Audit Discipline

The generated goal-loop skill prompts SHALL harden the gate against both premature passing and scope-shrink. The `rasen-goal` command's evaluate-gate termination invariant SHALL carry the completion-audit discipline (treat completion as unproven, derive requirements from goal/rubric, demand authoritative evidence, uncertain evidence counts as not achieved, prove-not-fail-to-find, no intent/memory as proof). The `rasen-goal-iterate` implementer self-check and the `rasen-goal-plan` goal framing SHALL carry a fidelity clause forbidding redefining success around a smaller or easier task — the goal fixed at define-goal is the goal the gate judges. The implementer SHALL still never self-certify the rubric.

#### Scenario: goal-command evaluate invariant carries the completion audit

- **WHEN** the generated `rasen-goal` command's termination invariants are inspected
- **THEN** the evaluate-gate invariant SHALL instruct the fresh reviewer to prove completion against the actual current state with authoritative evidence
- **AND** SHALL state that uncertain or indirect evidence counts as not achieved

#### Scenario: goal-iterate and goal-plan forbid scope-shrink

- **WHEN** the generated `rasen-goal-iterate` and `rasen-goal-plan` skill bodies are inspected
- **THEN** each SHALL forbid redefining success around a smaller or easier task
- **AND** `rasen-goal-iterate` SHALL still forbid the implementer declaring the evaluate gate satisfied itself

#### Scenario: goal-plan may set a per-task blocked threshold

- **WHEN** the generated `rasen-goal-plan` skill body and its goal-plan.md field guidance are inspected
- **THEN** it SHALL allow the planner to set a per-task `blockedThreshold` alongside `maxRounds`
- **AND** SHALL note that omitting it applies the default (3)
