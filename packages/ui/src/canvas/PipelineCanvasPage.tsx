import { useEffect, useMemo, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { ReactFlow, Background, Controls, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { PipelineDetailResponse } from '../api/types.js';
import { useSpace, spaceHref } from '../store/use-space.js';
import { definitionToGraph, layoutGraph } from './layout.js';
import { stageNodeTypes } from './StageNode.js';

/**
 * The pipeline graph route (`/p/:projectId/pipelines/:name`,
 * `/s/:storeId/pipelines/:name` — pipeline-canvas-view design D1). Fetches the
 * addressed space's pipeline detail, lays it out with `layoutGraph`, and
 * renders it read-only: `fitView` on load, zoom/pan, `Controls`, a dot-grid
 * `Background`; nodes are neither draggable nor connectable, selection is
 * allowed (highlight only, no side panel yet — child 4). This page and its
 * `@xyflow/react`/`dagre` dependencies live behind a lazy route (`app.tsx`) so
 * the canvas chunk never loads for a user who never opens a graph.
 */
export function PipelineCanvasPage() {
  const space = useSpace();
  const selector = space?.selector;
  const { params } = useRoute();
  const name = params.name ?? '';

  const [detail, setDetail] = useState<PipelineDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);

  useEffect(() => {
    if (!selector || !name) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setPageError(null);
    client
      .getPipelineDetail(name, selector)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.code === 'not_found' || err.status === 404)) {
          setNotFound(true);
        } else if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load the pipeline.' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, selector]);

  const flowNodes = useMemo(() => {
    if (!detail) return null;
    const { nodes, edges } = definitionToGraph(detail);
    return { nodes: layoutGraph(nodes, edges), edges };
  }, [detail]);

  const backHref = space ? spaceHref(space, 'pipelines') : '/';

  if (!selector) {
    return (
      <p class="pipeline-canvas__no-space" data-testid="pipeline-canvas-no-space">
        Pick a planning space to view a pipeline graph.
      </p>
    );
  }

  if (loading) {
    return <p class="pipeline-canvas__loading" data-testid="pipeline-canvas-loading">Loading pipeline…</p>;
  }

  if (notFound) {
    return (
      <div class="pipeline-canvas__not-found" data-testid="pipeline-canvas-not-found">
        <h2>Pipeline not found</h2>
        <p>
          No pipeline named <code>{name}</code> in this space.
        </p>
        <a href={backHref}>← Back to Pipelines</a>
      </div>
    );
  }

  if (pageError || !detail || !flowNodes) {
    return (
      <div class="pipeline-canvas__error" data-testid="pipeline-canvas-error">
        <p>
          {pageError?.message ?? 'Failed to load the pipeline.'}
          {pageError?.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <a href={backHref}>← Back to Pipelines</a>
      </div>
    );
  }

  return (
    <div class="pipeline-canvas" data-testid="pipeline-canvas-page">
      <div class="pipeline-canvas__header">
        <a class="pipeline-canvas__back" href={backHref}>
          ← Pipelines
        </a>
        <h2 class="pipeline-canvas__name">{detail.pipeline.name}</h2>
        <span
          class={`pipeline-section__provenance pipeline-section__provenance--${detail.pipeline.provenance}`}
          data-testid="pipeline-canvas-provenance"
        >
          {detail.pipeline.provenance}
        </span>
        {!detail.editable && (
          <span class="pipeline-canvas__readonly" data-testid="pipeline-canvas-readonly-notice">
            Built-in — read-only
          </span>
        )}
      </div>
      <div class="pipeline-canvas__flow" data-testid="pipeline-canvas-flow">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes.nodes}
            edges={flowNodes.edges}
            nodeTypes={stageNodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
