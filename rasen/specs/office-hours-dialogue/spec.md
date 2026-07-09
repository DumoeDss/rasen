# office-hours-dialogue Specification

## Purpose
Office-hours-specific dialogue behavior — answer-before-you-ask interview discipline, escape-hatch semantics limited to explicit skip signals, a hard approval gate before writing the design doc, and a Consultation posture for users arriving with a concrete design.
## Requirements
### Requirement: Answer before you ask

The `office-hours` skill's Interview discipline SHALL include a rule that the user's question is the highest-priority input and that answering it takes precedence over advancing the question list. The rule SHALL bind every question in the skill, including the Diagnosis product's six-question script and the Design product's fork-scan questions.

#### Scenario: Interview discipline states answer-first

- **WHEN** the regenerated `office-hours` skill's Interview discipline is inspected
- **THEN** it SHALL state that the user's question is answered before the next question is asked
- **AND** the rule SHALL be presented as binding on both the Diagnosis product's six-question script and the Design product's fork-scan questions

### Requirement: Escape hatch limited to explicit skip signals

The `office-hours` escape hatch (Diagnosis product) and skip-signal handling (Design product) SHALL trigger only on explicit skip signals such as "just do it," "skip," or "stop asking, just write it." A user question or a request to explain or discuss SHALL NOT trigger a skip and SHALL instead route to the Dialogue Override behavior. A request for more discussion SHALL NOT be interpreted as impatience.

#### Scenario: Escape hatch requires an explicit skip signal

- **WHEN** the regenerated `office-hours` skill's Diagnosis-product escape-hatch prose and Design-product skip-signal prose are inspected
- **THEN** each SHALL restrict activation to explicit skip signals
- **AND** SHALL state that a user question or request to discuss routes to dialogue, not to a skip

### Requirement: Hard approval gate before writing the design doc

The `office-hours` skill SHALL gate design-doc writing on an explicit user approval: in the Diagnosis product, explicit approval of an approach surfaced by the shared fork-scan mechanism; in the Design product, explicit "yes" to distilling the converged discussion into a doc. Complaints, silence, and questions SHALL NOT be treated as approval. The skill SHALL NOT write or begin the design doc without one of these two explicit approval paths.

#### Scenario: Design doc requires explicit approval

- **WHEN** the regenerated `office-hours` skill is inspected around its approval and doc-writing steps
- **THEN** it SHALL state that writing the design doc requires either explicit approval of an approach (Diagnosis product) or explicit "yes" to distill the discussion into a doc (Design product)
- **AND** SHALL state that complaints, silence, and questions are not approval

### Requirement: Post-pause proceed-vs-stop disambiguation

The `office-hours` skill SHALL include a line disambiguating the two meanings of a "proceed" reply after a Dialogue Override pause: a reply that signals to proceed or continue ("proceed," "continue," "let's keep going") SHALL resume the next interview question where the flow paused, while only an explicit stop-asking signal ("just do it," "skip the questions," "stop asking, just write it") SHALL fire the escape hatch.

#### Scenario: Proceed resumes, stop-asking fires the escape hatch

- **WHEN** the regenerated `office-hours` skill's escape-hatch / Dialogue Override interaction is inspected
- **THEN** it SHALL state that after a Dialogue Override pause a "proceed/continue" reply resumes the next question
- **AND** SHALL state that only an explicit stop-asking signal fires the escape hatch

### Requirement: Design product has an explicit terminal that skips the founder close

The `office-hours` skill SHALL define an explicit terminal for the Design product: after the converged discussion is distilled into a design doc (on the user's explicit "yes"), the skill SHALL deliver a plain summary plus a `/rasen:propose` pointer, and SHALL SKIP Phase 4.5 (founder-signal synthesis) and Phase 6 (the founder plea / three closing beats). The skill SHALL scope the Phase 6 "every user gets all three beats" statement and the Phase 4.5 signal synthesis to the Diagnosis product only, so they do not fire on a Design-product session.

#### Scenario: Design-product terminal is plain and skips Phase 4.5/6

- **WHEN** the regenerated `office-hours` skill's Design-product flow and closing steps are inspected
- **THEN** the Design-product terminal SHALL be a plain summary plus a `/rasen:propose` pointer
- **AND** SHALL state that Phase 4.5 (founder-signal synthesis) and Phase 6 (founder plea) are skipped in the Design product

#### Scenario: Founder close scoped to the Diagnosis product

- **WHEN** the regenerated `office-hours` skill's Phase 6 "every user gets all three beats" statement and Phase 4.5 are inspected
- **THEN** they SHALL be scoped to the Diagnosis product
- **AND** SHALL NOT claim to apply to the Design product

### Requirement: Answer-first binds every approval and fork question

The `office-hours` "Answer before you ask" rule SHALL bind every question in the skill, including the fork-scan weight-bearing-fork questions and the approach-approval prompt shared by both products — not only the Diagnosis product's six-question script. When the user asks a question at a fork-scan question or an approach-approval gate, the skill SHALL answer it in prose first (per the Dialogue Override) before re-issuing the gate.

#### Scenario: Answer-first covers the fork-scan and approval gates

- **WHEN** the regenerated `office-hours` skill's Interview discipline "Answer before you ask" rule is inspected
- **THEN** it SHALL state that answering the user's question precedes advancing at every question in the skill, including the fork-scan questions and the shared approach-approval prompt
- **AND** SHALL NOT read as scoped to only the Diagnosis product's six-question script

