// @vitest-environment jsdom
/**
 * Component coverage for the pipeline graph route (pipeline-canvas-view
 * spec): loading, the detail render path, 404 -> not-found with a back link,
 * an error surface with its fix hint, and the built-in read-only notice. The
 * real `@xyflow/react` canvas needs browser APIs jsdom lacks (ResizeObserver,
 * DOMMatrixReadOnly) — design D6 splits that out to manual/QA verification —
 * so this file mocks the flow component and asserts on what `layoutGraph`
 * fed it, not on canvas pixels.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getPipelineDetail: vi.fn(),
    validatePipeline: vi.fn(),
    getPipelineCatalog: vi.fn(),
    mutatePipeline: vi.fn(),
    putKey: vi.fn(),
    deleteKey: vi.fn(),
  };
});

interface MockNode {
  id: string;
  type?: string;
  data?: {
    definitionKind?: string;
    editorSupported?: boolean;
    inputPorts?: { id: string; type?: string }[];
    outputPorts?: { id: string; type?: string }[];
    issueSeverity?: string;
  };
  deletable?: boolean;
  connectable?: boolean;
}

interface MockEdge {
  id: string;
  data?: { issueSeverity?: string };
}

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: {
    nodes: MockNode[];
    edges: MockEdge[];
    onNodeClick?: (e: unknown, n: MockNode) => void;
    onPaneClick?: () => void;
    onConnect?: (connection: {
      source: string;
      sourceHandle: string;
      target: string;
      targetHandle: string;
    }) => void;
    onNodesChange?: (changes: { type: 'remove'; id: string }[]) => void;
    onEdgesChange?: (changes: { type: 'remove'; id: string }[]) => void;
    proOptions?: { hideAttribution?: boolean };
  }) => (
    <div data-testid="mock-reactflow-wrapper" data-hide-attribution={String(props.proOptions?.hideAttribution)}>
      <div data-testid="mock-reactflow">{props.nodes.map((n) => n.id).join(',')}</div>
      <div data-testid="mock-reactflow-edges">
        {props.edges.map((edge) => (
          <span
            key={edge.id}
            data-testid="mock-edge"
            data-edge-id={edge.id}
            data-issue={edge.data?.issueSeverity}
          >
            {edge.id}
            <button
              type="button"
              data-testid="mock-edge-remove"
              data-edge-id={edge.id}
              onClick={() => props.onEdgesChange?.([{ type: 'remove', id: edge.id }])}
            >
              remove {edge.id}
            </button>
          </span>
        ))}
      </div>
      <div data-testid="mock-reactflow-controls">
        {props.nodes
          .filter((n) => n.type === 'stage')
          .map((n) => (
            <span
              key={n.id}
              data-testid="mock-node"
              data-node-id={n.id}
              data-definition-kind={n.data?.definitionKind}
              data-editor-supported={String(n.data?.editorSupported)}
              data-input-ports={JSON.stringify(n.data?.inputPorts ?? [])}
              data-output-ports={JSON.stringify(n.data?.outputPorts ?? [])}
              data-issue={n.data?.issueSeverity}
              data-deletable={String(n.deletable)}
              data-connectable={String(n.connectable)}
            >
              <button
                type="button"
                data-testid="mock-node-click"
                data-node-id={n.id}
                onClick={() => props.onNodeClick?.(null, n)}
              >
                select {n.id}
              </button>
              <button
                type="button"
                data-testid="mock-node-remove"
                data-node-id={n.id}
                onClick={() => props.onNodesChange?.([{ type: 'remove', id: n.id }])}
              >
                remove {n.id}
              </button>
            </span>
          ))}
        <button
          type="button"
          data-testid="mock-connect-atomic-gate"
          onClick={() =>
            props.onConnect?.({
              source: 'atomic',
              sourceHandle: 'done',
              target: 'gate',
              targetHandle: 'input',
            })
          }
        >
          connect atomic to gate
        </button>
        <button type="button" data-testid="mock-pane-click" onClick={() => props.onPaneClick?.()}>
          pane
        </button>
      </div>
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  ReactFlowProvider: ({ children }: { children: unknown }) => <>{children}</>,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  // pipeline-canvas-edit additions: the editor's connect/drag/drop wiring.
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
  addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
  applyNodeChanges: (_changes: unknown[], nodes: unknown[]) => nodes,
  applyEdgeChanges: (_changes: unknown[], edges: unknown[]) => edges,
}));

import { LocationProvider, Router, Route } from 'preact-iso';
import { PipelineCanvasPage } from '../../src/canvas/PipelineCanvasPage.js';
import { V2NodePanel } from '../../src/canvas/V2NodePanel.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';
import type {
  PipelineCatalogResponse,
  PipelineDetailResponse,
  ThresholdValue,
  WirePipelineDefinition,
} from '../../src/api/types.js';
import {
  __resetLocaleForTesting,
  setLocale,
} from '../../src/i18n/store.js';

const catalogFixture: PipelineCatalogResponse = {
  roles: ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'],
  skills: [
    { id: 'rasen-propose', description: 'Propose a change', enabled: true },
    { id: 'rasen-apply', description: 'Apply tasks', enabled: true },
  ],
  runtimes: ['claude', 'codex'],
  stageKinds: ['standard', 'decompose'],
  loopKinds: ['none', 'review-cycle', 'goal'],
  verifyPolicies: ['adaptive', 'standard', 'light'],
  conditionLabels: ['always'],
  gate: { default: false },
  handoff: { fractionRange: [0, 1], remainingTokensGt: 0 },
};

const v2CatalogFixture = {
  ...catalogFixture,
  skills: catalogFixture.skills.map((skill, index) => ({
    ...skill,
    capability: {
      id: `skill:${skill.id}`,
      version: index === 0 ? 'digest-propose' : 'digest-apply',
      inputs: index === 0 ? [{ name: 'brief', type: 'artifact/text' }] : [],
      artifacts: index === 0 ? [] : [{ name: 'patch', type: 'artifact/text' }],
      outcomes: ['done'],
    },
  })),
} as PipelineCatalogResponse;

const v2Definition = {
  version: 2 as const,
  id: 'definition:v2-canvas',
  sourceId: 'source:v2-canvas',
  name: 'v2-canvas',
  description: 'Definition v2 Canvas fixture',
  inputs: [],
  artifacts: [],
  outcomes: ['done', 'rejected'],
  declarations: [
    {
      id: 'composite:review',
      kind: 'Composite' as const,
      provenance: 'custom' as const,
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      graph: { nodes: [], connections: [] },
    },
  ],
  root: {
    nodes: [
      {
        id: 'atomic',
        kind: 'AtomicStage' as const,
        capability: { id: 'skill:rasen-apply', version: 'digest-apply' },
        retained: { authorNote: 'keep me' },
      },
      {
        id: 'gate',
        kind: 'Gate' as const,
        outcomes: ['approved', 'rejected'],
        retained: { branchNote: 'keep gate metadata' },
      },
      {
        id: 'choice',
        kind: 'Choice' as const,
        outcomes: ['fast', 'careful'],
        retained: { branchNote: 'keep choice metadata' },
      },
      { id: 'finish', kind: 'Finish' as const, outcome: 'done' },
      {
        id: 'composite',
        kind: 'CompositeRef' as const,
        declarationId: 'composite:review',
        retained: { later: true },
      },
      {
        id: 'loop',
        kind: 'BoundedLoop' as const,
        body: 'composite:review',
        limits: { maxIterations: 2 },
        exits: { done: { action: 'exit' as const, outcome: 'done' } },
      },
      { id: 'fanout', kind: 'FanOut' as const, branches: ['a', 'b'] },
      { id: 'join', kind: 'Join' as const, inputs: ['a', 'b'] },
    ],
    connections: [
      {
        id: 'atomic:done->gate:input',
        from: { node: 'atomic', port: 'done' },
        to: { node: 'gate', port: 'input' },
      },
    ],
  },
};

const v2Preparation = {
  authoredVersion: 2 as const,
  normalizedVersion: 2 as const,
  definitionValid: true,
  diagnostics: [],
  digests: {
    source: 'source-digest',
    capability: 'capability-digest',
    plan: 'plan-digest',
  },
  planAvailable: true,
  executable: false,
  executionMode: 'unavailable' as const,
  unavailableReason: 'ecp_v2_runtime_unavailable',
};

const v2EditableDetail = {
  ...pipelineDetailFixture,
  pipeline: {
    ...pipelineDetailFixture.pipeline,
    name: 'v2-canvas',
    description: 'Definition v2 Canvas fixture',
    provenance: 'user' as const,
    sourceLayer: 'user' as const,
    stages: [],
    authoredVersion: 2 as const,
    normalizedVersion: 2 as const,
    definitionValid: true,
    planAvailable: true,
    executable: false,
    executionMode: 'unavailable' as const,
    unavailableReason: 'ecp_v2_runtime_unavailable',
  },
  definition: v2Definition,
  preparation: v2Preparation,
  editable: true,
} as PipelineDetailResponse;

async function flushMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAt(container: HTMLElement, path: string): Promise<void> {
  window.history.pushState({}, '', path);
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
    await flushMicrotasks();
  });
}

describe('PipelineCanvasPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
    __resetLocaleForTesting();
    vi.clearAllMocks();
  });

  it('shows a loading state before the detail resolves', async () => {
    let resolve!: (v: typeof pipelineDetailFixture) => void;
    vi.mocked(client.getPipelineDetail).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    window.history.pushState({}, '', '/p/proj_x/pipelines/small-feature');
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
    expect(container.querySelector('[data-testid="pipeline-canvas-loading"]')).not.toBeNull();
    await act(async () => {
      resolve(pipelineDetailFixture);
      await flushMicrotasks();
    });
  });

  it('renders the detail path: header, provenance, read-only notice, and the graph nodes', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(pipelineDetailFixture);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');

    expect(client.getPipelineDetail).toHaveBeenCalledWith('small-feature', 'project:proj_x');
    expect(container.querySelector('[data-testid="pipeline-canvas-page"]')).not.toBeNull();
    expect(container.querySelector('.pipeline-canvas__name')?.textContent).toBe('small-feature');
    expect(container.querySelector('[data-testid="pipeline-canvas-provenance"]')?.textContent).toBe('built-in');
    expect(container.querySelector('[data-testid="pipeline-canvas-readonly-notice"]')).not.toBeNull();

    const mockFlow = container.querySelector('[data-testid="mock-reactflow"]');
    expect(mockFlow).not.toBeNull();
    // Every definition stage plus the one parallel group container is fed to the flow.
    const ids = mockFlow!.textContent!.split(',');
    expect(ids).toContain('group:checks');
    for (const stageId of ['propose', 'apply', 'review', 'cso', 'qa', 'review-loop', 'ship']) {
      expect(ids).toContain(stageId);
    }
  });

  it('shows a not-found state with a back link for an unknown pipeline', async () => {
    vi.mocked(client.getPipelineDetail).mockRejectedValue(
      new ApiError(404, { error: { code: 'not_found', message: 'No pipeline named "ghost".' } })
    );
    await mountAt(container, '/p/proj_x/pipelines/ghost');

    const notFound = container.querySelector('[data-testid="pipeline-canvas-not-found"]');
    expect(notFound).not.toBeNull();
    expect(notFound!.textContent).toContain('ghost');
    const back = notFound!.querySelector('a');
    expect(back?.getAttribute('href')).toBe('/p/proj_x/pipelines');
  });

  it('shows the error surface with its fix hint for a non-404 failure', async () => {
    vi.mocked(client.getPipelineDetail).mockRejectedValue(
      new ApiError(500, { error: { code: 'internal_error', message: 'Boom.', fix: 'Try again.' } })
    );
    await mountAt(container, '/p/proj_x/pipelines/small-feature');

    const error = container.querySelector('[data-testid="pipeline-canvas-error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('Boom.');
    expect(error!.textContent).toContain('Try again.');
  });

  it('omits the read-only notice for an editable (non-built-in) pipeline', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue({
      ...pipelineDetailFixture,
      pipeline: { ...pipelineDetailFixture.pipeline, provenance: 'user', sourceLayer: 'user' },
      editable: true,
    });
    await mountAt(container, '/p/proj_x/pipelines/small-feature');

    expect(container.querySelector('[data-testid="pipeline-canvas-readonly-notice"]')).toBeNull();
  });
});

/**
 * Edit-mode coverage (pipeline-canvas-edit tasks 5.1-5.3): mode gating,
 * validate-blocks-save / warnings-pass / issue selection, the origin stamp
 * and 422-collision / 409-busy save-failure UX, dirty guards, and the
 * new-draft mount + refresh-degradation recovery affordance. The DnD palette
 * and real drag/connect interactions need browser APIs jsdom lacks — those
 * stay with browser QA (task 6.2); this file exercises the header controls,
 * the mocked flow's node-click/pane-click callbacks, and the panel/drawer
 * components the page wires them to.
 */
describe('PipelineCanvasPage — edit mode', () => {
  let container: HTMLElement;

  const editableDetail = {
    ...pipelineDetailFixture,
    pipeline: { ...pipelineDetailFixture.pipeline, provenance: 'user' as const, sourceLayer: 'user' as const },
    editable: true,
  };

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(catalogFixture);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
    __resetLocaleForTesting();
    vi.clearAllMocks();
  });

  async function enterEdit(): Promise<void> {
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
  }

  async function clickAndFlush(el: Element | null): Promise<void> {
    await act(async () => {
      (el as HTMLElement).click();
      await flushMicrotasks();
    });
  }

  async function setValueAndFlush(
    el: Element | null,
    value: string,
    eventType: 'change' | 'input' = 'change'
  ): Promise<void> {
    await act(async () => {
      const input = el as HTMLInputElement | HTMLSelectElement;
      input.value = value;
      input.dispatchEvent(new Event(eventType, { bubbles: true }));
      await flushMicrotasks();
    });
  }

  it('gates the Edit button on `editable` and offers Duplicate-to-edit on a built-in', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(pipelineDetailFixture); // editable: false
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    expect(container.querySelector('[data-testid="pipeline-canvas-edit"]')).toBeNull();
    expect(container.querySelector('[data-testid="pipeline-canvas-duplicate"]')).not.toBeNull();

    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    render(null, container);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    expect(container.querySelector('[data-testid="pipeline-canvas-edit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pipeline-canvas-duplicate"]')).toBeNull();
  });

  it('navigates duplicate-to-edit into edit mode on the new name, seeded from the built-in definition', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(pipelineDetailFixture); // editable: false
    await mountAt(container, '/p/proj_x/pipelines/small-feature');

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-duplicate"]'));
    const nameInput = container.querySelector('[data-testid="pipeline-canvas-duplicate-name"]') as HTMLInputElement;
    await act(async () => {
      nameInput.value = 'small-feature-copy';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-duplicate-submit"]'));

    expect(window.location.pathname).toBe('/p/proj_x/pipelines/small-feature-copy');
    // getPipelineDetail was called once for the original — the destination
    // consumes the pending draft and never fetches (it does not exist yet).
    expect(client.getPipelineDetail).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pipeline-canvas-save"]')).not.toBeNull();
    expect(container.querySelector('.pipeline-canvas__name')?.textContent).toBe('small-feature-copy');
    await clickAndFlush(
      [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
        (node) => node.getAttribute('data-node-id') === 'propose'
      ) ?? null
    );
    expect(container.querySelector('[data-testid="stage-panel-handoff"]')).not.toBeNull();
  });

  it.each([
    {
      form: 'fraction',
      inputTestId: 'stage-panel-handoff-fraction',
      rawValue: '0.64',
      expected: 0.64 as ThresholdValue,
      expectedMin: '0',
      expectedMax: '1',
    },
    {
      form: 'remaining',
      inputTestId: 'stage-panel-handoff-remaining',
      rawValue: '42000',
      expected: { remainingTokens: 42_000 } as ThresholdValue,
      expectedMin: '1',
      expectedMax: null,
    },
  ])(
    'authors a $form threshold as dirty definition data and reloads the saved form',
    async ({ form, inputTestId, rawValue, expected, expectedMin, expectedMax }) => {
      const base = structuredClone(editableDetail) as PipelineDetailResponse;
      let savedDefinition: WirePipelineDefinition | undefined;
      vi.mocked(client.getPipelineDetail)
        .mockResolvedValueOnce(base)
        .mockImplementation(async () => ({ ...base, definition: savedDefinition! }));
      vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
      vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
        savedDefinition = structuredClone(
          (request as { definition: WirePipelineDefinition }).definition
        );
        return {
          pipeline: { name: 'small-feature', path: '/pipelines/small-feature' },
          created: false,
        };
      });

      await mountAt(container, '/p/proj_x/pipelines/small-feature');
      await enterEdit();
      await clickAndFlush(
        [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
          (node) => node.getAttribute('data-node-id') === 'propose'
        ) ?? null
      );
      await setValueAndFlush(
        container.querySelector('[data-testid="stage-panel-handoff-form"]'),
        form
      );
      expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).not.toBeNull();
      const thresholdInput = container.querySelector(
        `[data-testid="${inputTestId}"]`
      ) as HTMLInputElement;
      expect(thresholdInput.getAttribute('min')).toBe(expectedMin);
      expect(thresholdInput.getAttribute('max')).toBe(expectedMax);
      await setValueAndFlush(thresholdInput, rawValue, 'input');
      await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

      if (savedDefinition?.version !== 1) throw new Error('expected v1 definition');
      const savedStage = savedDefinition.stages.find((stage) => stage.id === 'propose')!;
      expect(savedStage.handoff?.threshold).toEqual(expected);
      expect(client.putKey).not.toHaveBeenCalled();
      expect(client.deleteKey).not.toHaveBeenCalled();

      await enterEdit();
      await clickAndFlush(
        [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
          (node) => node.getAttribute('data-node-id') === 'propose'
        ) ?? null
      );
      expect(
        (container.querySelector('[data-testid="stage-panel-handoff-form"]') as HTMLSelectElement)
          .value
      ).toBe(form);
      expect(
        (container.querySelector(`[data-testid="${inputTestId}"]`) as HTMLInputElement)
          .value
      ).toBe(rawValue);
    }
  );

  it.each([
    {
      form: 'fraction',
      inputTestId: 'stage-panel-handoff-fraction',
      initial: 0.8 as ThresholdValue,
      invalidPrefix: '0',
      incrementalValues: ['0.6', '0.64'],
      expected: 0.64 as ThresholdValue,
    },
    {
      form: 'remaining',
      inputTestId: 'stage-panel-handoff-remaining',
      initial: { remainingTokens: 60_000 } as ThresholdValue,
      invalidPrefix: null,
      incrementalValues: ['4', '42', '420', '4200', '42000'],
      expected: { remainingTokens: 42_000 } as ThresholdValue,
    },
  ])(
    'keeps a raw edit buffer while incrementally clearing and retyping a $form threshold',
    async ({
      inputTestId,
      initial,
      invalidPrefix,
      incrementalValues,
      expected,
    }) => {
      const base = structuredClone(editableDetail) as PipelineDetailResponse;
      base.definition.stages[0] = {
        ...base.definition.stages[0],
        handoff: { threshold: initial },
      };
      let savedDefinition: WirePipelineDefinition | undefined;
      vi.mocked(client.getPipelineDetail).mockResolvedValue(base);
      vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
      vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
        savedDefinition = structuredClone(
          (request as { definition: WirePipelineDefinition }).definition
        );
        return {
          pipeline: { name: 'small-feature', path: '/pipelines/small-feature' },
          created: false,
        };
      });

      await mountAt(container, '/p/proj_x/pipelines/small-feature');
      await enterEdit();
      await clickAndFlush(
        [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
          (node) => node.getAttribute('data-node-id') === 'propose'
        ) ?? null
      );

      const thresholdInput = container.querySelector(
        `[data-testid="${inputTestId}"]`
      ) as HTMLInputElement;
      await setValueAndFlush(thresholdInput, '', 'input');
      expect(thresholdInput.value).toBe('');
      expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).toBeNull();

      if (invalidPrefix !== null) {
        await setValueAndFlush(thresholdInput, invalidPrefix, 'input');
        expect(thresholdInput.value).toBe(invalidPrefix);
        expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).toBeNull();
      }

      for (const value of incrementalValues) {
        await setValueAndFlush(thresholdInput, value, 'input');
        expect(thresholdInput.value).toBe(value);
      }
      await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

      expect(savedDefinition!.stages[0].handoff?.threshold).toEqual(expected);
    }
  );

  it('clears only the threshold, preserves hidden handoff fields, and never writes a config key', async () => {
    const base = structuredClone(editableDetail) as PipelineDetailResponse;
    base.definition.stages[0] = {
      ...base.definition.stages[0],
      handoff: { threshold: 0.7, maxRelays: 4, stallLimit: 2 },
    };
    let savedDefinition: WirePipelineDefinition | undefined;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce(base)
      .mockImplementation(async () => ({ ...base, definition: savedDefinition! }));
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      savedDefinition = structuredClone(
        (request as { definition: WirePipelineDefinition }).definition
      );
      return {
        pipeline: { name: 'small-feature', path: '/pipelines/small-feature' },
        created: false,
      };
    });

    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();
    await clickAndFlush(
      [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
        (node) => node.getAttribute('data-node-id') === 'propose'
      ) ?? null
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="stage-panel-handoff-form"]'),
      'inherit'
    );
    expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).not.toBeNull();
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    expect(savedDefinition!.stages[0].handoff).toEqual({
      maxRelays: 4,
      stallLimit: 2,
    });
    expect(client.putKey).not.toHaveBeenCalled();
    expect(client.deleteKey).not.toHaveBeenCalled();
  });

  it('re-localizes the visible Canvas handoff field without remounting the panel', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();
    await clickAndFlush(
      [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
        (node) => node.getAttribute('data-node-id') === 'propose'
      ) ?? null
    );
    const panel = container.querySelector('[data-testid="stage-panel"]')!;
    expect(panel.textContent).toContain('Stage handoff threshold');

    await act(async () => {
      setLocale('zh-cn');
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="stage-panel"]')).toBe(panel);
    expect(panel.textContent).toContain('阶段交接阈值');

    await act(async () => {
      setLocale('ja');
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="stage-panel"]')).toBe(panel);
    expect(panel.textContent).toContain('ステージの引き継ぎしきい値');
  });

  it('offers a Start-assembling recovery affordance on the not-found view and enters edit mode with an empty draft', async () => {
    vi.mocked(client.getPipelineDetail).mockRejectedValue(
      new ApiError(404, { error: { code: 'not_found', message: 'No pipeline named "brand-new".' } })
    );
    await mountAt(container, '/p/proj_x/pipelines/brand-new');
    expect(container.querySelector('[data-testid="pipeline-canvas-not-found"]')).not.toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-start-assembling"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-save"]')).not.toBeNull();
    expect(container.querySelector('.pipeline-canvas__name')?.textContent).toBe('brand-new');
    // No stages yet — the mock flow renders an empty node-id string.
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toBe('');
  });

  it('blocks save on an error-severity issue, passes on warnings only, and stamps origin: ui on the save body', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [{ severity: 'error', path: '/stages/0/skill', message: 'Missing reviewer stage.' }],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-save-blocked"]')).not.toBeNull();
    expect(client.mutatePipeline).not.toHaveBeenCalled();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: true,
      issues: [{ severity: 'warning', path: '/stages/0/skill', message: 'Consider a stricter verify policy.' }],
    });
    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: 'small-feature', path: '/pipelines/small-feature' },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(editableDetail);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    expect(client.mutatePipeline).toHaveBeenCalledTimes(1);
    for (const [definition] of vi.mocked(client.validatePipeline).mock.calls as [{ origin?: string }][]) {
      expect(definition.origin).toBe('ui');
    }
    const body = vi.mocked(client.mutatePipeline).mock.calls[0][0] as { definition: { origin?: string } };
    expect(body.definition.origin).toBe('ui');
    expect(container.querySelector('[data-testid="pipeline-canvas-save-collision"]')).toBeNull();
    // Save succeeded — back in view mode.
    expect(container.querySelector('[data-testid="pipeline-canvas-edit"]')).not.toBeNull();
  });

  it('passes proOptions.hideAttribution so the third-party watermark never renders', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(pipelineDetailFixture);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    expect(
      container.querySelector('[data-testid="mock-reactflow-wrapper"]')!.getAttribute('data-hide-attribution')
    ).toBe('true');
  });

  it('shows a visible "no issues" chip on a clean validate, and clears it when the draft is edited', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({ valid: true, issues: [] });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const chip = container.querySelector('[data-testid="pipeline-canvas-validation-result"]')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('No issues');

    // Editing the draft invalidates the previous result — the chip clears.
    const description = container.querySelector('[data-testid="pipeline-canvas-description"]') as HTMLInputElement;
    await act(async () => {
      description.value = 'edited';
      description.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="pipeline-canvas-validation-result"]')).toBeNull();
  });

  it('counts errors and warnings in the result chip and lists them in the visible drawer', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [
        { severity: 'error', path: '/stages/0/skill', message: 'Missing reviewer stage.' },
        { severity: 'warning', path: '/stages/1/skill', message: 'Consider a stricter verify policy.' },
      ],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const chip = container.querySelector('[data-testid="pipeline-canvas-validation-result"]')!;
    expect(chip.textContent).toContain('1 error');
    expect(chip.textContent).toContain('1 warning');
    // The issue list is present within the editor viewport.
    expect(container.querySelectorAll('[data-testid="issues-drawer-item"]')).toHaveLength(2);
  });

  it('keeps the error visible when the validation API fails during save (no silent reset to idle)', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    // The server hiccups while validating on Save.
    vi.mocked(client.validatePipeline).mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'internal_error', message: 'Validation service unavailable.' } })
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    // The error surface stays visible — the Save path never goes silent.
    const err = container.querySelector('[data-testid="pipeline-canvas-save-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('Validation service unavailable.');
    expect(client.mutatePipeline).not.toHaveBeenCalled();
  });

  it('clears the issue drawer (not just the chip) when the draft is edited after findings', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [{ severity: 'error', path: '/stages/0/skill', message: 'Missing reviewer stage.' }],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(container.querySelector('[data-testid="issues-drawer"]')).not.toBeNull();

    const description = container.querySelector('[data-testid="pipeline-canvas-description"]') as HTMLInputElement;
    await act(async () => {
      description.value = 'edited after findings';
      description.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    // Both the chip AND the drawer clear — no stale findings survive the edit.
    expect(container.querySelector('[data-testid="pipeline-canvas-validation-result"]')).toBeNull();
    expect(container.querySelector('[data-testid="issues-drawer"]')).toBeNull();
  });

  it('dismissing the drawer also clears the blocked-save message it referenced', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [{ severity: 'error', path: '/stages/0/skill', message: 'Missing reviewer stage.' }],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-save-blocked"]')).not.toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="issues-drawer-dismiss"]'));
    // The message that pointed "below" must not orphan once its issues are gone.
    expect(container.querySelector('[data-testid="pipeline-canvas-save-blocked"]')).toBeNull();
    expect(container.querySelector('[data-testid="issues-drawer"]')).toBeNull();
  });

  it('blocked save shows the blocking message together with the visible issues panel', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [{ severity: 'error', path: '/stages/0/skill', message: 'Missing reviewer stage.' }],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const blocked = container.querySelector('[data-testid="pipeline-canvas-save-blocked"]')!;
    expect(blocked).not.toBeNull();
    expect(blocked.textContent).toContain('below');
    // The blocking issues are visible alongside the message.
    expect(container.querySelector('[data-testid="issues-drawer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issues-drawer-item"]')!.textContent).toContain(
      'Missing reviewer stage.'
    );
    expect(client.mutatePipeline).not.toHaveBeenCalled();
  });

  it('renders returned issues in the drawer and lets a click select the mapped stage', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [{ severity: 'error', path: '/stages/1/skill', message: 'Skill is disabled.' }],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const drawerItem = container.querySelector('[data-testid="issues-drawer-item"]');
    expect(drawerItem).not.toBeNull();
    expect(drawerItem!.textContent).toContain('Skill is disabled.');

    await clickAndFlush(container.querySelector('[data-testid="issues-drawer-select"]'));
    // Stage index 1 in the fixture's definition is 'apply'.
    expect(container.querySelector('[data-testid="stage-panel"]')?.getAttribute('data-stage')).toBe('apply');
  });

  it('highlights the nested handoff field for a server validation issue', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [{
        severity: 'error',
        path: '/stages/0/handoff/threshold',
        message: 'Handoff threshold is out of range.',
      }],
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    await clickAndFlush(container.querySelector('[data-testid="issues-drawer-select"]'));

    expect(
      container.querySelector('[data-testid="stage-panel-handoff"]')?.classList
    ).toContain('stage-panel__field--issue-error');
  });

  it('refreshes the Id input to the newly-selected stage when switching selection (no stale carry-over)', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    function nodeButton(stageId: string): Element | null {
      return [...container.querySelectorAll('[data-testid="mock-node-click"]')].find(
        (el) => el.getAttribute('data-node-id') === stageId
      ) ?? null;
    }

    await clickAndFlush(nodeButton('propose'));
    let idInput = container.querySelector('[data-testid="stage-panel-id"]') as HTMLInputElement;
    expect(idInput.value).toBe('propose');

    await clickAndFlush(nodeButton('apply'));
    idInput = container.querySelector('[data-testid="stage-panel-id"]') as HTMLInputElement;
    expect(idInput.value).toBe('apply');
  });

  it('offers an explicit overwrite retry on a 422 collision, stamping force on the retried call', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'cli_error', message: 'Pipeline "small-feature" already exists.' } })
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-save-collision"]')!.textContent).toContain(
      'already exists'
    );

    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: 'small-feature', path: '/pipelines/small-feature' },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(editableDetail);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save-overwrite"]'));

    expect(client.mutatePipeline).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.mutatePipeline).mock.calls[1][0]).toMatchObject({ force: true });
  });

  it('surfaces a 409 busy refusal with a manual retry — no automatic retry loop', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'busy', message: 'Another pipeline mutation is already in flight.' } })
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-save-busy"]')).not.toBeNull();
    // No automatic retry — mutatePipeline was called exactly once so far.
    expect(client.mutatePipeline).toHaveBeenCalledTimes(1);

    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: 'small-feature', path: '/pipelines/small-feature' },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(editableDetail);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save-retry"]'));
    expect(client.mutatePipeline).toHaveBeenCalledTimes(2);
  });

  it('a rapid double-click on Save while a save is in flight fires exactly one mutation call', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();

    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    let resolveMutate!: (v: { pipeline: { name: string; path: string }; created: boolean }) => void;
    vi.mocked(client.mutatePipeline).mockReturnValue(
      new Promise((r) => {
        resolveMutate = r;
      })
    );

    const saveButton = container.querySelector('[data-testid="pipeline-canvas-save"]') as HTMLButtonElement;
    await act(async () => {
      // Both clicks fire before the mutation resolves — the second must be
      // rejected even though the `disabled` attribute has not re-rendered yet.
      saveButton.click();
      saveButton.click();
      await flushMicrotasks();
    });
    expect(client.mutatePipeline).toHaveBeenCalledTimes(1);

    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(editableDetail);
    await act(async () => {
      resolveMutate({ pipeline: { name: 'small-feature', path: '/pipelines/small-feature' }, created: false });
      await flushMicrotasks();
    });
    expect(client.mutatePipeline).toHaveBeenCalledTimes(1);
  });

  it('shows the dirty chip once edited, confirms discard-while-dirty on the back link, and releases the guard on Discard', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await enterEdit();
    expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).toBeNull();

    const description = container.querySelector('[data-testid="pipeline-canvas-description"]') as HTMLInputElement;
    await act(async () => {
      description.value = 'An edited description';
      description.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).not.toBeNull();

    // Back link while dirty asks first.
    await clickAndFlush(container.querySelector('.pipeline-canvas__back'));
    expect(container.querySelector('[data-testid="pipeline-canvas-nav-confirm"]')).not.toBeNull();

    // Staying keeps the draft.
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-nav-confirm-stay"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-nav-confirm"]')).toBeNull();
    expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).not.toBeNull();

    // Discard (direct button) releases the guard and returns to view mode.
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-discard"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-edit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pipeline-canvas-dirty-chip"]')).toBeNull();
  });

  it('renders the closed v2 vocabulary with exact typed handles and preserves unsupported kinds as read-only cards', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    for (const kind of [
      'AtomicStage',
      'Gate',
      'Choice',
      'Finish',
      'CompositeRef',
      'BoundedLoop',
      'FanOut',
      'Join',
    ]) {
      expect(
        container.querySelector(`[data-testid="mock-node"][data-definition-kind="${kind}"]`)
      ).not.toBeNull();
    }

    const atomic = container.querySelector('[data-testid="mock-node"][data-node-id="atomic"]')!;
    expect(JSON.parse(atomic.getAttribute('data-output-ports')!)).toEqual([
      { id: 'patch', type: 'artifact/text' },
      { id: 'done', type: 'outcome/done' },
    ]);
    const gate = container.querySelector('[data-testid="mock-node"][data-node-id="gate"]')!;
    expect(JSON.parse(gate.getAttribute('data-output-ports')!)).toEqual([
      { id: 'approved', type: 'outcome/approved' },
      { id: 'rejected', type: 'outcome/rejected' },
    ]);

    // ECP-2 moved CompositeRef and BoundedLoop INTO the editable vocabulary:
    // `executable-custom-composite` delta, "Canvas creates and references a
    // Custom Composite declaration" — "The user SHALL be able to reference the
    // declaration from the root graph via a `CompositeRef` node or embed it in
    // a `BoundedLoop`" — and "Canvas deletes a CompositeRef or declaration" —
    // "The Canvas SHALL allow the user to delete a `CompositeRef` node from the
    // root graph". Commit 60bfeaa9 added both to `V2_EDITABLE_NODE_KINDS` and
    // updated `draft.test.ts`, but this expectation kept the pre-ECP-2 answer.
    for (const id of ['composite', 'loop']) {
      const card = container.querySelector(`[data-testid="mock-node"][data-node-id="${id}"]`)!;
      expect(card.getAttribute('data-editor-supported')).toBe('true');
      expect(card.getAttribute('data-deletable')).toBe('true');
      expect(card.getAttribute('data-connectable')).toBe('true');
    }

    // FanOut/Join stay read-only cards. ECP-4's `executable-parallel-pipelines`
    // delta, "Canvas provides parallel authoring with legality feedback",
    // promises that the Canvas DISPLAYS them with their structural details and
    // validates their legality — it does not promise root-graph authoring, and
    // `draft.test.ts` pins `['FanOut','Join'].some(isV2EditableNodeKind)` false.
    for (const id of ['fanout', 'join']) {
      const card = container.querySelector(`[data-testid="mock-node"][data-node-id="${id}"]`)!;
      expect(card.getAttribute('data-editor-supported')).toBe('false');
      expect(card.getAttribute('data-deletable')).toBe('false');
      expect(card.getAttribute('data-connectable')).toBe('false');
    }
  });

  it('shows the FanOut and Join structural details on the read-only panel', async () => {
    // The other half of ECP-4's Canvas requirement: "#### Scenario: FanOut
    // panel shows members and limits — WHEN a FanOut node is selected in the
    // Canvas — THEN the panel SHALL show the member list ... AND SHALL show
    // concurrency cap and budget". The renderers shipped with ECP-4 but were
    // gated behind the editable-kind check, so no selection could ever reach
    // them; this pins them to the read-only panel where FanOut/Join land.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="fanout"]')
    );
    expect(container.querySelector('[data-testid="v2-node-panel-unsupported"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="v2-node-panel-fanout"]')).not.toBeNull();
    // No editable stable-id field: display does not imply authoring.
    expect(container.querySelector('[data-testid="v2-node-panel-id"]')).toBeNull();

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="join"]')
    );
    expect(container.querySelector('[data-testid="v2-node-panel-join"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="v2-node-panel-id"]')).toBeNull();
  });

  it('creates, selects, edits, renames, and deletes only the enabled v2 root node kinds', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    for (const kind of ['AtomicStage', 'Gate', 'Choice', 'Finish']) {
      await clickAndFlush(container.querySelector(`[data-testid="v2-palette-add-${kind}"]`));
    }
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'atomic-stage'
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'gate-2'
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'choice-2'
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'finish-2'
    );

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="gate"]')
    );
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'gate'
    );
    const renamedId = container.querySelector(
      '[data-testid="v2-node-panel-id"]'
    ) as HTMLInputElement;
    renamedId.focus();
    await setValueAndFlush(renamedId, 'approval-gate', 'input');
    await act(async () => {
      renamedId.blur();
      await flushMicrotasks();
    });
    const outcomes = container.querySelector(
      '[data-testid="v2-node-panel-outcomes"]'
    ) as HTMLInputElement;
    await setValueAndFlush(
      outcomes,
      'approved,rejected,escalated',
      'input'
    );
    await act(async () => {
      outcomes.blur();
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'approval-gate'
    );

    // A CompositeRef IS deletable — ECP-2 `executable-custom-composite`,
    // "Requirement: Canvas deletes a CompositeRef or declaration": "The Canvas
    // SHALL allow the user to delete a `CompositeRef` node from the root
    // graph." This assertion previously encoded the pre-ECP-2 refusal.
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-remove"][data-node-id="composite"]')
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).not.toContain(
      'composite'
    );
    // A FanOut is NOT deletable — the editable vocabulary still excludes it
    // (ECP-4 promises display + legality feedback, not root authoring), so the
    // removal is refused and the node survives.
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-remove"][data-node-id="fanout"]')
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'fanout'
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-remove"][data-node-id="choice"]')
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).not.toContain(
      'choice,'
    );
  });

  // --- ECP-2 tasks 8.5/8.6, delivered by ECP-5 (user-approved scope) -------
  //
  // `executable-custom-composite` requires the Canvas to CREATE a
  // `CompositeDeclaration`, edit its contract, add/remove body AtomicStages,
  // constrain the body palette, and refuse to delete a referenced declaration.
  // The pure model shipped in `draft.ts` with ZERO callers in `src`, so every
  // one of those requirements was unreachable. These cover the affordance,
  // in the shape ECP-2's own task 8.7 names.

  it('creates a declaration, references it from the root, and saves the round-trip', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    // "The Canvas SHALL allow the user to create a new `CompositeDeclaration`
    // with a unique id, provenance `custom` …"
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'my-composite',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));

    const row = container.querySelector(
      '[data-testid="declaration-row"][data-declaration-id="my-composite"]'
    );
    expect(row).not.toBeNull();
    expect(row!.getAttribute('data-provenance')).toBe('custom');
    // Creating opens the editor on the new declaration.
    expect(
      container.querySelector('[data-testid="declaration-editor"]')!.getAttribute('data-declaration-id')
    ).toBe('my-composite');

    // Contract editing: "Canvas edits composite declaration scalar fields".
    await clickAndFlush(container.querySelector('[data-testid="declaration-input-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-input-name"]'),
      'brief',
      'input'
    );
    const outcomesInput = container.querySelector(
      '[data-testid="declaration-outcomes"]'
    ) as HTMLInputElement;
    outcomesInput.focus();
    await setValueAndFlush(outcomesInput, 'done,needs_fix', 'input');
    await act(async () => {
      outcomesInput.blur();
      await flushMicrotasks();
    });

    // Body stage: "Canvas edits composite body stages" (AtomicStage only).
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    const stages = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-stage"]')
    );
    expect(stages).toHaveLength(1);
    expect(stages[0]!.getAttribute('data-stage-kind')).toBe('AtomicStage');

    // Reference it from the root graph, then save and read the posted body.
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-add-CompositeRef"]'));
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(v2EditableDetail);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const posted = vi.mocked(client.mutatePipeline).mock.calls.at(-1)![0] as {
      definition: {
        declarations: { id: string; provenance: string; outcomes: string[]; inputs: { name: string }[]; graph: { nodes: { kind: string }[] } }[];
        root: { nodes: { id: string; kind: string; declarationId?: string }[] };
      };
    };
    const saved = posted.definition.declarations.find((d) => d.id === 'my-composite');
    expect(saved).toBeDefined();
    expect(saved!.provenance).toBe('custom');
    expect(saved!.outcomes).toEqual(['done', 'needs_fix']);
    expect(saved!.inputs.map((port) => port.name)).toEqual(['brief']);
    expect(saved!.graph.nodes.map((node) => node.kind)).toEqual(['AtomicStage']);
    // …and the root references it, closing "create declaration -> reference
    // from root -> save round-trip".
    expect(
      posted.definition.root.nodes.some((node) => node.kind === 'CompositeRef')
    ).toBe(true);
  });

  it('refuses to delete a declaration a root node still references, and allows it once unreferenced', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    // The fixture's `composite:review` is referenced by BOTH the `composite`
    // CompositeRef and the `loop` BoundedLoop. "The Canvas SHALL NOT allow
    // deleting a declaration that is still referenced by a root-level
    // `CompositeRef` or `BoundedLoop`."
    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-delete"][data-declaration-id="composite:review"]'
      )
    );
    expect(
      container.querySelector(
        '[data-testid="declaration-row"][data-declaration-id="composite:review"]'
      )
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="pipeline-canvas-toast"]')!.textContent).toContain(
      'still referenced'
    );

    // An unreferenced declaration deletes cleanly — proving the refusal above
    // is the reference guard and not a blanket "delete does nothing".
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'unused',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    expect(
      container.querySelector('[data-testid="declaration-row"][data-declaration-id="unused"]')
    ).not.toBeNull();
    await clickAndFlush(
      container.querySelector('[data-testid="declaration-delete"][data-declaration-id="unused"]')
    );
    expect(
      container.querySelector('[data-testid="declaration-row"][data-declaration-id="unused"]')
    ).toBeNull();
  });

  it('refuses to delete a declaration referenced ONLY by a BoundedLoop body', async () => {
    // DISCRIMINATING PROBE. With a declaration referenced by both a
    // CompositeRef and a BoundedLoop (the fixture's `composite:review`), a
    // panel that re-implemented the reference check by scanning only
    // CompositeRef nodes is indistinguishable from one that delegates to
    // `removeDeclaration`. Here the ONLY reference is a BoundedLoop `body`, so
    // the naive check allows the delete and orphans the loop's body — the
    // spec's "still referenced by a root-level `CompositeRef` **or**
    // `BoundedLoop`" is what forbids it.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'looped',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    // A loop body needs real stages; this also makes `looped` the only
    // declaration a BoundedLoop can bind (the fixture's is empty).
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-add-BoundedLoop"]'));
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'bounded-loop'
    );
    // No CompositeRef was added — the only edge to `looped` is the loop body.
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="composite-ref"]')
    ).toBeNull();

    await clickAndFlush(
      container.querySelector('[data-testid="declaration-delete"][data-declaration-id="looped"]')
    );
    expect(
      container.querySelector('[data-testid="declaration-row"][data-declaration-id="looped"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="pipeline-canvas-toast"]')!.textContent).toContain(
      'still referenced'
    );

    // Drop the loop and the same delete now succeeds — the refusal tracked the
    // reference, not the declaration.
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-remove"][data-node-id="bounded-loop"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="declaration-delete"][data-declaration-id="looped"]')
    );
    expect(
      container.querySelector('[data-testid="declaration-row"][data-declaration-id="looped"]')
    ).toBeNull();
  });

  it('rejects a duplicate declaration id with the model diagnostic', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    // "#### Scenario: Duplicate declaration id rejected".
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'composite:review',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-toast"]')!.textContent).toContain(
      'already exists'
    );
    expect(
      container.querySelectorAll(
        '[data-testid="declaration-row"][data-declaration-id="composite:review"]'
      )
    ).toHaveLength(1);
  });

  it('constrains the body palette to AtomicStage only', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-select"][data-declaration-id="composite:review"]'
      )
    );

    // ECP-2 task 8.6 / "Canvas edits composite body stages": "The body palette
    // SHALL be constrained to `AtomicStage` only — `CompositeRef`,
    // `BoundedLoop`, `Choice`, `FanOut`, and `Join` SHALL NOT be available in
    // the body palette."
    expect(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]')).not.toBeNull();
    for (const kind of ['CompositeRef', 'BoundedLoop', 'Choice', 'FanOut', 'Join', 'Gate', 'Finish']) {
      expect(
        container.querySelector(`[data-testid="v2-body-palette-add-${kind}"]`),
        `body palette must not offer ${kind}`
      ).toBeNull();
    }
    // The body palette is a strict subset of the root palette, which still
    // offers the kinds the ROOT graph may hold.
    expect(container.querySelector('[data-testid="v2-palette-add-CompositeRef"]')).not.toBeNull();

    // Removing the stage again keeps the navigator honest.
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    expect(container.querySelectorAll('[data-testid="declaration-body-stage"]')).toHaveLength(1);
    await clickAndFlush(container.querySelector('[data-testid="declaration-body-stage-remove"]'));
    expect(container.querySelectorAll('[data-testid="declaration-body-stage"]')).toHaveLength(0);
  });

  it('inserts a CompositeRef from the root palette and disables the kinds the draft cannot accept', async () => {
    // ECP-2 `executable-custom-composite`, "Canvas creates and references a
    // Custom Composite declaration": "The user SHALL be able to reference the
    // declaration from the root graph via a `CompositeRef` node." The insertion
    // branch shipped in `addV2RootNode`, but the palette exposed only the four
    // pre-ECP-2 kinds, so no affordance could reach it.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await clickAndFlush(container.querySelector('[data-testid="v2-palette-add-CompositeRef"]'));
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'composite-ref'
    );
    // The new node references the fixture's custom declaration, and the panel
    // opens on it.
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'composite-ref'
    );

    // The fixture's only declaration has an empty body graph, so a BoundedLoop
    // has nothing to loop over: the palette reports it unavailable rather than
    // offering a click that can only toast. FanOut/Join are not offered at all.
    expect(
      (container.querySelector('[data-testid="v2-palette-add-BoundedLoop"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(container.querySelector('[data-testid="v2-palette-add-FanOut"]')).toBeNull();
    expect(container.querySelector('[data-testid="v2-palette-add-Join"]')).toBeNull();
  });

  it('keeps the v2 stable-id editor focused across multiple keystrokes and commits the rename on blur', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector(
        '[data-testid="mock-node-click"][data-node-id="gate"]'
      )
    );

    const idInput = container.querySelector(
      '[data-testid="v2-node-panel-id"]'
    ) as HTMLInputElement;
    idInput.focus();
    expect(document.activeElement).toBe(idInput);

    await setValueAndFlush(idInput, 'approval', 'input');
    expect(document.activeElement).toBe(idInput);
    expect(
      container.querySelector('[data-testid="v2-node-panel-id"]')
    ).toBe(idInput);
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'gate'
    );

    await setValueAndFlush(idInput, 'choice', 'input');
    expect(document.activeElement).toBe(idInput);
    expect(
      container.querySelector('[data-testid="v2-node-panel-id"]')
    ).toBe(idInput);

    await act(async () => {
      idInput.blur();
      await flushMicrotasks();
    });
    expect(idInput.value).toBe('gate');
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'gate'
    );

    idInput.focus();
    await setValueAndFlush(idInput, 'approval', 'input');
    expect(document.activeElement).toBe(idInput);
    await setValueAndFlush(idInput, 'approval-gate', 'input');
    expect(document.activeElement).toBe(idInput);
    await act(async () => {
      idInput.blur();
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'approval-gate'
    );
  });

  it('keeps a raw Gate outcomes draft across input events and commits canonical outcomes on blur', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: true,
      issues: [],
      preparation: v2Preparation,
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector(
        '[data-testid="mock-node-click"][data-node-id="gate"]'
      )
    );

    const outcomesInput = container.querySelector(
      '[data-testid="v2-node-panel-outcomes"]'
    ) as HTMLInputElement;
    outcomesInput.focus();
    expect(document.activeElement).toBe(outcomesInput);

    await setValueAndFlush(outcomesInput, 'approved,', 'input');
    expect(outcomesInput.value).toBe('approved,');
    expect(document.activeElement).toBe(outcomesInput);
    expect(
      container.querySelector('[data-testid="v2-node-panel-outcomes"]')
    ).toBe(outcomesInput);
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="gate"]')
        ?.getAttribute('data-output-ports')
    ).toBe(
      JSON.stringify([
        { id: 'approved', type: 'outcome/approved' },
        { id: 'rejected', type: 'outcome/rejected' },
      ])
    );

    await setValueAndFlush(outcomesInput, 'approved,e', 'input');
    expect(outcomesInput.value).toBe('approved,e');
    expect(document.activeElement).toBe(outcomesInput);
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="gate"]')
        ?.getAttribute('data-output-ports')
    ).toContain('rejected');

    await setValueAndFlush(
      outcomesInput,
      ' approved , escalated , approved , , ',
      'input'
    );
    await act(async () => {
      outcomesInput.blur();
      await flushMicrotasks();
    });

    expect(outcomesInput.value).toBe('approved,escalated');
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="gate"]')
        ?.getAttribute('data-output-ports')
    ).toBe(
      JSON.stringify([
        { id: 'approved', type: 'outcome/approved' },
        { id: 'escalated', type: 'outcome/escalated' },
      ])
    );
    expect(
      container.querySelector(
        '[data-testid="mock-edge"][data-edge-id="atomic:done->gate:input"]'
      )
    ).not.toBeNull();

    await clickAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-validate"]')
    );
    const submittedDefinition = vi.mocked(client.validatePipeline).mock
      .calls[0][0] as typeof v2Definition;
    expect(
      submittedDefinition.root.nodes.find((node) => node.id === 'gate')
    ).toMatchObject({
      id: 'gate',
      kind: 'Gate',
      outcomes: ['approved', 'escalated'],
      retained: { branchNote: 'keep gate metadata' },
    });
    expect(submittedDefinition.root.connections).toEqual(
      v2Definition.root.connections
    );
  });

  it('keeps a raw Choice outcomes draft across input events and commits on Enter without changing selection', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector(
        '[data-testid="mock-node-click"][data-node-id="choice"]'
      )
    );

    const outcomesInput = container.querySelector(
      '[data-testid="v2-node-panel-outcomes"]'
    ) as HTMLInputElement;
    outcomesInput.focus();
    await setValueAndFlush(outcomesInput, 'fast,', 'input');
    expect(outcomesInput.value).toBe('fast,');
    expect(document.activeElement).toBe(outcomesInput);
    expect(
      container.querySelector('[data-testid="v2-node-panel-outcomes"]')
    ).toBe(outcomesInput);
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="choice"]')
        ?.getAttribute('data-output-ports')
    ).toContain('careful');

    await setValueAndFlush(outcomesInput, 'fast,s', 'input');
    expect(outcomesInput.value).toBe('fast,s');
    expect(document.activeElement).toBe(outcomesInput);
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="choice"]')
        ?.getAttribute('data-output-ports')
    ).toContain('careful');

    await setValueAndFlush(
      outcomesInput,
      ' fast , slow , fast , , ',
      'input'
    );
    await act(async () => {
      outcomesInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      await flushMicrotasks();
    });
    expect(outcomesInput.value).toBe('fast,slow');
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="choice"]')
        ?.getAttribute('data-output-ports')
    ).toBe(
      JSON.stringify([
        { id: 'fast', type: 'outcome/fast' },
        { id: 'slow', type: 'outcome/slow' },
      ])
    );
    expect(
      container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute(
        'data-node'
      )
    ).toBe('choice');

    outcomesInput.focus();
    await setValueAndFlush(outcomesInput, ', , ', 'input');
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="choice"]')
        ?.getAttribute('data-output-ports')
    ).toContain('slow');
    await act(async () => {
      outcomesInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      await flushMicrotasks();
    });
    expect(outcomesInput.value).toBe('');
    expect(
      container
        .querySelector('[data-testid="mock-node"][data-node-id="choice"]')
        ?.getAttribute('data-output-ports')
    ).toBe('[]');

    outcomesInput.focus();
    await setValueAndFlush(outcomesInput, 'uncommitted,', 'input');
    await clickAndFlush(
      container.querySelector(
        '[data-testid="mock-node-click"][data-node-id="gate"]'
      )
    );
    await clickAndFlush(
      container.querySelector(
        '[data-testid="mock-node-click"][data-node-id="choice"]'
      )
    );
    expect(
      (
        container.querySelector(
          '[data-testid="v2-node-panel-outcomes"]'
        ) as HTMLInputElement
      ).value
    ).toBe('');
  });

  it('preserves an outcomes draft across unrelated rerenders and resyncs rejected or authoritative node values', async () => {
    const onPatch = vi.fn(() => false);
    const choiceNode = {
      id: 'choice',
      kind: 'Choice' as const,
      outcomes: ['fast', 'careful'],
      retained: { revision: 1 },
    };
    const renderPanel = async (node: typeof choiceNode) => {
      await act(async () => {
        render(
          <V2NodePanel
            node={node}
            catalog={v2CatalogFixture}
            fieldIssues={{}}
            onRename={vi.fn()}
            onPatch={onPatch}
            onClose={vi.fn()}
          />,
          container
        );
        await flushMicrotasks();
      });
    };

    await renderPanel(choiceNode);
    const outcomesInput = container.querySelector(
      '[data-testid="v2-node-panel-outcomes"]'
    ) as HTMLInputElement;
    outcomesInput.focus();
    await setValueAndFlush(outcomesInput, 'fast,', 'input');
    await renderPanel({
      ...choiceNode,
      retained: { revision: 2 },
    });
    expect(
      container.querySelector('[data-testid="v2-node-panel-outcomes"]')
    ).toBe(outcomesInput);
    expect(outcomesInput.value).toBe('fast,');
    expect(document.activeElement).toBe(outcomesInput);
    expect(onPatch).not.toHaveBeenCalled();

    await setValueAndFlush(outcomesInput, 'fast,slow', 'input');
    await act(async () => {
      outcomesInput.blur();
      await flushMicrotasks();
    });
    expect(onPatch).toHaveBeenCalledWith({ outcomes: ['fast', 'slow'] });
    expect(outcomesInput.value).toBe('fast,careful');

    await renderPanel({
      ...choiceNode,
      outcomes: ['external', 'updated'],
      retained: { revision: 3 },
    });
    expect(
      (
        container.querySelector(
          '[data-testid="v2-node-panel-outcomes"]'
        ) as HTMLInputElement
      ).value
    ).toBe('external,updated');

    await renderPanel({
      ...choiceNode,
      id: 'other-choice',
      outcomes: ['other'],
      retained: { revision: 4 },
    });
    expect(
      (
        container.querySelector(
          '[data-testid="v2-node-panel-outcomes"]'
        ) as HTMLInputElement
      ).value
    ).toBe('other');
  });

  it('commits and removes typed v2 connections through the Definition draft', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await clickAndFlush(
      container.querySelector(
        '[data-testid="mock-edge-remove"][data-edge-id="atomic:done->gate:input"]'
      )
    );
    expect(container.querySelectorAll('[data-testid="mock-edge"]')).toHaveLength(0);

    await clickAndFlush(container.querySelector('[data-testid="mock-connect-atomic-gate"]'));
    const edge = container.querySelector('[data-testid="mock-edge"]');
    expect(edge?.getAttribute('data-edge-id')).toBe('atomic:done->gate:input');
  });

  it('maps authoritative v2 diagnostics to edges and consuming nodes while retaining full unmapped paths', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValueOnce({
      valid: false,
      issues: [
        {
          severity: 'error',
          code: 'PORT_MISMATCH',
          path: '/root/connections/0/to/port',
          message: 'Typed port mismatch.',
        },
        {
          severity: 'warning',
          code: 'DECLARATION_WARNING',
          path: '/declarations/0/outcomes/0',
          message: 'Declaration warning.',
        },
      ],
      preparation: {
        ...v2Preparation,
        definitionValid: false,
        diagnostics: [],
        planAvailable: false,
      },
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    expect(
      container.querySelector(
        '[data-testid="mock-edge"][data-edge-id="atomic:done->gate:input"]'
      )?.getAttribute('data-issue')
    ).toBe('error');
    const portIssue = container.querySelector(
      '[data-testid="issues-drawer-item"][data-path="/root/connections/0/to/port"]'
    );
    expect(portIssue).not.toBeNull();
    await clickAndFlush(portIssue!.querySelector('[data-testid="issues-drawer-select"]'));
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'gate'
    );
    expect(
      container.querySelector(
        '[data-testid="issues-drawer-item"][data-path="/declarations/0/outcomes/0"] [data-testid="issues-drawer-unmapped"]'
      )?.textContent
    ).toContain('/declarations/0/outcomes/0');
  });

  it('locates a server duplicate-outcome diagnostic and guards the invalid v2 detail read-only', async () => {
    const duplicateDetail = {
      ...v2EditableDetail,
      pipeline: {
        ...v2EditableDetail.pipeline,
        name: 'duplicate-choice',
        definitionValid: false,
        planAvailable: false,
      },
      definition: {
        ...v2Definition,
        name: 'duplicate-choice',
        outcomes: ['fast'],
        root: {
          nodes: [
            {
              id: 'choice',
              kind: 'Choice',
              outcomes: ['fast', 'fast'],
            },
          ],
          connections: [],
        },
      },
      preparation: {
        ...v2Preparation,
        definitionValid: false,
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'DUPLICATE_ID',
            path: '/root/nodes/0/outcomes/1',
            message: "Duplicate Choice outcomes identity 'fast'.",
            related: [
              {
                path: '/root/nodes/0/outcomes/0',
                message: 'The first Choice outcomes with this identity is here.',
              },
            ],
          },
        ],
        planAvailable: false,
      },
      editable: true,
    } as unknown as PipelineDetailResponse;
    vi.mocked(client.getPipelineDetail).mockResolvedValue(duplicateDetail);

    await mountAt(container, '/p/proj_x/pipelines/duplicate-choice');

    const choice = container.querySelector(
      '[data-testid="mock-node"][data-node-id="choice"]'
    );
    expect(choice?.getAttribute('data-connectable')).toBe('false');
    expect(choice?.getAttribute('data-deletable')).toBe('false');
    const duplicateIssue = container.querySelector(
      '[data-testid="issues-drawer-item"][data-path="/root/nodes/0/outcomes/1"]'
    );
    expect(duplicateIssue?.textContent).toContain(
      "Duplicate Choice outcomes identity 'fast'."
    );
    expect(
      duplicateIssue?.querySelector('[data-testid="issues-drawer-select"]')
        ?.textContent
    ).toContain('choice');
    expect(
      (
        container.querySelector(
          '[data-testid="pipeline-canvas-edit"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(container.querySelector('[data-testid="pipeline-canvas-save"]')).toBeNull();
  });

  it('renders an invalid Choice detail as a guarded read-only graph with its initial server diagnostic', async () => {
    const invalidDetail = {
      ...v2EditableDetail,
      pipeline: {
        ...v2EditableDetail.pipeline,
        name: 'invalid-choice',
        definitionValid: false,
        planAvailable: false,
      },
      definition: {
        ...v2Definition,
        name: 'invalid-choice',
        root: {
          nodes: [{ id: 'choice', kind: 'Choice' }],
          connections: [],
        },
      },
      preparation: {
        ...v2Preparation,
        definitionValid: false,
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'INVALID_SOURCE',
            path: '/root/nodes/0/outcomes',
            message: 'Choice outcomes must be an array.',
          },
        ],
        planAvailable: false,
      },
      editable: true,
    } as unknown as PipelineDetailResponse;
    vi.mocked(client.getPipelineDetail).mockResolvedValue(invalidDetail);

    await mountAt(container, '/p/proj_x/pipelines/invalid-choice');

    expect(
      container.querySelector('[data-testid="mock-reactflow"]')?.textContent
    ).toContain('choice');
    const choice = container.querySelector(
      '[data-testid="mock-node"][data-node-id="choice"]'
    );
    expect(choice?.getAttribute('data-output-ports')).toBe('[]');
    expect(choice?.getAttribute('data-connectable')).toBe('false');
    expect(choice?.getAttribute('data-deletable')).toBe('false');

    const edit = container.querySelector(
      '[data-testid="pipeline-canvas-edit"]'
    ) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(container.querySelector('[data-testid="pipeline-canvas-run"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="issues-drawer-item"][data-path="/root/nodes/0/outcomes"]'
      )?.textContent
    ).toContain('/root/nodes/0/outcomes');
  });

  it('separates v2 validity, plan availability, and executability; allows save/export but disables Run with the server reason', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: true,
      issues: [],
      preparation: v2Preparation,
    });
    vi.mocked(client.mutatePipeline).mockResolvedValue({
      pipeline: { name: 'v2-canvas', path: 'C:\\exports\\v2-canvas.rasenpkg' },
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    expect(container.querySelector('[data-testid="pipeline-canvas-state-valid"]')?.textContent).toContain(
      'Valid'
    );
    expect(container.querySelector('[data-testid="pipeline-canvas-state-plan"]')?.textContent).toContain(
      'Plan available'
    );
    expect(
      container.querySelector('[data-testid="pipeline-canvas-state-executable"]')?.textContent
    ).toContain('Not executable');
    expect((container.querySelector('[data-testid="pipeline-canvas-save"]') as HTMLButtonElement).disabled).toBe(
      false
    );
    const run = container.querySelector('[data-testid="pipeline-canvas-run"]') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.textContent).toContain('ecp_v2_runtime_unavailable');
    expect(container.querySelector('[data-testid^="operations-"]')).toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-export"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-export-path"]'),
      'C:\\exports\\v2-canvas.rasenpkg',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-export-submit"]'));
    expect(client.mutatePipeline).toHaveBeenCalledWith({
      op: 'export',
      name: 'v2-canvas',
      path: 'C:\\exports\\v2-canvas.rasenpkg',
    });
  });
});
