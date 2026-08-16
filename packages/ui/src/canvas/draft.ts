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
  PipelineCatalogSkill,
  PipelineStageHandoffConfig,
  PipelineVerifyPolicy,
  ThresholdValue,
  WireAtomicStageExecutionV1,
  WireAtomicStageNode,
  WireBoundedLoopLifecyclePolicyV1,
  WireBoundedLoopNode,
  WireCompositeDeclaration,
  WireConsultationBinding,
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
 * The region a refused back-edge `from -> to` closes
 * (canvas-backedge-loop-inference design D2): `{to, from}` plus every node
 * on a path between them — `{n | to ⇝* n ∧ n ⇝* from}` — computed over the
 * SAME adjacency builder {@link wouldCreateCycle} uses, so the region can
 * never disagree with the rule that recognized the draw as loop intent.
 * Both endpoints are always members (the existing path `to ⇝* from` is what
 * made the draw a refusal); a self-loop draw (`from === to`) yields exactly
 * that one node. Insertion order follows the draft's node order, so the set
 * is deterministic across runs.
 */
export function backedgeRegion(
  def: WirePipelineDefinition,
  from: string,
  to: string
): Set<string> {
  const adjacency = buildAdjacency(def);
  const region = new Set<string>([to, from]);
  const nodeIds = isV1Definition(def)
    ? def.stages.map((stage) => stage.id)
    : def.root.nodes.map((node) => node.id);
  for (const node of nodeIds) {
    if (region.has(node)) continue;
    // to ⇝* node (node is downstream of the edge's target) AND node ⇝* from
    // (node is upstream of the edge's source) — node lies on the cycle.
    if (reachesThrough(adjacency, node, to) && reachesThrough(adjacency, from, node)) {
      region.add(node);
    }
  }
  return region;
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
 * The author-meaningful gestures the ROOT palette offers (design D2). This
 * replaces `V2_ROOT_PALETTE_KINDS`, which mirrored the eight IR node kinds
 * 1:1 — an author never types "FanOut" or "Join", and the v2 Canvas should
 * not make them learn to. Lives beside `V2_BODY_PALETTE_KINDS` for the same
 * "one home" reason that comment already states: this portfolio has already
 * paid for drifting encodings of "which vocabulary is offered where", and a
 * `V2_ROOT_PALETTE_KINDS` left behind alongside this would be exactly that
 * drift again.
 */
export type V2RootGesture = 'stage' | 'parallel' | 'loop' | 'finish';

export const V2_ROOT_PALETTE_GESTURES: readonly V2RootGesture[] = [
  'stage',
  'parallel',
  'loop',
  'finish',
];

/**
 * Whether the Stage gesture may bind this catalog skill: it must be enabled in
 * the active profile AND carry an exact capability revision.
 *
 * Exported so the palette's card greying and the page's `exactCapabilities()`
 * — which is what produces the `stage` entry in `unavailableRootGestures`
 * below — read the SAME rule. Two encodings of "may this skill be bound" in
 * two modules is precisely the drift this module's vocabulary comment warns
 * about, and it is how `PalettePanel.tsx` came to contradict its own doc
 * comment in the first place.
 */
export function isBindableSkill(skill: PipelineCatalogSkill): boolean {
  return Boolean(skill.enabled && skill.capability);
}

/**
 * The gestures this draft cannot accept right now, and why — one rule read
 * by BOTH the palette's enablement and the insertion helpers below, so the
 * two can never drift the way `PalettePanel.tsx:48-51`'s hardcoded check
 * used to drift from its own doc comment.
 */
export function unavailableRootGestures(
  def: WirePipelineDefinitionV2,
  input: { exactCapabilities: readonly { id: string; version: string }[] }
): readonly V2RootGesture[] {
  const unavailable: V2RootGesture[] = [];
  if (input.exactCapabilities.length === 0) unavailable.push('stage');
  if (!def.root.nodes.some((node) => node.kind === 'AtomicStage')) {
    unavailable.push('parallel');
  }
  if (!loopBodyDeclaration(def)) unavailable.push('loop');
  return unavailable;
}

/**
 * Whether a declaration may be referenced by a root-level `CompositeRef`: a
 * custom declaration, or a built-in one that actually carries a body graph.
 *
 * Exported so a declaration row's insert action and `insertCompositeRef`
 * itself read the SAME rule — two independent readings of "can this
 * declaration be referenced right now" is exactly the drift this module's
 * vocabulary comment warns about.
 */
export function isReferenceableDeclaration(
  declaration: WireCompositeDeclaration
): boolean {
  return declaration.provenance !== 'built-in' || declaration.graph.nodes.length > 0;
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

/**
 * Gesture → IR composition (design D3). Each composes exactly the IR shape
 * the ROOT palette used to build inline in `PipelineCanvasPage.tsx`'s
 * `addV2RootNode` switch, now owned here so no panel re-decides a rule the
 * model owns. Each throws a plain `Error` with an author-readable message on
 * refusal; the page surfaces it as a toast.
 */

/** Stage gesture: one `AtomicStage` bound to the author's chosen capability. */
export function addAtomicStageForCapability(
  def: WirePipelineDefinitionV2,
  capability: { id: string; version: string }
): WirePipelineDefinitionV2 {
  const id = v2NodeIdFor('AtomicStage', def);
  const node: WireAtomicStageNode = {
    id,
    kind: 'AtomicStage',
    capability: { id: capability.id, version: capability.version },
    execution: {
      version: 1,
      role: 'implementer',
      workspace: { access: 'write' },
    },
  };
  return addV2Node(def, node);
}

/**
 * Parallel gesture: a complete fan-out + join frontier over every root
 * `AtomicStage`, created as one transaction via `createParallelPair`.
 */
export function addParallelFrontier(
  def: WirePipelineDefinitionV2
): WirePipelineDefinitionV2 {
  const members = def.root.nodes
    .filter((node): node is WireAtomicStageNode => node.kind === 'AtomicStage')
    .map((node) => node.id);
  if (members.length === 0) {
    throw new Error('Add an AtomicStage before authoring a parallel frontier.');
  }
  const fanOutId = v2NodeIdFor('FanOut', def);
  const joinId = v2NodeIdFor('Join', def);
  return createParallelPair(def, {
    fanOutId,
    joinId,
    memberNodeIds: members,
    requiredMemberIds: [members[0]!],
    concurrencyCap: Math.max(1, Math.min(3, members.length)),
    budget: Math.max(1, members.length),
    outcomes: {
      proceed: def.outcomes[0] ?? 'done',
      failed: def.outcomes[1] ?? 'failed',
    },
  });
}

/** Loop gesture: a `BoundedLoop` over the first declaration carrying a body graph. */
export function addBoundedLoopOverDeclaration(
  def: WirePipelineDefinitionV2
): WirePipelineDefinitionV2 {
  const declaration = loopBodyDeclaration(def);
  if (!declaration) {
    throw new Error('No declaration is available for a loop body.');
  }
  const id = v2NodeIdFor('BoundedLoop', def);
  const node: WireBoundedLoopNode = {
    id,
    kind: 'BoundedLoop',
    body: declaration.id,
    limits: { maxIterations: 3, maxActions: 12, budget: 12 },
    lifecycle: createDefaultBoundedLoopLifecycle(),
    exits: Object.fromEntries(
      declaration.outcomes.map((outcome, index) => [
        outcome,
        index === declaration.outcomes.length - 1
          ? { action: 'exit' as const, outcome: def.outcomes[0] ?? 'done' }
          : { action: 'continue' as const },
      ])
    ),
  };
  return addV2Node(def, node);
}

/** Finish gesture: a terminal node mapped to the definition's first outcome. */
export function addFinishNode(def: WirePipelineDefinitionV2): WirePipelineDefinitionV2 {
  const id = v2NodeIdFor('Finish', def);
  return addV2Node(def, { id, kind: 'Finish', outcome: def.outcomes[0] ?? 'done' });
}

/**
 * Declaration-row gesture (design D6): inserts a `CompositeRef` referencing
 * the CHOSEN declaration — the author picks the row, not the editor picking
 * the first referenceable one on their behalf.
 */
export function insertCompositeRef(
  def: WirePipelineDefinitionV2,
  declarationId: string
): WirePipelineDefinitionV2 {
  const declaration = (def.declarations ?? []).find((d) => d.id === declarationId);
  if (!declaration) {
    throw new Error(`Declaration '${declarationId}' does not exist.`);
  }
  if (!isReferenceableDeclaration(declaration)) {
    throw new Error(`Declaration '${declarationId}' has no body graph to reference.`);
  }
  const id = v2NodeIdFor('CompositeRef', def);
  return addV2Node(def, { id, kind: 'CompositeRef', declarationId: declaration.id });
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

export interface V2NodeRemovalRefusal {
  id: string;
  reason: string;
}

export interface V2NodeRemovalPlan {
  next: WirePipelineDefinitionV2;
  /** Every root node id actually gone from `next`, in draft order — including co-deleted barriers a pair removal carried away unselected. */
  removedIds: string[];
  refused: readonly V2NodeRemovalRefusal[];
}

/**
 * Best-effort batch removal over a set of selected root node ids
 * (canvas-multi-selection design D5). One call owns the whole delete:
 *
 * - A selected `FanOut` routes through `removeParallelPair` — its `Join`
 *   travels with it whether or not the Join was also selected.
 * - A lone selected `Join` (its FanOut not selected) is refused with
 *   `removeV2Node`'s existing paired-deletion message; same for a
 *   Gate-targeted node and a parallel pair's last member — every refusal
 *   reuses `removeV2Node`'s own thrown message verbatim, so this helper
 *   adds no new vocabulary.
 * - Kinds outside the editable vocabulary (a future engine node the UI
 *   does not know) are skipped silently and are NOT refusals — they were
 *   never selectable-editable.
 *
 * Best-effort, not atomic: eligible nodes delete while refusals collect.
 * The caller reports `refused` as ONE summary for the whole deletion.
 */
export function removeV2Nodes(
  def: WirePipelineDefinitionV2,
  ids: ReadonlySet<string>
): V2NodeRemovalPlan {
  const refusals: V2NodeRemovalRefusal[] = [];
  let next = def;
  // Selected FanOuts go FIRST: their pair removal deletes the whole
  // parallel unit's structure, so any selected members that follow are
  // judged as plain nodes instead of being refused as "the only parallel
  // member" of a FanOut the same batch is already deleting (an order
  // artifact a box-select of a frontier + its members would otherwise hit).
  for (const pass of ['pairs', 'rest'] as const) {
    for (const node of def.root.nodes) {
      if (!ids.has(node.id)) continue;
      if (pass === 'pairs' ? node.kind !== 'FanOut' : node.kind === 'FanOut') {
        continue;
      }
      // A pair removal can carry away an unselected (or not-yet-iterated)
      // Join before its own turn arrives.
      if (!next.root.nodes.some((candidate) => candidate.id === node.id)) {
        continue;
      }
      if (!isV2EditableNodeKind(node.kind)) continue;
      if (node.kind === 'FanOut') {
        try {
          next = removeParallelPair(next, node.id);
        } catch (error) {
          refusals.push({
            id: node.id,
            reason: removalRefusalMessage(node.id, error),
          });
        }
        continue;
      }
      if (node.kind === 'Join') {
        // Its FanOut is also selected: the pair is (or was) handled as one
        // unit at the FanOut, so this half is neither refused nor re-removed.
        const ownerSelected = def.root.nodes.some(
          (candidate) =>
            candidate.kind === 'FanOut' &&
            candidate.joinNodeId === node.id &&
            ids.has(candidate.id)
        );
        if (ownerSelected) continue;
        try {
          next = removeV2Node(next, node.id);
        } catch (error) {
          refusals.push({
            id: node.id,
            reason: removalRefusalMessage(node.id, error),
          });
        }
        continue;
      }
      try {
        next = removeV2Node(next, node.id);
      } catch (error) {
        refusals.push({
          id: node.id,
          reason: removalRefusalMessage(node.id, error),
        });
      }
    }
  }
  // "Actually deleted" is the before/after difference in draft order, so a
  // co-deleted barrier (or a member a pair removal carried away after its
  // own refusal was recorded) is reported as removed, and...
  const removedIds = def.root.nodes
    .map((node) => node.id)
    .filter((id) => !next.root.nodes.some((node) => node.id === id));
  // ...a refusal whose node no longer exists is not a refusal — a later
  // pair removal in the same batch resolved it.
  const refused = refusals.filter((refusal) =>
    next.root.nodes.some((node) => node.id === refusal.id)
  );
  return { next, removedIds, refused };
}

function removalRefusalMessage(id: string, error: unknown): string {
  return error instanceof Error
    ? error.message
    : `Node '${id}' could not be removed.`;
}

/**
 * Gate as a stage property (design D4). `GateNode` already *names* the stage
 * it guards (`target`), which is why it reads naturally as that stage's
 * property — in v1 it literally was one (`gate: boolean`).
 */

/** The `Gate` node targeting this stage, if any. */
export function gateForStage(
  def: WirePipelineDefinitionV2,
  stageId: string
): WireGateNode | undefined {
  return def.root.nodes.find(
    (node): node is WireGateNode => node.kind === 'Gate' && node.target === stageId
  );
}

/**
 * Turns approval on or off for a root `AtomicStage`. Enabling appends a
 * `Gate` with the Canvas's own default decision vocabulary
 * (`approved`/`rejected`, NOT `normalizeV1`'s `approve`/`reject`) so no
 * definition previously authored in the Canvas changes meaning. Disabling
 * routes through `removeV2Node`, which already drops the Gate's incident
 * connections. Enabling twice, or disabling with no gate present, is a no-op.
 */
export function setStageGate(
  def: WirePipelineDefinitionV2,
  stageId: string,
  enabled: boolean
): WirePipelineDefinitionV2 {
  const stage = def.root.nodes.find((node) => node.id === stageId);
  if (!stage || stage.kind !== 'AtomicStage') {
    throw new Error(`'${stageId}' is not a root AtomicStage.`);
  }
  const existing = gateForStage(def, stageId);
  if (enabled) {
    if (existing) return def;
    const id = v2NodeIdFor('Gate', def);
    const gate: WireGateNode = {
      id,
      kind: 'Gate',
      target: stageId,
      outcomes: ['approved', 'rejected'],
      dispositions: { approved: 'proceed', rejected: 'escalate' },
    };
    return addV2Node(def, gate);
  }
  if (!existing) return def;
  return removeV2Node(def, existing.id);
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

/**
 * Choice as a connection condition (design D5). Splicing rewrites one
 * connection `A:pOut -> B:pIn` into a branch point: `A:pOut -> choice:input`
 * and `choice:matched -> B:pIn`. Shape and vocabulary deliberately match what
 * `normalizeV1()` writes for a v1 `condition:` (`definition.ts:3581-3590`),
 * with ONE deliberate omission: `legacyRuntimeOwner` is never written.
 * `orchestrationEvaluatorCapabilityFor()` (`definition.ts:220-228`) reads its
 * ABSENCE as "authored, therefore requires a `choice-select` evaluator" —
 * forging it would silently exempt an authored Choice from that requirement.
 */
export function spliceConditionOntoConnection(
  def: WirePipelineDefinitionV2,
  connectionId: string,
  expression: string
): WirePipelineDefinitionV2 {
  const connection = def.root.connections.find((c) => c.id === connectionId);
  if (!connection) {
    throw new Error(`Connection '${connectionId}' does not exist.`);
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error('A branch condition cannot be blank.');
  }
  const sourceNode = def.root.nodes.find((n) => n.id === connection.from.node);
  const targetNode = def.root.nodes.find((n) => n.id === connection.to.node);
  if (
    !sourceNode ||
    !targetNode ||
    !isV2EditableNodeKind(sourceNode.kind) ||
    !isV2EditableNodeKind(targetNode.kind)
  ) {
    throw new Error('This connection touches a preserved read-only node.');
  }
  const choiceId = v2NodeIdFor('Choice', def);
  // `expression` is carried through `WireDefinitionNodeBase`'s index
  // signature, the same mechanism `normalizeV1()` relies on — no typed
  // interface change is needed and none is made.
  const choice: WireDefinitionNode = {
    id: choiceId,
    kind: 'Choice',
    outcomes: ['matched', 'skipped'],
    expression: trimmed,
  } as WireDefinitionNode;
  let next = removeV2Connection(def, connectionId);
  next = addV2Node(next, choice);
  const intoChoice: WireDefinitionConnection = {
    id: v2ConnectionIdFor(next, {
      source: connection.from.node,
      sourcePort: connection.from.port,
      target: choiceId,
      targetPort: CONTROL_TARGET_PORT,
    }),
    from: { node: connection.from.node, port: connection.from.port },
    to: { node: choiceId, port: CONTROL_TARGET_PORT },
  };
  next = addV2Connection(next, intoChoice);
  const outOfChoice: WireDefinitionConnection = {
    id: v2ConnectionIdFor(next, {
      source: choiceId,
      sourcePort: 'matched',
      target: connection.to.node,
      targetPort: connection.to.port,
    }),
    from: { node: choiceId, port: 'matched' },
    to: { node: connection.to.node, port: connection.to.port },
  };
  return addV2Connection(next, outOfChoice);
}

/**
 * Removes a spliced Choice and restores the direct connection from its
 * inbound source to its `matched` destination. Refuses, naming the wired
 * branch, when any outbound connection uses a port other than `matched` —
 * clearing the condition must never silently discard a wired `skipped`
 * branch.
 *
 * The arity guards below COUNT rather than `find`, and that is load-bearing:
 * `removeV2Node` drops EVERY connection incident on the Choice, while only one
 * inbound/`matched` pair can be restored. `onConnect` imposes no per-port arity
 * limit and `v2ConnectionIdFor` keys on both endpoints, so a second inbound
 * edge — or a `matched` port fanning out to a second target — is genuinely
 * reachable through ordinary drags, and a `find`-based restore would delete it
 * with no refusal and no toast. That is exactly the silent discard this
 * capability's own SHALL forbids.
 */
export function unspliceChoice(
  def: WirePipelineDefinitionV2,
  choiceId: string
): WirePipelineDefinitionV2 {
  const choice = def.root.nodes.find((node) => node.id === choiceId);
  if (!choice || choice.kind !== 'Choice') {
    throw new Error(`'${choiceId}' is not a Choice node.`);
  }
  const inboundAll = def.root.connections.filter((c) => c.to.node === choiceId);
  const outbound = def.root.connections.filter((c) => c.from.node === choiceId);
  const matchedAll = outbound.filter((c) => c.from.port === 'matched');
  const strayOut = outbound.filter((c) => c.from.port !== 'matched');
  if (strayOut.length > 0) {
    throw new Error(
      `Cannot remove this condition: branch '${strayOut[0]!.from.port}' is still wired to '${strayOut[0]!.to.node}'.`
    );
  }
  if (inboundAll.length > 1) {
    throw new Error(
      `Cannot remove this condition: '${choiceId}' has ${inboundAll.length} incoming connections (${inboundAll
        .map((c) => `'${c.from.node}'`)
        .join(', ')}); only one can be restored, so disconnect the others first.`
    );
  }
  if (matchedAll.length > 1) {
    throw new Error(
      `Cannot remove this condition: branch 'matched' is wired to ${matchedAll.length} targets (${matchedAll
        .map((c) => `'${c.to.node}'`)
        .join(', ')}); only one can be restored, so disconnect the others first.`
    );
  }
  const inbound = inboundAll[0];
  const matchedOut = matchedAll[0];
  let next = removeV2Node(def, choiceId);
  if (inbound && matchedOut) {
    const restored: WireDefinitionConnection = {
      id: v2ConnectionIdFor(next, {
        source: inbound.from.node,
        sourcePort: inbound.from.port,
        target: matchedOut.to.node,
        targetPort: matchedOut.to.port,
      }),
      from: { node: inbound.from.node, port: inbound.from.port },
      to: { node: matchedOut.to.node, port: matchedOut.to.port },
    };
    next = addV2Connection(next, restored);
  }
  return next;
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

// ===== Consultation binding draft helpers =====

/** Reads the consultations array from a v1 or v2 definition, defaulting to empty. */
function readConsultations(def: WirePipelineDefinition): WireConsultationBinding[] {
  return Array.isArray(def.consultations) ? def.consultations : [];
}

/** Writes the consultations array onto a new immutable copy of the definition. */
function writeConsultations<T extends WirePipelineDefinition>(
  def: T,
  consultations: WireConsultationBinding[]
): T {
  const next = { ...def } as T;
  if (consultations.length === 0) {
    delete (next as Record<string, unknown>).consultations;
  } else {
    (next as unknown as { consultations: WireConsultationBinding[] }).consultations = consultations;
  }
  return next;
}

/**
 * Partial consultation binding edit. Every field is optional — the patcher
 * merges only the named fields, preserving the rest of the binding verbatim.
 */
export interface ConsultationBindingPatch {
  teacherSkill?: string;
  maxConsultationsPerInvocation?: number;
  maxTeacherAttemptsPerConsultation?: number;
  limits?: Partial<WireConsultationBinding['limits']> | null;
}

/**
 * Appends a new consultation binding to the pipeline-level `consultations`
 * array. If a binding for the same `sourceStage` already exists, it is
 * replaced (one binding per source stage). Handles both v1 and v2 definitions.
 */
export function addConsultationBinding<T extends WirePipelineDefinition>(
  def: T,
  binding: WireConsultationBinding
): T {
  const existing = readConsultations(def);
  const filtered = existing.filter((b) => b.sourceStage !== binding.sourceStage);
  return writeConsultations(def, [...filtered, binding]);
}

/**
 * Patches a consultation binding by `sourceStage` id, preserving unpatched
 * fields. When `limits` is `null`, clears the limits sub-object; when an
 * object, merges its keys into the existing limits. When the binding does not
 * exist, returns the definition unchanged.
 */
export function updateConsultationBinding<T extends WirePipelineDefinition>(
  def: T,
  sourceStage: string,
  patch: ConsultationBindingPatch
): T {
  const existing = readConsultations(def);
  let found = false;
  const next = existing.map((b) => {
    if (b.sourceStage !== sourceStage) return b;
    found = true;
    const merged: WireConsultationBinding = { ...b };
    if (patch.teacherSkill !== undefined) merged.teacherSkill = patch.teacherSkill;
    if (patch.maxConsultationsPerInvocation !== undefined) {
      merged.maxConsultationsPerInvocation = patch.maxConsultationsPerInvocation;
    }
    if (patch.maxTeacherAttemptsPerConsultation !== undefined) {
      merged.maxTeacherAttemptsPerConsultation = patch.maxTeacherAttemptsPerConsultation;
    }
    if (patch.limits === null) {
      delete merged.limits;
    } else if (patch.limits !== undefined) {
      merged.limits = { ...(b.limits ?? {}), ...patch.limits };
    }
    return merged;
  });
  if (!found) return def;
  return writeConsultations(def, next);
}

/**
 * Removes the consultation binding whose `sourceStage` matches, if any.
 * When no binding exists, returns the definition unchanged.
 */
export function removeConsultationBinding<T extends WirePipelineDefinition>(
  def: T,
  sourceStage: string
): T {
  const existing = readConsultations(def);
  const filtered = existing.filter((b) => b.sourceStage !== sourceStage);
  if (filtered.length === existing.length) return def;
  return writeConsultations(def, filtered);
}

/**
 * Returns the consultation binding whose `sourceStage` matches the given stage
 * id, or `undefined` when no binding exists for that stage.
 */
export function getConsultationBindingForStage(
  def: WirePipelineDefinition,
  stageId: string
): WireConsultationBinding | undefined {
  return readConsultations(def).find((b) => b.sourceStage === stageId);
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
    }
  | {
      kind: 'consultation';
      index: number;
      sourceStage: string;
      field?: string;
    };

// ===== Canvas selection model (canvas-multi-selection design D1/D2) =====

/**
 * The canvas editor's selection: a set of node ids and a set of connection
 * ids, never a single chosen element. React Flow owns the interaction truth
 * (`node.selected`/`edge.selected`, driven by its Shift+drag box-select and
 * multi-select-key augmentation); the page keeps exactly ONE derived mirror
 * of this shape, written by `onSelectionChange` (user actions) and by the
 * explicit programmatic replacers at the gesture/rename/issue handlers.
 * Panels and the later portfolio children (subgraph extraction, loop
 * inference, frontier inference) consume `nodeIds` — never a re-derived
 * "what is selected" of their own.
 *
 * Lives here, beside `DefinitionIssueTarget`, because `draft.ts` is the one
 * home for canvas model vocabulary: a second encoding of "what does this
 * selection mean" in a panel would be exactly the drift this module's
 * vocabulary comments warn about.
 */
export interface CanvasSelection {
  nodeIds: ReadonlySet<string>;
  connectionIds: ReadonlySet<string>;
}

export const EMPTY_CANVAS_SELECTION: CanvasSelection = {
  nodeIds: new Set<string>(),
  connectionIds: new Set<string>(),
};

/**
 * The one selected node when the selection is exactly one node and nothing
 * else; `null` for every other shape (this is how singleton panel behavior
 * is preserved by derivation — a mixed or multi selection is not a node
 * selection).
 */
export function singletonNodeId(selection: CanvasSelection): string | null {
  if (selection.nodeIds.size !== 1 || selection.connectionIds.size > 0) {
    return null;
  }
  return [...selection.nodeIds][0]!;
}

/** The one selected connection when the selection is exactly one connection and nothing else; `null` otherwise. */
export function singletonConnectionId(selection: CanvasSelection): string | null {
  if (selection.connectionIds.size !== 1 || selection.nodeIds.size > 0) {
    return null;
  }
  return [...selection.connectionIds][0]!;
}

/**
 * Which right-column panel a selection opens: exactly one node → the node
 * panel; exactly one connection → the connection panel; two or more
 * elements, or any node+connection mix → the selection summary; nothing →
 * none. The page never re-derives this.
 */
export function selectionPanelMode(
  selection: CanvasSelection
): 'empty' | 'node' | 'connection' | 'multi' {
  const total = selection.nodeIds.size + selection.connectionIds.size;
  if (total === 0) return 'empty';
  if (total === 1) return selection.nodeIds.size === 1 ? 'node' : 'connection';
  return 'multi';
}

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
    if (!target) {
      // Consultation diagnostic: /consultations/<index>/<field>
      const consultationMatch = /^\/consultations\/(\d+)(?:\/(.+))?$/.exec(path);
      if (consultationMatch) {
        const index = Number(consultationMatch[1]);
        const consultations = Array.isArray(def.consultations) ? def.consultations : [];
        const sourceStage = consultations[index]?.sourceStage;
        if (!sourceStage) return null;
        return {
          kind: 'consultation',
          index,
          sourceStage,
          ...(consultationMatch[2] ? { field: consultationMatch[2] } : {}),
        };
      }
      return null;
    }
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

  // Consultation diagnostic: /consultations/<index>/<field>
  if (segments[0] === 'consultations') {
    const index = arrayIndex(segments[1], (def.consultations ?? []).length);
    if (index === null) return null;
    const sourceStage = def.consultations?.[index]?.sourceStage;
    if (!sourceStage) return null;
    return {
      kind: 'consultation',
      index,
      sourceStage,
      ...field(segments.slice(2)),
    };
  }

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

// ===== Subgraph extraction (canvas-subgraph-extraction design D1-D3) =====

/**
 * The prefix the engine's v1 normalizer writes into cross-node structural
 * references (`Gate.target`, `Join.inputs`, `FanOut.members[].hierarchicalPath`
 * — `src/core/pipeline-registry/definition.ts:3599`, `:3681-3692`) while
 * authored v2 writes raw ids. Reference checks below test BOTH forms, plus the
 * reverse hybrid (a prefixed node id referenced raw — the shape a definition
 * carrying definition-level consultations over v1-normalized nodes produces,
 * since `consultations[].sourceStage` mirrors the v1 stage id, not the node id).
 */
const STAGE_REFERENCE_PREFIX = 'stage:';

/**
 * Resolves a structural reference against the selected node ids, accepting
 * both authored forms. Returns the SELECTED node id the reference points at
 * (the id as it appears in the draft — what a refusal should name), or null.
 */
function referencedSelectedStage(
  reference: string,
  selected: ReadonlySet<string>
): string | null {
  if (selected.has(reference)) return reference;
  if (reference.startsWith(STAGE_REFERENCE_PREFIX)) {
    const raw = reference.slice(STAGE_REFERENCE_PREFIX.length);
    if (selected.has(raw)) return raw;
  }
  const prefixed = `${STAGE_REFERENCE_PREFIX}${reference}`;
  if (selected.has(prefixed)) return prefixed;
  return null;
}

/**
 * Why a selection cannot be packaged into a reusable declaration (design D3) —
 * empty array means extractable. Each entry is one author-readable blocker,
 * and the MODEL owns every rule:
 *
 * 1. The selection is non-empty and every selected node is an `AtomicStage`
 *    (`V2_BODY_PALETTE_KINDS` — the body vocabulary a spec forbids widening);
 *    any other kind is named.
 * 2. No OUTSIDE `Gate` targets a selected stage — a disposition cannot cross
 *    a declaration boundary, so a cut that would sever it is refused, not
 *    migrated.
 * 3. No OUTSIDE `FanOut` counts a selected stage among its branches or
 *    members (id or hierarchicalPath) — same boundary rule for parallel pairs.
 * 4. No OUTSIDE `Join` lists a selected stage in its inputs or member sets.
 * 5. No consultation binding names a selected stage as its source.
 *
 * "Outside" only matters for kinds rule 1 already refuses, but the checks are
 * written structurally so they hold regardless of what is selected.
 */
export function subgraphExtractionRefusals(
  def: WirePipelineDefinitionV2,
  selection: CanvasSelection
): string[] {
  return subgraphExtractionRefusalsForNodeIds(def, selection.nodeIds);
}

function subgraphExtractionRefusalsForNodeIds(
  def: WirePipelineDefinitionV2,
  selected: ReadonlySet<string>
): string[] {
  const refusals: string[] = [];
  if (selected.size === 0) {
    refusals.push('Select at least one stage to package into a reusable block.');
    return refusals;
  }
  for (const id of selected) {
    const node = def.root.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      refusals.push(`Node '${id}' does not exist in this draft.`);
      continue;
    }
    if (!V2_BODY_PALETTE_KINDS.includes(node.kind)) {
      refusals.push(
        `Only plain stages can be packaged into a reusable block — '${id}' is a ${node.kind}.`
      );
    }
  }
  for (const node of def.root.nodes) {
    if (selected.has(node.id)) continue;
    if (node.kind === 'Gate') {
      const hit = referencedSelectedStage(node.target, selected);
      if (hit) {
        refusals.push(
          `Stage '${hit}' is targeted by Gate '${node.id}' outside the selection.`
        );
      }
      continue;
    }
    if (node.kind === 'FanOut') {
      const references = [
        ...node.branches,
        ...node.members.flatMap((member) => [member.id, member.hierarchicalPath]),
      ];
      const hit = references
        .map((reference) => referencedSelectedStage(reference, selected))
        .find((hit): hit is string => hit !== null);
      if (hit) {
        refusals.push(
          `Stage '${hit}' is a branch or member of FanOut '${node.id}' outside the selection.`
        );
      }
      continue;
    }
    if (node.kind === 'Join') {
      const references = [
        ...node.inputs,
        ...node.requiredMembers,
        ...node.optionalMembers,
      ];
      const hit = references
        .map((reference) => referencedSelectedStage(reference, selected))
        .find((hit): hit is string => hit !== null);
      if (hit) {
        refusals.push(
          `Stage '${hit}' is an input of Join '${node.id}' outside the selection.`
        );
      }
    }
  }
  for (const binding of readConsultations(def)) {
    const hit = referencedSelectedStage(binding.sourceStage, selected);
    if (hit) {
      refusals.push(`Stage '${hit}' is referenced by a consultation binding.`);
    }
  }
  return refusals;
}

/** The derived contract a review dialog opens with (design D2) — review-editable defaults. */
export interface DerivedSubgraphContract {
  inputs: WireDefinitionPort[];
  artifacts: WireDefinitionArtifact[];
  outcomes: string[];
}

/** Joins node and port with the U+0000 separator below, so ids containing `stage:`-style colons cannot forge key collisions. */
const CUT_KEY_SEPARATOR = String.fromCharCode(0);
function cutKey(node: string, port: string): string {
  return node + CUT_KEY_SEPARATOR + port;
}

/**
 * Enumerates the cut a node set implies, in draft connection order: the
 * distinct severed-incoming `(target stage, target port)` pairs and the
 * distinct severed-outgoing `(source stage, source port)` pairs. Parallel to
 * the rows {@link deriveSubgraphContract} derives and the mapping
 * {@link extractSubgraph} rewires through — one enumeration, three readers.
 */
function computeSubgraphCut(
  def: WirePipelineDefinitionV2,
  nodeIds: ReadonlySet<string>
): { incomingKeys: string[]; outgoingKeys: string[] } {
  const incomingKeys: string[] = [];
  const outgoingKeys: string[] = [];
  for (const connection of def.root.connections) {
    if (nodeIds.has(connection.to.node) && !nodeIds.has(connection.from.node)) {
      const key = cutKey(connection.to.node, connection.to.port);
      if (!incomingKeys.includes(key)) incomingKeys.push(key);
    } else if (
      nodeIds.has(connection.from.node) &&
      !nodeIds.has(connection.to.node)
    ) {
      const key = cutKey(connection.from.node, connection.from.port);
      if (!outgoingKeys.includes(key)) outgoingKeys.push(key);
    }
  }
  return { incomingKeys, outgoingKeys };
}

/** `base`, then `base-2`, `base-3`, … — the `v2NodeIdFor` suffix convention. */
function suffixedName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  const name = `${base}-${suffix}`;
  used.add(name);
  return name;
}

/**
 * Derives the declaration contract a cut implies (design D2), all defaults the
 * review may edit:
 *
 * - One input port per distinct severed-incoming `(target stage, port)`,
 *   named after the target stage (suffixed on collision), typed by the severed
 *   edge's target port (typically `CONTROL_TARGET_PORT`), `required` unset.
 * - One outcome per distinct severed-outgoing `(source stage, port)`, named
 *   after the source stage (suffixed on collision); when no outgoing edge is
 *   severed, the single default outcome `'done'` (`addDeclaration`'s own).
 * - Artifacts default to `[]` — control edges carry no artifact semantics.
 */
export function deriveSubgraphContract(
  def: WirePipelineDefinitionV2,
  nodeIds: ReadonlySet<string>
): DerivedSubgraphContract {
  const { incomingKeys, outgoingKeys } = computeSubgraphCut(def, nodeIds);
  const usedInputNames = new Set<string>();
  const inputs = incomingKeys.map((key) => {
    const [node, port] = key.split(CUT_KEY_SEPARATOR);
    return {
      name: suffixedName(node!, usedInputNames),
      type: port!,
    };
  });
  const usedOutcomeNames = new Set<string>();
  const outcomes = outgoingKeys.map((key) =>
    suffixedName(key.split(CUT_KEY_SEPARATOR)[0]!, usedOutcomeNames)
  );
  return {
    inputs,
    artifacts: [],
    outcomes: outcomes.length > 0 ? outcomes : ['done'],
  };
}

/** The reviewed contract plus which nodes move — {@link extractSubgraph}'s input. */
export interface SubgraphExtractionInput {
  nodeIds: ReadonlySet<string>;
  id: string;
  inputs: WireDefinitionPort[];
  artifacts: WireDefinitionArtifact[];
  outcomes: string[];
}

export interface SubgraphExtractionResult {
  next: WirePipelineDefinitionV2;
  declarationId: string;
  refId: string;
}

/**
 * The one extraction transaction (design D1): moves the selected plain stages
 * into a new custom Composite declaration, replaces them in the root graph
 * with one `CompositeRef`, and rewires every severed crossing connection onto
 * the ref's mapped ports. Pure — returns the next definition, never mutates.
 *
 * The dialog is not trusted: refusals are re-run here, the reviewed id is
 * validated by the same blank/unique rules `addDeclaration` enforces, and the
 * reviewed rows by `assertNamedContractRows`/`assertNamedOutcomes`. Severed
 * edges map onto reviewed rows POSITIONALLY in derivation order — a renamed
 * row renames the port its edge lands on; a deleted derived row leaves its
 * edge on the derived default name (and the definition may then validate red —
 * the Validate button stays the authority, the design's stated posture).
 *
 * Content preservation: moved stages and internal connections are the SAME
 * values (verbatim, ids included — body ids are declaration-scoped); crossing
 * connections keep every extension field via the spread, with only identity
 * and the rewritten endpoint changed (`v2ConnectionIdFor` convention). Nothing
 * is stamped `legacyRuntimeOwner` — the ref is built by `insertCompositeRef`
 * with exactly `{ id, kind, declarationId }`.
 *
 * Internally two steps (canvas-backedge-loop-inference design D3) —
 * {@link extractSubgraphIntoDeclaration} (validate + declare + remove from
 * root) and {@link rewireCrossingsOnto} (the positional cut rewire,
 * parameterized by the replacement node) — so the back-edge loop path reuses
 * the same rules with a `BoundedLoop` as the replacement instead of
 * duplicating them. One implementation of every rule; only the replacement
 * node differs.
 */
export function extractSubgraph(
  def: WirePipelineDefinitionV2,
  input: SubgraphExtractionInput
): SubgraphExtractionResult {
  const derived = deriveSubgraphContract(def, input.nodeIds);
  const { next: declared, declarationId } = extractSubgraphIntoDeclaration(def, input);
  // Appended through the same gesture `insertCompositeRef` runs, so its
  // existence/referenceability checks execute against the just-created
  // declaration; the id minted here is the one it appends (same root state).
  const refId = v2NodeIdFor('CompositeRef', declared);
  const next = rewireCrossingsOnto(
    insertCompositeRef(declared, declarationId),
    def,
    input.nodeIds,
    refId,
    input,
    derived
  );
  return { next, declarationId, refId };
}

/**
 * Extraction step one: re-run every refusal and id/row rule, then move the
 * node set into a new custom Composite declaration and out of the root graph
 * (verbatim values, ids included). Leaves the replacement to the caller —
 * `extractSubgraph` inserts a `CompositeRef`, the back-edge loop path mints a
 * `BoundedLoop`.
 */
function extractSubgraphIntoDeclaration(
  def: WirePipelineDefinitionV2,
  input: SubgraphExtractionInput
): { next: WirePipelineDefinitionV2; declarationId: string } {
  const refusals = subgraphExtractionRefusalsForNodeIds(def, input.nodeIds);
  if (refusals.length > 0) {
    throw new Error(refusals.join(' '));
  }
  if (input.id.trim().length === 0) {
    throw new Error('A declaration id cannot be blank.');
  }
  if (!isDeclarationIdUnique(def, input.id)) {
    throw new Error(`Declaration id '${input.id}' already exists.`);
  }
  assertNamedContractRows('declaration input', input.inputs);
  assertNamedContractRows('declaration artifact', input.artifacts);
  assertNamedOutcomes('declaration', input.outcomes);

  const declaration: WireCompositeDeclaration = {
    id: input.id,
    kind: 'Composite',
    provenance: 'custom',
    inputs: input.inputs,
    artifacts: input.artifacts,
    outcomes: input.outcomes,
    graph: {
      nodes: def.root.nodes.filter((node) => input.nodeIds.has(node.id)),
      connections: def.root.connections.filter(
        (connection) =>
          input.nodeIds.has(connection.from.node) &&
          input.nodeIds.has(connection.to.node)
      ),
    },
  };
  const next: WirePipelineDefinitionV2 = {
    ...def,
    declarations: [...def.declarations, declaration],
    root: {
      ...def.root,
      nodes: def.root.nodes.filter((node) => !input.nodeIds.has(node.id)),
      connections: def.root.connections.filter(
        (connection) =>
          !input.nodeIds.has(connection.from.node) &&
          !input.nodeIds.has(connection.to.node)
      ),
    },
  };
  return { next, declarationId: input.id };
}

/**
 * Extraction step two: rewire every root connection that crossed the moved
 * node set onto the REPLACEMENT node's mapped ports — positionally onto the
 * reviewed rows in derivation order, with the derived names as fallback
 * (`extractSubgraph`'s documented rule, unchanged). `preExtractionDef` is the
 * definition the cut was taken from (the caller's pre-state); `next` is the
 * post-declaration state the rewired connections land on.
 */
function rewireCrossingsOnto(
  next: WirePipelineDefinitionV2,
  preExtractionDef: WirePipelineDefinitionV2,
  nodeIds: ReadonlySet<string>,
  replacementId: string,
  rows: {
    inputs: readonly WireDefinitionPort[];
    outcomes: readonly string[];
  },
  derived: {
    inputs: readonly WireDefinitionPort[];
    outcomes: readonly string[];
  }
): WirePipelineDefinitionV2 {
  const { incomingKeys, outgoingKeys } = computeSubgraphCut(preExtractionDef, nodeIds);
  let result = next;
  for (const connection of preExtractionDef.root.connections) {
    if (nodeIds.has(connection.to.node) && !nodeIds.has(connection.from.node)) {
      const index = incomingKeys.indexOf(cutKey(connection.to.node, connection.to.port));
      const port = rows.inputs[index]?.name ?? derived.inputs[index]!.name;
      const id = v2ConnectionIdFor(result, {
        source: connection.from.node,
        sourcePort: connection.from.port,
        target: replacementId,
        targetPort: port,
      });
      result = addV2Connection(result, {
        ...connection,
        id,
        to: { node: replacementId, port },
      });
    } else if (
      nodeIds.has(connection.from.node) &&
      !nodeIds.has(connection.to.node)
    ) {
      const index = outgoingKeys.indexOf(
        cutKey(connection.from.node, connection.from.port)
      );
      const port = rows.outcomes[index] ?? derived.outcomes[index]!;
      const id = v2ConnectionIdFor(result, {
        source: replacementId,
        sourcePort: port,
        target: connection.to.node,
        targetPort: connection.to.port,
      });
      result = addV2Connection(result, {
        ...connection,
        id,
        from: { node: replacementId, port },
      });
    }
  }
  return result;
}

// ===== Back-edge loop synthesis (canvas-backedge-loop-inference design D3-D5) =====

/** The reviewed loop synthesis — {@link synthesizeBoundedLoopFromBackedge}'s input. */
export interface BackedgeLoopSynthesisInput {
  /** The drawn back-edge's source node (the edge was never written to the draft). */
  from: string;
  /** The drawn back-edge's target node. */
  to: string;
  id: string;
  inputs: WireDefinitionPort[];
  artifacts: WireDefinitionArtifact[];
  outcomes: string[];
  /** The author's iteration bound — a positive integer. */
  maxIterations: number;
  /** The definition outcome the loop's exit resolves to. */
  exitOutcome: string;
}

export interface BackedgeLoopSynthesisResult {
  next: WirePipelineDefinitionV2;
  declarationId: string;
  loopId: string;
}

/**
 * The one loop-synthesis transaction (design D3/D4): turns a refused
 * cycle-closing draw into a `BoundedLoop` over the region the edge closes.
 * Region -> refusals -> declare (child-2's extraction, via
 * `extractSubgraphIntoDeclaration`) -> mint the loop exactly like
 * `addBoundedLoopOverDeclaration` except `body` = the just-extracted
 * declaration and `limits.maxIterations` = the author's bound -> rewire the
 * crossings onto the loop's ports (`rewireCrossingsOnto`). No `CompositeRef`
 * is inserted — the loop IS the replacement. Pure; never mutates.
 *
 * The drawn back-edge itself never entered the draft (`onConnect` refuses it
 * before writing), so nothing must be excluded from the body move: the
 * connections that move are the region's internal edges, all acyclic. The
 * back-edge exists only as loop semantics.
 *
 * The review is not trusted: the region is recomputed from the endpoints, the
 * child-2 refusals/id/row validators re-run, and the bound must be a positive
 * integer (the review's integer field blocks confirm client-side; the model
 * re-owns the rule). Nothing is stamped `legacyRuntimeOwner`.
 */
export function synthesizeBoundedLoopFromBackedge(
  def: WirePipelineDefinitionV2,
  input: BackedgeLoopSynthesisInput
): BackedgeLoopSynthesisResult {
  const region = backedgeRegion(def, input.from, input.to);
  const { next: declared, declarationId } = extractSubgraphIntoDeclaration(def, {
    nodeIds: region,
    id: input.id,
    inputs: input.inputs,
    artifacts: input.artifacts,
    outcomes: input.outcomes,
  });
  if (!Number.isSafeInteger(input.maxIterations) || input.maxIterations <= 0) {
    throw new Error('Loop maximum iterations must be a positive integer.');
  }
  const declaration = declared.declarations.find((d) => d.id === declarationId)!;
  const loopId = v2NodeIdFor('BoundedLoop', declared);
  const loopNode: WireBoundedLoopNode = {
    id: loopId,
    kind: 'BoundedLoop',
    body: declarationId,
    limits: { maxIterations: input.maxIterations, maxActions: 12, budget: 12 },
    lifecycle: createDefaultBoundedLoopLifecycle(),
    exits: Object.fromEntries(
      declaration.outcomes.map((outcome, index) => [
        outcome,
        index === declaration.outcomes.length - 1
          ? { action: 'exit' as const, outcome: input.exitOutcome }
          : { action: 'continue' as const },
      ])
    ),
  };
  const next = rewireCrossingsOnto(
    addV2Node(declared, loopNode),
    def,
    region,
    loopId,
    input,
    deriveSubgraphContract(def, region)
  );
  return { next, declarationId, loopId };
}
