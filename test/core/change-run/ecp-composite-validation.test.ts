/**
 * ECP-2 Group 7: Static validation for custom-authored shapes.
 * Proves the existing Definition v2 validators fire correctly on
 * Canvas-authored custom composites.
 */
import { describe, expect, it } from 'vitest';

import type {
  DefinitionSourceV2,
  CapabilityDescriptor,
  DefinitionDiagnostic,
} from '../../../src/core/pipeline-registry/definition.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';

function mkDescriptor(id: string): CapabilityDescriptor {
  return {
    id,
    version: '1',
    availability: 'enabled',
    inputs: [{ name: 'input', type: 'ecp/control', required: true }],
    artifacts: [{ name: 'artifact', type: 'string' }],
    outcomes: ['done'],
    limits: {},
  };
}

const SKILLS = ['skill:propose', 'skill:apply', 'skill:ship'].map(mkDescriptor);

function tryPrepare(
  def: DefinitionSourceV2
): { ok: true } | { ok: false; diagnostics: DefinitionDiagnostic[] } {
  const result = EcpDefinitionModule.prepare(
    def,
    createCapabilityCatalogSnapshot(SKILLS)
  );
  if (result.ok) return { ok: true };
  const err = result.error as { diagnostics?: DefinitionDiagnostic[] };
  return { ok: false, diagnostics: err?.diagnostics ?? [] };
}

function hasDiagnostic(
  result: { ok: true } | { ok: false; diagnostics: DefinitionDiagnostic[] },
  code: string
): boolean {
  if (result.ok) return false;
  return result.diagnostics.some((d) => d.code === code);
}

describe('ECP-2 static validation — custom-authored shapes', () => {
  it('happy-path: a valid custom composite prepares with reconciler executionMode', () => {
    const def: DefinitionSourceV2 = {
      version: 2,
      id: 'test:valid',
      sourceId: 'package:valid',
      name: 'valid-composite',
      inputs: [],
      artifacts: [],
      outcomes: ['success'],
      declarations: [
        {
          id: 'comp',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:propose', version: '1' } },
              { id: 'b', kind: 'AtomicStage', capability: { id: 'skill:apply', version: '1' } },
            ],
            connections: [
              { id: 'ab', from: { node: 'a', port: 'done' }, to: { node: 'b', port: 'input' } },
            ],
          },
        },
      ],
      root: {
        nodes: [
          { id: 'ref', kind: 'CompositeRef', declarationId: 'comp' },
          { id: 'finish', kind: 'Finish', outcome: 'success' },
        ],
        connections: [
          { id: 'rf', from: { node: 'ref', port: 'done' }, to: { node: 'finish', port: 'start' } },
        ],
      },
    };
    const result = EcpDefinitionModule.prepare(
      def,
      createCapabilityCatalogSnapshot(SKILLS)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capability.executionMode).toBe('reconciler');
  });

  it('rejects unknown capability in body AtomicStage with CAPABILITY_MISSING', () => {
    const def: DefinitionSourceV2 = {
      version: 2,
      id: 'test:bad-cap',
      sourceId: 'package:bad-cap',
      name: 'bad-cap',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'comp',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:nonexistent', version: '1' } },
            ],
            connections: [],
          },
        },
      ],
      root: {
        nodes: [
          { id: 'ref', kind: 'CompositeRef', declarationId: 'comp' },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [],
      },
    };
    const result = tryPrepare(def);
    expect(hasDiagnostic(result, 'CAPABILITY_MISSING')).toBe(true);
  });

  it('rejects port type mismatch in body connection with PORT_MISMATCH', () => {
    const def: DefinitionSourceV2 = {
      version: 2,
      id: 'test:port-mismatch',
      sourceId: 'package:port-mismatch',
      name: 'port-mismatch',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'comp',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:propose', version: '1' } },
              { id: 'b', kind: 'AtomicStage', capability: { id: 'skill:apply', version: '1' } },
            ],
            connections: [
              // 'string' artifact port mismatched to 'ecp/control' input port
              { id: 'bad', from: { node: 'a', port: 'artifact' }, to: { node: 'b', port: 'input' } },
            ],
          },
        },
      ],
      root: {
        nodes: [
          { id: 'ref', kind: 'CompositeRef', declarationId: 'comp' },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [],
      },
    };
    const result = tryPrepare(def);
    expect(hasDiagnostic(result, 'PORT_MISMATCH')).toBe(true);
  });

  it('rejects cyclic body connection with GRAPH_CYCLE', () => {
    const def: DefinitionSourceV2 = {
      version: 2,
      id: 'test:cycle',
      sourceId: 'package:cycle',
      name: 'cycle',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'comp',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:propose', version: '1' } },
              { id: 'b', kind: 'AtomicStage', capability: { id: 'skill:apply', version: '1' } },
            ],
            connections: [
              { id: 'ab', from: { node: 'a', port: 'done' }, to: { node: 'b', port: 'input' } },
              { id: 'ba', from: { node: 'b', port: 'done' }, to: { node: 'a', port: 'input' } },
            ],
          },
        },
      ],
      root: {
        nodes: [
          { id: 'ref', kind: 'CompositeRef', declarationId: 'comp' },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [],
      },
    };
    const result = tryPrepare(def);
    expect(hasDiagnostic(result, 'GRAPH_CYCLE')).toBe(true);
  });

  it('rejects unreachable exit with UNREACHABLE_EXIT', () => {
    const def: DefinitionSourceV2 = {
      version: 2,
      id: 'test:bad-exit',
      sourceId: 'package:bad-exit',
      name: 'bad-exit',
      inputs: [],
      artifacts: [],
      outcomes: ['success'],
      declarations: [
        {
          id: 'loop-body',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:propose', version: '1' } },
            ],
            connections: [],
          },
        },
      ],
      root: {
        nodes: [
          {
            id: 'loop',
            kind: 'BoundedLoop',
            body: 'loop-body',
            limits: { maxIterations: 3 },
            exits: {
              nonexistent: { action: 'exit', outcome: 'success' },
            },
          },
          { id: 'finish', kind: 'Finish', outcome: 'success' },
        ],
        connections: [],
      },
    };
    const result = tryPrepare(def);
    expect(hasDiagnostic(result, 'UNREACHABLE_EXIT')).toBe(true);
  });
});
