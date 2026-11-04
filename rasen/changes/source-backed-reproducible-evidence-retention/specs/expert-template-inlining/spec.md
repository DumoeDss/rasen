## REMOVED Requirements

### Requirement: The 19 experts are covered by the parity golden-master gate

**Reason**: Retire the permanent template hash gate and its hash-specific scenarios.
**Migration**: Use the generated expert delivery requirement below; expert behavior remains unchanged.

## ADDED Requirements

### Requirement: Generated expert skills are validated through delivery

All 19 expert skill templates SHALL remain covered by generation and installation validation through the normal product path. This validation SHALL replace the retired template function/content hash gate without restoring `skill:check` or introducing permanent prompt-string, wiring, or hash assertions. Evidence SHALL identify the affected experts, exercised commands, observed results, and limits; behavioral checks SHALL be proportional to the changed contract.

#### Scenario: Expert templates generate installable skills

- **WHEN** expert template changes are verified
- **THEN** validation SHALL generate and install the expert skills from their canonical TypeScript source
- **AND** it SHALL inspect affected installed instructions for the intended user-visible behavior rather than treat an updated hash as proof

#### Scenario: Shared instructions affect multiple experts

- **WHEN** a shared instruction block changes
- **THEN** verification SHALL identify and inspect its affected generated expert consumers
- **AND** it SHALL retain generation/installation and relevant behavioral evidence without adding replacement wording snapshots
