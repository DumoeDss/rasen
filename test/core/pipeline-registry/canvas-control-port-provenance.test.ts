import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';

// `packages/ui` cannot import the root `src/`, so the kernel side reaches
// across to the UI's authoring constants — the same one-way direction
// `ui-constants-provenance.test.ts` uses to keep the kernel authoritative and
// the UI copy derived.
import {
  CONTROL_SOURCE_PORT,
  CONTROL_TARGET_PORT,
} from '../../../packages/ui/src/canvas/draft.js';

/**
 * PROVENANCE FOR THE CANVAS'S CONTROL PORTS (ECP-5 round-2 review).
 *
 * `3b33d5be` fixed a Blocker in which every Canvas-authored v2 connection was
 * rejected with `PORT_MISMATCH`, and left the two halves of the convention in
 * two packages: the kernel accepts `CONTROL_INPUT_PORTS` on a capability with
 * no typed inputs, and the Canvas emits `CONTROL_SOURCE_PORT` /
 * `CONTROL_TARGET_PORT`. A comment in each file asserted they agree.
 *
 * The kernel-narrowing direction was already covered (`definition.test.ts`
 * loops over all three accepted input port names). This closes the other
 * direction: a UI-side edit to either constant used to leave every kernel test
 * AND every UI test green while production authored unsaveable definitions —
 * the failure mode the Blocker actually was.
 *
 * The catalog here is production-SHAPED on purpose: `inputs: []`,
 * `artifacts: []`, `outcomes: ['done']` are the four literals
 * `createProductionCapabilityCatalogSnapshot` hardcodes for every skill
 * (`src/core/pipeline-registry/definition.ts`). Fixture catalogs that declare
 * ports no real skill declares are why the Blocker survived multiple slices.
 */
describe('Canvas control-port provenance', () => {
  const productionShaped = createCapabilityCatalogSnapshot([
    {
      id: 'skill:rasen-apply-change',
      version: 'sha256:abc',
      availability: 'enabled',
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

  const definitionWith = (
    sourcePort: string,
    targetPort: string
  ): DefinitionSourceV2 => ({
    version: 2,
    id: 'canvas-control-ports',
    sourceId: 'fixture:canvas-control-ports',
    name: 'canvas-control-ports',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [],
    root: {
      nodes: [stageNode('stage'), stageNode('stage-2')],
      connections: [
        {
          id: 'stage-to-stage-2',
          from: { node: 'stage', port: sourcePort },
          to: { node: 'stage-2', port: targetPort },
        },
      ],
    },
  });

  it('accepts a connection authored with the Canvas constants, through the real prepare', () => {
    const result = EcpDefinitionModule.prepare(
      definitionWith(CONTROL_SOURCE_PORT, CONTROL_TARGET_PORT),
      productionShaped
    );
    expect(
      result.ok
        ? []
        : result.error.diagnostics.map((d) => `${d.code} ${d.path}: ${d.message}`)
    ).toEqual([]);
  });

  it('is falsifiable — a port the kernel does not accept is refused', () => {
    // The negative control. Without it, the assertion above would also pass if
    // `prepare` stopped validating ports at all.
    const badTarget = EcpDefinitionModule.prepare(
      definitionWith(CONTROL_SOURCE_PORT, `${CONTROL_TARGET_PORT}-not-a-port`),
      productionShaped
    );
    expect(badTarget.ok).toBe(false);

    const badSource = EcpDefinitionModule.prepare(
      definitionWith(`${CONTROL_SOURCE_PORT}-not-an-outcome`, CONTROL_TARGET_PORT),
      productionShaped
    );
    expect(badSource.ok).toBe(false);
  });
});
