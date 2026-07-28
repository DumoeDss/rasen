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
    return (
      <div
        class={`stage-node stage-node--v2${editorSupported ? '' : ' stage-node--unsupported'}${
          issueSeverity ? ` stage-node--issue-${issueSeverity}` : ''
        }`}
        data-testid="stage-node"
        data-stage={id}
        data-definition-kind={definitionKind}
        data-editor-supported={String(editorSupported)}
        data-issue={issueSeverity ?? undefined}
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
        </div>
        {skill && <span class="stage-node__skill">{skill}</span>}
        {!editorSupported && (
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
