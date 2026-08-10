## ADDED Requirements

### Requirement: Workspace coordination writes recover only exact owned state

Machine coordination writes for workspace plans, indexes, locks, bindings, and cleanup SHALL publish their requested bytes without clobbering a concurrently changed target. An interrupted unjournaled write SHALL leave either no transaction carrier or a self-verifying carrier state that a later request for the same target and exact bytes can resume. Recovery SHALL verify the canonical directory, the prior target, the intended bytes, and every retained carrier by exact filesystem identity before publication or removal. Journal-bound writes SHALL additionally require their recorded external authority and SHALL NOT fall back to unjournaled recovery.

#### Scenario: Same unjournaled write resumes its retained claim

- **WHEN** an unjournaled coordination write is interrupted after it has retained a complete claim for a target and intended bytes
- **THEN** a retry requesting that same target and exact bytes SHALL complete from the verified carrier state
- **AND** the target SHALL contain the requested bytes with no duplicate transaction carriers left behind

#### Scenario: Pre-claim exact intent is recoverable

- **WHEN** an unjournaled coordination write is interrupted after its exact durable intent exists but before its claim is published
- **THEN** a retry for the same target and exact bytes SHALL be able to establish a claim from the stable intent and current stable target state
- **AND** a partial or disagreeing intent SHALL remain intact and cause `workspace_atomic_write_conflict`

#### Scenario: Changed or replaced state is retained and refused

- **WHEN** a retained claim is corrupt or disagrees with the requested target or bytes, or its target, intent, backup, claim, or canonical directory identity has changed
- **THEN** the write SHALL fail with `workspace_atomic_write_conflict`
- **AND** it SHALL NOT overwrite the changed target or remove the unproven retained state

#### Scenario: Journal authority remains mandatory

- **WHEN** a retry supplies recorded external carrier authority and any target, digest, path, or identity differs from that authority
- **THEN** the write SHALL fail with `workspace_atomic_write_conflict`
- **AND** a self-contained claim that would qualify for an unjournaled write SHALL NOT be adopted

#### Scenario: Windows filesystem identities remain exact

- **WHEN** two Windows NTFS carrier observations have `dev` or `ino` values that are distinct above JavaScript's safe integer range
- **THEN** the writer SHALL preserve and compare their exact values as different filesystem identities
- **AND** neither path spelling normalization nor numeric rounding SHALL make one carrier authorize the other

### Requirement: Directory durability degrades only for proven unsupported operations

After synchronizing coordination file content, the writer SHALL synchronize the containing directory when the platform and filesystem support it. It SHALL continue without directory synchronization only when an exact directory-open or directory-sync outcome is classified as unsupported for that platform and operation and the canonical directory still has the verified identity. Permission, device, capacity, file-sync, close, ancestry, and unclassified failures SHALL remain visible and SHALL leave recoverable evidence for a later retry.

#### Scenario: Unsupported directory synchronization does not wedge coordination

- **WHEN** directory open or synchronization returns an explicitly supported platform-specific unsupported-operation outcome and the canonical directory identity is unchanged
- **THEN** the coordination write SHALL continue through its no-clobber publication and cleanup
- **AND** a later workspace operation SHALL observe the completed coordination state

#### Scenario: Genuine I/O failure remains visible

- **WHEN** directory handling reports `EACCES`, `EIO`, `ENOSPC`, `EBADF`, an unknown code, or a code not classified for that platform and operation
- **THEN** the coordination write SHALL fail with that genuine error
- **AND** it SHALL retain rather than silently discard any transaction evidence needed for a safe retry

#### Scenario: File sync and close failures are never treated as directory portability

- **WHEN** synchronizing an intent or claim file fails, or closing an opened directory handle fails
- **THEN** the coordination write SHALL fail even if the same error code is tolerated at an eligible directory-open or directory-sync boundary
- **AND** the target SHALL remain protected by the existing no-clobber and identity checks

#### Scenario: Unsupported result cannot hide directory replacement

- **WHEN** an otherwise tolerated directory-open or directory-sync outcome occurs after the lexical path or canonical directory identity has changed
- **THEN** the write SHALL fail with the workspace ancestry conflict
- **AND** it SHALL NOT publish or remove a carrier through the replaced directory
