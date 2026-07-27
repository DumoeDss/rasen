# workflow-template-parity Specification

## Purpose
Cover the workflow and orchestration skill and command templates that lie outside the expert set with the parity golden master, so shared-block and body edits to them are verified instead of shipping unpinned — mirroring how the expert templates and chrome-use are already pinned.

## Requirements

### Requirement: Workflow and orchestration templates are covered by the parity golden master

The workflow and orchestration skill templates that lie outside the expert set SHALL be pinned by `test/core/templates/skill-templates-parity.test.ts`, so shared-block and body edits are verified instead of shipping unpinned. Each covered skill template SHALL appear in both the function-payload hash map and the generated-skill-content hash map. Command templates are retired and SHALL NOT appear in any parity hash map. This mirrors how the 19 experts (capability `expert-template-inlining`) and chrome-use (capability `verify-ship-evidence`) are pinned.

When the shared orchestration source or its feature-reduced replacement prose changes, the maintained delivery flow SHALL compile the template source, refresh installed/dogfooding generated skills with the built CLI update command, and recompute both pinned hash entries for every actually affected generated skill. Hashes for unaffected templates SHALL remain unchanged. Generated skill output SHALL reflect the canonical source and SHALL NOT be edited as an independent source of truth.

#### Scenario: Workflow skill templates pinned in both maps

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL include function-payload and generated-content hash entries for each of: `rasen-office-hours-command`, `rasen-verify-enhanced`, `rasen-ship`, `rasen-retro`, `rasen-auto`, `rasen-review-cycle`, `rasen-handoff`, `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal`

#### Scenario: No command-template hash entries remain

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL contain no function-payload hash entries for command templates (command templates no longer exist)

#### Scenario: Shared Step H edit follows build and update

- **WHEN** the canonical orchestration template's threshold precedence prose changes
- **THEN** the implementation SHALL run the repository build before `node dist/cli/index.js update`
- **AND** the refreshed generated skill content SHALL carry the binding-aware Step H text

#### Scenario: Both hash maps move only for affected consumers

- **WHEN** the parity suite is run after the shared Step H change
- **THEN** the function-payload and generated-content expected hashes SHALL be refreshed for every template whose rendered output changed
- **AND** hashes for templates whose output did not change SHALL remain byte-identical

#### Scenario: Feature-reduced orchestration text cannot retain old precedence

- **WHEN** a workflow renders a reduced orchestration feature set that replaces the full reuse paragraph
- **THEN** its generated handoff guidance SHALL still include the runtime-bound handoff scheme layer and inherited-store layer in the correct order

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
