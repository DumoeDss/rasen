## ADDED Requirements

### Requirement: In-ship finalization in a Store v2 scope lands only on a proven commit

When the resolved scope is a Store v2 project and the resolved archive timing is `in-ship`, the generated ship workflow SHALL finalize with the explicit `landed` outcome through the authoritative archive command, and SHALL treat the delivery having happened as insufficient on its own. If the delivered commit is not yet reachable from the code ref the change's target line declares for its project, ship SHALL report the unfinalized state and leave the change active rather than archiving it, and SHALL NOT retry by choosing another outcome, by skipping spec synchronization, or by supplying a different commit. Ship SHALL continue to refuse a legacy flat Store with the layout-migration diagnostic. A change whose committed metadata declares no implementation SHALL finalize as landed with no commit, without ship fabricating one.

#### Scenario: In-ship archiving passes an explicit landed outcome

- **WHEN** a Store v2 project change ships under `in-ship` timing and its delivered commit is reachable from the target line's code ref
- **THEN** ship SHALL finalize it with the explicit `landed` outcome through the archive command
- **AND** the ship log SHALL record the published entry path

#### Scenario: An unreachable delivery leaves the change active

- **WHEN** the delivered commit is not yet reachable from the target line's code ref
- **THEN** ship SHALL report that the change was not finalized and why
- **AND** the change SHALL remain active, with no spec synchronized and no entry published

#### Scenario: Ship never substitutes another outcome

- **WHEN** a landed finalization is refused during ship
- **THEN** ship SHALL NOT retry as `abandoned`, `cancelled`, or `superseded`, and SHALL NOT skip spec synchronization to proceed
- **AND** the refusal SHALL be surfaced with its diagnostic code
