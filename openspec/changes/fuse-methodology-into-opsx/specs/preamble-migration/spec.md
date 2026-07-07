## MODIFIED Requirements

### Requirement: Dangling ETHOS references removed
All textual references instructing the reader to "Read ETHOS.md" SHALL be removed from skill sources and docs, by explicit file lookup: `skills/gstack/office-hours/SKILL.md.tmpl` and `skills/gstack/docs/ARCHITECTURE.md`. Cross-references to the removed Completeness Principle (e.g. in `generateAskUserFormat`) SHALL be softened so they do not point at a deleted section.

#### Scenario: No ETHOS pointer in skill sources
- **WHEN** `skills/gstack/office-hours/SKILL.md.tmpl` and its regenerated `SKILL.md` are inspected
- **THEN** none SHALL contain the string `ETHOS.md`

#### Scenario: No ETHOS pointer in docs
- **WHEN** `skills/gstack/docs/ARCHITECTURE.md` is inspected
- **THEN** it SHALL NOT reference `ETHOS.md`

#### Scenario: No dangling Completeness Principle cross-reference
- **WHEN** the generated AskUserQuestion-format section is inspected
- **THEN** it SHALL NOT direct the reader to a "Completeness Principle" section that no longer exists
