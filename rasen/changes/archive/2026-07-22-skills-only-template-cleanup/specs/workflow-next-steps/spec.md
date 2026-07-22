## ADDED Requirements

### Requirement: Skill bodies relay CLI next steps instead of hardcoding the chain
Generated workflow skill bodies SHALL NOT encode the downstream workflow chain themselves. Where a skill body guides the user to the next workflow, it SHALL relay the CLI's `nextWorkflows` (each entry named by this tool's invocation for that skill) and SHALL carry a zero-CLI fallback instruction to run `rasen status --change "<name>" --json` when no `nextWorkflows`-bearing command has been run in the current turn. The chain order lives only in the runtime chain table, never duplicated in a skill body.

#### Scenario: Body relays rather than hardcodes
- **WHEN** a generated workflow skill body that guides a next step is inspected
- **THEN** it SHALL instruct relaying the CLI's `nextWorkflows`
- **AND** it SHALL NOT contain a hardcoded downstream workflow chain (e.g. a literal verify → ship → archive sequence)
- **AND** it SHALL include the `rasen status --change "<name>" --json` fallback

### Requirement: Cross-references use canonical skill names, not colon commands
Generated workflow skill bodies and the CLI's next-step output SHALL reference other workflows and expert skills by their canonical skill name (the skill-directory form, e.g. `rasen-apply-change`, `rasen-tdd`), not the `/rasen:*` colon form. On tools where a skill surfaces as a slash command, the canonical skill name is the invocation; the body SHALL be phrased so each tool relays it under its own invocation convention.

#### Scenario: No colon command reference in a generated workflow skill body
- **WHEN** every generated workflow skill body (and the navigator router body) is scanned by an automated guard test
- **THEN** none SHALL contain a `/rasen:` colon-form reference
- **AND** the guard's whitelist SHALL cover only frozen expert dispatched-contract content carried from `_shared.ts` and historical/archive documents

#### Scenario: Methodology and cross-workflow references named by skill
- **WHEN** a workflow skill body references a methodology expert or another workflow (e.g. formerly `consult /tdd`, or `/rasen:apply <other>`)
- **THEN** it SHALL name the canonical skill (`rasen-tdd`, `rasen-apply-change`) rather than a bare-slash or colon command
