## ADDED Requirements

### Requirement: Reuse threshold vs handoff threshold selection rule

The orchestration playbook SHALL state one general rule for which threshold governs a context-occupancy decision, and the warm-continue guard (Step H.2) SHALL inline-exempt cross-change re-staffing from the handoff threshold. A **mid-task relay** decision (keep going on the current task) SHALL compare occupancy to the **handoff** threshold (default 0.5). A **cross-change re-staffing** decision (take on a whole new child change — planner reuse per Step B.1.5, cross-child implementer reuse per Step G.1.3) SHALL compare occupancy to the **reuse** threshold (default 0.25, stricter). Step H.2 SHALL forward-reference B.1.5 / G.1.3 for these cases so the reuse threshold, not the handoff threshold, is applied to planner and cross-child reuse.

#### Scenario: planner reuse uses the reuse threshold, not the handoff threshold

- **WHEN** the generated Step H.2 warm-continue guard is inspected
- **THEN** it SHALL state that planner reuse and cross-child implementer reuse compare against the reuse threshold (default 0.25) per Step B.1.5 / G.1.3
- **AND** SHALL NOT direct those cross-change decisions to the handoff threshold (default 0.5)

#### Scenario: general rule stated once

- **WHEN** the generated playbook Step H preamble is inspected
- **THEN** it SHALL distinguish a mid-task relay decision (handoff threshold) from a cross-change re-staffing decision (reuse threshold)

### Requirement: Reuse threshold is an occupancy ceiling

The `ReuseThresholdSchema` documentation in `src/core/pipeline-registry/types.ts` SHALL describe the reuse threshold as a maximum context OCCUPANCY (in (0,1]) at which a worker may take on a whole new child change — stricter (lower) than the handoff threshold — consistent with Step G.1.3's `pct ≤ threshold → reuse` and the "stricter than handoff's" note. It SHALL NOT describe the value as context "headroom the worker must have," which implies the opposite comparison.

#### Scenario: schema comment matches the occupancy comparison

- **WHEN** `ReuseThresholdSchema`'s doc comment is inspected
- **THEN** it SHALL describe an occupancy ceiling (max occupancy to take a new change), not required headroom
- **AND** SHALL be consistent with the playbook's `pct ≤ threshold → reuse` rule
