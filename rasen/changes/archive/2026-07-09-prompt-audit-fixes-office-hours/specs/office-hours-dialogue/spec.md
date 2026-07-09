# office-hours-dialogue delta

## ADDED Requirements

### Requirement: Consultation posture takes precedence and replaces Phases 2–4

The `office-hours` skill SHALL state that the Consultation posture is authoritative for its whole session and replaces Phases 2, 3, and 4. The skill SHALL state the precedence explicitly: the `Phase 4: Alternatives Generation (MANDATORY)` header and the three "fully formed plan still runs Phase 3 (Premise Challenge) and Phase 4 (Alternatives)" rules (in Phase 2A, Phase 2B, and Important Rules) apply ONLY to the interview paths (Startup mode and Builder mode), NOT to the Consultation posture. An opening message combining a concrete design/plan with a feedback request SHALL therefore route deterministically into Consultation and SHALL NOT trigger Phase 3 Premise Challenge or the Phase 4 alternatives-and-approval machinery.

#### Scenario: Consultation posture states it replaces Phases 2–4

- **WHEN** the regenerated `office-hours` skill's Consultation posture is inspected
- **THEN** it SHALL state that the posture replaces Phases 2, 3, and 4 for the session
- **AND** SHALL state that the `Phase 4 (MANDATORY)` and "fully formed plan still runs Phase 3 + Phase 4" rules apply only to the interview paths (Startup/Builder), not to Consultation

#### Scenario: Interview-path rules are scoped away from Consultation

- **WHEN** the regenerated `office-hours` skill's Phase 4 header and the three fully-formed-plan rules (Phase 2A, Phase 2B, Important Rules) are inspected
- **THEN** each SHALL be scoped to the interview paths (Startup/Builder)
- **AND** SHALL point to the Consultation posture as the route that replaces Phases 2–4 for a concrete-design-plus-feedback opening

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
