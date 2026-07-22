# methodology-expert-fusion Specification

## Purpose
Fuses the three methodology experts (`codebase-design`, `tdd`, `prototype`) into the Rasen workflow templates (propose, apply, explore) as conditional, teaching-level references — with their artifacts captured in the change directory rather than skill-native paths — and removes dangling `enhance` hooks and doc references to the plan-review skills deleted in an earlier change.
## Requirements
### Requirement: Apply references the TDD and careful disciplines
The `/rasen:apply` workflow template SHALL mention `/tdd` as an optional test-first implementation discipline and `/careful` for changes touching destructive operations, as conditional references without inlining their bodies.

#### Scenario: Apply template names the implementation disciplines
- **WHEN** the generated `/rasen:apply` skill template is inspected
- **THEN** it SHALL reference `/tdd` as an implementation option and `/careful` for destructive-operation-heavy work
- **AND** SHALL NOT contain an inlined copy of either expert's body

### Requirement: Explore references the prototype discipline

The `/rasen:explore` workflow template SHALL reference `/prototype` as the way to settle a design question that only building can answer, SHALL instruct capturing the answer in the change directory and deleting the throwaway code, and its "Don't implement" guardrail SHALL carry an explicit exception for the throwaway `/prototype` probe so the template does not contradict itself.

#### Scenario: Explore template names prototype

- **WHEN** the generated `/rasen:explore` skill template is inspected
- **THEN** it SHALL reference `/prototype` for settling a stuck design question
- **AND** SHALL instruct capturing the answer in the change directory and deleting the throwaway code

#### Scenario: Explore guardrail carve-out stays consistent with the prototype reference

- **WHEN** the Guardrails section of the generated `/rasen:explore` skill template is inspected
- **THEN** the "Don't implement" guardrail SHALL name the throwaway `/prototype` probe as its only exception
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

### Requirement: Fused experts remain standalone-invokable

The surviving methodology experts SHALL remain registered and standalone-invokable after the fusion; the fusion adds workflow references only and SHALL NOT de-register `codebase-design`, `tdd`, or `prototype`.

#### Scenario: Methodology experts still registered

- **WHEN** `getSkillTemplates()` is called without a workflow filter
- **THEN** the returned array SHALL still include entries with `dirName` `rasen-codebase-design`, `rasen-tdd`, and `rasen-prototype`
- **AND** SHALL NOT include `openspec-domain-modeling`

### Requirement: Propose references the design methodology expert

The `/rasen:propose` workflow template SHALL reference `/codebase-design` as a conditional, teaching-level consultation for design-dense changes (a new module or a non-trivial interface), without inlining its skill body. The reference SHALL instruct that resulting interface/design decisions are captured in the change directory (the change's `design.md` Decisions section or a change-directory sidecar), not in expert-skill-native report paths.

#### Scenario: Propose template names the design methodology expert

- **WHEN** the generated `/rasen:propose` skill template is inspected
- **THEN** it SHALL reference `/codebase-design` as a conditional consultation for design-dense changes
- **AND** SHALL NOT reference `/domain-modeling`
- **AND** SHALL NOT contain an inlined copy of the expert's body

#### Scenario: Design decisions captured in the change directory

- **WHEN** the propose template describes where methodology decisions are recorded
- **THEN** it SHALL direct them to the change directory (`design.md` Decisions or a change-directory sidecar)

### Requirement: Prototype adapts its capture path to an active change context

The `prototype` expert skill template SHALL carry change-context capture guidance (appended at the expert-getter layer to the inline instructions): when invoked while a Rasen change is active, the prototype verdict and the decisions it settles SHALL be captured in that change's directory — the change's `design.md` Decisions section or a change-directory sidecar resolved from `rasen status --change <name> --json` (`changeRoot`) — and the skill's standalone capture locations (ADR, `NOTES.md` beside the prototype) SHALL be described as standalone-use-only in that mode.

#### Scenario: Prototype verdict capture in a change context

- **WHEN** the installed `prototype` expert skill is inspected
- **THEN** it SHALL instruct capturing the prototype verdict into the active change's directory when a Rasen change context is active
- **AND** SHALL scope its standalone capture locations to non-Rasen use

