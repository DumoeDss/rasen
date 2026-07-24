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
  };
});

interface MockNode {
  id: string;
  type?: string;
}

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: {
    nodes: MockNode[];
    onNodeClick?: (e: unknown, n: MockNode) => void;
    onPaneClick?: () => void;
    proOptions?: { hideAttribution?: boolean };
  }) => (
    <div data-testid="mock-reactflow-wrapper" data-hide-attribution={String(props.proOptions?.hideAttribution)}>
      <div data-testid="mock-reactflow">{props.nodes.map((n) => n.id).join(',')}</div>
      <div data-testid="mock-reactflow-controls">
        {props.nodes
          .filter((n) => n.type === 'stage')
          .map((n) => (
            <button
              key={n.id}
              type="button"
              data-testid="mock-node-click"
              data-node-id={n.id}
              onClick={() => props.onNodeClick?.(null, n)}
            >
              select {n.id}
            </button>
          ))}
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
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';
import type { PipelineCatalogResponse } from '../../src/api/types.js';

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
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
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
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.getPipelineCatalog).mockResolvedValue(catalogFixture);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
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
});
