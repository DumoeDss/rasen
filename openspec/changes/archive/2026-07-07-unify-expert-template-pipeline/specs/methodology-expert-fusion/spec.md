## MODIFIED Requirements

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
- **THEN** the returned array SHALL still include entries with `dirName` `openspec-codebase-design`, `openspec-tdd`, and `openspec-prototype`
- **AND** SHALL NOT include `openspec-domain-modeling`

### Requirement: Prototype adapts its capture path to an active change context

The `prototype` expert skill template SHALL carry change-context capture guidance (appended at the expert-getter layer to the inline instructions): when invoked while an OpenSpec change is active, the prototype verdict and the decisions it settles SHALL be captured in that change's directory — the change's `design.md` Decisions section or a change-directory sidecar resolved from `openspec status --change <name> --json` (`changeRoot`) — and the skill's standalone capture locations (ADR, `NOTES.md` beside the prototype) SHALL be described as standalone-use-only in that mode.

#### Scenario: Prototype verdict capture in a change context

- **WHEN** the installed `prototype` expert skill is inspected
- **THEN** it SHALL instruct capturing the prototype verdict into the active change's directory when an OpenSpec change context is active
- **AND** SHALL scope its standalone capture locations to non-OpenSpec use
