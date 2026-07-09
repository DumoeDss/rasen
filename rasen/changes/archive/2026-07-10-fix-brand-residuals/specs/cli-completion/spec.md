## MODIFIED Requirements

### Requirement: Architecture Patterns

The completion implementation SHALL follow clean architecture principles with TypeScript best practices, supporting multiple shells through a plugin-based pattern.

#### Scenario: Shell-specific generators

- **WHEN** implementing completion generators
- **THEN** create generator classes for each shell: `ZshGenerator`, `BashGenerator`, `FishGenerator`, `PowerShellGenerator`
- **AND** implement a common `CompletionGenerator` interface with method:
  - `generate(commands: CommandDefinition[]): string` - Returns complete shell script
- **AND** each generator handles shell-specific syntax, escaping, and patterns
- **AND** all generators consume the same `CommandDefinition[]` from the command registry

#### Scenario: Shell-specific installers

- **WHEN** implementing completion installers
- **THEN** create installer classes for each shell: `ZshInstaller`, `BashInstaller`, `FishInstaller`, `PowerShellInstaller`
- **AND** implement a common `CompletionInstaller` interface with methods:
  - `install(script: string): Promise<InstallationResult>` - Installs completion script
  - `uninstall(): Promise<{ success: boolean; message: string }>` - Removes completion
- **AND** each installer handles shell-specific paths, config files, and installation patterns

#### Scenario: Factory pattern for shell selection

- **WHEN** selecting shell-specific implementation
- **THEN** use `CompletionFactory` class with static methods:
  - `createGenerator(shell: SupportedShell): CompletionGenerator`
  - `createInstaller(shell: SupportedShell): CompletionInstaller`
- **AND** factory uses switch statements with TypeScript exhaustiveness checking
- **AND** adding new shell requires updating `SupportedShell` type and factory cases

#### Scenario: Dynamic completion providers

- **WHEN** implementing dynamic completions
- **THEN** create a `CompletionProvider` class that encapsulates project discovery logic
- **AND** implement methods:
  - `getChangeIds(): Promise<string[]>` - Discovers active change IDs
  - `getSpecIds(): Promise<string[]>` - Discovers spec IDs
  - `isRasenProject(): boolean` - Checks if current directory is Rasen-enabled
- **AND** implement caching with 2-second TTL using class properties

#### Scenario: Command registry

- **WHEN** defining completable commands
- **THEN** create a centralized `CommandDefinition` type with properties:
  - `name: string` - Command name
  - `description: string` - Help text
  - `flags: FlagDefinition[]` - Available flags
  - `acceptsPositional: boolean` - Whether command takes positional arguments
  - `positionalType: string` - Type of positional (change-id, spec-id, path, shell)
  - `subcommands?: CommandDefinition[]` - Nested subcommands
- **AND** export a `COMMAND_REGISTRY` constant with all command definitions
- **AND** all generators consume this registry to ensure consistency across shells

#### Scenario: Type-safe shell detection

- **WHEN** implementing shell detection
- **THEN** define a `SupportedShell` type as literal type: `'zsh' | 'bash' | 'fish' | 'powershell'`
- **AND** implement `detectShell()` function in `src/utils/shell-detection.ts`
- **AND** return detected shell or throw error with supported shells list
