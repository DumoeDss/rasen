# workflow-handoff-command Specification

## Purpose
TBD - created by archiving change add-context-handoff. Update Purpose after archive.
## Requirements
### Requirement: Handoff workflow generation
The system SHALL provide a `handoff` workflow (skill `openspec-handoff`, slash command `/opsx:handoff`) available via ALL_WORKFLOWS (opt-in, like `review-cycle`), generated per the configured delivery mode.

#### Scenario: Opt-in generation
- **WHEN** a custom profile includes `handoff` and `openspec init`/`update` runs with delivery `both`
- **THEN** `.claude/skills/openspec-handoff/SKILL.md` and `.claude/commands/opsx/handoff.md` SHALL be generated
- **AND** deselecting `handoff` SHALL remove them on the next sync (drift detection covers both artifacts)

#### Scenario: Not in core profile
- **WHEN** the core profile is active
- **THEN** the `handoff` workflow SHALL NOT be generated

### Requirement: Handoff document instructions
The handoff skill SHALL instruct the agent to write a handoff document to `openspec/changes/<id>/handoff/<role>-<n>.md` covering: original intent, pipeline position, done/remaining (referencing tasks.md), key decisions with rationale, dead ends/gotchas, eliminated hypotheses with evidence (mandatory for fixer/debugger roles), working set, and the next concrete action — and, for session-level use, to record the `sessionHandoff` pointer in run-state.

#### Scenario: Session-level handoff
- **WHEN** a user invokes `/opsx:handoff` in a session driving a change
- **THEN** the skill SHALL produce `handoff/lead-<n>.md` with the template sections and update `auto-run.json`'s `sessionHandoff`
- **AND** SHALL tell the user how to resume in a fresh session (`openspec pipeline resume` / `/opsx:auto`)

