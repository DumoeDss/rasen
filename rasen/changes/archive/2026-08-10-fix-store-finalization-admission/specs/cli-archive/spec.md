## ADDED Requirements

### Requirement: Archive abort refusal presents actionable state in durable order

When a human-readable archive or Store-finalization abort is refused, the command SHALL print every blocker before contextual association or disposition guidance. After the blockers it SHALL print the effective phase and retained paths, then any pending-association guidance, then the exact recovery command or verified manual action. An ownership or integrity dispute that provides a manual action SHALL NOT gain generic exact-token replay advice.

#### Scenario: Several blockers appear before association guidance

- **WHEN** abort returns several blockers and reports that association completion remains pending
- **THEN** every blocker SHALL be printed in deterministic order before the association-pending line
- **AND** no blocker SHALL be truncated to the first item

#### Scenario: Disposition follows durable transaction state

- **WHEN** a refused abort includes an effective phase, retained paths, and a recovery command or manual action
- **THEN** human output SHALL print the phase and every retained path before that disposition
- **AND** the exact disposition text SHALL be the final guidance for the transaction

#### Scenario: Manual ownership guidance does not invent replay

- **WHEN** abort cannot prove ownership or integrity and returns a verified `manualRecoveryAction` without `recoveryCommand`
- **THEN** human output SHALL print the blockers and manual action
- **AND** it SHALL NOT add a generic apply-plan command
