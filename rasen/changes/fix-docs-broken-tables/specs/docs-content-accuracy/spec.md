## MODIFIED Requirements

### Requirement: Documented commands match the shipped CLI
Every terminal command (`rasen …`) and slash command (`/rasen-…`) mentioned in the curated docs SHALL exist in the current CLI build with the documented behavior, verified against `rasen --help` / subcommand help or the source. Commands the current build does not support are corrected or removed rather than left aspirational. Per-tool "command syntax" tables (e.g. `docs/commands.md`, `docs/how-commands-work.md`, and their `docs/zh/` mirrors) SHALL show every row using the invocation form that tool actually accepts, and SHALL NOT reference a retired invocation form (such as the colon-form skill invocation retired by `retire-colon-skill-names`) as if it were still in use.

#### Scenario: CLI reference is verifiable
- **WHEN** each documented command in the curated set is checked against the current CLI's help output
- **THEN** the command exists, its documented flags exist, and any described output shape matches current behavior

#### Scenario: Stale command discovered
- **WHEN** a documented command or flag is not present in the current CLI
- **THEN** the doc is updated to the current equivalent, or the mention is removed with surrounding prose adjusted — never left pointing at a nonexistent surface

#### Scenario: Per-tool syntax table stays internally consistent
- **WHEN** a reader compares rows in a "command syntax by tool" table across `docs/commands.md`, `docs/how-commands-work.md`, and their `docs/zh/` mirrors
- **THEN** every row uses the invocation form that tool's current integration actually accepts (e.g. Claude Code shows a leading `/`, matching every other row)
- **AND** no surrounding prose describes a retired invocation form (e.g. the colon form) as a currently valid alternative
