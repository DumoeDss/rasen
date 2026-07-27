## MODIFIED Requirements

### Requirement: Choosing a project to work on in a Store session is validated before the session starts

Before a Store session begins working on a project, the system SHALL confirm that the Store resolves and is healthy, that the chosen checkout exists on this machine, that the checkout's own recorded identity is the project that was chosen, and that the Store vouches for that project. The Store SHALL be taken to vouch for the project ONLY when the Store's own membership record for that project is present and readable: the record under the Store's metadata directory named by the project's permanent identity, normalized by the single membership provider together with any legacy sources it already understands. The project's own durable Store declaration is a LOCATOR and SHALL NOT vouch for the project on its own — a declaration that resolves to this Store but for which no Store record exists SHALL be rejected, never silently granted. The declaration MAY be consulted after the rejection is decided, ONLY to shape the diagnostic: when the declaration resolves to this Store the rejection SHALL carry a legacy-migration marker naming the missing record and stating that the project's own declaration used to be sufficient before this Store recorded it, with the copy-pasteable repair command (`rasen store add-project <projectId> --store <storeId>`); when the declaration is absent, malformed, or resolves to a different Store the rejection SHALL name the missing record and the same repair command without the legacy marker. A project whose own default planning Store is a different Store SHALL remain a valid choice once the session's Store records it, because the session records its planning Store explicitly. A failure at any step SHALL prevent the session from starting and SHALL name which check failed and the command that repairs it.

#### Scenario: A valid choice starts the session

- **WHEN** a user chooses a project that the Store's membership record permits, whose checkout exists and carries that project's identity
- **THEN** the session starts with that project as its execution target

#### Scenario: A project the Store does not record is rejected even when its own declaration names this Store

- **WHEN** the chosen project's own durable Store declaration resolves to this Store but the Store has no membership record for it
- **THEN** the session does not start
- **AND** the failure carries the legacy-migration marker, names the missing membership record, and prints the `rasen store add-project` command that establishes it
- **AND** the declaration is not used to vouch for the project

#### Scenario: A checkout that is not that project is rejected

- **WHEN** the chosen checkout's own recorded identity is a different project
- **THEN** the session does not start and the failure names the identity mismatch

#### Scenario: A project the Store does not have as a member is rejected

- **WHEN** the Store's membership record does not name the chosen project
- **THEN** the session does not start and the failure names the missing membership and the command that adds it
- **AND** a declaration that names a different Store, one that cannot be resolved on this machine, or no declaration at all, does not vouch for the project
- **AND** the rejection message distinguishes the case where the project's own declaration names this Store (legacy declaration-only install) from the case where it does not, so the user knows whether running `rasen store add-project` is the only remaining step

#### Scenario: A project that plans elsewhere is still a valid choice

- **WHEN** the chosen project's own default planning Store is a different Store from the one the session plans in, and the session's Store records the project
- **THEN** the session starts, planning in the session's Store
- **AND** commands inside the session do not revert to the project's own planning Store

#### Scenario: An unavailable Store stops the session before it starts

- **WHEN** the session's planning Store cannot be resolved on this machine
- **THEN** the session does not start, and the failure carries the reason and a copy-pasteable repair command
