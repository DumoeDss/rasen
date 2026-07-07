# methodology-skill-tool-scoping Specification

## Purpose
Narrows the `allowed-tools` grant of the phase0c advisory skill `codebase-design` to what its body actually does: `codebase-design` (purely advisory — reads and reasons about interfaces) drops Write/Edit/Bash down to Read/Grep/Glob/AskUserQuestion. Closes the over-broad tool scope flagged in phase0/0c review.
## Requirements
### Requirement: codebase-design allowed-tools scoped to advisory actions
The `codebase-design` skill's `allowed-tools` SHALL be narrowed to the tools its body actually uses. Its body is advisory (reads and reasons about interfaces; sub-agent spawning for DESIGN-IT-TWICE is not gated by allowed-tools) and performs no file writes or shell commands, so `allowed-tools` SHALL be `Read, Grep, Glob, AskUserQuestion` (dropping Write, Edit, Bash).

#### Scenario: codebase-design tools narrowed
- **WHEN** `skills/gstack/codebase-design/SKILL.md.tmpl` frontmatter is inspected
- **THEN** `allowed-tools` SHALL list `Read`, `Grep`, `Glob`, `AskUserQuestion`
- **AND** SHALL NOT list `Write`, `Edit`, or `Bash`

