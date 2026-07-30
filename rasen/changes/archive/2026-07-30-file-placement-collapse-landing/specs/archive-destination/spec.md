## ADDED Requirements

### Requirement: Archive bookkeeping always lands in the planning root

Archive directory bookkeeping SHALL always land in the planning root's archive directory (`<planningRoot>/rasen/changes/archive/`). No configuration SHALL redirect it: every bookkeeping actor (the archive CLI command, the archive skill, bulk archive, and ship's in-ship step) SHALL move the change directory to the in-repo archive unconditionally. All paths SHALL be built with the platform path module (Windows and POSIX).

#### Scenario: Bookkeeping ignores a configured destination

- **WHEN** a change is archived in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** the change SHALL be moved to the in-repo archive directory
- **AND** nothing SHALL be moved to the machine home and nothing SHALL be deleted without an archive copy

#### Scenario: Default behavior is unchanged

- **WHEN** the config has no `archive.destination`
- **THEN** archiving SHALL move the change to the in-repo archive directory exactly as before

### Requirement: Legacy machine-home archives remain discoverable

Until previously externalized archives are migrated back to the planning root, enumerating or locating archived changes SHALL consider BOTH the in-repo archive directory AND the machine-home archive whenever a machine home resolves, de-duplicated by archive id with the in-repo copy preferred for display. Already-archived detection SHALL recognize a change archived at either location, and a change recorded as pruned in its ship log SHALL be reported as pruned rather than "not found".

#### Scenario: Legacy external archives stay visible

- **WHEN** archives exist in the machine-home archive from the retired `external` destination
- **THEN** archived-change enumeration SHALL list them alongside in-repo archives

#### Scenario: Already-archived detection covers legacy locations

- **WHEN** archive is invoked for a change already archived to the machine home, or recorded as pruned in its ship log
- **THEN** the invocation SHALL report the existing outcome and stop cleanly without re-gating, re-syncing, or re-moving

## REMOVED Requirements

### Requirement: Archive destination is a config axis with in-repo as the default

**Reason**: The placement configuration surface collapses to zero (`file-placement` capability): archive bookkeeping always lands in the planning root; `external` and `prune` write policies are retired.

**Migration**: A config still carrying `archive.destination` parses with a deprecation warning (`config-loading` capability) and does not affect writes; existing external archives remain discoverable and are migrated by child B.

### Requirement: Relocation is the recommended surface for destination changes

**Reason**: There is no destination configuration left to change; `rasen archive relocate` remains only as the consolidation surface into the planning root (`archive-relocate` capability).

**Migration**: `rasen config set archive.destination` is rejected as not settable; users with external archives run `rasen archive relocate --to in-repo` (or `--to store`).

### Requirement: External destination resolves through the machine home at write time

**Reason**: The `external` write path is removed; no archive write resolves through the machine home.

**Migration**: The machine-home archive location remains readable for legacy discovery and child B's migrator.

### Requirement: Destructive destinations require delivery-complete and committed state

**Reason**: The destructive destinations (`external`, `prune`) are removed; archive bookkeeping never removes the repository's only copy of review material, so the preconditions have nothing left to guard.

**Migration**: None — the guarded operations no longer exist. (Child B's ephemera cleanup defines its own whitelist safety discipline.)

### Requirement: Prune writes a tombstone before deleting

**Reason**: `prune` is removed; no deletion happens at archive bookkeeping time, so no tombstone is needed for new archives.

**Migration**: Existing `Pruned:` tombstones in legacy ship logs remain readable; already-archived detection keeps recognizing them.

### Requirement: Quality capture follows the archived directory and is skipped for prune

**Reason**: With a single in-repo landing there is no destination-dependent behavior left; quality capture unconditionally runs against the in-repo archived directory (its own behavior is specified by the `archive-quality-capture` capability).

**Migration**: None — capture behavior for the in-repo case is unchanged.
