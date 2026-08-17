import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';

// `packages/ui` cannot import the root `src/`, so the kernel side reaches
// across to the UI's authoring model — the same one-way direction
// `canvas-control-port-provenance.test.ts` uses. This file is the engine-
// level half of canvas-loop-validate-clean-synthesis's acceptance: the
// page test asserts the UI flow against the standard mocked validate
// response (the file's idiom), and child-1's review Minor was exactly that
// the mock split hid the engine truth — the synthesized defaults were
// 6-errors red while every UI test stayed green. Here the REAL `prepare`
// runs over the REAL synthesized output with zero author contract edits.
import {
  addAtomicStageForCapability,
  addBoundedLoopOverDeclaration,
  addFinishNode,
  addV2Connection,
  backedgeRegion,
  createBlankCanvasPipelineDefinitionV2,
  declareDefinitionOutcome,
  deriveBackedgeLoopContract,
  synthesizeBoundedLoopFromBackedge,
  v2ConnectionIdFor,
  type LoopBodyCatalogSlice,
} from '../../../packages/ui/src/canvas/draft.js';

/**
 * The zero-edit acceptance (canvas-loop-validate-clean-synthesis): an empty
 * canvas, two stages wired into a cycle, the loop review confirmed with only
 * its own inline declare for the exit outcome, an external stage connected
 * onto the entry handle and the loop onward onto a Finish — Validate reports
 * zero errors with no edits to any contract beyond what confirming declared.
 *
 * Every author action here is a model gesture the real UI runs (palette
 * stage/finish gestures, drawn connections through `addV2Connection`, the
 * review's inline declare through `declareDefinitionOutcome`, the confirm
 * through `synthesizeBoundedLoopFromBackedge` with the review's opening
 * defaults) — no hand-built wire fragments, so the pin tracks what the UI
 * actually mints.
 */
describe('Canvas loop synthesis validates clean through the real engine', () => {
  const CAPABILITY = { id: 'skill:rasen-apply', version: 'digest-apply' };

  /** Production-shaped, exactly like the provenance test's catalog. */
  const engineCatalog = createCapabilityCatalogSnapshot([
    {
      ...CAPABILITY,
      availability: 'enabled',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      limits: {},
    },
  ]);

  const uiCatalog: LoopBodyCatalogSlice = {
    skills: [
      {
        id: 'rasen-apply',
        description: 'Fixture skill',
        enabled: true,
        capability: { ...CAPABILITY, inputs: [], artifacts: [], outcomes: ['done'] },
      },
    ],
  };

  function diagnosticsOf(prepare: { ok: boolean }): string[] {
    if (prepare.ok) return [];
    const result = prepare as { ok: false; error: { diagnostics: unknown[] } };
    return result.error.diagnostics.map(
      (diagnostic) =>
        `${(diagnostic as { code: string }).code} ${(diagnostic as { path: string }).path}: ${(diagnostic as { message: string }).message}`
    );
  }

  /** The full empty-canvas acceptance flow, through the UI's own gestures. */
  function synthesizedZeroEditFlow(): DefinitionSourceV2 {
    // Empty canvas; the review's inline declare for the exit outcome (the
    // one review-time design input the empty-contract flow needs).
    let def = createBlankCanvasPipelineDefinitionV2('loop-engine-clean');
    def = declareDefinitionOutcome(def, 'done');
    def = addAtomicStageForCapability(def, CAPABILITY);
    def = addAtomicStageForCapability(def, CAPABILITY);
    const forwardId = v2ConnectionIdFor(def, {
      source: 'atomic-stage',
      sourcePort: 'done',
      target: 'atomic-stage-2',
      targetPort: 'input',
    });
    def = addV2Connection(def, {
      id: forwardId,
      from: { node: 'atomic-stage', port: 'done' },
      to: { node: 'atomic-stage-2', port: 'input' },
    });

    // The refused back-edge draw fix -> review, confirmed with the review's
    // OPENING defaults (zero edits to the derived rows).
    const region = backedgeRegion(def, 'atomic-stage-2', 'atomic-stage');
    const derived = deriveBackedgeLoopContract(def, region, 'atomic-stage', uiCatalog);
    const result = synthesizeBoundedLoopFromBackedge(
      def,
      {
        from: 'atomic-stage-2',
        to: 'atomic-stage',
        id: 'loop-body',
        inputs: derived.inputs,
        artifacts: derived.artifacts,
        outcomes: derived.outcomes,
        maxIterations: 3,
        exitOutcome: 'done',
      },
      uiCatalog
    );
    expect(result.next.declarations[0]!.inputs).toEqual([
      { name: 'atomic-stage', type: 'ecp/control' },
    ]);
    expect(result.next.declarations[0]!.outcomes).toEqual(['done']);
    expect(result.next.outcomes).toEqual(['done', 'iteration-limit']);

    // Externals after the fact: a stage onto the entry handle, the loop
    // onward onto a Finish (the palette finish gesture).
    let wired = addAtomicStageForCapability(result.next, CAPABILITY);
    wired = addFinishNode(wired);
    const entryId = v2ConnectionIdFor(wired, {
      source: 'atomic-stage',
      sourcePort: 'done',
      target: 'bounded-loop',
      targetPort: derived.inputs[0]!.name,
    });
    wired = addV2Connection(wired, {
      id: entryId,
      from: { node: 'atomic-stage', port: 'done' },
      to: { node: 'bounded-loop', port: derived.inputs[0]!.name },
    });
    const exitId = v2ConnectionIdFor(wired, {
      source: 'bounded-loop',
      sourcePort: 'done',
      target: 'finish',
      targetPort: 'input',
    });
    wired = addV2Connection(wired, {
      id: exitId,
      from: { node: 'bounded-loop', port: 'done' },
      to: { node: 'finish', port: 'input' },
    });
    return wired as unknown as DefinitionSourceV2;
  }

  it('reports zero errors for the drawn-back-edge loop wired between externals, unedited', () => {
    const prepare = EcpDefinitionModule.prepare(
      synthesizedZeroEditFlow(),
      engineCatalog
    );
    expect(diagnosticsOf(prepare)).toEqual([]);
    expect(prepare.ok).toBe(true);
  });

  it('reports zero errors for the palette-gesture loop over a well-formed declaration body', () => {
    // The gesture's own flow: a declaration whose contract matches its body
    // graph (review -> fix, outcomes ['done']), a definition that declared
    // nothing, one palette Loop gesture. The synthesis transaction declares
    // the exit value and the lifecycle outcome itself.
    let def = createBlankCanvasPipelineDefinitionV2('palette-engine-clean');
    const stage = (id: string) => ({
      id,
      kind: 'AtomicStage' as const,
      capability: { ...CAPABILITY },
      execution: {
        version: 1 as const,
        role: 'implementer' as const,
        workspace: { access: 'write' as const },
      },
    });
    def = {
      ...def,
      declarations: [
        {
          id: 'block',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [stage('review'), stage('fix')],
            connections: [
              {
                id: 'e-review-fix',
                from: { node: 'review', port: 'done' },
                to: { node: 'fix', port: 'input' },
              },
            ],
          },
        },
      ],
    };
    def = addBoundedLoopOverDeclaration(def);
    expect(def.outcomes).toEqual(['done', 'iteration-limit']);

    const prepare = EcpDefinitionModule.prepare(
      def as unknown as DefinitionSourceV2,
      engineCatalog
    );
    expect(diagnosticsOf(prepare)).toEqual([]);
    expect(prepare.ok).toBe(true);
  });

  // --- Falsifiability: each pre-fix defect class, re-injected by hand,
  // must go red through the same prepare (else the pins above are blind). --

  it('is falsifiable — a port-name-typed entry row (the class-2 defect) is refused', () => {
    const def = synthesizedZeroEditFlow() as unknown as {
      declarations: Array<{ inputs: Array<{ name: string; type: string }> }>;
    };
    def.declarations[0]!.inputs[0]!.type = 'input';
    const prepare = EcpDefinitionModule.prepare(
      def as unknown as DefinitionSourceV2,
      engineCatalog
    );
    expect(prepare.ok).toBe(false);
    expect(diagnosticsOf(prepare).join('\n')).toMatch(/requires 'input' but/);
  });

  it('is falsifiable — a stage-id outcome row (the class-1 defect) is refused', () => {
    const def = synthesizedZeroEditFlow() as unknown as {
      declarations: Array<{ outcomes: string[] }>;
    };
    def.declarations[0]!.outcomes = ['atomic-stage-2'];
    const prepare = EcpDefinitionModule.prepare(
      def as unknown as DefinitionSourceV2,
      engineCatalog
    );
    expect(prepare.ok).toBe(false);
    expect(diagnosticsOf(prepare).join('\n')).toMatch(
      /cannot be produced by the graph/
    );
  });

  it('is falsifiable — an undeclared lifecycle exit outcome (the class-3 defect) is refused', () => {
    const def = synthesizedZeroEditFlow() as unknown as {
      outcomes: string[];
    };
    def.outcomes = ['done'];
    const prepare = EcpDefinitionModule.prepare(
      def as unknown as DefinitionSourceV2,
      engineCatalog
    );
    expect(prepare.ok).toBe(false);
    expect(diagnosticsOf(prepare).join('\n')).toMatch(
      /terminal outcome 'iteration-limit', but it is not declared/
    );
  });
});
