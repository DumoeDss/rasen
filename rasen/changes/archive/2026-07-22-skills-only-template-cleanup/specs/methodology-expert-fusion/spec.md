## MODIFIED Requirements

### Requirement: Apply references the TDD and careful disciplines
The `rasen-apply-change` workflow template SHALL mention the `rasen-tdd` skill as an optional test-first implementation discipline and the `rasen-careful` skill for changes touching destructive operations, as conditional references without inlining their bodies. References SHALL name the canonical skill, not a bare-slash or `/rasen:*` colon command.

#### Scenario: Apply template names the implementation disciplines
- **WHEN** the generated `rasen-apply-change` skill template is inspected
- **THEN** it SHALL reference the `rasen-tdd` skill as an implementation option and the `rasen-careful` skill for destructive-operation-heavy work
- **AND** SHALL NOT contain an inlined copy of either expert's body

### Requirement: Explore references the prototype discipline

The `rasen-explore` workflow template SHALL reference the `rasen-prototype` skill as the way to settle a design question that only building can answer, SHALL instruct capturing the answer in the change directory and deleting the throwaway code, and its "Don't implement" guardrail SHALL carry an explicit exception for the throwaway prototype probe so the template does not contradict itself.

#### Scenario: Explore template names prototype

- **WHEN** the generated `rasen-explore` skill template is inspected
- **THEN** it SHALL reference the `rasen-prototype` skill for settling a stuck design question
- **AND** SHALL instruct capturing the answer in the change directory and deleting the throwaway code

#### Scenario: Explore guardrail carve-out stays consistent with the prototype reference

- **WHEN** the Guardrails section of the generated `rasen-explore` skill template is inspected
- **THEN** the "Don't implement" guardrail SHALL name the throwaway `rasen-prototype` probe as its only exception
- **AND** SHALL require the probe's code to be deleted once the answer is captured

### Requirement: Propose references the design methodology expert

The `rasen-propose` workflow template SHALL reference the `rasen-codebase-design` skill as a conditional, teaching-level consultation for design-dense changes (a new module or a non-trivial interface), without inlining its skill body. The reference SHALL instruct that resulting interface/design decisions are captured in the change directory (the change's `design.md` Decisions section or a change-directory sidecar), not in expert-skill-native report paths.

#### Scenario: Propose template names the design methodology expert

- **WHEN** the generated `rasen-propose` skill template is inspected
- **THEN** it SHALL reference the `rasen-codebase-design` skill as a conditional consultation for design-dense changes
- **AND** SHALL NOT reference `/domain-modeling`
- **AND** SHALL NOT contain an inlined copy of the expert's body

#### Scenario: Design decisions captured in the change directory

- **WHEN** the propose template describes where methodology decisions are recorded
- **THEN** it SHALL direct them to the change directory (`design.md` Decisions or a change-directory sidecar)
