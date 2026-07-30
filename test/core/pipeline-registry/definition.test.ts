import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type ChangeRunPlan,
  DefinitionReadError,
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  createProductionCapabilityCatalogSnapshot,
  parsePipeline,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';

const catalog = createCapabilityCatalogSnapshot([
  {
    id: 'skill:implement',
    version: '1.0.0',
    availability: 'enabled',
    inputs: [],
    artifacts: [{ name: 'patch', type: 'artifact/patch' }],
    outcomes: ['done'],
    limits: { maxActions: 8 },
  },
]);

function definitionWithNode(node: DefinitionSourceV2['root']['nodes'][number]): DefinitionSourceV2 {
  const declarations: DefinitionSourceV2['declarations'] =
    node.kind === 'CompositeRef'
      ? [
          {
            id: node.declarationId,
            kind: 'Composite',
            provenance: 'built-in',
            inputs: [],
            artifacts: [],
            outcomes: ['done'],
            graph: {
              nodes: [{ id: 'finish-composite', kind: 'Finish', outcome: 'done' }],
              connections: [],
            },
          },
        ]
      : node.kind === 'BoundedLoop'
        ? [
            {
              id: node.body,
              kind: 'Composite',
              provenance: 'custom',
              inputs: [],
              artifacts: [],
              outcomes: ['done'],
              graph: {
                nodes: [{ id: 'finish-loop-body', kind: 'Finish', outcome: 'done' }],
                connections: [],
              },
            },
          ]
        : [];

  const outcomes =
    node.kind === 'Choice' || node.kind === 'Gate'
      ? [...node.outcomes]
      : node.kind === 'FanOut'
        ? [...node.branches]
        : node.kind === 'Finish'
          ? [node.outcome]
          : node.kind === 'BoundedLoop'
            ? Object.values(node.exits)
                .filter((exit) => exit.action === 'exit')
                .map((exit) => exit.outcome)
            : ['done'];

  return {
    version: 2,
    id: `definition-${node.kind.toLowerCase()}`,
    sourceId: 'fixture:closed-vocabulary',
    name: `closed-${node.kind.toLowerCase()}`,
    inputs: [],
    artifacts: [],
    outcomes,
    declarations,
    root: { nodes: [node], connections: [] },
  };
}

describe('EcpDefinitionModule.prepare versioned definition contract', () => {
  it('accepts every closed v2 node discriminator', () => {
    const nodes: DefinitionSourceV2['root']['nodes'] = [
      {
        id: 'atomic',
        kind: 'AtomicStage',
        capability: { id: 'skill:implement', version: '1.0.0' },
      },
      { id: 'composite', kind: 'CompositeRef', declarationId: 'review-body' },
      {
        id: 'loop',
        kind: 'BoundedLoop',
        body: 'iteration-body',
        limits: { maxIterations: 3, maxActions: 8 },
        exits: { done: { action: 'exit', outcome: 'done' } },
      },
      { id: 'choice', kind: 'Choice', outcomes: ['accepted', 'rejected'] },
      { id: 'fanout', kind: 'FanOut', branches: ['a', 'b'] },
      { id: 'join', kind: 'Join', inputs: ['a', 'b'] },
      { id: 'gate', kind: 'Gate', outcomes: ['approved', 'rejected'] },
      { id: 'finish', kind: 'Finish', outcome: 'done' },
    ];

    for (const node of nodes) {
      const result = EcpDefinitionModule.prepare(definitionWithNode(node), catalog);
      expect(result.ok, node.kind).toBe(true);
      if (result.ok) {
        expect(result.value.definition.root.nodes[0]?.kind).toBe(node.kind);
      }
    }
  });

  it('preserves the authored v1 parser value and never mutates stored source data', () => {
    const storedSource = {
      name: 'legacy-compatible',
      description: 'Existing stored Pipeline',
      stages: [
        {
          id: 'implement',
          skill: 'rasen-apply-change',
          requires: [],
        },
      ],
    };
    const before = JSON.stringify(storedSource);
    const expectedParserValue = {
      version: 1,
      name: 'legacy-compatible',
      description: 'Existing stored Pipeline',
      stages: [
        {
          id: 'implement',
          kind: 'standard',
          skill: 'rasen-apply-change',
          requires: [],
          gate: false,
          leadReview: false,
        },
      ],
    };

    const result = EcpDefinitionModule.prepare(
      storedSource,
      createCapabilityCatalogSnapshot([])
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authoredSource).toEqual(expectedParserValue);
    }
    expect(JSON.stringify(storedSource)).toBe(before);
    expect(storedSource).not.toHaveProperty('version');
  });

  it('dispatches JSON and YAML text through the existing Pipeline syntax loader', () => {
    const yaml = `
name: syntax-dispatch
stages:
  - id: implement
    skill: rasen-apply-change
`;
    const json = JSON.stringify({
      name: 'syntax-dispatch',
      stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
    });

    const yamlResult = EcpDefinitionModule.prepare(yaml, createCapabilityCatalogSnapshot([]));
    const jsonResult = EcpDefinitionModule.prepare(json, createCapabilityCatalogSnapshot([]));

    expect(yamlResult.ok).toBe(true);
    expect(jsonResult.ok).toBe(true);
    if (yamlResult.ok && jsonResult.ok) {
      expect(yamlResult.value.authoredSource).toEqual(jsonResult.value.authoredSource);
      expect(yamlResult.value.digests.source).toBe(jsonResult.value.digests.source);
    }
  });

  it('rejects an unsupported explicit version with an actionable /version diagnostic', () => {
    const result = EcpDefinitionModule.prepare(
      { version: 99, name: 'future-definition' },
      catalog
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual([
        expect.objectContaining({
          severity: 'error',
          code: 'UNSUPPORTED_VERSION',
          path: '/version',
        }),
      ]);
      expect(result.error.diagnostics[0]?.message).toContain('received 99');
      expect(result.error.diagnostics[0]?.message).toContain('supported versions are 1 and 2');
      expect(result.error.diagnostics[0]?.message).toContain('upgrade');
    }
  });

  it.each([
    {
      name: 'Choice without outcomes',
      mutate(source: Record<string, unknown>) {
        source.root = {
          nodes: [{ id: 'choice', kind: 'Choice' }],
          connections: [],
        };
      },
      path: '/root/nodes/0/outcomes',
    },
    {
      name: 'connection without endpoints',
      mutate(source: Record<string, unknown>) {
        source.root = {
          nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
          connections: [{}],
        };
      },
      path: '/root/connections/0/id',
    },
    {
      name: 'Composite declaration without a graph',
      mutate(source: Record<string, unknown>) {
        source.declarations = [
          {
            id: 'body',
            kind: 'Composite',
            provenance: 'custom',
            inputs: [],
            artifacts: [],
            outcomes: ['done'],
          },
        ];
      },
      path: '/declarations/0/graph',
    },
  ])('returns diagnostics instead of throwing for $name', ({ mutate, path }) => {
    const source = structuredClone(
      definitionWithNode({ id: 'finish', kind: 'Finish', outcome: 'done' })
    ) as unknown as Record<string, unknown>;
    mutate(source);

    expect(() => EcpDefinitionModule.prepare(source, catalog)).not.toThrow();
    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'INVALID_SOURCE', path })
      );
    }
  });

  it('rejects an unknown node kind in every Composite graph', () => {
    const source = definitionWithNode({
      id: 'call-body',
      kind: 'CompositeRef',
      declarationId: 'review-body',
    }) as unknown as Record<string, unknown>;
    const declarations = source.declarations as Array<Record<string, unknown>>;
    const graph = declarations[0]!.graph as Record<string, unknown>;
    graph.nodes = [{ id: 'future', kind: 'FutureNode' }];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'UNKNOWN_NODE_KIND',
          path: '/declarations/0/graph/nodes/0/kind',
        })
      );
    }
  });

  it('aggregates and orders independent recursive shape diagnostics', () => {
    const source = {
      version: 2,
      id: '',
      sourceId: 'fixture:malformed',
      name: 'malformed',
      inputs: [{ name: 42 }],
      artifacts: [{}],
      outcomes: ['done', 7],
      declarations: [
        {
          id: 'body',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [{}],
          },
        },
      ],
      root: {
        nodes: [{ id: 'finish', kind: 'Finish' }],
        connections: [],
      },
    };

    expect(() => EcpDefinitionModule.prepare(source, catalog)).not.toThrow();
    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.error.diagnostics.map((item) => item.path);
      expect(paths).toEqual([...paths].sort());
      expect(paths).toEqual(
        expect.arrayContaining([
          '/artifacts/0/name',
          '/declarations/0/graph/connections/0/id',
          '/declarations/0/graph/nodes/0/outcomes',
          '/id',
          '/inputs/0/name',
          '/outcomes/1',
          '/root/nodes/0/outcome',
        ])
      );
    }
  });
});

describe('legacy semantic normalization', () => {
  it('normalizes stage DAG, gate, condition, and loop controls with path-independent stable identities', () => {
    const windowsSource = `
name: legacy-controls
sourcePath: C:\\work\\pipelines\\legacy-controls\\pipeline.yaml
stages:
  - id: plan
    skill: rasen-goal-plan
    condition: ui
  - id: implement
    skill: rasen-goal-iterate
    requires: [plan]
    gate: true
    loop:
      kind: review-cycle
      maxRounds: 4
`;
    const posixSource = `
sourcePath: /work/pipelines/legacy-controls/pipeline.yaml
stages:
  - loop: { maxRounds: 4, kind: review-cycle }
    gate: true
    requires:
      - plan
    skill: rasen-goal-iterate
    id: implement
  - condition: ui
    skill: rasen-goal-plan
    id: plan
name: legacy-controls
`;

    const windowsResult = EcpDefinitionModule.prepare(
      windowsSource,
      createCapabilityCatalogSnapshot([])
    );
    const posixResult = EcpDefinitionModule.prepare(
      posixSource,
      createCapabilityCatalogSnapshot([])
    );

    expect(windowsResult.ok).toBe(true);
    expect(posixResult.ok).toBe(true);
    if (windowsResult.ok && posixResult.ok) {
      expect(
        windowsResult.value.definition.root.nodes.map(({ id, kind }) => ({ id, kind }))
      ).toEqual([
        { id: 'condition:plan', kind: 'Choice' },
        { id: 'stage:implement', kind: 'BoundedLoop' },
        { id: 'stage:plan', kind: 'AtomicStage' },
      ]);
      expect(windowsResult.value.definition.root.connections).toEqual([
        {
          id: 'stage:plan->stage:implement',
          from: { node: 'stage:plan', port: 'done' },
          to: { node: 'stage:implement', port: 'start' },
        },
      ]);
      expect(windowsResult.value.digests.source).toBe(posixResult.value.digests.source);
      expect(windowsResult.value.digests.plan).toBe(posixResult.value.digests.plan);
      expect(windowsResult.value.definition.legacyRuntime).toEqual(
        expect.objectContaining({ owner: 'prompt-owned-v1' })
      );
    }
  });
});

describe('Composite declaration normalization', () => {
  it('compiles equivalent built-in and Custom declarations through one semantic model', () => {
    const definition = definitionWithNode({
      id: 'call-review',
      kind: 'CompositeRef',
      declarationId: 'review-body',
    });
    const builtIn = structuredClone(definition);
    const custom = structuredClone(definition);
    builtIn.declarations[0]!.provenance = 'built-in';
    custom.declarations[0]!.provenance = 'custom';

    const builtInResult = EcpDefinitionModule.prepare(builtIn, catalog);
    const customResult = EcpDefinitionModule.prepare(custom, catalog);

    expect(builtInResult.ok).toBe(true);
    expect(customResult.ok).toBe(true);
    if (builtInResult.ok && customResult.ok) {
      expect(builtInResult.value.digests.source).toBe(customResult.value.digests.source);
      expect(builtInResult.value.digests.plan).toBe(customResult.value.digests.plan);
      expect(builtInResult.value.definition.declarations[0]?.provenance).toBe('built-in');
      expect(customResult.value.definition.declarations[0]?.provenance).toBe('custom');
    }
  });

  it('discovers recursive Composite references by stable declaration identity', () => {
    const recursive: DefinitionSourceV2 = {
      version: 2,
      id: 'recursive-definition',
      sourceId: 'fixture:recursive',
      name: 'recursive',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'review-body',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              {
                id: 'recursive-call',
                kind: 'CompositeRef',
                declarationId: 'review-body',
              },
            ],
            connections: [],
          },
        },
      ],
      root: {
        nodes: [
          {
            id: 'root-call',
            kind: 'CompositeRef',
            declarationId: 'review-body',
          },
        ],
        connections: [],
      },
    };

    const result = EcpDefinitionModule.prepare(recursive, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'COMPOSITE_RECURSION',
          path: '/declarations/0/graph/nodes/0/declarationId',
          related: expect.arrayContaining([
            expect.objectContaining({ path: '/declarations/0' }),
          ]),
        }),
      ]));
    }
  });

  it('rejects indirect Composite recursion at the closing call site', () => {
    const recursive: DefinitionSourceV2 = {
      ...definitionWithNode({
        id: 'root-call',
        kind: 'CompositeRef',
        declarationId: 'a',
      }),
      declarations: [
        {
          id: 'a',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [{ id: 'call-b', kind: 'CompositeRef', declarationId: 'b' }],
            connections: [],
          },
        },
        {
          id: 'b',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [{ id: 'call-a', kind: 'CompositeRef', declarationId: 'a' }],
            connections: [],
          },
        },
      ],
    };

    const result = EcpDefinitionModule.prepare(recursive, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'COMPOSITE_RECURSION',
          path: '/declarations/1/graph/nodes/0/declarationId',
        })
      );
    }
  });
});

describe('trusted capability catalog admission', () => {
  it('adapts the installed workflow catalog into one immutable production snapshot', () => {
    const snapshot = createProductionCapabilityCatalogSnapshot(
      [
        {
          id: 'rasen-review',
          digest: 'review-revision',
          skill: { template: { name: 'rasen-review' } },
        },
        {
          id: 'rasen-apply-change',
          digest: 'apply-revision',
          skill: { template: { name: 'rasen-apply-change' } },
        },
      ],
      new Set(['rasen-apply-change'])
    );

    expect(snapshot.descriptors.map(({ id, version, availability }) => ({
      id,
      version,
      availability,
    }))).toEqual([
      {
        id: 'skill:rasen-apply-change',
        version: 'apply-revision',
        availability: 'enabled',
      },
      {
        id: 'skill:rasen-review',
        version: 'review-revision',
        availability: 'disabled',
      },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.descriptors)).toBe(true);
    expect(Object.isFrozen(snapshot.descriptors[0])).toBe(true);
  });

  it.each([
    {
      name: 'missing',
      descriptors: [],
      version: '1.0.0',
      code: 'CAPABILITY_MISSING',
    },
    {
      name: 'disabled',
      descriptors: [{ ...catalog.descriptors[0]!, availability: 'disabled' as const }],
      version: '1.0.0',
      code: 'CAPABILITY_DISABLED',
    },
    {
      name: 'forbidden',
      descriptors: [{ ...catalog.descriptors[0]!, availability: 'forbidden' as const }],
      version: '1.0.0',
      code: 'CAPABILITY_FORBIDDEN',
    },
    {
      name: 'version changed',
      descriptors: [{ ...catalog.descriptors[0]!, version: '2.0.0' }],
      version: '1.0.0',
      code: 'CAPABILITY_VERSION_MISMATCH',
    },
  ])('reports a distinct $name capability diagnostic', ({ descriptors, version, code }) => {
    const source = definitionWithNode({
      id: 'atomic',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version },
    });

    const result = EcpDefinitionModule.prepare(
      source,
      createCapabilityCatalogSnapshot(descriptors)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code,
          path: '/root/nodes/0/capability',
        })
      );
    }
  });

  it('rejects duplicate capability identity/version pairs before preparation', () => {
    let thrown: unknown;
    try {
      createCapabilityCatalogSnapshot([
        catalog.descriptors[0]!,
        { ...catalog.descriptors[0]!, availability: 'forbidden' },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DefinitionReadError);
    expect((thrown as DefinitionReadError).diagnostics).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_CATALOG_DESCRIPTOR',
        path: '/descriptors/1',
      }),
    ]);
  });

  /**
   * ECP-5 Blocker regression. EVERY production descriptor is built with
   * `inputs: []` and `outcomes: ['done']`
   * (`createProductionCapabilityCatalogSnapshot`), so before the fix an
   * AtomicStage backed by a real capability had NO declared input port and any
   * authored connection targeting it was refused with PORT_MISMATCH — root
   * graph and declaration body alike. That made Canvas-authored v2 connections
   * unsaveable in production while the fixture-catalog tests (which declare
   * ports no real skill declares) stayed green.
   *
   * A capability with no typed inputs is joined by control flow, exactly like a
   * Gate or FanOut, so it accepts the same `CONTROL_INPUT_PORTS`.
   */
  it('admits a control-port connection between capabilities that declare no inputs', () => {
    const productionShaped = createCapabilityCatalogSnapshot([
      {
        id: 'skill:rasen-apply-change',
        version: 'sha256:abc',
        availability: 'enabled',
        // Exactly what the production adapter emits for every skill.
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        limits: {},
      },
    ]);
    const stageNode = (id: string) => ({
      id,
      kind: 'AtomicStage' as const,
      capability: { id: 'skill:rasen-apply-change', version: 'sha256:abc' },
    });

    // Every conventional control port name the kernel accepts — the Canvas
    // emits `input`; `in` and `start` are the documented aliases.
    for (const port of ['input', 'in', 'start']) {
      const source: DefinitionSourceV2 = {
        version: 2,
        id: 'control-ports',
        sourceId: 'fixture:control-ports',
        name: 'control-ports',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [stageNode('stage'), stageNode('stage-2')],
          connections: [
            {
              id: 'stage-to-stage-2',
              from: { node: 'stage', port: 'done' },
              to: { node: 'stage-2', port },
            },
          ],
        },
      };
      const result = EcpDefinitionModule.prepare(source, productionShaped);
      expect(result.ok, `port '${port}' should be admitted`).toBe(true);
    }

    // The widening is scoped to the no-typed-inputs case: an unknown port name
    // is still refused, so the rule this validation exists to provide holds.
    const bogus: DefinitionSourceV2 = {
      version: 2,
      id: 'control-ports-bogus',
      sourceId: 'fixture:control-ports',
      name: 'control-ports-bogus',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [stageNode('stage'), stageNode('stage-2')],
        connections: [
          {
            id: 'stage-to-stage-2',
            from: { node: 'stage', port: 'done' },
            to: { node: 'stage-2', port: 'inpt' },
          },
        ],
      },
    };
    const rejected = EcpDefinitionModule.prepare(bogus, productionShaped);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.diagnostics).toEqual([
        expect.objectContaining({ code: 'PORT_MISMATCH' }),
      ]);
    }
  });

  it('keeps a typed capability restricted to its declared input ports', () => {
    // The other half of the scoping: a descriptor that DOES declare inputs must
    // NOT gain control ports, or the widening would loosen validation for the
    // typed capabilities it was carefully kept away from.
    const typedCatalog = createCapabilityCatalogSnapshot([
      {
        id: 'skill:typed',
        version: '1.0.0',
        availability: 'enabled',
        inputs: [{ name: 'patch', type: 'ecp/control' }],
        artifacts: [],
        outcomes: ['done'],
        limits: {},
      },
    ]);
    const stageNode = (id: string) => ({
      id,
      kind: 'AtomicStage' as const,
      capability: { id: 'skill:typed', version: '1.0.0' },
    });
    const source: DefinitionSourceV2 = {
      version: 2,
      id: 'typed-inputs',
      sourceId: 'fixture:typed-inputs',
      name: 'typed-inputs',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [stageNode('stage'), stageNode('stage-2')],
        connections: [
          {
            id: 'stage-to-stage-2',
            from: { node: 'stage', port: 'done' },
            // `input` is a CONTROL port, not one this descriptor declares.
            to: { node: 'stage-2', port: 'input' },
          },
        ],
      },
    };
    const result = EcpDefinitionModule.prepare(source, typedCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual([
        expect.objectContaining({ code: 'PORT_MISMATCH' }),
      ]);
    }
  });

  it('reports typed producer and consumer port incompatibility with both endpoints', () => {
    const source: DefinitionSourceV2 = {
      version: 2,
      id: 'typed-ports',
      sourceId: 'fixture:typed-ports',
      name: 'typed-ports',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [
          {
            id: 'produce',
            kind: 'AtomicStage',
            capability: { id: 'skill:produce', version: '1.0.0' },
          },
          {
            id: 'consume',
            kind: 'AtomicStage',
            capability: { id: 'skill:consume', version: '1.0.0' },
          },
        ],
        connections: [
          {
            id: 'patch-to-consumer',
            from: { node: 'produce', port: 'patch' },
            to: { node: 'consume', port: 'patch' },
          },
        ],
      },
    };
    const typedCatalog = createCapabilityCatalogSnapshot([
      {
        id: 'skill:produce',
        version: '1.0.0',
        availability: 'enabled',
        inputs: [],
        artifacts: [{ name: 'patch', type: 'artifact/patch' }],
        outcomes: ['done'],
        limits: {},
      },
      {
        id: 'skill:consume',
        version: '1.0.0',
        availability: 'enabled',
        inputs: [{ name: 'patch', type: 'artifact/text' }],
        artifacts: [],
        outcomes: ['done'],
        limits: {},
      },
    ]);

    const result = EcpDefinitionModule.prepare(source, typedCatalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PORT_MISMATCH',
          path: '/root/connections/0/to/port',
          related: [
            expect.objectContaining({ path: '/root/connections/0/from/port' }),
          ],
        }),
      ]);
    }
  });

  it.each([
    ['AtomicStage', {
      id: 'subject',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version: '1.0.0' },
    }],
    ['CompositeRef', {
      id: 'subject',
      kind: 'CompositeRef',
      declarationId: 'review-body',
    }],
    ['BoundedLoop', {
      id: 'subject',
      kind: 'BoundedLoop',
      body: 'iteration-body',
      limits: { maxIterations: 2 },
      exits: { done: { action: 'exit', outcome: 'done' } },
    }],
    ['Choice', { id: 'subject', kind: 'Choice', outcomes: ['yes', 'no'] }],
    ['FanOut', { id: 'subject', kind: 'FanOut', branches: ['left', 'right'] }],
    ['Join', { id: 'subject', kind: 'Join', inputs: ['left', 'right'] }],
    ['Gate', { id: 'subject', kind: 'Gate', outcomes: ['approved', 'rejected'] }],
    ['Finish', { id: 'subject', kind: 'Finish', outcome: 'done' }],
  ] as const)('rejects undeclared %s producer output ports', (_kind, node) => {
    const source = definitionWithNode(
      structuredClone(node) as DefinitionSourceV2['root']['nodes'][number]
    );
    source.root.nodes = [
      ...source.root.nodes,
      { id: 'consumer', kind: 'Gate', outcomes: ['done'] },
    ];
    source.root.connections = [
      {
        id: 'invalid-output',
        from: { node: 'subject', port: 'not-an-output' },
        to: { node: 'consumer', port: 'input' },
      },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PORT_MISMATCH',
          path: '/root/connections/0/from/port',
        })
      );
    }
  });

  it.each([
    ['AtomicStage', {
      id: 'subject',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version: '1.0.0' },
    }],
    ['CompositeRef', {
      id: 'subject',
      kind: 'CompositeRef',
      declarationId: 'review-body',
    }],
    ['BoundedLoop', {
      id: 'subject',
      kind: 'BoundedLoop',
      body: 'iteration-body',
      limits: { maxIterations: 2 },
      exits: { done: { action: 'exit', outcome: 'done' } },
    }],
    ['Choice', { id: 'subject', kind: 'Choice', outcomes: ['yes', 'no'] }],
    ['FanOut', { id: 'subject', kind: 'FanOut', branches: ['left', 'right'] }],
    ['Join', { id: 'subject', kind: 'Join', inputs: ['left', 'right'] }],
    ['Gate', { id: 'subject', kind: 'Gate', outcomes: ['approved', 'rejected'] }],
    ['Finish', { id: 'subject', kind: 'Finish', outcome: 'done' }],
  ] as const)('rejects undeclared %s consumer input ports', (_kind, node) => {
    const source = definitionWithNode(
      structuredClone(node) as DefinitionSourceV2['root']['nodes'][number]
    );
    source.root.nodes = [
      { id: 'producer', kind: 'Gate', outcomes: ['approved'] },
      ...source.root.nodes,
    ];
    source.root.connections = [
      {
        id: 'invalid-input',
        from: { node: 'producer', port: 'approved' },
        to: { node: 'subject', port: 'not-an-input' },
      },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PORT_MISMATCH',
          path: '/root/connections/0/to/port',
          related: [
            expect.objectContaining({ path: '/root/connections/0/from/port' }),
          ],
        })
      );
    }
  });

  it('validates CompositeRef declared input types at the connection seam', () => {
    const source = definitionWithNode({
      id: 'consume',
      kind: 'CompositeRef',
      declarationId: 'review-body',
    });
    source.declarations[0]!.inputs = [
      { name: 'document', type: 'artifact/text' },
    ];
    source.root.nodes = [
      {
        id: 'produce',
        kind: 'AtomicStage',
        capability: { id: 'skill:implement', version: '1.0.0' },
      },
      ...source.root.nodes,
    ];
    source.root.connections = [
      {
        id: 'typed-composite-binding',
        from: { node: 'produce', port: 'patch' },
        to: { node: 'consume', port: 'document' },
      },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'PORT_MISMATCH',
          path: '/root/connections/0/to/port',
        })
      );
    }
  });
});

describe('semantic canonical digests', () => {
  it('uses one locale-independent Unicode order across explicit locale inputs', () => {
    const values = ['z', 'ä', 'å'];
    const englishOrder = [...values].sort(new Intl.Collator('en').compare);
    const swedishOrder = [...values].sort(new Intl.Collator('sv').compare);
    expect(englishOrder).not.toEqual(swedishOrder);

    const source = definitionWithNode({
      id: 'choice-å',
      kind: 'Choice',
      outcomes: englishOrder,
    });
    source.outcomes = englishOrder;
    const reordered = structuredClone(source);
    reordered.outcomes = swedishOrder;
    const choice = reordered.root.nodes[0]!;
    if (choice.kind === 'Choice') choice.outcomes = swedishOrder;

    const english = EcpDefinitionModule.prepare(source, catalog);
    const swedish = EcpDefinitionModule.prepare(reordered, catalog);

    expect(english.ok).toBe(true);
    expect(swedish.ok).toBe(true);
    if (english.ok && swedish.ok) {
      expect(english.value.definition).toEqual(swedish.value.definition);
      expect(english.value.digests).toEqual(swedish.value.digests);
      expect(JSON.stringify(english.value.plan)).toBe(
        JSON.stringify(swedish.value.plan)
      );
    }
  });

  it('ignores presentation, independent ordering, platform paths, and unused catalog revisions', () => {
    const source = definitionWithNode({
      id: 'atomic',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version: '1.0.0' },
    });
    const reordered: DefinitionSourceV2 = {
      ...structuredClone(source),
      sourcePath: 'C:\\workspace\\pipeline.yaml',
      canvas: { position: { x: 42, y: 17 } },
      outcomes: [...source.outcomes].reverse(),
      root: {
        ...structuredClone(source.root),
        nodes: [...source.root.nodes].reverse(),
        connections: [...source.root.connections].reverse(),
      },
    };
    const withUnusedV1 = createCapabilityCatalogSnapshot([
      {
        id: 'skill:unused',
        version: '1.0.0',
        availability: 'enabled',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        limits: {},
      },
      catalog.descriptors[0]!,
    ]);
    const withUnusedV2Reordered = createCapabilityCatalogSnapshot([
      catalog.descriptors[0]!,
      {
        id: 'skill:unused',
        version: '2.0.0',
        availability: 'enabled',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        limits: {},
      },
    ]);

    const left = EcpDefinitionModule.prepare(source, withUnusedV1);
    const right = EcpDefinitionModule.prepare(reordered, withUnusedV2Reordered);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok && right.ok) {
      expect(left.value.digests).toEqual(right.value.digests);
      expect(left.value.digests).toEqual({
        source: '1fa649b71e15f24e2ad8161dc661072fd6fc10b47779262269c0deb427076680',
        capability: '16f7bc68733102f33266a4976ab9467152ade2d78cf768f971cb812f0bad72e3',
        plan: '10fc90ad8978e02ba42e67405439b1dd10f3ebf34c37b48790f1db703adc035f',
      });
      expect(JSON.stringify(left.value.plan)).toBe(JSON.stringify(right.value.plan));
    }
  });

  it('changes source and plan digests for a semantic node identity edit', () => {
    const before = definitionWithNode({
      id: 'atomic-before',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version: '1.0.0' },
    });
    const after = structuredClone(before);
    after.root.nodes[0]!.id = 'atomic-after';

    const beforeResult = EcpDefinitionModule.prepare(before, catalog);
    const afterResult = EcpDefinitionModule.prepare(after, catalog);

    expect(beforeResult.ok).toBe(true);
    expect(afterResult.ok).toBe(true);
    if (beforeResult.ok && afterResult.ok) {
      expect(beforeResult.value.digests.source).not.toBe(afterResult.value.digests.source);
      expect(beforeResult.value.digests.plan).not.toBe(afterResult.value.digests.plan);
      expect(beforeResult.value.digests.capability).toBe(afterResult.value.digests.capability);
    }
  });
});

function loopDefinition(
  exits: DefinitionSourceV2['root']['nodes'][number] extends infer _Node
    ? Record<string, { action: 'continue' } | { action: 'exit'; outcome: string }>
    : never
): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'loop-definition',
    sourceId: 'fixture:loop-validation',
    name: 'loop-validation',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [
      {
        id: 'body',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [{ id: 'body-finish', kind: 'Finish', outcome: 'done' }],
          connections: [],
        },
      },
    ],
    root: {
      nodes: [
        {
          id: 'loop',
          kind: 'BoundedLoop',
          body: 'body',
          limits: { maxIterations: 3, maxActions: 4 },
          exits,
        },
      ],
      connections: [],
    },
  };
}

function authoredContractDefinition(): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'authored-contract-identities',
    sourceId: 'fixture:authored-contract-identities',
    name: 'authored-contract-identities',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [
      {
        id: 'body',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [{ id: 'body-finish', kind: 'Finish', outcome: 'done' }],
          connections: [],
        },
      },
    ],
    root: {
      nodes: [{ id: 'root-finish', kind: 'Finish', outcome: 'done' }],
      connections: [],
    },
  };
}

describe('authored contract identity validation', () => {
  const duplicateCases: readonly Readonly<{
    name: string;
    mutate: (source: DefinitionSourceV2) => void;
    path: string;
    firstPath: string;
  }>[] = [
    {
      name: 'Definition inputs even when their types differ',
      mutate: (source) => {
        source.inputs = [
          { name: 'payload', type: 'text/plain' },
          { name: 'payload', type: 'application/json' },
        ];
      },
      path: '/inputs/1/name',
      firstPath: '/inputs/0/name',
    },
    {
      name: 'Definition artifacts even when their types differ',
      mutate: (source) => {
        source.artifacts = [
          { name: 'result', type: 'text/plain' },
          { name: 'result', type: 'application/json' },
        ];
      },
      path: '/artifacts/1/name',
      firstPath: '/artifacts/0/name',
    },
    {
      name: 'Definition outcomes',
      mutate: (source) => {
        source.outcomes = ['done', 'done'];
      },
      path: '/outcomes/1',
      firstPath: '/outcomes/0',
    },
    {
      name: 'Definition artifacts and outcomes that share one output identity',
      mutate: (source) => {
        source.artifacts = [{ name: 'done', type: 'artifact/report' }];
      },
      path: '/outcomes/0',
      firstPath: '/artifacts/0/name',
    },
    {
      name: 'Composite inputs even when their types differ',
      mutate: (source) => {
        source.declarations[0]!.inputs = [
          { name: 'payload', type: 'text/plain' },
          { name: 'payload', type: 'application/json' },
        ];
      },
      path: '/declarations/0/inputs/1/name',
      firstPath: '/declarations/0/inputs/0/name',
    },
    {
      name: 'Composite artifacts even when their types differ',
      mutate: (source) => {
        source.declarations[0]!.artifacts = [
          { name: 'result', type: 'text/plain' },
          { name: 'result', type: 'application/json' },
        ];
      },
      path: '/declarations/0/artifacts/1/name',
      firstPath: '/declarations/0/artifacts/0/name',
    },
    {
      name: 'Composite outcomes',
      mutate: (source) => {
        source.declarations[0]!.outcomes = ['done', 'done'];
      },
      path: '/declarations/0/outcomes/1',
      firstPath: '/declarations/0/outcomes/0',
    },
    {
      name: 'Composite artifacts and outcomes that share one output identity',
      mutate: (source) => {
        source.declarations[0]!.artifacts = [
          { name: 'done', type: 'artifact/report' },
        ];
      },
      path: '/declarations/0/outcomes/0',
      firstPath: '/declarations/0/artifacts/0/name',
    },
    {
      name: 'Choice outcomes',
      mutate: (source) => {
        source.root.nodes = [
          { id: 'choice', kind: 'Choice', outcomes: ['done', 'done'] },
        ];
      },
      path: '/root/nodes/0/outcomes/1',
      firstPath: '/root/nodes/0/outcomes/0',
    },
    {
      name: 'Gate outcomes',
      mutate: (source) => {
        source.root.nodes = [
          { id: 'gate', kind: 'Gate', outcomes: ['done', 'done'] },
        ];
      },
      path: '/root/nodes/0/outcomes/1',
      firstPath: '/root/nodes/0/outcomes/0',
    },
    {
      name: 'FanOut branches',
      mutate: (source) => {
        source.root.nodes = [
          { id: 'fanout', kind: 'FanOut', branches: ['done', 'done'] },
        ];
      },
      path: '/root/nodes/0/branches/1',
      firstPath: '/root/nodes/0/branches/0',
    },
    {
      name: 'Join inputs',
      mutate: (source) => {
        source.root.nodes = [
          { id: 'join', kind: 'Join', inputs: ['left', 'left'] },
        ];
      },
      path: '/root/nodes/0/inputs/1',
      firstPath: '/root/nodes/0/inputs/0',
    },
    {
      name: 'BoundedLoop terminal exit outputs',
      mutate: (source) => {
        source.declarations[0]!.outcomes = ['accepted', 'rejected'];
        source.declarations[0]!.graph.nodes = [
          { id: 'accepted', kind: 'Finish', outcome: 'accepted' },
          { id: 'rejected', kind: 'Finish', outcome: 'rejected' },
        ];
        source.root.nodes = [
          {
            id: 'loop',
            kind: 'BoundedLoop',
            body: 'body',
            limits: { maxIterations: 2 },
            exits: {
              accepted: { action: 'exit', outcome: 'done' },
              rejected: { action: 'exit', outcome: 'done' },
            },
          },
        ];
      },
      path: '/root/nodes/0/exits/rejected/outcome',
      firstPath: '/root/nodes/0/exits/accepted/outcome',
    },
  ];

  it.each(duplicateCases)(
    'rejects duplicate owner-local $name before contract maps can collapse it',
    ({ mutate, path, firstPath }) => {
      const source = authoredContractDefinition();
      mutate(source);

      const result = EcpDefinitionModule.prepare(source, catalog);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.diagnostics).toContainEqual(
          expect.objectContaining({
            severity: 'error',
            code: 'DUPLICATE_ID',
            path,
            related: [
              expect.objectContaining({
                path: firstPath,
              }),
            ],
          })
        );
      }
    }
  );

  it('keeps owner scopes independent for identical contract names', () => {
    const source = authoredContractDefinition();
    source.inputs = [{ name: 'shared', type: 'text/plain' }];
    source.declarations = [
      {
        ...source.declarations[0]!,
        id: 'first',
        inputs: [{ name: 'shared', type: 'text/plain' }],
        outcomes: ['shared'],
        graph: {
          nodes: [{ id: 'first-finish', kind: 'Finish', outcome: 'shared' }],
          connections: [],
        },
      },
      {
        ...source.declarations[0]!,
        id: 'second',
        inputs: [{ name: 'shared', type: 'application/json' }],
        outcomes: ['shared'],
        graph: {
          nodes: [{ id: 'second-finish', kind: 'Finish', outcome: 'shared' }],
          connections: [],
        },
      },
    ];
    source.outcomes = ['shared'];
    source.root.nodes = [
      { id: 'choice', kind: 'Choice', outcomes: ['shared'] },
      { id: 'gate', kind: 'Gate', outcomes: ['shared'] },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(true);
  });

  it('keeps one owner input namespace independent from its output namespace', () => {
    const source = authoredContractDefinition();
    source.inputs = [{ name: 'shared', type: 'text/plain' }];
    source.artifacts = [{ name: 'shared', type: 'artifact/report' }];
    source.declarations[0]!.inputs = [
      { name: 'shared', type: 'application/json' },
    ];
    source.declarations[0]!.artifacts = [
      { name: 'shared', type: 'artifact/report' },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(true);
  });

  it('reports every later duplicate in canonical path order and relates each to the first authored occurrence', () => {
    const source = authoredContractDefinition();
    source.inputs = [
      { name: 'payload', type: 'text/plain' },
      { name: 'payload', type: 'application/json' },
      { name: 'payload', type: 'application/octet-stream' },
    ];
    source.artifacts = [
      { name: 'result', type: 'text/plain' },
      { name: 'result', type: 'application/json' },
    ];
    source.outcomes = ['done', 'done'];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.error.diagnostics
          .filter((item) => item.code === 'DUPLICATE_ID')
          .map((item) => ({
            path: item.path,
            firstPath: item.related?.[0]?.path,
          }))
      ).toEqual([
        { path: '/artifacts/1/name', firstPath: '/artifacts/0/name' },
        { path: '/inputs/1/name', firstPath: '/inputs/0/name' },
        { path: '/inputs/2/name', firstPath: '/inputs/0/name' },
        { path: '/outcomes/1', firstPath: '/outcomes/0' },
      ]);
    }
  });

  it('preserves independently provable graph diagnostics alongside duplicate contracts', () => {
    const source = authoredContractDefinition();
    source.inputs = [
      { name: 'payload', type: 'text/plain' },
      { name: 'payload', type: 'application/json' },
    ];
    source.root = {
      nodes: [{ id: 'gate', kind: 'Gate', outcomes: ['done'] }],
      connections: [
        {
          id: 'dangling',
          from: { node: 'gate', port: 'done' },
          to: { node: 'absent', port: 'input' },
        },
      ],
    };

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.error.diagnostics
          .filter((item) =>
            ['DUPLICATE_ID', 'UNKNOWN_REFERENCE'].includes(item.code)
          )
          .map((item) => ({ code: item.code, path: item.path }))
      ).toEqual([
        { code: 'DUPLICATE_ID', path: '/inputs/1/name' },
        {
          code: 'UNKNOWN_REFERENCE',
          path: '/root/connections/0/to/node',
        },
      ]);
    }
  });
});

describe('whole-definition validation', () => {
  it.each([
    {
      name: 'duplicate identities',
      code: 'DUPLICATE_ID',
      path: '/root/nodes/1/id',
      source: {
        ...definitionWithNode({ id: 'same', kind: 'Finish', outcome: 'done' }),
        root: {
          nodes: [
            { id: 'same', kind: 'Finish', outcome: 'done' },
            { id: 'same', kind: 'Finish', outcome: 'done' },
          ],
          connections: [],
        },
      },
    },
    {
      name: 'ordinary cycles',
      code: 'GRAPH_CYCLE',
      path: '/root/connections/0',
      source: {
        ...definitionWithNode({
          id: 'a',
          kind: 'Gate',
          outcomes: ['approved', 'rejected'],
        }),
        root: {
          nodes: [
            { id: 'a', kind: 'Gate', outcomes: ['approved', 'rejected'] },
            { id: 'b', kind: 'Gate', outcomes: ['approved', 'rejected'] },
          ],
          connections: [
            {
              id: 'a-b',
              from: { node: 'a', port: 'approved' },
              to: { node: 'b', port: 'start' },
            },
            {
              id: 'b-a',
              from: { node: 'b', port: 'approved' },
              to: { node: 'a', port: 'start' },
            },
          ],
        },
      },
    },
    {
      name: 'missing exits',
      code: 'MISSING_EXIT',
      path: '/root/nodes/0/exits/done',
      source: loopDefinition({}),
    },
    {
      name: 'unreachable exits',
      code: 'UNREACHABLE_EXIT',
      path: '/root/nodes/0/exits/ghost',
      source: loopDefinition({
        done: { action: 'exit', outcome: 'done' },
        ghost: { action: 'continue' },
      }),
    },
    {
      name: 'invalid limits',
      code: 'INVALID_LIMIT',
      path: '/root/nodes/0/limits/maxIterations',
      source: {
        ...loopDefinition({ done: { action: 'exit', outcome: 'done' } }),
        root: {
          ...loopDefinition({ done: { action: 'exit', outcome: 'done' } }).root,
          nodes: [
            {
              id: 'loop',
              kind: 'BoundedLoop',
              body: 'body',
              limits: { maxIterations: 0, maxActions: 4 },
              exits: { done: { action: 'exit', outcome: 'done' } },
            },
          ],
        },
      },
    },
    {
      name: 'impossible budgets',
      code: 'IMPOSSIBLE_BUDGET',
      path: '/limits/budget',
      source: {
        ...definitionWithNode({ id: 'finish', kind: 'Finish', outcome: 'done' }),
        limits: { maxActions: 4, budget: 2 },
      },
    },
    {
      name: 'unknown connection references',
      code: 'UNKNOWN_REFERENCE',
      path: '/root/connections/0/to/node',
      source: {
        ...definitionWithNode({ id: 'finish', kind: 'Finish', outcome: 'done' }),
        root: {
          nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
          connections: [
            {
              id: 'missing-target',
              from: { node: 'finish', port: 'done' },
              to: { node: 'absent', port: 'start' },
            },
          ],
        },
      },
    },
  ])('rejects $name with a stable path', ({ source, code, path }) => {
    const result = EcpDefinitionModule.prepare(source, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({ code, path })
      );
    }
  });

  it('rejects a bounded loop whose body contains another bounded loop', () => {
    const source = loopDefinition({ done: { action: 'exit', outcome: 'done' } });
    source.declarations[0]!.graph.nodes = [
      {
        id: 'nested-loop',
        kind: 'BoundedLoop',
        body: 'body',
        limits: { maxIterations: 2 },
        exits: { done: { action: 'exit', outcome: 'done' } },
      },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'NESTED_LOOP',
          path: '/declarations/0/graph/nodes/0/kind',
        })
      );
    }
  });

  it('rejects a bounded loop that reaches another loop through CompositeRefs', () => {
    const source = loopDefinition({ done: { action: 'exit', outcome: 'done' } });
    source.declarations = [
      {
        id: 'body',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [
            { id: 'call-indirect', kind: 'CompositeRef', declarationId: 'indirect' },
          ],
          connections: [],
        },
      },
      {
        id: 'indirect',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [
            {
              id: 'nested-loop',
              kind: 'BoundedLoop',
              body: 'leaf',
              limits: { maxIterations: 2 },
              exits: { done: { action: 'exit', outcome: 'done' } },
            },
          ],
          connections: [],
        },
      },
      {
        id: 'leaf',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [{ id: 'leaf-finish', kind: 'Finish', outcome: 'done' }],
          connections: [],
        },
      },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'NESTED_LOOP',
          path: '/declarations/1/graph/nodes/0/kind',
        })
      );
    }
  });

  it('validates Finish and BoundedLoop terminal outcomes against their owner graph', () => {
    const source = loopDefinition({
      done: { action: 'exit', outcome: 'not-declared' },
    });
    const bodyFinish = source.declarations[0]!.graph.nodes[0]!;
    if (bodyFinish.kind === 'Finish') bodyFinish.outcome = 'not-declared';

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PORT_MISMATCH',
            path: '/declarations/0/graph/nodes/0/outcome',
          }),
          expect.objectContaining({
            code: 'PORT_MISMATCH',
            path: '/root/nodes/0/exits/done/outcome',
          }),
        ])
      );
    }
  });

  it('derives loop exits from graph-produced outcomes rather than claimed outcomes', () => {
    const source = loopDefinition({
      claimed: { action: 'exit', outcome: 'done' },
    });
    source.declarations[0]!.outcomes = ['claimed'];
    const bodyFinish = source.declarations[0]!.graph.nodes[0]!;
    if (bodyFinish.kind === 'Finish') bodyFinish.outcome = 'actual';

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'MISSING_EXIT',
            path: '/root/nodes/0/exits/actual',
          }),
          expect.objectContaining({
            code: 'UNREACHABLE_EXIT',
            path: '/root/nodes/0/exits/claimed',
          }),
        ])
      );
    }
  });

  it('rejects every Composite owner whose declared outcomes disagree with its actual terminals', () => {
    const source: DefinitionSourceV2 = {
      version: 2,
      id: 'owner-outcome-mismatch',
      sourceId: 'fixture:owner-outcome-mismatch',
      name: 'owner-outcome-mismatch',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'body',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              { id: 'choice', kind: 'Choice', outcomes: ['selected'] },
            ],
            connections: [],
          },
        },
      ],
      root: {
        nodes: [
          { id: 'call-body', kind: 'CompositeRef', declarationId: 'body' },
        ],
        connections: [],
      },
    };

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PORT_MISMATCH',
            path: '/declarations/0/graph/nodes/0/outcomes/0',
            message: expect.stringContaining("not declared"),
          }),
          expect.objectContaining({
            code: 'PORT_MISMATCH',
            path: '/declarations/0/outcomes/0',
            message: expect.stringContaining("cannot be produced"),
          }),
          expect.objectContaining({
            code: 'PORT_MISMATCH',
            path: '/root/nodes/0/declarationId',
            message: expect.stringContaining("not declared"),
          }),
          expect.objectContaining({
            code: 'PORT_MISMATCH',
            path: '/outcomes/0',
            message: expect.stringContaining("cannot be produced"),
          }),
        ])
      );
    }
  });

  it('resolves consumed control and transitive Composite terminals through one owner contract', () => {
    const source: DefinitionSourceV2 = {
      version: 2,
      id: 'transitive-owner-outcomes',
      sourceId: 'fixture:transitive-owner-outcomes',
      name: 'transitive-owner-outcomes',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'inner',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['approved', 'rejected'],
          graph: {
            nodes: [
              {
                id: 'gate',
                kind: 'Gate',
                outcomes: ['approved', 'rejected'],
              },
            ],
            connections: [],
          },
        },
        {
          id: 'outer',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              {
                id: 'call-inner',
                kind: 'CompositeRef',
                declarationId: 'inner',
              },
              {
                id: 'approved-finish',
                kind: 'Finish',
                outcome: 'done',
              },
              {
                id: 'rejected-finish',
                kind: 'Finish',
                outcome: 'done',
              },
            ],
            connections: [
              {
                id: 'approved',
                from: { node: 'call-inner', port: 'approved' },
                to: { node: 'approved-finish', port: 'start' },
              },
              {
                id: 'rejected',
                from: { node: 'call-inner', port: 'rejected' },
                to: { node: 'rejected-finish', port: 'start' },
              },
            ],
          },
        },
      ],
      root: {
        nodes: [
          { id: 'call-outer', kind: 'CompositeRef', declarationId: 'outer' },
        ],
        connections: [],
      },
    };

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(true);
  });

  it.each([
    'dangling-producer',
    'dangling-consumer',
    'missing-producer-port',
    'missing-consumer-port',
    'incompatible-type',
  ] as const)(
    'does not infer declared terminal unproducibility from an incomplete %s connection in root, direct, or transitive owners',
    (invalidKind) => {
      const terminalCatalog = createCapabilityCatalogSnapshot([
        ...catalog.descriptors,
        {
          id: 'skill:text-consumer',
          version: '1.0.0',
          availability: 'enabled',
          inputs: [{ name: 'payload', type: 'text/plain', required: true }],
          artifacts: [],
          outcomes: ['done'],
          limits: {},
        },
      ]);
      const invalidGraph = () => {
        const nodes: DefinitionSourceV2['root']['nodes'] = [
          { id: 'decision', kind: 'Choice', outcomes: ['selected'] },
          { id: 'finish', kind: 'Finish', outcome: 'selected' },
        ];
        let from = { node: 'decision', port: 'selected' };
        let to = { node: 'finish', port: 'start' };
        if (invalidKind === 'dangling-producer') {
          from = { node: 'missing', port: 'selected' };
        } else if (invalidKind === 'dangling-consumer') {
          to = { node: 'missing', port: 'start' };
        } else if (invalidKind === 'missing-producer-port') {
          from = { node: 'decision', port: 'missing' };
        } else if (invalidKind === 'missing-consumer-port') {
          to = { node: 'finish', port: 'missing' };
        } else {
          nodes.push({
            id: 'text-consumer',
            kind: 'AtomicStage',
            capability: {
              id: 'skill:text-consumer',
              version: '1.0.0',
            },
          });
          to = { node: 'text-consumer', port: 'payload' };
        }
        return {
          nodes,
          connections: [{ id: 'invalid', from, to }],
        };
      };

      for (const owner of ['root', 'direct', 'transitive'] as const) {
        const leaf = {
          id: 'leaf',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['never'],
          graph: invalidGraph(),
        };
        const outer = {
          id: 'outer',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['never'],
          graph: {
            nodes: [
              {
                id: 'call-leaf',
                kind: 'CompositeRef' as const,
                declarationId: 'leaf',
              },
            ],
            connections: [],
          },
        };
        const source: DefinitionSourceV2 = {
          version: 2,
          id: `incomplete-${owner}-${invalidKind}`,
          sourceId: `fixture:incomplete-${owner}-${invalidKind}`,
          name: `incomplete-${owner}-${invalidKind}`,
          inputs: [],
          artifacts: [],
          outcomes: ['never'],
          declarations:
            owner === 'root'
              ? []
              : owner === 'direct'
                ? [leaf]
                : [leaf, outer],
          root:
            owner === 'root'
              ? invalidGraph()
              : {
                  nodes: [
                    {
                      id: 'call-owner',
                      kind: 'CompositeRef',
                      declarationId: owner === 'direct' ? 'leaf' : 'outer',
                    },
                  ],
                  connections: [],
                },
        };

        const result = EcpDefinitionModule.prepare(source, terminalCatalog);

        expect(result.ok, `${owner}/${invalidKind}`).toBe(false);
        if (!result.ok) {
          const messages = result.error.diagnostics.map(
            (diagnostic) => diagnostic.message
          );
          expect(
            messages.some((message) =>
              message.includes(
                "declares terminal outcome 'never', but it cannot be produced"
              )
            ),
            `${owner}/${invalidKind}`
          ).toBe(false);
          expect(
            messages.some((message) =>
              message.includes(
                "produces terminal outcome 'selected', but it is not declared"
              )
            ),
            `${owner}/${invalidKind}`
          ).toBe(true);
        }
      }
    }
  );

  it('rejects cyclic v1 at authoritative preparation before exposing a plan', () => {
    const source = {
      version: 1,
      name: 'cyclic-v1',
      stages: [
        { id: 'a', skill: 'rasen-apply-change', requires: ['b'] },
        { id: 'b', skill: 'rasen-review', requires: ['a'] },
      ],
    };

    const result = EcpDefinitionModule.prepare(
      source,
      createCapabilityCatalogSnapshot([])
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'GRAPH_CYCLE',
          path: '/stages/1/requires/0',
          message: 'Cyclic dependency detected: a → b → a',
        })
      );
    }
  });

  it.each([
    {
      name: 'duplicate stage identity',
      code: 'DUPLICATE_ID',
      path: '/stages/1/id',
      source: {
        version: 1,
        name: 'duplicate-v1',
        stages: [
          { id: 'same', skill: 'rasen-propose' },
          { id: 'same', skill: 'rasen-review' },
        ],
      },
    },
    {
      name: 'missing dependency reference',
      code: 'UNKNOWN_REFERENCE',
      path: '/stages/0/requires/0',
      source: {
        version: 1,
        name: 'missing-v1',
        stages: [
          { id: 'a', skill: 'rasen-propose', requires: ['missing'] },
        ],
      },
    },
    {
      name: 'parallel-group dependency',
      code: 'PORT_MISMATCH',
      path: '/stages/1/requires/0',
      source: {
        version: 1,
        name: 'parallel-v1',
        stages: [
          { id: 'a', skill: 'rasen-propose', parallelGroup: 'pair' },
          {
            id: 'b',
            skill: 'rasen-review',
            parallelGroup: 'pair',
            requires: ['a'],
          },
        ],
      },
    },
    {
      name: 'multiple decompose stages',
      code: 'INVALID_SOURCE',
      path: '/stages/1/kind',
      source: {
        version: 1,
        name: 'decompose-v1',
        stages: [
          { id: 'd1', kind: 'decompose' },
          { id: 'd2', kind: 'decompose' },
        ],
      },
    },
    {
      name: 'composed quality floor',
      code: 'INVALID_SOURCE',
      path: '/origin',
      source: {
        version: 1,
        name: 'quality-v1',
        origin: 'composed',
        stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
      },
    },
  ])(
    'uses one authoritative v1 diagnostic for $name in prepare and the legacy adapter',
    ({ source, code, path }) => {
      const result = EcpDefinitionModule.prepare(
        source,
        createCapabilityCatalogSnapshot([])
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.diagnostics).toContainEqual(
          expect.objectContaining({ code, path })
        );
        expect(() => parsePipeline(JSON.stringify(source))).toThrow(
          expect.objectContaining({ code })
        );
      }
    }
  );

  it('treats consumed Gate branches as internal and Finish outcomes as terminal loop exits', () => {
    const source = loopDefinition({
      done: { action: 'exit', outcome: 'done' },
      failed: { action: 'exit', outcome: 'failed' },
    });
    source.outcomes = ['done', 'failed'];
    source.declarations[0] = {
      ...source.declarations[0]!,
      outcomes: ['done', 'failed'],
      graph: {
        nodes: [
          {
            id: 'decision',
            kind: 'Gate',
            outcomes: ['approved', 'rejected'],
          },
          { id: 'success', kind: 'Finish', outcome: 'done' },
          { id: 'failure', kind: 'Finish', outcome: 'failed' },
        ],
        connections: [
          {
            id: 'approved-to-success',
            from: { node: 'decision', port: 'approved' },
            to: { node: 'success', port: 'input' },
          },
          {
            id: 'rejected-to-failure',
            from: { node: 'decision', port: 'rejected' },
            to: { node: 'failure', port: 'input' },
          },
        ],
      },
    };

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(true);
  });

  it('requires an exit only for an unconsumed Gate branch and terminal Finish outcomes', () => {
    const source = loopDefinition({
      done: { action: 'exit', outcome: 'done' },
    });
    source.declarations[0] = {
      ...source.declarations[0]!,
      outcomes: ['done', 'rejected'],
      graph: {
        nodes: [
          {
            id: 'decision',
            kind: 'Gate',
            outcomes: ['approved', 'rejected'],
          },
          { id: 'success', kind: 'Finish', outcome: 'done' },
        ],
        connections: [
          {
            id: 'approved-to-success',
            from: { node: 'decision', port: 'approved' },
            to: { node: 'success', port: 'input' },
          },
        ],
      },
    };

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_EXIT',
          path: '/root/nodes/0/exits/rejected',
        })
      );
      expect(result.error.diagnostics).not.toContainEqual(
        expect.objectContaining({
          code: 'MISSING_EXIT',
          path: '/root/nodes/0/exits/approved',
        })
      );
    }
  });

  it.each([
    ['missing capability', 'CAPABILITY_MISSING'],
    ['version mismatch', 'CAPABILITY_VERSION_MISMATCH'],
    ['dangling producer', 'UNKNOWN_REFERENCE'],
    ['dangling consumer', 'UNKNOWN_REFERENCE'],
    ['unknown producer port', 'PORT_MISMATCH'],
    ['unknown consumer port', 'PORT_MISMATCH'],
    ['type mismatch', 'PORT_MISMATCH'],
  ] as const)(
    'keeps positive loop terminal facts but suppresses unreachable exits when %s makes direct or transitive proof incomplete',
    (invalidKind, expectedPrimaryCode) => {
      const incompleteCatalog = createCapabilityCatalogSnapshot([
        ...catalog.descriptors,
        {
          id: 'skill:text-consumer',
          version: '1.0.0',
          availability: 'enabled',
          inputs: [{ name: 'payload', type: 'text/plain', required: true }],
          artifacts: [],
          outcomes: ['done'],
          limits: {},
        },
      ]);
      const leafGraph = (): DefinitionSourceV2['root'] => {
        const nodes: DefinitionSourceV2['root']['nodes'] = [
          { id: 'known-choice', kind: 'Choice', outcomes: ['known'] },
        ];
        const connections: DefinitionSourceV2['root']['connections'] = [];

        if (invalidKind === 'missing capability') {
          nodes.push({
            id: 'unknown-capability',
            kind: 'AtomicStage',
            capability: { id: 'skill:not-present', version: '1.0.0' },
          });
        } else if (invalidKind === 'version mismatch') {
          nodes.push({
            id: 'wrong-revision',
            kind: 'AtomicStage',
            capability: { id: 'skill:implement', version: '9.9.9' },
          });
        } else {
          nodes.push({ id: 'finish', kind: 'Finish', outcome: 'finished' });
          let from = { node: 'known-choice', port: 'known' };
          let to = { node: 'finish', port: 'start' };
          if (invalidKind === 'dangling producer') {
            from = { node: 'missing', port: 'known' };
          } else if (invalidKind === 'dangling consumer') {
            to = { node: 'missing', port: 'start' };
          } else if (invalidKind === 'unknown producer port') {
            from = { node: 'known-choice', port: 'missing' };
          } else if (invalidKind === 'unknown consumer port') {
            to = { node: 'finish', port: 'missing' };
          } else {
            nodes.push({
              id: 'text-consumer',
              kind: 'AtomicStage',
              capability: {
                id: 'skill:text-consumer',
                version: '1.0.0',
              },
            });
            to = { node: 'text-consumer', port: 'payload' };
          }
          connections.push({ id: 'incomplete-edge', from, to });
        }
        return { nodes, connections };
      };

      for (const mode of ['direct', 'transitive'] as const) {
        const leaf = {
          id: mode === 'direct' ? 'body' : 'leaf',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['ghost'],
          graph: leafGraph(),
        };
        const declarations: DefinitionSourceV2['declarations'] =
          mode === 'direct'
            ? [leaf]
            : [
                {
                  id: 'body',
                  kind: 'Composite',
                  provenance: 'custom',
                  inputs: [],
                  artifacts: [],
                  outcomes: ['ghost'],
                  graph: {
                    nodes: [
                      {
                        id: 'call-leaf',
                        kind: 'CompositeRef',
                        declarationId: 'leaf',
                      },
                    ],
                    connections: [],
                  },
                },
                leaf,
              ];
        const source: DefinitionSourceV2 = {
          version: 2,
          id: `incomplete-loop-${mode}`,
          sourceId: `fixture:incomplete-loop-${mode}`,
          name: `incomplete-loop-${mode}`,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations,
          root: {
            nodes: [
              {
                id: 'loop',
                kind: 'BoundedLoop',
                body: 'body',
                limits: { maxIterations: 3 },
                exits: {
                  ghost: { action: 'exit', outcome: 'done' },
                },
              },
            ],
            connections: [],
          },
        };

        const result = EcpDefinitionModule.prepare(source, incompleteCatalog);

        expect(result.ok, `${mode}/${invalidKind}`).toBe(false);
        if (!result.ok) {
          expect(result.error.diagnostics).toContainEqual(
            expect.objectContaining({ code: expectedPrimaryCode })
          );
          expect(result.error.diagnostics).toContainEqual(
            expect.objectContaining({
              code: 'MISSING_EXIT',
              path: '/root/nodes/0/exits/known',
            })
          );
          expect(result.error.diagnostics).not.toContainEqual(
            expect.objectContaining({
              code: 'UNREACHABLE_EXIT',
              path: '/root/nodes/0/exits/ghost',
            })
          );
        }
      }
    }
  );

  it('derives terminal outcomes through a nested CompositeRef without leaking consumed branches', () => {
    const source = loopDefinition({
      done: { action: 'exit', outcome: 'done' },
      failed: { action: 'exit', outcome: 'failed' },
    });
    source.outcomes = ['done', 'failed'];
    source.declarations = [
      {
        id: 'body',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done', 'failed'],
        graph: {
          nodes: [
            {
              id: 'nested-call',
              kind: 'CompositeRef',
              declarationId: 'nested-decision',
            },
          ],
          connections: [],
        },
      },
      {
        id: 'nested-decision',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done', 'failed'],
        graph: {
          nodes: [
            {
              id: 'decision',
              kind: 'Choice',
              outcomes: ['selected', 'rejected'],
            },
            { id: 'success', kind: 'Finish', outcome: 'done' },
            { id: 'failure', kind: 'Finish', outcome: 'failed' },
          ],
          connections: [
            {
              id: 'selected-to-success',
              from: { node: 'decision', port: 'selected' },
              to: { node: 'success', port: 'input' },
            },
            {
              id: 'rejected-to-failure',
              from: { node: 'decision', port: 'rejected' },
              to: { node: 'failure', port: 'input' },
            },
          ],
        },
      },
    ];

    const result = EcpDefinitionModule.prepare(source, catalog);

    expect(result.ok).toBe(true);
  });

  it('aggregates independent errors in deterministic JSON Pointer order', () => {
    const source = loopDefinition({});
    source.root.nodes = [
      {
        id: 'atomic',
        kind: 'AtomicStage',
        capability: { id: 'skill:implement', version: '1.0.0' },
      },
      {
        id: 'loop',
        kind: 'BoundedLoop',
        body: 'body',
        limits: { maxIterations: 0 },
        exits: {},
      },
    ];
    const disabledCatalog = createCapabilityCatalogSnapshot([
      { ...catalog.descriptors[0]!, availability: 'disabled' },
    ]);

    const result = EcpDefinitionModule.prepare(source, disabledCatalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.error.diagnostics.map(({ severity, code, path }) => ({
          severity,
          code,
          path,
        }))
      ).toEqual([
        {
          severity: 'error',
          code: 'CAPABILITY_DISABLED',
          path: '/root/nodes/0/capability',
        },
        {
          severity: 'error',
          code: 'MISSING_EXIT',
          path: '/root/nodes/1/exits/done',
        },
        {
          severity: 'error',
          code: 'INVALID_LIMIT',
          path: '/root/nodes/1/limits/maxIterations',
        },
      ]);
    }
  });

  it('retains ordered legacy-normalization warnings on successful preparation', () => {
    const result = EcpDefinitionModule.prepare(
      {
        name: 'legacy-warning',
        stages: [{ id: 'plan', skill: 'rasen-goal-plan' }],
      },
      createCapabilityCatalogSnapshot([])
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toEqual([
        {
          severity: 'warning',
          code: 'LEGACY_NORMALIZED',
          path: '/version',
          message:
            'Legacy Pipeline Definition v1 was normalized for planning; its authored source and prompt-owned execution remain unchanged.',
        },
      ]);
    }
  });
});

describe('opaque ChangeRunPlan compilation', () => {
  it('returns a deeply immutable, deterministically serializable plan envelope', () => {
    const source = definitionWithNode({
      id: 'atomic',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version: '1.0.0' },
    });

    const first = EcpDefinitionModule.prepare(source, catalog);
    const second = EcpDefinitionModule.prepare(structuredClone(source), catalog);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.plan.version).toBe(1);
      expect(first.value.plan.digest).toBe(first.value.digests.plan);
      expect(JSON.stringify(first.value.plan)).toBe(JSON.stringify(second.value.plan));
      expect(Object.isFrozen(first.value.plan)).toBe(true);
      expect(Object.isFrozen(first.value.plan.payload)).toBe(true);
    }
  });

  it('keeps the compiled payload opaque in the public TypeScript contract', () => {
    expectTypeOf<ChangeRunPlan['payload']>().toBeUnknown();
    expectTypeOf<ChangeRunPlan['version']>().toEqualTypeOf<1>();
    expectTypeOf<ChangeRunPlan['digest']>().toEqualTypeOf<string>();
  });

  it('changes the plan digest for exits, limits, outcomes, ports, and capability revisions', () => {
    const base = loopDefinition({ done: { action: 'exit', outcome: 'done' } });
    const variants = [
      (() => {
        const value = structuredClone(base);
        const loop = value.root.nodes[0]!;
        if (loop.kind === 'BoundedLoop') loop.limits.maxIterations = 4;
        return value;
      })(),
      (() => {
        const value = structuredClone(base);
        const loop = value.root.nodes[0]!;
        if (loop.kind === 'BoundedLoop') {
          loop.exits.done = { action: 'exit', outcome: 'alternate' };
        }
        value.outcomes = ['alternate'];
        return value;
      })(),
      (() => {
        const value = structuredClone(base);
        value.outcomes = ['alternate', 'done'];
        value.root.nodes.push({
          id: 'alternate-finish',
          kind: 'Finish',
          outcome: 'alternate',
        });
        return value;
      })(),
      (() => {
        const value = structuredClone(base);
        value.inputs = [{ name: 'goal', type: 'text/markdown' }];
        return value;
      })(),
    ];
    const preparedBase = EcpDefinitionModule.prepare(base, catalog);
    expect(preparedBase.ok).toBe(true);
    if (!preparedBase.ok) return;

    for (const variant of variants) {
      const preparedVariant = EcpDefinitionModule.prepare(variant, catalog);
      expect(preparedVariant.ok).toBe(true);
      if (preparedVariant.ok) {
        expect(preparedVariant.value.digests.plan).not.toBe(
          preparedBase.value.digests.plan
        );
      }
    }

    const capabilitySource = definitionWithNode({
      id: 'atomic',
      kind: 'AtomicStage',
      capability: { id: 'skill:implement', version: '2.0.0' },
    });
    const revisedCatalog = createCapabilityCatalogSnapshot([
      { ...catalog.descriptors[0]!, version: '2.0.0' },
    ]);
    const revised = EcpDefinitionModule.prepare(capabilitySource, revisedCatalog);
    expect(revised.ok).toBe(true);
    if (revised.ok) {
      expect(revised.value.digests.capability).not.toBe(
        EcpDefinitionModule.prepare(
          definitionWithNode({
            id: 'atomic',
            kind: 'AtomicStage',
            capability: { id: 'skill:implement', version: '1.0.0' },
          }),
          catalog
        ).ok
          ? (
              EcpDefinitionModule.prepare(
                definitionWithNode({
                  id: 'atomic',
                  kind: 'AtomicStage',
                  capability: { id: 'skill:implement', version: '1.0.0' },
                }),
                catalog
              ) as { ok: true; value: { digests: { capability: string } } }
            ).value.digests.capability
          : ''
      );
    }
  });
});
