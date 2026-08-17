// @vitest-environment jsdom
/**
 * ECP-5 task 7.6 — produce a genuinely **Canvas-authored** Custom Composite.
 *
 * ECP-2's task 14.1 allowed "author ... in the Canvas (**or construct
 * programmatically**)", and its recorded dogfood
 * (`test/core/change-run/ecp-composite-dogfood.test.ts`, commit `c6aa7026`)
 * took the second option: a hand-built `DefinitionSourceV2` literal driven
 * through the facade with an in-memory store. So the §15.4 exit condition
 * "at least one **Canvas-authored** Custom Composite completes a real Run" had
 * no evidence — and until `b5e9fcd0` shipped the declaration editor, it could
 * not have had any, because the Canvas had no affordance to create a
 * declaration at all.
 *
 * This file closes that by driving the REAL `PipelineCanvasPage` through the
 * REAL authoring affordances (create declaration -> edit its contract -> add
 * body stages -> reference it from the root) and then capturing **what the
 * Canvas POSTs on save** — not a fixture that resembles it. The captured
 * definition is written to the path in `ECP5_CANVAS_EXPORT`, and
 * `test/dogfood-ecp5-closure.mjs` runs THAT FILE through the real CLI.
 *
 * The catalog this Canvas is served comes from `ECP5_CANVAS_CATALOG` — the
 * production capability catalog the dogfood script read from the same machine,
 * exactly as the server's `/pipelines/catalog` endpoint would serve it. Without
 * those env vars the test still runs and asserts the authoring flow; it just
 * writes nothing.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getPipelineDetail: vi.fn(),
    validatePipeline: vi.fn(),
    getPipelineCatalog: vi.fn(),
    mutatePipeline: vi.fn(),
  };
});

vi.mock('@xyflow/react', () => ({
  ReactFlow: () => <div data-testid="mock-reactflow" />,
  Background: () => null,
  Controls: () => null,
  ReactFlowProvider: ({ children }: { children: unknown }) => <>{children}</>,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  // Mirrors @xyflow/system's real enum values: PipelineCanvasPage now
  // imports SelectionMode, which must resolve under this mock too.
  SelectionMode: { Partial: 'partial', Full: 'full' },
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
  // canvas-loop-body-visibility: the page forces a node-internals refresh
  // when the node id set changes; jsdom measures nothing, so a no-op.
  useUpdateNodeInternals: () => () => undefined,
  addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
  applyNodeChanges: (_c: unknown[], nodes: unknown[]) => nodes,
  applyEdgeChanges: (_c: unknown[], edges: unknown[]) => edges,
}));

import { LocationProvider, Router, Route } from 'preact-iso';
import { PipelineCanvasPage } from '../../src/canvas/PipelineCanvasPage.js';
import * as client from '../../src/api/client.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';
import type {
  PipelineCatalogResponse,
  PipelineDetailResponse,
} from '../../src/api/types.js';
import { __resetLocaleForTesting } from '../../src/i18n/store.js';

/**
 * The capability the Canvas stamps into every authored stage. Defaults to a
 * placeholder so the authoring assertions run standalone; the dogfood script
 * overrides it with the machine's REAL catalog entry, which is what makes the
 * exported definition loadable by the CLI.
 */
const CATALOG_ENTRY: { id: string; version: string } = process.env.ECP5_CANVAS_CATALOG
  ? (JSON.parse(process.env.ECP5_CANVAS_CATALOG) as { id: string; version: string })
  : { id: 'skill:rasen-apply-change', version: 'digest-placeholder' };

const EXPORT_PATH = process.env.ECP5_CANVAS_EXPORT ?? '';
const PIPELINE_NAME = process.env.ECP5_CANVAS_NAME ?? 'ecp5-canvas-composite';

const catalogFixture: PipelineCatalogResponse = {
  roles: ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'],
  skills: [
    {
      id: CATALOG_ENTRY.id.replace(/^skill:/, ''),
      description: 'Canvas-authored body capability',
      enabled: true,
      kind: 'task',
      capability: {
        id: CATALOG_ENTRY.id,
        version: CATALOG_ENTRY.version,
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
} as PipelineCatalogResponse;

/**
 * An EMPTY v2 definition — no declarations, no root nodes. Everything the
 * exported definition contains is authored through the UI below, so nothing
 * can be inherited from a fixture that already looked like the answer.
 */
const emptyV2Definition = {
  version: 2 as const,
  id: `definition:${PIPELINE_NAME}`,
  sourceId: `source:${PIPELINE_NAME}`,
  name: PIPELINE_NAME,
  description: 'ECP-5 task 7.6 — authored through the Canvas declaration editor',
  inputs: [],
  artifacts: [],
  outcomes: ['done'],
  declarations: [],
  root: { nodes: [], connections: [] },
};

const editableDetail = {
  ...pipelineDetailFixture,
  pipeline: {
    ...pipelineDetailFixture.pipeline,
    name: PIPELINE_NAME,
    description: emptyV2Definition.description,
    provenance: 'user' as const,
    sourceLayer: 'user' as const,
    stages: [],
    authoredVersion: 2 as const,
    normalizedVersion: 2 as const,
    definitionValid: true,
    planAvailable: true,
    executable: false,
    executionMode: 'unavailable' as const,
  },
  definition: emptyV2Definition,
  preparation: {
    authoredVersion: 2 as const,
    normalizedVersion: 2 as const,
    definitionValid: true,
    diagnostics: [],
    digests: { source: 'source-digest', normalized: 'normalized-digest' },
    planAvailable: true,
    executable: false,
    executionMode: 'unavailable' as const,
  },
  editable: true,
} as unknown as PipelineDetailResponse;

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('ECP-5 task 7.6: a Custom Composite authored through the Canvas', () => {
  let container: HTMLElement;

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  async function mount(): Promise<void> {
    window.history.pushState({}, '', `/p/proj_x/pipelines/${PIPELINE_NAME}`);
    await act(async () => {
      render(
        <LocationProvider>
          <Router>
            <Route path="/p/:projectId/pipelines/:name" component={PipelineCanvasPage} />
            <Route default component={PipelineCanvasPage} />
          </Router>
        </LocationProvider>,
        container
      );
    });
    await act(async () => {
      await flush();
    });
  }

  async function click(selector: string): Promise<void> {
    const el = container.querySelector(selector);
    expect(el, `missing affordance: ${selector}`).not.toBeNull();
    await act(async () => {
      (el as HTMLElement).click();
      await flush();
    });
  }

  async function setValue(selector: string, value: string): Promise<void> {
    const el = container.querySelector(selector) as HTMLInputElement | null;
    expect(el, `missing input: ${selector}`).not.toBeNull();
    await act(async () => {
      el!.value = value;
      el!.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
  }

  /** Selects use Preact's native `change`, not `input`. */
  async function setSelect(selector: string, value: string): Promise<void> {
    const el = container.querySelector(selector) as HTMLSelectElement | null;
    expect(el, `missing select: ${selector}`).not.toBeNull();
    await act(async () => {
      el!.value = value;
      el!.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
  }

  /** Connect two body stages through the real affordance (F1, `7f2fc33d`). */
  async function connectBody(from: string, to: string): Promise<void> {
    await setSelect('[data-testid="declaration-connection-from"]', from);
    await setSelect('[data-testid="declaration-connection-to"]', to);
    await click('[data-testid="declaration-connection-add"]');
  }

  it('authors a declaration with two body stages, references it from the root, and exports what save POSTs', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(catalogFixture);
    await mount();
    await click('[data-testid="pipeline-canvas-edit"]');

    // 1. Create the declaration — the affordance ECP-2 promised and `b5e9fcd0`
    //    shipped. Before it, `addDeclaration` had zero callers in `src`.
    await setValue('[data-testid="declaration-new-id"]', 'closure-composite');
    await click('[data-testid="declaration-create"]');
    expect(
      container.querySelector(
        '[data-testid="declaration-row"][data-declaration-id="closure-composite"]'
      )
    ).not.toBeNull();

    // 2. Two body stages, from the CONSTRAINED body palette (AtomicStage only).
    await click('[data-testid="v2-body-palette-add-AtomicStage"]');
    await click('[data-testid="v2-body-palette-add-AtomicStage"]');
    expect(
      container.querySelectorAll('[data-testid="declaration-body-stage"]')
    ).toHaveLength(2);

    // 2a. CONNECT them — the F1 affordance (`7f2fc33d`), and the reason this
    //     export exists in its current form. Stage count is NOT the observable:
    //     a two-stage body with no edge is a DIFFERENT pipeline, because the
    //     reconciler admits disconnected stages concurrently. Sequential vs
    //     fan-out is what separates correct authoring from the broken path, and
    //     only an edge produces the sequential one.
    await connectBody('stage', 'stage-2');
    const edges = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-connection"]')
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.getAttribute('data-from')).toBe('stage');
    expect(edges[0]!.getAttribute('data-to')).toBe('stage-2');

    // 2b. CYCLE PROBE — the closing edge `stage-2 → stage`. F1 puts the rule in
    //     the model and deliberately does NOT filter illegal targets out of the
    //     select, on the grounds that a filter would be a second, invisible copy
    //     of the cycle rule. So the cycle is *selectable* and refused on submit:
    //     this probe therefore tests that the CANVAS refuses, which is a
    //     different claim from "the validator is reachable" — see the ledger.
    //     Asserting the toast is ABSENT first is what makes the probe
    //     discriminating: a toast left over from an earlier action would let
    //     this pass without the refusal ever happening.
    expect(
      container.querySelector('[data-testid="pipeline-canvas-toast"]'),
      'a toast was already showing — the cycle assertion below would be vacuous'
    ).toBeNull();
    await connectBody('stage-2', 'stage');
    const toast = container.querySelector('[data-testid="pipeline-canvas-toast"]');
    expect(toast, 'the cycle refusal surfaced no diagnostic').not.toBeNull();
    expect(toast!.textContent?.toLowerCase()).toContain('cycle');
    // …and the refusal left the graph alone. A diagnostic beside a mutated
    // graph would be the worst of both.
    expect(
      container.querySelectorAll('[data-testid="declaration-body-connection"]')
    ).toHaveLength(1);

    // 3. Reference it from the root graph via a CompositeRef — CompositeRef
    //    is no longer a root-palette kind (design D6), so this goes through
    //    the declaration row's own "Insert into graph" action instead.
    await click(
      '[data-testid="declaration-insert-ref"][data-declaration-id="closure-composite"]'
    );

    // 4. Save — and read the definition the Canvas actually POSTs.
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: PIPELINE_NAME, path: `/pipelines/${PIPELINE_NAME}` },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(editableDetail);
    await click('[data-testid="pipeline-canvas-save"]');

    const posted = vi.mocked(client.mutatePipeline).mock.calls.at(-1)?.[0] as
      | { definition: Record<string, unknown> }
      | undefined;
    expect(posted, 'save did not POST a definition').toBeDefined();

    const definition = posted!.definition as unknown as {
      version: number;
      declarations: {
        id: string;
        provenance: string;
        graph: {
          nodes: { id: string; kind: string; capability: { id: string; version: string } }[];
          connections: { from: { node: string }; to: { node: string } }[];
        };
      }[];
      root: { nodes: { kind: string; declarationId?: string }[] };
    };

    // The structure came from the UI, not from the fixture: the fixture had
    // zero declarations and zero root nodes.
    expect(definition.version).toBe(2);
    expect(definition.declarations).toHaveLength(1);
    const declaration = definition.declarations[0]!;
    expect(declaration.id).toBe('closure-composite');
    expect(declaration.provenance).toBe('custom');
    expect(declaration.graph.nodes.map((node) => node.kind)).toEqual([
      'AtomicStage',
      'AtomicStage',
    ]);
    // The EDGE reaches the POSTed definition — the discriminating assertion.
    // Everything above this line is equally true of a disconnected body.
    expect(declaration.graph.connections).toHaveLength(1);
    expect(declaration.graph.connections[0]!.from.node).toBe('stage');
    expect(declaration.graph.connections[0]!.to.node).toBe('stage-2');
    // Each body stage carries the capability the SERVER's catalog served.
    for (const node of declaration.graph.nodes) {
      expect(node.capability.id).toBe(CATALOG_ENTRY.id);
      expect(node.capability.version).toBe(CATALOG_ENTRY.version);
    }
    const compositeRef = definition.root.nodes.find(
      (node) => node.kind === 'CompositeRef'
    );
    expect(compositeRef, 'root does not reference the declaration').toBeDefined();
    expect(compositeRef!.declarationId).toBe('closure-composite');

    if (EXPORT_PATH) {
      mkdirSync(path.dirname(EXPORT_PATH), { recursive: true });
      writeFileSync(EXPORT_PATH, `${JSON.stringify(definition, null, 2)}\n`);
    }
  });
});
