# workflow-handoff-command Specification (delta)

## MODIFIED Requirements

### Requirement: Handoff document instructions

The handoff skill SHALL instruct the agent to write a handoff document to `handoff/<role>-<n>.md` inside the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback) covering: original intent, pipeline position, done/remaining (referencing tasks.md), key decisions with rationale, dead ends/gotchas, eliminated hypotheses with evidence (mandatory for fixer/debugger roles), working set, and the next concrete action — and, for session-level use, to record the `sessionHandoff` pointer (including its generation number) in run-state. After the session-level document is written, the skill SHALL offer to launch a successor session per the session-relay protocol, falling back to manual resume instructions when the user declines or the relay cap is reached.

#### Scenario: Session-level handoff

- **WHEN** a user invokes `/opsx:handoff` in a session driving a change
- **THEN** the skill SHALL produce `handoff/lead-<n>.md` in the work directory (or the legacy location per the fallback) with the template sections and update `auto-run.json`'s `sessionHandoff` including the generation number
- **AND** SHALL tell the user how to resume in a fresh session (`openspec pipeline resume` / `/opsx:auto`)

#### Scenario: Handoff numbering scans the resolved location

- **WHEN** the skill computes `<n>` for a new handoff document
- **THEN** it SHALL scan the same resolved `handoff/` directory it will write to, so numbering stays append-only in one place

#### Scenario: Relay offer after session handoff

- **WHEN** the session-level handoff document and `sessionHandoff` record are written and the generation is below the resolved relay cap
- **THEN** the skill SHALL offer to launch a successor session seeded with the handoff document per the session-relay protocol
- **AND** declining SHALL leave the manual-resume flow exactly as before
