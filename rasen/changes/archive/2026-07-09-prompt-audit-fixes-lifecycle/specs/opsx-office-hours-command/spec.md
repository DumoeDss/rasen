## ADDED Requirements

### Requirement: Facilitation Delegates to the Office-Hours Expert

The office-hours workflow command SHALL treat the `/office-hours` expert skill as the single authority for session facilitation. The inline six-questions / builder description in the command template SHALL serve only as a fallback pre-brief, used when the expert skill is unavailable, and SHALL NOT be run as a second facilitation pass. The design document SHALL be produced exactly once. Precedence: when both the inline description and the expert exist, the expert wins.

#### Scenario: Expert skill drives the session

- **WHEN** the office-hours workflow command runs and the `/office-hours` expert skill is available
- **THEN** the command SHALL delegate session facilitation to the `/office-hours` expert
- **AND** SHALL NOT run the inline question set as a separate second pass
- **AND** SHALL produce the design document in a single step

#### Scenario: Fallback when the expert is unavailable

- **WHEN** the `/office-hours` expert skill is not available
- **THEN** the command MAY run the inline six-questions / builder description as a fallback
- **AND** SHALL still produce the design document exactly once
