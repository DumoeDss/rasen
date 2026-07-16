/**
 * Recorded config-list fixture (design.md D5/D9 drift tripwire).
 *
 * The `default`/`global`/`env-override`/shadowed-`project`/`warnings`
 * entries below are copied verbatim from a live `GET /api/v1/config`
 * response against a real (isolated `RASEN_HOME`/temp-project) `rasen
 * config ui` server — captured while fixing review round 1 finding m1,
 * which caught the previous hand-built warnings case describing a wire
 * state the real API cannot produce (an invalid PROJECT-scope
 * `autopilot.gates` value is silently dropped by the resilient project
 * parser before `resolveEffectiveConfig` ever sees it — only a raw GLOBAL
 * value can surface a `warnings[]` entry, since `readRawGlobalConfig()` in
 * `src/core/effective-config.ts` is unvalidated JSON.parse + merge). The
 * `autopilot.gates` entry here IS that dropped-invalid-value case, recorded
 * from the same live run, showing it resolves to `source: "default"` with
 * no warning — the negative case the earlier fixture got wrong.
 *
 * `satisfies ListConfigResponse` (not `as`/`as unknown as`) is the
 * compile-time half of the tripwire: it type-checks this literal against
 * the mirror in `src/api/types.ts` without widening away the union
 * literals, so `pnpm typecheck` fails the moment the mirror (or this
 * fixture) diverges from the CLI's wire-types.ts.
 */
import type { ListConfigResponse } from '../../src/api/types.js';

export const configListFixture = {
  project: {
    projectId: 'proj_abc123',
    name: 'rasen',
    root: '/Users/dev/rasen',
  },
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
        scopes: ['global', 'project'],
        type: 'number',
        defaultValue: 0.5,
        description:
          'Context-window occupancy fraction at which agents should hand off (project wins over global)',
        group: 'Workflow',
        constraints: { type: 'number', range: { gt: 0, lte: 1 } },
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
        scopes: ['project'],
        type: 'enum',
        enumValues: ['on', 'off'],
        defaultValue: 'on',
        description: 'Default autopilot gate policy',
        group: 'Autopilot',
        constraints: { type: 'enum', enumValues: ['on', 'off'] },
      },
      // Recorded with an invalid raw project value on disk: the resilient
      // project-config parser drops it before resolution, so this is what
      // the API actually reports for that case — default, no warning, no
      // scopeValues.project. (This is the m1 negative-case fixture.)
      value: 'on',
      source: 'default',
      scopeValues: {},
    },
  ],
} satisfies ListConfigResponse;
