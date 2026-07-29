import type { SupportedShell } from '../../utils/shell-detection.js';

/**
 * Machine-facing definition of a command-line option.
 */
export interface FlagDefinition {
  /** Long option name without leading dashes. */
  name: string;

  /** Short option name without a leading dash. */
  short?: string;

  /** Whether the option takes an argument value. */
  takesValue?: boolean;

  /** Values accepted by the command parser, when Commander enforces choices. */
  acceptedValues?: readonly string[];

  /** Static values offered by shell completion. */
  completionValues?: readonly string[];
}

export type PositionalType =
  | 'change-id'
  | 'spec-id'
  | 'change-or-spec-id'
  | 'path'
  | 'shell'
  | 'schema-name'
  | 'profile-name'
  | 'saved-profile-name'
  | 'workflow-id';

/**
 * Machine-facing definition of a positional argument.
 */
export interface PositionalDefinition {
  name: string;
  type?: PositionalType;
  optional?: boolean;
}

/**
 * Machine-facing definition of a canonical CLI command.
 */
export interface CommandDefinition {
  name: string;
  aliases?: readonly string[];
  flags: readonly FlagDefinition[];
  subcommands?: readonly CommandDefinition[];
  acceptsPositional?: boolean;
  positionalType?: PositionalType;
  positionals?: readonly PositionalDefinition[];
}

/**
 * Root-inclusive machine-facing CLI structure.
 */
export interface CliStructure {
  root: CommandDefinition;
}

export interface ResolvedFlagDefinition extends FlagDefinition {
  description: string;
}

export interface ResolvedPositionalDefinition extends PositionalDefinition {
  description?: string;
}

export interface ResolvedCommandDefinition
  extends Omit<CommandDefinition, 'flags' | 'positionals' | 'subcommands'> {
  description: string;
  flags: readonly ResolvedFlagDefinition[];
  positionals?: readonly ResolvedPositionalDefinition[];
  subcommands?: readonly ResolvedCommandDefinition[];
}

export interface ResolvedCliChrome {
  usageTitle: string;
  argumentsTitle: string;
  optionsTitle: string;
  globalOptionsTitle: string;
  commandsTitle: string;
  helpOption: string;
  helpCommand: string;
  versionOption: string;
}

/**
 * Fully localized, immutable input shared by Commander and completion renderers.
 */
export interface ResolvedCliPresentation {
  chrome: Readonly<ResolvedCliChrome>;
  root: Readonly<ResolvedCommandDefinition>;
  compatibilityCommands: readonly Readonly<ResolvedCommandDefinition>[];
  completionCommands: readonly Readonly<ResolvedCommandDefinition>[];
}

export interface CliPresentationFacts {
  availableToolIds: readonly string[];
  defaultSchema: string;
  workspaceDir: string;
}

export type CliPresentationErrorCode =
  | 'missing-english-copy'
  | 'empty-copy'
  | 'placeholder-mismatch'
  | 'missing-runtime-fact'
  | 'unresolved-placeholder'
  | 'duplicate-command'
  | 'duplicate-option'
  | 'alias-collision'
  | 'commander-structure-mismatch';

export class CliPresentationError extends Error {
  constructor(
    public readonly code: CliPresentationErrorCode,
    public readonly semanticPath: string,
    message: string,
    public readonly placeholder?: string,
  ) {
    super(`${message} (${semanticPath})`);
    this.name = 'CliPresentationError';
  }
}

/**
 * Interface for shell-specific completion script generators.
 */
export interface CompletionGenerator {
  readonly shell: SupportedShell;
  generate(commands: readonly ResolvedCommandDefinition[]): string;
}
