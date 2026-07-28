/**
 * Config-list fixtures (design.md D5/D9 drift tripwire), refreshed against the
 * post-W1 (`ui-config-redesign-store-scope`) API: every response now carries a
 * `store: StoreLayerRef | null` ref and entries may carry a `scopeValues.store`
 * value. The `satisfies ListConfigResponse` (not `as`/`as unknown as`) is the
 * compile-time half of the tripwire: it type-checks these literals against the
 * mirror in `src/api/types.ts` without widening away the union literals, so
 * `pnpm typecheck` fails the moment the mirror (or a fixture) diverges from the
 * CLI's wire-types.ts.
 *
 * Three shapes are recorded: a project space with no store pointer
 * (`configListFixture`, `store: null`), a project space that inherits from a
 * store (`configListInheritedFixture`), and a store space editing its own
 * values (`configListStoreSpaceFixture`). Path-valued fields are plain display
 * strings (the UI never touches the filesystem with them), kept
 * separator-neutral with forward slashes.
 */
import type { ListConfigResponse } from '../../src/api/types.js';

export const configListFixture = {
  project: {
    projectId: 'proj_abc123',
    name: 'rasen',
    root: '/Users/dev/rasen',
  },
  store: null,
  entries: [
    {
      definition: {
        key: 'delivery',
        scopes: ['global'],
        type: 'enum',
        enumValues: ['both', 'skills'],
        defaultValue: 'both',
        description: 'Whether commands are installed alongside skills (skills are always installed)',
        group: 'Profile',
        constraints: { type: 'enum', enumValues: ['both', 'skills'] },
      },
      value: 'both',
      source: 'default',
      scopeValues: {},
    },
    {
      definition: {
        key: 'proactive',
        scopes: ['global'],
        type: 'boolean',
        defaultValue: true,
        description: 'Whether agents proactively suggest next steps',
        group: 'Behavior',
        constraints: { type: 'boolean' },
      },
      value: false,
      source: 'global',
      scopeValues: { global: false },
    },
    {
      definition: {
        key: 'handoff.threshold',
        scopes: ['global', 'store', 'project'],
        type: 'threshold',
        defaultValue: 0.5,
        description:
          'Context-handoff threshold at which agents should hand off (project wins over global): a fraction in (0, 1], or an absolute { remainingTokens: N } headroom',
        group: 'Workflow',
        constraints: { type: 'threshold', range: { gt: 0, lte: 1 }, remainingTokensGt: 0 },
      },
      value: 0.8,
      source: 'project',
      scopeValues: { global: 0.6, project: 0.8 },
    },
    {
      definition: {
        key: 'telemetry.enabled',
        scopes: ['global'],
        type: 'boolean',
        defaultValue: true,
        description: 'Send anonymous usage telemetry (environment opt-outs always win)',
        group: 'Telemetry',
        constraints: { type: 'boolean' },
      },
      value: false,
      source: 'env-override',
      scopeValues: {},
    },
    {
      definition: {
        key: 'repoMode',
        scopes: ['global'],
        type: 'enum',
        enumValues: ['solo', 'collaborative'],
        defaultValue: 'collaborative',
        description: 'Repository collaboration mode',
        group: 'Behavior',
        constraints: { type: 'enum', enumValues: ['solo', 'collaborative'] },
      },
      value: 'not-a-real-mode',
      source: 'global',
      scopeValues: { global: 'not-a-real-mode' },
      warnings: ['Invalid global value on disk for "repoMode": repoMode must be one of: solo, collaborative'],
    },
    {
      definition: {
        key: 'autopilot.gates',
        scopes: ['global', 'store', 'project'],
        type: 'enum',
        enumValues: ['on', 'off'],
        defaultValue: 'on',
        description: 'Default autopilot gate policy',
        group: 'Autopilot',
        constraints: { type: 'enum', enumValues: ['on', 'off'] },
      },
      value: 'on',
      source: 'default',
      scopeValues: {},
    },
  ],
} satisfies ListConfigResponse;

/**
 * A project space that declares a store pointer (design D3): the response
 * carries the inherited store ref, and entries show the store layer —
 * `autopilot.gates` inherited straight from the store, `handoff.threshold`
 * inherited from global with no store value, and `schema` set locally
 * (project) while the store also sets it (a shadowed store value).
 */
export const configListInheritedFixture = {
  project: {
    projectId: 'proj_member',
    name: 'member-project',
    root: '/Users/dev/member-project',
  },
  store: { id: 'shared-store', root: '/Users/dev/shared-store' },
  entries: [
    {
      definition: {
        key: 'autopilot.gates',
        scopes: ['global', 'store', 'project'],
        type: 'enum',
        enumValues: ['on', 'off'],
        defaultValue: 'on',
        description: 'Default autopilot gate policy',
        group: 'Autopilot',
        constraints: { type: 'enum', enumValues: ['on', 'off'] },
      },
      value: 'off',
      source: 'store',
      scopeValues: { store: 'off' },
    },
    {
      definition: {
        key: 'handoff.threshold',
        scopes: ['global', 'store', 'project'],
        type: 'threshold',
        defaultValue: 0.5,
        description: 'Context-handoff threshold at which agents should hand off',
        group: 'Workflow',
        constraints: { type: 'threshold', range: { gt: 0, lte: 1 }, remainingTokensGt: 0 },
      },
      value: 0.6,
      source: 'global',
      scopeValues: { global: 0.6 },
    },
    {
      definition: {
        key: 'schema',
        scopes: ['store', 'project'],
        type: 'string',
        defaultValue: 'spec-driven',
        description: 'The change schema this project uses',
        group: 'Project',
        constraints: { type: 'string' },
      },
      value: 'local-schema',
      source: 'project',
      scopeValues: { store: 'store-schema', project: 'local-schema' },
    },
  ],
} satisfies ListConfigResponse;

/**
 * A store space editing its own values (design D1/D2): `project` is null, the
 * store ref names the addressed store, and Local mode writes the store scope.
 */
export const configListStoreSpaceFixture = {
  project: null,
  store: { id: 'shared-store', root: '/Users/dev/shared-store' },
  entries: [
    {
      definition: {
        key: 'schema',
        scopes: ['store', 'project'],
        type: 'string',
        defaultValue: 'spec-driven',
        description: 'The change schema this store uses',
        group: 'Project',
        constraints: { type: 'string' },
      },
      value: 'store-schema',
      source: 'store',
      scopeValues: { store: 'store-schema' },
    },
    {
      definition: {
        key: 'autopilot.gates',
        scopes: ['global', 'store', 'project'],
        type: 'enum',
        enumValues: ['on', 'off'],
        defaultValue: 'on',
        description: 'Default autopilot gate policy',
        group: 'Autopilot',
        constraints: { type: 'enum', enumValues: ['on', 'off'] },
      },
      value: 'on',
      source: 'default',
      scopeValues: {},
    },
    {
      definition: {
        key: 'delivery',
        scopes: ['global'],
        type: 'enum',
        enumValues: ['both', 'skills'],
        defaultValue: 'both',
        description: 'Whether commands are installed alongside skills',
        group: 'Profile',
        constraints: { type: 'enum', enumValues: ['both', 'skills'] },
      },
      value: 'both',
      source: 'default',
      scopeValues: {},
    },
  ],
} satisfies ListConfigResponse;
