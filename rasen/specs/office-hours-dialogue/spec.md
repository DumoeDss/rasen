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

### Requirement: Consultation posture takes precedence and replaces Phases 2-4

The `office-hours` skill SHALL state that the Consultation posture is authoritative for its whole session and replaces Phases 2, 3, and 4. The skill SHALL state the precedence explicitly: the `Phase 4: Alternatives Generation (MANDATORY)` header and the three "fully formed plan still runs Phase 3 (Premise Challenge) and Phase 4 (Alternatives)" rules (in Phase 2A, Phase 2B, and Important Rules) apply ONLY to the interview paths (Startup mode and Builder mode), NOT to the Consultation posture. An opening message combining a concrete design/plan with a feedback request SHALL therefore route deterministically into Consultation and SHALL NOT trigger Phase 3 Premise Challenge or the Phase 4 alternatives-and-approval machinery.

#### Scenario: Consultation posture states it replaces Phases 2-4

- **WHEN** the regenerated `office-hours` skill's Consultation posture is inspected
- **THEN** it SHALL state that the posture replaces Phases 2, 3, and 4 for the session
- **AND** SHALL state that the `Phase 4 (MANDATORY)` and "fully formed plan still runs Phase 3 + Phase 4" rules apply only to the interview paths (Startup/Builder), not to Consultation

#### Scenario: Interview-path rules are scoped away from Consultation

- **WHEN** the regenerated `office-hours` skill's Phase 4 header and the three fully-formed-plan rules (Phase 2A, Phase 2B, Important Rules) are inspected
- **THEN** each SHALL be scoped to the interview paths (Startup/Builder)
- **AND** SHALL point to the Consultation posture as the route that replaces Phases 2-4 for a concrete-design-plus-feedback opening

### Requirement: Consultation posture has an explicit terminal that skips the founder close

The `office-hours` skill SHALL define an explicit terminal for the Consultation posture: after the converged discussion is distilled into a design doc (on the user's explicit "yes"), the skill SHALL deliver a plain summary plus a `/rasen:propose` pointer, and SHALL SKIP Phase 4.5 (founder-signal synthesis) and Phase 6 (the founder plea / three closing beats). The skill SHALL scope the Phase 6 "every user gets all three beats regardless of mode" statement and the Phase 4.5 signal synthesis to the interview paths (Startup/Builder) so they do not fire on a Consultation session.

#### Scenario: Consultation terminal is plain and skips Phase 4.5/6

- **WHEN** the regenerated `office-hours` skill's Consultation posture and closing flow are inspected
- **THEN** the Consultation terminal SHALL be a plain summary plus a `/rasen:propose` pointer
- **AND** SHALL state that Phase 4.5 (founder-signal synthesis) and Phase 6 (founder plea) are skipped in the Consultation posture

#### Scenario: Founder close scoped to interview paths

- **WHEN** the regenerated `office-hours` skill's Phase 6 "every user gets all three beats" statement and Phase 4.5 are inspected
- **THEN** they SHALL be scoped to the interview paths (Startup or Builder)
- **AND** SHALL NOT claim to apply to the Consultation posture

### Requirement: Answer-first binds the Phase 3 and Phase 4 approval prompts

The `office-hours` "Answer before you ask" rule SHALL bind every question in the skill, including the Phase 3 Premise Challenge confirmation and the Phase 4 approach-approval prompt — not only the Startup (2A) and Builder (2B) interview questions. When the user asks a question at a Phase 3 or Phase 4 AskUserQuestion gate, the skill SHALL answer it in prose first (per the Dialogue Override) before re-issuing the gate.

#### Scenario: Answer-first covers the premise and approval gates

- **WHEN** the regenerated `office-hours` skill's Interview discipline "Answer before you ask" rule is inspected
- **THEN** it SHALL state that answering the user's question precedes advancing at every question in the skill, including the Phase 3 and Phase 4 approval prompts
- **AND** SHALL NOT read as scoped to only the Startup (2A) and Builder (2B) interview questions

### Requirement: Consistent FULL-skip evidence bar for a fully formed plan

The `office-hours` skill SHALL state a single, consistent bar for allowing a FULL skip (no additional questions) on a "fully formed plan": in Startup mode a full skip SHALL require the real-evidence bar of Phase 2A (existing users, revenue numbers, specific customer names). The Builder-mode escape hatch and the Important-Rules fully-formed-plan statement SHALL defer to that Startup real-evidence bar rather than permitting an unqualified full skip.

#### Scenario: Startup full-skip keeps the real-evidence bar

- **WHEN** the regenerated `office-hours` skill's Phase 2A, Phase 2B, and Important-Rules fully-formed-plan statements are inspected
- **THEN** the Startup path SHALL require the real-evidence bar (existing users, revenue, named customers) for a full skip
- **AND** the Builder-mode and Important-Rules statements SHALL defer to that Startup real-evidence bar rather than stating an unqualified full skip

### Requirement: Post-pause proceed-vs-stop disambiguation

The `office-hours` skill SHALL include a line disambiguating the two meanings of a "proceed" reply after a Dialogue Override pause: a reply that signals to proceed or continue ("proceed," "continue," "let's keep going") SHALL resume the next interview question where the flow paused, while only an explicit stop-asking signal ("just do it," "skip the questions," "stop asking, just write it") SHALL fire the escape hatch.

#### Scenario: Proceed resumes, stop-asking fires the escape hatch

- **WHEN** the regenerated `office-hours` skill's escape-hatch / Dialogue Override interaction is inspected
- **THEN** it SHALL state that after a Dialogue Override pause a "proceed/continue" reply resumes the next question
- **AND** SHALL state that only an explicit stop-asking signal fires the escape hatch
