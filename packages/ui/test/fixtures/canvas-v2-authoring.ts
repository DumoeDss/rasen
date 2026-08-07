import type {
  PipelineCatalogResponse,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

/**
 * Cross-boundary oracle for the ECP-6 blank-Canvas authoring journey.
 *
 * The component test must reach this exact value exclusively through visible
 * Canvas controls. The root Management test then feeds the same value through
 * the kernel preparation and canonical persistence boundaries. Keeping the
 * oracle in one dependency-free fixture prevents the UI and server tests from
 * maintaining two definitions that merely look equivalent.
 */
export const CANVAS_V2_AUTHORING_NAME = 'canvas-v2-authoring-roundtrip';

export const CANVAS_V2_APPLY_CAPABILITY = {
  id: 'skill:rasen-apply-change',
  version: 'sha256:a4559817d3de2f554890a24d53e4a26827086a0e0f51371213be1db4686c0e8f',
} as const;

export const CANVAS_V2_AUTHORING_CATALOG = {
  roles: ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'],
  skills: [
    {
      id: 'rasen-apply-change',
      description: 'Apply tasks from a Rasen change',
      enabled: true,
      capability: {
        ...CANVAS_V2_APPLY_CAPABILITY,
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
      },
    },
  ],
  runtimes: ['claude', 'codex'],
  stageKinds: ['standard', 'decompose'],
  loopKinds: ['none', 'review-cycle', 'goal'],
  verifyPolicies: ['adaptive', 'standard', 'light'],
  conditionLabels: ['always'],
  gate: { default: false },
  handoff: { fractionRange: [0, 1], remainingTokensGt: 0 },
} satisfies PipelineCatalogResponse;

export const CANVAS_V2_AUTHORING_DEFINITION = {
  version: 2,
  id: `pipeline:${CANVAS_V2_AUTHORING_NAME}`,
  sourceId: `canvas:${CANVAS_V2_AUTHORING_NAME}`,
  name: CANVAS_V2_AUTHORING_NAME,
  inputs: [{ name: 'request', type: 'artifact/text', required: false }],
  artifacts: [{ name: 'report', type: 'artifact/text' }],
  outcomes: [
    'done',
    'failed',
    'approved',
    'rejected',
    'iteration-limit',
  ],
  declarations: [
    {
      id: 'work-body',
      kind: 'Composite',
      provenance: 'custom',
      inputs: [{ name: 'brief', type: 'artifact/text' }],
      artifacts: [{ name: 'body-report', type: 'artifact/text' }],
      outcomes: ['done'],
      graph: {
        nodes: [
          {
            id: 'stage',
            kind: 'AtomicStage',
            capability: CANVAS_V2_APPLY_CAPABILITY,
            execution: {
              version: 1,
              role: 'implementer',
              workspace: { access: 'write' },
            },
          },
        ],
        connections: [],
      },
    },
  ],
  root: {
    nodes: [
      {
        id: 'atomic-stage',
        kind: 'AtomicStage',
        capability: CANVAS_V2_APPLY_CAPABILITY,
        execution: {
          version: 1,
          role: 'implementer',
          workspace: { access: 'write' },
        },
      },
      {
        id: 'composite-ref',
        kind: 'CompositeRef',
        declarationId: 'work-body',
      },
      {
        id: 'bounded-loop',
        kind: 'BoundedLoop',
        body: 'work-body',
        limits: { maxIterations: 3, maxActions: 12, budget: 12 },
        lifecycle: {
          version: 1,
          thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
          strategy: { maxAttempts: 0, requireMaterialChange: true },
          exits: {
            iterationLimit: { action: 'exit', outcome: 'iteration-limit' },
            actionLimit: { action: 'fail', outcome: 'action-limit' },
            budgetLimit: { action: 'fail', outcome: 'budget-limit' },
            stalled: { action: 'escalate', outcome: 'stalled' },
            blocked: { action: 'human-required', outcome: 'blocked' },
            strategyExhausted: { action: 'fail', outcome: 'strategy-exhausted' },
          },
        },
        exits: { done: { action: 'exit', outcome: 'done' } },
      },
      { id: 'choice', kind: 'Choice', outcomes: ['default', 'parallel'] },
      {
        id: 'gate',
        kind: 'Gate',
        target: 'atomic-stage',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed', rejected: 'escalate' },
      },
      { id: 'finish', kind: 'Finish', outcome: 'done' },
      {
        id: 'fan-out',
        kind: 'FanOut',
        branches: ['atomic-stage'],
        concurrencyCap: 1,
        budget: 1,
        joinNodeId: 'join',
        members: [
          {
            id: 'atomic-stage',
            hierarchicalPath: 'atomic-stage',
            required: true,
            condition: 'always',
          },
        ],
      },
      {
        id: 'join',
        kind: 'Join',
        inputs: ['atomic-stage'],
        requiredMembers: ['atomic-stage'],
        optionalMembers: [],
        outcomes: { proceed: 'done', failed: 'failed' },
      },
    ],
    connections: [
      {
        id: 'composite-ref:body-report->bounded-loop:brief',
        from: { node: 'composite-ref', port: 'body-report' },
        to: { node: 'bounded-loop', port: 'brief' },
      },
      {
        id: 'bounded-loop:done->choice:input',
        from: { node: 'bounded-loop', port: 'done' },
        to: { node: 'choice', port: 'input' },
      },
      {
        id: 'choice:default->fan-out:input',
        from: { node: 'choice', port: 'default' },
        to: { node: 'fan-out', port: 'input' },
      },
      {
        id: 'choice:parallel->fan-out:input',
        from: { node: 'choice', port: 'parallel' },
        to: { node: 'fan-out', port: 'input' },
      },
      {
        id: 'fan-out:atomic-stage->atomic-stage:input',
        from: { node: 'fan-out', port: 'atomic-stage' },
        to: { node: 'atomic-stage', port: 'input' },
      },
      {
        id: 'atomic-stage:done->join:atomic-stage',
        from: { node: 'atomic-stage', port: 'done' },
        to: { node: 'join', port: 'atomic-stage' },
      },
      {
        id: 'join:done->finish:input',
        from: { node: 'join', port: 'done' },
        to: { node: 'finish', port: 'input' },
      },
    ],
  },
  limits: { maxActions: 32, budget: 32 },
} satisfies WirePipelineDefinitionV2;
