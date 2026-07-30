# workflow-handoff-command Specification

## Purpose
Defines the opt-in `handoff` workflow — skill `rasen-handoff` and slash command `/rasen-handoff`, generated per delivery mode and covered by drift detection like `review-cycle` — for session-level context handoff. Specifies the handoff document instructions the workflow produces (decisions, eliminated hypotheses, and the next action).
## Requirements
### Requirement: Handoff workflow generation
The system SHALL provide a `handoff` workflow (skill `rasen-handoff`, slash command `/rasen-handoff`) available via ALL_WORKFLOWS (opt-in, like `review-cycle`), generated per the configured delivery mode.

#### Scenario: Opt-in generation
- **WHEN** a custom profile includes `handoff` and `rasen init`/`update` runs with delivery `both`
- **THEN** `.claude/skills/rasen-handoff/SKILL.md` and `.claude/commands/rasen/handoff.md` SHALL be generated
- **AND** deselecting `handoff` SHALL remove them on the next sync (drift detection covers both artifacts)

#### Scenario: Not in core profile
- **WHEN** the core profile is active
- **THEN** the `handoff` workflow SHALL NOT be generated

### Requirement: Handoff document instructions
The handoff skill SHALL instruct the agent to write a handoff document to `<handoffDir>/<role>-<n>.md` — the change's handoff directory (`<changeRoot>/handoff/`, the `handoffDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback: when the change's handoff documents already live under the legacy machine-home work directory's `handoff/` or the change directory's `handoff/`, new documents continue there so one change's handoff series stays in one place — covering: original intent, pipeline position, done/remaining (referencing tasks.md), key decisions with rationale, dead ends/gotchas, eliminated hypotheses with evidence (mandatory for fixer/debugger roles), working set, and the next concrete action — and, for session-level use, to record the `sessionHandoff` pointer (including its generation number) in run-state. After the session-level document is written, the skill SHALL offer to launch a successor session per the session-relay protocol, falling back to manual resume instructions when the user declines or the relay cap is reached.

#### Scenario: Session-level handoff
- **WHEN** a user invokes `/rasen-handoff` in a session driving a change
- **THEN** the skill SHALL produce `<role>-<n>.md` in the resolved handoff directory (or the legacy location per the fallback) with the template sections and update the run-state's `sessionHandoff` including the generation number
- **AND** SHALL tell the user how to resume in a fresh session (`rasen pipeline resume` / `/rasen-auto`)

#### Scenario: Handoff numbering scans the resolved location
- **WHEN** the skill computes `<n>` for a new handoff document
- **THEN** it SHALL scan the same resolved `handoff/` directory it will write to, so numbering stays append-only in one place

#### Scenario: Relay offer after session handoff
- **WHEN** the session-level handoff document and `sessionHandoff` record are written and the generation is below the resolved relay cap
- **THEN** the skill SHALL offer to launch a successor session seeded with the handoff document per the session-relay protocol
- **AND** declining SHALL leave the manual-resume flow exactly as before

