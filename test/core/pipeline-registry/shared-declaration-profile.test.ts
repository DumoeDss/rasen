import { describe, expect, it } from 'vitest';

import {
  createProductionCapabilityCatalogSnapshot,
  EcpDefinitionModule,
} from '../../../src/core/pipeline-registry/index.js';
import { analyzeReconcilerSupport } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import {
  resolveDiscoveryReconcilerSupportProfile,
  resolveRuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/profile-resolver.js';
import type { Digest } from '../../../src/core/change-run/contracts.js';
import { loadWorkflowCatalog } from '../../../src/core/workflow-registry/index.js';
import { CANVAS_V2_AUTHORING_DEFINITION } from '../../../packages/ui/test/fixtures/canvas-v2-authoring.js';

describe('native-v2 shared declaration execution profile', () => {
  it('binds one declaration capability when CompositeRef and BoundedLoop reuse the same body', () => {
    const workflowCatalog = loadWorkflowCatalog();
    const enabled = new Set(
      workflowCatalog.definitions.map(
        (definition) => definition.skill.template.name
      )
    );
    const catalog = createProductionCapabilityCatalogSnapshot(
      workflowCatalog.definitions,
      enabled
    );
    const result = EcpDefinitionModule.prepare(
      CANVAS_V2_AUTHORING_DEFINITION,
      catalog
    );
    if (!result.ok) throw result.error;

    const discovery = resolveDiscoveryReconcilerSupportProfile(
      result.value,
      catalog
    );
    expect(discovery).not.toBeNull();
    expect(discovery!.capabilities.map((binding) => binding.nodeId).sort()).toEqual([
      'declaration:work-body/node:stage',
      'root:atomic-stage',
      'root:choice',
      'root:fan-out',
    ]);
    expect(analyzeReconcilerSupport(result.value, discovery).reconcilerSupport).toMatchObject({
      supported: true,
      reason: 'supported_v2_executable',
    });

    const profile = resolveRuntimeExecutionProfile(
      result.value,
      catalog,
      [],
      {
        layer: 'user',
        kind: 'pipeline-definition-v2',
        sourceId: result.value.definition.sourceId,
        authoredContentDigest: `sha256:${result.value.digests.source}` as Digest,
        semanticDigest: `sha256:${result.value.digests.source}` as Digest,
      },
      { maxAttempts: 3, maxActions: 64 }
    );
    expect(profile.capabilities.map((binding) => binding.nodeId)).toEqual([
      'declaration:work-body/node:stage',
      'root:atomic-stage',
      'root:choice',
      'root:fan-out',
    ]);
    expect(profile.policy.stages.map((stage) => stage.nodeId)).toEqual([
      'declaration:work-body/node:stage',
      'root:atomic-stage',
      'root:choice',
      'root:fan-out',
    ]);
  });
});
