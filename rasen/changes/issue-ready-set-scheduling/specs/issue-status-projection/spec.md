# issue-status-projection Specification — Delta

## MODIFIED Requirements

### Requirement: Progress counts required nodes whose work is complete

Progress SHALL report completed required nodes over the total required nodes of the Issue's
latest readable plan revision, where the required nodes are the Change nodes whose lifecycle is
`required`. A node counts as complete when the Store's committed evidence finalizes its Change
or when its Change's recorded run-state is terminal with every stage done or skipped and any
portfolio delivery recorded done. The Store's committed evidence finalizes a Change in two
record bases, and the basis is a fact the read reports: an archived Change with a committed
v2 outcome record, and an archived Change whose archive entry carries a legacy record basis —
no v2 outcome record where none was ever written — whose work SHALL count complete with the
legacy basis named on its facts, because the archive fact is itself committed evidence that
the Change's work story closed, and reading it invents no outcome value. An archive record
that exists in v2 shape but fails validation SHALL NOT finalize its Change: the node reports
`unknown` with a status problem naming the file and the reason, and no phase, health, or
progress value SHALL be fabricated from the unreadable record — damaged bytes never release a
dependency gate. Work that is finished but not yet finalized still counts, because progress
measures work completed, not archiving. A node whose lifecycle is `optional`, `cancelled`, or
`superseded` SHALL be counted in neither part of the pair — its completion, when recorded, is
visible on its node line and counted nowhere. An Issue whose latest revision exists but cannot
be read SHALL report no progress value rather than a zero that would read as "nothing
required", and a readable revision that names no required nodes SHALL report zero completed
over zero total, saying that no work is demanded rather than that no value could be derived.

#### Scenario: One of three children complete

- **WHEN** an Issue's plan has three required Change nodes and one has terminal run-state while two have not started
- **THEN** progress reports 1 completed of 3 total

#### Scenario: Finalized and run-terminal nodes count the same

- **WHEN** one node's Change is finalized in the Store and a sibling node's Change has terminal run-state
- **THEN** both count toward completed progress

#### Scenario: Optional and cancelled completions are not counted

- **WHEN** an Issue's plan has three required nodes and one optional node whose work is complete
- **THEN** progress reports over a total of three
- **AND** the optional node's completion is reported on its node line and counted in neither part of the pair

#### Scenario: A plan with no required nodes reports zero over zero

- **WHEN** an Issue's latest readable revision names Change nodes whose lifecycles are all `optional`, `cancelled`, or `superseded`
- **THEN** progress reports 0 completed of 0 total
- **AND** the value is the pair itself, distinct from the no-progress value an unreadable revision reports

#### Scenario: An unreadable plan yields no progress

- **WHEN** an Issue's latest revision exists but fails its digest or parse
- **THEN** no progress pair is reported
- **AND** the reason is reported with the status

#### Scenario: An archived legacy record counts its work complete

- **WHEN** a required node's Change is archived and its archive entry carries a legacy record basis with no v2 outcome record
- **THEN** the node counts toward completed progress on the archive fact alone, with no run-state located
- **AND** the node's facts name the legacy basis rather than presenting a v2 outcome or a run-terminal observation

#### Scenario: A corrupt v2 archive record is reported, not guessed

- **WHEN** a node's Change is archived and its archive record is in v2 shape but fails validation
- **THEN** the node is reported unknown with a status problem naming the file and the reason
- **AND** no completion, phase value, or dependency release is derived from the unreadable record
