## ADDED Requirements

### Requirement: Store v2 canonical specs change only through a landed finalization

When the resolved scope is a Store v2 project, the sync-specs skill SHALL NOT write that project's canonical specs. It SHALL report that Store v2 canonical specs change only as part of a landed change finalization, and SHALL name the archive command with `--outcome landed` as the route. This closes the out-of-band path by which a delta could reach a partition's canonical specs without an outcome, a reachability proof, or an Archive v2 record, and it makes landed-only synchronization hold for every writer rather than only for the archive path. The skill SHALL continue to refuse a legacy flat Store with the layout-migration diagnostic, and SHALL keep its existing behavior unchanged for standalone projects.

#### Scenario: A Store v2 project partition is not synced out of band

- **WHEN** the sync-specs skill is invoked for a change in a Store v2 project scope
- **THEN** it SHALL refuse to write that project's canonical specs
- **AND** it SHALL name the landed finalization as the only route, without applying any delta

#### Scenario: Standalone syncing is unchanged

- **WHEN** the same skill is invoked in a standalone project
- **THEN** it SHALL sync delta specs to the main specs exactly as before
- **AND** no outcome, target line, or Store identity SHALL be required
