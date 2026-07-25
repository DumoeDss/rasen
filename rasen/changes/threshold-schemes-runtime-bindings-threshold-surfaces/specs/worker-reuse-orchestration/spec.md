## MODIFIED Requirements

### Requirement: Reuse threshold vs handoff threshold selection rule

The orchestration playbook SHALL state one general rule for which threshold governs a context-occupancy decision, and the warm-continue guard (Step H.2) SHALL inline-exempt cross-change re-staffing from the handoff threshold. A **mid-task relay** decision (keep going on the current task) SHALL compare occupancy to the resolved **handoff** threshold. A **cross-change re-staffing** decision (take on a whole new child change—planner reuse per Step B.1.5, cross-child implementer reuse per Step G.1.3) SHALL compare occupancy to the resolved **reuse** threshold. Step H.2 SHALL forward-reference B.1.5 / G.1.3 for these cases so the reuse threshold, not the handoff threshold, is applied to planner and cross-child reuse.

For each reuse role, the playbook SHALL state the complete order: a scheme selected by that role's effective runtime binding (`reuseRoles[role]` before scheme scalar) > pipeline YAML reuse role/scalar > model preset > built-in default 0.25. Runtime binding candidates SHALL use explicit runtime project/store/global rows before default project/store/global rows, skipping missing/invalid schemes with a warning. It SHALL also state that the pipeline-level reuse `.threshold` has no role runtime and therefore considers only the default binding row before pipeline scalar and default. Reuse modes remain pipeline declaration then default. The LEAD SHALL use `resolvePipelineReuseConfig(pipeline)` as reported by `rasen pipeline show`, not duplicate this chain in orchestration logic.

#### Scenario: planner reuse uses the reuse threshold, not the handoff threshold

- **WHEN** the generated Step H.2 warm-continue guard is inspected
- **THEN** it SHALL state that planner reuse and cross-child implementer reuse compare against the role's resolved reuse threshold per Step B.1.5 / Step G.1.3
- **AND** SHALL NOT direct those cross-change decisions to the handoff threshold

#### Scenario: general rule stated once

- **WHEN** the generated playbook Step H preamble is inspected
- **THEN** it SHALL distinguish a mid-task relay decision (handoff threshold) from a cross-change re-staffing decision (reuse threshold)

#### Scenario: role reuse chain includes runtime-bound schemes

- **WHEN** Step H's reuse guidance is inspected
- **THEN** it SHALL place the actual role runtime's bound scheme before pipeline role/scalar, preset, and default
- **AND** SHALL state scheme role override before scheme scalar

#### Scenario: planner and implementer can resolve different bindings

- **WHEN** planner effectively runs on Claude and implementer effectively runs on Codex
- **THEN** the playbook SHALL direct each role to consume its independently resolved reuse threshold rather than applying one pipeline-wide runtime

#### Scenario: top-level reuse uses only the default row

- **WHEN** Step H describes `resolvePipelineReuseConfig(pipeline).threshold`
- **THEN** it SHALL state that runtime-specific rows do not apply to that role-agnostic summary and only the default binding row precedes pipeline scalar and built-in default
