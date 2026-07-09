# workflow-template-parity Specification

## Purpose
Cover the workflow and orchestration skill and command templates that lie outside the expert set with the parity golden master, so shared-block and body edits to them are verified instead of shipping unpinned — mirroring how the expert templates and chrome-use are already pinned.

## Requirements

### Requirement: Workflow and orchestration templates are covered by the parity golden master

The workflow and orchestration skill and command templates that lie outside the expert set SHALL be pinned by `test/core/templates/skill-templates-parity.test.ts`, so shared-block and body edits are verified instead of shipping unpinned. Each covered skill template SHALL appear in both the function-payload hash map and the generated-skill-content hash map; each covered command template SHALL appear in the function-payload hash map. This mirrors how the 19 experts (capability `expert-template-inlining`) and chrome-use (capability `verify-ship-evidence`) are pinned.

#### Scenario: Workflow skill templates pinned in both maps

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL include function-payload and generated-content hash entries for each of: `rasen-office-hours-command`, `rasen-verify-enhanced`, `rasen-ship`, `rasen-retro`, `rasen-auto`, `rasen-review-cycle`, `rasen-handoff`, `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal`

#### Scenario: Workflow command templates pinned in the function map

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL include function-payload hash entries for the command templates of office-hours, verify-enhanced, ship, retro, auto, review-cycle, handoff, and goal
