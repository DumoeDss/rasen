## ADDED Requirements

### Requirement: Audit workflow generation
The system SHALL provide an `audit` workflow (skill `rasen-audit`, invoked as `/rasen-audit`) generated as a skill (skills are the only delivery format) and covered by drift detection like other workflows. It SHALL be part of ALL_WORKFLOWS but SHALL NOT be part of CORE_WORKFLOWS: session cost auditing is an optional diagnostic capability a user reaches for when they ask about spend, not part of the minimal first-run set.

#### Scenario: Generated in the full profile
- **WHEN** `rasen init`/`update` runs with profile `full`
- **THEN** `.claude/skills/rasen-audit/SKILL.md` SHALL be generated

#### Scenario: Not generated in the core profile
- **WHEN** `rasen init`/`update` runs with profile `core`
- **THEN** `.claude/skills/rasen-audit/SKILL.md` SHALL NOT be generated

#### Scenario: Custom profile inclusion
- **WHEN** a custom profile explicitly includes `audit`
- **THEN** the `audit` workflow SHALL be generated, and drift detection SHALL remove previously generated audit artifacts if a later sync omits it

### Requirement: Audit skill guides the user to a report
The `rasen-audit` skill SHALL guide a user who wants to understand a Claude Code session's token spend through the full path: identifying which session to audit (helping them find a session id when they don't already have one), running `rasen agent audit` for that session, and opening or interpreting the resulting report. It SHALL disclose the command's experimental status (an internal, undocumented transcript format that can change with harness updates) so the user understands the tool's limits before relying on it.

#### Scenario: User does not know their session id
- **WHEN** a user invokes the skill without already knowing a session id
- **THEN** the skill SHALL help them identify the right session (e.g. the current or most recent session for the project) before running the audit command

#### Scenario: Running the audit and opening the result
- **WHEN** a user invokes the skill with a session already identified
- **THEN** the skill SHALL run `rasen agent audit` for that session and SHALL offer to open the viewer (`--open`) to inspect the result

#### Scenario: Interpreting the report
- **WHEN** a user asks the skill to explain a generated report
- **THEN** the skill SHALL help interpret the report's totals and churn breakdown (what drove the spend, and which cache-churn cause categories contributed) rather than only pointing at the raw file

#### Scenario: Command failure is surfaced, not hidden
- **WHEN** `rasen agent audit` fails (e.g. an ambiguous session id, or a transcript-format-drift error)
- **THEN** the skill SHALL relay the command's actual error and next step to the user rather than guessing at a cause itself

#### Scenario: Runtime-agnostic guidance
- **WHEN** a user's session was run on Codex CLI rather than Claude Code
- **THEN** the skill SHALL recognize this and route to `rasen agent audit --runtime codex` accordingly, and SHALL explain the Codex report's totals in Codex's own terms (raw token totals and cache-effectiveness ratio) rather than describing them with Claude-specific vocabulary (billed-equivalent, churn cause) that does not apply
