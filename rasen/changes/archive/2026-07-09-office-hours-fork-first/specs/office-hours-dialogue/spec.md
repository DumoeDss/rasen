## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Consultation posture for concrete-design arrivals
**Reason**: "Consultation" is deleted as a named posture. Its unconditional "skip generative questioning on a concrete-design-plus-feedback opening" behavior is inverted, not renamed: the Design product only skips straight to stance when the fork-scan finds zero weight-bearing forks (Success Criterion 2 of the approved design), and asks first when a load-bearing premise is unverified (Success Criterion 1) — the exact defect this change exists to fix.
**Migration**: See `office-hours-fork-first`'s "Fork-scan procedure precedes any stance in the Design product" requirement, which governs when the Design product asks versus delivers stance directly.

### Requirement: Consultation posture takes precedence and replaces Phases 2-4
**Reason**: Phase 3 (Premise Challenge) and Phase 4 (Alternatives Generation) are deleted as standalone legislation everywhere in the template, not scoped away from one named posture. With no competing named path left, there is no precedence rule left to state — product routing (Diagnosis vs Design) is the only top-level branch, decided once per topic/session rather than by posture precedence.
**Migration**: See `office-hours-fork-first`'s "Product routing by request object" requirement (the routing axis) and "Fork-scan procedure precedes any stance in the Design product" requirement (what replaces Phases 3-4).

### Requirement: Consultation posture has an explicit terminal that skips the founder close
**Reason**: "Consultation" is deleted as a named posture, and its terminal's scenario titles are being renamed from Consultation-scoped names ("Consultation terminal is plain and skips Phase 4.5/6," "Founder close scoped to interview paths") to Design-product-scoped names ("Design-product terminal is plain and skips Phase 4.5/6," "Founder close scoped to the Diagnosis product") to remove the last "Consultation"/"interview paths" naming from the synced main spec. The underlying behavior (plain summary + `/rasen:propose` pointer terminal, skipping Phase 4.5/6) is carried forward unchanged.
**Migration**: See the "Design product has an explicit terminal that skips the founder close" requirement (ADDED above), which restates this requirement's behavior under the new product naming.

### Requirement: Answer-first binds the Phase 3 and Phase 4 approval prompts
**Reason**: Phase 3 and Phase 4 are deleted as standalone phase headers, and this requirement's scenario title ("Answer-first covers the premise and approval gates") is being renamed to match the fork-scan mechanism that replaces them ("Answer-first covers the fork-scan and approval gates"), removing the last "Phase 3"/"Phase 4" naming from the synced main spec. The underlying behavior (answer-before-you-ask binds every question and approval gate in the skill) is carried forward unchanged.
**Migration**: See the "Answer-first binds every approval and fork question" requirement (ADDED above), which restates this requirement's behavior under the new fork-scan naming.

### Requirement: Consistent FULL-skip evidence bar for a fully formed plan
**Reason**: The Startup-vs-Builder "fully formed plan" full-skip special case is superseded by the fork-scan's structural branch-writability test: a fully formed, fully verified plan now produces zero questions because every premise classifies as already-verified, not because of a bolted-on "fully formed plan" exception. The startup-context demand-evidence bar is preserved structurally — demand is always a load-bearing, branch-writable premise in a startup context, so the fork scan surfaces it whenever it is unverified.
**Migration**: See `office-hours-fork-first`'s "Fork-scan procedure precedes any stance in the Design product" requirement (zero-question scenario) and "Product routing by request object" requirement (the startup-context demand-premise-recovery scenario), and the Diagnosis product's own fork-scan handoff in "Diagnosis product's six-question script and closing are unaffected."
