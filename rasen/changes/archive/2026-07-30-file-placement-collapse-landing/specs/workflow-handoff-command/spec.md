## MODIFIED Requirements

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
