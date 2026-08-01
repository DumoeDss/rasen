## MODIFIED Requirements

### Requirement: Cross-references use canonical skill names, not colon commands

Generated workflow skill bodies and CLI next-step output SHALL reference other workflows and independently invokable experts by their canonical skill-directory names (for example `rasen-apply-change` or `rasen-careful`), not `/rasen:*` colon forms. A host-owned methodology or router reference SHALL instead be named by its installed relative reference path and SHALL NOT be presented as an invokable skill. On tools where a skill surfaces as a slash command, the canonical skill name remains the invocation and the body SHALL be phrased so each tool relays it under its own convention.

#### Scenario: No colon command reference in generated workflow skill bodies

- **WHEN** every generated workflow skill body and the help navigator reference are scanned
- **THEN** none SHALL contain a `/rasen:` colon-form reference
- **AND** the guard's whitelist SHALL cover only frozen dispatched-contract content and historical/archive documents

#### Scenario: Methodology and cross-workflow references use the correct identity form

- **WHEN** a workflow body refers to another invokable workflow or expert
- **THEN** it SHALL use that skill's canonical `rasen-*` name
- **AND** when `propose`, `apply`, `explore`, `workflow-author`, or `help` refers to consolidated internal guidance, it SHALL name the bundled relative reference rather than `rasen-codebase-design`, `rasen-tdd`, `rasen-prototype`, `rasen-workflow-review`, or `rasen-navigator`
