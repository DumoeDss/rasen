## MODIFIED Requirements

### Requirement: Worker handoff contract
The orchestration playbook SHALL instruct every worker spawn prompt to carry a handoff clause: triggers (LEAD-supplied soft budget, the compaction marker as a hard trigger, self-assessment) and a structured return contract (`DONE` + summary, or `HANDOFF { path, reason, completed, remaining }` after writing the handoff document to `openspec/changes/<id>/handoff/`). The `DONE` return SHALL additionally carry a durable-findings clause — 1–3 lines of discoveries that remain true for future planning (not per-task chatter) — which the LEAD relays verbatim into the next planner's dispatch so implementation discoveries feed subsequent proposals.

#### Scenario: Worker self-handoff mid-stage
- **WHEN** a worker returns a `HANDOFF` result
- **THEN** the playbook SHALL direct the LEAD to append the record to the stage's `handoffs[]` in run-state, and (below caps) spawn a successor worker seeded with the handoff document plus remaining tasks, in the same session
- **AND** workers SHALL NOT write run-state themselves (single-writer invariant)

#### Scenario: Worker dies without a handoff document
- **WHEN** a worker terminates abnormally or returns `DONE` with unticked tasks
- **THEN** the playbook SHALL direct the LEAD to treat it as a handoff without a document and cold-reconstruct the successor's context from the change-directory blackboard

#### Scenario: Durable findings relayed to the next planner
- **WHEN** a worker returns `DONE` with a durable-findings clause
- **THEN** the LEAD SHALL relay those findings verbatim into the dispatch of the planner that proposes a dependent or subsequent child change
