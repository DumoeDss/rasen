## ADDED Requirements

### Requirement: Direction workflow template is parity-pinned

The canonical `rasen-direction` workflow template SHALL be covered by the
workflow-template parity suite in both its function payload and generated
`SKILL.md` content. It SHALL also participate in the generated-workflow
cross-reference guard and the registry-driven store-selection guidance test.

#### Scenario: Direction hashes are pinned

- **WHEN** the workflow-template parity test is inspected
- **THEN** it SHALL contain an expected function-payload hash for the Direction
  template factory
- **AND** it SHALL contain an expected generated-content hash for
  `rasen-direction`

#### Scenario: Direction follows generated workflow guards

- **WHEN** generated workflow skill bodies are checked
- **THEN** `rasen-direction` SHALL include the shared Store/project selection
  guidance
- **AND** it SHALL contain no `/rasen:` colon-form cross-workflow reference

#### Scenario: Parity hashes are generated from canonical source

- **WHEN** the Direction skill body changes
- **THEN** maintainers SHALL update hashes from the rendered canonical
  TypeScript template
- **AND** generated installed skill files SHALL NOT become an independent
  authored source
