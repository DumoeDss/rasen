## ADDED Requirements

### Requirement: Solo proactive-fix disposition is scoped to interactive/standalone sessions

The shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`) SHALL scope its `solo` "investigate and offer to fix proactively / Default to action" disposition, and the "notice something during ANY workflow step … Never let a noticed issue silently pass" rule, to interactive / standalone sessions. Using the enumerate-and-gate idiom, the PREAMBLE SHALL name these absolutes and carve out dispatched leaf workers: a dispatched leaf worker (one-unit-of-work dispatch; see the dispatched-mode contract) that notices an out-of-scope issue SHALL record it in its `DONE` durable-findings for the LEAD to triage, and SHALL NOT investigate or fix it itself. The proactive "offer to fix" disposition SHALL apply where the worker can actually reach the user (interactive/standalone), not to orchestrated leaf workers.

#### Scenario: dispatched worker reports out-of-scope issues instead of fixing them

- **WHEN** the generated PREAMBLE (solo mode / "see something say something") is inspected
- **THEN** it SHALL scope the "Default to action" / proactive-fix disposition to interactive/standalone sessions
- **AND** SHALL state that a dispatched leaf worker records out-of-scope issues in its DONE durable-findings for the LEAD, rather than investigating or fixing them
- **AND** the scoping SHALL be consistent with the dispatched-mode one-unit-of-work contract
