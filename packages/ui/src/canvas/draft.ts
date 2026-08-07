/**
 * Pure draft-mutation functions for the pipeline canvas editor
 * (pipeline-canvas-edit design D2). The draft is a `WirePipelineDefinition`
 * value — NOT React Flow nodes/edges — the single source of truth; the canvas
 * derives nodes/edges from it per render via `layout.ts`. Kept free of React
 * Flow and DOM so cycle logic and field-preservation are unit-testable
 * without a canvas mount, the same reasoning that made `layout.ts` pure.
 */
import type {
  PipelineAgentRuntime,
  PipelineAgentRuntimeSandbox,
  PipelineAgentRuntimeSessionReuse,
  PipelineStageHandoffConfig,
  PipelineVerifyPolicy,
  ThresholdValue,
  WireAtomicStageExecutionV1,
  WireAtomicStageNode,
  WireBoundedLoopLifecyclePolicyV1,
  WireBoundedLoopNode,
  WireCompositeDeclaration,
  WireDefinitionArtifact,
  WireDefinitionConnection,
  WireDefinitionNode,
  WireDefinitionPort,
  WireFanOutNode,
  WireGateNode,
  WireGoalCycleVariant,
  WireGoalCyclePhase,
  WireJoinNode,
  WirePipelineDefinition,
  WirePipelineDefinitionV1,
  WirePipelineDefinitionV2,
  WirePipelineDefinitionStage,
  WireStageRole,
  WireReviewCyclePhase,
} from '../api/types.js';

/**
 * The conventional control ports an authored connection uses when neither
 * endpoint declares a typed one — which is every capability today, since
 * production descriptors declare no inputs and a single `done` outcome.
 *
 * These MUST stay inside the kernel's accepted sets or every saved definition
 * is rejected with PORT_MISMATCH: `CONTROL_TARGET_PORT` must be one of
 * `CONTROL_INPUT_PORTS` (`input` | `in` | `start`) and `CONTROL_SOURCE_PORT`
 * must name a declared outcome — both in
 * `src/core/pipeline-registry/definition.ts`.
 *
 * They live in the model module, not in the page, so that requirement is a TEST
 * rather than a comment: `test/core/pipeline-registry/canvas-control-port-provenance.test.ts`
 * imports these two values and runs the REAL kernel `prepare` over a
 * production-shaped catalog with them. Editing either one to something the
 * kernel does not accept fails a kernel test instead of shipping a Canvas that
 * authors unsaveable definitions — which is exactly the Blocker ECP-5 paid a
 * round for.
 */
export const CONTROL_SOURCE_PORT = 'done';
export const CONTROL_TARGET_PORT = 'input';

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
 * Browser-safe mirror of the core blank Definition v2 factory. Keep this pure
 * and dependency-free so Canvas never bundles the Node-oriented kernel. The
 * cross-package parity fixture pins every field to the core factory.
 */
export function createBlankCanvasPipelineDefinitionV2(
  name: string,
  source = 'canvas'
): WirePipelineDefinitionV2 {
  return {
    version: 2,
    id: `pipeline:${name}`,
    sourceId: `${source}:${name}`,
    name,
    inputs: [],
    artifacts: [],
    outcomes: [],
    declarations: [],
    root: { nodes: [], connections: [] },
  };
}

/** Forks an authored v2 definition into stable Canvas-owned user identities. */
export function duplicateV2Definition(
  def: WirePipelineDefinitionV2,
  name: string
): WirePipelineDefinitionV2 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A duplicate pipeline name cannot be blank.');
  return {
    ...def,
    id: `pipeline:${trimmed}`,
    sourceId: `canvas:${trimmed}`,
    name: trimmed,
  };
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
  if (!isV1Definition(def)) return connectionAdjacency(def.root.connections);
  const adjacency = new Map<string, string[]>();
  for (const stage of def.stages) {
    for (const req of stage.requires) {
      const arr = adjacency.get(req) ?? [];
      arr.push(stage.id);
      adjacency.set(req, arr);
    }
  }
  return adjacency;
}

/**
 * THE cycle rule, over a bare forward-adjacency map: would adding `from -> to`
 * close a loop? True when `to` can already reach `from`.
 *
 * This is the one implementation. `wouldCreateCycle` (v1 `requires` and v2
 * root connections) and {@link bodyWouldCreateCycle} (a declaration's body
 * graph) both delegate here, because `executable-custom-composite` does not
 * merely ask for a cycle check on body connections — it requires that "Body
 * connections SHALL be validated against the SAME DAG-cycle rules as root
 * connections". A second copy would satisfy the words and break the sentence.
 *
 * A convenience client-side fast-path only — the server's dry-run validation
 * remains authoritative (it emits the `GRAPH_CYCLE` diagnostic).
 */
function reachesThrough(
  adjacency: ReadonlyMap<string, readonly string[]>,
  from: string,
  to: string
): boolean {
  if (from === to) return true;
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

/** Forward adjacency over a typed connection list (root or declaration body). */
function connectionAdjacency(
  connections: readonly { from: { node: string }; to: { node: string } }[]
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const connection of connections) {
    const arr = adjacency.get(connection.from.node) ?? [];
    arr.push(connection.to.node);
    adjacency.set(connection.from.node, arr);
  }
  return adjacency;
}

/**
 * Whether connecting `from -> to` (i.e. `to` requiring `from`) would close a
 * dependency cycle in the ROOT graph, checked by reachability over the draft's
 * `requires` (v1) or typed connection (v2) edges.
 */
export function wouldCreateCycle(def: WirePipelineDefinition, from: string, to: string): boolean {
  return reachesThrough(buildAdjacency(def), from, to);
}

/**
 * The same rule applied to ONE declaration's body graph. Scoped deliberately:
 * a body cycle is a property of that declaration's own connections, never of
 * the root graph and never of a sibling declaration's — pooling them would
 * refuse legal edges and is exactly what the cross-declaration probe pins.
 */
export function bodyWouldCreateCycle(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  from: string,
  to: string
): boolean {
  const declaration = (def.declarations ?? []).find((d) => d.id === declarationId);
  const connections = (declaration?.graph?.connections ?? []) as readonly {
    from: { node: string };
    to: { node: string };
  }[];
  return reachesThrough(connectionAdjacency(connections), from, to);
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

export interface AtomicStageExecutionPatch {
  role?: WireStageRole;
  workspace?: Partial<WireAtomicStageExecutionV1['workspace']>;
  leadReview?: boolean | null;
  verifyPolicy?: PipelineVerifyPolicy | null;
  runtime?: PipelineAgentRuntime | null;
  model?: string | null;
  effort?: string | null;
  sandbox?: PipelineAgentRuntimeSandbox | null;
  sessionReuse?: PipelineAgentRuntimeSessionReuse | null;
  handoff?: {
    threshold?: PipelineStageHandoffConfig['threshold'] | null;
    maxRelays?: number | null;
    stallLimit?: number | null;
    [key: string]: unknown;
  } | null;
}

/**
 * Patches one AtomicStage execution owner in place. `null` clears an optional
 * authored field; nested workspace/handoff patches retain unexposed siblings.
 */
export function updateAtomicStageExecution(
  def: WirePipelineDefinitionV2,
  id: string,
  patch: AtomicStageExecutionPatch
): WirePipelineDefinitionV2 {
  const node = def.root.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== 'AtomicStage') {
    throw new Error(`AtomicStage '${id}' does not exist.`);
  }
  const current: WireAtomicStageExecutionV1 = node.execution ?? {
    version: 1,
    role: 'implementer',
    workspace: { access: 'write' },
  };
  const next: WireAtomicStageExecutionV1 = {
    ...current,
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    workspace:
      patch.workspace === undefined
        ? current.workspace
        : { ...current.workspace, ...patch.workspace },
  };
  const optionalKeys = [
    'leadReview',
    'verifyPolicy',
    'runtime',
    'model',
    'effort',
    'sandbox',
    'sessionReuse',
  ] as const;
  for (const key of optionalKeys) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value as never;
  }
  if (patch.handoff === null) {
    delete next.handoff;
  } else if (patch.handoff !== undefined) {
    const handoff = { ...(current.handoff ?? {}) };
    for (const [key, value] of Object.entries(patch.handoff)) {
      if (value === null) delete handoff[key];
      else handoff[key] = value;
    }
    next.handoff = handoff;
  }
  return updateV2NodeFields(def, id, { execution: next } as Partial<WireAtomicStageNode>);
}

export interface DefinitionContractPatch {
  inputs?: WireDefinitionPort[];
  artifacts?: WireDefinitionArtifact[];
  outcomes?: string[];
  limits?: {
    maxActions?: number | null;
    budget?: number | null;
    [key: string]: unknown;
  } | null;
}

function assertNamedContractRows(
  label: string,
  rows: readonly { name: string; type: string }[]
): void {
  const names = rows.map((row) => row.name.trim());
  if (names.some((name) => !name)) throw new Error(`A ${label} name cannot be blank.`);
  if (new Set(names).size !== names.length) throw new Error(`${label} names must be unique.`);
  if (rows.some((row) => !row.type.trim())) throw new Error(`A ${label} type cannot be blank.`);
}

function assertNamedOutcomes(label: string, outcomes: readonly string[]): void {
  const values = outcomes.map((outcome) => outcome.trim());
  if (values.some((outcome) => !outcome)) throw new Error(`A ${label} outcome cannot be blank.`);
  if (new Set(values).size !== values.length) throw new Error(`${label} outcomes must be unique.`);
}

/** Patches top-level authored contracts without reconstructing the Definition. */
export function updateDefinitionContracts(
  def: WirePipelineDefinitionV2,
  patch: DefinitionContractPatch
): WirePipelineDefinitionV2 {
  if (patch.inputs !== undefined) assertNamedContractRows('definition input', patch.inputs);
  if (patch.artifacts !== undefined) assertNamedContractRows('definition artifact', patch.artifacts);
  if (patch.outcomes !== undefined) assertNamedOutcomes('definition', patch.outcomes);
  if (patch.limits) {
    for (const [key, value] of Object.entries(patch.limits)) {
      if (value !== null && typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new Error(`Definition limit '${key}' must be a positive integer.`);
      }
    }
  }
  const next: WirePipelineDefinitionV2 = {
    ...def,
    ...(patch.inputs !== undefined ? { inputs: patch.inputs } : {}),
    ...(patch.artifacts !== undefined ? { artifacts: patch.artifacts } : {}),
    ...(patch.outcomes !== undefined ? { outcomes: patch.outcomes } : {}),
  };
  if (patch.limits === null) delete next.limits;
  else if (patch.limits !== undefined) {
    const limits = { ...(def.limits ?? {}) };
    for (const [key, value] of Object.entries(patch.limits)) {
      if (value === null) delete limits[key];
      else limits[key] = value;
    }
    if (Object.keys(limits).length === 0) delete next.limits;
    else next.limits = limits;
  }
  return next;
}

export interface BoundedLoopContractPatch {
  body?: string;
  goalCycleVariant?: WireGoalCycleVariant | null;
  limits?: {
    maxIterations?: number;
    maxActions?: number | null;
    budget?: number | null;
  };
  lifecycle?: {
    thresholds?: Partial<WireBoundedLoopLifecyclePolicyV1['thresholds']>;
    strategy?: {
      maxAttempts?: number;
      requireMaterialChange?: true;
      capability?: { id: string; version: string } | null;
    };
    exits?: Partial<WireBoundedLoopLifecyclePolicyV1['exits']>;
  };
  exits?: Record<
    string,
    { action: 'continue' } | { action: 'exit'; outcome: string }
  >;
}

/** Visible starter values for a complete authored lifecycle; not runtime inference. */
export function createDefaultBoundedLoopLifecycle(): WireBoundedLoopLifecyclePolicyV1 {
  return {
    version: 1,
    thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
    strategy: { maxAttempts: 0, requireMaterialChange: true },
    exits: {
      iterationLimit: { action: 'exit', outcome: 'iteration-limit' },
      actionLimit: { action: 'fail', outcome: 'action-limit' },
      budgetLimit: { action: 'fail', outcome: 'budget-limit' },
      stalled: { action: 'escalate', outcome: 'stalled' },
      blocked: { action: 'human-required', outcome: 'blocked' },
      strategyExhausted: { action: 'fail', outcome: 'strategy-exhausted' },
    },
  };
}

/**
 * Rebuilds one loop's domain exits against the outcomes reachable from its
 * body contract. Retained outcomes keep their authored mapping, retired
 * outcomes disappear, and newly reachable outcomes receive a deterministic
 * visible default without manufacturing duplicate terminal exits.
 */
function reconcileBoundedLoopExits(
  current: WireBoundedLoopNode['exits'],
  nextOutcomes: readonly string[],
  defaultExitOutcome: string
): WireBoundedLoopNode['exits'] {
  const keepsTerminalExit = nextOutcomes.some(
    (outcome) => current[outcome]?.action === 'exit'
  );
  return Object.fromEntries(
    nextOutcomes.map((outcome, index) => [
      outcome,
      current[outcome] ??
        (!keepsTerminalExit && index === nextOutcomes.length - 1
          ? {
              action: 'exit' as const,
              outcome: defaultExitOutcome,
            }
          : { action: 'continue' as const }),
    ])
  );
}

/** Patches loop domain and mechanical contracts while preserving every sibling. */
export function updateBoundedLoopContract(
  def: WirePipelineDefinitionV2,
  id: string,
  patch: BoundedLoopContractPatch
): WirePipelineDefinitionV2 {
  const node = def.root.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== 'BoundedLoop') {
    throw new Error(`BoundedLoop '${id}' does not exist.`);
  }
  const next: WireBoundedLoopNode = {
    ...node,
    ...(patch.body !== undefined ? { body: patch.body } : {}),
  };
  let exits = node.exits;
  if (patch.body !== undefined && patch.body !== node.body) {
    const nextDeclaration = def.declarations.find(
      (declaration) => declaration.id === patch.body
    );
    if (nextDeclaration) {
      exits = reconcileBoundedLoopExits(
        node.exits,
        nextDeclaration.outcomes,
        def.outcomes[0] ?? 'done'
      );
    }
  }
  if (patch.exits !== undefined) {
    exits = { ...exits, ...patch.exits };
  }
  next.exits = exits;
  if (patch.limits !== undefined) {
    const limits = { ...node.limits };
    for (const [key, value] of Object.entries(patch.limits)) {
      if (value === null) delete limits[key as 'maxActions' | 'budget'];
      else limits[key as keyof typeof limits] = value;
    }
    next.limits = limits;
  }
  if (patch.goalCycleVariant === null) delete next.goalCycleVariant;
  else if (patch.goalCycleVariant !== undefined) {
    next.goalCycleVariant = patch.goalCycleVariant;
  }
  if (patch.lifecycle !== undefined) {
    const currentLifecycle = node.lifecycle ?? createDefaultBoundedLoopLifecycle();
    const strategy: WireBoundedLoopLifecyclePolicyV1['strategy'] = {
      ...currentLifecycle.strategy,
    };
    if (patch.lifecycle.strategy?.maxAttempts !== undefined) {
      strategy.maxAttempts = patch.lifecycle.strategy.maxAttempts;
    }
    if (patch.lifecycle.strategy?.requireMaterialChange !== undefined) {
      strategy.requireMaterialChange = patch.lifecycle.strategy.requireMaterialChange;
    }
    if (patch.lifecycle.strategy?.capability === null) delete strategy.capability;
    else if (patch.lifecycle.strategy?.capability !== undefined) {
      strategy.capability = patch.lifecycle.strategy.capability;
    }
    next.lifecycle = {
      ...currentLifecycle,
      thresholds: {
        ...currentLifecycle.thresholds,
        ...(patch.lifecycle.thresholds ?? {}),
      },
      strategy,
      exits: {
        ...currentLifecycle.exits,
        ...(patch.lifecycle.exits ?? {}),
      },
    };
  }
  return updateV2NodeFields(def, id, next);
}

/** Keeps Gate decisions unique, ordered, and in one-to-one disposition sync. */
export function updateGateDecisions(
  def: WirePipelineDefinitionV2,
  id: string,
  decisions: readonly string[]
): WirePipelineDefinitionV2 {
  const node = def.root.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== 'Gate') throw new Error(`Gate '${id}' does not exist.`);
  const outcomes = Array.from(new Set(decisions.map((value) => value.trim()).filter(Boolean)));
  const dispositions = Object.fromEntries(
    outcomes.map((outcome) => [outcome, node.dispositions[outcome] ?? 'proceed'])
  ) as WireGateNode['dispositions'];
  return updateV2NodeFields(def, id, { outcomes, dispositions } as Partial<WireGateNode>);
}

export function updateGateDisposition(
  def: WirePipelineDefinitionV2,
  id: string,
  decision: string,
  disposition: WireGateNode['dispositions'][string]
): WirePipelineDefinitionV2 {
  const node = def.root.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== 'Gate') throw new Error(`Gate '${id}' does not exist.`);
  if (!node.outcomes.includes(decision)) {
    throw new Error(`Gate decision '${decision}' does not exist on '${id}'.`);
  }
  return updateV2NodeFields(def, id, {
    dispositions: { ...node.dispositions, [decision]: disposition },
  } as Partial<WireGateNode>);
}

export type V2EditableNodeKind = WireDefinitionNode['kind'];

const V2_EDITABLE_NODE_KINDS = new Set<WireDefinitionNode['kind']>([
  'AtomicStage',
  'CompositeRef',
  'BoundedLoop',
  'Choice',
  'FanOut',
  'Join',
  'Gate',
  'Finish',
]);

/** The deliberately bounded v2 vocabulary this Canvas slice may mutate. */
export function isV2EditableNodeKind(
  kind: WireDefinitionNode['kind'] | string
): kind is V2EditableNodeKind {
  return V2_EDITABLE_NODE_KINDS.has(kind as WireDefinitionNode['kind']);
}

/**
 * The kinds the ROOT palette offers — the editable vocabulary, in display
 * order. All eight closed v2 kinds are authored by this slice.
 */
export const V2_ROOT_PALETTE_KINDS: readonly V2EditableNodeKind[] = [
  'AtomicStage',
  'CompositeRef',
  'BoundedLoop',
  'Choice',
  'FanOut',
  'Join',
  'Gate',
  'Finish',
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

export interface CreateParallelPairInput {
  fanOutId: string;
  joinId: string;
  memberNodeIds: readonly string[];
  requiredMemberIds?: readonly string[];
  concurrencyCap: number;
  budget: number;
  outcomes: WireJoinNode['outcomes'];
}

function parallelPair(
  def: WirePipelineDefinitionV2,
  fanOutId: string
): { fanOut: WireFanOutNode; join: WireJoinNode } {
  const fanOut = def.root.nodes.find(
    (node): node is WireFanOutNode => node.id === fanOutId && node.kind === 'FanOut'
  );
  if (!fanOut) throw new Error(`FanOut '${fanOutId}' does not exist.`);
  const join = def.root.nodes.find(
    (node): node is WireJoinNode =>
      node.id === fanOut.joinNodeId && node.kind === 'Join'
  );
  if (!join) {
    throw new Error(
      `FanOut '${fanOutId}' references missing paired Join '${fanOut.joinNodeId}'.`
    );
  }
  return { fanOut, join };
}

/** Creates both structural halves of one parallel frontier as one transaction. */
export function createParallelPair(
  def: WirePipelineDefinitionV2,
  input: CreateParallelPairInput
): WirePipelineDefinitionV2 {
  const fanOutId = input.fanOutId.trim();
  const joinId = input.joinId.trim();
  if (!fanOutId || !joinId) throw new Error('Parallel node ids cannot be blank.');
  if (fanOutId === joinId) throw new Error('FanOut and Join ids must be distinct.');
  const existing = new Set(def.root.nodes.map((node) => node.id));
  if (existing.has(fanOutId) || existing.has(joinId)) {
    throw new Error('Parallel node id already exists.');
  }
  const memberNodeIds = Array.from(
    new Set(input.memberNodeIds.map((id) => id.trim()).filter(Boolean))
  );
  if (memberNodeIds.length === 0) {
    throw new Error('A parallel contract requires at least one member.');
  }
  for (const id of memberNodeIds) {
    const node = def.root.nodes.find((candidate) => candidate.id === id);
    if (!node || node.kind !== 'AtomicStage') {
      throw new Error(`Parallel member '${id}' must be a root AtomicStage.`);
    }
  }
  if (!Number.isFinite(input.concurrencyCap) || input.concurrencyCap <= 0) {
    throw new Error('Parallel concurrency cap must be positive.');
  }
  if (!Number.isFinite(input.budget) || input.budget <= 0) {
    throw new Error('Parallel budget must be positive.');
  }
  const required = new Set(input.requiredMemberIds ?? memberNodeIds);
  for (const id of required) {
    if (!memberNodeIds.includes(id)) {
      throw new Error(`Required parallel member '${id}' is not selected.`);
    }
  }
  const fanOut: WireFanOutNode = {
    id: fanOutId,
    kind: 'FanOut',
    branches: [...memberNodeIds],
    concurrencyCap: input.concurrencyCap,
    budget: input.budget,
    joinNodeId: joinId,
    members: memberNodeIds.map((id) => ({
      id,
      hierarchicalPath: id,
      required: required.has(id),
      condition: 'always',
    })),
  };
  const join: WireJoinNode = {
    id: joinId,
    kind: 'Join',
    inputs: [...memberNodeIds],
    requiredMembers: memberNodeIds.filter((id) => required.has(id)),
    optionalMembers: memberNodeIds.filter((id) => !required.has(id)),
    outcomes: { ...input.outcomes },
  };
  return {
    ...def,
    root: {
      ...def.root,
      nodes: [...def.root.nodes, fanOut, join],
    },
  };
}

export interface ParallelMemberPatch {
  required?: boolean;
  condition?: string;
  hierarchicalPath?: string;
}

/** Replaces ordered membership while preserving existing member metadata. */
export function setParallelMembers(
  def: WirePipelineDefinitionV2,
  fanOutId: string,
  memberNodeIds: readonly string[]
): WirePipelineDefinitionV2 {
  const { fanOut, join } = parallelPair(def, fanOutId);
  const ids = Array.from(
    new Set(memberNodeIds.map((id) => id.trim()).filter(Boolean))
  );
  if (ids.length === 0) throw new Error('A parallel contract cannot have empty membership.');
  for (const id of ids) {
    const node = def.root.nodes.find((candidate) => candidate.id === id);
    if (!node || node.kind !== 'AtomicStage') {
      throw new Error(`Parallel member '${id}' must be a root AtomicStage.`);
    }
  }
  const previous = new Map(fanOut.members.map((member) => [member.id, member]));
  const members = ids.map(
    (id, index) =>
      previous.get(id) ?? {
        id,
        hierarchicalPath: id,
        required: index === 0,
        condition: 'always',
      }
  );
  const requiredMembers = members.filter((member) => member.required).map((member) => member.id);
  const optionalMembers = members.filter((member) => !member.required).map((member) => member.id);
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.map((node) => {
        if (node.id === fanOut.id) {
          return { ...fanOut, branches: ids, members };
        }
        if (node.id === join.id) {
          return { ...join, inputs: ids, requiredMembers, optionalMembers };
        }
        return node;
      }),
    },
  };
}

/** Updates a member and both required/optional partitions atomically. */
export function updateParallelMember(
  def: WirePipelineDefinitionV2,
  fanOutId: string,
  memberId: string,
  patch: ParallelMemberPatch
): WirePipelineDefinitionV2 {
  const { fanOut, join } = parallelPair(def, fanOutId);
  const current = fanOut.members.find((member) => member.id === memberId);
  if (!current) throw new Error(`Parallel member '${memberId}' does not exist.`);
  const members = fanOut.members.map((member) =>
    member.id === memberId ? { ...member, ...patch } : member
  );
  const requiredMembers = members.filter((member) => member.required).map((member) => member.id);
  const optionalMembers = members.filter((member) => !member.required).map((member) => member.id);
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.map((node) => {
        if (node.id === fanOut.id) return { ...fanOut, members };
        if (node.id === join.id) return { ...join, requiredMembers, optionalMembers };
        return node;
      }),
    },
  };
}

export interface ParallelContractPatch {
  concurrencyCap?: number;
  budget?: number;
  joinId?: string;
  outcomes?: Partial<WireJoinNode['outcomes']>;
}

/** Updates pair-owned limits, Join identity, and terminal outcomes atomically. */
export function updateParallelContract(
  def: WirePipelineDefinitionV2,
  fanOutId: string,
  patch: ParallelContractPatch
): WirePipelineDefinitionV2 {
  let next = def;
  let pair = parallelPair(next, fanOutId);
  if (patch.joinId !== undefined && patch.joinId.trim() !== pair.join.id) {
    next = renameV2Node(next, pair.join.id, patch.joinId.trim());
    pair = parallelPair(next, fanOutId);
  }
  if (patch.concurrencyCap !== undefined && patch.concurrencyCap <= 0) {
    throw new Error('Parallel concurrency cap must be positive.');
  }
  if (patch.budget !== undefined && patch.budget <= 0) {
    throw new Error('Parallel budget must be positive.');
  }
  return {
    ...next,
    root: {
      ...next.root,
      nodes: next.root.nodes.map((node) => {
        if (node.id === pair.fanOut.id) {
          return {
            ...pair.fanOut,
            ...(patch.concurrencyCap !== undefined
              ? { concurrencyCap: patch.concurrencyCap }
              : {}),
            ...(patch.budget !== undefined ? { budget: patch.budget } : {}),
          };
        }
        if (node.id === pair.join.id) {
          return {
            ...pair.join,
            ...(patch.outcomes !== undefined
              ? { outcomes: { ...pair.join.outcomes, ...patch.outcomes } }
              : {}),
          };
        }
        return node;
      }),
    },
  };
}

/** Explicitly removes the paired FanOut and Join, including incident connections. */
export function removeParallelPair(
  def: WirePipelineDefinitionV2,
  fanOutId: string
): WirePipelineDefinitionV2 {
  const { fanOut, join } = parallelPair(def, fanOutId);
  const ids = new Set([fanOut.id, join.id]);
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.filter((node) => !ids.has(node.id)),
      connections: def.root.connections.filter(
        (connection) => !ids.has(connection.from.node) && !ids.has(connection.to.node)
      ),
    },
  };
}

/** Removes a root node while protecting Gate and paired-parallel references. */
export function removeV2Node(
  def: WirePipelineDefinitionV2,
  id: string
): WirePipelineDefinitionV2 {
  const removed = def.root.nodes.find((node) => node.id === id);
  if (!removed) return def;
  if (removed.kind === 'FanOut' || removed.kind === 'Join') {
    throw new Error('FanOut and Join require explicit paired deletion.');
  }
  const targetingGate = def.root.nodes.find(
    (node) => node.kind === 'Gate' && node.target === id
  );
  if (targetingGate) {
    throw new Error(`Node '${id}' is still targeted by Gate '${targetingGate.id}'.`);
  }
  for (const node of def.root.nodes) {
    if (node.kind !== 'FanOut' || !node.members.some((member) => member.id === id)) continue;
    if (node.members.length === 1) {
      throw new Error(`Node '${id}' is the only parallel member of '${node.id}'.`);
    }
  }
  const nodes = def.root.nodes
    .filter((node) => node.id !== id)
    .map((node): WireDefinitionNode => {
      if (node.kind === 'FanOut' && node.members.some((member) => member.id === id)) {
        return {
          ...node,
          branches: node.branches.filter((member) => member !== id),
          members: node.members.filter((member) => member.id !== id),
        };
      }
      if (node.kind === 'Join' && node.inputs.includes(id)) {
        return {
          ...node,
          inputs: node.inputs.filter((member) => member !== id),
          requiredMembers: node.requiredMembers.filter((member) => member !== id),
          optionalMembers: node.optionalMembers.filter((member) => member !== id),
        };
      }
      return node;
    });
  return {
    ...def,
    root: {
      ...def.root,
      nodes,
      connections: def.root.connections.filter(
        (connection) =>
          connection.from.node !== id && connection.to.node !== id
      ),
    },
  };
}

/** Renames a root node and every structured reference owned by the draft. */
export function renameV2Node(
  def: WirePipelineDefinitionV2,
  oldId: string,
  newId: string
): WirePipelineDefinitionV2 {
  const trimmed = newId.trim();
  if (!trimmed) throw new Error('A root node id cannot be blank.');
  if (!def.root.nodes.some((node) => node.id === oldId)) {
    throw new Error(`Root node '${oldId}' does not exist.`);
  }
  if (trimmed !== oldId && def.root.nodes.some((node) => node.id === trimmed)) {
    throw new Error(`Root node id '${trimmed}' already exists.`);
  }
  const rewrite = (value: string) => (value === oldId ? trimmed : value);
  return {
    ...def,
    root: {
      ...def.root,
      nodes: def.root.nodes.map((node): WireDefinitionNode => {
        const renamed = node.id === oldId ? { ...node, id: trimmed } : node;
        if (renamed.kind === 'Gate') {
          return { ...renamed, target: rewrite(renamed.target) };
        }
        if (renamed.kind === 'FanOut') {
          return {
            ...renamed,
            branches: renamed.branches.map(rewrite),
            joinNodeId: rewrite(renamed.joinNodeId),
            members: renamed.members.map((member) => ({
              ...member,
              id: rewrite(member.id),
              hierarchicalPath: rewrite(member.hierarchicalPath),
            })),
          };
        }
        if (renamed.kind === 'Join') {
          return {
            ...renamed,
            inputs: renamed.inputs.map(rewrite),
            requiredMembers: renamed.requiredMembers.map(rewrite),
            optionalMembers: renamed.optionalMembers.map(rewrite),
          };
        }
        return renamed as WireDefinitionNode;
      }),
      connections: def.root.connections.map((connection) => ({
        ...connection,
        from:
          connection.from.node === oldId
            ? { ...connection.from, node: trimmed }
            : connection.from,
        to:
          connection.to.node === oldId
            ? { ...connection.to, node: trimmed }
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
  CompositeRef: 'composite-ref',
  BoundedLoop: 'bounded-loop',
  Choice: 'choice',
  FanOut: 'fan-out',
  Join: 'join',
  Gate: 'gate',
  Finish: 'finish',
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
      kind: 'definition';
      field?: string;
    }
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
    }
  | {
      kind: 'declaration';
      index: number;
      id: string;
      field?: string;
    }
  | {
      kind: 'body-node';
      declarationIndex: number;
      declarationId: string;
      index: number;
      id: string;
      field?: string;
    }
  | {
      kind: 'body-connection';
      declarationIndex: number;
      declarationId: string;
      index: number;
      id: string;
      field?: string;
    };

function jsonPointerSegments(path: string): string[] | null {
  if (!path.startsWith('/')) return null;
  if (path === '/') return [];
  const raw = path.slice(1).split('/');
  if (raw.some((segment) => /~(?![01])/u.test(segment))) return null;
  return raw.map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function arrayIndex(segment: string | undefined, length: number): number | null {
  if (segment === undefined || !/^(0|[1-9]\d*)$/u.test(segment)) return null;
  const index = Number(segment);
  return Number.isSafeInteger(index) && index < length ? index : null;
}

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
 * Maps the shared diagnostic JSON Pointer onto the exact authored owner.
 * Malformed, out-of-range, and unknown top-level paths intentionally remain
 * unmapped so the issue list never points at a different control.
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
  const segments = jsonPointerSegments(path);
  if (!segments || segments.length === 0) return null;
  const field = (tail: readonly string[]) =>
    tail.length > 0 ? { field: tail.join('/') } : {};

  const definitionFields = new Set([
    'version',
    'id',
    'sourceId',
    'name',
    'description',
    'inputs',
    'artifacts',
    'outcomes',
    'limits',
  ]);
  if (definitionFields.has(segments[0]!)) {
    return { kind: 'definition', ...field(segments) };
  }

  if (segments[0] === 'root' && segments[1] === 'nodes') {
    const index = arrayIndex(segments[2], def.root.nodes.length);
    if (index === null) return null;
    const id = def.root.nodes[index]?.id;
    if (typeof id !== 'string') return null;
    return { kind: 'node', index, id, ...field(segments.slice(3)) };
  }
  if (segments[0] === 'root' && segments[1] === 'connections') {
    const index = arrayIndex(segments[2], def.root.connections.length);
    if (index === null) return null;
    const id = def.root.connections[index]?.id;
    if (typeof id !== 'string') return null;
    return { kind: 'connection', index, id, ...field(segments.slice(3)) };
  }
  if (segments[0] !== 'declarations') return null;
  const declarationIndex = arrayIndex(segments[1], def.declarations.length);
  if (declarationIndex === null) return null;
  const declaration = def.declarations[declarationIndex];
  if (!declaration || typeof declaration.id !== 'string') return null;
  const tail = segments.slice(2);
  if (tail[0] === 'graph' && tail[1] === 'nodes') {
    const index = arrayIndex(tail[2], declaration.graph.nodes.length);
    if (index === null) return null;
    const id = declaration.graph.nodes[index]?.id;
    if (typeof id !== 'string') return null;
    return {
      kind: 'body-node',
      declarationIndex,
      declarationId: declaration.id,
      index,
      id,
      ...field(tail.slice(3)),
    };
  }
  if (tail[0] === 'graph' && tail[1] === 'connections') {
    const index = arrayIndex(tail[2], declaration.graph.connections.length);
    if (index === null) return null;
    const id = declaration.graph.connections[index]?.id;
    if (typeof id !== 'string') return null;
    return {
      kind: 'body-connection',
      declarationIndex,
      declarationId: declaration.id,
      index,
      id,
      ...field(tail.slice(3)),
    };
  }
  return {
    kind: 'declaration',
    index: declarationIndex,
    id: declaration.id,
    ...field(tail),
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
 * Update a declaration's scalar fields (inputs, artifacts, outcomes). An
 * outcome edit also rebuilds every referencing root BoundedLoop exit map as
 * part of the same immutable mutation.
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
  if (patch.inputs !== undefined) assertNamedContractRows('declaration input', patch.inputs);
  if (patch.artifacts !== undefined) assertNamedContractRows('declaration artifact', patch.artifacts);
  if (patch.outcomes !== undefined) assertNamedOutcomes('declaration', patch.outcomes);
  const declarationExists = def.declarations.some((declaration) => declaration.id === id);
  const nextOutcomes = patch.outcomes;
  const declarations = def.declarations.map((declaration) =>
    declaration.id === id ? { ...declaration, ...patch } : declaration
  );
  return {
    ...def,
    declarations,
    ...(declarationExists && nextOutcomes !== undefined
      ? {
          root: {
            ...def.root,
            nodes: def.root.nodes.map((node): WireDefinitionNode =>
              node.kind === 'BoundedLoop' && node.body === id
                ? {
                    ...node,
                    exits: reconcileBoundedLoopExits(
                      node.exits,
                      nextOutcomes,
                      def.outcomes[0] ?? 'done'
                    ),
                  }
                : node
            ),
          },
        }
      : {}),
  };
}

/** Renames one custom declaration and every root reference to it. */
export function renameDeclaration(
  def: WirePipelineDefinitionV2,
  oldId: string,
  newId: string
): WirePipelineDefinitionV2 {
  const declaration = def.declarations.find((candidate) => candidate.id === oldId);
  if (!declaration) throw new Error(`Declaration '${oldId}' does not exist.`);
  if (declaration.provenance === 'built-in') {
    throw new Error(`Built-in declaration '${oldId}' cannot be renamed.`);
  }
  const trimmed = newId.trim();
  if (!trimmed) throw new Error('A declaration id cannot be blank.');
  if (trimmed !== oldId && !isDeclarationIdUnique(def, trimmed)) {
    throw new Error(`Declaration id '${trimmed}' already exists.`);
  }
  return {
    ...def,
    declarations: def.declarations.map((candidate) =>
      candidate.id === oldId ? { ...candidate, id: trimmed } : candidate
    ),
    root: {
      ...def.root,
      nodes: def.root.nodes.map((node): WireDefinitionNode => {
        if (node.kind === 'CompositeRef' && node.declarationId === oldId) {
          return { ...node, declarationId: trimmed };
        }
        if (node.kind === 'BoundedLoop' && node.body === oldId) {
          return { ...node, body: trimmed };
        }
        return node;
      }),
    },
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
  const declaration = def.declarations.find((candidate) => candidate.id === id);
  if (declaration?.provenance === 'built-in') {
    throw new Error(`Built-in declaration '${id}' cannot be deleted.`);
  }
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

export interface BodyAtomicStageInput {
  id: string;
  capability: { id: string; version: string };
  execution?: WireAtomicStageExecutionV1;
  reviewCyclePhase?: WireReviewCyclePhase;
  goalCyclePhase?: WireGoalCyclePhase;
  [key: string]: unknown;
}

/** Add an AtomicStage node to a declaration's body graph. */
export function addBodyStage(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  stage: BodyAtomicStageInput
): WirePipelineDefinitionV2 {
  const declaration = def.declarations.find((candidate) => candidate.id === declarationId);
  if (!declaration) throw new Error(`Declaration '${declarationId}' does not exist.`);
  if (!stage.id.trim()) throw new Error('A body stage id cannot be blank.');
  if (declaration.graph.nodes.some((candidate) => candidate.id === stage.id)) {
    throw new Error(`Body stage id '${stage.id}' already exists in '${declarationId}'.`);
  }
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
 * Edit one body AtomicStage — the "edit" verb of `executable-custom-composite`
 * ("The Canvas SHALL allow the user to add, remove, and edit AtomicStage nodes
 * within a custom declaration's body graph"). ECP-2's task 8.2 listed this
 * function by name; it never existed.
 *
 * A rename REWRITES both endpoints of every incident body connection, mirroring
 * what `renameV2Node` already does for the root graph. Patching the node alone
 * would leave edges pointing at an id that no longer exists — a silently
 * disconnected body, which is the very failure this slice is closing.
 */
export function updateBodyStage(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  stageId: string,
  patch: Partial<BodyAtomicStageInput>
): WirePipelineDefinitionV2 {
  const declaration = (def.declarations ?? []).find((d) => d.id === declarationId);
  if (declaration === undefined) {
    throw new Error(`Declaration '${declarationId}' does not exist.`);
  }
  const nodes = (declaration.graph?.nodes ?? []) as readonly { id: string }[];
  if (!nodes.some((node) => node.id === stageId)) {
    throw new Error(`Body stage '${stageId}' does not exist in '${declarationId}'.`);
  }
  const nextId = patch.id?.trim();
  if (patch.id !== undefined && (nextId === undefined || nextId.length === 0)) {
    throw new Error('A body stage id cannot be blank.');
  }
  if (nextId !== undefined && nextId !== stageId && nodes.some((node) => node.id === nextId)) {
    throw new Error(`Body stage id '${nextId}' already exists in '${declarationId}'.`);
  }
  const renamed = nextId !== undefined && nextId !== stageId ? nextId : stageId;
  return {
    ...def,
    declarations: def.declarations.map((d) => {
      if (d.id !== declarationId) return d;
      return {
        ...d,
        graph: {
          ...d.graph,
          nodes: d.graph.nodes.map((node) =>
            (node as { id: string }).id === stageId
              ? { ...node, ...patch, id: renamed }
              : node
          ),
          connections: d.graph.connections.map((connection) => ({
            ...connection,
            from:
              connection.from.node === stageId
                ? { ...connection.from, node: renamed }
                : connection.from,
            to:
              connection.to.node === stageId
                ? { ...connection.to, node: renamed }
                : connection.to,
          })),
        },
      };
    }),
  };
}

/** Patches one declaration-body AtomicStage execution without rebuilding its node. */
export function updateBodyStageExecution(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  stageId: string,
  patch: AtomicStageExecutionPatch
): WirePipelineDefinitionV2 {
  const declaration = def.declarations.find((candidate) => candidate.id === declarationId);
  const node = declaration?.graph.nodes.find((candidate) => candidate.id === stageId);
  if (!node || node.kind !== 'AtomicStage') {
    throw new Error(`Body AtomicStage '${stageId}' does not exist in '${declarationId}'.`);
  }
  const current: WireAtomicStageExecutionV1 = node.execution ?? {
    version: 1,
    role: 'implementer',
    workspace: { access: 'write' },
  };
  const next: WireAtomicStageExecutionV1 = {
    ...current,
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    workspace:
      patch.workspace === undefined
        ? current.workspace
        : { ...current.workspace, ...patch.workspace },
  };
  const optionalKeys = [
    'leadReview',
    'verifyPolicy',
    'runtime',
    'model',
    'effort',
    'sandbox',
    'sessionReuse',
  ] as const;
  for (const key of optionalKeys) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value as never;
  }
  if (patch.handoff === null) delete next.handoff;
  else if (patch.handoff !== undefined) {
    const handoff = { ...(current.handoff ?? {}) };
    for (const [key, value] of Object.entries(patch.handoff)) {
      if (value === null) delete handoff[key];
      else handoff[key] = value;
    }
    next.handoff = handoff;
  }
  return updateBodyStage(def, declarationId, stageId, { execution: next });
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
          ...d.graph,
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
 * Generates a stable, graph-local id for a body connection, uniquified against
 * that declaration's existing connection ids. Mirrors `v2ConnectionIdFor`'s
 * scheme for the root graph.
 */
export function bodyConnectionIdFor(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  endpoints: V2ConnectionEndpoints
): string {
  const base =
    `${endpoints.source}:${endpoints.sourcePort}` +
    `->${endpoints.target}:${endpoints.targetPort}`;
  const declaration = (def.declarations ?? []).find((d) => d.id === declarationId);
  const existing = new Set(
    (declaration?.graph?.connections ?? []).map((connection) => connection.id)
  );
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * Add a connection within a declaration body graph.
 *
 * EVERY refusal lives here, not in the affordance: unknown declaration,
 * unknown endpoint stage, duplicate edge, and — per the spec — a connection
 * that would close a cycle, judged by {@link bodyWouldCreateCycle}, i.e. the
 * same rule the root graph uses. The Canvas surfaces whatever this throws, so
 * a panel can never disagree with the model about what is legal.
 */
export function addBodyConnection(
  def: WirePipelineDefinitionV2,
  declarationId: string,
  connection: { id: string; from: { node: string; port: string }; to: { node: string; port: string } }
): WirePipelineDefinitionV2 {
  const declaration = (def.declarations ?? []).find((d) => d.id === declarationId);
  if (declaration === undefined) {
    throw new Error(`Declaration '${declarationId}' does not exist.`);
  }
  const nodeIds = new Set(
    ((declaration.graph?.nodes ?? []) as readonly { id: string }[]).map((node) => node.id)
  );
  for (const endpoint of [connection.from.node, connection.to.node]) {
    if (!nodeIds.has(endpoint)) {
      throw new Error(`Body stage '${endpoint}' does not exist in '${declarationId}'.`);
    }
  }
  const duplicate = (declaration.graph?.connections ?? []).some(
    (existing) =>
      existing.from.node === connection.from.node &&
      existing.to.node === connection.to.node
  );
  if (duplicate) {
    throw new Error(
      `'${connection.from.node}' is already connected to '${connection.to.node}'.`
    );
  }
  if (bodyWouldCreateCycle(def, declarationId, connection.from.node, connection.to.node)) {
    throw new Error(
      `Connecting '${connection.from.node}' to '${connection.to.node}' would create a cycle.`
    );
  }
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
