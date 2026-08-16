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
import { render, type FunctionComponent } from 'preact';
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
  selected?: boolean;
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
  selected?: boolean;
  data?: { issueSeverity?: string };
}

/** The change shapes the mock's ReactFlow emits and applies — the two the page's handlers act on. */
type MockFlowChange =
  | { type: 'remove'; id: string }
  | { type: 'select'; id: string; selected: boolean };

vi.mock('@xyflow/react', async () => {
  const { useEffect } = await import('preact/hooks');
  return {
  ReactFlow: (props: {
    nodes: MockNode[];
    edges: MockEdge[];
    nodeTypes?: Record<
      string,
      FunctionComponent<{ data: MockNode['data'] }>
    >;
    onSelectionChange?: (params: { nodes: MockNode[]; edges: MockEdge[] }) => void;
    onConnect?: (connection: {
      source: string;
      sourceHandle: string | null;
      target: string;
      targetHandle: string | null;
    }) => void;
    onNodesChange?: (changes: MockFlowChange[]) => void;
    onEdgesChange?: (changes: MockFlowChange[]) => void;
    selectionKeyCode?: string | null;
    proOptions?: { hideAttribution?: boolean };
  }) => {
    // Selection stand-ins for the real library's two truths (review m1 —
    // before this existed, nothing modeled the listener, and a Blocker in
    // exactly that mechanism passed a fully green suite):
    //
    // 1. Store truth IS the `selected` flags on the nodes/edges the page
    //    passes: controlled-mode React Flow adopts them on every prop
    //    change (`StoreUpdater` -> `adoptUserNodes`). An interaction is
    //    echoed back as `select` changes through onNodesChange/
    //    onEdgesChange — exactly what the real library emits in controlled
    //    mode — and a programmatic page re-stamp reaches store truth the
    //    same way.
    // 2. SelectionListener: the real component keys its effect on
    //    [selectedNodes, selectedEdges, onSelectionChange] and the page
    //    passes a fresh callback identity on every render, so the listener
    //    RE-FIRES with current store truth after EVERY page re-render, not
    //    only on interactions. The effect below deliberately has no
    //    dependency array, so it runs after every render of this mock and
    //    reproduces that re-fire: a page write that changes the mirror
    //    without re-stamping the flags is reverted one commit later.
    function flaggedIds(): Set<string> {
      return new Set<string>([
        ...props.nodes.filter((node) => node.selected).map((node) => node.id),
        ...props.edges.filter((edge) => edge.selected).map((edge) => edge.id),
      ]);
    }
    function emitSelection(next: ReadonlySet<string>) {
      const nodeChanges: MockFlowChange[] = [];
      for (const node of props.nodes) {
        if (!!node.selected !== next.has(node.id)) {
          nodeChanges.push({
            type: 'select',
            id: node.id,
            selected: next.has(node.id),
          });
        }
      }
      const edgeChanges: MockFlowChange[] = [];
      for (const edge of props.edges) {
        if (!!edge.selected !== next.has(edge.id)) {
          edgeChanges.push({
            type: 'select',
            id: edge.id,
            selected: next.has(edge.id),
          });
        }
      }
      if (nodeChanges.length > 0) props.onNodesChange?.(nodeChanges);
      if (edgeChanges.length > 0) props.onEdgesChange?.(edgeChanges);
      props.onSelectionChange?.({
        nodes: props.nodes.filter((node) => next.has(node.id)),
        edges: props.edges.filter((edge) => next.has(edge.id)),
      });
    }
    function toggleSelection(id: string) {
      const next = flaggedIds();
      if (next.has(id)) next.delete(id);
      else next.add(id);
      emitSelection(next);
    }
    useEffect(() => {
      props.onSelectionChange?.({
        nodes: props.nodes.filter((node) => node.selected),
        edges: props.edges.filter((edge) => edge.selected),
      });
    });
    const atomicNodes = props.nodes.filter(
      (node) => node.data?.definitionKind === 'AtomicStage'
    );
    const sourceAtomic = atomicNodes[0];
    const targetAtomic = atomicNodes[1];
    const authoredRoute = [
      ['composite-ref', 'body-report', 'bounded-loop', 'brief'],
      ['bounded-loop', 'done', 'fan-out', 'input'],
      ['fan-out', 'atomic-stage', 'atomic-stage', 'input'],
      ['atomic-stage', 'done', 'join', 'atomic-stage'],
      ['join', 'done', 'finish', 'input'],
    ] as const;
    return (
    <div data-testid="mock-reactflow-wrapper" data-hide-attribution={String(props.proOptions?.hideAttribution)} data-selection-key={props.selectionKeyCode ?? ''}>
      <div data-testid="mock-reactflow">{props.nodes.map((n) => n.id).join(',')}</div>
      <div data-testid="mock-rendered-node-types">
        {props.nodes
          .filter((node) => node.type === 'stage')
          .map((node) => {
            const NodeComponent = props.nodeTypes?.stage;
            return NodeComponent ? (
              <NodeComponent key={node.id} data={node.data} />
            ) : null;
          })}
      </div>
      <div data-testid="mock-reactflow-edges">
        {props.edges.map((edge) => (
          <span
            key={edge.id}
            data-testid="mock-edge"
            data-edge-id={edge.id}
            data-issue={edge.data?.issueSeverity}
            data-selected={String(edge.selected)}
          >
            {edge.id}
            <button
              type="button"
              data-testid="mock-edge-click"
              data-edge-id={edge.id}
              onClick={() => emitSelection(new Set([edge.id]))}
            >
              select {edge.id}
            </button>
            <button
              type="button"
              data-testid="mock-edge-augment"
              data-edge-id={edge.id}
              onClick={() => toggleSelection(edge.id)}
            >
              augment {edge.id}
            </button>
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
              data-selected={String(n.selected)}
            >
              <button
                type="button"
                data-testid="mock-node-click"
                data-node-id={n.id}
                onClick={() => emitSelection(new Set([n.id]))}
              >
                select {n.id}
              </button>
              <button
                type="button"
                data-testid="mock-node-augment"
                data-node-id={n.id}
                onClick={() => toggleSelection(n.id)}
              >
                augment {n.id}
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
        <button
          type="button"
          data-testid="mock-connect-production-atomics"
          disabled={!sourceAtomic || !targetAtomic}
          onClick={() => {
            if (!sourceAtomic || !targetAtomic) return;
            props.onConnect?.({
              source: sourceAtomic.id,
              sourceHandle: sourceAtomic.data?.outputPorts?.[0]?.id ?? null,
              target: targetAtomic.id,
              targetHandle: targetAtomic.data?.inputPorts?.[0]?.id ?? null,
            });
          }}
        >
          connect production-shaped AtomicStages
        </button>
        {authoredRoute.map(([source, sourceHandle, target, targetHandle]) => {
          const sourceNode = props.nodes.find((node) => node.id === source);
          const targetNode = props.nodes.find((node) => node.id === target);
          const hasRenderedSource = sourceNode?.data?.outputPorts?.some(
            (port) => port.id === sourceHandle
          );
          const hasRenderedTarget = targetNode?.data?.inputPorts?.some(
            (port) => port.id === targetHandle
          );
          return (
            <button
              key={`${source}:${sourceHandle}->${target}:${targetHandle}`}
              type="button"
              data-testid={`mock-connect-authored-route-${source}-${sourceHandle}-${target}-${targetHandle}`}
              disabled={!hasRenderedSource || !hasRenderedTarget}
              onClick={() => props.onConnect?.({
                source,
                sourceHandle,
                target,
                targetHandle,
              })}
            >
              connect {source} to {target}
            </button>
          );
        })}
        <button type="button" data-testid="mock-pane-click" onClick={() => emitSelection(new Set<string>())}>
          pane
        </button>
        {/* The Delete key: removes the store's selection — flagged nodes
            (only those React Flow would consider deletable) and edges — as
            one batch of remove changes. Refused nodes stay flagged, as in
            the real store. */}
        <button
          type="button"
          data-testid="mock-delete-selection"
          onClick={() => {
            const nodeIds = props.nodes
              .filter((n) => n.selected && n.deletable !== false)
              .map((n) => n.id);
            const edgeIds = props.edges
              .filter((edge) => edge.selected)
              .map((edge) => edge.id);
            if (nodeIds.length > 0) {
              props.onNodesChange?.(nodeIds.map((id) => ({ type: 'remove' as const, id })));
            }
            if (edgeIds.length > 0) {
              props.onEdgesChange?.(edgeIds.map((id) => ({ type: 'remove' as const, id })));
            }
          }}
        >
          delete selection
        </button>
      </div>
    </div>
    );
  },
  Background: () => null,
  Controls: () => null,
  ReactFlowProvider: ({ children }: { children: unknown }) => <>{children}</>,
  Handle: (props: { id?: string; type: string }) => (
    <span
      data-testid="mock-handle"
      data-handle-id={props.id ?? ''}
      data-handle-type={props.type}
    />
  ),
  Position: { Left: 'left', Right: 'right' },
  // pipeline-canvas-edit additions: the editor's connect/drag/drop wiring.
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
  addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
  // Minimal but real: the two change types this page's handlers feed back —
  // `select` so interaction echoes land on the flags (controlled-mode RF
  // keeps its store only because the page re-passes them), `remove` so the
  // Delete key's cards leave the canvas as they do in the real app.
  applyNodeChanges: (changes: MockFlowChange[], nodes: MockNode[]) =>
    changes.reduce<MockNode[]>(
      (acc, change) =>
        change.type === 'remove'
          ? acc.filter((node) => node.id !== change.id)
          : change.type === 'select'
            ? acc.map((node) =>
                node.id === change.id
                  ? { ...node, selected: change.selected }
                  : node
              )
            : acc,
      nodes
    ),
  applyEdgeChanges: (changes: MockFlowChange[], edges: MockEdge[]) =>
    changes.reduce<MockEdge[]>(
      (acc, change) =>
        change.type === 'remove'
          ? acc.filter((edge) => edge.id !== change.id)
          : change.type === 'select'
            ? acc.map((edge) =>
                edge.id === change.id
                  ? { ...edge, selected: change.selected }
                  : edge
              )
            : acc,
      edges
    ),
  };
});

import { LocationProvider, Router, Route } from 'preact-iso';
import { DefinitionContractPanel } from '../../src/canvas/DefinitionContractPanel.js';
import { PipelineCanvasPage } from '../../src/canvas/PipelineCanvasPage.js';
import { V2NodePanel } from '../../src/canvas/V2NodePanel.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';
import {
  CANVAS_V2_AUTHORING_CATALOG,
  CANVAS_V2_AUTHORING_DEFINITION,
  CANVAS_V2_AUTHORING_NAME,
  CANVAS_V2_GESTURE_AUTHORED_DEFINITION,
} from '../fixtures/canvas-v2-authoring.js';
import type {
  PipelineCatalogResponse,
  PipelineDetailResponse,
  ThresholdValue,
  WireBoundedLoopNode,
  WirePipelineDefinition,
  WirePipelineDefinitionV2,
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

/**
 * `v2CatalogFixture` holds two skills that are BOTH enabled and BOTH carry a
 * capability, so `PalettePanel`'s `skillDisabled` is false at every one of its
 * call sites and the greying branch is never entered. This variant adds the
 * two unplaceable shapes the requirement names — reported disabled, and
 * carrying no exact capability revision — while keeping a bindable skill so
 * the Stage gesture itself stays available.
 */
const v2CatalogWithUnplaceableSkills = {
  ...v2CatalogFixture,
  skills: [
    ...v2CatalogFixture.skills,
    {
      id: 'rasen-profile-disabled',
      description: 'Off in the active profile',
      enabled: false,
      capability: {
        id: 'skill:rasen-profile-disabled',
        version: 'digest-disabled',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
      },
    },
    {
      id: 'rasen-no-capability',
      description: 'Served without an exact capability revision',
      enabled: true,
    },
  ],
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
        execution: {
          version: 1 as const,
          role: 'implementer' as const,
          workspace: { access: 'write' as const },
        },
        retained: { authorNote: 'keep me' },
      },
      {
        id: 'gate',
        kind: 'Gate' as const,
        target: 'atomic',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed' as const, rejected: 'escalate' as const },
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
        limits: { maxIterations: 2, maxActions: 8, budget: 8 },
        lifecycle: {
          version: 1 as const,
          thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
          strategy: { maxAttempts: 0, requireMaterialChange: true as const },
          exits: {
            iterationLimit: { action: 'exit' as const, outcome: 'iteration-limit' },
            actionLimit: { action: 'fail' as const, outcome: 'action-limit' },
            budgetLimit: { action: 'fail' as const, outcome: 'budget-limit' },
            stalled: { action: 'escalate' as const, outcome: 'stalled' },
            blocked: { action: 'human-required' as const, outcome: 'blocked' },
            strategyExhausted: { action: 'fail' as const, outcome: 'strategy-exhausted' },
          },
        },
        exits: { done: { action: 'exit' as const, outcome: 'done' } },
      },
      {
        id: 'fanout',
        kind: 'FanOut' as const,
        branches: ['atomic'],
        concurrencyCap: 1,
        budget: 1,
        joinNodeId: 'join',
        members: [
          {
            id: 'atomic',
            hierarchicalPath: 'atomic',
            required: true,
            condition: 'always',
          },
        ],
      },
      {
        id: 'join',
        kind: 'Join' as const,
        inputs: ['atomic'],
        requiredMembers: ['atomic'],
        optionalMembers: [],
        outcomes: { proceed: 'done', failed: 'rejected' },
      },
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

  it('keeps an authored-v1 duplicate on the compatibility path through edit, save, and detail reload', async () => {
    let saved: WirePipelineDefinition | null = null;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce(pipelineDetailFixture)
      .mockImplementation(async () => ({
        ...pipelineDetailFixture,
        pipeline: {
          ...pipelineDetailFixture.pipeline,
          name: 'small-feature-v1-copy',
          provenance: 'user',
          sourceLayer: 'user',
        },
        definition: saved ?? pipelineDetailFixture.definition,
        editable: true,
      } as PipelineDetailResponse));
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') saved = structuredClone(request.definition) as WirePipelineDefinition;
      return {
        pipeline: {
          name: 'small-feature-v1-copy',
          path: '/pipelines/small-feature-v1-copy',
        },
        created: true,
      };
    });
    await mountAt(container, '/p/proj_x/pipelines/small-feature');

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-duplicate"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-duplicate-name"]'),
      'small-feature-v1-copy',
      'input'
    );
    await clickAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-duplicate-submit"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="propose"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="stage-panel-handoff-form"]'),
      'remaining'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="stage-panel-handoff-remaining"]'),
      '42000',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    expect(saved).toMatchObject({
      version: 1,
      name: 'small-feature-v1-copy',
      origin: 'ui',
    });
    const persisted = saved as unknown as WirePipelineDefinition;
    if (persisted.version !== 1) throw new Error('expected saved v1 definition');
    expect(persisted.stages).toHaveLength(pipelineDetailFixture.definition.stages.length);
    expect(persisted.stages.find((stage) => stage.id === 'propose')).toMatchObject({
      id: 'propose',
      kind: 'standard',
      skill: 'rasen-propose',
      handoff: { threshold: { remainingTokens: 42_000 } },
    });
    expect(saved).not.toHaveProperty('id');
    expect(saved).not.toHaveProperty('sourceId');
    expect(saved).not.toHaveProperty('declarations');
    expect(saved).not.toHaveProperty('root');
    expect(vi.mocked(client.validatePipeline).mock.calls.at(-1)![0]).toEqual(saved);

    await enterEdit();
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="propose"]')
    );
    expect(
      (container.querySelector(
        '[data-testid="stage-panel-handoff-remaining"]'
      ) as HTMLInputElement).value
    ).toBe('42000');
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

  it('starts not-found recovery from the canonical empty v2 draft', async () => {
    vi.mocked(client.getPipelineDetail).mockRejectedValue(
      new ApiError(404, { error: { code: 'not_found', message: 'No pipeline named "brand-new".' } })
    );
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/brand-new');
    expect(container.querySelector('[data-testid="pipeline-canvas-not-found"]')).not.toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-start-assembling"]'));
    expect(container.querySelector('[data-testid="pipeline-canvas-save"]')).not.toBeNull();
    expect(container.querySelector('.pipeline-canvas__name')?.textContent).toBe('brand-new');
    // No stages yet — the mock flow renders an empty node-id string.
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toBe('');

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(client.validatePipeline).toHaveBeenCalledWith(
      {
        version: 2,
        id: 'pipeline:brand-new',
        sourceId: 'canvas:brand-new',
        name: 'brand-new',
        inputs: [],
        artifacts: [],
        outcomes: [],
        declarations: [],
        root: { nodes: [], connections: [] },
      },
      'project:proj_x'
    );
  });

  it('authors the shared all-eight v2 request from a real blank Canvas, through the closed gesture vocabulary, and submits it unchanged to validate and save', async () => {
    // Same "one of every node kind" claim as the pre-refactor version of this
    // test, but reached exclusively through the four root gestures and the
    // three property affordances (design D2-D5) instead of the withdrawn raw
    // `v2-palette-add-<Kind>` buttons — see `CANVAS_V2_GESTURE_AUTHORED_
    // DEFINITION`'s docblock in the fixtures file for why this cannot target
    // the shared `CANVAS_V2_AUTHORING_DEFINITION` oracle byte-for-byte (its
    // Choice node's arbitrary custom outcomes are structurally unreachable
    // through the closed matched/skipped splice vocabulary).
    const notFound = new ApiError(404, {
      error: {
        code: 'not_found',
        message: `No pipeline named "${CANVAS_V2_AUTHORING_NAME}".`,
      },
    });
    const reloaded = {
      ...v2EditableDetail,
      pipeline: {
        ...v2EditableDetail.pipeline,
        name: CANVAS_V2_AUTHORING_NAME,
      },
      definition: CANVAS_V2_GESTURE_AUTHORED_DEFINITION,
    } as PipelineDetailResponse;
    vi.mocked(client.getPipelineDetail)
      .mockRejectedValueOnce(notFound)
      .mockResolvedValue(reloaded);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(
      CANVAS_V2_AUTHORING_CATALOG
    );
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: true,
      issues: [],
      preparation: v2Preparation,
    });
    vi.mocked(client.mutatePipeline).mockResolvedValue({
      pipeline: {
        name: CANVAS_V2_AUTHORING_NAME,
        path: `/pipelines/${CANVAS_V2_AUTHORING_NAME}`,
      },
      created: true,
      preparation: v2Preparation,
    });

    await mountAt(
      container,
      `/p/proj_x/pipelines/${CANVAS_V2_AUTHORING_NAME}`
    );
    await clickAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-start-assembling"]')
    );

    await clickAndFlush(container.querySelector('[data-testid="definition-input-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-input-name"]'),
      'request',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="definition-artifact-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-artifact-name"]'),
      'report',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-outcomes"]'),
      CANVAS_V2_GESTURE_AUTHORED_DEFINITION.outcomes.join(',')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-limit-max-actions"]'),
      '32',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-limit-budget"]'),
      '32',
      'input'
    );

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'work-body',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(container.querySelector('[data-testid="declaration-input-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-input-name"]'),
      'brief',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-artifact-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-artifact-name"]'),
      'body-report',
      'input'
    );
    const declarationOutcomes = container.querySelector(
      '[data-testid="declaration-outcomes"]'
    ) as HTMLInputElement;
    declarationOutcomes.focus();
    await setValueAndFlush(declarationOutcomes, 'done', 'input');
    await act(async () => {
      declarationOutcomes.blur();
      await flushMicrotasks();
    });
    await clickAndFlush(
      container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]')
    );

    // Stage gesture: bind the one installed skill's exact capability.
    await clickAndFlush(
      container.querySelector(
        '[data-testid="v2-palette-gesture-stage-rasen-apply-change"]'
      )
    );
    // CompositeRef: the declaration row's own "Insert into graph" action.
    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-insert-ref"][data-declaration-id="work-body"]'
      )
    );
    // Loop gesture: BoundedLoop over the one declaration with a body graph.
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-loop"]'));
    // Parallel gesture: FanOut+Join as one transaction over the root AtomicStage.
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-parallel"]')
    );
    // Finish gesture.
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-finish"]'));
    // Gate: the approval checkbox on the AtomicStage's own panel (design D4).
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="atomic-stage"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-node-panel-gate-toggle"]'));

    for (const [source, sourceHandle, target, targetHandle] of [
      ['composite-ref', 'body-report', 'bounded-loop', 'brief'],
      ['bounded-loop', 'done', 'fan-out', 'input'],
      ['fan-out', 'atomic-stage', 'atomic-stage', 'input'],
      ['atomic-stage', 'done', 'join', 'atomic-stage'],
      ['join', 'done', 'finish', 'input'],
    ] as const) {
      expect(
        container.querySelector(
          `[data-testid="stage-node"][data-stage="${source}"] [data-testid="mock-handle"][data-handle-type="source"][data-handle-id="${sourceHandle}"]`
        ),
        `missing rendered source handle ${source}:${sourceHandle}`
      ).not.toBeNull();
      expect(
        container.querySelector(
          `[data-testid="stage-node"][data-stage="${target}"] [data-testid="mock-handle"][data-handle-type="target"][data-handle-id="${targetHandle}"]`
        ),
        `missing rendered target handle ${target}:${targetHandle}`
      ).not.toBeNull();
      const connect = container.querySelector(
        `[data-testid="mock-connect-authored-route-${source}-${sourceHandle}-${target}-${targetHandle}"]`
      ) as HTMLButtonElement;
      expect(connect.disabled).toBe(false);
      await clickAndFlush(connect);
    }

    // Choice: splice a condition onto the bounded-loop -> fan-out connection
    // (design D5) — the only route to a Choice now; there is no raw palette
    // kind for it.
    const spliceTarget = container.querySelector(
      '[data-testid="mock-edge-click"][data-edge-id="bounded-loop:done->fan-out:input"]'
    ) as HTMLButtonElement;
    expect(spliceTarget, 'missing the bounded-loop -> fan-out edge to splice onto').not.toBeNull();
    await clickAndFlush(spliceTarget);
    expect(container.querySelector('[data-testid="v2-connection-panel"]')).not.toBeNull();
    const condition = container.querySelector(
      '[data-testid="v2-connection-panel-condition"]'
    ) as HTMLInputElement;
    condition.focus();
    await setValueAndFlush(condition, 'ready', 'input');
    await act(async () => {
      condition.blur();
      await flushMicrotasks();
    });

    await clickAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-validate"]')
    );
    expect(vi.mocked(client.validatePipeline).mock.calls.at(-1)).toEqual([
      CANVAS_V2_GESTURE_AUTHORED_DEFINITION,
      'project:proj_x',
    ]);
    // Ordered, not a Set: the gesture sequence determines node order as well
    // as node content, and a Set comparison would pass on a reordering.
    expect(
      (vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2)
        .root.nodes.map((node) => node.kind)
    ).toEqual([
      'AtomicStage',
      'CompositeRef',
      'BoundedLoop',
      'FanOut',
      'Join',
      'Finish',
      'Gate',
      'Choice',
    ]);

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(vi.mocked(client.mutatePipeline).mock.calls.at(-1)![0]).toEqual({
      op: 'save',
      name: CANVAS_V2_AUTHORING_NAME,
      definition: CANVAS_V2_GESTURE_AUTHORED_DEFINITION,
      force: false,
    });
    expect(
      CANVAS_V2_GESTURE_AUTHORED_DEFINITION.root.nodes.find(
        (node) => node.id === 'atomic-stage'
      )
    ).not.toHaveProperty('execution.gate');
    const authoredChoice = CANVAS_V2_GESTURE_AUTHORED_DEFINITION.root.nodes.find(
      (node) => node.id === 'choice'
    );
    expect(authoredChoice).not.toHaveProperty('legacyRuntimeOwner');
  });

  // --- ECP-2/design D9 task 9.2: one explicit parity test per withdrawn
  // kind. Each starts from a real blank Canvas (the same not-found ->
  // start-assembling draft as above) and assembles ONLY through the new
  // affordance for that kind — never a `v2-palette-add-<Kind>` click, which
  // no longer exists for any of these four. Gate, FanOut+Join, and
  // CompositeRef reproduce the exact defaults the old raw-kind palette used
  // to produce (moved verbatim into the section-3/4 `draft.ts` helpers).
  // Choice is a deliberate structural narrowing (design D5): its "parity"
  // claim is against the new closed matched/skipped + expression shape, not
  // the old arbitrary-outcome-label shape, which is no longer authorable.

  async function mountBlankDraft(name: string): Promise<void> {
    vi.mocked(client.getPipelineDetail).mockRejectedValue(
      new ApiError(404, { error: { code: 'not_found', message: `No pipeline named "${name}".` } })
    );
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, `/p/proj_x/pipelines/${name}`);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-start-assembling"]'));
  }

  it('Gate parity: the approval checkbox on an AtomicStage reproduces the Canvas\'s pre-existing Gate defaults', async () => {
    await mountBlankDraft('gate-parity');
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="atomic-stage"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-node-panel-gate-toggle"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    const gate = submitted.root.nodes.find((node) => node.kind === 'Gate');
    expect(gate).toMatchObject({
      target: 'atomic-stage',
      outcomes: ['approved', 'rejected'],
      dispositions: { approved: 'proceed', rejected: 'escalate' },
    });
    // A Gate's linkage to its stage is the `target` field alone. The old
    // raw-palette Gate did not add a `root.connections` entry either (it
    // called `addV2Node` and nothing else), so this is parity, not a
    // difference — `setStageGate` does not need one; the node itself IS the
    // annotation.
  });

  it('FanOut+Join parity: the Parallel gesture reproduces the Canvas\'s pre-existing frontier defaults, wired to each other', async () => {
    await mountBlankDraft('parallel-parity');
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-parallel"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    const fanOut = submitted.root.nodes.find((node) => node.kind === 'FanOut');
    const join = submitted.root.nodes.find((node) => node.kind === 'Join');
    expect(fanOut).toMatchObject({
      branches: ['atomic-stage'],
      members: [{ id: 'atomic-stage', required: true }],
    });
    expect(join).toMatchObject({ inputs: ['atomic-stage'], requiredMembers: ['atomic-stage'] });
    expect((fanOut as { joinNodeId: string }).joinNodeId).toBe(join!.id);
  });

  it('CompositeRef parity: the declaration row\'s insert action reproduces the Canvas\'s pre-existing CompositeRef defaults', async () => {
    await mountBlankDraft('composite-ref-parity');
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'gesture-composite',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-insert-ref"][data-declaration-id="gesture-composite"]'
      )
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(submitted.root.nodes.find((node) => node.kind === 'CompositeRef')).toMatchObject({
      declarationId: 'gesture-composite',
    });
  });

  it('Choice parity: splicing a condition onto a connection via the Connection panel produces the closed matched/skipped vocabulary with no legacyRuntimeOwner', async () => {
    await mountBlankDraft('choice-parity');
    // Two root AtomicStages, wired together, give us a real connection to
    // splice onto — Gate's `target` link (see the Gate parity test above)
    // is NOT a connection, so it cannot serve this purpose.
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-apply"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="mock-connect-production-atomics"]'));

    const edgeButtons = [...container.querySelectorAll('[data-testid="mock-edge-click"]')];
    expect(edgeButtons, 'the stage-to-stage connection must be rendered').toHaveLength(1);
    const originalConnectionId = edgeButtons[0]!.getAttribute('data-edge-id')!;

    // Select the connection via the mock harness's edge-click affordance,
    // mirroring React Flow's real `onEdgeClick` (wired at task 7.2) — this is
    // the ONLY way to reach a Choice now; there is no raw palette kind for it
    // (design D5).
    await clickAndFlush(edgeButtons[0] as HTMLElement);
    expect(container.querySelector('[data-testid="v2-connection-panel"]')).not.toBeNull();

    const condition = container.querySelector(
      '[data-testid="v2-connection-panel-condition"]'
    ) as HTMLInputElement;
    condition.focus();
    await setValueAndFlush(condition, 'ready', 'input');
    await act(async () => {
      condition.blur();
      await flushMicrotasks();
    });

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    const choice = submitted.root.nodes.find((node) => node.kind === 'Choice');
    expect(choice).toMatchObject({ outcomes: ['matched', 'skipped'], expression: 'ready' });
    expect(choice).not.toHaveProperty('legacyRuntimeOwner');
    expect(submitted.root.connections.some((connection) => connection.to.node === choice!.id)).toBe(
      true
    );
    expect(
      submitted.root.connections.some((connection) => connection.from.node === choice!.id)
    ).toBe(true);
    expect(submitted.root.connections.map((connection) => connection.id)).not.toContain(
      originalConnectionId
    );
  });

  it('edits a spliced condition and removes it again from the Choice node panel, restoring the direct connection', async () => {
    // The `V2NodePanel -> onUnspliceChoice -> unspliceSelectedChoice ->
    // unspliceChoice` wiring and `commitExpression -> onPatch({expression})`
    // (tasks 7.4 / 9.2, spec scenario "Clearing an unwired condition restores
    // the direct connection"). `unspliceChoice` is covered at the model layer;
    // this covers the page wiring, which the model tests cannot see.
    await mountBlankDraft('choice-panel-editing');
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-apply"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="mock-connect-production-atomics"]'));
    const originalConnectionId = container
      .querySelector('[data-testid="mock-edge-click"]')!
      .getAttribute('data-edge-id')!;

    await clickAndFlush(container.querySelector('[data-testid="mock-edge-click"]'));
    const condition = container.querySelector(
      '[data-testid="v2-connection-panel-condition"]'
    ) as HTMLInputElement;
    condition.focus();
    await setValueAndFlush(condition, 'ready', 'input');
    await act(async () => {
      condition.blur();
      await flushMicrotasks();
    });

    // Select the new Choice and edit its expression through the node panel.
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="choice"]')
    );
    const expression = container.querySelector(
      '[data-testid="v2-node-panel-choice-expression"]'
    ) as HTMLInputElement;
    expect(expression, 'the Choice panel must expose its condition').not.toBeNull();
    expect(expression.value).toBe('ready');
    expression.focus();
    await setValueAndFlush(expression, 'ready && approved', 'input');
    await act(async () => {
      expression.blur();
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const edited = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(edited.root.nodes.find((node) => node.kind === 'Choice')).toMatchObject({
      expression: 'ready && approved',
    });

    // "Remove condition" un-splices: the Choice disappears and the original
    // A -> B connection comes back.
    await clickAndFlush(
      container.querySelector('[data-testid="v2-node-panel-unsplice-choice"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const cleared = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(cleared.root.nodes.some((node) => node.kind === 'Choice')).toBe(false);
    expect(cleared.root.connections.map((connection) => connection.id)).toEqual([
      originalConnectionId,
    ]);
  });

  it('surfaces every unsplice refusal as a toast and leaves the draft untouched', async () => {
    // `unspliceChoice`'s three refusals are covered at the model layer, but the
    // model cannot see whether the page's `catch` arm actually reaches the
    // author. Only this handler's catch was unasserted; five other refusal
    // tests in this file already pin the same `showToast` surface.
    //
    // Each case is a definition the editor genuinely loads, not a synthetic
    // model input: the Choice is already wired the offending way, so clicking
    // "Remove condition" exercises exactly the path a real author hits.
    async function refusalToastFor(
      extraConnections: WirePipelineDefinitionV2['root']['connections']
    ): Promise<{ toast: string; submittedRoot: unknown; expectedRoot: unknown }> {
      const wired = structuredClone(v2Definition) as unknown as WirePipelineDefinitionV2;
      wired.root.connections = [...wired.root.connections, ...extraConnections];
      const expectedRoot = structuredClone(wired.root);
      vi.mocked(client.getPipelineDetail).mockResolvedValue({
        ...v2EditableDetail,
        definition: wired,
      } as PipelineDetailResponse);
      vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
      vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });

      await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
      await enterEdit();
      await clickAndFlush(
        container.querySelector('[data-testid="mock-node-click"][data-node-id="choice"]')
      );
      await clickAndFlush(
        container.querySelector('[data-testid="v2-node-panel-unsplice-choice"]')
      );
      const toast =
        container.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? '';
      // The Choice survived the refusal, and so did every connection.
      expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
        'choice'
      );
      await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
      const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as
        WirePipelineDefinitionV2;
      render(null, container);
      return { toast, submittedRoot: submitted.root, expectedRoot };
    }

    // A second connection leading into the branch point.
    const twoInbound = await refusalToastFor([
      {
        id: 'composite:done->choice:input',
        from: { node: 'composite', port: 'done' },
        to: { node: 'choice', port: 'input' },
      },
      {
        id: 'atomic:done->choice:input',
        from: { node: 'atomic', port: 'done' },
        to: { node: 'choice', port: 'input' },
      },
    ]);
    expect(twoInbound.toast).toContain('2 incoming connections');
    expect(twoInbound.toast).toContain('composite');
    expect(twoInbound.submittedRoot).toEqual(twoInbound.expectedRoot);

    // A matched outcome leading to two destinations.
    const twoMatched = await refusalToastFor([
      {
        id: 'choice:matched->finish:input',
        from: { node: 'choice', port: 'matched' },
        to: { node: 'finish', port: 'input' },
      },
      {
        id: 'choice:matched->composite:input',
        from: { node: 'choice', port: 'matched' },
        to: { node: 'composite', port: 'input' },
      },
    ]);
    expect(twoMatched.toast).toContain("branch 'matched' is wired to 2 targets");
    expect(twoMatched.submittedRoot).toEqual(twoMatched.expectedRoot);

    // The pre-existing stray-branch refusal, which had the identical gap.
    const strayBranch = await refusalToastFor([
      {
        id: 'choice:careful->finish:input',
        from: { node: 'choice', port: 'careful' },
        to: { node: 'finish', port: 'input' },
      },
    ]);
    expect(strayBranch.toast).toContain("branch 'careful' is still wired to 'finish'");
    expect(strayBranch.submittedRoot).toEqual(strayBranch.expectedRoot);
  });

  it('greys an unplaceable Stage skill, NAMES its state on screen, and refuses to place it', async () => {
    // `v2CatalogFixture`'s two skills are both enabled AND both carry a
    // capability, so `skillDisabled` is false at every one of its call sites
    // and this whole branch is unreachable from it — coverage absent, not
    // weak. This fixture variant reaches it for both reasons the requirement
    // names: reported disabled, and carrying no exact capability revision.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogWithUnplaceableSkills);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    const bindable = container.querySelector(
      '[data-testid="v2-palette-gesture-stage-rasen-propose"]'
    ) as HTMLButtonElement;
    expect(bindable.disabled).toBe(false);
    expect(bindable.className).not.toContain('palette-card--disabled');
    expect(bindable.querySelector('[data-testid="palette-card-disabled-state"]')).toBeNull();

    for (const [skillId, state] of [
      ['rasen-profile-disabled', 'disabled'],
      ['rasen-no-capability', 'no exact capability'],
    ] as const) {
      const card = container.querySelector(
        `[data-testid="v2-palette-gesture-stage-${skillId}"]`
      ) as HTMLButtonElement;
      expect(card, `missing Stage card for ${skillId}`).not.toBeNull();
      expect(card.className).toContain('palette-card--disabled');
      expect(card.disabled).toBe(true);
      const named = card.querySelector('[data-testid="palette-card-disabled-state"]');
      expect(
        named,
        `${skillId} must name its state on screen — a title tooltip is not a visible state`
      ).not.toBeNull();
      expect(named!.textContent).toBe(state);
    }

    // ...and cannot be placed.
    const before = container.querySelector('[data-testid="mock-reactflow"]')!.textContent;
    for (const skillId of ['rasen-profile-disabled', 'rasen-no-capability']) {
      await clickAndFlush(
        container.querySelector(`[data-testid="v2-palette-gesture-stage-${skillId}"]`)
      );
    }
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toBe(before);
  });

  it('a branch point authored before the condition narrowing still loads, edits, and saves in its own shape', async () => {
    // The Choice narrowing (design D5) constrains AUTHORING only. The
    // `v2Definition` fixture's `choice` node is exactly the pre-change shape —
    // arbitrary outcome labels, no `expression` key — and the editor must
    // neither refuse it nor rewrite it into the matched/skipped shape.
    let saved: WirePipelineDefinitionV2 | null = null;
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      return { pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' }, created: false };
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="choice"]')
    );

    // Its condition field is empty because the node genuinely carries no
    // `expression` — the editor reports the shape rather than inventing one.
    expect(
      (container.querySelector(
        '[data-testid="v2-node-panel-choice-expression"]'
      ) as HTMLInputElement).value
    ).toBe('');

    const outcomes = container.querySelector(
      '[data-testid="v2-node-panel-outcomes"]'
    ) as HTMLInputElement;
    expect(outcomes.value).toBe('fast,careful');
    outcomes.focus();
    await setValueAndFlush(outcomes, 'fast,careful,deferred', 'input');
    await act(async () => {
      outcomes.blur();
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const savedChoice = saved!.root.nodes.find((node) => node.id === 'choice')!;
    expect(savedChoice).toMatchObject({
      kind: 'Choice',
      outcomes: ['fast', 'careful', 'deferred'],
      retained: { branchNote: 'keep choice metadata' },
    });
    // Editing the labels must not stamp an `expression` the author never typed.
    expect(savedChoice).not.toHaveProperty('expression');
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

  it('renders the closed v2 vocabulary with exact typed handles and all eight kinds authorable', async () => {
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

    // FanOut/Join are selectable, connectable, and editable as one paired
    // parallel contract. Individual node deletion remains disabled so the
    // Canvas cannot leave behind a structurally incomplete half-pair.
    for (const id of ['fanout', 'join']) {
      const card = container.querySelector(`[data-testid="mock-node"][data-node-id="${id}"]`)!;
      expect(card.getAttribute('data-editor-supported')).toBe('true');
      expect(card.getAttribute('data-deletable')).toBe('false');
      expect(card.getAttribute('data-connectable')).toBe('true');
    }
  });

  it('preserves unexposed v2 fields when saving an unrelated description edit', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockResolvedValue({
      pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' },
      created: false,
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="pipeline-canvas-description"]'),
      'Edited description',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const posted = vi.mocked(client.mutatePipeline).mock.calls.at(-1)![0] as {
      definition: typeof v2Definition;
    };
    expect(posted.definition.description).toBe('Edited description');
    expect(posted.definition.id).toBe(v2Definition.id);
    expect(posted.definition.sourceId).toBe(v2Definition.sourceId);
    expect(posted.definition.declarations).toEqual(v2Definition.declarations);
    expect(posted.definition.root.nodes).toEqual(v2Definition.root.nodes);
    expect(posted.definition.root.connections).toEqual(v2Definition.root.connections);
    expect(posted.definition.root.nodes[0]).toHaveProperty(
      'retained.authorNote',
      'keep me'
    );
  });

  it('preserves definition, graph, node, declaration, execution, and lifecycle sentinels through mounted controls and reload', async () => {
    const sentinel = structuredClone(v2Definition) as unknown as WirePipelineDefinitionV2;
    Object.assign(sentinel, { futureDefinition: { revision: 3 } });
    Object.assign(sentinel.root, { futureGraph: { layout: 'retained' } });
    const atomic = sentinel.root.nodes.find((node) => node.id === 'atomic');
    const loop = sentinel.root.nodes.find((node) => node.id === 'loop');
    if (!atomic || atomic.kind !== 'AtomicStage' || !atomic.execution) {
      throw new Error('atomic sentinel fixture missing');
    }
    if (!loop || loop.kind !== 'BoundedLoop' || !loop.lifecycle) {
      throw new Error('loop sentinel fixture missing');
    }
    Object.assign(atomic, { futureNode: { owner: 'root' } });
    Object.assign(atomic.execution, { futureExecution: { policy: 'retained' } });
    Object.assign(loop.lifecycle, { futureLifecycle: { reducer: 'retained' } });
    const declaration = sentinel.declarations[0]!;
    Object.assign(declaration, { futureDeclaration: { provenance: 'retained' } });
    Object.assign(declaration.graph, { futureBodyGraph: { display: 'retained' } });
    declaration.graph.nodes.push({
      id: 'body-work',
      kind: 'AtomicStage',
      capability: { id: 'skill:rasen-apply', version: 'digest-apply' },
      execution: {
        version: 1,
        role: 'implementer',
        workspace: { access: 'write' },
        futureExecution: { owner: 'body' },
      },
      futureNode: { owner: 'body' },
    } as never);

    let saved: WirePipelineDefinitionV2 | null = null;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce({
        ...v2EditableDetail,
        definition: sentinel,
      } as PipelineDetailResponse)
      .mockImplementation(async () => ({
        ...v2EditableDetail,
        definition: saved ?? sentinel,
      } as PipelineDetailResponse));
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') {
        saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      }
      return {
        pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' },
        created: false,
      };
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="definition-limit-budget"]'),
      '43',
      'input'
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="atomic"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-role"]'),
      'reviewer'
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-stall-iterations"]'),
      '3',
      'input'
    );
    await clickAndFlush(
      container.querySelector('[data-testid="declaration-select"][data-declaration-id="composite:review"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-body-execution-role"]'),
      'reviewer'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    expect(saved).toMatchObject({
      futureDefinition: { revision: 3 },
      limits: { budget: 43 },
      root: { futureGraph: { layout: 'retained' } },
    });
    const savedAtomic = saved!.root.nodes.find((node) => node.id === 'atomic') as never;
    const savedLoop = saved!.root.nodes.find((node) => node.id === 'loop') as never;
    expect(savedAtomic).toMatchObject({
      futureNode: { owner: 'root' },
      execution: {
        role: 'reviewer',
        futureExecution: { policy: 'retained' },
      },
    });
    expect(savedLoop).toMatchObject({
      lifecycle: {
        thresholds: { stallIterations: 3 },
        futureLifecycle: { reducer: 'retained' },
      },
    });
    expect(saved!.declarations[0]).toMatchObject({
      futureDeclaration: { provenance: 'retained' },
      graph: {
        futureBodyGraph: { display: 'retained' },
        nodes: [
          expect.objectContaining({
            futureNode: { owner: 'body' },
            execution: expect.objectContaining({
              role: 'reviewer',
              futureExecution: { owner: 'body' },
            }),
          }),
        ],
      },
    });

    await enterEdit();
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(vi.mocked(client.validatePipeline).mock.calls.at(-1)![0]).toEqual(saved);
  });

  it('shows FanOut and Join structural details on their selectable panels', async () => {
    // The other half of ECP-4's Canvas requirement: "#### Scenario: FanOut
    // panel shows members and limits — WHEN a FanOut node is selected in the
    // Canvas — THEN the panel SHALL show the member list ... AND SHALL show
    // concurrency cap and budget". The paired editor keeps that structural
    // summary visible while exposing member, concurrency, budget, and join
    // controls.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="fanout"]')
    );
    expect(container.querySelector('[data-testid="v2-node-panel-unsupported"]')).toBeNull();
    expect(container.querySelector('[data-testid="v2-parallel-editor"]')).not.toBeNull();
    // The paired contract is now structurally editable while retaining its summary.
    expect(container.querySelector('[data-testid="v2-node-panel-id"]')).not.toBeNull();

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="join"]')
    );
    expect(container.querySelector('[data-testid="v2-parallel-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="v2-node-panel-id"]')).not.toBeNull();
  });

  it('creates, selects, edits, renames, and deletes representative v2 root node kinds', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    // Stage and Finish gestures (design D2/D3) replace two of the four raw
    // palette kinds this test used to create directly.
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-finish"]'));
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'atomic-stage'
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'finish-2'
    );

    // Gate is now a stage property (design D4), not a raw palette kind —
    // attach one to the freshly created AtomicStage via its approval
    // checkbox. (Choice creation moved to connection splicing, design D5,
    // and is covered separately by the model tests and the Connection panel.)
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="atomic-stage"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-node-panel-gate-toggle"]'));
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'gate-2'
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
    // A FanOut's Join belongs to the same paired parallel contract, so the
    // pair is one unit in deletion (canvas-multi-selection): a removal
    // carrying the FanOut takes its Join too — never a half-pair left
    // behind. (React Flow itself never emits a remove for these
    // non-deletable nodes; this exercises the same batch path the selection
    // panel's delete button drives.)
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-remove"][data-node-id="fanout"]')
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).not.toContain(
      'fanout'
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).not.toContain(
      'join'
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-remove"][data-node-id="choice"]')
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).not.toContain(
      'choice,'
    );
  });

  it('authors execution-complete AtomicStage and lifecycle-complete BoundedLoop shapes from visible palette actions', async () => {
    const detail = structuredClone(v2EditableDetail) as PipelineDetailResponse;
    if (detail.definition.version !== 2) throw new Error('expected v2 fixture');
    detail.definition.declarations[0]!.graph.nodes.push({
      id: 'body-work',
      kind: 'AtomicStage',
      capability: { id: 'skill:rasen-apply', version: 'digest-apply' },
      execution: {
        version: 1,
        role: 'implementer',
        workspace: { access: 'write' },
      },
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValue(detail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    // Stage and Loop gestures (design D2/D3) replace the old raw
    // AtomicStage/BoundedLoop palette buttons; the resulting node shapes and
    // ids are unchanged, since both gestures still delegate to the same
    // `v2NodeIdFor` id scheme and node construction.
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-loop"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    if (submitted.version !== 2) throw new Error('expected v2 submission');
    const atomic = submitted.root.nodes.find((node) => node.id === 'atomic-stage');
    expect(atomic).toMatchObject({
      kind: 'AtomicStage',
      capability: { id: 'skill:rasen-propose', version: 'digest-propose' },
      execution: {
        version: 1,
        role: 'implementer',
        workspace: { access: 'write' },
      },
    });
    const loop = submitted.root.nodes.find((node) => node.id === 'bounded-loop');
    expect(loop).toMatchObject({
      kind: 'BoundedLoop',
      body: 'composite:review',
      limits: { maxIterations: 3, maxActions: 12, budget: 12 },
      lifecycle: {
        version: 1,
        thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
        strategy: { maxAttempts: 0, requireMaterialChange: true },
      },
    });
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

    // Reference it from the root graph via the declaration row's insert
    // action (design D6) — CompositeRef is no longer a raw palette kind, so
    // this targets the specific 'my-composite' row rather than a generic
    // palette button, proving the author's choice is honored.
    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-insert-ref"][data-declaration-id="my-composite"]'
      )
    );
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
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-loop"]'));
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

  it('authors a CONNECTED multi-stage body and saves the connection with it', async () => {
    // DISCRIMINATING PROBE (ECP-5 F1). Until body-connection authoring existed,
    // a Canvas-authored multi-stage body could only ever be DISCONNECTED
    // stages — which the reconciler admits in parallel, a materially different
    // pipeline than the sequence the author intended. A test that asserts only
    // "the body has 2 stages" passes for both; this asserts the EDGE reaches
    // the posted definition, which only the connected authoring can produce.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'seq',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));

    const stageIds = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-stage"]')
    ).map((node) => node.getAttribute('data-stage-id')!);
    expect(stageIds).toHaveLength(2);

    // "**AND** connects it to an existing body stage".
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-connection-from"]'),
      stageIds[0]!
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-connection-to"]'),
      stageIds[1]!
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-connection-add"]'));

    const edge = container.querySelector('[data-testid="declaration-body-connection"]');
    expect(edge).not.toBeNull();
    expect(edge!.getAttribute('data-from')).toBe(stageIds[0]);
    expect(edge!.getAttribute('data-to')).toBe(stageIds[1]);

    // "**AND** saves ... **THEN** the prepared definition SHALL include the
    // new stage in the declaration's body graph" — asserted on the POSTed body.
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(v2EditableDetail);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const posted = vi.mocked(client.mutatePipeline).mock.calls.at(-1)![0] as {
      definition: {
        declarations: {
          id: string;
          graph: {
            nodes: { id: string }[];
            connections: { from: { node: string }; to: { node: string } }[];
          };
        }[];
      };
    };
    const saved = posted.definition.declarations.find((d) => d.id === 'seq')!;
    expect(saved.graph.nodes.map((n) => n.id)).toEqual(stageIds);
    expect(saved.graph.connections).toHaveLength(1);
    expect(saved.graph.connections[0]!.from.node).toBe(stageIds[0]);
    expect(saved.graph.connections[0]!.to.node).toBe(stageIds[1]);
  });

  it('binds each body stage to a CHOSEN capability revision, not the first one', async () => {
    // DISCRIMINATING PROBE. `createBodyStage` assigns `firstExactCapability()`
    // to every stage it creates, so before this affordance a Canvas-authored
    // multi-stage body could only ever repeat ONE capability — "run X, then run
    // X again" — and the spec's own scenario says "the user adds an AtomicStage
    // WITH CAPABILITY skill:rasen-apply". The assertion is that the two body
    // stages carry DIFFERENT capabilities in the POSTed definition: a select
    // that renders but is not wired leaves them identical, which is exactly the
    // state a "the select exists" assertion would call green.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'mixed',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));

    const selects = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-stage-capability"]')
    ) as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    // The starting state IS the defect: both stages bound to the same revision.
    expect(selects[0]!.value).toBe(selects[1]!.value);
    // Every enabled exact revision the catalog offers is selectable — the same
    // set the root node panel renders, from the same filter.
    expect(Array.from(selects[1]!.options).map((option) => option.value)).toEqual([
      'skill:rasen-propose\0digest-propose',
      'skill:rasen-apply\0digest-apply',
    ]);

    const other = Array.from(selects[1]!.options)
      .map((option) => option.value)
      .find((value) => value !== selects[1]!.value)!;
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-body-stage-capability"][data-stage-id="stage-2"]'),
      other
    );

    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockResolvedValueOnce({
      pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' },
      created: false,
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValueOnce(v2EditableDetail);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const posted = vi.mocked(client.mutatePipeline).mock.calls.at(-1)![0] as {
      definition: {
        declarations: {
          id: string;
          graph: { nodes: { id: string; capability?: { id: string; version: string } }[] };
        }[];
      };
    };
    const body = posted.definition.declarations.find((d) => d.id === 'mixed')!.graph.nodes;
    expect(body).toHaveLength(2);
    const encoded = body.map((node) => `${node.capability!.id}\0${node.capability!.version}`);
    expect(encoded[1]).toBe(other);
    expect(encoded[0]).not.toBe(encoded[1]);
  });

  it('rejects a body connection that would create a cycle, with the model diagnostic', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'cyc',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    const stageIds = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-stage"]')
    ).map((node) => node.getAttribute('data-stage-id')!);

    async function connect(from: string, to: string) {
      await setValueAndFlush(
        container.querySelector('[data-testid="declaration-connection-from"]'),
        from
      );
      await setValueAndFlush(
        container.querySelector('[data-testid="declaration-connection-to"]'),
        to
      );
      await clickAndFlush(container.querySelector('[data-testid="declaration-connection-add"]'));
    }

    await connect(stageIds[0]!, stageIds[1]!);
    expect(container.querySelectorAll('[data-testid="declaration-body-connection"]')).toHaveLength(1);

    // "**WHEN** the user draws a connection in the declaration body that would
    // create a cycle — **THEN** the Canvas SHALL reject the connection."
    await connect(stageIds[1]!, stageIds[0]!);
    expect(container.querySelector('[data-testid="pipeline-canvas-toast"]')!.textContent).toContain(
      'would create a cycle'
    );
    // The rejection is the MODEL's, surfaced here — the edge is not added.
    expect(container.querySelectorAll('[data-testid="declaration-body-connection"]')).toHaveLength(1);
  });

  it('renames a body stage and carries its connection with it', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'ren',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    const stageIds = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-stage"]')
    ).map((node) => node.getAttribute('data-stage-id')!);
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-connection-from"]'),
      stageIds[0]!
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-connection-to"]'),
      stageIds[1]!
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-connection-add"]'));

    // The spec's "edit" verb, exercised through the affordance.
    const idInput = container.querySelector(
      `[data-testid="declaration-body-stage-id"][data-stage-id="${stageIds[0]}"]`
    ) as HTMLInputElement;
    idInput.focus();
    await setValueAndFlush(idInput, 'compile', 'input');
    await act(async () => {
      idInput.blur();
      await flushMicrotasks();
    });

    expect(
      container.querySelector('[data-testid="declaration-body-stage"][data-stage-id="compile"]')
    ).not.toBeNull();
    // The edge followed the rename rather than dangling at the old id.
    const edge = container.querySelector('[data-testid="declaration-body-connection"]')!;
    expect(edge.getAttribute('data-from')).toBe('compile');
    expect(edge.getAttribute('data-to')).toBe(stageIds[1]);
  });

  it('removes a body connection without removing its stages', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      'drop',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    const stageIds = Array.from(
      container.querySelectorAll('[data-testid="declaration-body-stage"]')
    ).map((node) => node.getAttribute('data-stage-id')!);
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-connection-from"]'),
      stageIds[0]!
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-connection-to"]'),
      stageIds[1]!
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-connection-add"]'));
    expect(container.querySelectorAll('[data-testid="declaration-body-connection"]')).toHaveLength(1);

    await clickAndFlush(
      container.querySelector('[data-testid="declaration-body-connection-remove"]')
    );
    expect(container.querySelectorAll('[data-testid="declaration-body-connection"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="declaration-body-stage"]')).toHaveLength(2);
  });

  it('surfaces the model diagnostic for a blank declaration id', async () => {
    // The panel used to refuse a blank id itself, via a `disabled` button —
    // the only rule in `DeclarationsPanel` it owned rather than delegating.
    // Now `addDeclaration` throws for blank exactly as it does for duplicate,
    // and the panel surfaces both the same way.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    const before = container.querySelectorAll('[data-testid="declaration-row"]').length;
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-new-id"]'),
      '   ',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="declaration-create"]'));

    expect(container.querySelector('[data-testid="pipeline-canvas-toast"]')!.textContent).toContain(
      'cannot be blank'
    );
    expect(container.querySelectorAll('[data-testid="declaration-row"]')).toHaveLength(before);
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
    // CompositeRef is no longer a root-palette kind (design D6) — the root
    // graph can still reference a declaration, but only via that
    // declaration row's own insert action, which the nested body palette
    // rightly excludes from its own offering.
    expect(
      container.querySelector(
        '[data-testid="declaration-insert-ref"][data-declaration-id="composite:review"]'
      )
    ).not.toBeNull();

    // Removing the stage again keeps the navigator honest.
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    expect(container.querySelectorAll('[data-testid="declaration-body-stage"]')).toHaveLength(1);
    await clickAndFlush(container.querySelector('[data-testid="declaration-body-stage-remove"]'));
    expect(container.querySelectorAll('[data-testid="declaration-body-stage"]')).toHaveLength(0);
  });

  it('inserts a CompositeRef from a declaration row and disables the loop gesture the draft cannot accept', async () => {
    // ECP-2 `executable-custom-composite`, "Canvas creates and references a
    // Custom Composite declaration": "The user SHALL be able to reference the
    // declaration from the root graph via a `CompositeRef` node." CompositeRef
    // is no longer a root-palette kind (design D6) — the declaration row's
    // "Insert into graph" action reaches the same `insertCompositeRef` model
    // helper, proving the author's chosen declaration is honored.
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-insert-ref"][data-declaration-id="composite:review"]'
      )
    );
    expect(container.querySelector('[data-testid="mock-reactflow"]')!.textContent).toContain(
      'composite-ref'
    );
    // The new node references the fixture's custom declaration, and the panel
    // opens on it.
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'composite-ref'
    );

    // The fixture's only declaration has an empty body graph, so a loop has
    // nothing to loop over: `unavailableRootGestures` (design D2) reports the
    // Loop gesture unavailable rather than offering a click that can only
    // toast. Choice, Gate, FanOut, Join, and CompositeRef are not offered as
    // root palette entries at all — Stage and Finish remain available.
    expect(
      (container.querySelector('[data-testid="v2-palette-gesture-loop"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="v2-palette-gesture-finish"]')).not.toBeNull();
    for (const kind of ['Choice', 'Gate', 'FanOut', 'Join', 'CompositeRef']) {
      expect(container.querySelector(`[data-testid="v2-palette-add-${kind}"]`)).toBeNull();
    }
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
        '[data-testid="issues-drawer-item"][data-path="/declarations/0/outcomes/0"] [data-testid="issues-drawer-path"]'
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

  it('renders and uses real control handles for production-shaped input-less AtomicStages through save and reload', async () => {
    const productionDefinition = structuredClone(
      CANVAS_V2_AUTHORING_DEFINITION
    ) as WirePipelineDefinitionV2;
    const firstAtomic = productionDefinition.root.nodes.find(
      (node) => node.kind === 'AtomicStage'
    );
    if (!firstAtomic || firstAtomic.kind !== 'AtomicStage') {
      throw new Error('production-shaped AtomicStage fixture missing');
    }
    productionDefinition.root.nodes.push({
      ...structuredClone(firstAtomic),
      id: 'atomic-stage-2',
    });
    let saved: WirePipelineDefinitionV2 | null = null;
    const productionDetail = {
      ...v2EditableDetail,
      definition: productionDefinition,
    } as PipelineDetailResponse;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce(productionDetail)
      .mockImplementation(async () => ({
        ...productionDetail,
        definition: saved ?? productionDefinition,
      }));
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(
      CANVAS_V2_AUTHORING_CATALOG
    );
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: true,
      issues: [],
      preparation: v2Preparation,
    });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') {
        saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      }
      return {
        pipeline: { name: productionDefinition.name, path: '/pipelines/v2-canvas' },
        created: false,
      };
    });

    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    expect(
      container.querySelector(
        '[data-testid="stage-node"][data-stage="atomic-stage-2"] [data-testid="mock-handle"][data-handle-type="target"][data-handle-id="input"]'
      )
    ).not.toBeNull();
    await clickAndFlush(
      container.querySelector('[data-testid="mock-connect-production-atomics"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    expect(saved!.root.connections).toContainEqual({
      id: 'atomic-stage:done->atomic-stage-2:input',
      from: { node: 'atomic-stage', port: 'done' },
      to: { node: 'atomic-stage-2', port: 'input' },
    });

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(
      (vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2)
        .root.connections
    ).toContainEqual({
      id: 'atomic-stage:done->atomic-stage-2:input',
      from: { node: 'atomic-stage', port: 'done' },
      to: { node: 'atomic-stage-2', port: 'input' },
    });
  });

  it('keeps invalid non-empty definition limits raw and blocks validation/save until repaired', async () => {
    const definition = structuredClone(
      CANVAS_V2_AUTHORING_DEFINITION
    ) as WirePipelineDefinitionV2;
    vi.mocked(client.getPipelineDetail).mockResolvedValue({
      ...v2EditableDetail,
      definition,
    } as PipelineDetailResponse);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(
      CANVAS_V2_AUTHORING_CATALOG
    );
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });

    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    const budget = () =>
      container.querySelector(
        '[data-testid="definition-limit-budget"]'
      ) as HTMLInputElement;

    for (const invalid of ['0', '-2', '1.5']) {
      await setValueAndFlush(budget(), invalid, 'input');
      expect(budget().value).toBe(invalid);
      expect(budget().getAttribute('aria-invalid')).toBe('true');
      expect(
        container.querySelector(
          '[data-testid="definition-limit-error"][data-limit="budget"]'
        )?.textContent
      ).toContain('positive integer');
      expect(
        (container.querySelector(
          '[data-testid="pipeline-canvas-save"]'
        ) as HTMLButtonElement).disabled
      ).toBe(true);
      await clickAndFlush(
        container.querySelector('[data-testid="pipeline-canvas-validate"]')
      );
      expect(client.validatePipeline).not.toHaveBeenCalled();
      expect(client.mutatePipeline).not.toHaveBeenCalled();
      await setValueAndFlush(budget(), '32', 'input');
    }

    await setValueAndFlush(budget(), '31', 'input');
    expect(budget().getAttribute('aria-invalid')).toBe('false');
    expect(
      (container.querySelector(
        '[data-testid="pipeline-canvas-save"]'
      ) as HTMLButtonElement).disabled
    ).toBe(false);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(
      (vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2)
        .limits?.budget
    ).toBe(31);

    await setValueAndFlush(budget(), '', 'input');
    expect(budget().getAttribute('aria-invalid')).toBe('false');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(
      (vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2)
        .limits
    ).not.toHaveProperty('budget');
  });

  it('resets a mounted positive-limit field when its authoritative draft is replaced', async () => {
    const onPatch = vi.fn();
    const onInvalidChange = vi.fn();
    const first = structuredClone(v2Definition) as WirePipelineDefinitionV2;
    first.limits = { budget: 32 };

    const renderPanel = async (definition: WirePipelineDefinitionV2) => {
      await act(async () => {
        render(
          <DefinitionContractPanel
            definition={definition}
            focusedField={null}
            onPatch={onPatch}
            onInvalidChange={onInvalidChange}
          />,
          container
        );
        await flushMicrotasks();
      });
    };

    await renderPanel(first);
    const budget = () =>
      container.querySelector(
        '[data-testid="definition-limit-budget"]'
      ) as HTMLInputElement;
    await setValueAndFlush(budget(), '0', 'input');
    expect(budget().value).toBe('0');
    expect(budget().getAttribute('aria-invalid')).toBe('true');

    await renderPanel({
      ...first,
      name: 'replacement-definition',
      limits: { budget: 64 },
    });
    expect(budget().value).toBe('64');
    expect(budget().getAttribute('aria-invalid')).toBe('false');
    expect(container.querySelector('[data-testid="definition-limit-error"]')).toBeNull();
    expect(onInvalidChange).toHaveBeenLastCalledWith('limits/budget', null);
  });

  it('keeps invalid loop, lifecycle, and paired-parallel integers raw and blocks every action until repair', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    const field = (testId: string) =>
      container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    const expectBlocked = async (testId: string, invalid: string) => {
      await setValueAndFlush(field(testId), invalid, 'input');
      expect(field(testId).value).toBe(invalid);
      expect(field(testId).getAttribute('aria-invalid')).toBe('true');
      expect(field(testId).getAttribute('aria-describedby')).not.toBeNull();
      expect(
        (container.querySelector(
          '[data-testid="pipeline-canvas-save"]'
        ) as HTMLButtonElement).disabled
      ).toBe(true);
      expect(
        (container.querySelector(
          '[data-testid="pipeline-canvas-export"]'
        ) as HTMLButtonElement).disabled
      ).toBe(true);
      await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
      expect(client.validatePipeline).not.toHaveBeenCalled();
    };
    const exerciseRequired = async (
      testId: string,
      invalidValues: readonly string[],
      repair: string
    ) => {
      for (const invalid of invalidValues) {
        await expectBlocked(testId, invalid);
        await setValueAndFlush(field(testId), repair, 'input');
        expect(field(testId).getAttribute('aria-invalid')).toBe('false');
      }
    };

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    await expectBlocked('v2-node-panel-max-rounds', '0');
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="fanout"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    expect(field('v2-node-panel-max-rounds').value).toBe('0');
    expect(field('v2-node-panel-max-rounds').getAttribute('aria-invalid')).toBe('true');
    await setValueAndFlush(field('v2-node-panel-max-rounds'), '3', 'input');
    await exerciseRequired('v2-node-panel-max-rounds', ['-2', '1.5', ''], '3');
    await exerciseRequired('v2-loop-stall-iterations', ['0', '-2', '1.5', ''], '3');
    await exerciseRequired('v2-loop-blocker-attempts', ['0', '-2', '1.5', ''], '3');
    await exerciseRequired('v2-loop-strategy-attempts', ['-2', '1.5', ''], '0');
    expect(field('v2-loop-strategy-attempts').value).toBe('0');

    await setValueAndFlush(field('v2-loop-max-actions'), '', 'input');
    expect(field('v2-loop-max-actions').getAttribute('aria-invalid')).toBe('false');
    await setValueAndFlush(field('v2-loop-budget'), '', 'input');
    expect(field('v2-loop-budget').getAttribute('aria-invalid')).toBe('false');

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="fanout"]')
    );
    await exerciseRequired('v2-parallel-concurrency-cap', ['0', '-2', '1.5', ''], '2');
    await exerciseRequired('v2-parallel-budget', ['0', '-2', '1.5', ''], '3');

    expect(
      (container.querySelector(
        '[data-testid="pipeline-canvas-save"]'
      ) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
      (container.querySelector(
        '[data-testid="pipeline-canvas-export"]'
      ) as HTMLButtonElement).disabled
    ).toBe(false);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(submitted.root.nodes.find((node) => node.id === 'loop')).toMatchObject({
      limits: { maxIterations: 3 },
      lifecycle: {
        thresholds: { stallIterations: 3, sameBlockerAttempts: 3 },
        strategy: { maxAttempts: 0 },
      },
    });
    expect(
      (submitted.root.nodes.find((node) => node.id === 'loop') as { limits: object })
        .limits
    ).not.toHaveProperty('maxActions');
    expect(
      (submitted.root.nodes.find((node) => node.id === 'loop') as { limits: object })
        .limits
    ).not.toHaveProperty('budget');
    expect(submitted.root.nodes.find((node) => node.id === 'fanout')).toMatchObject({
      concurrencyCap: 2,
      budget: 3,
    });
  });

  it('switches BoundedLoop bodies with an atomically visible and saveable exit map', async () => {
    const definition = structuredClone(v2Definition) as WirePipelineDefinitionV2;
    definition.declarations[0]!.outcomes = ['retry', 'done'];
    definition.declarations.push({
      id: 'alternate-body',
      kind: 'Composite',
      provenance: 'custom',
      inputs: [],
      artifacts: [],
      outcomes: ['done', 'partial'],
      graph: { nodes: [], connections: [] },
    });
    const loop = definition.root.nodes.find((node) => node.id === 'loop');
    if (!loop || loop.kind !== 'BoundedLoop') throw new Error('loop fixture missing');
    loop.exits = {
      retry: { action: 'continue' },
      done: { action: 'exit', outcome: 'done' },
    };
    let saved: WirePipelineDefinitionV2 | null = null;
    const detail = { ...v2EditableDetail, definition } as PipelineDetailResponse;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce(detail)
      .mockImplementation(async () => ({ ...detail, definition: saved ?? definition }));
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') {
        saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      }
      return { pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' }, created: false };
    });

    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-body"]'),
      'alternate-body'
    );

    expect(
      Array.from(
        container.querySelectorAll('[data-testid="v2-loop-domain-action"]')
      ).map((element) => element.getAttribute('data-outcome'))
    ).toEqual(['done', 'partial']);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(saved!.root.nodes.find((node) => node.id === 'loop')).toMatchObject({
      body: 'alternate-body',
      exits: {
        done: { action: 'exit', outcome: 'done' },
        partial: { action: 'continue' },
      },
    });
    expect(
      (saved!.root.nodes.find((node) => node.id === 'loop') as { exits: object })
        .exits
    ).not.toHaveProperty('retry');

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="v2-loop-domain-action"]')
      ).map((element) => element.getAttribute('data-outcome'))
    ).toEqual(['done', 'partial']);
  });

  it('reconciles a referencing BoundedLoop when declaration outcomes are edited and reloads it', async () => {
    const definition = structuredClone(v2Definition) as WirePipelineDefinitionV2;
    definition.declarations[0]!.outcomes = ['retry', 'done'];
    const loop = definition.root.nodes.find((node) => node.id === 'loop');
    if (!loop || loop.kind !== 'BoundedLoop') throw new Error('loop fixture missing');
    loop.exits = {
      retry: { action: 'continue' },
      done: { action: 'exit', outcome: 'done' },
    };
    let saved: WirePipelineDefinitionV2 | null = null;
    const detail = { ...v2EditableDetail, definition } as PipelineDetailResponse;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce(detail)
      .mockImplementation(async () => ({ ...detail, definition: saved ?? definition }));
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') {
        saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      }
      return { pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' }, created: false };
    });

    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector(
        '[data-testid="declaration-select"][data-declaration-id="composite:review"]'
      )
    );
    const outcomes = container.querySelector(
      '[data-testid="declaration-outcomes"]'
    ) as HTMLInputElement;
    outcomes.focus();
    await setValueAndFlush(outcomes, 'done,partial', 'input');
    await act(async () => {
      outcomes.blur();
      await flushMicrotasks();
    });
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="v2-loop-domain-action"]')
      ).map((element) => element.getAttribute('data-outcome'))
    ).toEqual(['done', 'partial']);

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));
    expect(saved!.declarations[0]!.outcomes).toEqual(['done', 'partial']);
    expect(
      (saved!.root.nodes.find((node) => node.id === 'loop') as WireBoundedLoopNode)
        .exits
    ).toEqual({
      done: { action: 'exit', outcome: 'done' },
      partial: { action: 'continue' },
    });

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="v2-loop-domain-action"]')
      ).map((element) => element.getAttribute('data-outcome'))
    ).toEqual(['done', 'partial']);
  });

  it('authors definition, AtomicStage, Gate, loop lifecycle, and parallel fields through mounted controls', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: true,
      issues: [],
      preparation: v2Preparation,
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    await clickAndFlush(container.querySelector('[data-testid="definition-input-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-input-name"]'),
      'brief',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-limit-budget"]'),
      '42',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="definition-artifact-add"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-artifact-name"]'),
      'report',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-outcomes"]'),
      'done,partial'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="definition-limit-max-actions"]'),
      '24',
      'input'
    );

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="atomic"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-role"]'),
      'reviewer'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-workspace"]'),
      'read'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-runtime"]'),
      'codex'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-model"]'),
      'gpt-test',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-lead-review"]'),
      'true'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-verify-policy"]'),
      'standard'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-effort"]'),
      'high',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-sandbox"]'),
      'workspace-write'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-session-reuse"]'),
      'stage'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-execution-handoff-max-relays"]'),
      '3',
      'input'
    );

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="gate"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-gate-disposition"][data-decision="rejected"]'),
      'fail'
    );

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-max-actions"]'),
      '13',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-strategy-attempts"]'),
      '1',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-strategy-capability"]'),
      'skill:rasen-propose\0digest-propose'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-goal-variant"]'),
      'research'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-domain-action"][data-outcome="done"]'),
      'continue'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-lifecycle-outcome"][data-trigger="iterationLimit"]'),
      'max-rounds-exhausted',
      'input'
    );

    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="fanout"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-parallel-condition"][data-member-id="atomic"]'),
      'changed',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-parallel-budget"]'),
      '9',
      'input'
    );

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(submitted.inputs).toEqual([{ name: 'brief', type: 'artifact/text', required: false }]);
    expect(submitted.artifacts).toEqual([{ name: 'report', type: 'artifact/text' }]);
    expect(submitted.outcomes).toEqual(['done', 'partial']);
    expect(submitted.limits?.maxActions).toBe(24);
    expect(submitted.limits?.budget).toBe(42);
    expect(submitted.root.nodes.find((node) => node.id === 'atomic')).toMatchObject({
      execution: {
        role: 'reviewer',
        workspace: { access: 'read' },
        runtime: 'codex',
        model: 'gpt-test',
        leadReview: true,
        verifyPolicy: 'standard',
        effort: 'high',
        sandbox: 'workspace-write',
        sessionReuse: 'stage',
        handoff: { maxRelays: 3 },
      },
    });
    expect(submitted.root.nodes.find((node) => node.id === 'atomic')).not.toHaveProperty('execution.gate');
    expect(submitted.root.nodes.find((node) => node.id === 'gate')).toMatchObject({
      dispositions: { rejected: 'fail' },
    });
    expect(submitted.root.nodes.find((node) => node.id === 'loop')).toMatchObject({
      limits: { maxActions: 13 },
      lifecycle: {
        strategy: {
          maxAttempts: 1,
          capability: { id: 'skill:rasen-propose', version: 'digest-propose' },
        },
        exits: {
          iterationLimit: { action: 'exit', outcome: 'max-rounds-exhausted' },
        },
      },
      goalCycleVariant: 'research',
      exits: { done: { action: 'continue' } },
    });
    expect(submitted.root.nodes.find((node) => node.id === 'fanout')).toMatchObject({
      budget: 9,
      members: [{ id: 'atomic', condition: 'changed' }],
    });
  });

  it('renames a custom declaration and authors body execution plus phase without losing references', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector('[data-testid="declaration-select"][data-declaration-id="composite:review"]')
    );

    const declarationId = container.querySelector('[data-testid="declaration-id"]') as HTMLInputElement;
    declarationId.focus();
    await setValueAndFlush(declarationId, 'review-body', 'input');
    await act(async () => {
      declarationId.blur();
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="v2-body-palette-add-AtomicStage"]'));
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-body-execution-role"]'),
      'reviewer'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-body-execution-workspace"]'),
      'read'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="declaration-body-execution-review-phase"]'),
      'review'
    );

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    const declaration = submitted.declarations.find((item) => item.id === 'review-body')!;
    expect(declaration.graph.nodes[0]).toMatchObject({
      execution: { version: 1, role: 'reviewer', workspace: { access: 'read' } },
      reviewCyclePhase: 'review',
    });
    expect(submitted.root.nodes.find((node) => node.id === 'composite')).toMatchObject({
      declarationId: 'review-body',
    });
    expect(submitted.root.nodes.find((node) => node.id === 'loop')).toMatchObject({
      body: 'review-body',
    });
  });

  it('removes FanOut and Join only through the explicit paired action', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="join"]')
    );
    await clickAndFlush(container.querySelector('[data-testid="v2-parallel-delete-pair"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const submitted = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(submitted.root.nodes.some((node) => node.kind === 'FanOut')).toBe(false);
    expect(submitted.root.nodes.some((node) => node.kind === 'Join')).toBe(false);
  });

  it('loads, renders, selects, edits, and saves an existing v2 definition containing all eight node kinds without shape drift', async () => {
    // ECP-2 executable-custom-composite / design D8: the closed gesture
    // vocabulary only constrains AUTHORING new nodes — a definition that
    // already carries all eight raw IR kinds (however it was produced) must
    // still load, render, and round-trip through the editor untouched.
    let saved: WirePipelineDefinitionV2 | null = null;
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      return { pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' }, created: false };
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();

    // Renders: every one of the fixture's eight node ids is present.
    const flowText = () => container.querySelector('[data-testid="mock-reactflow"]')!.textContent;
    for (const id of ['atomic', 'gate', 'choice', 'finish', 'composite', 'loop', 'fanout', 'join']) {
      expect(flowText()).toContain(id);
    }

    // Selects: clicking each node surfaces its own kind in the properties
    // panel — nothing is hidden or misrendered for a withdrawn raw kind.
    const kindByNodeId: Record<string, string> = {
      atomic: 'AtomicStage',
      gate: 'Gate',
      choice: 'Choice',
      finish: 'Finish',
      composite: 'CompositeRef',
      loop: 'BoundedLoop',
      fanout: 'FanOut',
      join: 'Join',
    };
    for (const [nodeId, kind] of Object.entries(kindByNodeId)) {
      await clickAndFlush(
        container.querySelector(`[data-testid="mock-node-click"][data-node-id="${nodeId}"]`)
      );
      expect(
        container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-kind')
      ).toBe(kind);
    }

    // Edits: one deliberate change (Finish's terminal outcome) — every other
    // node, the declarations, and the connections must round-trip verbatim.
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="finish"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-node-panel-outcome"]'),
      'rejected'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    expect(saved).not.toBeNull();
    expect(saved!.root.nodes.map((node) => ({ id: node.id, kind: node.kind }))).toEqual(
      v2Definition.root.nodes.map((node) => ({ id: node.id, kind: node.kind }))
    );
    expect(saved!.root.connections).toEqual(v2Definition.root.connections);
    expect(saved!.declarations).toEqual(v2Definition.declarations);
    expect(saved!.root.nodes.find((node) => node.id === 'finish')).toMatchObject({
      outcome: 'rejected',
    });
    for (const id of ['atomic', 'gate', 'choice', 'composite', 'loop', 'fanout', 'join']) {
      expect(saved!.root.nodes.find((node) => node.id === id)).toEqual(
        v2Definition.root.nodes.find((node) => node.id === id)
      );
    }
  });

  it('keeps paired membership, partitions, conditions, limits, and outcomes equal after save and detail reload', async () => {
    let saved: WirePipelineDefinitionV2 | null = null;
    vi.mocked(client.getPipelineDetail)
      .mockResolvedValueOnce(v2EditableDetail)
      .mockImplementation(async () => ({
        ...v2EditableDetail,
        definition: saved ?? v2Definition,
      } as PipelineDetailResponse));
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.mutatePipeline).mockImplementation(async (request) => {
      if (request.op === 'save') saved = structuredClone(request.definition) as WirePipelineDefinitionV2;
      return { pipeline: { name: 'v2-canvas', path: '/pipelines/v2-canvas' }, created: false };
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    // Stage gesture (design D2/D3) replaces the raw AtomicStage palette
    // button; same node construction and id scheme.
    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="fanout"]')
    );
    await clickAndFlush(
      container.querySelector('[data-testid="v2-parallel-member-select"][data-member-id="atomic-stage"]')
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-parallel-condition"][data-member-id="atomic-stage"]'),
      'changed',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-parallel-concurrency-cap"]'),
      '2',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-parallel-budget"]'),
      '7',
      'input'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-parallel-failed-outcome"]'),
      'partial',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-save"]'));

    const savedFanOut = saved!.root.nodes.find((node) => node.kind === 'FanOut');
    const savedJoin = saved!.root.nodes.find((node) => node.kind === 'Join');
    expect(savedFanOut).toMatchObject({
      branches: ['atomic', 'atomic-stage'],
      concurrencyCap: 2,
      budget: 7,
      members: [
        { id: 'atomic', required: true },
        { id: 'atomic-stage', required: false, condition: 'changed' },
      ],
    });
    expect(savedJoin).toMatchObject({
      inputs: ['atomic', 'atomic-stage'],
      requiredMembers: ['atomic'],
      optionalMembers: ['atomic-stage'],
      outcomes: { proceed: 'done', failed: 'partial' },
    });

    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    expect(vi.mocked(client.validatePipeline).mock.calls.at(-1)![0]).toEqual(saved);
  });

  it('repairs an incomplete lifecycle and keeps strategy capability absent at zero attempts', async () => {
    const incomplete = structuredClone(v2Definition) as unknown as WirePipelineDefinitionV2;
    const loop = incomplete.root.nodes.find((node) => node.kind === 'BoundedLoop');
    if (!loop || loop.kind !== 'BoundedLoop') throw new Error('loop fixture missing');
    delete loop.lifecycle;
    vi.mocked(client.getPipelineDetail).mockResolvedValue({
      ...v2EditableDetail,
      definition: incomplete,
    } as PipelineDetailResponse);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline)
      .mockResolvedValueOnce({
        valid: false,
        issues: [{
          severity: 'error',
          code: 'STRATEGY_CAPABILITY_REQUIRED',
          path: '/root/nodes/5/lifecycle/strategy/capability',
          message: 'Positive attempts require an exact capability.',
        }],
      })
      .mockResolvedValueOnce({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(
      container.querySelector('[data-testid="mock-node-click"][data-node-id="loop"]')
    );
    expect(container.querySelector('[data-testid="v2-loop-lifecycle"]')?.textContent).toContain('Incomplete lifecycle');
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-strategy-attempts"]'),
      '1',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const mismatched = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    expect(mismatched.root.nodes.find((node) => node.kind === 'BoundedLoop')).toMatchObject({
      lifecycle: { strategy: { maxAttempts: 1, requireMaterialChange: true } },
    });
    expect(
      (mismatched.root.nodes.find((node) => node.kind === 'BoundedLoop') as { lifecycle: { strategy: object } }).lifecycle.strategy
    ).not.toHaveProperty('capability');
    expect(container.querySelector('[data-testid="issues-drawer-item"]')?.textContent).toContain('STRATEGY_CAPABILITY_REQUIRED');

    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-strategy-capability"]'),
      'skill:rasen-propose\0digest-propose'
    );
    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-strategy-attempts"]'),
      '0',
      'input'
    );
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    const zero = vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
    const zeroLoop = zero.root.nodes.find((node) => node.kind === 'BoundedLoop');
    expect(zeroLoop).toMatchObject({ lifecycle: { strategy: { maxAttempts: 0 } } });
    expect((zeroLoop as { lifecycle: { strategy: object } }).lifecycle.strategy).not.toHaveProperty('capability');
  });

  it('navigates definition, declaration, body, and nested node diagnostics while preserving unknown detail', async () => {
    const definitionWithBody = structuredClone(v2Definition) as unknown as WirePipelineDefinitionV2;
    definitionWithBody.declarations[0]!.graph.nodes.push({
      id: 'review',
      kind: 'AtomicStage',
      capability: { id: 'skill:rasen-propose', version: 'digest-propose' },
      execution: { version: 1, role: 'reviewer', workspace: { access: 'read' } },
    });
    definitionWithBody.declarations[0]!.graph.nodes.push({
      id: 'apply',
      kind: 'AtomicStage',
      capability: { id: 'skill:rasen-apply', version: 'digest-apply' },
      execution: { version: 1, role: 'implementer', workspace: { access: 'write' } },
    });
    definitionWithBody.declarations[0]!.graph.connections.push({
      id: 'review-to-apply',
      from: { node: 'review', port: 'done' },
      to: { node: 'apply', port: 'input' },
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValue({
      ...v2EditableDetail,
      definition: definitionWithBody,
    } as PipelineDetailResponse);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: false,
      issues: [
        { severity: 'error', code: 'BUDGET', path: '/limits/budget', message: 'Budget invalid.' },
        { severity: 'warning', code: 'DECL', path: '/declarations/0/outcomes/0', message: 'Outcome warning.' },
        { severity: 'warning', code: 'BODY_ROLE', path: '/declarations/0/graph/nodes/0/execution/role', message: 'Role deserves review.' },
        { severity: 'error', code: 'BODY_CAPABILITY', path: '/declarations/0/graph/nodes/0/capability/version', message: 'Capability incompatible.' },
        { severity: 'error', code: 'BODY_ACCESS', path: '/declarations/0/graph/nodes/0/execution/workspace/access', message: 'Workspace access incompatible.' },
        { severity: 'warning', code: 'BODY_CONNECTION_WARNING', path: '/declarations/0/graph/connections/0/to/port', message: 'Target port deserves review.' },
        { severity: 'error', code: 'BODY_CONNECTION_ERROR', path: '/declarations/0/graph/connections/0/to/port', message: 'Target port is invalid.' },
        { severity: 'error', code: 'LOOP_EXIT', path: '/root/nodes/5/lifecycle/exits/blocked/action', message: 'Blocked exit invalid.' },
        { severity: 'error', code: 'PARALLEL_PARTITION', path: '/root/nodes/7/requiredMembers/0', message: 'Join partition mismatch.' },
        { severity: 'error', code: 'PARALLEL_JOIN', path: '/root/nodes/6/joinNodeId', message: 'Join reference missing.' },
        {
          severity: 'warning',
          code: 'FUTURE',
          path: '/future/field',
          message: 'Future field.',
          related: [{ path: '/future/source', message: 'Future source.' }],
        },
      ],
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const select = async (path: string) =>
      clickAndFlush(
        container.querySelector(
          `[data-testid="issues-drawer-item"][data-path="${path}"] [data-testid="issues-drawer-select"]`
        )
      );
    await select('/limits/budget');
    expect(container.querySelector('[data-testid="definition-contract-panel"]')?.getAttribute('data-focused-field')).toBe('limits/budget');
    await select('/declarations/0/outcomes/0');
    expect(container.querySelector('[data-testid="declaration-editor"]')?.getAttribute('data-focused-field')).toBe('outcomes/0');
    await select('/declarations/0/graph/nodes/0/execution/role');
    expect(container.querySelector('[data-testid="declaration-body-stage"][data-stage-id="review"]')?.getAttribute('data-focused-field')).toBe('execution/role');
    const roleControl = container.querySelector(
      '[data-testid="declaration-body-execution-role"]'
    );
    expect(roleControl?.closest('label')?.classList).toContain(
      'stage-panel__field--issue-warning'
    );
    expect(roleControl?.closest('label')?.classList).not.toContain(
      'stage-panel__field--issue-error'
    );

    const connectionIssueButtons = container.querySelectorAll(
      '[data-testid="issues-drawer-item"][data-path="/declarations/0/graph/connections/0/to/port"] [data-testid="issues-drawer-select"]'
    );
    await clickAndFlush(connectionIssueButtons[0] ?? null);
    const connectionRow = container.querySelector(
      '[data-testid="declaration-body-connection"][data-connection-id="review-to-apply"]'
    );
    const targetEndpoint = connectionRow?.querySelector(
      '[data-testid="declaration-body-connection-endpoint"][data-endpoint="to"]'
    );
    expect(connectionRow?.getAttribute('data-focused-field')).toBe('to/port');
    expect(connectionRow?.getAttribute('data-issue')).toBe('warning');
    expect(targetEndpoint?.getAttribute('data-focused-field')).toBe('to/port');
    expect(targetEndpoint?.getAttribute('data-issue')).toBe('warning');
    expect(
      connectionRow
        ?.querySelector('[data-testid="declaration-body-connection-endpoint"][data-endpoint="from"]')
        ?.getAttribute('data-issue')
    ).toBeNull();

    await clickAndFlush(connectionIssueButtons[1] ?? null);
    expect(connectionRow?.getAttribute('data-issue')).toBe('error');
    expect(targetEndpoint?.getAttribute('data-issue')).toBe('error');
    await select('/root/nodes/5/lifecycle/exits/blocked/action');
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe('loop');
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-focused-field')).toBe('lifecycle/exits/blocked/action');

    const unknown = container.querySelector('[data-testid="issues-drawer-item"][data-path="/future/field"]')!;
    expect(unknown.querySelector('[data-testid="issues-drawer-unmapped"]')?.textContent).toContain('/future/field');
    expect(unknown.textContent).toContain('FUTURE');
    expect(unknown.textContent).toContain('/future/source');
    expect(container.querySelector('[data-testid="issues-drawer-item"][data-path="/declarations/0/graph/nodes/0/capability/version"] [data-testid="issues-drawer-select"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issues-drawer-item"][data-path="/declarations/0/graph/nodes/0/execution/workspace/access"] [data-testid="issues-drawer-select"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issues-drawer-item"][data-path="/root/nodes/7/requiredMembers/0"] [data-testid="issues-drawer-select"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issues-drawer-item"][data-path="/root/nodes/6/joinNodeId"] [data-testid="issues-drawer-select"]')).not.toBeNull();

    await setValueAndFlush(
      container.querySelector('[data-testid="v2-loop-max-actions"]'),
      '15',
      'input'
    );
    expect(container.querySelector('[data-testid="issues-drawer"]')).toBeNull();
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-focused-field')).toBe('');
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="loop"]')?.getAttribute('data-issue')
    ).toBeNull();
  });

  it('never redirects a body diagnostic to another declaration with the same local ids', async () => {
    const definition = structuredClone(v2Definition) as WirePipelineDefinitionV2;
    const sharedBody = {
      nodes: [
        {
          id: 'review',
          kind: 'AtomicStage' as const,
          capability: { id: 'skill:rasen-propose', version: 'digest-propose' },
          execution: {
            version: 1 as const,
            role: 'reviewer' as const,
            workspace: { access: 'read' as const },
          },
        },
        {
          id: 'apply',
          kind: 'AtomicStage' as const,
          capability: { id: 'skill:rasen-apply', version: 'digest-apply' },
          execution: {
            version: 1 as const,
            role: 'implementer' as const,
            workspace: { access: 'write' as const },
          },
        },
      ],
      connections: [
        {
          id: 'review-to-apply',
          from: { node: 'review', port: 'done' },
          to: { node: 'apply', port: 'input' },
        },
      ],
    };
    definition.declarations[0] = {
      ...definition.declarations[0]!,
      graph: structuredClone(sharedBody),
    };
    definition.declarations.push({
      id: 'composite:alternate',
      kind: 'Composite',
      provenance: 'custom',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      graph: structuredClone(sharedBody),
    });
    vi.mocked(client.getPipelineDetail).mockResolvedValue({
      ...v2EditableDetail,
      definition,
    } as PipelineDetailResponse);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: false,
      issues: [
        {
          severity: 'warning',
          code: 'OWNER_NODE',
          path: '/declarations/0/graph/nodes/0/execution/role',
          message: 'Only declaration zero owns this node issue.',
        },
        {
          severity: 'error',
          code: 'OWNER_CONNECTION',
          path: '/declarations/0/graph/connections/0/to/port',
          message: 'Only declaration zero owns this connection issue.',
        },
      ],
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await enterEdit();
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    const selectIssue = async (path: string) =>
      clickAndFlush(
        container.querySelector(
          `[data-testid="issues-drawer-item"][data-path="${path}"] [data-testid="issues-drawer-select"]`
        )
      );
    const selectAlternate = async () =>
      clickAndFlush(
        container.querySelector(
          '[data-testid="declaration-select"][data-declaration-id="composite:alternate"]'
        )
      );

    await selectIssue('/declarations/0/graph/nodes/0/execution/role');
    expect(
      container.querySelector('[data-testid="declaration-editor"]')?.getAttribute('data-declaration-id')
    ).toBe('composite:review');
    await selectAlternate();
    expect(
      container.querySelector('[data-testid="declaration-editor"]')?.getAttribute('data-focused-field')
    ).toBe('');
    expect(
      container
        .querySelector('[data-testid="declaration-body-stage"][data-stage-id="review"]')
        ?.getAttribute('data-focused-field')
    ).toBe('');

    await selectIssue('/declarations/0/graph/connections/0/to/port');
    expect(
      container
        .querySelector('[data-testid="declaration-body-connection"][data-connection-id="review-to-apply"]')
        ?.getAttribute('data-issue')
    ).toBe('error');
    await selectAlternate();
    expect(
      container.querySelector('[data-testid="declaration-editor"]')?.getAttribute('data-focused-field')
    ).toBe('');
    expect(
      container
        .querySelector('[data-testid="declaration-body-connection"][data-connection-id="review-to-apply"]')
        ?.getAttribute('data-issue')
    ).toBeNull();
  });
});

/**
 * Multi-selection coverage (canvas-multi-selection). The ReactFlow mock's
 * interaction buttons drive `onSelectionChange` — the single user-action
 * mirror writer (design D1): plain click replaces, augment (the platform
 * multi-select key) toggles within the selection, pane click empties it,
 * and `mock-delete-selection` is the Delete key's batch of remove changes.
 * The mock also carries the SelectionListener stand-in (see the mock body,
 * review m1): it re-emits store truth after every render, so the
 * programmatic-write tests at the bottom of this block pin that the page
 * re-stamps the flow's `selected` flags with every mirror write (B1/M1).
 * jsdom performs no layout, so the Shift+drag box geometry itself is
 * verified only by the real-browser CDP check recorded in the change's
 * evidence dir; these tests pin the selection CONTRACT each gesture
 * produces.
 */
describe('PipelineCanvasPage — multi-selection', () => {
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
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(v2CatalogFixture);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
    __resetLocaleForTesting();
    vi.clearAllMocks();
  });

  async function clickAndFlush(el: Element | null): Promise<void> {
    await act(async () => {
      (el as HTMLElement).click();
      await flushMicrotasks();
    });
  }

  function nodeButton(kind: 'click' | 'augment', id: string): Element | null {
    return container.querySelector(
      `[data-testid="mock-node-${kind}"][data-node-id="${id}"]`
    );
  }

  async function mountV2Edit(): Promise<void> {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
  }

  async function submittedDefinition(): Promise<WirePipelineDefinitionV2> {
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));
    return vi.mocked(client.validatePipeline).mock.calls.at(-1)![0] as WirePipelineDefinitionV2;
  }

  it('renders the selection summary for a multi-node selection, with counts and kinds', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'atomic'));
    // Exactly one node: today's node panel, no summary.
    expect(container.querySelector('[data-testid="v2-node-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();

    await clickAndFlush(await nodeButton('augment', 'choice'));
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('data-node-count')).toBe('2');
    expect(panel!.getAttribute('data-connection-count')).toBe('0');
    expect(
      panel!.querySelector('[data-testid="v2-selection-panel-counts"]')!.textContent
    ).toContain('2 nodes');
    const kinds = panel!.querySelector('[data-testid="v2-selection-panel-kinds"]')!.textContent!;
    expect(kinds).toContain('AtomicStage');
    expect(kinds).toContain('Choice');
    // The singleton node panel yielded to the summary.
    expect(container.querySelector('[data-testid="v2-node-panel"]')).toBeNull();
  });

  it('selects nodes and connections together as one mixed selection', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'finish'));
    await clickAndFlush(
      container.querySelector('[data-testid="mock-edge-augment"][data-edge-id="atomic:done->gate:input"]')
    );
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('data-node-count')).toBe('1');
    expect(panel!.getAttribute('data-connection-count')).toBe('1');
    expect(
      panel!.querySelector('[data-testid="v2-selection-panel-counts"]')!.textContent
    ).toContain('1 node');
    expect(
      panel!.querySelector('[data-testid="v2-selection-panel-counts"]')!.textContent
    ).toContain('1 connection');
  });

  it('removes an element from the selection when augment-clicked again', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'atomic'));
    await clickAndFlush(await nodeButton('augment', 'choice'));
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).not.toBeNull();

    await clickAndFlush(await nodeButton('augment', 'choice'));
    // Back to a singleton: the summary closes and the node panel reopens.
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'atomic'
    );
  });

  it('multi-deletes the whole set and cleans every connection reference', async () => {
    vi.mocked(client.getPipelineDetail).mockRejectedValue(
      new ApiError(404, { error: { code: 'not_found', message: 'No pipeline named "multi-delete".' } })
    );
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/multi-delete');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-start-assembling"]'));

    // Two stages, wired together — then selected together (the second
    // gesture UNIONs into the first's selection).
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]'));
    await clickAndFlush(container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-apply"]'));
    await clickAndFlush(container.querySelector('[data-testid="mock-connect-production-atomics"]'));
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel!.getAttribute('data-node-count')).toBe('2');

    await clickAndFlush(container.querySelector('[data-testid="v2-selection-panel-delete"]'));
    const submitted = await submittedDefinition();
    expect(submitted.root.nodes).toEqual([]);
    expect(submitted.root.connections).toEqual([]);
    // The selection left with the nodes — no orphaned summary panel.
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
  });

  it('deletes a selected FanOut together with its Join from the summary panel', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'fanout'));
    await clickAndFlush(await nodeButton('augment', 'finish'));

    await clickAndFlush(container.querySelector('[data-testid="v2-selection-panel-delete"]'));
    const submitted = await submittedDefinition();
    expect(submitted.root.nodes.map((node) => node.id)).toEqual([
      'atomic',
      'gate',
      'choice',
      'composite',
      'loop',
    ]);
    // No refusal toast — the pair went as one unit.
    expect(container.querySelector('[data-testid="pipeline-canvas-toast"]')).toBeNull();
  });

  it('reports every refusal in one summary message naming each refused element', async () => {
    await mountV2Edit();
    // join: a lone barrier whose FanOut was not selected; atomic: still
    // targeted by the fixture's Gate; choice: plain and deletable.
    await clickAndFlush(await nodeButton('click', 'join'));
    await clickAndFlush(await nodeButton('augment', 'atomic'));
    await clickAndFlush(await nodeButton('augment', 'choice'));

    await clickAndFlush(container.querySelector('[data-testid="v2-selection-panel-delete"]'));
    const toast = container.querySelector('[data-testid="pipeline-canvas-toast"]');
    expect(toast).not.toBeNull();
    // ONE message carries the deleted count and names BOTH refusals with
    // their reasons — a per-node toast loop would leave only the last
    // refusal visible.
    expect(toast!.textContent).toContain('Deleted 1');
    expect(toast!.textContent).toContain('2 refused');
    expect(toast!.textContent).toContain("atomic (Node 'atomic' is still targeted by Gate 'gate'.)");
    expect(toast!.textContent).toContain('join (FanOut and Join require explicit paired deletion.)');

    const submitted = await submittedDefinition();
    expect(submitted.root.nodes.map((node) => node.id)).toContain('atomic');
    expect(submitted.root.nodes.map((node) => node.id)).toContain('join');
    expect(submitted.root.nodes.map((node) => node.id)).not.toContain('choice');
  });

  it('keeps the previous selection stamped selected across a palette add', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'atomic'));
    await clickAndFlush(await nodeButton('augment', 'choice'));

    await clickAndFlush(
      container.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')
    );
    // The rebuild re-stamps `selected` from the mirror (design D3's
    // selection-carry): the two previously selected nodes are still
    // selected after the new node appears — the spec's
    // "Selection survives a non-destructive edit" scenario.
    for (const id of ['atomic', 'choice']) {
      expect(
        container.querySelector(`[data-testid="mock-node"][data-node-id="${id}"]`)?.getAttribute('data-selected')
      ).toBe('true');
    }
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="finish"]')?.getAttribute('data-selected')
    ).not.toBe('true');
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel!.getAttribute('data-node-count')).toBe('3');
  });

  it('prunes the selection after the Delete key removes the batch', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'finish'));
    await clickAndFlush(await nodeButton('augment', 'composite'));
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).not.toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="mock-delete-selection"]'));
    const flowText = container.querySelector('[data-testid="mock-reactflow"]')!.textContent!;
    expect(flowText).not.toContain('finish');
    expect(flowText).not.toContain('composite');
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
  });

  it('replaces a multi-selection with exactly the issue\'s target on an issue click', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: false,
      issues: [{ severity: 'error', path: '/root/nodes/1/skill', message: 'Gate skill issue.' }],
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    await clickAndFlush(await nodeButton('click', 'atomic'));
    await clickAndFlush(await nodeButton('augment', 'choice'));
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).not.toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="issues-drawer-select"]'));
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'gate'
    );
  });

  it('deletes several v1 stages as a set, cleaning every dependency reference', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));

    await clickAndFlush(await nodeButton('click', 'propose'));
    await clickAndFlush(await nodeButton('augment', 'apply'));
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('data-node-count')).toBe('2');

    await clickAndFlush(container.querySelector('[data-testid="v2-selection-panel-delete"]'));
    const submitted = await submittedDefinition() as unknown as { stages: { id: string; requires: string[] }[] };
    expect(submitted.stages.map((stage) => stage.id)).not.toContain('propose');
    expect(submitted.stages.map((stage) => stage.id)).not.toContain('apply');
    // review/cso/qa required 'apply' — the group's references were cleaned,
    // not left dangling.
    for (const stage of submitted.stages) {
      expect(stage.requires).not.toContain('apply');
      expect(stage.requires).not.toContain('propose');
    }
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
  });

  // --- Review round 1 regression pins (B1/M1) -----------------------------
  //
  // These only discriminate because the mock now carries the SelectionListener
  // stand-in: every programmatic selection write must re-stamp the flow's
  // `selected` flags in the same update, or the listener's next firing reverts
  // the mirror one commit later.

  it('keeps an issue-click selection: the listener re-fire cannot revert it (B1)', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(v2EditableDetail);
    vi.mocked(client.validatePipeline).mockResolvedValue({
      valid: false,
      issues: [{ severity: 'error', path: '/root/nodes/1/skill', message: 'Gate skill issue.' }],
    });
    await mountAt(container, '/p/proj_x/pipelines/v2-canvas');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-validate"]'));

    // A multi-selection is standing when the issue is clicked — the
    // listener's next firing must see flow state for the issue's target,
    // not for the selection that write replaces.
    await clickAndFlush(await nodeButton('click', 'atomic'));
    await clickAndFlush(await nodeButton('augment', 'choice'));

    await clickAndFlush(container.querySelector('[data-testid="issues-drawer-select"]'));
    // The target's panel stays open — the re-fire used to clear the mirror
    // (no prior selection) or revert it to the box selection.
    expect(container.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node')).toBe(
      'gate'
    );
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
    // The flow flags agree with the mirror: exactly the target.
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="gate"]')?.getAttribute('data-selected')
    ).toBe('true');
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="atomic"]')?.getAttribute('data-selected')
    ).not.toBe('true');
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="choice"]')?.getAttribute('data-selected')
    ).not.toBe('true');
  });

  it('keeps the singleton and summary panels closed after their close button (B1)', async () => {
    await mountV2Edit();
    await clickAndFlush(await nodeButton('click', 'atomic'));
    expect(container.querySelector('[data-testid="v2-node-panel"]')).not.toBeNull();

    await clickAndFlush(
      container.querySelector('button[aria-label="Close node properties"]')
    );
    // The close persists: the listener's re-fire with flow truth used to
    // re-select the node and reopen the panel one frame later.
    expect(container.querySelector('[data-testid="v2-node-panel"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="mock-node"][data-node-id="atomic"]')?.getAttribute('data-selected')
    ).not.toBe('true');

    // Same contract for the multi-selection summary panel.
    await clickAndFlush(await nodeButton('click', 'atomic'));
    await clickAndFlush(await nodeButton('augment', 'choice'));
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel).not.toBeNull();
    // v2 keeps the version-neutral heading (review t1 pins the v1 variant
    // in the v1 test below).
    expect(panel!.querySelector('.stage-panel__title')?.textContent).toBe('Selection');
    await clickAndFlush(
      container.querySelector('button[aria-label="Close selection summary"]')
    );
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
    for (const id of ['atomic', 'choice']) {
      expect(
        container.querySelector(`[data-testid="mock-node"][data-node-id="${id}"]`)?.getAttribute('data-selected')
      ).not.toBe('true');
    }
  });

  it('v1 delete removes the stage cards from the canvas and the summary stays closed (M1)', async () => {
    vi.mocked(client.getPipelineDetail).mockResolvedValue(editableDetail);
    vi.mocked(client.validatePipeline).mockResolvedValue({ valid: true, issues: [] });
    await mountAt(container, '/p/proj_x/pipelines/small-feature');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-canvas-edit"]'));

    await clickAndFlush(await nodeButton('click', 'propose'));
    await clickAndFlush(await nodeButton('augment', 'apply'));
    const panel = container.querySelector('[data-testid="v2-selection-panel"]');
    expect(panel).not.toBeNull();
    // The v1 editor's summary names its mode's vocabulary — its elements
    // are stage cards (review t1).
    expect(panel!.querySelector('.stage-panel__title')?.textContent).toBe('Selected stages');

    await clickAndFlush(container.querySelector('[data-testid="v2-selection-panel-delete"]'));
    // Ghost check: the deleted cards leave the canvas — this path used to
    // leave them rendered as still-selected ghosts, and the listener then
    // re-popped the summary reporting the deleted stages.
    const flowText = container.querySelector('[data-testid="mock-reactflow"]')!.textContent!;
    expect(flowText).not.toContain('propose');
    expect(flowText).not.toContain('apply');
    expect(container.querySelector('[data-testid="v2-selection-panel"]')).toBeNull();
  });
});
