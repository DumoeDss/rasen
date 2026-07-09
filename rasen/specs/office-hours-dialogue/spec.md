# office-hours-dialogue Specification

## Purpose
Office-hours-specific dialogue behavior — answer-before-you-ask interview discipline, escape-hatch semantics limited to explicit skip signals, a hard approval gate before writing the design doc, and a Consultation posture for users arriving with a concrete design.

## Requirements

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

The `office-hours` skill SHALL gate Phase 5 (design-doc writing) on an explicit user approval — either an explicit approval of an approach in Phase 4, or, in the Consultation posture, an explicit "yes" to distilling the converged discussion into a doc. Complaints, silence, and questions SHALL NOT be treated as approval. The skill SHALL NOT write or begin the design doc without one of these two explicit approval paths.

#### Scenario: Design doc requires explicit approval

- **WHEN** the regenerated `office-hours` skill is inspected around Phase 4 and Phase 5
- **THEN** it SHALL state that writing the design doc requires either explicit approval of an approach in Phase 4, or, in the Consultation posture, explicit "yes" to distill the discussion into a doc
- **AND** SHALL state that complaints, silence, and questions are not approval

### Requirement: Consultation posture for concrete-design arrivals

The `office-hours` skill SHALL provide a Consultation posture for users who arrive with a concrete design plus a request for feedback ("what do you think," "is there a better way"). In this posture the skill SHALL skip generative questioning, deliver analysis prose directly, discuss peer-to-peer, and only after the discussion converges ask whether to distill it into a design doc. The design doc SHALL be framed as a byproduct of the discussion, not the terminus of a flow. The posture SHALL be entered deterministically: an opening message combining a concrete design/plan with a feedback request SHALL short-circuit the Phase 1 goal question and mode menu directly into Consultation.

#### Scenario: Consultation posture present

- **WHEN** the regenerated `office-hours` skill is inspected
- **THEN** it SHALL describe a Consultation posture triggered by a concrete design plus a feedback request
- **AND** SHALL state that the posture skips generative questioning and delivers analysis prose directly
- **AND** SHALL state that the design doc is offered only after the discussion converges, as a byproduct rather than a required endpoint

#### Scenario: Consultation routing is deterministic

- **WHEN** the regenerated `office-hours` skill's Phase 1 routing is inspected
- **THEN** it SHALL state that an opening message with a concrete design plus a feedback request short-circuits directly into the Consultation posture, bypassing the goal question and mode menu
