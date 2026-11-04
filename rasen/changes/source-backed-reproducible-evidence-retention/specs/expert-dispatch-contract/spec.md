## REMOVED Requirements

### Requirement: Golden-master parity preserved for affected templates

**Reason**: Retire permanent hash and prompt-string assertions for dispatch templates.
**Migration**: Use generated dispatch-contract validation below; preserve all dispatched and standalone authority boundaries.

## ADDED Requirements

### Requirement: Generated dispatch contracts are validated through delivery

Changes to the PREAMBLE, `ADVERSARIAL_STEP`, `TEST_COVERAGE_AUDIT_REVIEW`, affected expert templates, and the orchestration playbook SHALL be validated through actual generation and installation. Verification SHALL inspect affected generated consumers for dispatched versus standalone restrictions, canonical report routing, canonical severities, and mode-gated mutation and subagent behavior. Permanent prompt-string, wiring, or template hash assertions SHALL NOT replace proportionate behavioral evidence.

#### Scenario: Mode contracts survive shared template changes

- **WHEN** changes to shared expert or orchestration instructions are verified
- **THEN** verification SHALL inspect generated/installed dispatched and standalone guidance for the existing mode contracts
- **AND** it SHALL record the affected consumers, exercised commands, observed results, and unverified scope
- **AND** report-only workers SHALL retain their canonical-report-only restriction and SHALL NOT gain standalone mutation or orchestration authority
