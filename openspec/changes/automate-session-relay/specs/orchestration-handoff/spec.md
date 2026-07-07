## MODIFIED Requirements

### Requirement: LEAD session pre-flight probe
The `/opsx:auto` entry SHALL probe the LEAD's own transcript (`openspec agent context --latest`) once before starting the pipeline and, when usage meets the session threshold, offer the user a choice — without blocking: (a) automatic session relay now (write the session handoff document, then launch a successor session per the session-relay protocol), (b) continue in the current session with auto-compact as the backstop, or (c) handle it manually. Below the threshold it proceeds silently.

#### Scenario: Entry probe above threshold
- **WHEN** an auto run starts and the probe reports usage at or above the session threshold
- **THEN** the LEAD SHALL present the relay/continue/manual choice and proceed only on the user's say-so at that moment; below threshold it proceeds silently

#### Scenario: User chooses automatic relay
- **WHEN** the user selects automatic relay at the pre-flight offer
- **THEN** the LEAD SHALL complete the session handoff document and run-state update, then perform the relay at a stage boundary per the session-relay protocol (quiesce invariant and generation cap included)

#### Scenario: User declines automatic relay
- **WHEN** the user chooses to continue or to handle handoff manually
- **THEN** behavior SHALL match the pre-existing flow: the run proceeds and auto-compact remains the backstop
