import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GroupFlowNode, StageFlowNode } from './layout.js';

/**
 * Custom stage card (pipeline-canvas-view design D3): id, role badge (the
 * Pipelines page's existing pill language — `.pipeline-lane__stage-role`),
 * skill, and the effective gate state at a glance; a tooltip/detail row below
 * carries effective model, handoff, and runtime with their resolution source,
 * so nothing requires leaving the view. Handles are visual only (read-only
 * canvas — `nodesConnectable={false}` on the flow itself already blocks
 * connecting).
 */
function formatHandoff(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'remainingTokens' in value) {
    return `${(value as { remainingTokens: number }).remainingTokens} tokens`;
  }
  return String(value);
}

/**
 * The expand/collapse chevron (canvas-loop-body-visibility design D2): a
 * plain DOM button riding the card. `nodrag` keeps the press from starting a
 * node drag (React Flow ignores pointerdown on `.nodrag` elements), and the
 * stopped click never reaches React Flow's node wrapper — the toggle reaches
 * the page handler directly, with no selection side effect.
 */
function FrameToggle({
  frameId,
  expanded,
  onToggle,
}: {
  frameId: string;
  expanded: boolean;
  onToggle?: (frameId: string) => void;
}) {
  return (
    <button
      type="button"
      class="stage-node__frame-toggle nodrag"
      data-testid="stage-node-frame-toggle"
      data-frame-id={frameId}
      data-expanded={String(expanded)}
      aria-label={expanded ? `Collapse ${frameId}` : `Expand ${frameId}`}
      title={expanded ? `Collapse ${frameId}` : `Expand ${frameId}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.(frameId);
      }}
    >
      {expanded ? '▾' : '▸'}
    </button>
  );
}

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const {
    id,
    role,
    skill,
    effectiveGate,
    effectiveModel,
    effectiveHandoff,
    effectiveRuntime,
    issueSeverity,
    definitionVersion,
    definitionKind,
    editorSupported,
    inputPorts = [],
    outputPorts = [],
  } = data;

  if (definitionVersion === 2 && definitionKind) {
    // The expanded frame variant (canvas-loop-body-visibility design D1): the
    // node's own identity and EXTERNAL handles stay, the body renders inside
    // as child flow nodes — this card draws the container chrome (header
    // strip + tinted body region) and fills the wrapper's explicit size.
    if (data.frameToggle?.expanded) {
      return (
        <div
          class="stage-node stage-node--v2 stage-node--frame"
          data-testid="stage-node"
          data-stage={id}
          data-definition-kind={definitionKind}
          data-editor-supported={String(editorSupported)}
          data-frame="expanded"
        >
          {inputPorts.map((port, index) => (
            <Handle
              key={`input:${port.id}`}
              id={port.id}
              type="target"
              position={Position.Left}
              class="stage-node__handle"
              style={{ top: `${((index + 1) / (inputPorts.length + 1)) * 100}%` }}
            />
          ))}
          <div class="stage-node__frame-header">
            <span class="stage-node__id">{id}</span>
            <span class="stage-node__kind" data-testid="stage-node-kind">
              {definitionKind}
            </span>
            <FrameToggle
              frameId={id}
              expanded
              onToggle={data.frameToggle.onToggleExpand}
            />
          </div>
          <div class="stage-node__frame-body" data-testid="stage-node-frame-body" />
          {outputPorts.map((port, index) => (
            <Handle
              key={`output:${port.id}`}
              id={port.id}
              type="source"
              position={Position.Right}
              class="stage-node__handle"
              style={{ top: `${((index + 1) / (outputPorts.length + 1)) * 100}%` }}
            />
          ))}
        </div>
      );
    }

    return (
      <div
        class={`stage-node stage-node--v2${editorSupported ? '' : ' stage-node--unsupported'}${
          issueSeverity ? ` stage-node--issue-${issueSeverity}` : ''
        }${data.bodyStage ? ' stage-node--body nodrag' : ''}`}
        data-testid="stage-node"
        data-stage={id}
        data-definition-kind={definitionKind}
        data-editor-supported={String(editorSupported)}
        data-issue={issueSeverity ?? undefined}
        data-frame-id={data.bodyStage?.frameId}
        // A body-stage card's click opens the read-only body panel: the click
        // STOPS here (React Flow's wrapper would otherwise select the frame),
        // and `nodrag` above keeps any press from dragging anything — the
        // drag-state guard (design D3).
        onClick={
          data.bodyStage
            ? (event) => {
                event.stopPropagation();
                data.bodyStage!.onSelectBody?.();
              }
            : undefined
        }
      >
        {inputPorts.map((port, index) => (
          <Handle
            key={`input:${port.id}`}
            id={port.id}
            type="target"
            position={Position.Left}
            class="stage-node__handle"
            style={{ top: `${((index + 1) / (inputPorts.length + 1)) * 100}%` }}
          />
        ))}
        {issueSeverity && (
          <span
            class={`stage-node__issue-badge stage-node__issue-badge--${issueSeverity}`}
            data-testid="stage-node-issue-badge"
          >
            {issueSeverity === 'error' ? '!' : 'warning'}
          </span>
        )}
        <div class="stage-node__header">
          <span class="stage-node__id">{id}</span>
          <span class="stage-node__kind" data-testid="stage-node-kind">
            {definitionKind}
          </span>
          {data.frameToggle && (
            <FrameToggle
              frameId={id}
              expanded={false}
              onToggle={data.frameToggle.onToggleExpand}
            />
          )}
        </div>
        {skill && <span class="stage-node__skill">{skill}</span>}
        {definitionKind === 'BoundedLoop' && (
          <span
            class="stage-node__badge stage-node__badge--review-cycle"
            data-testid="stage-node-badge-review-cycle"
          >
            Review Cycle
          </span>
        )}
        {definitionKind === 'CompositeRef' && (
          <span
            class="stage-node__badge stage-node__badge--composite"
            data-testid="stage-node-badge-composite"
          >
            Composite
          </span>
        )}
        {definitionKind === 'FanOut' && (
          <span
            class="stage-node__badge stage-node__badge--fanout"
            data-testid="stage-node-badge-fanout"
          >
            Parallel
          </span>
        )}
        {definitionKind === 'Join' && (
          <span
            class="stage-node__badge stage-node__badge--join"
            data-testid="stage-node-badge-join"
          >
            Barrier
          </span>
        )}
        {definitionKind === 'Choice' && !editorSupported && (
          <span
            class="stage-node__badge stage-node__badge--choice"
            data-testid="stage-node-badge-choice"
          >
            Conditional
          </span>
        )}
        {!editorSupported && definitionKind !== 'BoundedLoop' && (
          <span class="stage-node__unsupported" data-testid="stage-node-unsupported">
            Preserved · editing arrives in a later slice
          </span>
        )}
        <div class="stage-node__ports" data-testid="stage-node-ports">
          {inputPorts.length > 0 && (
            <span>in: {inputPorts.map((port) => port.id).join(', ')}</span>
          )}
          {outputPorts.length > 0 && (
            <span>out: {outputPorts.map((port) => port.id).join(', ')}</span>
          )}
        </div>
        {outputPorts.map((port, index) => (
          <Handle
            key={`output:${port.id}`}
            id={port.id}
            type="source"
            position={Position.Right}
            class="stage-node__handle"
            style={{ top: `${((index + 1) / (outputPorts.length + 1)) * 100}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      class={`stage-node${issueSeverity ? ` stage-node--issue-${issueSeverity}` : ''}`}
      data-testid="stage-node"
      data-stage={id}
      data-issue={issueSeverity ?? undefined}
    >
      <Handle type="target" position={Position.Left} class="stage-node__handle" />
      {issueSeverity && (
        <span
          class={`stage-node__issue-badge stage-node__issue-badge--${issueSeverity}`}
          data-testid="stage-node-issue-badge"
          title={issueSeverity === 'error' ? 'Validation error' : 'Validation warning'}
        >
          {issueSeverity === 'error' ? '!' : '△'}
        </span>
      )}
      <div class="stage-node__header">
        <span class="stage-node__id">{id}</span>
        <span
          class={`stage-node__gate${effectiveGate.value ? ' stage-node__gate--on' : ''}`}
          title={`Effective gate: ${effectiveGate.value ? 'pauses' : 'auto-approves'} (${effectiveGate.source})`}
          data-testid="stage-node-gate"
        >
          {effectiveGate.value ? '⏸' : '▶'}
        </span>
      </div>
      {role && (
        <span class="pipeline-lane__stage-role stage-node__role" data-testid="stage-node-role">
          {role}
        </span>
      )}
      {skill && <span class="stage-node__skill">{skill}</span>}
      <div class="stage-node__detail" data-testid="stage-node-detail">
        <span title={`Source: ${effectiveModel.source}`}>model: {effectiveModel.value ?? '—'}</span>
        <span title={`Source: ${effectiveHandoff.source}`}>handoff: {formatHandoff(effectiveHandoff.value)}</span>
        <span title={`Source: ${effectiveRuntime.source}`}>runtime: {effectiveRuntime.value}</span>
      </div>
      <Handle type="source" position={Position.Right} class="stage-node__handle" />
    </div>
  );
}

/** A `parallelGroup` container: label strip at top, transparent otherwise. */
export function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div class="stage-group" data-testid="stage-group" data-group={data.label}>
      <span class="stage-group__label">{data.label}</span>
    </div>
  );
}

export const stageNodeTypes = { stage: StageNode, group: GroupNode };
