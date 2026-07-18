# cli-agent-context Delta Specification

## ADDED Requirements

### Requirement: Handoff threshold reporting
`rasen agent context` SHALL resolve the configured context-handoff threshold — project config `handoff.threshold` (when the working directory is inside a Rasen project), else global config `handoff.threshold`, else the built-in default 0.5 — and report it alongside the occupancy measurement: the resolved `threshold`, its source, and a `shouldHandoff` flag. The threshold SHALL accept the dual form (a bare fraction in (0, 1], or the absolute `{ remainingTokens: N }` headroom form); `shouldHandoff` compares the probe's measured occupancy against a fraction threshold (`pct >= threshold`) or its `remainingTokens` against an absolute threshold (`remainingTokens <= threshold.remainingTokens`). The probe is role-agnostic (it has no stage identity, so pipeline/stage/role and model-preset overrides do not apply) and SHALL remain a probe: the exit code stays 0 even when `shouldHandoff` is true.

#### Scenario: JSON output includes threshold fields
- **WHEN** `rasen agent context --json` measures 62% occupancy and the project config sets `handoff.threshold: 0.6`
- **THEN** the JSON output includes the threshold 0.6, a source identifying the project config layer, and `shouldHandoff: true`
- **AND** the exit code is 0

#### Scenario: JSON output reports the absolute threshold form
- **WHEN** `rasen agent context --json` measures a probe with 50000 `remainingTokens` and the global config sets `handoff.threshold: { remainingTokens: 60000 }`
- **THEN** the JSON output includes the threshold `{ remainingTokens: 60000 }`, a source identifying the global config layer, and `shouldHandoff: true` (measured `remainingTokens` is at or below the configured floor)
- **AND** the exit code is 0

#### Scenario: Human output shows the threshold verdict
- **WHEN** `rasen agent context` runs without `--json` and occupancy is below the resolved threshold
- **THEN** the one-line output includes the resolved threshold and indicates a handoff is not yet needed

#### Scenario: Default threshold outside a project
- **WHEN** the probe runs outside any Rasen project and no global `handoff.threshold` is set
- **THEN** the reported threshold is 0.5 with the default source
