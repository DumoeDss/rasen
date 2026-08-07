import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  projectPreparedPipelineExecutionView,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { freezeProductionPreparedPipelineRegistry } from '../../../src/core/pipeline-registry/prepared-registry.js';

const digest = `sha256:${'c'.repeat(64)}`;
const catalog = createCapabilityCatalogSnapshot([
  {
    id: 'skill:rasen-propose',
    version: digest,
    availability: 'enabled',
    inputs: [],
    artifacts: [],
    outcomes: ['completed'],
    limits: {},
  },
  {
    id: 'skill:rasen-review',
    version: digest,
    availability: 'enabled',
    inputs: [],
    artifacts: [],
    outcomes: ['completed'],
    limits: {},
  },
]);

const definition: DefinitionSourceV2 = {
  version: 2,
  id: 'pipeline:prepared-view',
  sourceId: 'project:prepared-view',
  name: 'prepared-view',
  description: 'native view fixture',
  inputs: [],
  artifacts: [],
  outcomes: ['approved', 'rejected', 'completed'],
  declarations: [],
  root: {
    nodes: [
      {
        id: 'review',
        kind: 'AtomicStage',
        capability: { id: 'skill:rasen-review', version: digest },
        execution: {
          version: 1,
          role: 'reviewer',
          workspace: { access: 'read' },
          verifyPolicy: 'adaptive',
          runtime: 'claude',
          sessionReuse: 'review-thread',
          handoff: { threshold: 0.3 },
        },
      },
      {
        id: 'propose',
        kind: 'AtomicStage',
        capability: { id: 'skill:rasen-propose', version: digest },
        execution: {
          version: 1,
          role: 'planner',
          workspace: { access: 'write' },
          runtime: 'codex',
          model: 'gpt-declared',
        },
      },
      {
        id: 'propose-gate',
        kind: 'Gate',
        target: 'propose',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed', rejected: 'escalate' },
      },
    ],
    connections: [],
  },
};

describe('projectPreparedPipelineExecutionView', () => {
  it('projects native v2 build order and the same capability/policy facts launch freezes', () => {
    const prepared = EcpDefinitionModule.prepare(definition, catalog);
    if (!prepared.ok) throw prepared.error;
    const inputs = {
      overrides: {
        gates: new Map([['review', { value: 'on' as const, scope: 'store' as const }]]),
        models: new Map([['propose', { value: 'gpt-project', scope: 'project' as const }]]),
        handoff: new Map(),
        runtimes: new Map(),
      },
      basePolicy: { effective: 'on' as const, source: 'default' as const },
      host: { runtime: 'codex' as const, source: 'process' as const },
    };

    const view = projectPreparedPipelineExecutionView(prepared.value, catalog, inputs);
    const profile = resolveRuntimeExecutionProfile(
      prepared.value,
      catalog,
      [],
      {
        layer: 'project',
        kind: 'pipeline-yaml',
        sourceId: 'project:prepared-view',
        authoredContentDigest: `sha256:${'a'.repeat(64)}`,
        semanticDigest: `sha256:${'b'.repeat(64)}`,
      },
      { maxAttempts: 3, maxActions: 64 },
      inputs
    );

    expect(view.buildOrder).toEqual(['root:propose', 'root:review']);
    expect(view.stages).toHaveLength(2);
    expect(view.stages.find((stage) => stage.id === 'review')).toEqual(
      expect.objectContaining({
        profilePath: 'root:review',
        capability: { id: 'skill:rasen-review', version: digest },
        role: 'reviewer',
        workspace: 'read',
        gate: false,
        effectiveGate: { value: true, source: 'stage-override-store' },
        verifyPolicy: 'adaptive',
        sessionReuse: {
          effective: 'same-invocation',
          authored: 'review-thread',
          source: 'definition',
        },
      })
    );

    for (const stage of view.stages) {
      const capability = profile.capabilities.find(
        (candidate) => candidate.nodeId === stage.profilePath
      );
      const policy = profile.policy.stages.find(
        (candidate) => candidate.nodeId === stage.profilePath
      );
      expect(capability?.authoredCapability).toEqual(stage.capability);
      expect(capability?.workspace.access).toBe(stage.workspace);
      expect(policy).toEqual(
        expect.objectContaining({
          role: stage.role,
          runtime: stage.runtime.value,
          gate: stage.effectiveGate.value,
          sandbox: stage.sandbox,
          sessionReuse: stage.sessionReuse.effective,
        })
      );
    }
  });

  it.each(['project', 'store', 'global'] as const)(
    'keeps %s logical-id overrides identical between inspection and the frozen launch profile',
    (scope) => {
      const prepared = EcpDefinitionModule.prepare(definition, catalog);
      if (!prepared.ok) throw prepared.error;
      const inputs = {
        overrides: {
          gates: new Map([
            ['review', { value: 'on' as const, scope }],
          ]),
          models: new Map([
            ['propose', { value: `gpt-${scope}`, scope }],
          ]),
          handoff: new Map([
            ['review', { value: 0.42, scope }],
          ]),
          runtimes: new Map([
            ['reviewer', { value: 'codex' as const, scope }],
          ]),
        },
        basePolicy: { effective: 'on' as const, source: 'default' as const },
        host: { runtime: 'claude' as const, source: 'process' as const },
      };
      const view = projectPreparedPipelineExecutionView(
        prepared.value,
        catalog,
        inputs
      );
      const profile = resolveRuntimeExecutionProfile(
        prepared.value,
        catalog,
        [],
        {
          layer: 'project',
          kind: 'pipeline-yaml',
          sourceId: 'project:prepared-view',
          authoredContentDigest: `sha256:${'a'.repeat(64)}`,
          semanticDigest: `sha256:${'b'.repeat(64)}`,
        },
        { maxAttempts: 3, maxActions: 64 },
        inputs
      );

      const review = view.stages.find((stage) => stage.id === 'review')!;
      const propose = view.stages.find((stage) => stage.id === 'propose')!;
      expect(review.effectiveGate).toEqual({
        value: true,
        source: `stage-override-${scope}`,
      });
      expect(review.runtime).toEqual({
        value: 'codex',
        source: `stage-override-${scope}`,
      });
      expect(review.handoff).toMatchObject({
        threshold: 0.42,
        source: `stage-override-${scope}`,
      });
      expect(propose.model).toEqual({
        value: `gpt-${scope}`,
        source: `stage-override-${scope}`,
      });

      for (const stage of view.stages) {
        const capability = profile.capabilities.find(
          (candidate) => candidate.nodeId === stage.profilePath
        );
        const policy = profile.policy.stages.find(
          (candidate) => candidate.nodeId === stage.profilePath
        );
        expect(capability?.authoredCapability).toEqual(stage.capability);
        expect(capability?.workspace.access).toBe(stage.workspace);
        expect(policy).toMatchObject({
          role: stage.role,
          runtime: stage.runtime.value,
          model: stage.model.value ?? 'default',
          gate: stage.effectiveGate.value,
          sandbox: stage.sandbox,
          sessionReuse: stage.sessionReuse.effective,
        });
      }
    }
  );

  it('preserves the v1 compatibility view through the same public boundary', () => {
    const source = {
      version: 1,
      name: 'legacy-view',
      description: 'compatibility input',
      stages: [
        {
          id: 'propose',
          skill: 'rasen-propose',
          role: 'planner',
          requires: [],
          gate: true,
        },
      ],
    };
    const prepared = EcpDefinitionModule.prepare(source, catalog);
    if (!prepared.ok) throw prepared.error;

    const view = projectPreparedPipelineExecutionView(prepared.value, catalog);

    expect(view.authoredVersion).toBe(1);
    expect(view.buildOrder).toEqual(['propose']);
    expect(view.stages).toEqual([
      expect.objectContaining({
        id: 'propose',
        profilePath: 'stage:propose',
        gate: true,
      }),
    ]);
  });

  it.each(['full-feature', 'goal-loop-measure'] as const)(
    'exposes every %s capability and policy path frozen by launch',
    async (name) => {
      const registry = await freezeProductionPreparedPipelineRegistry(undefined, {
        reporter: false,
      });
      const prepared = registry.load(name).prepared;
      const view = projectPreparedPipelineExecutionView(prepared, registry.catalog);
      const profile = resolveRuntimeExecutionProfile(
        prepared,
        registry.catalog,
        [],
        {
          layer: 'package',
          kind: 'pipeline-yaml',
          sourceId: `package:${name}`,
          authoredContentDigest: `sha256:${'a'.repeat(64)}`,
          semanticDigest: `sha256:${'b'.repeat(64)}`,
        },
        { maxAttempts: 3, maxActions: 64 }
      );

      expect(view.capabilityPaths.map((item) => item.profilePath).sort()).toEqual(
        profile.capabilities.map((item) => item.nodeId).sort()
      );
      expect(view.policyPaths.map((item) => item.profilePath).sort()).toEqual(
        profile.policy.stages.map((item) => item.nodeId).sort()
      );
      for (const capability of view.capabilityPaths) {
        const frozen = profile.capabilities.find(
          (candidate) => candidate.nodeId === capability.profilePath
        );
        expect(capability).toEqual({
          profilePath: frozen?.nodeId,
          capability: frozen?.authoredCapability,
          workspace: frozen?.workspace.access,
        });
      }
      for (const policy of view.policyPaths) {
        const frozen = profile.policy.stages.find(
          (candidate) => candidate.nodeId === policy.profilePath
        )!;
        expect(policy).toMatchObject({
          profilePath: frozen.nodeId,
          role: frozen.role,
          runtime: { value: frozen.runtime, source: frozen.provenance.runtime },
          model: {
            value: frozen.model === 'default' ? null : frozen.model,
            source: frozen.provenance.model,
          },
          effort: {
            value: frozen.effort === 'default' ? null : frozen.effort,
            source: frozen.provenance.effort,
          },
          sandbox: frozen.sandbox,
          effectiveGate: {
            value: frozen.gate,
            source: frozen.provenance.gate,
          },
          sessionReuse: {
            effective: frozen.sessionReuse,
            ...(frozen.sessionReuseAuthored !== undefined
              ? { authored: frozen.sessionReuseAuthored }
              : {}),
            source: frozen.provenance.sessionReuse,
          },
          handoffTokenLimit: {
            value: frozen.handoffTokenLimit,
            source: frozen.provenance.handoffTokenLimit,
          },
          reuseRoundLimit: {
            value: frozen.reuseRoundLimit,
            source: frozen.provenance.reuseRoundLimit,
          },
        });
      }

      if (name === 'full-feature') {
        expect(view.capabilityPaths.some((item) =>
          item.profilePath === 'root:experts'
        )).toBe(true);
      } else {
        expect(view.capabilityPaths.some((item) =>
          item.profilePath === 'root:iterate/strategy'
        )).toBe(true);
      }
    }
  );
});
