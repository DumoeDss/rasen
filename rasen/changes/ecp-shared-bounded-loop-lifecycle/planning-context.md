# Direction Projection Context

- Workstream: `executable-composite-pipelines`
- Active Slice: `v2-authoring-loop-contract-closure` (ECP-6)
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/v2-authoring-loop-contract-closure/`
- Parent portfolio: `ecp-v2-authoring-loop-contract-closure`
- DAG node: `ecp6-001`; no prerequisites; strict serial execution.

Deliver one shared, programmatically enforced bounded-loop lifecycle for ReviewCycle and GoalLoop:
iteration/action/budget limits, stable progress identity, stall, same-blocker streak, strategy exhaustion,
human escalation, cancel/recovery, and typed terminal outcomes. Keep the two domain reducers separate.
Extend Definition, lowering, Record, CLI/API/Operations projection and tests only as needed for this
contract. Do not reimplement settle/reservation, association registry, Session executor, Canvas
authoring, Issue/Dispatch, or 0.2.0 release closure.

Read the parent `planning-context.md`, Slice spec/plan, target state, gap calibration, current source,
and merged ECP Changes before deciding the public contract. Existing artifacts are evidence, not
automatic proof. Append durable cross-child findings to the parent planning context after proposal.
