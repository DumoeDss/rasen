# methodology-expert-fusion Specification

## Purpose
Fuses the three methodology experts (`codebase-design`, `tdd`, `prototype`) into the Rasen workflow templates (propose, apply, explore) as conditional, teaching-level references — with their artifacts captured in the change directory rather than skill-native paths — and removes dangling `enhance` hooks and doc references to the plan-review skills deleted in an earlier change.
## Requirements
### Requirement: Apply references the TDD and careful disciplines

The `rasen-apply-change` workflow template SHALL name its bundled TDD entry reference as an optional test-first implementation discipline and the independent `rasen-careful` skill for changes touching destructive operations. The TDD body SHALL be loaded only when test-first work is selected, while careful remains a conditional expert consultation. The workflow SHALL not inline either substantive body into its router instructions.

#### Scenario: Apply template names the implementation disciplines

- **WHEN** the generated `rasen-apply-change` skill is used for test-first work
- **THEN** it SHALL direct the agent to read its bundled TDD entry reference before implementation
- **AND** it SHALL continue to name `rasen-careful` for destructive-operation-heavy work
- **AND** its router body SHALL NOT contain an inlined copy of either discipline

### Requirement: Explore references the prototype discipline

The `rasen-explore` workflow template SHALL name its bundled prototype entry reference as the way to settle a design question that only building can answer. It SHALL load that reference only for a bounded prototype branch, instruct capturing the answer in the change directory and deleting the throwaway code, and keep its "Don't implement" guardrail consistent with that exception.

#### Scenario: Explore template names prototype

- **WHEN** a design question is stuck and running code is selected as the bounded way to settle it
- **THEN** the generated `rasen-explore` skill SHALL direct the agent to read its bundled prototype entry reference
- **AND** SHALL instruct capturing the answer in the change directory and deleting the throwaway code

#### Scenario: Explore guardrail carve-out stays consistent with the prototype reference

- **WHEN** the Guardrails section of the generated `rasen-explore` skill is inspected
- **THEN** the "Don't implement" guardrail SHALL name the throwaway prototype-reference branch as its only exception
- **AND** SHALL require the probe's code to be deleted once the answer is captured

### Requirement: Spec-driven enhance hooks reference only existing skills
The `enhance` hooks in `schemas/spec-driven/schema.yaml` SHALL NOT reference any removed skill. Every `enhance` value present SHALL name a skill that exists in the installed roster.

#### Scenario: No enhance hook points at a removed skill
- **WHEN** `schemas/spec-driven/schema.yaml` is inspected
- **THEN** no artifact's `enhance` field SHALL be `plan-ceo-review`, `plan-design-review`, or `plan-eng-review`
- **AND** any remaining `enhance` value SHALL name a skill present in `getSkillTemplates()`

#### Scenario: Instructions never point at a removed skill
- **WHEN** `rasen instructions <artifact> --change <name> --json` is run for the spec-driven schema's artifacts
- **THEN** no emitted `enhance` section SHALL name a removed skill

### Requirement: No live references to removed plan-review skills

No live surface — workflow templates, expert templates, generated/installed skills, or docs — SHALL retain a reference to the removed `plan-ceo-review`, `plan-eng-review`, or `plan-design-review` skills. Historical archives under `openspec/changes/archive/` are exempt.

#### Scenario: Installed codex skill drops the dead plan-review report bullets

- **WHEN** the `codex` expert template `src/core/templates/experts/codex.ts` and the installed `codex` `SKILL.md` are inspected
- **THEN** neither SHALL reference `plan-ceo-review`, `plan-eng-review`, or `plan-design-review`

#### Scenario: Templates and docs are clean

- **WHEN** the expert templates under `src/core/templates/experts/` and `skills/experts/docs/ARCHITECTURE.md` are inspected
- **THEN** none SHALL reference the removed plan-review skills as live consumers or examples

#### Scenario: Freshness gate stays green

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is run after the edits
- **THEN** the golden-master parity check SHALL pass with no drift

### Requirement: Propose references the design methodology expert

The `rasen-propose` workflow template SHALL name its bundled codebase-design entry reference as a conditional, teaching-level consultation for design-dense changes such as a new module or non-trivial interface. It SHALL load that reference only when the condition applies and SHALL direct resulting interface/design decisions to the change directory (`design.md` Decisions or a change-directory sidecar), not to an expert-native report path.

#### Scenario: Propose template names the design methodology expert

- **WHEN** `rasen-propose` handles a design-dense change
- **THEN** it SHALL direct the planner to read its bundled codebase-design entry reference
- **AND** SHALL NOT reference a standalone `rasen-codebase-design` or `/domain-modeling` skill
- **AND** SHALL NOT contain an inlined copy of the methodology body

#### Scenario: Design decisions captured in the change directory

- **WHEN** the propose template describes where methodology decisions are recorded
- **THEN** it SHALL direct them to the change directory (`design.md` Decisions or a change-directory sidecar)

### Requirement: Prototype adapts its capture path to an active change context

The bundled prototype reference SHALL carry change-context capture guidance: when `rasen-explore` runs for an active Rasen change, the prototype verdict and settled decisions SHALL be captured in that change's directory, using `design.md` Decisions or a change-directory sidecar resolved from `rasen status --change <name> --json` (`changeRoot`). Standalone capture locations inherited from the adapted source SHALL be identified as non-Rasen guidance and SHALL NOT override the active change path.

#### Scenario: Prototype verdict capture in a change context

- **WHEN** the installed `rasen-explore` prototype reference is used for an active change
- **THEN** it SHALL instruct capturing the verdict into that active change's directory
- **AND** SHALL scope standalone capture locations to non-Rasen use

