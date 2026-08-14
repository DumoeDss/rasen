import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  PipelineYamlSchema,
  createCapabilityCatalogSnapshot,
  projectPreparedPipelineExecutionView,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveDispatchRoute } from '../../../src/core/runtime-adapters.js';

const catalog = createCapabilityCatalogSnapshot([
  {
    id: 'skill:rasen-ship',
    version: `sha256:${'c'.repeat(64)}`,
    availability: 'enabled',
    inputs: [],
    artifacts: [{ name: 'result', type: 'artifact/json' }],
    outcomes: ['done'],
    limits: { maxActions: 8 },
  },
]);

function pipeline(model?: string) {
  return {
    version: 1,
    name: 'routed-pipeline',
    stages: [
      {
        id: 'ship',
        kind: 'standard',
        skill: 'rasen-ship',
        role: 'shipper',
        requires: [],
        gate: false,
        leadReview: false,
        runtime: 'codex',
        ...(model ? { model } : {}),
        inference: {
          broker: 'omnicross',
          upstream: { kind: 'provider', providerId: 'deepseek-api' },
        },
      },
    ],
  };
}

describe('Pipeline OmniCross inference', () => {
  it('preserves a credential-free declaration and projects effective runtime/model', () => {
    const parsed = PipelineYamlSchema.parse(pipeline('deepseek-chat'));
    const prepared = EcpDefinitionModule.prepare(parsed, catalog);
    if (!prepared.ok) throw prepared.error;
    const view = projectPreparedPipelineExecutionView(prepared.value, catalog, {
      overrides: { gates: new Map(), models: new Map(), handoff: new Map(), runtimes: new Map() },
      basePolicy: { effective: 'on', source: 'default' },
      host: { runtime: 'codex', source: 'process' },
    });
    expect(parsed.stages[0]?.inference).toEqual({
      broker: 'omnicross',
      upstream: { kind: 'provider', providerId: 'deepseek-api' },
    });
    expect(view.stages[0]).toMatchObject({
      runtime: { value: 'codex' },
      model: { value: 'deepseek-chat', source: 'stage' },
      dispatchMode: 'exec-bridge',
      bridge: 'codex-exec',
      inference: {
        broker: 'omnicross',
        runtime: 'codex',
        model: 'deepseek-chat',
        upstream: { kind: 'provider', providerId: 'deepseek-api' },
      },
    });
    expect(JSON.stringify(view)).not.toMatch(/token|credential|apiKey/i);
  });

  it('fails execution inspection when the routed stage has no effective model', () => {
    const parsed = PipelineYamlSchema.parse(pipeline());
    const prepared = EcpDefinitionModule.prepare(parsed, catalog);
    if (!prepared.ok) throw prepared.error;
    expect(() => projectPreparedPipelineExecutionView(prepared.value, catalog)).toThrow(
      /routed stage "ship" has no effective model/i
    );
  });

  it('keeps legacy stages source-compatible and explicitly reports no inference', () => {
    const legacy = pipeline('deepseek-chat');
    delete (legacy.stages[0] as { inference?: unknown }).inference;
    const parsed = PipelineYamlSchema.parse(legacy);
    const prepared = EcpDefinitionModule.prepare(parsed, catalog);
    if (!prepared.ok) throw prepared.error;
    const view = projectPreparedPipelineExecutionView(prepared.value, catalog, {
      overrides: { gates: new Map(), models: new Map(), handoff: new Map(), runtimes: new Map() },
      basePolicy: { effective: 'on', source: 'default' },
      host: { runtime: 'codex', source: 'process' },
    });
    expect(parsed.stages[0]).not.toHaveProperty('inference');
    expect(view.stages[0]).toMatchObject({ dispatchMode: 'native', inference: null });
  });

  it.each([
    { broker: 'omnicross', upstream: { kind: 'provider', providerId: 'p' }, token: 'secret' },
    { broker: 'omnicross', upstream: { kind: 'provider', providerId: 'p', apiKey: 'secret' } },
    { broker: 'omnicross', upstream: { kind: 'provider', providerId: 'p' }, baseUrl: 'http://x' },
  ])('rejects inference secrets and transport knobs', (inference) => {
    const value = pipeline('m');
    (value.stages[0] as { inference: unknown }).inference = inference;
    expect(PipelineYamlSchema.safeParse(value).success).toBe(false);
  });

  it('parses and projects native v2 AtomicStage inference', () => {
    const definition = {
      version: 2,
      id: 'pipeline:routed-v2',
      sourceId: 'project:routed-v2',
      name: 'routed-v2',
      description: 'routed v2 fixture',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [{
          id: 'ship',
          kind: 'AtomicStage',
          capability: { id: 'skill:rasen-ship', version: `sha256:${'c'.repeat(64)}` },
          execution: {
            version: 1,
            role: 'shipper',
            workspace: { access: 'write' },
            runtime: 'codex',
            model: 'deepseek-chat',
            inference: {
              broker: 'omnicross',
              upstream: { kind: 'account-pool', providerId: 'deepseek-api' },
            },
          },
        }],
        connections: [],
      },
    };
    const prepared = EcpDefinitionModule.prepare(definition, catalog);
    if (!prepared.ok) throw prepared.error;
    const view = projectPreparedPipelineExecutionView(prepared.value, catalog, {
      overrides: { gates: new Map(), models: new Map(), handoff: new Map(), runtimes: new Map() },
      basePolicy: { effective: 'on', source: 'default' },
      host: { runtime: 'codex', source: 'process' },
    });
    expect(view.stages[0]).toMatchObject({
      dispatchMode: 'exec-bridge',
      bridge: 'codex-exec',
      inference: {
        broker: 'omnicross',
        runtime: 'codex',
        model: 'deepseek-chat',
        upstream: { kind: 'account-pool', providerId: 'deepseek-api' },
      },
    });
  });
});

describe('routed host × target matrix', () => {
  it.each([
    ['claude', 'claude', 'claude-print'],
    ['claude', 'codex', 'codex-exec'],
    ['codex', 'claude', 'claude-print'],
    ['codex', 'codex', 'codex-exec'],
  ] as const)('forces %s -> %s through %s', (host, target, bridge) => {
    expect(resolveDispatchRoute(host, target, { externalInference: true })).toEqual({
      host,
      target,
      mode: 'exec-bridge',
      bridge,
    });
  });

  it.each(['claude', 'codex'] as const)(
    'fails closed for unknown host -> %s routed stages',
    (target) => {
      expect(resolveDispatchRoute('unknown', target, { externalInference: true })).toEqual({
        host: 'unknown',
        target,
        mode: 'unsupported',
      });
    }
  );

  // `omp` and `zed` are RECOGNIZED hosts that cannot dispatch, which makes them
  // the only inputs that separate the routed guard's two candidate conditions.
  // Every case above is satisfied by either `!hasRuntimeCapability(host,
  // 'canDispatch')` or `host === 'unknown'`; only these tell them apart.
  // Without them, reverting the guard to an `unknown` check leaves the whole
  // suite green while routing a non-dispatching host to the claude-print
  // bridge — the exact residual hazard `detectHostRuntime` documents.
  it.each([
    ['omp', 'claude'],
    ['omp', 'codex'],
    ['zed', 'claude'],
    ['zed', 'codex'],
  ] as const)(
    'fails closed for recognized non-dispatching host %s -> %s routed stages',
    (host, target) => {
      expect(resolveDispatchRoute(host, target, { externalInference: true })).toEqual({
        host,
        target,
        mode: 'unsupported',
      });
    }
  );
});
