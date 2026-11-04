## REMOVED Requirements

### Requirement: Golden-master parity preserved for PREAMBLE-embedding templates

**Reason**: Retire permanent hash and prompt-string assertions for PREAMBLE consumers.
**Migration**: Use generated dialogue-contract validation below; preserve the existing dialogue behavior.

## ADDED Requirements

### Requirement: Generated dialogue contracts are validated through delivery

Changes to the shared PREAMBLE SHALL be validated through actual generation and installation of affected expert skills. Verification SHALL inspect emitted guidance for the existing Dialogue Override, Completeness scoping, and Re-ground rules, with proportionate behavioral evidence rather than permanent prompt-string, wiring, or template hash assertions.

#### Scenario: Dialogue contracts survive PREAMBLE changes

- **WHEN** a PREAMBLE change is verified
- **THEN** verification SHALL inspect affected generated/installed skills for answering discussion requests before resuming decisions, without combining the answer and phase advancement
- **AND** it SHALL preserve the existing restrictions on Completeness scores and repeated Re-ground openers
- **AND** it SHALL record affected consumers, exercised commands, observed results, and unverified scope
