## MODIFIED Requirements

### Requirement: No live references to removed plan-review skills

No live surface — workflow templates, expert templates, generated/installed skills, or docs — SHALL retain a reference to the removed `plan-ceo-review`, `plan-eng-review`, or `plan-design-review` skills. Historical archives under `openspec/changes/archive/` are exempt.

#### Scenario: Installed codex skill drops the dead plan-review report bullets

- **WHEN** the `codex` expert template `src/core/templates/experts/codex.ts` and the installed `codex` `SKILL.md` are inspected
- **THEN** neither SHALL reference `plan-ceo-review`, `plan-eng-review`, or `plan-design-review`

#### Scenario: Templates and docs are clean

- **WHEN** the expert templates under `src/core/templates/experts/` and `skills/experts/docs/ARCHITECTURE.md` are inspected
- **THEN** none SHALL reference the removed plan-review skills as live consumers or examples

#### Scenario: Freshness gate stays green

- **WHEN** methodology-reference edits are verified
- **THEN** validation SHALL generate and install affected skills through the normal product path and inspect their live skill references
- **AND** it SHALL record commands, results, and limits without permanent prompt-string, wiring, or template hash assertions
- **AND** surviving methodology experts, conditional workflow references, and change-context capture behavior SHALL remain unchanged
