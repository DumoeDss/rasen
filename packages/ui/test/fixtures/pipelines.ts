/**
 * Pipelines fixtures (pipeline-http-api drift tripwire). The
 * `satisfies ListPipelinesResponse` / `satisfies ListConfigResponse` (never
 * `as`) is the compile-time half of the tripwire: it type-checks these literals
 * against the mirror in `src/api/types.ts` without widening away the union
 * literals, so `pnpm typecheck` fails the moment the mirror (or a fixture)
 * diverges from the CLI's wire-types.ts. Path-valued fields are plain display
 * strings kept separator-neutral with forward slashes.
 */
import type {
  ListConfigResponse,
  ListPipelinesResponse,
  PipelineDetailResponse,
} from '../../src/api/types.js';

/**
 * Three pipelines: a built-in `small-feature` (locked; a propose stage with no
 * override, an implement stage overridden at project scope on every axis, and a
 * `vet` stage outside the mask), a user-library `my-flow` (export/delete
 * affordances), and a project-layer `forked-flow` (provenance 'user' but
 * sourceLayer 'project' — locked, since the CLI refuses export AND delete on
 * anything that is not user-library).
 */
export const pipelinesFixture = {
  project: { projectId: 'proj_abc123', name: 'rasen', root: '/Users/dev/rasen' },
  store: null,
  pipelines: [
    {
      name: 'small-feature',
      description: 'A small feature pipeline',
      provenance: 'built-in',
      sourceLayer: 'package',
      stages: [
        {
          id: 'propose',
          role: 'planner',
          skill: 'rasen-propose',
          gate: true,
          effectiveGate: { value: true, source: 'stage' },
          effectiveModel: { value: 'fable', source: 'default' },
          effectiveHandoff: { value: 0.5, source: 'default' },
          effectiveRuntime: { value: 'claude', source: 'default' },
        },
        {
          id: 'implement',
          role: 'implementer',
          skill: 'rasen-apply',
          gate: false,
          effectiveGate: { value: false, source: 'stage' },
          effectiveModel: { value: 'opus-4', source: 'stage-override-project' },
          effectiveHandoff: { value: { remainingTokens: 50000 }, source: 'stage-override-project' },
          effectiveRuntime: { value: 'codex', source: 'stage-override-project' },
        },
        {
          id: 'gate-review',
          role: 'reviewer',
          skill: 'rasen-review',
          gate: true,
          effectiveGate: { value: true, source: 'stage' },
          effectiveModel: { value: null, source: 'default' },
          effectiveHandoff: { value: 0.5, source: 'default' },
          effectiveRuntime: { value: 'claude', source: 'default' },
        },
      ],
    },
    {
      name: 'my-flow',
      description: 'A user pipeline',
      provenance: 'user',
      sourceLayer: 'user',
      stages: [
        {
          id: 'build',
          role: 'implementer',
          skill: null,
          gate: false,
          effectiveGate: { value: false, source: 'stage' },
          effectiveModel: { value: null, source: 'default' },
          effectiveHandoff: { value: 0.5, source: 'default' },
          effectiveRuntime: { value: 'claude', source: 'default' },
        },
      ],
    },
    {
      name: 'forked-flow',
      description: 'A project-layer pipeline (forked into the project)',
      provenance: 'user',
      sourceLayer: 'project',
      stages: [
        {
          id: 'build',
          role: 'implementer',
          skill: null,
          gate: false,
          effectiveGate: { value: false, source: 'stage' },
          effectiveModel: { value: null, source: 'default' },
          effectiveHandoff: { value: 0.5, source: 'default' },
          effectiveRuntime: { value: 'claude', source: 'default' },
        },
      ],
    },
  ],
} satisfies ListPipelinesResponse;

/**
 * `GET /api/v1/pipelines/small-feature` detail (pipeline-definition-api,
 * pipeline-canvas-view's data source): `propose` -> `apply`, three stages
 * (`review`/`cso`/`qa`) sharing `parallelGroup: 'checks'` all requiring
 * `apply`, and `review-loop` requiring all three (fork + convergence) —
 * exactly the shape the layout unit tests pin. `pipeline` (the resolved view)
 * carries the same stage ids so `layout.ts` can join badges by id.
 */
export const pipelineDetailFixture = {
  pipeline: {
    name: 'small-feature',
    description: 'A small feature pipeline',
    provenance: 'built-in',
    sourceLayer: 'package',
    stages: [
      {
        id: 'propose',
        role: 'planner',
        skill: 'rasen-propose',
        gate: true,
        effectiveGate: { value: true, source: 'stage' },
        effectiveModel: { value: 'fable', source: 'default' },
        effectiveHandoff: { value: 0.5, source: 'default' },
        effectiveRuntime: { value: 'claude', source: 'default' },
      },
      {
        id: 'apply',
        role: 'implementer',
        skill: 'rasen-apply',
        gate: false,
        effectiveGate: { value: false, source: 'stage' },
        effectiveModel: { value: 'opus-4', source: 'stage-override-project' },
        effectiveHandoff: { value: { remainingTokens: 50000 }, source: 'stage-override-project' },
        effectiveRuntime: { value: 'codex', source: 'stage-override-project' },
      },
      {
        id: 'review',
        role: 'reviewer',
        skill: 'rasen-review',
        gate: true,
        effectiveGate: { value: true, source: 'stage' },
        effectiveModel: { value: null, source: 'default' },
        effectiveHandoff: { value: 0.5, source: 'default' },
        effectiveRuntime: { value: 'claude', source: 'default' },
      },
      {
        id: 'cso',
        role: 'reviewer',
        skill: 'rasen-cso',
        gate: true,
        effectiveGate: { value: true, source: 'stage' },
        effectiveModel: { value: null, source: 'default' },
        effectiveHandoff: { value: 0.5, source: 'default' },
        effectiveRuntime: { value: 'claude', source: 'default' },
      },
      {
        id: 'qa',
        role: 'reviewer',
        skill: 'rasen-qa',
        gate: true,
        effectiveGate: { value: true, source: 'stage' },
        effectiveModel: { value: null, source: 'default' },
        effectiveHandoff: { value: 0.5, source: 'default' },
        effectiveRuntime: { value: 'claude', source: 'default' },
      },
      {
        id: 'review-loop',
        role: 'fixer',
        skill: 'rasen-review-cycle',
        gate: true,
        effectiveGate: { value: true, source: 'stage' },
        effectiveModel: { value: null, source: 'default' },
        effectiveHandoff: { value: 0.5, source: 'default' },
        effectiveRuntime: { value: 'claude', source: 'default' },
      },
      {
        id: 'ship',
        role: 'shipper',
        skill: 'rasen-ship',
        gate: false,
        effectiveGate: { value: false, source: 'stage' },
        effectiveModel: { value: null, source: 'default' },
        effectiveHandoff: { value: 0.5, source: 'default' },
        effectiveRuntime: { value: 'claude', source: 'default' },
      },
    ],
  },
  definition: {
    name: 'small-feature',
    description: 'A small feature pipeline',
    stages: [
      { id: 'propose', kind: 'standard', skill: 'rasen-propose', role: 'planner', requires: [], gate: true, leadReview: false },
      { id: 'apply', kind: 'standard', skill: 'rasen-apply', role: 'implementer', requires: ['propose'], gate: false, leadReview: false },
      { id: 'review', kind: 'standard', skill: 'rasen-review', role: 'reviewer', requires: ['apply'], gate: true, leadReview: false, parallelGroup: 'checks' },
      { id: 'cso', kind: 'standard', skill: 'rasen-cso', role: 'reviewer', requires: ['apply'], gate: true, leadReview: false, parallelGroup: 'checks' },
      { id: 'qa', kind: 'standard', skill: 'rasen-qa', role: 'reviewer', requires: ['apply'], gate: true, leadReview: false, parallelGroup: 'checks' },
      {
        id: 'review-loop',
        kind: 'standard',
        skill: 'rasen-review-cycle',
        role: 'fixer',
        requires: ['review', 'cso', 'qa'],
        gate: true,
        leadReview: false,
        loop: { kind: 'review-cycle', maxRounds: 3 },
      },
      { id: 'ship', kind: 'standard', skill: 'rasen-ship', role: 'shipper', requires: ['review-loop'], gate: false, leadReview: false },
    ],
  },
  editable: false,
} satisfies PipelineDetailResponse;

/** The Defaults-table config keys (a representative subset of the role matrix + the autopilot controls). */
export const pipelinesConfigFixture = {
  project: { projectId: 'proj_abc123', name: 'rasen', root: '/Users/dev/rasen' },
  store: null,
  entries: [
    {
      definition: {
        key: 'models.default',
        scopes: ['global', 'store', 'project'],
        type: 'string',
        defaultValue: undefined,
        description: 'Base model for every agent role',
        group: 'Workflow',
        constraints: { type: 'string' },
      },
      value: 'fable',
      source: 'default',
      scopeValues: {},
    },
    {
      definition: {
        key: 'models.roles.planner',
        scopes: ['global', 'store', 'project'],
        type: 'string',
        defaultValue: undefined,
        description: 'Per-role model override for the planner role',
        group: 'Workflow',
        constraints: { type: 'string' },
      },
      value: 'fable',
      source: 'default',
      scopeValues: {},
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
      value: 0.5,
      source: 'default',
      scopeValues: {},
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
        key: 'autopilot.selection',
        scopes: ['global', 'store', 'project'],
        type: 'enum',
        enumValues: ['classify', 'manual', 'compose'],
        defaultValue: 'manual',
        description: 'Default autopilot pipeline-selection policy',
        group: 'Autopilot',
        constraints: { type: 'enum', enumValues: ['classify', 'manual', 'compose'] },
      },
      value: 'manual',
      source: 'default',
      scopeValues: {},
    },
  ],
} satisfies ListConfigResponse;
