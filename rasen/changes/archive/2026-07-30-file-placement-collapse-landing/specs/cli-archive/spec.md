## ADDED Requirements

### Requirement: Archive command always lands in the planning root

`rasen archive <change>` SHALL move the change directory to the planning root's archive directory unconditionally — no configuration is consulted and no destination is resolved (`archive-destination` capability). A project whose config still carries `archive.destination: external` or `prune` SHALL archive in-repo exactly as a project with no such key; the deprecated value produces only a parse-time warning (`config-loading` capability). The command SHALL neither move a change to the machine home nor delete a change directory without an archive copy, and its JSON output SHALL report the archived name and absolute archived path.

#### Scenario: Legacy destination config does not redirect the CLI

- **WHEN** `rasen archive <change> --yes --json` runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** the change SHALL be moved to the planning root's archive directory
- **AND** the JSON result SHALL report the archived name and the absolute archived path
- **AND** nothing SHALL be written under the machine home and no change directory SHALL be deleted

## REMOVED Requirements

### Requirement: Archive command honors the destination axis

**Reason**: The destination axis is retired (`archive-destination` capability). The CLI's `external` move path, its `prune` deletion path and tombstone write, and the destructive-destination preconditions no longer exist; bookkeeping is unconditionally in-repo per the added requirement above.

**Migration**: Existing machine-home archives stay discoverable through the union read and already-archived detection; `rasen archive relocate --to in-repo` consolidates them.

### Requirement: Timing-guard override and prune confirmation are separate consents

**Reason**: There is no `prune` destination and no deletion left to consent to, so the second consent has nothing to guard; the `--confirm-prune` flag is removed. The on-merge timing guard and its `--yes` override are unchanged and specified by their own requirement.

**Migration**: None — the guarded operation no longer exists.
