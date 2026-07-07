# methodology-expert-fusion — Delta

## REMOVED Requirements

### Requirement: Propose references the design and domain methodology experts

**Reason**: `domain-modeling` is removed from the roster in this change (user decision 2026-07-07: its CONTEXT.md/ADR-centric working style conflicts with the OpenSpec artifact flow). The propose consult is re-specified below for the surviving `codebase-design` only.

## ADDED Requirements

### Requirement: Propose references the design methodology expert

The `/opsx:propose` workflow template SHALL reference `/codebase-design` as a conditional, teaching-level consultation for design-dense changes (a new module or a non-trivial interface), without inlining its skill body. The reference SHALL instruct that resulting interface/design decisions are captured in the change directory (the change's `design.md` Decisions section or a change-directory sidecar), not in gstack-native paths.

#### Scenario: Propose template names the design methodology expert

- **WHEN** the generated `/opsx:propose` skill and command templates are inspected
- **THEN** each SHALL reference `/codebase-design` as a conditional consultation for design-dense changes
- **AND** SHALL NOT reference `/domain-modeling`
- **AND** SHALL NOT contain an inlined copy of the expert's body

#### Scenario: Design decisions captured in the change directory

- **WHEN** the propose template describes where methodology decisions are recorded
- **THEN** it SHALL direct them to the change directory (`design.md` Decisions or a change-directory sidecar)

### Requirement: Prototype adapts its capture path to an active change context

The `prototype` expert skill template SHALL carry change-context capture guidance (appended at the expert-getter layer, leaving the generated SKILL.md source untouched): when invoked while an OpenSpec change is active, the prototype verdict and the decisions it settles SHALL be captured in that change's directory — the change's `design.md` Decisions section or a change-directory sidecar resolved from `openspec status --change <name> --json` (`changeRoot`) — and the skill's standalone capture locations (ADR, `NOTES.md` beside the prototype) SHALL be described as standalone-use-only in that mode.

#### Scenario: Prototype verdict capture in a change context

- **WHEN** the installed `prototype` expert skill is inspected
- **THEN** it SHALL instruct capturing the prototype verdict into the active change's directory when an OpenSpec change context is active
- **AND** SHALL scope its standalone capture locations to non-OpenSpec use

## MODIFIED Requirements

### Requirement: Explore references the prototype discipline

The `/opsx:explore` workflow template SHALL reference `/prototype` as the way to settle a design question that only building can answer, SHALL instruct capturing the answer in the change directory and deleting the throwaway code, and its "Don't implement" guardrail SHALL carry an explicit exception for the throwaway `/prototype` probe so the template does not contradict itself.

#### Scenario: Explore template names prototype

- **WHEN** the generated `/opsx:explore` skill and command templates are inspected
- **THEN** each SHALL reference `/prototype` for settling a stuck design question
- **AND** SHALL instruct capturing the answer in the change directory and deleting the throwaway code

#### Scenario: Explore guardrail carve-out stays consistent with the prototype reference

- **WHEN** the Guardrails section of the generated `/opsx:explore` skill and command templates is inspected
- **THEN** the "Don't implement" guardrail SHALL name the throwaway `/prototype` probe as its only exception
- **AND** SHALL require the probe's code to be deleted once the answer is captured

### Requirement: Fused experts remain standalone-invokable

The surviving methodology experts SHALL remain registered and standalone-invokable after the fusion; the fusion adds workflow references only and SHALL NOT de-register `codebase-design`, `tdd`, or `prototype`.

#### Scenario: Methodology experts still registered

- **WHEN** `getSkillTemplates()` is called without a workflow filter
- **THEN** the returned array SHALL still include entries with `dirName` `openspec-gstack-codebase-design`, `openspec-gstack-tdd`, and `openspec-gstack-prototype`
- **AND** SHALL NOT include `openspec-gstack-domain-modeling`
