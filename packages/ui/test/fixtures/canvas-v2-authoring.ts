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
  version: 'sha256:dd1b0845380d232d173d7c28873738aff2a798defc13b83bf1041a39d6a6a79f',
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

/**
 * The SAME "one of every node kind" claim as `CANVAS_V2_AUTHORING_DEFINITION`
 * above, but reached exclusively through the closed gesture vocabulary
 * (design D2/D3/D4/D5) instead of the withdrawn raw `v2-palette-add-<Kind>`
 * buttons. The two fixtures cannot be the same object: `CANVAS_V2_AUTHORING_
 * DEFINITION`'s `Choice` node carries arbitrary custom outcome labels
 * (`outcomes: ['default', 'parallel']`, no `expression`) that a raw palette
 * click could type freely but the new model — Choice is now ALWAYS created by
 * splicing a condition onto an existing connection — cannot reproduce; the
 * splice always yields the closed `['matched', 'skipped']` vocabulary plus a
 * required `expression`, and deliberately omits `legacyRuntimeOwner` (see
 * `spliceConditionOntoConnection` in `draft.ts`). This fixture is that
 * reachable shape: same declarations/inputs/artifacts/outcomes/limits (an
 * authoring path unaffected by the gesture change), a `root` graph rebuilt
 * node-for-node through `addAtomicStageForCapability`, `insertCompositeRef`,
 * `addBoundedLoopOverDeclaration`, `addParallelFrontier`, `addFinishNode`,
 * `setStageGate`, and finally `spliceConditionOntoConnection` on the
 * `bounded-loop -> fan-out` edge. `CANVAS_V2_AUTHORING_DEFINITION` itself
 * stays untouched — the root-level kernel-proof consumer
 * (`test/core/change-run/canvas-v2-vertical-proof.test.ts`) and the other
 * consumers of that fixture are outside this change's scope and do not care
 * how the graph was authored.
 */
export const CANVAS_V2_GESTURE_AUTHORED_DEFINITION = {
  ...CANVAS_V2_AUTHORING_DEFINITION,
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
      { id: 'finish', kind: 'Finish', outcome: 'done' },
      {
        id: 'gate',
        kind: 'Gate',
        target: 'atomic-stage',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed', rejected: 'escalate' },
      },
      {
        id: 'choice',
        kind: 'Choice',
        outcomes: ['matched', 'skipped'],
        expression: 'ready',
      },
    ],
    connections: [
      {
        id: 'composite-ref:body-report->bounded-loop:brief',
        from: { node: 'composite-ref', port: 'body-report' },
        to: { node: 'bounded-loop', port: 'brief' },
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
      {
        id: 'bounded-loop:done->choice:input',
        from: { node: 'bounded-loop', port: 'done' },
        to: { node: 'choice', port: 'input' },
      },
      {
        id: 'choice:matched->fan-out:input',
        from: { node: 'choice', port: 'matched' },
        to: { node: 'fan-out', port: 'input' },
      },
    ],
  },
} satisfies WirePipelineDefinitionV2;
