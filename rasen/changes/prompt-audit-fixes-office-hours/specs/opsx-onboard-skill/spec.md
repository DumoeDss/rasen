# opsx-onboard-skill delta

## ADDED Requirements

### Requirement: PAUSE points answer a user question then resume

The onboard skill SHALL instruct that when the user asks a question at a PAUSE point (rather than giving an acknowledgment), the agent answers the question first and then resumes the phase where it paused, instead of treating the question as a non-acknowledgment and re-prompting. This guardrail SHALL be present because the onboard template does not embed the shared expert PREAMBLE and therefore is not covered by the Dialogue Override.

#### Scenario: Question at a PAUSE is answered then resumed

- **WHEN** the regenerated onboard skill's Guardrails are inspected
- **THEN** they SHALL state that a user question at a PAUSE is answered first, then the phase resumes where it paused
- **AND** SHALL NOT require the agent to re-prompt for acknowledgment when the user asked a question instead
