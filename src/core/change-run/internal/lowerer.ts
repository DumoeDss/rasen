import type { PreparedDefinition } from '../../pipeline-registry/definition.js';
import type {
  AtomicStageNode,
  BoundedLoopNode,
  CompositeDeclaration,
  CompositeRefNode,
  DefinitionNode,
  DefinitionSourceV2,
  FanOutNode,
  JoinNode,
} from '../../pipeline-registry/definition.js';
import type { RuntimeExecutionProfile } from '../../pipeline-registry/execution-plan-internal.js';
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
    .filter((phase): phase is string => typeof phase === 'string')
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
  policyByPath: Map<string, RuntimeExecutionProfile['policy']['stages'][number]>,
  pipelineName: string
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
  // Detect variant from the BoundedLoop node's explicit goalCycleVariant tag
  // (set during normalization in definition.ts). Fall back to pipeline-name
  // and gate-kind detection for backward compatibility with older plans that
  // predate the explicit tag.
  const nodeVariant = (loop as unknown as Readonly<{ goalCycleVariant?: unknown }>).goalCycleVariant;
  const legacyStage = (loop as unknown as Readonly<{ legacy?: Readonly<{ loop?: Readonly<{ kind?: string; gate?: Readonly<{ kind?: string }> }> }> }>).legacy;
  const legacyLoop = legacyStage?.loop;
  const variant: 'measure' | 'evaluate' | 'research' =
    nodeVariant === 'research' || nodeVariant === 'measure' || nodeVariant === 'evaluate'
      ? (nodeVariant as 'measure' | 'evaluate' | 'research')
      : pipelineName === 'goal-loop-research'
        ? 'research'
        : legacyLoop?.gate?.kind === 'measure'
          ? 'measure'
          : 'evaluate';

  const phaseEntries = declaration.graph.nodes.map((node) => {
    if (node.kind !== 'AtomicStage') {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `GoalCycle body ${declaration.id} may contain only AtomicStage phases.`
      );
    }
    const phase = (node as Readonly<{ goalCyclePhase?: unknown }>).goalCyclePhase;
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
    .filter((phase): phase is string => typeof phase === 'string')
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
    return expanded;
  };

  const nodes: RuntimePlanNodeInput[] = [];

  for (const node of definition.root.nodes) {
    // Skip v1-normalization structural artifacts. Gate nodes are
    // metadata carriers — gate logic is encoded in the AtomicStage's policy
    // gate field. Legacy-loop BoundedLoop nodes (non-ReviewCycle) are not
    // supported by the v2 runtime.
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
        nodes.push({
          kind: 'atomic',
          hierarchicalPath: bodyNode.hierarchicalPath,
          requires: bodyNode.requires,
          admissionKind: capability.actionKind,
          workspace: { access: capability.workspace.access },
          adaptiveVerify: false,
          profilePath,
          ...(policy.gate
            ? { gate: gateInput(bodyNode.hierarchicalPath, DEFAULT_LOWERED_GATE_POLICY) }
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
      nodes.push({
        kind: 'atomic',
        hierarchicalPath: path,
        requires: resolveRequires(node.id),
        admissionKind: capability.actionKind,
        workspace: { access: capability.workspace.access },
        adaptiveVerify: false,
        ...(policy.gate
          ? { gate: gateInput(node.id, DEFAULT_LOWERED_GATE_POLICY) }
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
          maxIterations: node.limits.maxIterations,
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
          policyByPath,
          definition.name
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
          maxIterations: node.limits.maxIterations,
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
          maxIterations: node.limits.maxIterations,
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
          // Fallback: use the outcome as a path suffix
          branches[outcome] = `root:${node.id}/${outcome}`;
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
      const fanOutMeta = node as FanOutNode & {
        concurrencyCap?: number;
        budget?: number;
        joinNodeId?: string;
        members?: ReadonlyArray<{ id: string; hierarchicalPath: string; required: boolean; condition: string }>;
      };
      const memberList = fanOutMeta.members ?? node.branches.map((id) => ({
        id,
        hierarchicalPath: `stage:${id}`,
        required: true,
        condition: 'always',
      }));
      const joinNodeId = fanOutMeta.joinNodeId ?? `join:${node.id.replace('fanout:', '')}-join`;
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
          concurrencyCap: fanOutMeta.concurrencyCap ?? 3,
          budget: fanOutMeta.budget ?? memberList.length,
          joinNodeId: `root:${joinNodeId}`,
        },
      });
      // Also lower each member as an atomic node with fanOutTag
      for (const member of memberList) {
        const memberPath = `root:${member.hierarchicalPath}`;
        const capability = capabilityByPath.get(memberPath);
        if (capability === undefined) {
          throw new RuntimePlanLowererError(
            'lowerer_shape_mismatch',
            `No frozen capability binding exists for ${memberPath}.`
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
        });
      }
      continue;
    }
    // ECP-4: Join nodes
    if (node.kind === 'Join') {
      const joinMeta = node as JoinNode & {
        requiredMembers?: readonly string[];
        optionalMembers?: readonly string[];
        outcomes?: Readonly<{ proceed: string; failed: string }>;
      };
      const requiredMembers = joinMeta.requiredMembers ?? [];
      const optionalMembers = joinMeta.optionalMembers ?? node.inputs;
      const outcomes = joinMeta.outcomes ?? { proceed: 'join-done', failed: 'join-failed' };
      // Resolve member hierarchical paths (prepend root:)
      const resolveMemberPaths = (members: readonly string[]) =>
        members.map((m) => m.startsWith('root:') ? m : `root:${m}`);
      nodes.push({
        kind: 'join',
        hierarchicalPath: `root:${node.id}`,
        requires: resolveRequires(node.id),
        join: {
          requiredMembers: resolveMemberPaths([...requiredMembers]),
          optionalMembers: resolveMemberPaths([...optionalMembers]),
          outcomes,
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
  return {
    runId,
    pipeline: definition.name,
    planDigest: `sha256:${prepared.digests.plan}` as Digest,
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest as Digest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
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
  // D4 migration: route through the v2 lowerer when the normalized definition
  // contains a BoundedLoop, regardless of authoredVersion. This makes v1
  // built-in pipelines (bug-fix, small-feature) whose normalized form includes
  // a ReviewCycle BoundedLoop lower as mixed atomic + bounded-loop plans.
  const hasBoundedLoop = prepared.definition.root.nodes.some(
    (node) => node.kind === 'BoundedLoop'
  );
  if (prepared.authoredVersion === 2 || hasBoundedLoop) {
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
    // The plan envelope digest is stored as raw hex; the canonical Digest
    // identity carries the sha256: prefix, so bind the prefixed form here.
    planDigest: `sha256:${prepared.digests.plan}` as Digest,
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest as Digest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
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
