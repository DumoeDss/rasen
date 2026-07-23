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

export function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { id, role, skill, effectiveGate, effectiveModel, effectiveHandoff, effectiveRuntime, issueSeverity } = data;

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
