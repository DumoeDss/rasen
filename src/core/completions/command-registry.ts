import { COMMON_FLAGS } from './shared-flags.js';
import type { CommandDefinition } from './types.js';
export const COMMAND_REGISTRY: CommandDefinition[] = [
  {
    name: 'init',
    description: 'Initialize Rasen in your project',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'tools',
        description: 'Configure AI tools non-interactively (e.g., "all", "none", or comma-separated tool IDs)',
        takesValue: true,
      },
      {
        name: 'force',
        description: 'Auto-cleanup legacy files without prompting',
      },
      {
        name: 'profile',
        description: 'Override global config profile (full, core, or custom)',
        takesValue: true,
        values: ['full', 'core', 'custom'],
      },
    ],
  },
  {
    name: 'update',
    description: 'Update Rasen instruction files',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'force',
        description: 'Force update even when tools are up to date',
      },
    ],
  },
  {
    name: 'migrate',
    description: 'Copy a legacy openspec/ workspace into rasen/ (copy-only; originals untouched)',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'no-interactive',
        description: 'Do not prompt (skips optional marker-block cleanup)',
      },
    ],
  },
  {
    name: 'list',
    description: 'List items (changes by default, or specs with --specs)',
    flags: [
      {
        name: 'specs',
        description: 'List specs instead of changes',
      },
      {
        name: 'changes',
        description: 'List changes explicitly (default)',
      },
      {
        name: 'sort',
        description: 'Sort order: "recent" (default) or "name"',
        takesValue: true,
        values: ['recent', 'name'],
      },
      {
        name: 'long',
        description: 'Show id and title with counts',
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'view',
    description: 'Display an interactive dashboard of specs and changes',
    flags: [],
  },
  {
    name: 'validate',
    description: 'Validate changes and specs',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    positionals: [{ name: 'item-name', type: 'change-or-spec-id', optional: true }],
    flags: [
      {
        name: 'all',
        description: 'Validate all changes and specs',
      },
      {
        name: 'changes',
        description: 'Validate all changes',
      },
      {
        name: 'specs',
        description: 'Validate all specs',
      },
      {
        name: 'pipelines',
        description: 'Validate all pipelines',
      },
      COMMON_FLAGS.type,
      COMMON_FLAGS.strict,
      COMMON_FLAGS.jsonValidation,
      {
        name: 'concurrency',
        description: 'Max concurrent validations (defaults to env RASEN_CONCURRENCY or 6)',
        takesValue: true,
      },
      COMMON_FLAGS.noInteractive,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'show',
    description: 'Show a change or spec',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    positionals: [{ name: 'item-name', type: 'change-or-spec-id', optional: true }],
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.type,
      COMMON_FLAGS.noInteractive,
      {
        name: 'deltas-only',
        description: 'Show only deltas (JSON only, change-specific)',
      },
      {
        name: 'requirements-only',
        description: 'Alias for --deltas-only (deprecated, change-specific)',
      },
      {
        name: 'requirements',
        description: 'Show only requirements, exclude scenarios (JSON only, spec-specific)',
      },
      {
        name: 'no-scenarios',
        description: 'Exclude scenario content (JSON only, spec-specific)',
      },
      {
        name: 'requirement',
        short: 'r',
        description: 'Show specific requirement by ID (JSON only, spec-specific)',
        takesValue: true,
      },
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'archive',
    description: 'Archive a completed change and update main specs',
    acceptsPositional: true,
    positionalType: 'change-id',
    positionals: [{ name: 'change-name', type: 'change-id', optional: true }],
    flags: [
      {
        name: 'yes',
        short: 'y',
        description: 'Skip confirmation prompts',
      },
      {
        name: 'confirm-prune',
        description: "Confirm a 'prune' destination's permanent deletion (separate from --yes)",
      },
      {
        name: 'skip-specs',
        description: 'Skip spec update operations',
      },
      {
        name: 'no-validate',
        description: 'Skip validation (not recommended)',
      },
      {
        name: 'json',
        description: 'Output as JSON (non-interactive)',
      },
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'status',
    description: 'Display artifact completion status for a change',
    flags: [
      {
        name: 'change',
        description: 'Change name to show status for',
        takesValue: true,
      },
      {
        name: 'schema',
        description: 'Schema override',
        takesValue: true,
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'instructions',
    description: 'Output enriched instructions for creating an artifact or applying tasks',
    acceptsPositional: true,
    positionals: [{ name: 'artifact', optional: true }],
    flags: [
      {
        name: 'change',
        description: 'Change name',
        takesValue: true,
      },
      {
        name: 'schema',
        description: 'Schema override',
        takesValue: true,
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'templates',
    description: 'Show resolved template paths for all artifacts in a schema',
    flags: [
      {
        name: 'schema',
        description: 'Schema to use',
        takesValue: true,
      },
      COMMON_FLAGS.json,
    ],
  },
  {
    name: 'schemas',
    description: 'List available workflow schemas with descriptions',
    flags: [
      COMMON_FLAGS.json,
    ],
  },
  {
    name: 'new',
    description: 'Create new items',
    flags: [],
    subcommands: [
      {
        name: 'change',
        description: 'Create a new change directory',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'description',
            description: 'Description to add to README.md',
            takesValue: true,
          },
          {
            name: 'proposal',
            description: 'Seed proposal.md with this text, making the change active immediately',
            takesValue: true,
          },
          {
            name: 'goal',
            description: 'Optional goal metadata to store with the change',
            takesValue: true,
          },
          {
            name: 'schema',
            description: 'Workflow schema to use',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
    ],
  },
  {
    name: 'store',
    description:
      'Create and manage stores - standalone Rasen repos you register on this machine',
    flags: [],
    subcommands: [
      {
        name: 'setup',
        description: 'Create or register a local store',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          {
            name: 'path',
            description: 'Directory to use for the store',
            takesValue: true,
          },
          {
            name: 'init-git',
            description: 'Initialize a Git repository in the store',
          },
          {
            name: 'no-init-git',
            description: 'Skip Git repository initialization',
          },
          {
            name: 'remote',
            description: 'Canonical clone source recorded in store.yaml',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'register',
        description: 'Register an existing store directory',
        acceptsPositional: true,
        positionals: [{ name: 'path', type: 'path', optional: true }],
        flags: [
          {
            name: 'id',
            description: 'Store id',
            takesValue: true,
          },
          {
            name: 'yes',
            description: 'Confirm creating store identity metadata',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'add-project',
        description: "Register an in-repo project into the project namespace and add it to a target store's references",
        acceptsPositional: true,
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          {
            name: 'to',
            description: 'Target store to add the project to',
            takesValue: true,
          },
          {
            name: 'as',
            description: 'Project store id override',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'unregister',
        description: 'Forget a local store registration without deleting files',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'project-namespace',
            description: 'Target the project namespace for <id> instead of the store namespace',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'remove',
        description: 'Forget a local store registration and delete its local folder',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'yes',
            description: 'Confirm local store folder deletion',
          },
          {
            name: 'project-namespace',
            description: 'Target the project namespace for <id> instead of the store namespace',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        description: 'List registered stores',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'ls',
        description: 'List registered stores',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'doctor',
        description: 'Check local store registration and metadata',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          {
            name: 'project-namespace',
            description: 'Limit to the project namespace entry for [id]',
          },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'context',
    description: 'Print the working context for the resolved Rasen root',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
      {
        name: 'code-workspace',
        description: 'Also write a VS Code workspace file for the set',
        takesValue: true,
      },
      {
        name: 'force',
        description: 'Overwrite an existing --code-workspace file',
      },
    ],
  },
  {
    name: 'doctor',
    description: 'Report relationship health for the resolved Rasen root',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
      {
        name: 'gc',
        description: 'Remove dangling machine-home registry entries and their orphaned home directories',
      },
    ],
  },
  {
    name: 'workset',
    description: 'Compose, keep, and open personal working views (purely local)',
    flags: [],
    subcommands: [
      {
        name: 'create',
        description: 'Compose and save a named working view of folders you choose',
        acceptsPositional: true,
        positionals: [{ name: 'name', optional: true }],
        flags: [
          {
            name: 'member',
            description:
              'Member folder as <path> or <name>=<path>; repeatable, first is the primary',
            takesValue: true,
          },
          {
            name: 'tool',
            description: 'Preferred tool to open this workset with',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        description: 'Show saved worksets with their members',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'ls',
        description: 'Show saved worksets with their members',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'open',
        description:
          'Open a saved workset in your tool (editor window or agent session)',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'tool',
            description: 'Open with this tool just this once',
            takesValue: true,
          },
        ],
      },
      {
        name: 'remove',
        description: 'Delete a saved workset (member folders are never touched)',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'yes',
            description: 'Confirm removal non-interactively',
          },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'feedback',
    description: 'Submit feedback about Rasen',
    acceptsPositional: true,
    positionals: [{ name: 'message' }],
    flags: [
      {
        name: 'body',
        description: 'Detailed description for the feedback',
        takesValue: true,
      },
    ],
  },
  {
    name: 'completion',
    description: 'Manage shell completions for Rasen CLI',
    flags: [],
    subcommands: [
      {
        name: 'generate',
        description: 'Generate completion script for a shell (outputs to stdout)',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [],
      },
      {
        name: 'install',
        description: 'Install completion script for a shell',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [
          {
            name: 'verbose',
            description: 'Show detailed installation output',
          },
        ],
      },
      {
        name: 'uninstall',
        description: 'Uninstall completion script for a shell',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [
          {
            name: 'yes',
            short: 'y',
            description: 'Skip confirmation prompts',
          },
        ],
      },
    ],
  },
  {
    name: 'profile',
    description: 'Manage reusable workflow profiles',
    flags: [],
    subcommands: [
      {
        name: 'new',
        description: 'Create and use a named profile interactively',
        acceptsPositional: true,
        positionals: [{ name: 'name', optional: true }],
        flags: [],
      },
      {
        name: 'use',
        description: 'Use a built-in or saved profile',
        acceptsPositional: true,
        positionalType: 'profile-name',
        positionals: [{ name: 'name', type: 'profile-name', optional: true }],
        flags: [],
      },
      {
        name: 'list',
        description: 'List built-in and saved profiles',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'delete',
        description: 'Delete a saved profile',
        acceptsPositional: true,
        positionalType: 'saved-profile-name',
        positionals: [{ name: 'name', type: 'saved-profile-name', optional: true }],
        flags: [
          {
            name: 'yes',
            short: 'y',
            description: 'Skip confirmation',
          },
        ],
      },
      {
        name: 'import',
        description: 'Import a profile package, YAML, or JSON profile',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          {
            name: 'as',
            description: 'Save the imported profile under a different name',
            takesValue: true,
          },
          {
            name: 'force',
            description: 'Replace an existing profile with the same name',
          },
        ],
      },
      {
        name: 'export',
        description: 'Export current settings or a named profile',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          {
            name: 'profile',
            description: 'Export a built-in or saved profile instead of current settings',
            takesValue: true,
          },
          {
            name: 'thin',
            description: 'Export YAML or JSON without embedding user workflows',
          },
          {
            name: 'force',
            description: 'Overwrite an existing destination',
          },
        ],
      },
    ],
  },
  {
    name: 'workflow',
    description: 'Manage installable workflows in the user-wide library',
    flags: [],
    subcommands: [
      {
        name: 'list',
        description: 'List built-in and user workflows',
        flags: [
          { name: 'unused', description: 'Show only user workflows with no detected consumers' },
          { name: 'all', description: 'Also reveal internal workflows in the human table' },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'show',
        description: 'Show an installable workflow definition and known usage',
        acceptsPositional: true,
        positionalType: 'workflow-id',
        positionals: [{ name: 'id', type: 'workflow-id' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'which',
        description: 'Show where an installable workflow resolves from',
        acceptsPositional: true,
        positionalType: 'workflow-id',
        positionals: [{ name: 'id', type: 'workflow-id' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'init',
        description: 'Create a minimal workflow draft without installing it',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          { name: 'output', description: 'Empty workflow draft directory to create', takesValue: true },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'validate',
        description: 'Validate an installed workflow, draft directory, or .rasenpkg',
        acceptsPositional: true,
        positionals: [{ name: 'id-or-path' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'import',
        description: 'Validate and atomically install a workflow directory or package',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'export',
        description: 'Export a user workflow and its user dependencies as .rasenpkg',
        acceptsPositional: true,
        positionals: [
          { name: 'id', type: 'workflow-id' },
          { name: 'path', type: 'path' },
        ],
        flags: [
          { name: 'force', description: 'Replace an existing destination file' },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'delete',
        description: 'Delete an unreferenced user workflow',
        acceptsPositional: true,
        positionalType: 'workflow-id',
        positionals: [{ name: 'id', type: 'workflow-id' }],
        flags: [
          { name: 'yes', short: 'y', description: 'Skip confirmation' },
          { name: 'force', description: 'Bypass the referrer guard, deleting even a still-referenced workflow' },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'config',
    description: 'View and modify global or project Rasen configuration',
    flags: [
      {
        name: 'scope',
        description: 'Config scope: "global" (default) or "project"',
        takesValue: true,
        values: ['global', 'project'],
      },
    ],
    subcommands: [
      {
        name: 'path',
        description: 'Show config file location',
        flags: [],
      },
      {
        name: 'list',
        description: 'Show all current settings',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'get',
        description: 'Get a specific value (raw, scriptable)',
        acceptsPositional: true,
        positionals: [{ name: 'key' }],
        flags: [],
      },
      {
        name: 'set',
        description: 'Set a value (auto-coerce types)',
        acceptsPositional: true,
        positionals: [{ name: 'key' }, { name: 'value' }],
        flags: [
          {
            name: 'string',
            description: 'Force value to be stored as string',
          },
          {
            name: 'allow-unknown',
            description: 'Allow setting unknown keys',
          },
        ],
      },
      {
        name: 'unset',
        description: 'Remove a key (revert to default)',
        acceptsPositional: true,
        positionals: [{ name: 'key' }],
        flags: [],
      },
      {
        name: 'reset',
        description: 'Reset configuration to defaults',
        flags: [
          {
            name: 'all',
            description: 'Reset all configuration (required)',
          },
          {
            name: 'yes',
            short: 'y',
            description: 'Skip confirmation prompts',
          },
        ],
      },
      {
        name: 'edit',
        description: 'Open config in $EDITOR',
        flags: [],
      },
      {
        name: 'profile',
        description: 'Compatibility alias for `rasen profile`',
        acceptsPositional: true,
        positionals: [{ name: 'preset', optional: true }],
        flags: [],
      },
      {
        name: 'ui',
        description: '[Deprecated: use `rasen ui`] Start the localhost management server and open the config view',
        flags: [
          {
            name: 'no-open',
            description: 'Do not open the default browser',
          },
          {
            name: 'port',
            description: 'Pin the listen port (default: ephemeral)',
            takesValue: true,
          },
        ],
      },
    ],
  },
  {
    name: 'ui',
    description: 'Start the Rasen management platform (board + config) on a localhost server',
    flags: [
      {
        name: 'no-open',
        description: 'Do not open the default browser',
      },
      {
        name: 'port',
        description: 'Pin the listen port (default: ephemeral; --no-daemon only)',
        takesValue: true,
      },
      {
        name: 'no-daemon',
        description: 'Use a self-hosted foreground server instead of the resident daemon',
      },
    ],
  },
  {
    name: 'daemon',
    description: 'Manage the resident Rasen daemon (sessions survive terminal exits)',
    flags: [],
    subcommands: [
      {
        name: 'run',
        description: 'Run the resident daemon in the foreground (debugging/advanced form)',
        flags: [
          {
            name: 'port',
            description: 'Pin the listen port (default: 8791, or RASEN_DAEMON_PORT)',
            takesValue: true,
          },
        ],
      },
      {
        name: 'start',
        description: 'Start the resident daemon as a detached background process',
        flags: [
          {
            name: 'port',
            description: 'Pin the listen port (default: 8791, or RASEN_DAEMON_PORT)',
            takesValue: true,
          },
        ],
      },
      {
        name: 'stop',
        description: 'Stop the resident daemon, reaping its live sessions',
        flags: [],
      },
      {
        name: 'status',
        description: 'Report whether the resident daemon is running',
        flags: [],
      },
    ],
  },
  {
    name: 'schema',
    description: 'Manage workflow schemas',
    flags: [],
    subcommands: [
      {
        name: 'which',
        description: 'Show where a schema resolves from',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [{ name: 'name', type: 'schema-name', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'all',
            description: 'List all schemas with their resolution sources',
          },
        ],
      },
      {
        name: 'validate',
        description: 'Validate a schema structure and templates',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [{ name: 'name', type: 'schema-name', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'verbose',
            description: 'Show detailed validation steps',
          },
        ],
      },
      {
        name: 'fork',
        description: 'Copy an existing schema to project for customization',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [
          { name: 'source', type: 'schema-name' },
          { name: 'name', optional: true },
        ],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'force',
            description: 'Overwrite existing destination',
          },
        ],
      },
      {
        name: 'init',
        description: 'Create a new project-local schema',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'description',
            description: 'Schema description',
            takesValue: true,
          },
          {
            name: 'artifacts',
            description: 'Comma-separated artifact IDs',
            takesValue: true,
          },
          {
            name: 'default',
            description: 'Set as project default schema',
          },
          {
            name: 'no-default',
            description: 'Do not prompt to set as default',
          },
          {
            name: 'force',
            description: 'Overwrite existing schema',
          },
        ],
      },
    ],
  },
  {
    name: 'pipeline',
    description: 'Inspect and manage orchestration pipelines',
    flags: [],
    subcommands: [
      {
        name: 'list',
        description: 'List available pipelines (project > user > package)',
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'show',
        description: 'Show a pipeline stage DAG and build order',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'for-execution',
            description: 'Validate active-profile skills before returning the executable DAG',
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'agents',
        description: 'Show or set per-role Claude/Codex runtimes for a pipeline',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'planner',
            description: 'Set planner runtime: claude or codex',
            takesValue: true,
          },
          {
            name: 'implementer',
            description: 'Set implementer runtime: claude or codex',
            takesValue: true,
          },
          {
            name: 'reviewer',
            description: 'Set reviewer runtime: claude or codex',
            takesValue: true,
          },
          {
            name: 'fixer',
            description: 'Set fixer runtime: claude or codex',
            takesValue: true,
          },
          {
            name: 'shipper',
            description: 'Set shipper runtime: claude or codex',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'classify',
        description: 'Suggest a pipeline for a task (advisory keyword heuristic)',
        acceptsPositional: true,
        positionals: [{ name: 'task' }],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'resume',
        description: "Show a change's pipeline run-state (next/remaining stages)",
        acceptsPositional: true,
        positionalType: 'change-id',
        positionals: [{ name: 'change', type: 'change-id' }],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'init',
        description: 'Create a minimal pipeline draft without installing it',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          { name: 'output', description: 'Empty pipeline draft directory to create', takesValue: true },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'validate',
        description: 'Validate an installed pipeline, draft directory, or .rasenpkg',
        acceptsPositional: true,
        positionals: [{ name: 'name-or-path' }],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'import',
        description: 'Validate and atomically install a pipeline .rasenpkg',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          { name: 'force', description: 'Overwrite an already-installed pipeline of the same name' },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'export',
        description: 'Export a user pipeline as .rasenpkg',
        acceptsPositional: true,
        positionals: [
          { name: 'name' },
          { name: 'path', type: 'path' },
        ],
        flags: [
          { name: 'force', description: 'Replace an existing destination file' },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'delete',
        description: 'Delete an unreferenced user pipeline',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          { name: 'yes', short: 'y', description: 'Skip confirmation' },
          { name: 'force', description: 'Bypass the referrer guard, deleting even a still-referenced pipeline' },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
    ],
  },
  {
    name: 'work',
    description: 'Machine-home work-directory maintenance (migrate legacy in-repo ephemera)',
    flags: [],
    subcommands: [
      {
        name: 'migrate',
        description: 'Migrate legacy in-repo process ephemera (run-state, handoff, reports, ship-log) into the machine home',
        flags: [
          {
            name: 'change',
            description: 'Scope to one active or archived change',
            takesValue: true,
          },
          {
            name: 'dry-run',
            description: 'Preview only; never move files',
          },
          {
            name: 'include-tracked',
            description: 'Also move git-tracked ephemera, leaving the deletions uncommitted',
          },
          {
            name: 'json',
            description: 'Output as JSON (non-interactive; requires --yes to execute)',
          },
          {
            name: 'yes',
            description: 'Skip the confirmation prompt (required to execute in --json mode)',
          },
        ],
      },
    ],
  },
  {
    name: 'agent',
    description: 'Introspect agent runtime state (context)',
    flags: [],
    subcommands: [
      {
        name: 'context',
        description: 'Report context-window occupancy of a transcript from its recorded usage',
        flags: [
          {
            name: 'transcript',
            description: 'Path to a Claude Code transcript or Codex rollout jsonl',
            takesValue: true,
          },
          {
            name: 'latest',
            description: 'Use the newest main-session transcript for the current directory',
          },
          {
            name: 'dir',
            description: 'Override the Claude projects directory used by --latest',
            takesValue: true,
          },
          {
            name: 'limit',
            description: 'Override the resolved context-window limit',
            takesValue: true,
          },
          {
            name: 'runtime',
            description: 'Force detection to "claude" or "codex" instead of sniffing the file',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'wait',
        description: 'One cache-keepalive beat: block briefly polling the change\'s role signal file',
        flags: [
          {
            name: 'change',
            description: 'Change whose signals directory to poll',
            takesValue: true,
          },
          {
            name: 'role',
            description: 'Role key identifying this worker\'s signal file (e.g. reviewer, impl-spaces)',
            takesValue: true,
          },
          {
            name: 'max-beats',
            description: 'Override the default beat cap (12)',
            takesValue: true,
          },
          {
            name: 'context-tokens',
            description: 'Self-reported context size; below the keepalive floor stands down immediately',
            takesValue: true,
          },
          {
            name: 'beat-seconds',
            description: 'Beat duration in seconds (default 270, max 300)',
            takesValue: true,
          },
        ],
      },
    ],
  },
];
