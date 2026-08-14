import { COMMON_FLAGS } from './shared-flags.js';
import type { CommandDefinition } from './types.js';
const COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'init',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'tools',
        takesValue: true,
      },
      {
        name: 'force',
      },
      {
        name: 'profile',
        takesValue: true,
        completionValues: ['full', 'core', 'custom'],
      },
    ],
  },
  {
    name: 'update',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'force',
      },
      {
        name: 'all-projects',
      },
      {
        name: 'only-this',
      },
    ],
  },
  {
    name: 'migrate',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'no-interactive',
      },
    ],
  },
  {
    name: 'list',
    flags: [
      {
        name: 'specs',
      },
      {
        name: 'changes',
      },
      {
        name: 'sort',
        takesValue: true,
        completionValues: ['recent', 'name'],
      },
      {
        name: 'long',
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'view',
    flags: [],
  },
  {
    name: 'validate',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    positionals: [{ name: 'item-name', type: 'change-or-spec-id', optional: true }],
    flags: [
      {
        name: 'all',
      },
      {
        name: 'changes',
      },
      {
        name: 'specs',
      },
      {
        name: 'pipelines',
      },
      COMMON_FLAGS.type,
      COMMON_FLAGS.strict,
      COMMON_FLAGS.jsonValidation,
      {
        name: 'concurrency',
        takesValue: true,
      },
      COMMON_FLAGS.noInteractive,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'show',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    positionals: [{ name: 'item-name', type: 'change-or-spec-id', optional: true }],
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.type,
      COMMON_FLAGS.noInteractive,
      {
        name: 'deltas-only',
      },
      {
        name: 'requirements-only',
      },
      {
        name: 'requirements',
      },
      {
        name: 'no-scenarios',
      },
      {
        name: 'requirement',
        short: 'r',
        takesValue: true,
      },
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'home',
    flags: [],
    subcommands: [
      {
        name: 'prune',
        flags: [
          { name: 'apply', },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'archive',
    acceptsPositional: true,
    positionalType: 'change-id',
    positionals: [{ name: 'change-name', type: 'change-id', optional: true }],
    subcommands: [
      {
        name: 'relocate',
        flags: [
          {
            name: 'to',
            takesValue: true,
            completionValues: ['in-repo', 'external', 'store'],
          },
          { name: 'dry-run', },
          { name: 'verify-hash', },
          COMMON_FLAGS.json,
        ],
      },
    ],
    flags: [
      {
        name: 'yes',
        short: 'y',
      },
      {
        name: 'skip-specs',
      },
      {
        name: 'no-validate',
      },
      {
        name: 'json',
      },
      {
        name: 'keep-ephemera',
      },
      {
        name: 'no-whitespace-check',
      },
      {
        name: 'dry-run',
      },
      {
        name: 'save-plan',
      },
      {
        name: 'apply-plan',
        takesValue: true,
      },
      {
        name: 'intent-template',
      },
      {
        name: 'intent-file',
        takesValue: true,
      },
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'status',
    flags: [
      {
        name: 'change',
        takesValue: true,
      },
      {
        name: 'schema',
        takesValue: true,
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'instructions',
    acceptsPositional: true,
    positionals: [{ name: 'artifact', optional: true }],
    flags: [
      {
        name: 'change',
        takesValue: true,
      },
      {
        name: 'schema',
        takesValue: true,
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
    ],
  },
  {
    name: 'templates',
    flags: [
      {
        name: 'schema',
        takesValue: true,
      },
      COMMON_FLAGS.json,
    ],
  },
  {
    name: 'schemas',
    flags: [
      COMMON_FLAGS.json,
    ],
  },
  {
    name: 'new',
    flags: [],
    subcommands: [
      {
        name: 'change',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'description',
            takesValue: true,
          },
          {
            name: 'proposal',
            takesValue: true,
          },
          {
            name: 'goal',
            takesValue: true,
          },
          {
            name: 'schema',
            takesValue: true,
          },
          {
            name: 'pipeline',
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
    flags: [],
    subcommands: [
      {
        name: 'setup',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          {
            name: 'path',
            takesValue: true,
          },
          {
            name: 'init-git',
          },
          {
            name: 'no-init-git',
          },
          {
            name: 'remote',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'register',
        acceptsPositional: true,
        positionals: [{ name: 'path', type: 'path', optional: true }],
        flags: [
          {
            name: 'id',
            takesValue: true,
          },
          {
            name: 'yes',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'add-project',
        acceptsPositional: true,
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          {
            name: 'to',
            takesValue: true,
          },
          {
            name: 'as',
            takesValue: true,
          },
          {
            name: 'set-primary',
          },
          {
            name: 'dry-run',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'migrate-membership',
        acceptsPositional: true,
        positionals: [{ name: 'store-id' }],
        flags: [
          {
            name: 'dry-run',
          },
          {
            name: 'apply',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'upgrade-identity',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          {
            name: 'uid',
            takesValue: true,
          },
          {
            name: 'dry-run',
          },
          {
            name: 'apply',
          },
          {
            name: 'all',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'unregister',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'project-namespace',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'remove',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'yes',
          },
          {
            name: 'project-namespace',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'adopt',
        acceptsPositional: true,
        positionals: [{ name: 'path', type: 'path', optional: true }],
        flags: [
          { name: 'to', takesValue: true },
          {
            name: 'archive',
            takesValue: true,
            completionValues: ['move', 'leave'],
          },
          { name: 'dry-run', },
          { name: 'verify-hash', },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'eject',
        acceptsPositional: true,
        positionals: [{ name: 'project-id' }],
        flags: [
          { name: 'from', takesValue: true },
          { name: 'all', },
          { name: 'yes', },
          { name: 'force', },
          { name: 'into', takesValue: true },
          { name: 'dry-run', },
          { name: 'verify-hash', },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        aliases: ['ls'],
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'doctor',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          {
            name: 'project-namespace',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'target-line',
        flags: [],
        subcommands: [
          {
            name: 'add',
            acceptsPositional: true,
            positionals: [{ name: 'target-line-id' }],
            flags: [
              COMMON_FLAGS.store,
              { name: 'store-ref', takesValue: true },
              COMMON_FLAGS.project,
              { name: 'code-ref', takesValue: true },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'set-ref',
            acceptsPositional: true,
            positionals: [{ name: 'target-line-id' }],
            flags: [
              COMMON_FLAGS.store,
              { name: 'store-ref', takesValue: true },
              COMMON_FLAGS.project,
              { name: 'code-ref', takesValue: true },
              { name: 'remove-code-ref' },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'list',
            flags: [COMMON_FLAGS.store, COMMON_FLAGS.json],
          },
          {
            name: 'show',
            acceptsPositional: true,
            positionals: [{ name: 'target-line-id' }],
            flags: [COMMON_FLAGS.store, COMMON_FLAGS.project, COMMON_FLAGS.json],
          },
        ],
      },
      {
        // The bound planning/execution worktree PAIR. `workspace` is a RETIRED
        // top-level group name, and a pair is Store content in any case, so
        // this group is a `store` subcommand rather than a fourth top-level
        // `work*` group beside `work`, `workset`, and `workflow`.
        name: 'workspace',
        flags: [],
        subcommands: [
          {
            name: 'plan',
            flags: [
              COMMON_FLAGS.store,
              COMMON_FLAGS.project,
              COMMON_FLAGS.targetLine,
              { name: 'change', takesValue: true },
              { name: 'planning-worktree', takesValue: true },
              { name: 'execution-worktree', takesValue: true },
              { name: 'existing-change' },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'apply',
            flags: [
              { name: 'apply-plan', takesValue: true },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'show',
            flags: [
              COMMON_FLAGS.store,
              COMMON_FLAGS.project,
              COMMON_FLAGS.targetLine,
              { name: 'change', takesValue: true },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'cleanup',
            flags: [
              COMMON_FLAGS.store,
              COMMON_FLAGS.project,
              COMMON_FLAGS.targetLine,
              { name: 'change', takesValue: true },
              { name: 'include-untracked' },
              { name: 'apply-plan', takesValue: true },
              COMMON_FLAGS.json,
            ],
          },
        ],
      },
      {
        // A Store-level Issue spans projects, so every sub-entry here takes
        // only `--store` — never `--project`, never `--target-line`.
        name: 'issue',
        flags: [],
        subcommands: [
          {
            name: 'new',
            acceptsPositional: true,
            positionals: [{ name: 'issue-id' }],
            flags: [
              COMMON_FLAGS.store,
              { name: 'title', takesValue: true },
              { name: 'readme' },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'list',
            flags: [
              COMMON_FLAGS.store,
              {
                name: 'state',
                takesValue: true,
                completionValues: ['open', 'resolved', 'dropped'],
              },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'show',
            acceptsPositional: true,
            positionals: [{ name: 'issue-id' }],
            flags: [COMMON_FLAGS.store, COMMON_FLAGS.json],
          },
          {
            name: 'state',
            acceptsPositional: true,
            positionals: [{ name: 'issue-id' }],
            flags: [
              COMMON_FLAGS.store,
              {
                name: 'state',
                takesValue: true,
                completionValues: ['open', 'resolved', 'dropped'],
              },
              { name: 'reason', takesValue: true },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'plan',
            acceptsPositional: true,
            positionals: [{ name: 'issue-id' }],
            flags: [
              COMMON_FLAGS.store,
              { name: 'from-file', takesValue: true },
              COMMON_FLAGS.json,
            ],
          },
        ],
      },
      {
        // The grouped-Changes read: deliberately a top-level `store` sibling,
        // not a subcommand of a shared `aggregate` noun (see store-aggregate.ts).
        name: 'changes',
        flags: [
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
          COMMON_FLAGS.targetLine,
          COMMON_FLAGS.json,
        ],
      },
      {
        // The per-project rollup read: same rationale as `changes` above.
        name: 'projects',
        flags: [COMMON_FLAGS.store, COMMON_FLAGS.json],
      },
    ],
  },
  {
    name: 'context',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
      {
        name: 'code-workspace',
        takesValue: true,
      },
      {
        name: 'force',
      },
    ],
  },
  {
    // store-bootstrap-obtain: apply mode now obtains declared Stores from
    // their remotes. The check/dry-run flags remain read-only.
    name: 'bootstrap',
    flags: [
      {
        name: 'check',
      },
      {
        name: 'dry-run',
      },
      {
        name: 'apply',
      },
      {
        name: 'yes',
      },
      COMMON_FLAGS.json,
      {
        name: 'path',
        takesValue: true,
      },
      {
        name: 'into',
        takesValue: true,
      },
    ],
  },
  {
    name: 'doctor',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      COMMON_FLAGS.project,
      {
        name: 'gc',
      },
    ],
  },
  {
    name: 'workset',
    flags: [],
    subcommands: [
      {
        name: 'create',
        acceptsPositional: true,
        positionals: [{ name: 'name', optional: true }],
        flags: [
          {
            name: 'member',
            takesValue: true,
          },
          {
            name: 'tool',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        aliases: ['ls'],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'open',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'tool',
            takesValue: true,
          },
        ],
      },
      {
        name: 'remove',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'yes',
          },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'feedback',
    acceptsPositional: true,
    positionals: [{ name: 'message' }],
    flags: [
      {
        name: 'body',
        takesValue: true,
      },
    ],
  },
  {
    name: 'completion',
    flags: [],
    subcommands: [
      {
        name: 'generate',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [],
      },
      {
        name: 'install',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [
          {
            name: 'verbose',
          },
        ],
      },
      {
        name: 'uninstall',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [
          {
            name: 'yes',
            short: 'y',
          },
        ],
      },
    ],
  },
  {
    name: 'profile',
    flags: [],
    subcommands: [
      {
        name: 'new',
        acceptsPositional: true,
        positionals: [{ name: 'name', optional: true }],
        flags: [],
      },
      {
        name: 'use',
        acceptsPositional: true,
        positionalType: 'profile-name',
        positionals: [{ name: 'name', type: 'profile-name', optional: true }],
        flags: [],
      },
      {
        name: 'update',
        acceptsPositional: true,
        positionalType: 'saved-profile-name',
        positionals: [{ name: 'name', type: 'saved-profile-name', optional: true }],
        flags: [],
      },
      {
        name: 'list',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'delete',
        acceptsPositional: true,
        positionalType: 'saved-profile-name',
        positionals: [{ name: 'name', type: 'saved-profile-name', optional: true }],
        flags: [
          {
            name: 'yes',
            short: 'y',
          },
        ],
      },
      {
        name: 'import',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          {
            name: 'as',
            takesValue: true,
          },
          {
            name: 'force',
          },
        ],
      },
      {
        name: 'export',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          {
            name: 'profile',
            takesValue: true,
          },
          {
            name: 'thin',
          },
          {
            name: 'force',
          },
        ],
      },
    ],
  },
  {
    name: 'knowledge',
    flags: [],
    subcommands: [
      {
        name: 'bundle',
        flags: [],
        subcommands: [
          {
            name: 'export',
            flags: [
              {
                name: 'project',
                takesValue: true,
              },
              {
                name: 'to',
                takesValue: true,
              },
              {
                name: 'to-store',
                takesValue: true,
              },
              COMMON_FLAGS.json,
            ],
          },
          {
            name: 'import',
            acceptsPositional: true,
            positionalType: 'path',
            positionals: [{ name: 'bundle', type: 'path' }],
            flags: [
              {
                name: 'project',
                takesValue: true,
              },
              {
                name: 'dry-run',
              },
              COMMON_FLAGS.json,
            ],
          },
        ],
      },
      {
        name: 'apply',
        flags: [
          {
            name: 'from',
            takesValue: true,
          },
          {
            name: 'approve-store',
            takesValue: true,
          },
          {
            name: 'approve-global',
          },
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'run-state-dir',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        flags: [
          {
            name: 'scope',
            takesValue: true,
            completionValues: ['project', 'store', 'global'],
          },
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'run-state-dir',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'effective',
        flags: [
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'run-state-dir',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'migrate',
        flags: [
          {
            name: 'dry-run',
          },
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'run-state-dir',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'show',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'scope',
            takesValue: true,
            completionValues: ['project', 'store', 'global'],
          },
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'run-state-dir',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'retire',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'scope',
            takesValue: true,
            completionValues: ['project', 'store', 'global'],
          },
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'run-state-dir',
            takesValue: true,
          },
          {
            name: 'yes',
            short: 'y',
          },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'workflow',
    flags: [],
    subcommands: [
      {
        name: 'list',
        flags: [
          { name: 'unused', },
          { name: 'all', },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'show',
        acceptsPositional: true,
        positionalType: 'workflow-id',
        positionals: [{ name: 'id', type: 'workflow-id' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'which',
        acceptsPositional: true,
        positionalType: 'workflow-id',
        positionals: [{ name: 'id', type: 'workflow-id' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'init',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          { name: 'output', takesValue: true },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'validate',
        acceptsPositional: true,
        positionals: [{ name: 'id-or-path' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'import',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'export',
        acceptsPositional: true,
        positionals: [
          { name: 'id', type: 'workflow-id' },
          { name: 'path', type: 'path' },
        ],
        flags: [
          { name: 'force', },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'delete',
        acceptsPositional: true,
        positionalType: 'workflow-id',
        positionals: [{ name: 'id', type: 'workflow-id' }],
        flags: [
          { name: 'yes', short: 'y', },
          { name: 'force', },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'config',
    flags: [
      {
        name: 'scope',
        takesValue: true,
        completionValues: ['global', 'project'],
      },
    ],
    subcommands: [
      {
        name: 'path',
        flags: [],
      },
      {
        name: 'list',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'get',
        acceptsPositional: true,
        positionals: [{ name: 'key' }],
        flags: [],
      },
      {
        name: 'set',
        acceptsPositional: true,
        positionals: [{ name: 'key' }, { name: 'value' }],
        flags: [
          {
            name: 'string',
          },
          {
            name: 'allow-unknown',
          },
        ],
      },
      {
        name: 'unset',
        acceptsPositional: true,
        positionals: [{ name: 'key' }],
        flags: [],
      },
      {
        name: 'reset',
        flags: [
          {
            name: 'all',
          },
          {
            name: 'yes',
            short: 'y',
          },
        ],
      },
      {
        name: 'edit',
        flags: [],
      },
      {
        name: 'profile',
        acceptsPositional: true,
        positionals: [{ name: 'preset', optional: true }],
        flags: [],
      },
      {
        name: 'ui',
        flags: [
          {
            name: 'no-open',
          },
          {
            name: 'port',
            takesValue: true,
          },
        ],
      },
    ],
  },
  {
    name: 'ui',
    flags: [
      {
        name: 'no-open',
      },
      {
        name: 'port',
        takesValue: true,
      },
      {
        name: 'no-daemon',
      },
    ],
  },
  {
    name: 'daemon',
    flags: [],
    subcommands: [
      {
        name: 'run',
        flags: [
          {
            name: 'port',
            takesValue: true,
          },
        ],
      },
      {
        name: 'start',
        flags: [
          {
            name: 'port',
            takesValue: true,
          },
        ],
      },
      {
        name: 'stop',
        flags: [],
      },
      {
        name: 'status',
        flags: [],
      },
    ],
  },
  {
    name: 'session',
    flags: [],
    subcommands: [
      {
        name: 'exec',
        flags: [
          { name: 'backend', takesValue: true, completionValues: ['claude'] },
          { name: 'prompt-file', takesValue: true },
          { name: 'request-id', takesValue: true },
          { name: 'timeout-ms', takesValue: true },
          { name: 'run', takesValue: true },
          { name: 'session', takesValue: true },
          { name: 'action', takesValue: true },
          { name: 'cwd', takesValue: true },
          { name: 'message-id', takesValue: true },
          {
            name: 'touch',
            takesValue: true,
            completionValues: ['auto', 'never'],
          },
          { name: 'touch-deadline', takesValue: true },
          { name: 'max-touches', takesValue: true },
          {
            name: 'deadline-action',
            takesValue: true,
            completionValues: ['stop', 'retire-silent'],
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        flags: [
          { name: 'run', takesValue: true },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'inspect',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [COMMON_FLAGS.json],
      },
      ...(['cancel', 'restart'] as const).map((name) => ({
        name,
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          ...(name === 'restart' ? [] : [{ name: 'reason', takesValue: true }]),
          COMMON_FLAGS.json,
        ],
      })),
      {
        name: 'retire',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          { name: 'run', takesValue: true },
          { name: 'session', takesValue: true },
          { name: 'reason', takesValue: true },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'schema',
    flags: [],
    subcommands: [
      {
        name: 'which',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [{ name: 'name', type: 'schema-name', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'all',
          },
        ],
      },
      {
        name: 'validate',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [{ name: 'name', type: 'schema-name', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'verbose',
          },
        ],
      },
      {
        name: 'fork',
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
          },
        ],
      },
      {
        name: 'init',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'description',
            takesValue: true,
          },
          {
            name: 'artifacts',
            takesValue: true,
          },
          {
            name: 'default',
          },
          {
            name: 'no-default',
          },
          {
            name: 'force',
          },
        ],
      },
    ],
  },
  {
    name: 'pipeline',
    flags: [],
    subcommands: [
      {
        name: 'list',
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'show',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'for-execution',
          },
          {
            name: 'planner',
            takesValue: true,
          },
          {
            name: 'implementer',
            takesValue: true,
          },
          {
            name: 'reviewer',
            takesValue: true,
          },
          {
            name: 'fixer',
            takesValue: true,
          },
          {
            name: 'shipper',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'agents',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'planner',
            takesValue: true,
          },
          {
            name: 'implementer',
            takesValue: true,
          },
          {
            name: 'reviewer',
            takesValue: true,
          },
          {
            name: 'fixer',
            takesValue: true,
          },
          {
            name: 'shipper',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'classify',
        acceptsPositional: true,
        positionals: [{ name: 'task' }],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'resume',
        acceptsPositional: true,
        positionalType: 'change-id',
        positionals: [{ name: 'change', type: 'change-id' }],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'start',
        acceptsPositional: true,
        positionals: [
          { name: 'change', type: 'change-id' },
          { name: 'pipeline' },
        ],
        flags: [
          COMMON_FLAGS.json,
          // ECP-5 (task 9.2): `--engine` shipped on `pipeline start` in
          // section 1 without its completion-registry entry, which
          // `command-registry.test.ts` catches by diffing the registry against
          // Commander's real option list. The candidate values are listed so
          // shell completion offers the three policy values rather than a bare
          // flag.
          {
            name: 'engine',
            takesValue: true,
            completionValues: ['auto', 'reconciler', 'legacy'],
          },
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'status',
        acceptsPositional: true,
        positionals: [
          { name: 'change', type: 'change-id' },
          { name: 'pipeline' },
        ],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'resume-run',
        acceptsPositional: true,
        positionals: [
          { name: 'change', type: 'change-id' },
          { name: 'pipeline' },
        ],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'admit',
        acceptsPositional: true,
        positionals: [{ name: 'change', type: 'change-id' }],
        flags: [
          { name: 'run', takesValue: true },
          { name: 'turn-input-file', takesValue: true },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'cancel',
        acceptsPositional: true,
        positionals: [
          { name: 'change', type: 'change-id' },
          { name: 'pipeline' },
        ],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'complete',
        acceptsPositional: true,
        positionals: [{ name: 'change', type: 'change-id' }],
        flags: [
          { name: 'run', takesValue: true },
          {
            name: 'from',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'control',
        acceptsPositional: true,
        positionals: [{ name: 'change', type: 'change-id' }],
        flags: [
          { name: 'run', takesValue: true },
          {
            name: 'from',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'init',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          { name: 'output', takesValue: true },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'validate',
        acceptsPositional: true,
        positionals: [{ name: 'name-or-path' }],
        flags: [COMMON_FLAGS.json, COMMON_FLAGS.store, COMMON_FLAGS.project],
      },
      {
        name: 'import',
        acceptsPositional: true,
        positionalType: 'path',
        positionals: [{ name: 'path', type: 'path' }],
        flags: [
          { name: 'force', },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'export',
        acceptsPositional: true,
        positionals: [
          { name: 'name' },
          { name: 'path', type: 'path' },
        ],
        flags: [
          { name: 'force', },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'delete',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          { name: 'yes', short: 'y', },
          { name: 'force', },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
      {
        name: 'save',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          { name: 'from', takesValue: true },
          { name: 'force', },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
          COMMON_FLAGS.project,
        ],
      },
    ],
  },
  {
    name: 'scheme',
    flags: [],
    subcommands: [
      {
        name: 'list',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'show',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [COMMON_FLAGS.json],
      },
    ],
  },
  {
    name: 'work',
    flags: [],
    subcommands: [
      {
        name: 'migrate',
        flags: [
          {
            name: 'change',
            takesValue: true,
          },
          {
            name: 'dry-run',
          },
          {
            name: 'discard-absorbed-conclusions',
          },
          {
            name: 'store',
            takesValue: true,
          },
          {
            name: 'project',
            takesValue: true,
          },
          {
            name: 'json',
          },
          {
            name: 'yes',
          },
        ],
      },
    ],
  },
  {
    name: 'agent',
    flags: [],
    subcommands: [
      {
        name: 'dispatch',
        flags: [
          { name: 'runtime', takesValue: true },
          { name: 'prompt-file', takesValue: true },
          { name: 'contract', takesValue: true },
          { name: 'sandbox', takesValue: true },
          { name: 'model', takesValue: true },
          { name: 'effort', takesValue: true },
          { name: 'cwd', takesValue: true },
          { name: 'timeout-ms', takesValue: true },
          { name: 'resume', takesValue: true },
          { name: 'inference-file', takesValue: true },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'context',
        flags: [
          {
            name: 'transcript',
            takesValue: true,
          },
          {
            name: 'latest',
          },
          {
            name: 'dir',
            takesValue: true,
          },
          {
            name: 'limit',
            takesValue: true,
          },
          {
            name: 'runtime',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'wait',
        flags: [
          {
            name: 'change',
            takesValue: true,
          },
          {
            name: 'role',
            takesValue: true,
          },
          {
            name: 'max-beats',
            takesValue: true,
          },
          {
            name: 'context-tokens',
            takesValue: true,
          },
          {
            name: 'beat-seconds',
            takesValue: true,
          },
        ],
      },
      {
        name: 'audit',
        acceptsPositional: true,
        positionals: [{ name: 'sessionId|path', optional: true }],
        flags: [
          {
            name: 'projects-dir',
            takesValue: true,
          },
          {
            name: 'out',
            takesValue: true,
          },
          {
            name: 'runtime',
            takesValue: true,
          },
          {
            name: 'match',
            takesValue: true,
          },
          {
            name: 'db',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          {
            name: 'open',
          },
        ],
      },
    ],
  },
];

export const COMMAND_REGISTRY: CommandDefinition = {
  name: 'rasen',
  flags: [{ name: 'no-color' }],
  subcommands: COMMANDS,
};

export const COMPATIBILITY_COMMAND_REGISTRY: readonly CommandDefinition[] = [
  {
    name: 'experimental',
    flags: [
      {
        name: 'tool',
        takesValue: true,
      },
      {
        name: 'no-interactive',
      },
    ],
  },
];
