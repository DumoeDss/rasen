# global-config Delta Specification

## ADDED Requirements

### Requirement: Promoted global configuration fields

The global configuration schema SHALL accept `proactive` (boolean), `repoMode` (`solo` | `collaborative`), `telemetry.enabled` (boolean), and `handoff.threshold` (number in (0, 1]) as typed known fields with validation, while continuing to preserve unknown fields for forward compatibility. Absent fields SHALL resolve to their established defaults (`proactive: true`, `repoMode: collaborative`, telemetry enabled, threshold 0.5).

#### Scenario: Typed fields validate on write

- **WHEN** a config write sets `repoMode` to a value outside `solo`/`collaborative` or `handoff.threshold` outside (0, 1]
- **THEN** schema validation fails with a message naming the field and constraint
- **AND** the config file is not saved

#### Scenario: Existing configs without new fields load unchanged

- **WHEN** an existing `~/.rasen/config.json` lacking `proactive`, `repoMode`, `telemetry.enabled`, and `handoff` is loaded
- **THEN** loading succeeds and each field resolves to its default
- **AND** the file is not rewritten as a side effect of loading

#### Scenario: Telemetry block coexists with machine-managed fields

- **WHEN** `telemetry.enabled` is set via the config command and the `telemetry` block already holds `anonymousId` and `noticeSeen`
- **THEN** the write preserves the machine-managed fields alongside the new `enabled` value
