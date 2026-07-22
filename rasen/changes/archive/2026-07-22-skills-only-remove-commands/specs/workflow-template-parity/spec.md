## MODIFIED Requirements

### Requirement: Workflow and orchestration templates are covered by the parity golden master

The workflow and orchestration skill templates that lie outside the expert set SHALL be pinned by `test/core/templates/skill-templates-parity.test.ts`, so shared-block and body edits are verified instead of shipping unpinned. Each covered skill template SHALL appear in both the function-payload hash map and the generated-skill-content hash map. Command templates are retired and SHALL NOT appear in any parity hash map. This mirrors how the 19 experts (capability `expert-template-inlining`) and chrome-use (capability `verify-ship-evidence`) are pinned.

#### Scenario: Workflow skill templates pinned in both maps

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL include function-payload and generated-content hash entries for each of: `rasen-office-hours-command`, `rasen-verify-enhanced`, `rasen-ship`, `rasen-retro`, `rasen-auto`, `rasen-review-cycle`, `rasen-handoff`, `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal`

#### Scenario: No command-template hash entries remain

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL contain no function-payload hash entries for command templates (command templates no longer exist)
