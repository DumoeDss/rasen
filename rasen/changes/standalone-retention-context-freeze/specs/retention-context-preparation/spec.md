## ADDED Requirements

### Requirement: A change with no pipeline run-state can be prepared for retention

Rasen SHALL provide one operation that prepares a specific change for retention and returns everything the retention workflow needs to proceed: the effective retention mode, the frozen knowledge identity, and the location later knowledge commands read frozen identity from. Preparation SHALL succeed for a completed change that never ran through a classified pipeline and therefore has no pipeline run-state, so standalone retention has a defined path from "mode resolved from the effective profile" to "project knowledge operations use a frozen identity".

Preparation SHALL be the only way a standalone retention run obtains a frozen identity. A retention worker SHALL NOT be required, or permitted, to hand-write durable state or synthesize an owner identity to reach the same result.

#### Scenario: Standalone preparation on a change with no run-state

- **WHEN** a user prepares a completed change that has no pipeline run-state
- **AND** the project knowledge owner resolves unambiguously
- **THEN** Rasen SHALL report the effective retention mode
- **AND** SHALL record a frozen knowledge context holding the resolved planning root and owner
- **AND** SHALL report the directory later knowledge commands read that frozen identity from

#### Scenario: A prepared change can apply an accepted project lesson

- **WHEN** a change has been prepared, the effective retention mode is `codify`, and one project candidate passes every acceptance gate
- **THEN** applying that candidate with the reported directory SHALL succeed
- **AND** the applied lesson SHALL be owned by the identity recorded at preparation

#### Scenario: Zero accepted candidates completes as a no-op

- **WHEN** a prepared standalone retention run rejects every candidate
- **THEN** the run SHALL complete successfully
- **AND** SHALL write no learned skill and no placeholder record

### Requirement: Preparation reports the retention mode that governs authorization

Preparation SHALL report the effective retention mode — the same resolution that decides whether a project-scoped lesson may be applied — rather than only an explicitly stored value. A user whose retention mode comes from the profile rather than a stored key SHALL receive that resolved mode, so the mode a retention run is told is the mode that governs it.

#### Scenario: Mode resolved from the profile is reported

- **WHEN** a project has no explicitly stored retention key and its effective profile supplies a retention mode
- **THEN** preparation SHALL report that resolved mode
- **AND** SHALL NOT report an empty result or fail because no value was stored

#### Scenario: Reported mode agrees with the authorization decision

- **WHEN** preparation reports a retention mode
- **AND** a project-scoped lesson application is then attempted for the same change
- **THEN** the authorization decision SHALL be consistent with the reported mode

### Requirement: Preparation is safe to repeat and never rewrites recorded identity

Repeating preparation for the same change SHALL reuse the identities already recorded rather than creating a second record or a duplicate knowledge entry. A knowledge context already present SHALL be treated as authoritative and left exactly as written, regardless of which context version recorded it, and SHALL NOT be upgraded in place. Preparation SHALL leave an existing pipeline run-state and its recorded knowledge context unchanged.

#### Scenario: Repeated preparation is idempotent

- **WHEN** preparation runs a second time on an already-prepared change
- **THEN** it SHALL report the same identities and the same directory as the first run
- **AND** SHALL create no duplicate durable record and no duplicate knowledge entry

#### Scenario: An existing pipeline run-state is authoritative

- **WHEN** preparation runs for a change that already has a pipeline run-state carrying a knowledge context
- **THEN** that recorded context SHALL be reported unchanged
- **AND** the stored record SHALL remain exactly as it was written

#### Scenario: An earlier context version is reused, not upgraded

- **WHEN** the recorded knowledge context uses a context version earlier than the current one
- **THEN** preparation SHALL reuse it as authoritative
- **AND** SHALL NOT rewrite it into the current version

#### Scenario: Preparation survives an interrupted write

- **WHEN** preparation is interrupted while recording durable state
- **THEN** the change SHALL be left either with its previous durable state or with the fully written new state
- **AND** SHALL NOT be left with a partially written record

### Requirement: Preparation fails closed on ownership it cannot settle

Preparation SHALL refuse before any candidate is created when ownership is ambiguous, missing, renamed beyond resolution, or stale. It SHALL report which condition blocked it. Ownership SHALL resolve for both project-owned and store-owned knowledge, including two registered stores that share a display name.

#### Scenario: Ambiguous ownership blocks preparation

- **WHEN** the knowledge owner for a change cannot be resolved to exactly one owner
- **THEN** preparation SHALL fail and name the ambiguity
- **AND** SHALL create no durable record and no candidate

#### Scenario: Stale ownership blocks preparation

- **WHEN** the recorded or resolved owner no longer exists on this machine
- **THEN** preparation SHALL fail and name the stale owner
- **AND** SHALL NOT substitute a different owner

#### Scenario: Two stores sharing a display name still resolve

- **WHEN** two registered stores share a display name and one owns the change's knowledge
- **THEN** preparation SHALL resolve the correct store through its durable identity
- **AND** SHALL NOT depend on the shared display name to choose

#### Scenario: An explicit selector that disagrees with recorded identity is refused

- **WHEN** preparation is given an explicit owner selector that disagrees with an already-recorded identity
- **THEN** preparation SHALL fail reporting the conflict
- **AND** SHALL NOT retarget the recorded identity

### Requirement: The prepared record carries durable identity only

The knowledge context recorded by preparation SHALL identify the planning root and owner by durable identity, never by an absolute planning or owner directory, so the record stays valid when the same change is read from another machine or checkout.

#### Scenario: No absolute root is persisted

- **WHEN** preparation records a knowledge context
- **THEN** the record SHALL identify the planning root and owner by durable identity
- **AND** SHALL contain no absolute planning or owner directory path

#### Scenario: A moved checkout still resolves

- **WHEN** a prepared change is read from a different absolute location than the one it was prepared in
- **THEN** the recorded identity SHALL still resolve to the same planning root and owner

### Requirement: The retention workflow obtains its mode and identity from preparation

The shipped retention workflow SHALL obtain the standalone retention mode and the frozen knowledge identity from the preparation operation, so its documented instructions describe a path that works. It SHALL NOT direct a worker to read the retention mode from a surface that reports only an explicitly stored value, and SHALL NOT direct a worker to resolve a missing knowledge identity through a command that already requires the identity's location.

#### Scenario: Standalone retention instructions resolve

- **WHEN** a worker follows the shipped retention workflow for a standalone invocation on a change with no pipeline run-state
- **THEN** every step it is told to run SHALL be available and SHALL succeed for that change
- **AND** the worker SHALL reach a frozen knowledge identity without hand-writing durable state or synthesizing an owner

#### Scenario: The workflow no longer depends on the stored-value lookup

- **WHEN** the shipped retention workflow resolves the standalone retention mode
- **THEN** it SHALL use the reported effective mode
- **AND** SHALL NOT depend on a command that reports nothing when no retention key is stored
