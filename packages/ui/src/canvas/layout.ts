/**
 * Pure layout functions for the pipeline graph view (pipeline-canvas-view
 * design D3/D5). No JSX here — kept free of React Flow's rendering so the
 * regression-prone logic (edge derivation, dagre ordering, group bounding
 * boxes) is unit-testable under plain Node/Vitest, no jsdom canvas mount
 * required.
 */
import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import type {
  PipelineDetailResponse,
  ThresholdValue,
  WireEffectiveValue,
  WirePipelineDefinition,
} from '../api/types.js';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 92;

const GROUP_PADDING = 24;
const GROUP_LABEL_HEIGHT = 28;
/** Rank separation grows when groups exist so a group box has room to breathe between ranks. */
const RANK_SEP_UNGROUPED = 90;
const RANK_SEP_GROUPED = 140;

/** The joined per-stage data a `StageNode` card renders — declared identity plus effective (resolved) values. */
export interface StageCardData extends Record<string, unknown> {
  id: string;
  role: string | null;
  skill: string | null;
  effectiveGate: WireEffectiveValue<boolean>;
  effectiveModel: WireEffectiveValue<string | null>;
  effectiveHandoff: WireEffectiveValue<ThresholdValue>;
  effectiveRuntime: WireEffectiveValue<'claude' | 'codex'>;
  /** Set in edit mode from the latest validation response (pipeline-canvas-edit design D5); absent in view mode. */
  issueSeverity?: 'error' | 'warning';
}

/** Data for a `parallelGroup` container node. */
export interface GroupCardData extends Record<string, unknown> {
  label: string;
}

export type StageFlowNode = Node<StageCardData, 'stage'>;
export type GroupFlowNode = Node<GroupCardData, 'group'>;
export type PipelineFlowNode = StageFlowNode | GroupFlowNode;

/** An unpositioned stage, still carrying its `parallelGroup` membership for the layout pass. */
export interface UnpositionedStage {
  id: string;
  parallelGroup?: string;
  data: StageCardData;
}

/**
 * Derives the graph's nodes and edges from a pipeline detail response. Edges
 * come ONLY from the definition's `requires` (the resolved `pipeline.stages`
 * view carries no dependency information); per-stage effective badges are
 * joined from `pipeline.stages` by stage id. A definition stage with no
 * resolved counterpart (should not happen for a consistent detail response)
 * falls back to its own declared values so a badge is still renderable.
 */
export function definitionToGraph(
  detail: PipelineDetailResponse
): { nodes: UnpositionedStage[]; edges: Edge[] } {
  const resolvedById = new Map(detail.pipeline.stages.map((stage) => [stage.id, stage]));

  const nodes: UnpositionedStage[] = detail.definition.stages.map((stage) => {
    const resolved = resolvedById.get(stage.id);
    const data: StageCardData = {
      id: stage.id,
      role: resolved?.role ?? stage.role ?? null,
      skill: resolved?.skill ?? stage.skill ?? null,
      effectiveGate: resolved?.effectiveGate ?? { value: stage.gate, source: 'definition' },
      effectiveModel: resolved?.effectiveModel ?? { value: stage.model ?? null, source: 'definition' },
      effectiveHandoff: resolved?.effectiveHandoff ?? { value: 0.5, source: 'default' },
      effectiveRuntime: resolved?.effectiveRuntime ?? { value: stage.runtime ?? 'claude', source: 'definition' },
    };
    return { id: stage.id, parallelGroup: stage.parallelGroup, data };
  });

  const edges: Edge[] = detail.definition.stages.flatMap((stage) =>
    stage.requires.map((requiredId) => ({
      id: `${requiredId}->${stage.id}`,
      source: requiredId,
      target: stage.id,
    }))
  );

  return { nodes, edges };
}

/**
 * Derives the graph's nodes and edges from a DRAFT definition alone (no
 * resolved `pipeline.stages` view exists for an unsaved draft) — the canvas
 * editor's data source (pipeline-canvas-edit). Declared values stand in for
 * "effective" values with `source: 'draft'`, since there is nothing to
 * resolve yet; the properties panel is where these fields are actually
 * edited, this is only the card's at-a-glance badge data.
 */
export function draftToGraph(def: WirePipelineDefinition): { nodes: UnpositionedStage[]; edges: Edge[] } {
  const nodes: UnpositionedStage[] = def.stages.map((stage) => {
    const data: StageCardData = {
      id: stage.id,
      role: stage.role ?? null,
      skill: stage.skill ?? null,
      effectiveGate: { value: stage.gate, source: 'draft' },
      effectiveModel: { value: stage.model ?? null, source: 'draft' },
      effectiveHandoff: { value: stage.handoff?.threshold ?? 0.5, source: 'draft' },
      effectiveRuntime: { value: stage.runtime ?? 'claude', source: 'draft' },
    };
    return { id: stage.id, parallelGroup: stage.parallelGroup, data };
  });

  const edges: Edge[] = def.stages.flatMap((stage) =>
    stage.requires.map((requiredId) => ({
      id: `${requiredId}->${stage.id}`,
      source: requiredId,
      target: stage.id,
    }))
  );

  return { nodes, edges };
}

/**
 * Lays the graph out left-to-right with dagre, then wraps each distinct
 * `parallelGroup` in a React Flow group (subflow) node sized to its members'
 * post-layout bounding box (+padding, +label strip). Member nodes get
 * `parentId`/`extent: 'parent'` and positions RELATIVE to their group's
 * top-left corner (React Flow's contract for child-of-group positioning).
 * Group nodes are returned before their members — required order for React
 * Flow to resolve `parentId` on first render.
 */
export function layoutGraph(nodes: UnpositionedStage[], edges: Edge[]): PipelineFlowNode[] {
  const hasGroups = nodes.some((node) => node.parallelGroup !== undefined);

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: hasGroups ? RANK_SEP_GROUPED : RANK_SEP_UNGROUPED });
  nodes.forEach((node) => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  dagre.layout(g);

  const absolute = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return {
      ...node,
      absPosition: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
    };
  });

  const groupMembers = new Map<string, typeof absolute>();
  for (const node of absolute) {
    if (!node.parallelGroup) continue;
    const members = groupMembers.get(node.parallelGroup) ?? [];
    members.push(node);
    groupMembers.set(node.parallelGroup, members);
  }

  const groupNodes: GroupFlowNode[] = [];
  const groupBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const [name, members] of groupMembers) {
    const minX = Math.min(...members.map((m) => m.absPosition.x));
    const minY = Math.min(...members.map((m) => m.absPosition.y));
    const maxX = Math.max(...members.map((m) => m.absPosition.x + NODE_WIDTH));
    const maxY = Math.max(...members.map((m) => m.absPosition.y + NODE_HEIGHT));
    const box = {
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING - GROUP_LABEL_HEIGHT,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_HEIGHT,
    };
    groupBoxes.set(name, box);
    groupNodes.push({
      id: `group:${name}`,
      type: 'group',
      position: { x: box.x, y: box.y },
      style: { width: box.width, height: box.height },
      data: { label: name },
      selectable: false,
      draggable: false,
    });
  }

  const stageNodes: StageFlowNode[] = absolute.map((node) => {
    const box = node.parallelGroup ? groupBoxes.get(node.parallelGroup) : undefined;
    const position = box
      ? { x: node.absPosition.x - box.x, y: node.absPosition.y - box.y }
      : node.absPosition;
    const stageNode: StageFlowNode = {
      id: node.id,
      type: 'stage',
      position,
      data: node.data,
      draggable: false,
      connectable: false,
    };
    if (node.parallelGroup) {
      stageNode.parentId = `group:${node.parallelGroup}`;
      stageNode.extent = 'parent';
    }
    return stageNode;
  });

  return [...groupNodes, ...stageNodes];
}
