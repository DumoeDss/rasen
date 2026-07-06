# investigate-diagnosing-absorption Specification

## Purpose
Folds grill `diagnosing-bugs` (MIT) into the existing `investigate` skill: before any hypothesis work, the agent must build a tight, red-capable feedback loop that drives the actual bug code path and asserts the exact symptom — no such command means no hypothesis phase. investigate keeps its Iron Law and four-phase gates; the HITL loop template rides along as a sidecar, and the skill's registration and counts stay unchanged.

## Requirements
### Requirement: Investigate requires a red-capable feedback loop before hypotheses
The `investigate` skill SHALL, before any hypothesis work, require building a tight feedback loop that can go red on the specific bug. The skill body SHALL state a hard gate: the agent can name one command it has already run at least once that drives the actual bug code path and asserts the user's exact symptom, is deterministic, fast, and agent-runnable — and that without such a command it SHALL NOT proceed to hypothesis testing. The skill SHALL keep the existing Iron Law (no fix without root cause) and its four-phase gates. This content is adapted from grill `diagnosing-bugs` (MIT) and SHALL carry an attribution note.

#### Scenario: Feedback-loop gate present in generated skill
- **WHEN** `skills/gstack/investigate/SKILL.md` is regenerated and inspected
- **THEN** it SHALL contain a "build a feedback loop" phase preceding hypothesis testing
- **AND** it SHALL state that no red-capable command means no hypothesis phase
- **AND** it SHALL retain the Iron Law (no fix without root cause)

#### Scenario: Minimise step present
- **WHEN** the regenerated investigate skill is inspected
- **THEN** it SHALL instruct shrinking the reproduction to the smallest scenario that still goes red

#### Scenario: Stricter overlaps kept on merge
- **WHEN** the merged hypothesis and regression-test guidance is inspected
- **THEN** hypotheses SHALL be required to be ranked and falsifiable (with a stated prediction)
- **AND** the regression guidance SHALL state that the absence of a correct test seam is itself a finding

### Requirement: HITL loop template carried as investigate sidecar
The system SHALL add `skills/gstack/investigate/scripts/hitl-loop.template.sh` (adapted from grill `diagnosing-bugs`, MIT) and reference it by relative path from the investigate skill for the human-in-the-loop last-resort case.

#### Scenario: HITL sidecar exists and is referenced
- **WHEN** the investigate skill directory is inspected
- **THEN** `scripts/hitl-loop.template.sh` SHALL exist with an MIT attribution NOTICE at its head
- **AND** the regenerated `SKILL.md` SHALL reference `scripts/hitl-loop.template.sh`

### Requirement: Investigate registration and count unchanged
The absorption SHALL NOT rename `investigate`, alter its expert registration, or change any skill count.

#### Scenario: No registration or count drift
- **WHEN** `getSkillTemplates()` and the count assertions in `test/core/shared/skill-generation.test.ts` are evaluated
- **THEN** the `openspec-gstack-investigate` entry SHALL be unchanged
- **AND** all expert/total counts SHALL be unchanged

