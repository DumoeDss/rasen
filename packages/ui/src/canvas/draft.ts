/**
 * Pure draft-mutation functions for the pipeline canvas editor
 * (pipeline-canvas-edit design D2). The draft is a `WirePipelineDefinition`
 * value — NOT React Flow nodes/edges — the single source of truth; the canvas
 * derives nodes/edges from it per render via `layout.ts`. Kept free of React
 * Flow and DOM so cycle logic and field-preservation are unit-testable
 * without a canvas mount, the same reasoning that made `layout.ts` pure.
 */
import type {
  ThresholdValue,
  WireCompositeDeclaration,
  WireDefinitionConnection,
  WireDefinitionNode,
  WirePipelineDefinition,
  WirePipelineDefinitionV1,
  WirePipelineDefinitionV2,
  WirePipelineDefinitionStage,
} from '../api/types.js';

export function isV1Definition(
  def: WirePipelineDefinition
): def is WirePipelineDefinitionV1 {
  return def.version === 1;
}

export function isV2Definition(
  def: WirePipelineDefinition
): def is WirePipelineDefinitionV2 {
  return def.version === 2;
}

/**
 * Appends a stage to the draft. Callers assemble the full stage object
 * (typically via `stageIdFor` for the id and the catalog's `gate.default` for
 * the initial gate) — this function performs no defaulting of its own so it
 * stays a pure append.
 */
export function addStage<T extends WirePipelineDefinition>(
  def: T,
  stage: WirePipelineDefinitionStage
): T {
  if (!isV1Definition(def)) return def;
  return { ...def, stages: [...def.stages, stage] } as T;
}

/**
 * Removes a stage and drops every `requires` reference to it from every
 * other stage — no dangling edge survives a deletion.
 */
export function removeStage<T extends WirePipelineDefinition>(def: T, id: string): T {
  if (!isV1Definition(def)) return def;
  return {
    ...def,
    stages: def.stages
      .filter((stage) => stage.id !== id)
      .map((stage) =>
        stage.requires.includes(id)
          ? { ...stage, requires: stage.requires.filter((r) => r !== id) }
          : stage
      ),
  };
}

/** Adds a `from -> to` dependency (i.e. `to` now requires `from`), if not already present. */
export function addRequire<T extends WirePipelineDefinition>(
  def: T,
  from: string,
  to: string
): T {
  if (!isV1Definition(def)) return def;
  return {
    ...def,
    stages: def.stages.map((stage) =>
      stage.id === to && !stage.requires.includes(from)
        ? { ...stage, requires: [...stage.requires, from] }
        : stage
    ),
  };
}

/** Removes a `from -> to` dependency. */
export function removeRequire<T extends WirePipelineDefinition>(
  def: T,
  from: string,
  to: string
): T {
  if (!isV1Definition(def)) return def;
  return {
    ...def,
    stages: def.stages.map((stage) =>
      stage.id === to ? { ...stage, requires: stage.requires.filter((r) => r !== from) } : stage
    ),
  } as T;
}

/**
 * Patches a stage's fields with a spread — every field the patch does not
 * name is preserved verbatim, including fields the properties panel never
 * exposes (goal-loop gates, runtime session settings, etc).
 */
export function updateStageFields<T extends WirePipelineDefinition>(
  def: T,
  id: string,
  patch: Partial<WirePipelineDefinitionStage>
): T {
  if (!isV1Definition(def)) return def;
  return {
    ...def,
    stages: def.stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)),
  } as T;
}

/**
 * Sets or clears one stage's nested handoff threshold without replacing the
 * rest of its handoff block. Canvas intentionally does not expose relay/stall
 * limits, so those fields (and any future loader field) must survive threshold
 * edits verbatim. Clearing omits `handoff` only when no defined field remains.
 */
export function updateStageHandoffThreshold<T extends WirePipelineDefinition>(
  def: T,
  id: string,
  threshold: ThresholdValue | undefined
): T {
  if (!isV1Definition(def)) return def;
  return {
    ...def,
    stages: def.stages.map((stage) => {
      if (stage.id !== id) return stage;
      const handoff = { ...(stage.handoff ?? {}) };
      if (threshold !== undefined) {
        handoff.threshold = threshold;
        return { ...stage, handoff };
      }

      delete handoff.threshold;
      const hasDefinedField = Object.values(handoff).some((value) => value !== undefined);
      if (hasDefinedField) return { ...stage, handoff };

      const next = { ...stage };
      delete next.handoff;
      return next;
    }),
  } as T;
}

/** Renames a stage id and rewrites every `requires` reference to it. */
export function renameStage<T extends WirePipelineDefinition>(
  def: T,
  oldId: string,
  newId: string
): T {
  if (!isV1Definition(def)) return def;
  return {
    ...def,
    stages: def.stages.map((stage) => {
      const requires = stage.requires.map((r) => (r === oldId ? newId : r));
      return stage.id === oldId ? { ...stage, id: newId, requires } : { ...stage, requires };
    }),
  } as T;
}

/** Forward adjacency over `requires`: node -> the stages that require it. */
function buildAdjacency(def: WirePipelineDefinition): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  if (isV1Definition(def)) {
    for (const stage of def.stages) {
      for (const req of stage.requires) {
        const arr = adjacency.get(req) ?? [];
        arr.push(stage.id);
        adjacency.set(req, arr);
      }
    }
  } else {
    for (const connection of def.root.connections) {
      const arr = adjacency.get(connection.from.node) ?? [];
      arr.push(connection.to.node);
      adjacency.set(connection.from.node, arr);
    }
  }
  return adjacency;
}

/**
 * Whether connecting `from -> to` (i.e. `to` requiring `from`) would close a
 * dependency cycle, checked by reachability: if `to` can already reach `from`
 * via existing `requires` edges, adding the new edge closes a loop. Same
 * algorithm as the React Flow demo (`rasen/office-hours/canvas-demos/
 * react-flow/src/App.jsx`) parameterized over the draft's `requires` graph
 * instead of raw edges. A convenience client-side fast-path only — the
 * server's dry-run validation remains authoritative.
 */
export function wouldCreateCycle(def: WirePipelineDefinition, from: string, to: string): boolean {
  if (from === to) return true;
  const adjacency = buildAdjacency(def);
  const stack: string[] = [to];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === from) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    stack.push(...(adjacency.get(node) ?? []));
  }
  return false;
}

/**
 * Generates a stage id from a skill id (lowercased, non-id characters
 * collapsed to `-`), uniquified against the draft's existing stage ids with a
 * numeric suffix. Panel-editable afterward via `renameStage`.
 */
export function stageIdFor(skill: string, def: WirePipelineDefinition): string {
  const base = skill.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
  const existing = new Set(
    isV1Definition(def)
      ? def.stages.map((stage) => stage.id)
      : def.root.nodes.map((node) => node.id)
  );
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Patches one enabled v2 root node while preserving the complete authored
 * Definition value, including declarations and fields this UI does not expose.
 */
export function updateV2NodeFields(
  def: WirePipelineDefinitionV2,
  id: string,
  patch: Partial<WireDefinitionNode>
): WirePipelineDefinitionV2 {
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.map((node) =>
        node.id === id ? ({ ...node, ...patch } as WireDefinitionNode) : node
      ),
    },
  };
}

export type V2EditableNodeKind = 'AtomicStage' | 'Gate' | 'Choice' | 'Finish' | 'CompositeRef' | 'BoundedLoop';

const V2_EDITABLE_NODE_KINDS = new Set<WireDefinitionNode['kind']>([
  'AtomicStage',
  'Gate',
  'Choice',
  'Finish',
  'CompositeRef',
  'BoundedLoop',
]);

/** The deliberately bounded v2 vocabulary this Canvas slice may mutate. */
export function isV2EditableNodeKind(
  kind: WireDefinitionNode['kind'] | string
): kind is V2EditableNodeKind {
  return V2_EDITABLE_NODE_KINDS.has(kind as WireDefinitionNode['kind']);
}

/**
 * The kinds the ROOT palette offers — the editable vocabulary, in display
 * order. FanOut/Join are absent: ECP-4 promises display and legality feedback
 * for them, not root authoring.
 */
export const V2_ROOT_PALETTE_KINDS: readonly V2EditableNodeKind[] = [
  'AtomicStage',
  'Gate',
  'Choice',
  'Finish',
  'CompositeRef',
  'BoundedLoop',
];

/**
 * The kinds a DECLARATION BODY palette offers (ECP-2 task 8.6): `AtomicStage`
 * only — "`CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, and `Join` SHALL
 * NOT be available in the body palette" (`executable-custom-composite`,
 * "Requirement: Canvas edits composite body stages"). `addBodyStage` enforces
 * the same rule structurally by only ever writing an `AtomicStage`.
 *
 * Both palette vocabularies live HERE, beside `V2_EDITABLE_NODE_KINDS`, so
 * "which kinds may appear where" has one home. This portfolio has already paid
 * for four independent encodings of that question drifting apart.
 */
export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];

/**
 * The declaration a root-level `CompositeRef` may reference, if any: a custom
 * declaration, or a built-in one that actually carries a body graph.
 *
 * Exported so the palette's availability and the insertion itself read the SAME
 * rule — a palette that decided this for itself would be a second
 * implementation of "can a CompositeRef be inserted right now", and the two
 * would drift.
 */
export function referenceableDeclaration(
  def: WirePipelineDefinitionV2
): WireCompositeDeclaration | undefined {
  return (def.declarations ?? []).find(
    (declaration) =>
      declaration.provenance !== 'built-in' || declaration.graph.nodes.length > 0
  );
}

/**
 * The declaration a root-level `BoundedLoop` may use as its body, if any. A
 * loop needs a real body graph, so an empty declaration does not qualify.
 */
export function loopBodyDeclaration(
  def: WirePipelineDefinitionV2
): WireCompositeDeclaration | undefined {
  return (def.declarations ?? []).find(
    (declaration) => declaration.graph.nodes.length > 0
  );
}

/** Appends one authored v2 root node without touching declarations or graph extensions. */
export function addV2Node(
  def: WirePipelineDefinitionV2,
  node: WireDefinitionNode
): WirePipelineDefinitionV2 {
  return {
    ...def,
    root: {
      ...def.root,
      nodes: [...def.root.nodes, node],
    },
  };
}

/** Removes a v2 root node and every incident connection. */
export function removeV2Node(
  def: WirePipelineDefinitionV2,
  id: string
): WirePipelineDefinitionV2 {
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.filter((node) => node.id !== id),
      connections: def.root.connections.filter(
        (connection) =>
          connection.from.node !== id && connection.to.node !== id
      ),
    },
  };
}

/** Renames a v2 root node and rewrites both typed connection endpoints. */
export function renameV2Node(
  def: WirePipelineDefinitionV2,
  oldId: string,
  newId: string
): WirePipelineDefinitionV2 {
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.map((node) =>
        node.id === oldId
          ? ({ ...node, id: newId } as WireDefinitionNode)
          : node
      ),
      connections: def.root.connections.map((connection) => ({
        ...connection,
        from:
          connection.from.node === oldId
            ? { ...connection.from, node: newId }
            : connection.from,
        to:
          connection.to.node === oldId
            ? { ...connection.to, node: newId }
            : connection.to,
      })),
    },
  };
}

/** Appends a typed v2 connection unless its stable identity already exists. */
export function addV2Connection(
  def: WirePipelineDefinitionV2,
  connection: WireDefinitionConnection
): WirePipelineDefinitionV2 {
  if (
    def.root.connections.some(
      (candidate) => candidate.id === connection.id
    )
  ) {
    return def;
  }
  return {
    ...def,
    root: {
      ...def.root,
      connections: [...def.root.connections, connection],
    },
  };
}

/** Removes one v2 root connection by its authored stable identity. */
export function removeV2Connection(
  def: WirePipelineDefinitionV2,
  id: string
): WirePipelineDefinitionV2 {
  return {
    ...def,
    root: {
      ...def.root,
      connections: def.root.connections.filter(
        (connection) => connection.id !== id
      ),
    },
  };
}

const V2_NODE_ID_BASE: Record<V2EditableNodeKind, string> = {
  AtomicStage: 'atomic-stage',
  Gate: 'gate',
  Choice: 'choice',
  Finish: 'finish',
  CompositeRef: 'composite-ref',
  BoundedLoop: 'bounded-loop',
};

/** Generates a stable, human-readable, graph-local identity for a new v2 node. */
export function v2NodeIdFor(
  kind: V2EditableNodeKind,
  def: WirePipelineDefinitionV2
): string {
  const base = V2_NODE_ID_BASE[kind];
  const existing = new Set(def.root.nodes.map((node) => node.id));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export interface V2ConnectionEndpoints {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

/** Generates a stable connection identity from both typed endpoints. */
export function v2ConnectionIdFor(
  def: WirePipelineDefinitionV2,
  endpoints: V2ConnectionEndpoints
): string {
  const base =
    `${endpoints.source}:${endpoints.sourcePort}` +
    `->${endpoints.target}:${endpoints.targetPort}`;
  const existing = new Set(
    def.root.connections.map((connection) => connection.id)
  );
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Structural deep-equality, order-independent on object keys. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/** Whether the draft has diverged from the last-loaded definition (header "Unsaved changes" chip). */
export function isDirty(draft: WirePipelineDefinition, loaded: WirePipelineDefinition): boolean {
  return !deepEqual(draft, loaded);
}

/** A validation issue mapped onto a concrete draft stage. */
export interface IssueTarget {
  stageIndex: number;
  field?: string;
}

export type DefinitionIssueTarget =
  | {
      kind: 'node';
      index: number;
      id: string;
      field?: string;
    }
  | {
      kind: 'connection';
      index: number;
      id: string;
      field?: string;
    };

/**
 * Maps a validation issue's JSON-pointer-ish `path` (e.g. `/stages/2/skill`)
 * onto the stage index (resolved against the SAME draft stage-order array the
 * validation request serialized) and optional field tail. `/stages` or `/`
 * (pipeline-level) and any path this pattern does not recognize map to
 * `null` — the caller still lists the issue in the drawer, never drops it.
 * When `stageCount` is passed, an index at or past it also maps to `null`
 * (an out-of-range index is exactly as unmappable as a malformed path) —
 * pass it whenever the target array is at hand so the function validates
 * standalone instead of relying on every call site's own `?.id` guard.
 */
export function issuePathTarget(path: string, stageCount?: number): IssueTarget | null {
  const match = /^\/stages\/(\d+)(?:\/(.+))?$/.exec(path);
  if (!match) return null;
  const stageIndex = Number(match[1]);
  if (!Number.isInteger(stageIndex) || stageIndex < 0) return null;
  if (stageCount !== undefined && stageIndex >= stageCount) return null;
  return match[2] ? { stageIndex, field: match[2] } : { stageIndex };
}

/**
 * Maps the shared diagnostic JSON Pointer onto the exact authored Canvas
 * element. Declaration/definition-level and malformed paths intentionally
 * return null so callers retain them as fully-qualified unmapped issues.
 */
export function definitionIssuePathTarget(
  def: WirePipelineDefinition,
  path: string
): DefinitionIssueTarget | null {
  if (isV1Definition(def)) {
    const stages = Array.isArray(def.stages) ? def.stages : [];
    const target = issuePathTarget(path, stages.length);
    if (!target) return null;
    const id = stages[target.stageIndex]?.id;
    if (!id) return null;
    return {
      kind: 'node',
      index: target.stageIndex,
      id,
      ...(target.field ? { field: target.field } : {}),
    };
  }

  const root =
    def.root !== null && typeof def.root === 'object' && !Array.isArray(def.root)
      ? (def.root as {
          nodes?: { id?: unknown }[];
          connections?: { id?: unknown }[];
        })
      : {};
  const nodes = Array.isArray(root.nodes) ? root.nodes : [];
  const connections = Array.isArray(root.connections)
    ? root.connections
    : [];
  const nodeMatch = /^\/root\/nodes\/(\d+)(?:\/(.+))?$/.exec(path);
  if (nodeMatch) {
    const index = Number(nodeMatch[1]);
    const id = nodes[index]?.id;
    if (!Number.isInteger(index) || index < 0 || typeof id !== 'string') {
      return null;
    }
    return {
      kind: 'node',
      index,
      id,
      ...(nodeMatch[2] ? { field: nodeMatch[2] } : {}),
    };
  }

  const connectionMatch =
    /^\/root\/connections\/(\d+)(?:\/(.+))?$/.exec(path);
  if (!connectionMatch) return null;
  const index = Number(connectionMatch[1]);
  const id = connections[index]?.id;
  if (!Number.isInteger(index) || index < 0 || typeof id !== 'string') {
    return null;
  }
  return {
    kind: 'connection',
    index,
    id,
    ...(connectionMatch[2] ? { field: connectionMatch[2] } : {}),
  };
}

// ===== Composite Declaration CRUD (ECP-2) =====

/**
 * Check whether a declaration id is unique within the definition.
 */
export function isDeclarationIdUnique(
  def: WirePipelineDefinitionV2,
  id: string
): boolean {
  return !def.declarations.some((d) => d.id === id);
}

/**
 * Create a new CompositeDeclaration with provenance 'custom'.
 *
 * Both refusals live HERE, not in the panel: a declaration id must be
 * non-blank and unique. The Canvas surfaces whatever this throws, so there is
 * exactly one owner of "is this a legal declaration id" — a panel that
 * pre-judged either rule would be a second implementation of it, which is the
 * failure mode this slice exists to delete.
 */
export function addDeclaration(
  def: WirePipelineDefinitionV2,
  id: string
): WirePipelineDefinitionV2 {
  if (id.trim().length === 0) {
    throw new Error('A declaration id cannot be blank.');
  }
  if (!isDeclarationIdUnique(def, id)) {
    throw new Error(`Declaration id '${id}' already exists.`);
  }
  const declaration = {
    id,
    kind: 'Composite' as const,
    provenance: 'custom' as const,
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    graph: { nodes: [], connections: [] },
  };
  return {
    ...def,
    declarations: [...def.declarations, declaration],
  };
}

/**
 * Update a declaration's scalar fields (inputs, artifacts, outcomes).
 */
export function updateDeclaration(
  def: WirePipelineDefinitionV2,
  id: string,
  patch: Partial<{
    inputs: WireCompositeDeclaration['inputs'];
    artifacts: WireCompositeDeclaration['artifacts'];
    outcomes: string[];
  }>
): WirePipelineDefinitionV2 {
  return {
    ...def,
    declarations: def.declarations.map((d) =>
      d.id === id ? { ...d, ...patch } : d
    ),
  };
}

/**
 * Remove a declaration. Rejects if the declaration is still referenced by a
 * root-level CompositeRef or BoundedLoop node.
 */
export function removeDeclaration(
  def: WirePipelineDefinitionV2,
  id: string
): WirePipelineDefinitionV2 {
  const referenced = def.root.nodes.some(
    (node) =>
      (node.kind === 'CompositeRef' && node.declarationId === id) ||
      (node.kind === 'BoundedLoop' && node.body === id)
  );
  if (referenced) {
    throw new Error(`Declaration '${id}' is still referenced by root nodes.`);
  }
  return {
    ...def,
    declarations: def.declarations.filter((d) => d.id !== id),
  };
}

/**
 * Add an AtomicStage node to a declaration's body graph.
 * The body palette is constrained to AtomicStage only.
 */
export function addBodyStage(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  stage: { id: string; capability: { id: string; version: string } }
): WirePipelineDefinitionV2 {
  return {
    ...def,
    declarations: def.declarations.map((d) => {
      if (d.id !== declarationId) return d;
      const node = { kind: 'AtomicStage' as const, ...stage };
      return {
        ...d,
        graph: {
          ...d.graph,
          nodes: [...d.graph.nodes, node],
        },
      };
    }),
  };
}

/**
 * Remove a body stage and all incident body connections.
 */
export function removeBodyStage(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  stageId: string
): WirePipelineDefinitionV2 {
  return {
    ...def,
    declarations: def.declarations.map((d) => {
      if (d.id !== declarationId) return d;
      return {
        ...d,
        graph: {
          nodes: d.graph.nodes.filter((n) => n.id !== stageId),
          connections: d.graph.connections.filter(
            (c) => c.from.node !== stageId && c.to.node !== stageId
          ),
        },
      };
    }),
  };
}

/**
 * Add a connection within a declaration body graph.
 */
export function addBodyConnection(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  connection: { id: string; from: { node: string; port: string }; to: { node: string; port: string } }
): WirePipelineDefinitionV2 {
  return {
    ...def,
    declarations: def.declarations.map((d) => {
      if (d.id !== declarationId) return d;
      return {
        ...d,
        graph: {
          ...d.graph,
          connections: [...d.graph.connections, connection],
        },
      };
    }),
  };
}

/**
 * Remove a body connection.
 */
export function removeBodyConnection(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  connectionId: string
): WirePipelineDefinitionV2 {
  return {
    ...def,
    declarations: def.declarations.map((d) => {
      if (d.id !== declarationId) return d;
      return {
        ...d,
        graph: {
          ...d.graph,
          connections: d.graph.connections.filter((c) => c.id !== connectionId),
        },
      };
    }),
  };
}
