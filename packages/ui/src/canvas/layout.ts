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
  PipelineCatalogResponse,
  PipelineDetailResponse,
  ThresholdValue,
  WireDefinitionNode,
  WireEffectiveValue,
  WirePipelineDefinition,
} from '../api/types.js';
import {
  CONTROL_TARGET_PORT,
  isV2EditableNodeKind,
} from './draft.js';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 92;

/**
 * An author-dragged placement for a stage node, keyed by node id
 * (canvas-durable-node-positioning design D2). Edit-session state only: the
 * page's cache, never the definition payload.
 */
export type AuthorPosition = { x: number; y: number };

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
  definitionVersion?: 1 | 2;
  definitionKind?: WireDefinitionNode['kind'];
  editorSupported?: boolean;
  inputPorts?: DefinitionHandleDescriptor[];
  outputPorts?: DefinitionHandleDescriptor[];
  /** Set in edit mode from the latest validation response (pipeline-canvas-edit design D5); absent in view mode. */
  issueSeverity?: 'error' | 'warning';
}

export interface DefinitionHandleDescriptor {
  id: string;
  type?: string;
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
  draggable?: boolean;
  connectable?: boolean;
  deletable?: boolean;
}

/**
 * Look up a declaration by id and return its input or output ports as
 * DefinitionHandleDescriptors. CompositeRef and BoundedLoop nodes use this
 * to display their referenced declaration's port contract.
 */
function lookupDeclarationPorts(
  declarations: unknown[] | undefined,
  declarationId: unknown,
  direction: 'input' | 'output'
): DefinitionHandleDescriptor[] {
  if (!declarations || typeof declarationId !== 'string') return [];
  const decl = declarations.find((d) => {
    if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
      return (d as Record<string, unknown>).id === declarationId;
    }
    return false;
  });
  if (!decl || typeof decl !== 'object') return [];
  const declRecord = decl as Record<string, unknown>;
  if (direction === 'input') {
    const inputs = Array.isArray(declRecord.inputs) ? declRecord.inputs : [];
    return inputs
      .filter(
        (p): p is Record<string, unknown> =>
          p !== null && typeof p === 'object' && typeof (p as Record<string, unknown>).name === 'string'
      )
      .map((p) => ({
        id: p.name as string,
        type: typeof p.type === 'string' ? p.type : undefined,
      }));
  }
  const artifacts = Array.isArray(declRecord.artifacts)
    ? declRecord.artifacts
    : [];
  const artifactPorts = artifacts
    .filter(
      (artifact): artifact is Record<string, unknown> =>
        artifact !== null &&
        typeof artifact === 'object' &&
        !Array.isArray(artifact) &&
        typeof (artifact as Record<string, unknown>).name === 'string'
    )
    .map((artifact) => ({
      id: artifact.name as string,
      type:
        typeof artifact.type === 'string' ? artifact.type : undefined,
    }));
  const outcomes = Array.isArray(declRecord.outcomes) ? declRecord.outcomes : [];
  const outcomePorts = outcomes
    .filter((o): o is string => typeof o === 'string')
    .map((o) => ({ id: o, type: `outcome/${o}` }));
  return [...artifactPorts, ...outcomePorts];
}

function v2NodeCardData(
  node: unknown,
  graph: unknown,
  catalog?: PipelineCatalogResponse | null,
  declarations?: unknown[]
): StageCardData {
  const record =
    node !== null && typeof node === 'object' && !Array.isArray(node)
      ? (node as Record<string, unknown>)
      : {};
  const id = typeof record.id === 'string' ? record.id : 'invalid-node';
  const kind = typeof record.kind === 'string' ? record.kind : 'Invalid';
  const capabilityRecord =
    record.capability !== null &&
    typeof record.capability === 'object' &&
    !Array.isArray(record.capability)
      ? (record.capability as Record<string, unknown>)
      : {};
  const capabilityId =
    typeof capabilityRecord.id === 'string' ? capabilityRecord.id : undefined;
  const capabilityVersion =
    typeof capabilityRecord.version === 'string'
      ? capabilityRecord.version
      : undefined;
  const graphRecord =
    graph !== null && typeof graph === 'object' && !Array.isArray(graph)
      ? (graph as Record<string, unknown>)
      : {};
  const connections = Array.isArray(graphRecord.connections)
    ? graphRecord.connections
    : [];
  const capability =
    kind === 'AtomicStage' && capabilityId && capabilityVersion
      ? catalog?.skills
          .map((skill) => skill.capability)
          .find(
            (candidate) =>
              candidate?.id === capabilityId &&
              candidate.version === capabilityVersion
          )
      : undefined;
  const inputPorts: DefinitionHandleDescriptor[] =
    kind === 'AtomicStage'
      ? capability
        ? capability.inputs.length > 0
          ? capability.inputs.map((port) => ({
              id: port.name,
              type: port.type,
            }))
          : [{ id: CONTROL_TARGET_PORT }]
        : []
      : kind === 'Gate' || kind === 'Choice' || kind === 'Finish'
        ? Array.from(
            new Set(
              connections
                .map((connection) =>
                  connection !== null &&
                  typeof connection === 'object' &&
                  !Array.isArray(connection)
                    ? (connection as Record<string, unknown>)
                    : null
                )
                .filter((connection) => {
                  const to = connection?.to;
                  return (
                    to !== null &&
                    typeof to === 'object' &&
                    !Array.isArray(to) &&
                    (to as Record<string, unknown>).node === id
                  );
                })
                .map((connection) => {
                  const to = connection!.to as Record<string, unknown>;
                  return typeof to.port === 'string' ? to.port : '';
                })
                .filter(Boolean)
                .concat('input')
            )
          ).map((id) => ({ id }))
      : kind === 'CompositeRef' || kind === 'BoundedLoop'
          ? lookupDeclarationPorts(
              declarations,
              kind === 'CompositeRef'
                ? record.declarationId
                : record.body,
              'input'
            )
          : kind === 'FanOut'
            ? [{ id: CONTROL_TARGET_PORT }]
            : kind === 'Join' && Array.isArray(record.inputs)
              ? record.inputs
                  .filter((input): input is string => typeof input === 'string')
                  .map((input) => ({ id: input }))
          : [];
  const outputPorts: DefinitionHandleDescriptor[] =
    kind === 'AtomicStage'
      ? [
          ...(capability?.artifacts ?? []).map((artifact) => ({
            id: artifact.name,
            type: artifact.type,
          })),
          ...(capability?.outcomes ?? []).map((outcome) => ({
            id: outcome,
            type: `outcome/${outcome}`,
          })),
        ]
      : kind === 'Gate' || kind === 'Choice'
        ? (Array.isArray(record.outcomes)
            ? record.outcomes.filter(
                (outcome): outcome is string => typeof outcome === 'string'
              )
            : []
          ).map((outcome) => ({
            id: outcome,
            type: `outcome/${outcome}`,
          }))
      : kind === 'CompositeRef' || kind === 'BoundedLoop'
          ? lookupDeclarationPorts(
              declarations,
              kind === 'CompositeRef'
                ? record.declarationId
                : record.body,
              'output'
            )
          : kind === 'FanOut' && Array.isArray(record.branches)
            ? record.branches
                .filter((branch): branch is string => typeof branch === 'string')
                .map((branch) => ({ id: branch, type: `outcome/${branch}` }))
            : kind === 'Join' &&
                record.outcomes !== null &&
                typeof record.outcomes === 'object' &&
                !Array.isArray(record.outcomes)
              ? Array.from(
                  new Set(
                    Object.values(record.outcomes as Record<string, unknown>)
                      .filter((outcome): outcome is string => typeof outcome === 'string')
                  )
                ).map((outcome) => ({
                  id: outcome,
                  type: `outcome/${outcome}`,
                }))
          : [];
  const editorSupported = isV2EditableNodeKind(kind);
  const definitionKind = [
    'AtomicStage',
    'CompositeRef',
    'BoundedLoop',
    'Choice',
    'FanOut',
    'Join',
    'Gate',
    'Finish',
  ].includes(kind)
    ? (kind as WireDefinitionNode['kind'])
    : undefined;
  return {
    id,
    role: null,
    skill: kind === 'AtomicStage' ? capabilityId ?? 'Invalid AtomicStage' : kind,
    effectiveGate: { value: kind === 'Gate', source: 'definition' },
    effectiveModel: { value: null, source: 'definition' },
    effectiveHandoff: { value: 0.5, source: 'default' },
    effectiveRuntime: { value: 'claude', source: 'definition' },
    definitionVersion: 2,
    ...(definitionKind ? { definitionKind } : {}),
    editorSupported,
    inputPorts,
    outputPorts,
  };
}

function v2GraphParts(definition: unknown): {
  graph: Record<string, unknown>;
  nodes: unknown[];
  connections: unknown[];
} {
  const definitionRecord =
    definition !== null &&
    typeof definition === 'object' &&
    !Array.isArray(definition)
      ? (definition as Record<string, unknown>)
      : {};
  const graph =
    definitionRecord.root !== null &&
    typeof definitionRecord.root === 'object' &&
    !Array.isArray(definitionRecord.root)
      ? (definitionRecord.root as Record<string, unknown>)
      : {};
  return {
    graph,
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    connections: Array.isArray(graph.connections)
      ? graph.connections
      : [],
  };
}

function projectedV2Node(
  node: unknown,
  index: number
): { id: string; kind: string; value: unknown } {
  const record =
    node !== null && typeof node === 'object' && !Array.isArray(node)
      ? (node as Record<string, unknown>)
      : {};
  return {
    id:
      typeof record.id === 'string' && record.id.length > 0
        ? record.id
        : `invalid-node-${index}`,
    kind: typeof record.kind === 'string' ? record.kind : 'Invalid',
    value: { ...record, id: typeof record.id === 'string' ? record.id : `invalid-node-${index}` },
  };
}

function projectedV2Connection(
  connection: unknown,
  index: number
): Edge | null {
  if (
    connection === null ||
    typeof connection !== 'object' ||
    Array.isArray(connection)
  ) {
    return null;
  }
  const record = connection as Record<string, unknown>;
  const from =
    record.from !== null &&
    typeof record.from === 'object' &&
    !Array.isArray(record.from)
      ? (record.from as Record<string, unknown>)
      : {};
  const to =
    record.to !== null &&
    typeof record.to === 'object' &&
    !Array.isArray(record.to)
      ? (record.to as Record<string, unknown>)
      : {};
  if (typeof from.node !== 'string' || typeof to.node !== 'string') {
    return null;
  }
  return {
    id:
      typeof record.id === 'string' && record.id.length > 0
        ? record.id
        : `invalid-connection-${index}`,
    source: from.node,
    target: to.node,
    ...(typeof from.port === 'string' ? { sourceHandle: from.port } : {}),
    ...(typeof to.port === 'string' ? { targetHandle: to.port } : {}),
  };
}

function isSafelyEditableV2Node(node: unknown): boolean {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return false;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.kind !== 'string') {
    return false;
  }
  switch (record.kind) {
    case 'AtomicStage': {
      if (
        record.capability === null ||
        typeof record.capability !== 'object' ||
        Array.isArray(record.capability)
      ) {
        return false;
      }
      const capability = record.capability as Record<string, unknown>;
      const execution = record.execution;
      return (
        typeof capability.id === 'string' &&
        typeof capability.version === 'string' &&
        execution !== null &&
        typeof execution === 'object' &&
        !Array.isArray(execution) &&
        (execution as Record<string, unknown>).version === 1
      );
    }
    case 'Gate': {
      const dispositions = record.dispositions;
      return (
        typeof record.target === 'string' &&
        Array.isArray(record.outcomes) &&
        record.outcomes.every((outcome) => typeof outcome === 'string') &&
        dispositions !== null &&
        typeof dispositions === 'object' &&
        !Array.isArray(dispositions)
      );
    }
    case 'Choice':
      return (
        Array.isArray(record.outcomes) &&
        record.outcomes.every((outcome) => typeof outcome === 'string')
      );
    case 'Finish':
      return typeof record.outcome === 'string';
    // CompositeRef and BoundedLoop joined the editable vocabulary in ECP-2
    // (`executable-custom-composite`: reference a declaration from the root
    // graph, and "The Canvas SHALL allow the user to delete a `CompositeRef`
    // node from the root graph"). This predicate is the WELL-FORMEDNESS guard
    // — it must not double as a second vocabulary gate, or a node the editor
    // reports as supported is one React Flow refuses to delete or connect.
    case 'CompositeRef':
      return typeof record.declarationId === 'string';
    case 'BoundedLoop':
      return (
        typeof record.body === 'string' &&
        record.lifecycle !== null &&
        typeof record.lifecycle === 'object' &&
        !Array.isArray(record.lifecycle)
      );
    case 'FanOut':
      return (
        Array.isArray(record.branches) &&
        Array.isArray(record.members) &&
        typeof record.concurrencyCap === 'number' &&
        typeof record.budget === 'number' &&
        typeof record.joinNodeId === 'string'
      );
    case 'Join':
      return (
        Array.isArray(record.inputs) &&
        Array.isArray(record.requiredMembers) &&
        Array.isArray(record.optionalMembers) &&
        record.outcomes !== null &&
        typeof record.outcomes === 'object' &&
        !Array.isArray(record.outcomes)
      );
    // Any kind outside the current closed eight-kind vocabulary stays a
    // preserved read-only card until a later Definition version enables it.
    default:
      return false;
  }
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
  if (detail.definition.version === 2) {
    const definition = detail.definition;
    const { graph, nodes: rawNodes, connections: rawConnections } =
      v2GraphParts(definition);
    return {
      nodes: rawNodes.map((node, index) => {
        const projected = projectedV2Node(node, index);
        return {
        id: projected.id,
        data: v2NodeCardData(projected.value, graph, undefined, definition.declarations),
        draggable: false,
        connectable: false,
        deletable: false,
      };
      }),
      edges: rawConnections
        .map(projectedV2Connection)
        .filter((edge): edge is Edge => edge !== null),
    };
  }

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
export function draftToGraph(
  def: WirePipelineDefinition,
  catalog?: PipelineCatalogResponse | null
): { nodes: UnpositionedStage[]; edges: Edge[] } {
  if (def.version === 2) {
    const { graph, nodes: rawNodes, connections: rawConnections } =
      v2GraphParts(def);
    return {
      nodes: rawNodes.map((node, index) => {
        const projected = projectedV2Node(node, index);
        const safelyEditable = isSafelyEditableV2Node(projected.value);
        const pairedStructuralNode =
          projected.kind === 'FanOut' || projected.kind === 'Join';
        return {
        id: projected.id,
        data: {
          ...v2NodeCardData(projected.value, graph, catalog, (def as { declarations?: unknown[] }).declarations),
          effectiveGate: {
            value: projected.kind === 'Gate',
            source: 'draft',
          },
          effectiveModel: { value: null, source: 'draft' },
          effectiveHandoff: { value: 0.5, source: 'draft' },
          effectiveRuntime: { value: 'claude', source: 'draft' },
        },
        draggable: safelyEditable,
        connectable: safelyEditable,
        deletable: safelyEditable && !pairedStructuralNode,
      };
      }),
      edges: rawConnections
        .map(projectedV2Connection)
        .filter((edge): edge is Edge => edge !== null),
    };
  }
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
 *
 * `authorPositions` (canvas-durable-node-positioning design D2), when given,
 * overrides the dagre position of a stage node whose id has a cached
 * placement — the author's drag survives the rebuild. Optional so view-mode
 * callers (no cache) are unchanged.
 */
export function layoutGraph(
  nodes: UnpositionedStage[],
  edges: Edge[],
  authorPositions?: ReadonlyMap<string, AuthorPosition>
): PipelineFlowNode[] {
  const hasGroups = nodes.some((node) => node.parallelGroup !== undefined);

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: hasGroups ? RANK_SEP_GROUPED : RANK_SEP_UNGROUPED });
  nodes.forEach((node) => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  dagre.layout(g);

  const absolute = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    // Author placement (canvas-durable-node-positioning design D2): a stage
    // node whose id has a cached position renders where the author dragged
    // it, replacing the dagre position; absent ids change nothing. Group
    // members are skipped — their rendered position is RELATIVE to the
    // group's box (a different coordinate contract), and the cache is only
    // ever populated for v2 sessions, which have no groups.
    const cached =
      node.parallelGroup === undefined
        ? authorPositions?.get(node.id)
        : undefined;
    return {
      ...node,
      absPosition: cached ?? { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
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
      draggable: node.draggable ?? false,
      connectable: node.connectable ?? false,
      deletable: node.deletable,
    };
    if (node.parallelGroup) {
      stageNode.parentId = `group:${node.parallelGroup}`;
      stageNode.extent = 'parent';
    }
    return stageNode;
  });

  return [...groupNodes, ...stageNodes];
}

/**
 * Rebuilds a placement cache keyed to exactly the given stage-node ids
 * (canvas-durable-node-positioning design D3): entries whose owner left the
 * root graph are dropped, so a node later re-added under the same id lays
 * out afresh instead of resurrecting a departed placement. Pure — returns a
 * new Map, never mutates the input.
 */
export function pruneAuthorPositions(
  positions: ReadonlyMap<string, AuthorPosition>,
  presentStageIds: Iterable<string>
): Map<string, AuthorPosition> {
  const pruned = new Map<string, AuthorPosition>();
  for (const id of presentStageIds) {
    const cached = positions.get(id);
    if (cached) pruned.set(id, cached);
  }
  return pruned;
}
