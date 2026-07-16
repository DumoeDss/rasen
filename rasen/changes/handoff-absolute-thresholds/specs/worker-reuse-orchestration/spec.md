# worker-reuse-orchestration Delta Specification

## MODIFIED Requirements

### Requirement: Reuse threshold is an occupancy ceiling

The `ReuseThresholdSchema` documentation in `src/core/pipeline-registry/types.ts` SHALL describe the reuse threshold's two forms with their distinct comparison directions: the fraction form as a maximum context OCCUPANCY (in (0,1]) at which a worker may take on a whole new child change — stricter (lower) than the handoff threshold — consistent with Step G.1.3's `pct ≤ threshold → reuse`; and the absolute form (`{ remainingTokens: N }`) as a required-headroom FLOOR — reuse only when at least N tokens remain. It SHALL NOT describe the fraction form as "headroom the worker must have," which implies the opposite comparison for that form.

#### Scenario: schema comment matches the occupancy comparison

- **WHEN** `ReuseThresholdSchema`'s doc comment is inspected
- **THEN** it SHALL describe the fraction form as an occupancy ceiling (max occupancy to take a new change, `pct ≤ threshold → reuse`), not required headroom
- **AND** it SHALL describe the absolute form as a headroom floor (`remainingTokens >= N → reuse`)
