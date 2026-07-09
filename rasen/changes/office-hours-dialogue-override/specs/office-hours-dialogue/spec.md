## ADDED Requirements

### Requirement: Answer before you ask

The `office-hours` skill's Interview discipline SHALL include a rule that the user's question is the highest-priority input and that answering it takes precedence over advancing the interview's question list. The rule SHALL bind every interview phase (Startup mode 2A and Builder mode 2B).

#### Scenario: Interview discipline states answer-first

- **WHEN** the regenerated `office-hours` skill's Interview discipline is inspected
- **THEN** it SHALL state that the user's question is answered before the next interview question is asked
- **AND** the rule SHALL be presented as binding on both the Startup and Builder interview phases

### Requirement: Escape hatch limited to explicit skip signals

The `office-hours` escape hatch (in both Startup mode and Builder mode) SHALL trigger only on explicit skip signals such as "just do it," "skip," or "stop asking, just write it." A user question or a request to explain or discuss SHALL NOT trigger the escape hatch and SHALL instead route to the Dialogue Override behavior. A request for more discussion SHALL NOT be interpreted as impatience.

#### Scenario: Escape hatch requires an explicit skip signal

- **WHEN** the regenerated `office-hours` skill's escape-hatch prose (Startup and Builder modes) is inspected
- **THEN** it SHALL restrict escape-hatch activation to explicit skip signals
- **AND** SHALL state that a user question or request to discuss routes to dialogue, not to the escape hatch

### Requirement: Hard approval gate before writing the design doc

The `office-hours` skill SHALL gate Phase 5 (design-doc writing) on an explicit user approval of an approach in Phase 4. Complaints, silence, and questions SHALL NOT be treated as approval. The skill SHALL NOT write or begin the design doc without that explicit approval.

#### Scenario: Design doc requires explicit Phase 4 approval

- **WHEN** the regenerated `office-hours` skill is inspected around Phase 4 and Phase 5
- **THEN** it SHALL state that the sole precondition for writing the design doc is an explicit approval of an approach in Phase 4
- **AND** SHALL state that complaints, silence, and questions are not approval

### Requirement: Consultation posture for concrete-design arrivals

The `office-hours` skill SHALL provide a Consultation posture for users who arrive with a concrete design plus a request for feedback ("what do you think," "is there a better way"). In this posture the skill SHALL skip generative questioning, deliver analysis prose directly, discuss peer-to-peer, and only after the discussion converges ask whether to distill it into a design doc. The design doc SHALL be framed as a byproduct of the discussion, not the terminus of a flow.

#### Scenario: Consultation posture present

- **WHEN** the regenerated `office-hours` skill is inspected
- **THEN** it SHALL describe a Consultation posture triggered by a concrete design plus a feedback request
- **AND** SHALL state that the posture skips generative questioning and delivers analysis prose directly
- **AND** SHALL state that the design doc is offered only after the discussion converges, as a byproduct rather than a required endpoint
