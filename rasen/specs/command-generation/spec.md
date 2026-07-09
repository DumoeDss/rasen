# command-generation Specification

## Purpose
Define tool-agnostic command content and adapter contracts for generating tool-specific Rasen command files.
## Requirements
### Requirement: CommandContent interface

The system SHALL define a tool-agnostic `CommandContent` interface for command data.

#### Scenario: CommandContent structure

- **WHEN** defining a command to generate
- **THEN** `CommandContent` SHALL include:
  - `id`: string identifier (e.g., 'explore', 'apply')
  - `name`: human-readable name (e.g., 'Rasen Explore')
  - `description`: brief description of command purpose
  - `category`: grouping category (e.g., 'Rasen')
  - `tags`: array of tag strings
  - `body`: the command instruction content

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

### Requirement: Command generator function

The system SHALL provide a `generateCommand` function that combines content with adapter.

#### Scenario: Generate command file

- **WHEN** calling `generateCommand(content, adapter)`
- **THEN** it SHALL return an object with:
  - `path`: the file path from `adapter.getFilePath(content.id)`
  - `fileContent`: the formatted content from `adapter.formatFile(content)`

#### Scenario: Generate multiple commands

- **WHEN** generating all rasen commands for a tool
- **THEN** the system SHALL iterate over command contents and generate each using the tool's adapter

### Requirement: CommandAdapterRegistry

The system SHALL provide a registry for looking up tool adapters.

#### Scenario: Get adapter by tool ID

- **WHEN** calling `CommandAdapterRegistry.get('cursor')`
- **THEN** it SHALL return the Cursor adapter or undefined if not registered

#### Scenario: Get all adapters

- **WHEN** calling `CommandAdapterRegistry.getAll()`
- **THEN** it SHALL return array of all registered adapters

#### Scenario: Adapter not found

- **WHEN** looking up an adapter for unregistered tool
- **THEN** `CommandAdapterRegistry.get()` SHALL return undefined
- **AND** caller SHALL handle missing adapter appropriately

### Requirement: Shared command body content

The body content of commands SHALL be shared across all tools.

#### Scenario: Same instructions across tools

- **WHEN** generating the 'explore' command for Claude and Cursor
- **THEN** both SHALL use the same `body` content
- **AND** only the frontmatter and file path SHALL differ

### Requirement: Legacy cleanup for renamed OpenCode command directory

The legacy cleanup module SHALL detect and remove old OpenCode command files from the previous singular `.opencode/command/` directory path.

#### Scenario: Detect old singular-path OpenCode command files

- **WHEN** running legacy artifact detection on a project with files matching `.opencode/command/opsx-*.md` or `.opencode/command/openspec-*.md`
- **THEN** the system SHALL include those files in the legacy slash command files list via `LEGACY_SLASH_COMMAND_PATHS`
- **AND** `LegacySlashCommandPattern.pattern` SHALL accept `string | string[]` to support multiple glob patterns per tool

#### Scenario: Clean up old OpenCode command files on init

- **WHEN** a user runs `rasen init` in a project with old `.opencode/command/` artifacts
- **THEN** the system SHALL remove the old files
- **AND** generate new command files at `.opencode/commands/`

#### Scenario: Auto-cleanup legacy artifacts in non-interactive mode

- **WHEN** a user runs `rasen init` in non-interactive mode (e.g., CI) and legacy artifacts are detected
- **THEN** the system SHALL auto-cleanup legacy artifacts without requiring `--force`
- **AND** legacy slash command files (100% OpenSpec-managed) SHALL be removed
- **AND** config file cleanup SHALL only remove OpenSpec markers (never delete user files)

