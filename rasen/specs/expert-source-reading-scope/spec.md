# expert-source-reading-scope Specification

## Purpose
The "Never read source code" absolutes in `QA_METHODOLOGY` and `DESIGN_METHODOLOGY` are scoped to the exploration/testing (audit) phase, with explicit carve-outs for diff-aware triage and the standalone fix loop, so the rule cannot be read as blocking the legitimate reads those flows already require.
## Requirements
### Requirement: QA "Never read source code" scoped to exploration, with diff-triage and fix-loop carve-outs

The `QA_METHODOLOGY` shared block SHALL scope its "Never read source code" absolute to the exploration/testing phase. It SHALL state that findings are formed from user-visible/runtime evidence and explicitly permit reading source for diff-aware triage that maps changed files to routes/pages. It SHALL additionally permit source reading in the default standalone fix loop, while making clear that dispatched and explicit report-only/non-UI modes have no fix loop and may read source only for bounded diff-aware triage.

#### Scenario: QA never-read-source rule carries explicit carve-outs

- **WHEN** the generated `rasen-qa` skill is inspected
- **THEN** the "Never read source code" rule SHALL be scoped to the exploration/testing phase
- **AND** SHALL permit source reading for diff-aware triage that maps changed files to affected routes/pages
- **AND** SHALL permit source reading for the default standalone fix loop
- **AND** SHALL state that report-only modes do not gain a source-editing or fix-loop exception
- **AND** no generated `rasen-qa-only` skill SHALL be required to express this behavior

### Requirement: Design "Never read source code" scoped to the audit phase, with diff-triage and fix-loop carve-outs

The `DESIGN_METHODOLOGY` shared block (`src/core/templates/experts/_shared.ts`) SHALL extend its "Never read source code" absolute (Important Rules #4) so its exception covers, in addition to writing DESIGN.md: (b) reading changed files to map them to affected pages in diff-aware mode; and (c) the standalone fix loop (design-review Phase 8), which reads source to make the minimal fix. It SHALL state that the rule governs the audit phase — do not form design findings by reading code instead of evaluating the rendered site.

#### Scenario: Design never-read-source rule carries diff and fix-loop carve-outs

- **WHEN** the generated `design-review` `SKILL.md` (which embeds `DESIGN_METHODOLOGY`) is inspected
- **THEN** the "Never read source code" rule's exception SHALL include reading changed files to map them to affected pages in diff-aware mode
- **AND** SHALL include the standalone fix loop reading source to make the minimal fix
- **AND** SHALL state the rule governs the audit phase (do not form findings by reading code)
