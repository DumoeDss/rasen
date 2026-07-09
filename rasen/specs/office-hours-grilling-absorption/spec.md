# office-hours-grilling-absorption Specification

## Purpose
Sharpens the `office-hours` interview phases with an explicit discipline adapted from grill `grilling` (MIT): ask one question at a time and wait for the response, offer a recommended answer with each question, and explore the codebase instead of asking when the answer is discoverable there. The phase0a-neutralized encouragement prose is left unchanged.

## Requirements
### Requirement: Office-hours interview discipline
The `office-hours` skill SHALL carry an explicit interview discipline in its interview phases: ask one question at a time and wait for the response before the next; for each question provide a recommended answer; and if a question can be answered by exploring the codebase, explore instead of asking. This is adapted from grill `grilling` (MIT) and SHALL carry an attribution note. The post-0a neutralized encouragement prose SHALL be left unchanged.

#### Scenario: Interview-discipline note present
- **WHEN** `skills/gstack/office-hours/SKILL.md` is regenerated and inspected
- **THEN** the interview phases SHALL state one-question-at-a-time with a wait
- **AND** SHALL state that each question carries a recommended answer
- **AND** SHALL state that codebase-answerable questions are explored, not asked

#### Scenario: Neutralized prose untouched
- **WHEN** the regenerated office-hours skill is inspected
- **THEN** it SHALL NOT reintroduce personal-brand founder prose
- **AND** the office-hours registration and skill count SHALL be unchanged

