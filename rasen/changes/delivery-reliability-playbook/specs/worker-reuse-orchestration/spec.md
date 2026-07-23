## ADDED Requirements

### Requirement: Apply implementer parks pending its first review verdict

When a review or verify stage immediately follows apply and the apply implementer's context occupancy is at or above the playbook's context floor for parking (the same floor already used to decide whether a worker is cheap enough to just re-spawn), the LEAD SHALL dispatch that implementer to park (via the parked-worker keepalive mechanism) for the interval between finishing apply and receiving the first review verdict, rather than leaving it un-parked to idle until its prompt cache expires. When the first verdict is clean, the LEAD SHALL stand the parked implementer down through the normal stand-down protocol. When the first verdict routes a fix back to that implementer, the LEAD SHALL deliver it through the parked-worker signal-file channel and the implementer resumes as an active worker to perform the fix, rather than being cold-restarted.

#### Scenario: High-context implementer parks through the review window

- **WHEN** an apply implementer above the parking context floor finishes apply and a review stage begins
- **THEN** the LEAD SHALL dispatch it to park pending the first review verdict instead of leaving it un-parked

#### Scenario: Low-context implementer is not parked

- **WHEN** an apply implementer below the parking context floor finishes apply
- **THEN** the LEAD MAY leave it un-parked, since rebuilding its context from scratch is cheap

#### Scenario: Clean first verdict stands the parked implementer down

- **WHEN** a parked apply implementer's first review verdict is clean
- **THEN** the LEAD SHALL stand it down through the normal stand-down protocol rather than keeping it parked further

#### Scenario: A routed-back fix reaches the parked implementer via signal file, not SendMessage

- **WHEN** a parked apply implementer's first review verdict routes a non-trivial fix back to it
- **THEN** the LEAD SHALL deliver that fix through the parked-worker signal-file channel
- **AND** SHALL NOT `SendMessage` the parked implementer directly, since mid-park delivery rebases its cache and defeats the purpose of parking it
