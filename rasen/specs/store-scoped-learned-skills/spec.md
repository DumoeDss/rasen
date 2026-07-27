# store-scoped-learned-skills Specification

## Purpose

Let a Store own a catalog of learned knowledge that its member projects can draw on: what a Store record is and how it is identified permanently, what evidence and approval are required before knowledge is shared into a Store or promoted beyond it, and how a Store's catalog is mutated without losing ownership or leaving a half-written result.
## Requirements
### Requirement: A Store owns a knowledge catalog identified by the Store's permanent identity

A Store SHALL be able to hold learned knowledge that its member projects draw on. Every durable record of that knowledge — the record itself, its ownership, and anything that names its source — SHALL identify the Store by the Store's permanent identity. The Store's display name MAY accompany that identity for readability and SHALL NOT be the thing anything is keyed on. Renaming a Store's display name SHALL change nothing already recorded: no ownership record, no content identity, and no stored provenance.

#### Scenario: Store knowledge records name the Store permanently

- **WHEN** knowledge is recorded as belonging to a Store
- **THEN** the record names the Store by its permanent identity
- **AND** any display name present is recorded alongside it, never in place of it

#### Scenario: Renaming a Store changes nothing already recorded

- **WHEN** a Store's display name is renamed after its knowledge has been recorded and drawn on
- **THEN** every existing ownership record, provenance entry, and content identity is unchanged
- **AND** the next resolution reports the same result it reported before the rename

#### Scenario: Two Stores sharing a display name stay distinct

- **WHEN** two Stores with different permanent identities carry the same display name and both hold knowledge with the same identifier
- **THEN** their records remain distinct and separately attributable
- **AND** neither is mistaken for the other on the strength of the shared name

#### Scenario: Ordering never depends on the display name

- **WHEN** contributing Stores are listed in any output or written into any record
- **THEN** their order is derived from their permanent identities or a stable canonical serialization
- **AND** it does not change when a display name is renamed

### Requirement: Store knowledge records are versioned and older records stay readable

Every Store knowledge record SHALL carry a schema version. Records written by an earlier version SHALL remain readable, and a newer shape SHALL be written only by an explicit migration or by a new mutation the user performed. Reading a Store's catalog SHALL NOT rewrite it.

#### Scenario: An earlier record is read unchanged

- **WHEN** a Store's catalog contains records written by an earlier version
- **THEN** they are read and used
- **AND** the files are left byte-identical

#### Scenario: A newer shape is written only on purpose

- **WHEN** a user runs an explicit migration or a mutation that writes a record
- **THEN** the newer shape is written
- **AND** no read-only command produces it

### Requirement: A record the catalog cannot trust is reported, never silently omitted

Reading a catalog SHALL verify that each record Rasen wrote still agrees with what its manifest recorded — its body, its identity, its scope, its owner, and a version able to hold that owner. A record that fails verification SHALL NOT be listed as if it were valid, and SHALL NOT be omitted without explanation either: the surface a user reads catalog contents on SHALL name the record, state which check failed, and name the way back. An occupant the catalog never claimed to own — a file the user authored, or one carrying another tool's marker — SHALL remain silently ignored, so the report names only records that a user would experience as having disappeared. Verification and its reporting SHALL write nothing.

#### Scenario: A hand-edited record is reported rather than disappearing

- **WHEN** a user edits the body of a record Rasen wrote and then lists the catalog
- **THEN** the record is reported as unreadable, naming it and the check that failed
- **AND** the report names how to restore or re-record it
- **AND** the record is not listed among the valid records

#### Scenario: Asking for an unreadable record by name explains it

- **WHEN** a user asks to show a record that exists on disk but failed verification
- **THEN** the failure states that the record exists and cannot be read, with the reason
- **AND** it is not reported as a record that does not exist

#### Scenario: Files the catalog does not own stay silent

- **WHEN** a catalog contains a user-authored file or a record carrying another tool's marker
- **THEN** listing the catalog reports nothing about it
- **AND** the files are left exactly as they were

#### Scenario: Human and JSON output report the same rejections

- **WHEN** the same catalog is listed once in human output and once as JSON
- **THEN** both name the same records and the same reasons

### Requirement: Sharing knowledge into a Store requires independent member-project evidence

Publishing knowledge into a Store SHALL require evidence from that Store's member projects, and that evidence SHALL be independent — the same project SHALL NOT satisfy the requirement more than once. Membership SHALL be taken from the Store's own membership records, not from which Store a project happens to plan in. A publication attempt that lacks sufficient evidence SHALL be refused with the evidence it has, the evidence it needs, and nothing written.

#### Scenario: Sufficient independent evidence publishes

- **WHEN** knowledge is proposed for a Store and the required number of distinct member projects have contributed evidence
- **THEN** the publication is permitted

#### Scenario: Repeated evidence from one project is not independent

- **WHEN** the same member project contributes evidence more than once
- **THEN** it counts once toward the requirement
- **AND** the publication is refused if no other member project has contributed

#### Scenario: Evidence from a non-member does not count

- **WHEN** evidence is contributed by a project the Store has no membership record for
- **THEN** it does not count toward the Store's evidence requirement
- **AND** the refusal names the missing membership and the command that adds it

#### Scenario: A refused publication writes nothing

- **WHEN** a publication is refused for insufficient evidence
- **THEN** no record, file, or ownership entry is created or modified in the Store

### Requirement: Promoting knowledge beyond a Store requires independent evidence from more than one project

Promoting knowledge so that it applies machine-wide SHALL require independent evidence from more than one project, and those sources SHALL be homogeneous — evidence for the same knowledge, not merely knowledge with the same name. A promotion that does not meet the requirement SHALL be refused, naming what was found and what is missing, and SHALL write nothing.

#### Scenario: Two distinct projects promote

- **WHEN** independent evidence for the same knowledge exists from two distinct projects
- **THEN** promotion is permitted

#### Scenario: One project cannot promote alone

- **WHEN** all evidence originates from a single project
- **THEN** promotion is refused, naming the single-source problem

#### Scenario: Same name is not same knowledge

- **WHEN** two projects contribute evidence that shares an identifier but is not evidence for the same knowledge
- **THEN** promotion is refused rather than treating the identifier as proof of sameness

### Requirement: Approval is explicit and bound to the scope it approves

Approval to publish or promote SHALL be explicit and SHALL name the scope it applies to. An approval granted for one scope SHALL NOT authorize a wider one, and SHALL NOT be inferred from a previous approval, from the absence of an objection, or from the knowledge already existing at a narrower scope.

#### Scenario: Approval names its scope

- **WHEN** knowledge is approved for a Store
- **THEN** the approval records the Store it applies to

#### Scenario: A narrower approval does not authorize a wider one

- **WHEN** knowledge approved for one Store is proposed for machine-wide promotion
- **THEN** the earlier approval does not satisfy the promotion, and explicit approval for the wider scope is required

#### Scenario: Approval is never inferred

- **WHEN** knowledge exists at a narrower scope and no approval for the wider scope has been given
- **THEN** the wider scope is not granted

### Requirement: Mutating a Store's catalog preserves ownership and never leaves a half-written result

A command that changes a Store's catalog SHALL only modify records the catalog declares it owns, SHALL write each record so that no partially written record is ever visible, and SHALL NOT create a commit or stage anything in the Store's repository. A mutation that fails SHALL leave the catalog exactly as it was and report what stopped it. A mutation killed outright cannot be undone by the process that died, so the previous record SHALL be preserved rather than lost, and the next mutation SHALL restore it and remove the leftovers before it reads the catalog — the guarantee is that no content is destroyed and no half-written record is ever read, not that a killed process leaves no trace at all. Files the user authored themselves SHALL never be modified or deleted by a catalog mutation.

#### Scenario: Only owned records are modified

- **WHEN** a catalog mutation runs against a Store containing both managed records and user-authored files
- **THEN** only the records the catalog declares it owns are changed
- **AND** user-authored files are left exactly as they were

#### Scenario: An interrupted mutation leaves no partial record

- **WHEN** a catalog mutation is interrupted mid-write
- **THEN** no partially written record exists
- **AND** a mutation that fails leaves the catalog reading exactly as it did before it started
- **AND** when the process was killed outright, the record it was replacing is still on disk and the next mutation restores it and clears the leftovers

#### Scenario: A mutation never commits

- **WHEN** a catalog mutation completes
- **THEN** it prints the files the user needs to commit
- **AND** it has staged, committed, and pushed nothing

#### Scenario: Cross-platform record paths

- **WHEN** a Store's catalog is written and read back on Windows
- **THEN** every record resolves under the Store's catalog directory using platform path resolution

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

