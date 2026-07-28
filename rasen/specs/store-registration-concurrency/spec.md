# store-registration-concurrency Specification

## Purpose
Concurrent registration of the same canonical Store root (under different aliases) MUST serialize and MUST NOT let a losing registration's cleanup delete the winner's identity metadata. Registration is locked per root; cleanup verifies it still owns the metadata before removing it.
## Requirements
### Requirement: Concurrent registration of the same Store root is serialized

Two registrations targeting the same canonical Store root path — even under different aliases — SHALL serialize so that only one performs its verify→write→register sequence at a time. The serialization lock SHALL be machine-local and keyed by the canonical root path, so registrations of different roots proceed in parallel.

#### Scenario: Two concurrent registrations of the same root under different aliases

- **WHEN** two processes concurrently register the same canonical Store root path under different display aliases
- **THEN** one registration completes fully before the other begins its write phase
- **AND** both registrations succeed without either deleting the other's identity metadata
- **AND** the Store's identity metadata file remains intact after both complete

#### Scenario: A failed registration does not delete metadata another committed entry depends on

- **WHEN** a registration fails after writing identity metadata, and another registration has already committed a registry entry that depends on that metadata
- **THEN** the failed registration's cleanup verifies whether the current metadata content still belongs to its own transaction before deleting
- **AND** if the metadata was overwritten by another registration, it is not deleted
