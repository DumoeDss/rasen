## MODIFIED Requirements

### Requirement: Architecture Patterns

The completion implementation SHALL follow clean architecture principles with TypeScript best practices, supporting multiple shells through adapters that consume one resolved, locale-aware CLI presentation.

#### Scenario: Shell-specific generators

- **WHEN** implementing completion generators
- **THEN** create generator classes for each shell: `ZshGenerator`, `BashGenerator`, `FishGenerator`, `PowerShellGenerator`
- **AND** implement a common `CompletionGenerator` interface with a `generate` method that accepts resolved CLI presentation data and returns a complete shell script
- **AND** each generator SHALL handle only shell-specific syntax, escaping, and patterns
- **AND** all generators SHALL consume the same resolved command and option descriptions
- **AND** no generator SHALL resolve locales, catalog fallback, aliases, or description placeholders independently

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

#### Scenario: Root-inclusive command registry

- **WHEN** defining completable commands
- **THEN** create centralized unresolved command and option types that contain machine-facing names, aliases, flags, positional metadata, static completion values, and nested commands without human descriptions
- **AND** export one root-inclusive CLI registry containing canonical command definitions and root-owned options
- **AND** represent simple aliases on their canonical command rather than as duplicate command definitions
- **AND** derive ordinary presentation locations from canonical command structure instead of storing manual description identifiers

#### Scenario: Resolved presentation input

- **WHEN** generating or installing a completion script
- **THEN** resolve the selected locale, English fallback, aliases, and dynamic description values before invoking a shell generator
- **AND** pass only non-empty resolved descriptions to the generator
- **AND** use one locale and presentation snapshot for both script generation and the surrounding installation operation

#### Scenario: Type-safe shell detection

- **WHEN** implementing shell detection
- **THEN** define a `SupportedShell` type as literal type: `'zsh' | 'bash' | 'fish' | 'powershell'`
- **AND** implement `detectShell()` function in `src/utils/shell-detection.ts`
- **AND** return detected shell or throw error with supported shells list
