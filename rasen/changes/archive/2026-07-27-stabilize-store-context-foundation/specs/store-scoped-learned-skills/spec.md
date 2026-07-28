## ADDED Requirements

### Requirement: A frozen run records Store ownership by permanent identity

A run freezing which Store its knowledge belongs to SHALL record permanent
identity as the authority when every Store that record names has one, and SHALL
carry display names only for readability. A record naming any Store that has no
permanent identity SHALL still be written, identifying its Stores by display
name — refusing would stop work that succeeds today, and the safety this
requirement exists for is delivered when such a record is read, not by refusing
to write it. Identity is recorded for all of a record's Stores or for none of
them, so a record can never look authoritative while resting on a name.

Renaming a Store SHALL NOT change which Store an already-frozen run belongs to,
and two Stores that share a display name SHALL stay distinct to every run frozen
against either of them. **These two guarantees hold for every frozen run, however
its Store was recorded**: a permanent identity resolves through a rename and past
a namesake, and a name-only record resolves fail-closed instead, so neither can
be silently re-targeted.

The instructions that tell a run how to freeze its knowledge identity SHALL
direct it to record permanent identity for every Store the record names, and to
record it for none of them when any one of those Stores has none, so no new run
carries a mixture that would read as more durable than it is.

#### Scenario: A renamed Store still owns its frozen runs

- **WHEN** a Store is renamed after a run was frozen against it, and that run recorded permanent identity
- **THEN** the run SHALL still resolve to that same Store
- **AND** the rename SHALL NOT change what the run belongs to

#### Scenario: Two Stores sharing a display name stay distinct

- **WHEN** two Stores share a display name and a run was frozen against one of them, recording its permanent identity
- **THEN** resuming that run SHALL resolve to the Store it was frozen against
- **AND** SHALL NOT resolve to the other Store

#### Scenario: A newly frozen run records permanent identity

- **WHEN** a run freezes its knowledge identity, and every Store the record names has a permanent identity
- **THEN** each recorded identity SHALL be that Store's permanent identity
- **AND** the display names SHALL be carried only for readability

#### Scenario: Freezing against a Store with no permanent identity still succeeds

- **WHEN** a run freezes its knowledge identity, and any Store the record names has no permanent identity
- **THEN** the run SHALL still be frozen, and the record SHALL remain readable
- **AND** the record SHALL name its Stores by display name, since identity is recorded for all of them or for none
- **AND** resolving that record later SHALL go through the fail-closed path — including after that Store is renamed, and when a second Store shares its name — so the Store it belongs to is never guessed at

### Requirement: A frozen record that names a Store only by display name resolves fail-closed

A frozen record written before permanent identity was recorded SHALL remain
readable. Resolving the Store it names SHALL succeed only when that name
identifies exactly one Store on this machine. When the name identifies no Store,
or more than one, the run SHALL stop and report which name it could not settle,
listing the candidates when there are several, and SHALL NOT choose one of them.
Reading such a record SHALL NOT rewrite it, since a frozen record is the
authority for a run already in flight.

#### Scenario: An unambiguous legacy record still resolves

- **WHEN** a run is resumed from a record that names its Store only by display name, and exactly one Store on this machine carries that name
- **THEN** the run SHALL resolve to that Store and continue

#### Scenario: An ambiguous legacy record stops the run

- **WHEN** a run is resumed from a record that names its Store only by display name, and several Stores on this machine carry that name
- **THEN** the run SHALL stop and report the ambiguity
- **AND** it SHALL list the candidate Stores and choose none of them

#### Scenario: A legacy record naming no known Store stops the run

- **WHEN** a run is resumed from a record that names its Store only by display name, and no Store on this machine carries that name
- **THEN** the run SHALL stop and name the Store it could not find

#### Scenario: Reading a legacy record leaves it unchanged

- **WHEN** a legacy frozen record is read to resume a run
- **THEN** the record SHALL be left exactly as it was written
