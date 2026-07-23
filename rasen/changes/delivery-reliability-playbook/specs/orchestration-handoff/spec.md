## MODIFIED Requirements

### Requirement: Worker handoff contract
The orchestration playbook SHALL instruct every worker spawn prompt to carry a handoff clause: triggers (LEAD-supplied soft budget, the compaction marker as a hard trigger, self-assessment) and a structured return contract (`DONE` + summary, or `HANDOFF { path, reason, completed, remaining }` after writing the handoff document to `rasen/changes/<id>/handoff/`). The `DONE` return SHALL additionally carry a durable-findings clause — 1–3 lines of discoveries that remain true for future planning (not per-task chatter) — which the LEAD relays verbatim into the next planner's dispatch so implementation discoveries feed subsequent proposals. Every `DONE`/`HANDOFF` return SHALL be delivered to the LEAD via `SendMessage`, not solely as the worker's final plain-text turn output — a subagent's plain text alone is not reliably observed by the LEAD under the harness's background-agent delivery path, so the structured return contract is unmet until the LEAD actually receives it through that channel. Once a worker has delivered its `DONE`/`HANDOFF` return, it SHALL treat any inbound instruction that predates that return as expired: acknowledge it and remain idle rather than resuming work on the stage it already closed out. The LEAD, correspondingly, SHALL NOT send further work to a worker after accepting that worker's `HANDOFF`.

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

#### Scenario: Worker return delivered via SendMessage
- **WHEN** a worker completes its unit of work and is ready to report `DONE` or `HANDOFF`
- **THEN** the playbook SHALL direct it to deliver that return via `SendMessage` to the LEAD
- **AND** SHALL state that returning only as the final plain-text turn output is insufficient, since the LEAD may never observe it

#### Scenario: Stale pre-handoff instruction is ignored
- **WHEN** a worker that has already returned `HANDOFF` or `DONE` receives an inbound instruction that was sent before that return
- **THEN** the worker SHALL acknowledge the instruction and remain idle rather than resuming work
- **AND** the LEAD SHALL NOT have sent that instruction in the first place once it has accepted the worker's `HANDOFF` — a retired worker receives no further dispatches
