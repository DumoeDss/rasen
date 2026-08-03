# archive-destination Specification

## Purpose
Define the `archive.destination` config axis (`in-repo` default, `external`, or `prune`) that decides WHERE archive's directory bookkeeping lands — the repo's own archive folder, the project's machine-home archive, or nowhere (git history as the archive). Covers destructive-destination safety preconditions (delivery-complete, clean-and-tracked git state), the prune confirmation as a consent separate from any other override in the flow, the prune tombstone that lets a later archive invocation recognize a pruned change once its directory is gone, union-of-locations discovery for readers, and the machine-home archive's lifecycle tie to project registration.
## Requirements
### Requirement: Readers see the union of archive locations; config governs writes only

Enumerating or locating archived changes SHALL consider BOTH the in-repo archive directory AND the machine-home archive whenever a home resolves, regardless of the currently configured destination, de-duplicated by archive id with the in-repo copy preferred for display. Switching the destination SHALL affect only future archives; previously archived changes SHALL remain discoverable in place with no migration. Pruned changes are represented by their recorded ship-log/git history, not by directory presence.

#### Scenario: Destination flip does not orphan existing archives

- **WHEN** a project with archives in the in-repo directory switches to `external` and archives more changes
- **THEN** archived-change enumeration (e.g. shell completion of archived ids) SHALL list both the old in-repo archives and the new external ones

#### Scenario: Already-archived detection covers all destinations

- **WHEN** archive is invoked for a change already archived to either the in-repo or the external location, or recorded as pruned/archived in its ship log
- **THEN** the invocation SHALL report the existing outcome (location or pruned state) and stop cleanly without re-gating, re-syncing, or re-moving

### Requirement: Machine-home archives share the home's lifecycle

External archives live inside the registered project home and SHALL be protected from home garbage collection while the project's registry entry lives; when a project is unregistered and its home garbage-collected, its external archives are removed with it — machine-local archives share the machine registration's lifecycle, with git history remaining the durable record. This lifecycle SHALL be stated in the doctor/GC documentation for the machine home.

#### Scenario: GC does not touch a live project's external archives

- **WHEN** `doctor --gc` runs while the project's registry entry exists
- **THEN** the project's home — including `<home>/archive/` — SHALL NOT be deleted

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
