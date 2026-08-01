## MODIFIED Requirements

### Requirement: QA "Never read source code" scoped to exploration, with diff-triage and fix-loop carve-outs

The `QA_METHODOLOGY` shared block SHALL scope its "Never read source code" absolute to the exploration/testing phase. It SHALL state that findings are formed from user-visible/runtime evidence and explicitly permit reading source for diff-aware triage that maps changed files to routes/pages. It SHALL additionally permit source reading in the default standalone fix loop, while making clear that dispatched and explicit report-only/non-UI modes have no fix loop and may read source only for bounded diff-aware triage.

#### Scenario: Unified QA rule carries explicit mode-aware carve-outs

- **WHEN** the generated `rasen-qa` skill is inspected
- **THEN** the "Never read source code" rule SHALL be scoped to the exploration/testing phase
- **AND** SHALL permit source reading for diff-aware triage that maps changed files to affected routes/pages
- **AND** SHALL permit source reading for the default standalone fix loop
- **AND** SHALL state that report-only modes do not gain a source-editing or fix-loop exception
- **AND** no generated `rasen-qa-only` skill SHALL be required to express this behavior
