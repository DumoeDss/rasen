## ADDED Requirements

### Requirement: codebase-design allowed-tools scoped to advisory actions
The `codebase-design` skill's `allowed-tools` SHALL be narrowed to the tools its body actually uses. Its body is advisory (reads and reasons about interfaces; sub-agent spawning for DESIGN-IT-TWICE is not gated by allowed-tools) and performs no file writes or shell commands, so `allowed-tools` SHALL be `Read, Grep, Glob, AskUserQuestion` (dropping Write, Edit, Bash).

#### Scenario: codebase-design tools narrowed
- **WHEN** `skills/gstack/codebase-design/SKILL.md.tmpl` frontmatter is inspected
- **THEN** `allowed-tools` SHALL list `Read`, `Grep`, `Glob`, `AskUserQuestion`
- **AND** SHALL NOT list `Write`, `Edit`, or `Bash`

### Requirement: domain-modeling allowed-tools scoped to its write actions
The `domain-modeling` skill's `allowed-tools` SHALL be narrowed to match its body: it creates and updates `CONTEXT.md` and `docs/adr/*` (needs Write, Edit) and cross-references code (needs Read, Grep, Glob) and challenges terms (AskUserQuestion), but runs no shell commands, so `allowed-tools` SHALL be `Read, Write, Edit, Grep, Glob, AskUserQuestion` (dropping Bash).

#### Scenario: domain-modeling tools narrowed
- **WHEN** `skills/gstack/domain-modeling/SKILL.md.tmpl` frontmatter is inspected
- **THEN** `allowed-tools` SHALL list `Read`, `Write`, `Edit`, `Grep`, `Glob`, `AskUserQuestion`
- **AND** SHALL NOT list `Bash`

#### Scenario: Tightening does not change registration or count
- **WHEN** the two skills are regenerated
- **THEN** their expert registrations and all skill counts SHALL be unchanged
