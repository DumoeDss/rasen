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
  };
});

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: { nodes: Array<{ id: string }> }) => (
    <div data-testid="mock-reactflow">{props.nodes.map((n) => n.id).join(',')}</div>
  ),
  Background: () => null,
  Controls: () => null,
  ReactFlowProvider: ({ children }: { children: unknown }) => <>{children}</>,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

import { LocationProvider, Router, Route } from 'preact-iso';
import { PipelineCanvasPage } from '../../src/canvas/PipelineCanvasPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';

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
