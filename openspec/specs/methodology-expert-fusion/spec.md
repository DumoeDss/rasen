# methodology-expert-fusion Specification

## Purpose
Fuses the four methodology experts (`codebase-design`, `domain-modeling`, `tdd`, `prototype`) into the OPSX workflow templates (propose, apply, explore) as conditional, teaching-level references — with their artifacts captured in the change directory rather than gstack-native paths — and removes dangling `enhance` hooks and doc references to the plan-review skills deleted in an earlier change.
## Requirements
### Requirement: Propose references the design and domain methodology experts
The `/opsx:propose` workflow template SHALL reference `/codebase-design` and `/domain-modeling` as conditional, teaching-level consultations for design-dense or domain-heavy changes, without inlining their skill bodies. The reference SHALL instruct that resulting interface/design and domain decisions are captured in the change directory (the change's `design.md` Decisions section or a change-directory sidecar), not in gstack-native paths.

#### Scenario: Propose template names the design methodology experts
- **WHEN** the generated `/opsx:propose` skill and command templates are inspected
- **THEN** each SHALL reference `/codebase-design` and `/domain-modeling` as a conditional consultation for design-dense or domain-heavy changes
- **AND** SHALL NOT contain an inlined copy of either expert's body

#### Scenario: Design decisions captured in the change directory
- **WHEN** the propose template describes where methodology decisions are recorded
- **THEN** it SHALL direct them to the change directory (`design.md` Decisions or a change-directory sidecar), not to `CONTEXT.md` or `docs/adr/` at the repository root

### Requirement: Apply references the TDD and careful disciplines
The `/opsx:apply` workflow template SHALL mention `/tdd` as an optional test-first implementation discipline and `/careful` for changes touching destructive operations, as conditional references without inlining their bodies.

#### Scenario: Apply template names the implementation disciplines
- **WHEN** the generated `/opsx:apply` skill and command templates are inspected
- **THEN** each SHALL reference `/tdd` as an implementation option and `/careful` for destructive-operation-heavy work
- **AND** SHALL NOT contain an inlined copy of either expert's body

### Requirement: Explore references the prototype discipline
The `/opsx:explore` workflow template SHALL mention `/prototype` as a hands-on way to settle a stuck design question, instructing that the prototype's answer is captured in the change directory and the throwaway code is deleted afterward.

#### Scenario: Explore template names prototype
- **WHEN** the generated `/opsx:explore` skill and command templates are inspected
- **THEN** each SHALL reference `/prototype` for settling a stuck design question
- **AND** SHALL instruct capturing the answer in the change directory and deleting the throwaway code

### Requirement: Spec-driven enhance hooks reference only existing skills
The `enhance` hooks in `schemas/spec-driven/schema.yaml` SHALL NOT reference any removed skill. Every `enhance` value present SHALL name a skill that exists in the installed roster.

#### Scenario: No enhance hook points at a removed skill
- **WHEN** `schemas/spec-driven/schema.yaml` is inspected
- **THEN** no artifact's `enhance` field SHALL be `plan-ceo-review`, `plan-design-review`, or `plan-eng-review`
- **AND** any remaining `enhance` value SHALL name a skill present in `getSkillTemplates()`

#### Scenario: Instructions never point at a removed skill
- **WHEN** `openspec instructions <artifact> --change <name> --json` is run for the spec-driven schema's artifacts
- **THEN** no emitted `enhance` section SHALL name a removed skill

### Requirement: No live references to removed plan-review skills
No live surface — workflow templates, generated skills, the doc generator, or docs — SHALL retain a reference to the removed `plan-ceo-review`, `plan-eng-review`, or `plan-design-review` skills. Historical archives under `openspec/changes/archive/` are exempt.

#### Scenario: Generated codex skill drops the dead plan-review report bullets
- **WHEN** the regenerated `skills/gstack/codex/SKILL.md` is inspected
- **THEN** it SHALL NOT reference `plan-ceo-review`, `plan-eng-review`, or `plan-design-review`

#### Scenario: Generator and docs are clean
- **WHEN** `scripts/gen-skill-docs.ts` and `skills/gstack/docs/ARCHITECTURE.md` are inspected
- **THEN** neither SHALL reference the removed plan-review skills as live consumers or examples

#### Scenario: Generated docs remain fresh
- **WHEN** `bun run gen:skill-docs` and `bun run skill:check` are run after the edits
- **THEN** the freshness check SHALL pass with no stale or missing generated files

### Requirement: Fused experts remain standalone-invokable
The four methodology experts SHALL remain registered and standalone-invokable after the fusion; the fusion adds workflow references only and SHALL NOT de-register any expert.

#### Scenario: Methodology experts still registered
- **WHEN** `getSkillTemplates()` is called without a workflow filter
- **THEN** the returned array SHALL still include entries with `dirName` `openspec-gstack-codebase-design`, `openspec-gstack-domain-modeling`, `openspec-gstack-tdd`, and `openspec-gstack-prototype`

