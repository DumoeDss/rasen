# OPSX Archive Skill Spec (delta)

## ADDED Requirements

### Requirement: Archive closes the delivery chain

After its bookkeeping step succeeds (any destination), the archive skill SHALL append the `sha-cross-stamping` chain record to the change's ship log — outcome, timestamp, ship commit SHA from the log's recorded facts, and the archive commit SHA (journaled immediately after the commit when the commit follows the append) — and SHALL include the ship short SHA in its post-bookkeeping commit-message guidance, omitting it when no ship commit is recorded. Bulk archive SHALL apply the same append and commit-message form per change. These additions SHALL key on recorded ship-log facts, never re-resolved config, and SHALL leave the ship-side log section untouched.

#### Scenario: Append happens after bookkeeping, before completion is reported

- **WHEN** the generated archive skill is inspected
- **THEN** the chain-record append SHALL follow the bookkeeping step and precede the completion summary
- **AND** the commit guidance SHALL carry the ship short SHA for shipped changes

#### Scenario: Bulk archive stamps each change

- **WHEN** the generated bulk-archive skill archives multiple changes
- **THEN** each change SHALL receive its own ship-log append and its own ship-referencing commit-message form
