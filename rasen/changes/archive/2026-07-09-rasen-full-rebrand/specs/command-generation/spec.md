## MODIFIED Requirements

### Requirement: ToolCommandAdapter interface

The system SHALL define a `ToolCommandAdapter` interface for per-tool formatting. Every adapter's file path SHALL derive its brand segment from the shared command-prefix constant rather than a per-adapter literal.

#### Scenario: Adapter interface structure

- **WHEN** implementing a tool adapter
- **THEN** `ToolCommandAdapter` SHALL require:
  - `toolId`: string identifier matching `AIToolOption.value`
  - `getFilePath(commandId: string)`: returns file path for command (relative from project root, or absolute for global-scoped tools like Codex)
  - `formatFile(content: CommandContent)`: returns complete file content with frontmatter

#### Scenario: Claude adapter formatting

- **WHEN** formatting a command for Claude Code
- **THEN** the adapter SHALL output YAML frontmatter with `name`, `description`, `category`, `tags` fields
- **AND** file path SHALL follow pattern `.claude/commands/rasen/<id>.md`

#### Scenario: Cursor adapter formatting

- **WHEN** formatting a command for Cursor
- **THEN** the adapter SHALL output YAML frontmatter with `name` as `/rasen-<id>`, `id`, `category`, `description` fields
- **AND** file path SHALL follow pattern `.cursor/commands/rasen-<id>.md`

#### Scenario: Windsurf adapter formatting

- **WHEN** formatting a command for Windsurf
- **THEN** the adapter SHALL output YAML frontmatter with `name`, `description`, `category`, `tags` fields
- **AND** file path SHALL follow pattern `.windsurf/workflows/rasen-<id>.md`

#### Scenario: OpenCode adapter formatting

- **WHEN** formatting a command for OpenCode
- **THEN** the adapter SHALL output YAML frontmatter with `description` field
- **AND** file path SHALL follow pattern `.opencode/commands/rasen-<id>.md` using `path.join('.opencode', 'commands', ...)` for cross-platform compatibility
- **AND** the adapter SHALL transform colon-based command references (`/rasen:name`) to hyphen-based (`/rasen-name`) in the body

## ADDED Requirements

### Requirement: Command prefix defined once

The slash-command prefix (`rasen`) SHALL be defined by a single exported constant, and all adapter file paths, colon-to-hyphen body transforms, and generated command identifiers SHALL derive from it. No adapter or template SHALL hardcode the prefix string independently.

#### Scenario: Prefix constant drives all adapters

- **WHEN** the command-prefix constant is changed to a new value and command files are regenerated
- **THEN** every adapter's file path and every generated command identifier reflects the new value
- **AND** no generated artifact retains the previous prefix

#### Scenario: Generated output is free of legacy namespace tokens

- **WHEN** all command files, skill files, and workflow templates are generated for every registered tool
- **THEN** no generated file contains `/opsx:`, `opsx-`, a `commands/opsx/` path segment, or an `openspec-` skill reference
- **AND** an automated guard test enforces this on every run
