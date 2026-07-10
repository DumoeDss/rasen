# office-hours-fork-first Specification

## Purpose
Defines the fork-first behavior of the `office-hours` consultation skill: sessions route to a product (Diagnosis or Design) by the object of the user's request rather than the user's stated identity, with direct routing on unambiguous openings and mid-session product changes in either direction.

## Requirements
### Requirement: Product routing by request object

At the end of Phase 1, the `office-hours` skill SHALL determine which product the session is for using the object of the user's request as the sole discriminator, not the user's stated identity: a request to validate the venture itself (e.g. "should I build this," "validate demand") SHALL route to the Diagnosis product; a request for feedback on or convergence of a design or plan (e.g. "what do you think," "poke holes in this") SHALL route to the Design product, even when the requester is a startup founder. When the opening message unambiguously signals one product, the skill SHALL route directly without asking the Phase 1 goal question. When ambiguous, the skill SHALL ask the existing goal question and map the answer to a product (not to a named mode). The routed product MAY change mid-session in either direction when the user's request object changes (e.g. a Design-product session where the user asks "should I even build this" upgrades to the Diagnosis product; a Diagnosis-product session where the user brings a concrete plan and asks for feedback downgrades to the Design product).

#### Scenario: Venture-validation request routes to Diagnosis product

- **WHEN** the user's opening message asks whether to build something, or asks to validate demand for a venture
- **THEN** the skill SHALL route to the Diagnosis product without asking the goal question

#### Scenario: Design-feedback request routes to Design product regardless of identity

- **WHEN** a self-identified startup founder opens with a concrete design or plan and a feedback request ("what do you think," "poke holes in this")
- **THEN** the skill SHALL route to the Design product
- **AND** SHALL NOT route to the Diagnosis product on the basis of the user's founder identity alone

#### Scenario: Mid-session product upgrade

- **WHEN** a Design-product session's user states or implies they want to validate whether the venture itself should be built
- **THEN** the skill SHALL upgrade the session to the Diagnosis product

#### Scenario: Mid-session product downgrade

- **WHEN** a Diagnosis-product session's user brings a concrete design and asks for feedback on it rather than venture validation
- **THEN** the skill SHALL route the session to the Design product

#### Scenario: Startup-context demand premise is recovered by the fork scan, not by identity-based routing

- **WHEN** a startup user brings a concrete design and asks for feedback, routing the session to the Design product
- **THEN** the fork-scan procedure SHALL surface the demand premise (whether real demand for the underlying venture exists) as a load-bearing fork in the startup context
- **AND** the discriminator that sent the session to the Design product SHALL remain the object of the request, not the user's identity

### Requirement: Fork-scan procedure precedes any stance in the Design product

For each topic in the Design product, before delivering any stance or recommendation, the skill SHALL run a fork-scan procedure: (1) list the premises a stance on this topic would depend on, limited to premises the recommendation actually rests on; (2) for each listed premise, test branch-writability — whether a materially different downstream design follows from each possible answer; (3) classify each premise into exactly one of: **weight-bearing fork** (branch-writable and unverified — ask it), **declared assumption** (not branch-writable, or no answer changes the conclusion — state it in the analysis along with what would flip it), or **already verified** (evidence exists in-session or in the codebase — cite it, do not ask); (4) ask at most 2 weight-bearing forks per round, one at a time, each carrying the skill's own recommended answer; any remaining weight-bearing forks fold into the analysis as open questions.

#### Scenario: Concrete design with an unverified load-bearing premise gets asked first

- **WHEN** the Design product receives an opening with a concrete, specific design whose recommendation rests on at least one unverified, branch-writable premise
- **THEN** the skill's first action SHALL be to ask that weight-bearing fork, carrying a recommended answer
- **AND** the skill SHALL NOT deliver a complete stance before the fork is asked

#### Scenario: Fully verified premises produce zero questions

- **WHEN** the Design product receives an opening where every premise the recommendation depends on is already verified (in-session or in-codebase evidence)
- **THEN** the skill SHALL ask zero questions and deliver the analysis directly

#### Scenario: Fully vague opening produces fork-emergent questions at the per-round cap

- **WHEN** the Design product receives an opening with no concrete design (the design goal itself is the largest fork)
- **THEN** questions SHALL emerge from the fork scan applied to the design goal
- **AND** no round SHALL ask more than 2 weight-bearing forks

#### Scenario: Non-forking premises appear as declared assumptions, not questions

- **WHEN** a premise fails the branch-writability test (no answer to it changes the downstream design)
- **THEN** the skill SHALL NOT ask about it
- **AND** SHALL instead state it in the analysis as a declared assumption, together with what evidence would flip it

#### Scenario: Landscape awareness feeds the fork scan

- **WHEN** Phase 2.75 (Landscape Awareness) search results are available for the current topic
- **THEN** the fork-scan procedure SHALL run after landscape awareness and SHALL be able to draw on those results when listing or classifying premises

### Requirement: Explicit skip downgrades open forks to declared assumptions

In the Design product, when the user gives an explicit skip signal, the skill SHALL downgrade every still-open weight-bearing fork to a declared, headline assumption in the analysis and SHALL deliver the analysis immediately. Each downgraded assumption SHALL remain individually reopenable: the user may later contest any one of them, which reopens only that fork. A request for discussion is NOT a skip signal and SHALL NOT trigger this downgrade.

#### Scenario: Explicit skip signal downgrades pending forks

- **WHEN** the user gives an explicit skip signal in the Design product with weight-bearing forks still open
- **THEN** the skill SHALL convert each open fork into a headline declared assumption in the delivered analysis
- **AND** SHALL deliver the analysis in the same turn without asking further questions

#### Scenario: Discussion request is not a skip signal

- **WHEN** the user asks a question or requests more discussion in the Design product
- **THEN** the skill SHALL NOT treat this as a skip signal
- **AND** SHALL route it to the Dialogue Override behavior instead

#### Scenario: A downgraded assumption can be reopened

- **WHEN** the user later contests a declared assumption that was downgraded from a skipped fork
- **THEN** the skill SHALL reopen that specific fork
- **AND** SHALL NOT reopen other declared assumptions that the user did not contest

### Requirement: Single Design-product doc template with goal-conditional evaluation block

The Design product SHALL write design documents from a single template whose evaluation-framework section renders conditionally on the user's stated goal: a startup-context session SHALL render a Demand Evidence section and a The Assignment section; a builder-context session SHALL render a What Makes This Cool section and a Next Steps section. The remaining document skeleton (Problem Statement, Premises, Approaches Considered, Recommended Approach, Open Questions, Success Criteria, Supersedes lineage) SHALL be shared across both renderings. The Diagnosis product SHALL continue using its existing Startup design-doc template unchanged.

#### Scenario: Startup-context Design-product session renders demand framing

- **WHEN** a Design-product session with a startup-context goal reaches doc writing
- **THEN** the written doc SHALL include a Demand Evidence section and a The Assignment section
- **AND** SHALL NOT include a What Makes This Cool or Next Steps section

#### Scenario: Builder-context Design-product session renders delight framing

- **WHEN** a Design-product session with a builder-context goal reaches doc writing
- **THEN** the written doc SHALL include a What Makes This Cool section and a Next Steps section
- **AND** SHALL NOT include a Demand Evidence or The Assignment section

#### Scenario: Diagnosis product template is untouched

- **WHEN** the Diagnosis product reaches doc writing
- **THEN** it SHALL use the existing Startup design-doc template
- **AND** that template's sections SHALL be unchanged by this capability

### Requirement: Diagnosis product's six-question script and closing are unaffected

The Diagnosis product SHALL preserve, unchanged in behavior, the six forcing questions, product-stage smart routing, its escape hatch, the anti-sycophancy rules, the pushback patterns, Phase 4.5 founder-signal synthesis, and the Phase 6 three-beat close. After the six questions, the Diagnosis product SHALL proceed through the same fork-scan mechanism used by the Design product for premise-checking and alternatives generation before writing its design doc.

#### Scenario: Six-question script runs unmodified

- **WHEN** a session routes to the Diagnosis product
- **THEN** the six forcing questions, their smart routing by product stage, and their escape hatch SHALL behave exactly as before this change

#### Scenario: Founder close is preserved

- **WHEN** a Diagnosis-product session's design doc is approved
- **THEN** the skill SHALL run Phase 4.5 founder-signal synthesis and the Phase 6 three-beat close exactly as before this change

#### Scenario: Diagnosis product uses the shared fork-scan mechanism after its six questions

- **WHEN** a Diagnosis-product session has completed its six-question script
- **THEN** premise-checking and alternatives generation for that session SHALL run through the same fork-scan procedure used by the Design product
- **AND** the skill SHALL NOT run a separate, Diagnosis-product-private premise-challenge or alternatives-generation pass

### Requirement: No residual named-path references

Neither `src/core/templates/experts/office-hours.ts` nor `src/core/templates/workflows/office-hours.ts` SHALL contain a guard clause, precedence rule, phase header, or path qualifier that references "Startup mode," "Builder mode," or "Consultation" as a named routing path. This includes interview-path carve-outs, "Consultation replaces Phases 2–4" precedence language, and Phase 4.5/6 path qualifiers.

#### Scenario: Expert template has no dangling named-path references

- **WHEN** `src/core/templates/experts/office-hours.ts` is inspected after this change
- **THEN** it SHALL NOT contain any guard clause or precedence statement scoped to "Startup mode," "Builder mode," or "Consultation" as named routing paths

#### Scenario: Command template has no dangling named-path references

- **WHEN** `src/core/templates/workflows/office-hours.ts` is inspected after this change
- **THEN** its Step 1 mode routing, file header, and fallback pre-brief SHALL NOT reference "Startup mode" or "Builder mode" as named routing paths, and SHALL instead describe product routing

