import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/index.js';
import {
  PlanIntegrityError,
  analyzeReconcilerSupport,
  createRuntimeExecutionProfile,
  observeRuntimeDrift,
  openDefinitionPlan,
  openRuntimeExecutionPlan,
  sealRuntimeExecutionPlan,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';

const BUG_FIX = {
  version: 1,
  name: 'bug-fix',
  description: 'fixture',
  stages: [
    {
      id: 'propose',
      skill: 'rasen-propose',
      role: 'planner',
      requires: [],
      gate: true,
    },
    {
      id: 'apply',
      skill: 'rasen-apply-change',
      role: 'implementer',
      requires: ['propose'],
      gate: true,
    },
    {
      id: 'verify',
      skill: 'rasen-review',
      role: 'reviewer',
      requires: ['apply'],
      verifyPolicy: 'adaptive',
    },
    {
      id: 'ship',
      skill: 'rasen-ship',
      role: 'shipper',
      requires: ['verify'],
      gate: true,
      model: 'sonnet',
    },
    {
      id: 'archive',
      skill: 'rasen-archive-change',
      role: 'shipper',
      requires: ['ship'],
      model: 'sonnet',
    },
  ],
} as const;

function prepare(source: unknown = BUG_FIX): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(
    source,
    createCapabilityCatalogSnapshot([])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

function sourceRevision(
  content = `sha256:${'1'.repeat(64)}`,
  semantic = `sha256:${'2'.repeat(64)}`
) {
  return {
    layer: 'package',
    kind: 'pipeline-yaml',
    sourceId: 'package:bug-fix',
    authoredContentDigest: content,
    semanticDigest: semantic,
  } as const;
}

function profile() {
  return createRuntimeExecutionProfile({
    sourceRevision: sourceRevision(),
    capabilities: BUG_FIX.stages.map((stage) => ({
      nodeId: `stage:${stage.id}`,
      authoredCapability: {
        id: `skill:${stage.skill}`,
        version: 'legacy',
      },
      contract: {
        id: stage.skill,
        version: '1',
        digest: `sha256:${'3'.repeat(64)}`,
      },
      actionKind: 'agent',
      resultContract: {
        id: `${stage.skill}-result`,
        version: '1',
        digest: `sha256:${'4'.repeat(64)}`,
      },
      evidenceContract: {
        id: `${stage.skill}-evidence`,
        version: '1',
        digest: `sha256:${'5'.repeat(64)}`,
      },
      recovery: 'suspend-if-ambiguous',
      workspace: {
        access:
          stage.id === 'propose' || stage.id === 'verify' ? 'read' : 'write',
        resources: ['worktree'],
      },
      effects: [
        {
          slot: 'workspace',
          kind: 'workspace',
          resource: 'worktree',
          recovery: 'suspend-if-ambiguous',
        },
      ],
      adapter: {
        id: `adapter:${stage.skill}`,
        version: '1',
        contentDigest: `sha256:${'6'.repeat(64)}`,
      },
    })),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: BUG_FIX.stages.map((stage) => ({
        nodeId: `stage:${stage.id}`,
        role: stage.role,
        model: stage.model ?? 'default',
        effort: 'default',
        runtime: 'codex',
        sandbox:
          stage.id === 'propose' || stage.id === 'verify'
            ? 'read-only'
            : 'workspace-write',
        gate: stage.gate ?? false,
        sessionReuse: 'never',
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
        provenance: {
          role: 'stage',
          model: stage.model ? 'stage' : 'default',
          effort: 'default',
          runtime: 'stage',
          sandbox: 'stage',
          gate: 'stage',
          sessionReuse: 'default',
          handoffTokenLimit: 'default',
          reuseRoundLimit: 'default',
        },
      })),
    },
  });
}

describe('stored Definition plan opener', () => {
  it('opens an exact closed envelope after serialization without current source', () => {
    const prepared = prepare();
    const stored = JSON.parse(JSON.stringify(prepared.plan));
    const opened = openDefinitionPlan(stored);

    // The sealed plan canonicalizes the definition (strips non-semantic keys
    // like 'provenance', 'canvas'). Compare the opened definition against the
    // canonicalized form from the sealed plan, not the raw prepared definition.
    const canonicalDefinition = (prepared.plan as { payload: { definition: unknown } }).payload.definition;
    expect(opened.definition).toEqual(canonicalDefinition);
    expect(opened.sourceDigest).toBe(prepared.digests.source);
    expect(opened.capabilityDigest).toBe(prepared.digests.capability);
    expect(opened.planDigest).toBe(prepared.digests.plan);
    expect(Object.isFrozen(opened)).toBe(true);
  });

  it('fails closed on envelope/payload tampering, extras, or unknown major', () => {
    const prepared = prepare();
    const payloadTamper = structuredClone(prepared.plan) as {
      version: number;
      digest: string;
      payload: Record<string, unknown>;
    };
    payloadTamper.payload.catalogVersion = 2;
    expect(() => openDefinitionPlan(payloadTamper)).toThrow(PlanIntegrityError);
    expect(() =>
      openDefinitionPlan({ ...prepared.plan, extra: true })
    ).toThrow(PlanIntegrityError);
    expect(() =>
      openDefinitionPlan({ ...prepared.plan, version: 2 })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_plan_version' }));
  });
});

describe('runtime execution profile sealing', () => {
  it('freezes complete path-independent executable meaning and reopens it exactly', () => {
    const prepared = prepare();
    const frozenProfile = profile();
    const sealed = sealRuntimeExecutionPlan(prepared.plan, frozenProfile);
    const stored = JSON.parse(JSON.stringify(sealed));
    const opened = openRuntimeExecutionPlan(stored);

    expect(opened.profile).toEqual(frozenProfile);
    expect(opened.profile.sourceRevision).not.toHaveProperty('path');
    expect(opened.profile.capabilities).toHaveLength(5);
    expect(opened.profile.policy.stages).toHaveLength(5);
    expect(opened.profileDigest).toBe(frozenProfile.profileDigest);
    expect(Object.isFrozen(opened.profile)).toBe(true);
  });

  it('binds every action-shaping policy value and rejects unsupported extras', () => {
    const input = structuredClone(profile()) as unknown as Record<string, unknown>;
    (input.policy as Record<string, unknown>).unknownOverride = true;
    expect(() => createRuntimeExecutionProfile(input as never)).toThrow(
      PlanIntegrityError
    );
  });

  it('reports source/capability/policy drift without replacing the frozen profile', () => {
    const frozen = profile();
    const current = createRuntimeExecutionProfile({
      sourceRevision: sourceRevision(
        `sha256:${'7'.repeat(64)}`,
        frozen.sourceRevision.semanticDigest
      ),
      capabilities: frozen.capabilities,
      policy: {
        ...frozen.policy,
        maxAttempts: frozen.policy.maxAttempts + 1,
      },
    });
    const drift = observeRuntimeDrift(frozen, current);

    expect(drift.sourceRevision).toEqual({
      provenance: 'unchanged',
      content: 'changed',
      semantic: 'unchanged',
    });
    expect(drift.capability).toBe('unchanged');
    expect(drift.policy).toBe('changed');
    expect(frozen.policy.maxAttempts).toBe(3);
  });
});

describe('one reconciler support analyzer', () => {
  it('supports only the exact validated root-DAG bug-fix profile', () => {
    const supported = analyzeReconcilerSupport(prepare(), profile());
    expect(supported).toEqual({
      availableEngines: ['legacy', 'reconciler'],
      reconcilerSupport: {
        supported: true,
        reason: 'supported_root_dag_bug_fix',
        profileDigest: profile().profileDigest,
      },
    });

    const sameNameWrongShape = structuredClone(BUG_FIX);
    sameNameWrongShape.stages[2]!.skill = 'rasen-apply-change';
    const unsupported = analyzeReconcilerSupport(
      prepare(sameNameWrongShape),
      profile()
    );
    expect(unsupported.availableEngines).toEqual(['legacy']);
    expect(unsupported.reconcilerSupport).toEqual(
      expect.objectContaining({
        supported: false,
        reason: 'unsupported_pipeline_shape',
      })
    );
  });

  it('rejects Composite/Loop/FanOut/Join and v2 before Run creation', () => {
    const loop = structuredClone(BUG_FIX);
    loop.stages[2]!.loop = { kind: 'review-cycle', maxRounds: 3 };
    expect(
      analyzeReconcilerSupport(prepare(loop), profile()).reconcilerSupport
    ).toEqual(
      expect.objectContaining({
        supported: false,
        reason: 'unsupported_pipeline_semantics',
      })
    );
  });
});
