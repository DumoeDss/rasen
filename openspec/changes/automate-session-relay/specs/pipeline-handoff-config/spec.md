## MODIFIED Requirements

### Requirement: Run-state handoff records
The run-state reader SHALL accept optional `sessionHandoff` (top level, including an optional generation number `n`) and per-stage `handoffs[]` records, and `openspec pipeline resume` SHALL report them.

#### Scenario: Resume surfaces handoff pointers
- **WHEN** `auto-run.json` contains a `sessionHandoff` and a stage with `handoffs[]`
- **THEN** `openspec pipeline resume <change> --json` SHALL include the session handoff record and, per stage, the latest handoff document path
- **AND** run-states without these fields SHALL parse exactly as before

#### Scenario: Session handoff generation surfaces on resume
- **WHEN** `auto-run.json` contains a `sessionHandoff` with `n`
- **THEN** `openspec pipeline resume <change> --json` SHALL include `n` in the session handoff record
- **AND** a `sessionHandoff` without `n` SHALL parse as before and be treated as generation 1
