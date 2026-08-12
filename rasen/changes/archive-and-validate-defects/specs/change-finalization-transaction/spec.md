## ADDED Requirements

### Requirement: A stored finalization plan can retire only pre-mutation transaction state

A stored Store v2 finalization plan SHALL use the same ownership-verified abort contract as a standalone archive plan. Apply and abort SHALL serialize on the plan's transaction identity. Abort SHALL retire only an unapplied plan or an owned journal and stage no later than evidence finalization, and SHALL refuse after any canonical-spec action, publication, cleaner action, association finalization, or active-source removal has begun. Aborting SHALL never change the declared outcome, canonical record, target-line address, or workspace association.

#### Scenario: Early finalization stage is abortable

- **WHEN** Store v2 finalization fails after staging evidence but before any canonical-spec action or publication
- **THEN** confirmed abort SHALL verify the finalization plan, stage, journal, and transaction-store identities before removing engine-owned early state
- **AND** the active Change, canonical specs, target-line archive, and workspace association SHALL remain unchanged

#### Scenario: Spec progress makes finalization non-abortable

- **WHEN** the finalization journal records any canonical-spec action as having begun or completed
- **THEN** abort SHALL refuse with the recorded phase and paths
- **AND** the transaction SHALL remain available only for exact-token resume or its verified manual-recovery path

#### Scenario: Apply and abort cannot race

- **WHEN** apply and abort are requested concurrently for one stored transaction
- **THEN** an owner-aware transaction lock SHALL serialize them
- **AND** exactly one operation SHALL evaluate and mutate the transaction state at a time

#### Scenario: Completed abort is idempotent and terminal

- **WHEN** the same abort token is submitted after an earlier abort completed
- **THEN** the command SHALL report the existing abort tombstone without deleting any additional path
- **AND** later apply SHALL refuse because the plan was retired

#### Scenario: Finalization identity mismatch blocks abort

- **WHEN** the stage, journal, plan envelope, or transaction-store record does not match the token's finalization identity and plan hash
- **THEN** abort SHALL fail closed and preserve every disputed path
- **AND** it SHALL provide the existing verified manual-recovery guidance rather than attempting cleanup
