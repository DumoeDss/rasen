import type { PreparedDefinition } from '../../pipeline-registry/definition.js';
import { definitionRequiresV2Lowering } from '../../pipeline-registry/definition.js';
import type {
  AtomicStageNode,
  BoundedLoopNode,
  CompositeDeclaration,
  CompositeRefNode,
  DefinitionNode,
  DefinitionSourceV2,
  FanOutNode,
  GateNode,
  JoinNode,
} from '../../pipeline-registry/definition.js';
import {
  sealRuntimeExecutionPlan,
  type RuntimeExecutionProfile,
} from '../../pipeline-registry/execution-plan-internal.js';
import type { PipelineYaml } from '../../pipeline-registry/types.js';
import type { Digest, RunId } from '../contracts.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanGateInput,
  type RuntimePlanInput,
  type RuntimePlanNodeInput,
} from './runtime-plan.js';

/**
 * The private runtime-plan lowerer (task 3.2). It bridges the public
 * Definition + RuntimeExecutionProfile model to the private RuntimePlan the
 * pure reconciler consumes, so the reconciler runs on real plans rather than
 * hand-built fixtures.
 *
 * Only the supported v1 bug-fix root-DAG shape is lowered in this slice
 * (matching `analyzeReconcilerSupport`); Composite/BoundedLoop/GoalLoop/
 * FanOut/Join authored semantics are rejected by `createRuntimePlan` after
 * lowering, never silently interpreted.
 */
export interface LoweredGatePolicy {
  readonly decisionIds: readonly string[];
  readonly outcomes: Readonly<Record<string, 'proceed' | 'fail' | 'escalate'>>;
}

export const DEFAULT_LOWERED_GATE_POLICY: LoweredGatePolicy = Object.freeze({
  decisionIds: Object.freeze(['approve', 'reject']),
  outcomes: Object.freeze({ approve: 'proceed', reject: 'escalate' }),
});

export type RuntimePlanLowererErrorCode =
  | 'unsupported_definition_version'
  | 'lowerer_shape_mismatch';

export class RuntimePlanLowererError extends Error {
  constructor(
    readonly code: RuntimePlanLowererErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RuntimePlanLowererError';
  }
}

function gateInput(
  stageId: string,
  policy: LoweredGatePolicy
): RuntimePlanGateInput {
  return {
    gateId: `${stageId}-gate`,
    decisionIds: [...policy.decisionIds],
    outcomes: { ...policy.outcomes },
  };
}

const REVIEW_CYCLE_PHASES = [
  'review',
  'triage',
  'fix',
  're-review',
] as const;

const GOAL_CYCLE_PHASES = ['work', 'judge'] as const;

function incomingRequirements(
  definition: DefinitionSourceV2,
  nodeId: string
): readonly string[] {
  return definition.root.connections
    .filter((connection) => connection.to.node === nodeId)
    .map((connection) => `root:${connection.from.node}`)
    .sort();
}

function boundedLoopContract(loop: BoundedLoopNode): Pick<
  RuntimePlanNodeInput,
  'limits' | 'lifecycle' | 'strategyProfilePath'
> {
  if (loop.limits.maxActions === undefined || loop.limits.budget === undefined) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `BoundedLoop ${loop.id} is missing normalized loop-local limits.`
    );
  }
  return {
    limits: {
      maxIterations: loop.limits.maxIterations,
      maxActions: loop.limits.maxActions,
      budget: loop.limits.budget,
    },
    lifecycle: structuredClone(loop.lifecycle),
    ...(loop.lifecycle.strategy.capability === undefined
      ? {}
      : { strategyProfilePath: `root:${loop.id}/strategy` }),
  };
}

function reviewCycleBody(
  definition: DefinitionSourceV2,
  loop: BoundedLoopNode
): Readonly<{
  declaration: CompositeDeclaration;
  phases: readonly Readonly<{
    phase: (typeof REVIEW_CYCLE_PHASES)[number];
    node: AtomicStageNode;
    profilePath: string;
  }>[];
}> {
  const declaration = definition.declarations.find(
    (candidate) => candidate.id === loop.body
  );
  if (declaration === undefined) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `BoundedLoop ${loop.id} references missing body ${loop.body}.`
    );
  }
  const phases = declaration.graph.nodes.map((node) => {
    if (node.kind !== 'AtomicStage') {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `ReviewCycle body ${declaration.id} may contain only AtomicStage phases in this slice.`
      );
    }
    const phase = node.reviewCyclePhase;
    if (
      typeof phase !== 'string' ||
      !(REVIEW_CYCLE_PHASES as readonly string[]).includes(phase)
    ) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `ReviewCycle body node ${node.id} must declare one reviewCyclePhase.`
      );
    }
    return {
      phase: phase as (typeof REVIEW_CYCLE_PHASES)[number],
      node,
      profilePath: `declaration:${declaration.id}/node:${node.id}`,
    };
  });
  phases.sort(
    (left, right) =>
      REVIEW_CYCLE_PHASES.indexOf(left.phase) -
      REVIEW_CYCLE_PHASES.indexOf(right.phase)
  );
  if (
    phases.length !== REVIEW_CYCLE_PHASES.length ||
    phases.some((entry, index) => entry.phase !== REVIEW_CYCLE_PHASES[index])
  ) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `ReviewCycle body ${declaration.id} must declare each phase exactly once.`
    );
  }
  const nodeByPhase = new Map(phases.map((entry) => [entry.phase, entry.node.id]));
  const requiredEdges = [
    ['review', 'triage'],
    ['triage', 'fix'],
    ['fix', 're-review'],
  ] as const;
  for (const [from, to] of requiredEdges) {
    const found = declaration.graph.connections.some(
      (connection) =>
        connection.from.node === nodeByPhase.get(from) &&
        connection.to.node === nodeByPhase.get(to)
    );
    if (!found) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `ReviewCycle body ${declaration.id} must connect ${from} to ${to}.`
      );
    }
  }
  return { declaration, phases };
}

/**
 * Detect whether a BoundedLoop's declaration body is goal-cycle-shaped
 * (2 AtomicStage nodes tagged with goalCyclePhase: work, judge).
 */
function isGoalCycleShaped(
  definition: DefinitionSourceV2,
  loop: BoundedLoopNode
): boolean {
  const declaration = definition.declarations.find(
    (candidate) => candidate.id === loop.body
  );
  if (declaration === undefined) return false;
  const phases = declaration.graph.nodes
    .map((bodyNode) =>
      bodyNode.kind === 'AtomicStage'
        ? (bodyNode as Readonly<{ goalCyclePhase?: unknown }>).goalCyclePhase
        : undefined
    )
    .filter((phase): phase is NonNullable<typeof phase> => phase !== undefined)
    .sort();
  return (
    phases.length === 2 &&
    JSON.stringify(phases) === JSON.stringify(['judge', 'work'])
  );
}

/**
 * Lower a goal-cycle BoundedLoop: produces the variant + 2 phases (work, judge)
 * with their capability/policy bindings.
 */
function goalCycleBody(
  definition: DefinitionSourceV2,
  loop: BoundedLoopNode,
  capabilityByPath: Map<string, RuntimeExecutionProfile['capabilities'][number]>,
  policyByPath: Map<string, RuntimeExecutionProfile['policy']['stages'][number]>
): Readonly<{
  declaration: CompositeDeclaration;
  variant: 'measure' | 'evaluate' | 'research';
  phases: readonly Readonly<{
    phase: (typeof GOAL_CYCLE_PHASES)[number];
    profilePath: string;
    admissionKind: 'agent' | 'command' | 'host';
    workspace: Readonly<{ access: 'none' | 'read' | 'write' }>;
  }>[];
}> {
  const declaration = definition.declarations.find(
    (candidate) => candidate.id === loop.body
  );
  if (declaration === undefined) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `BoundedLoop ${loop.id} references missing body ${loop.body}.`
    );
  }
  // Preparation requires and canonicalizes the typed variant for every
  // GoalLoop-shaped body, including v1 compatibility normalization. The
  // lowerer must never recover missing authored meaning from a package name or
  // a legacy payload.
  const variant = loop.goalCycleVariant;
  if (variant === undefined) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `GoalCycle loop ${loop.id} must declare goalCycleVariant.`
    );
  }

  const phaseEntries = declaration.graph.nodes.map((node) => {
    if (node.kind !== 'AtomicStage') {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `GoalCycle body ${declaration.id} may contain only AtomicStage phases.`
      );
    }
    const phase = node.goalCyclePhase;
    if (
      typeof phase !== 'string' ||
      !(GOAL_CYCLE_PHASES as readonly string[]).includes(phase)
    ) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `GoalCycle body node ${node.id} must declare one goalCyclePhase.`
      );
    }
    return {
      phase: phase as (typeof GOAL_CYCLE_PHASES)[number],
      node,
      profilePath: `declaration:${declaration.id}/node:${node.id}`,
    };
  });
  phaseEntries.sort(
    (left, right) =>
      GOAL_CYCLE_PHASES.indexOf(left.phase) -
      GOAL_CYCLE_PHASES.indexOf(right.phase)
  );
  if (
    phaseEntries.length !== GOAL_CYCLE_PHASES.length ||
    phaseEntries.some((entry, index) => entry.phase !== GOAL_CYCLE_PHASES[index])
  ) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `GoalCycle body ${declaration.id} must declare each phase (work, judge) exactly once.`
    );
  }
  // Validate the work→judge connection exists.
  const workNode = phaseEntries.find((p) => p.phase === 'work')!.node.id;
  const judgeNode = phaseEntries.find((p) => p.phase === 'judge')!.node.id;
  const hasConnection = declaration.graph.connections.some(
    (conn) => conn.from.node === workNode && conn.to.node === judgeNode
  );
  if (!hasConnection) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `GoalCycle body ${declaration.id} must connect work to judge.`
    );
  }

  const phases = phaseEntries.map((entry) => {
    const capability = capabilityByPath.get(entry.profilePath);
    const policy = policyByPath.get(entry.profilePath);
    if (capability === undefined || policy === undefined) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `No frozen capability/policy binding exists for ${entry.profilePath}.`
      );
    }
    return {
      phase: entry.phase,
      profilePath: entry.profilePath,
      admissionKind: capability.actionKind,
      workspace: { access: capability.workspace.access },
    };
  });
  return { declaration, variant, phases };
}

/**
 * Detect whether a BoundedLoop's declaration body is ReviewCycle-shaped
 * (4 AtomicStage nodes tagged with reviewCyclePhase in the canonical order).
 */
function isReviewCycleShaped(
  definition: DefinitionSourceV2,
  loop: BoundedLoopNode
): boolean {
  const declaration = definition.declarations.find(
    (candidate) => candidate.id === loop.body
  );
  if (declaration === undefined) return false;
  const phases = declaration.graph.nodes
    .map((bodyNode) =>
      bodyNode.kind === 'AtomicStage'
        ? bodyNode.reviewCyclePhase
        : undefined
    )
    .filter((phase): phase is NonNullable<typeof phase> => phase !== undefined)
    .sort();
  return (
    phases.length === 4 &&
    JSON.stringify(phases) ===
      JSON.stringify(['fix', 're-review', 'review', 'triage'])
  );
}

/**
 * Lower a BoundedLoop with a non-ReviewCycle composite body. The body
 * declaration's AtomicStages are collected in topological order as
 * RuntimePlanCompositeStageInput entries, and the loop's exits are translated
 * into the body outcomes map.
 */
function compositeLoopBody(
  definition: DefinitionSourceV2,
  loop: BoundedLoopNode,
  capabilityByPath: Map<string, RuntimeExecutionProfile['capabilities'][number]>,
  policyByPath: Map<string, RuntimeExecutionProfile['policy']['stages'][number]>
): Readonly<{
  declaration: CompositeDeclaration;
  stages: readonly Readonly<{
    hierarchicalPath: string;
    profilePath: string;
    admissionKind: 'agent' | 'command' | 'host';
    workspace: Readonly<{ access: 'none' | 'read' | 'write' }>;
    requires: readonly string[];
  }>[];
  bodyOutcomes: Readonly<Record<string, string>>;
}> {
  const declaration = definition.declarations.find(
    (candidate) => candidate.id === loop.body
  );
  if (declaration === undefined) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `BoundedLoop ${loop.id} references missing body ${loop.body}.`
    );
  }
  const body = compositeDeclarationBody(definition, declaration);
  const loopPrefix = `root:${loop.id}`;
  const stages = body.stages.map((stage) => {
    const hierarchicalPath = `${loopPrefix}/${stage.node.id}`;
    const profilePath = stage.profilePath;
    const capability = capabilityByPath.get(profilePath);
    const policy = policyByPath.get(profilePath);
    if (capability === undefined) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `No frozen capability/policy binding exists for ${profilePath}.`
      );
    }
    if (policy === undefined) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `No effective policy for ${profilePath}.`
      );
    }
    return {
      hierarchicalPath,
      profilePath,
      admissionKind: capability.actionKind,
      workspace: { access: capability.workspace.access },
      requires: stage.bodyRequires.map((dep) => `${loopPrefix}/${dep}`),
    };
  });

  // Build the body outcomes map from the loop's exits.
  // An exit with action: 'exit' maps the body outcome to the exit outcome.
  // An exit with action: 'continue' maps to itself (loop continues).
  const bodyOutcomes: Record<string, string> = {};
  for (const [bodyOutcome, exit] of Object.entries(loop.exits)) {
    if (exit.action === 'exit') {
      bodyOutcomes[bodyOutcome] = exit.outcome;
    } else {
      bodyOutcomes[bodyOutcome] = 'continue';
    }
  }

  return { declaration, stages, bodyOutcomes };
}

/**
 * Collect the AtomicStage body from a CompositeDeclaration, validate it is a
 * flat DAG (no nested CompositeRef/BoundedLoop/Choice/FanOut/Join), and return
 * the stages in topological order with their body-internal dependencies.
 */
function compositeDeclarationBody(
  definition: DefinitionSourceV2,
  declaration: CompositeDeclaration
): Readonly<{
  stages: readonly Readonly<{
    node: AtomicStageNode;
    profilePath: string;
    bodyRequires: readonly string[];
  }>[];
}> {
  const bodyNodes = declaration.graph.nodes;
  // Validate flat AtomicStage-only DAG.
  for (const bodyNode of bodyNodes) {
    if (bodyNode.kind !== 'AtomicStage') {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `Composite declaration ${declaration.id} body may contain only AtomicStage nodes (found ${bodyNode.kind}).`
      );
    }
  }
  // Collect body-internal dependencies per stage.
  const bodyConnections = declaration.graph.connections;
  const bodyRequires = new Map<string, string[]>();
  for (const stage of bodyNodes) {
    bodyRequires.set(stage.id, []);
  }
  for (const conn of bodyConnections) {
    const toList = bodyRequires.get(conn.to.node);
    if (toList !== undefined) {
      toList.push(conn.from.node);
    }
  }
  // Topological sort of body stages (Kahn's).
  const stageIds = bodyNodes.map((n) => n.id);
  const inDegree = new Map<string, number>(
    stageIds.map((id) => [id, (bodyRequires.get(id) ?? []).length])
  );
  const sorted: string[] = [];
  const queue = stageIds
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort();
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    // Find stages that depend on this one.
    const dependents = stageIds
      .filter((other) => (bodyRequires.get(other) ?? []).includes(id))
      .sort();
    for (const dep of dependents) {
      const deg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, deg);
      if (deg === 0) {
        // Insert in sorted position.
        const insertAt = queue.findIndex((q) => q > dep);
        if (insertAt === -1) queue.push(dep);
        else queue.splice(insertAt, 0, dep);
      }
    }
  }
  if (sorted.length !== stageIds.length) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `Composite declaration ${declaration.id} body contains a cycle.`
    );
  }
  const stages = sorted.map((id) => {
    const node = bodyNodes.find((n) => n.id === id) as AtomicStageNode;
    return {
      node,
      profilePath: `declaration:${declaration.id}/node:${id}`,
      bodyRequires: [...(bodyRequires.get(id) ?? [])].sort(),
    };
  });
  return { stages };
}

/**
 * Inline a root-level CompositeRef node into atomic RuntimePlanNodeInput
 * entries. Each body AtomicStage becomes an atomic node with a hierarchical
 * path `root:<refId>/<stageId>`. Entry stages (no incoming body connections)
 * inherit the CompositeRef's root-level requires. Terminal stages (no outgoing
 * body connections) are recorded so root-level dependents can map to them.
 */
function compositeRefBody(
  definition: DefinitionSourceV2,
  ref: CompositeRefNode
): Readonly<{
  nodes: readonly RuntimePlanNodeInput[];
  terminalPaths: readonly string[];
}> {
  const declaration = definition.declarations.find(
    (candidate) => candidate.id === ref.declarationId
  );
  if (declaration === undefined) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `CompositeRef ${ref.id} references missing declaration ${ref.declarationId}.`
    );
  }
  const { stages } = compositeDeclarationBody(definition, declaration);
  const rootRequires = incomingRequirements(definition, ref.id);
  const prefix = `root:${ref.id}`;
  // Determine entry stages (no body-internal incoming connections).
  const entryStageIds = new Set(
    stages.filter((s) => s.bodyRequires.length === 0).map((s) => s.node.id)
  );
  // Determine terminal stages (not consumed by another body stage connection).
  const consumedStageIds = new Set<string>();
  for (const stage of stages) {
    for (const dep of stage.bodyRequires) {
      consumedStageIds.add(dep);
    }
  }
  const terminalStageIds = stages
    .filter((s) => !consumedStageIds.has(s.node.id))
    .map((s) => s.node.id);

  const nodes: readonly Readonly<{
    kind: 'atomic';
    hierarchicalPath: string;
    requires: readonly string[];
    profilePath: string;
  }>[] = stages.map((stage) => {
    const hierarchicalPath = `${prefix}/${stage.node.id}`;
    const requires =
      stage.bodyRequires.length > 0
        ? stage.bodyRequires.map((dep) => `${prefix}/${dep}`)
        : entryStageIds.has(stage.node.id)
          ? [...rootRequires]
          : [];
    return {
      kind: 'atomic' as const,
      hierarchicalPath,
      requires,
      profilePath: stage.profilePath,
    };
  });

  const terminalPaths = terminalStageIds.map((id) => `${prefix}/${id}`);
  return { nodes, terminalPaths };
}

function authoredGateInput(gate: GateNode): RuntimePlanGateInput {
  return {
    gateId: gate.id,
    decisionIds: [...gate.outcomes],
    outcomes: { ...gate.dispositions },
  };
}

function assertTypedFanOut(node: FanOutNode): void {
  if (
    !Array.isArray(node.members) ||
    !Number.isInteger(node.concurrencyCap) ||
    !Number.isInteger(node.budget) ||
    typeof node.joinNodeId !== 'string' ||
    node.joinNodeId.length === 0
  ) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `FanOut ${node.id} is missing typed FanOut lowering metadata.`
    );
  }
}

function assertTypedJoin(node: JoinNode): void {
  if (
    !Array.isArray(node.requiredMembers) ||
    !Array.isArray(node.optionalMembers) ||
    typeof node.outcomes !== 'object' ||
    node.outcomes === null ||
    typeof node.outcomes.proceed !== 'string' ||
    typeof node.outcomes.failed !== 'string'
  ) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `Join ${node.id} is missing typed Join lowering metadata.`
    );
  }
}

function lowerV2ReviewCyclePlanInput(
  prepared: PreparedDefinition,
  profile: RuntimeExecutionProfile,
  runId: RunId
): RuntimePlanInput {
  const definition = prepared.definition;
  const capabilityByPath = new Map(
    profile.capabilities.map((binding) => [binding.nodeId, binding] as const)
  );
  const policyByPath = new Map(
    profile.policy.stages.map((stage) => [stage.nodeId, stage] as const)
  );
  const rootGateByTarget = new Map(
    definition.root.nodes
      .filter((node): node is GateNode => node.kind === 'Gate')
      .map((node) => [node.target, node] as const)
  );
  const declarationGateFor = (
    profilePath: string,
    target: string
  ): GateNode | undefined => {
    const declarationId = profilePath.match(/^declaration:([^/]+)\/node:/u)?.[1];
    const declaration = definition.declarations.find(
      (candidate) => candidate.id === declarationId
    );
    return declaration?.graph.nodes.find(
      (candidate): candidate is GateNode =>
        candidate.kind === 'Gate' && candidate.target === target
    );
  };

  // Pre-pass: collect CompositeRef terminal paths so root-level dependents can
  // map `root:<composite-ref-id>` requires to the terminal body stage paths.
  const compositeTerminalPaths = new Map<string, readonly string[]>();
  for (const node of definition.root.nodes) {
    if (node.kind !== 'CompositeRef') continue;
    const inlined = compositeRefBody(definition, node);
    compositeTerminalPaths.set(`root:${node.id}`, inlined.terminalPaths);
  }

  /**
   * Resolve a root node's incoming requirements, expanding any CompositeRef
   * reference to its terminal body stage paths.
   */
  const resolveRequires = (nodeId: string): string[] => {
    const rawReqs = incomingRequirements(definition, nodeId);
    const expanded: string[] = [];
    for (const req of rawReqs) {
      const terminals = compositeTerminalPaths.get(req);
      if (terminals !== undefined) {
        expanded.push(...terminals);
      } else {
        expanded.push(req);
      }
    }
    return [...new Set(expanded)].sort();
  };

  // ECP-4: Pre-scan for FanOut member stage IDs. The v1 normalizer keeps
  // AtomicStage root nodes for parallelGroup members alongside the FanOut
  // node that references them. Without this skip, both the standalone
  // AtomicStage and the FanOut member atomic node produce identical
  // hierarchicalPaths (e.g. root:stage:review) and createRuntimePlan
  // rejects the duplicate. FanOut members must be lowered ONLY as FanOut
  // member atomic nodes (with fanOutTag), never as standalone root nodes.
  const fanOutMemberNodeIds = new Set<string>();
  for (const scanNode of definition.root.nodes) {
    if (scanNode.kind !== 'FanOut') continue;
    assertTypedFanOut(scanNode);
    for (const member of scanNode.members) {
      fanOutMemberNodeIds.add(member.hierarchicalPath);
    }
  }

  const nodes: RuntimePlanNodeInput[] = [];

  for (const node of definition.root.nodes) {
    // Gate nodes are authored control contracts consumed when the targeted
    // AtomicStage is lowered; they are not standalone runtime nodes. The
    // AtomicStage policy carries only the resolved effective gate boolean.
    // Legacy-loop BoundedLoop nodes (non-ReviewCycle) are not supported by
    // the v2 runtime.
    if (node.kind === 'Gate') continue;
    // ECP-4: Choice nodes from v1 condition normalization are metadata only.
    // Choice nodes authored in v2 or from parallelGroup normalization are
    // handled below.
    if (node.kind === 'Choice' && (node as Readonly<{ legacyRuntimeOwner?: unknown }>).legacyRuntimeOwner !== undefined) {
      continue;
    }
    if (node.kind === 'CompositeRef') {
      // CompositeRef is inlined into atomic nodes — not emitted as a node.
      const inlined = compositeRefBody(definition, node);
      for (const bodyNode of inlined.nodes) {
        // Capability/policy bindings are keyed by the declaration profile
        // path, not the hierarchical path. The inlined atomic node carries
        // both: hierarchicalPath for the runtime plan DAG, profilePath for
        // the capability/policy lookup.
        const profilePath = bodyNode.profilePath!;
        const capability = capabilityByPath.get(profilePath);
        const policy = policyByPath.get(profilePath);
        if (capability === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `No frozen capability binding exists for ${profilePath}.`
          );
        }
        if (policy === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `No effective policy for ${profilePath}.`
          );
        }
        const target = bodyNode.hierarchicalPath.split('/').at(-1)!;
        const gate = declarationGateFor(profilePath, target);
        if (policy.gate && gate === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `Effective gate for ${profilePath} has no authored Gate authority.`
          );
        }
        nodes.push({
          kind: 'atomic',
          hierarchicalPath: bodyNode.hierarchicalPath,
          requires: bodyNode.requires,
          admissionKind: capability.actionKind,
          workspace: { access: capability.workspace.access },
          adaptiveVerify: false,
          profilePath,
          ...(policy.gate && gate !== undefined
            ? { gate: authoredGateInput(gate) }
            : {}),
        });
      }
      continue;
    }
    if (node.kind === 'BoundedLoop') {
      // ReviewCycle, goal-cycle, and composite-body BoundedLoops are lowered.
      // Legacy loops (non-ReviewCycle/goal-cycle v1 stages without a declaration
      // body) are skipped.
      const isRC = isReviewCycleShaped(definition, node);
      const isGC = isGoalCycleShaped(definition, node);
      if (isRC || isGC) {
        const cleanExit = node.exits.clean;
        const continueExit = node.exits.needs_fix;
        if (cleanExit?.action !== 'exit' || continueExit?.action !== 'continue') {
          continue;
        }
      } else {
        // Composite-body loop: must have a resolvable declaration body.
        const declaration = definition.declarations.find(
          (d) => d.id === node.body
        );
        if (declaration === undefined) continue;
      }
    }
    if (node.kind === 'AtomicStage') {
      // ECP-4: Skip AtomicStages that are FanOut members — they are lowered
      // as FanOut member atomic nodes (with member hierarchical path and
      // fanOutTag) when the FanOut node is processed below, not as standalone
      // root:stage:<id> atomic nodes. This prevents duplicate hierarchicalPaths.
      if (fanOutMemberNodeIds.has(node.id)) continue;
      const path = `root:${node.id}`;
      const capability = capabilityByPath.get(path);
      const policy = policyByPath.get(path);
      if (capability === undefined) {
        throw new RuntimePlanLowererError(
          'lowerer_shape_mismatch',
          `No frozen capability binding exists for ${path}.`
        );
      }
      if (policy === undefined) {
        throw new RuntimePlanLowererError(
          'lowerer_shape_mismatch',
          `No effective policy for ${path}.`
        );
      }
      const gate = rootGateByTarget.get(node.id);
      if (policy.gate && gate === undefined) {
        throw new RuntimePlanLowererError(
          'lowerer_shape_mismatch',
          `Effective gate for ${path} has no authored Gate authority.`
        );
      }
      nodes.push({
        kind: 'atomic',
        hierarchicalPath: path,
        requires: resolveRequires(node.id),
        admissionKind: capability.actionKind,
        workspace: { access: capability.workspace.access },
        adaptiveVerify: false,
        ...(policy.gate && gate !== undefined
          ? { gate: authoredGateInput(gate) }
          : {}),
      });
      continue;
    }
    if (node.kind === 'BoundedLoop') {
      if (isReviewCycleShaped(definition, node)) {
        // ReviewCycle body path (ECP-1, unchanged).
        const body = reviewCycleBody(definition, node);
        const cleanExit = node.exits.clean;
        const continueExit = node.exits.needs_fix;
        if (
          cleanExit?.action !== 'exit' ||
          continueExit?.action !== 'continue'
        ) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `ReviewCycle loop ${node.id} must exit on clean and continue on needs_fix.`
          );
        }
        const phases = body.phases.map((entry) => {
          const capability = capabilityByPath.get(entry.profilePath);
          const policy = policyByPath.get(entry.profilePath);
          if (capability === undefined || policy === undefined) {
            throw new RuntimePlanLowererError(
              'lowerer_shape_mismatch',
              `No frozen capability/policy binding exists for ${entry.profilePath}.`
            );
          }
          return {
            phase: entry.phase,
            profilePath: entry.profilePath,
            admissionKind: capability.actionKind,
            workspace: { access: capability.workspace.access },
          };
        });
        nodes.push({
          kind: 'bounded-loop',
          hierarchicalPath: `root:${node.id}`,
          requires: resolveRequires(node.id),
          ...boundedLoopContract(node),
          body: { kind: 'review-cycle', phases },
          outcomes: {
            clean: cleanExit.outcome,
            exhausted:
              typeof node.exhaustedOutcome === 'string'
                ? node.exhaustedOutcome
                : 'exhausted',
          },
        });
      } else if (isGoalCycleShaped(definition, node)) {
        // Goal-cycle body path (ECP-3).
        const goal = goalCycleBody(
          definition,
          node,
          capabilityByPath,
          policyByPath
        );
        const cleanExit = node.exits.clean;
        const continueExit = node.exits.needs_fix;
        if (
          cleanExit?.action !== 'exit' ||
          continueExit?.action !== 'continue'
        ) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `GoalCycle loop ${node.id} must exit on clean and continue on needs_fix.`
          );
        }
        nodes.push({
          kind: 'bounded-loop',
          hierarchicalPath: `root:${node.id}`,
          requires: resolveRequires(node.id),
          ...boundedLoopContract(node),
          body: {
            kind: 'goal-cycle',
            variant: goal.variant,
            phases: goal.phases.map((phase) => ({
              phase: phase.phase,
              profilePath: phase.profilePath,
              admissionKind: phase.admissionKind,
              workspace: { access: phase.workspace.access },
            })),
          },
          outcomes: {
            clean: cleanExit.outcome,
            exhausted:
              typeof node.exhaustedOutcome === 'string'
                ? node.exhaustedOutcome
                : 'exhausted',
          },
        });
      } else {
        // Composite body path (ECP-2).
        const composite = compositeLoopBody(
          definition,
          node,
          capabilityByPath,
          policyByPath
        );
        nodes.push({
          kind: 'bounded-loop',
          hierarchicalPath: `root:${node.id}`,
          requires: resolveRequires(node.id),
          ...boundedLoopContract(node),
          body: {
            kind: 'composite',
            declarationId: composite.declaration.id,
            stages: composite.stages,
            outcomes: composite.bodyOutcomes,
          },
          outcomes: {
            clean:
              node.exits[Object.keys(node.exits).find(
                (k) => node.exits[k]?.action === 'exit'
              )!]?.action === 'exit'
                ? (node.exits[Object.keys(node.exits).find(
                    (k) => node.exits[k]?.action === 'exit'
                  )!] as { action: 'exit'; outcome: string }).outcome
                : 'success',
            exhausted:
              typeof node.exhaustedOutcome === 'string'
                ? node.exhaustedOutcome
                : 'exhausted',
          },
        });
      }
      continue;
    }
    if (node.kind === 'Finish') {
      nodes.push({
        kind: 'finish',
        hierarchicalPath: `root:${node.id}`,
        requires: resolveRequires(node.id),
        outcome: node.outcome,
      });
      continue;
    }
    // ECP-4: Choice nodes (v2 authored — not legacy condition metadata)
    if (node.kind === 'Choice') {
      const outcomes = node.outcomes;
      // Build branch mapping: outcome → downstream path
      const branches: Record<string, string> = {};
      for (const outcome of outcomes) {
        // Find connections from this Choice node with a port matching the outcome
        const targetConn = definition.root.connections.find(
          (conn) =>
            conn.from.node === node.id &&
            (conn.from.port === outcome || conn.from.port === `outcome:${outcome}`)
        );
        if (targetConn) {
          branches[outcome] = `root:${targetConn.to.node}`;
        } else {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `Choice ${node.id} outcome ${outcome} must target one typed graph node.`
          );
        }
      }
      nodes.push({
        kind: 'choice',
        hierarchicalPath: `root:${node.id}`,
        requires: resolveRequires(node.id),
        admissionKind: 'agent',
        workspace: { access: 'none' },
        profilePath: `root:${node.id}`,
        choice: { outcomes, branches },
      });
      continue;
    }
    // ECP-4: FanOut nodes
    if (node.kind === 'FanOut') {
      assertTypedFanOut(node);
      // Member paths must be the FULL plan paths (`root:stage:<id>`) — the
      // same string the member atomic node is lowered under. createRuntimePlan
      // resolves `fanOut.members[].nodeId` through the plan's path→nodeId map,
      // and the reconciler/facade/projector all match active members by this
      // path. The v1 normalizer stores them unprefixed (`stage:<id>`), so
      // normalize once here; without this the member nodeIds resolve to
      // undefined and NO member is ever admitted (the FanOut silently stalls
      // with every member stuck at `ready`).
      const memberList = node.members.map((member) => ({
        ...member,
        hierarchicalPath: member.hierarchicalPath.startsWith('root:')
          ? member.hierarchicalPath
          : `root:${member.hierarchicalPath}`,
      }));
      nodes.push({
        kind: 'fan-out',
        hierarchicalPath: `root:${node.id}`,
        requires: resolveRequires(node.id),
        admissionKind: 'agent',
        workspace: { access: 'none' },
        profilePath: `root:${node.id}`,
        fanOut: {
          members: memberList.map((m) => ({
            hierarchicalPath: m.hierarchicalPath,
            required: m.required,
            condition: m.condition,
          })),
          concurrencyCap: node.concurrencyCap,
          budget: node.budget,
          joinNodeId: `root:${node.joinNodeId}`,
        },
      });
      // Also lower each member as an atomic node with fanOutTag
      for (const member of memberList) {
        const memberPath = member.hierarchicalPath;
        const capability = capabilityByPath.get(memberPath);
        const policy = policyByPath.get(memberPath);
        if (capability === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `No frozen capability binding exists for ${memberPath}.`
          );
        }
        if (policy === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `No effective policy for ${memberPath}.`
          );
        }
        const gate = rootGateByTarget.get(member.id);
        if (policy.gate && gate === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `Effective gate for ${memberPath} has no authored Gate authority.`
          );
        }
        nodes.push({
          kind: 'atomic',
          hierarchicalPath: memberPath,
          requires: [`root:${node.id}`],
          admissionKind: capability.actionKind,
          workspace: { access: capability.workspace.access },
          adaptiveVerify: false,
          profilePath: memberPath,
          fanOutTag: { nodeId: `root:${node.id}`, required: member.required },
          ...(policy.gate && gate !== undefined
            ? { gate: authoredGateInput(gate) }
            : {}),
        });
      }
      continue;
    }
    // ECP-4: Join nodes
    if (node.kind === 'Join') {
      assertTypedJoin(node);
      // Resolve member hierarchical paths (prepend root:)
      const resolveMemberPaths = (members: readonly string[]) =>
        members.map((m) => m.startsWith('root:') ? m : `root:${m}`);
      nodes.push({
        kind: 'join',
        hierarchicalPath: `root:${node.id}`,
        requires: resolveRequires(node.id),
        join: {
          requiredMembers: resolveMemberPaths([...node.requiredMembers]),
          optionalMembers: resolveMemberPaths([...node.optionalMembers]),
          outcomes: node.outcomes,
        },
      });
      continue;
    }
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      `Authored v2 runtime does not yet support root node kind ${(node as DefinitionNode).kind}.`
    );
  }
  const hasFinish = nodes.some((node) => node.kind === 'finish');
  const sealedPlan = sealRuntimeExecutionPlan(prepared.plan, profile);
  return {
    runId,
    pipeline: definition.name,
    planDigest: `sha256:${sealedPlan.digest}` as Digest,
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest as Digest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
    executionProfile: profile,
    ...(hasFinish ? {} : { implicitFinishOutcome: `${definition.name}-completed` }),
    nodes,
  };
}

/**
 * Produce the private {@link RuntimePlanInput} from a prepared Definition and a
 * frozen execution profile. The returned input is fed through
 * {@link createRuntimePlan} for structural validation and topological freezing.
 */
export function lowerRuntimePlanInput(
  prepared: PreparedDefinition,
  profile: RuntimeExecutionProfile,
  runId: RunId,
  gatePolicy: LoweredGatePolicy = DEFAULT_LOWERED_GATE_POLICY
): RuntimePlanInput {
  // ECP-5 (D4): route through the v2 lowerer per the ONE shared predicate the
  // binding resolver and support analysis also consume — the inline copy that
  // used to live here is exactly what let those three layers disagree about a
  // v1 parallel-only definition's execution shape.
  if (definitionRequiresV2Lowering(prepared)) {
    return lowerV2ReviewCyclePlanInput(prepared, profile, runId);
  }
  const pipeline = prepared.authoredSource as PipelineYaml;
  if (
    typeof pipeline.name !== 'string' ||
    !Array.isArray(pipeline.stages) ||
    pipeline.stages.length === 0
  ) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      'Authored v1 definition does not have a valid PipelineYaml shape.'
    );
  }
  const capabilityByPath = new Map(
    profile.capabilities.map((binding) => [binding.nodeId, binding] as const)
  );
  const policyByPath = new Map(
    profile.policy.stages.map((stage) => [stage.nodeId, stage] as const)
  );
  const nodes: RuntimePlanNodeInput[] = pipeline.stages.map((stage) => {
    const path = `stage:${stage.id}`;
    const capability = capabilityByPath.get(path);
    if (capability === undefined) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `No capability binding for node ${path}.`
      );
    }
    const policy = policyByPath.get(path);
    if (policy === undefined) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `No effective policy for node ${path}.`
      );
    }
    const node: RuntimePlanNodeInput = {
      kind: 'atomic',
      hierarchicalPath: path,
      requires: stage.requires.map((required) => `stage:${required}`),
      admissionKind: capability.actionKind,
      workspace: { access: capability.workspace.access },
      adaptiveVerify: stage.verifyPolicy === 'adaptive',
      ...(policy.gate ? { gate: gateInput(stage.id, gatePolicy) } : {}),
    };
    return node;
  });

  return {
    runId,
    pipeline: pipeline.name,
    // Seal the complete public execution meaning. In particular, the exact
    // host-owned adapter attestation authority participates through the
    // RuntimeExecutionProfile instead of leaving RuntimePlan identity bound to
    // Definition-only authoring meaning.
    planDigest: `sha256:${sealRuntimeExecutionPlan(prepared.plan, profile).digest}` as Digest,
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest as Digest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
    executionProfile: profile,
    implicitFinishOutcome: `${pipeline.name}-completed`,
    nodes,
  };
}

export function lowerRuntimePlan(
  prepared: PreparedDefinition,
  profile: RuntimeExecutionProfile,
  runId: RunId,
  gatePolicy: LoweredGatePolicy = DEFAULT_LOWERED_GATE_POLICY
): RuntimePlan {
  return createRuntimePlan(lowerRuntimePlanInput(prepared, profile, runId, gatePolicy));
}
