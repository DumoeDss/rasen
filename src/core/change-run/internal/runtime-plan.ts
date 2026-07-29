import type {
  Digest,
  NodeId,
  RunId,
} from '../contracts.js';
import { deriveNodeId } from './identity.js';

export type RuntimePlanAdmissionKind = 'agent' | 'command' | 'host';

export type RuntimePlanWorkspaceAccess = 'none' | 'read' | 'write';

export type RuntimePlanGateOutcome = 'proceed' | 'fail' | 'escalate';

export interface RuntimePlanGate {
  readonly gateId: string;
  readonly decisionIds: readonly string[];
  readonly outcomes: Readonly<Record<string, RuntimePlanGateOutcome>>;
}

export interface RuntimePlanWorkspace {
  readonly access: RuntimePlanWorkspaceAccess;
}

export interface RuntimePlanAtomicNode {
  readonly kind: 'atomic';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
  readonly adaptiveVerify: boolean;
  readonly gate?: RuntimePlanGate;
  /**
   * The profile path for this node's capability binding. For root-level
   * AtomicStages this equals the hierarchicalPath. For inlined CompositeRef
   * body stages this is the declaration-body profile path
   * (`declaration:<id>/node:<stageId>`), which is what the capability binding
   * is keyed by. The reconciler and buildAction use this to look up the
   * correct binding.
   */
  readonly profilePath?: string;
}

export interface RuntimePlanReviewCyclePhase {
  readonly phase: 'review' | 'triage' | 'fix' | 're-review';
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
}

export interface RuntimePlanReviewCycleBody {
  readonly kind: 'review-cycle';
  readonly phases: readonly RuntimePlanReviewCyclePhase[];
}

export interface RuntimePlanCompositeStage {
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
  readonly requires: readonly NodeId[]; // body-internal dependencies
}

export interface RuntimePlanCompositeBody {
  readonly kind: 'composite';
  readonly declarationId: string;
  readonly stages: readonly RuntimePlanCompositeStage[];
  readonly outcomes: Readonly<Record<string, string>>; // body outcome → loop exit outcome
}

export interface RuntimePlanBoundedLoopNode {
  readonly kind: 'bounded-loop';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly maxIterations: number;
  readonly body: RuntimePlanReviewCycleBody | RuntimePlanCompositeBody;
  readonly outcomes: Readonly<{
    clean: string;
    exhausted: string;
  }>;
}

export interface RuntimePlanFinishNode {
  readonly kind: 'finish';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly outcome: string;
}

export type RuntimePlanNode =
  | RuntimePlanAtomicNode
  | RuntimePlanBoundedLoopNode
  | RuntimePlanFinishNode;

export interface RuntimePlan {
  readonly format: 'change-run-runtime-plan/1';
  readonly runId: RunId;
  readonly pipeline: string;
  readonly planDigest: Digest;
  readonly profileDigest: Digest;
  readonly sourceRevisionDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly policyDigest: Digest;
  readonly nodes: readonly RuntimePlanNode[];
  readonly implicitFinishOutcome?: string;
  readonly finishNode?: RuntimePlanFinishNode;
}

export interface RuntimePlanGateInput {
  readonly gateId: string;
  readonly decisionIds: readonly string[];
  readonly outcomes: Readonly<Record<string, RuntimePlanGateOutcome>>;
}

export interface RuntimePlanReviewCyclePhaseInput {
  readonly phase: RuntimePlanReviewCyclePhase['phase'];
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace?: Readonly<{ access?: RuntimePlanWorkspaceAccess }>;
}

export interface RuntimePlanReviewCycleBodyInput {
  readonly kind: 'review-cycle';
  readonly phases: readonly RuntimePlanReviewCyclePhaseInput[];
}

export interface RuntimePlanCompositeStageInput {
  readonly hierarchicalPath: string;
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace?: Readonly<{ access?: RuntimePlanWorkspaceAccess }>;
  readonly requires: readonly string[]; // body-internal hierarchical paths
}

export interface RuntimePlanCompositeBodyInput {
  readonly kind: 'composite';
  readonly declarationId: string;
  readonly stages: readonly RuntimePlanCompositeStageInput[];
  readonly outcomes: Readonly<Record<string, string>>;
}

export interface RuntimePlanNodeInput {
  readonly kind: 'atomic' | 'bounded-loop' | 'finish';
  readonly hierarchicalPath: string;
  readonly requires: readonly string[];
  readonly admissionKind?: RuntimePlanAdmissionKind;
  readonly workspace?: Readonly<{ access?: RuntimePlanWorkspaceAccess }>;
  readonly adaptiveVerify?: boolean;
  readonly gate?: RuntimePlanGateInput;
  readonly outcome?: string;
  readonly maxIterations?: number;
  readonly body?: RuntimePlanReviewCycleBodyInput | RuntimePlanCompositeBodyInput;
  readonly outcomes?: Readonly<{
    clean: string;
    exhausted: string;
  }>;
  /**
   * The capability binding profile path. For root atomic nodes this defaults
   * to the hierarchicalPath. For inlined CompositeRef body stages this is the
   * declaration-body profile path.
   */
  readonly profilePath?: string;
}

export interface RuntimePlanInput {
  readonly runId: RunId;
  readonly pipeline: string;
  readonly planDigest: Digest;
  readonly profileDigest: Digest;
  readonly sourceRevisionDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly policyDigest: Digest;
  readonly nodes: readonly RuntimePlanNodeInput[];
  readonly implicitFinishOutcome?: string;
}

export type RuntimePlanErrorCode =
  | 'unsupported_runtime_plan'
  | 'invalid_runtime_plan';

export class RuntimePlanError extends Error {
  constructor(
    readonly code: RuntimePlanErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'RuntimePlanError';
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function reject(code: RuntimePlanErrorCode, message: string): never {
  throw new RuntimePlanError(code, message);
}

/**
 * Build and validate the private frozen runtime plan the pure reconciler
 * consumes. This is an internal seam: only the lowerer (task 3.2) and the
 * reconciler read it, and it never leaves this package.
 *
 * Root-DAG AtomicStage/Gate/Finish and the first closed bounded Composite
 * consumer (ReviewCycle) are supported. GoalLoop/FanOut/Join remain rejected
 * before a Run can be created from the plan.
 */
export function createRuntimePlan(input: RuntimePlanInput): RuntimePlan {
  if (input.pipeline.length === 0 || input.pipeline.length > 256) {
    reject('invalid_runtime_plan', 'Runtime plan pipeline name is out of bounds.');
  }
  if (input.nodes.length === 0) {
    reject('invalid_runtime_plan', 'Runtime plan must declare at least one node.');
  }

  const paths = new Set<string>();
  for (const node of input.nodes) {
    const path = node.hierarchicalPath;
    if (
      path.length === 0 ||
      path.length > 1024 ||
      path.includes('\\') ||
      path.startsWith('/') ||
      path.endsWith('/')
    ) {
      reject(
        'invalid_runtime_plan',
        `Node hierarchical path ${JSON.stringify(path)} is malformed.`
      );
    }
    if (paths.has(path)) {
      reject(
        'invalid_runtime_plan',
        `Node hierarchical path ${JSON.stringify(path)} is declared more than once.`
      );
    }
    paths.add(path);
  }

  const finishInputs = input.nodes.filter((node) => node.kind === 'finish');
  if (finishInputs.length > 1) {
    reject('invalid_runtime_plan', 'A runtime plan may declare at most one finish node.');
  }
  if (finishInputs.length === 1 && input.implicitFinishOutcome !== undefined) {
    reject(
      'invalid_runtime_plan',
      'A runtime plan may not combine an explicit finish node with an implicit finish outcome.'
    );
  }

  // Reject any unsupported semantic kind up front. Today only atomic/finish are
  // representable in RuntimePlanNodeInput, but the guard keeps the contract
  // explicit if the input union ever widens before the reconciler does.
  for (const node of input.nodes) {
    if (
      node.kind !== 'atomic' &&
      node.kind !== 'bounded-loop' &&
      node.kind !== 'finish'
    ) {
      reject(
        'unsupported_runtime_plan',
        `Node ${node.hierarchicalPath} uses unsupported kind ${JSON.stringify(node.kind)}.`
      );
    }
    if (node.kind === 'atomic') {
      if (
        node.admissionKind === undefined ||
        (node.admissionKind !== 'agent' &&
          node.admissionKind !== 'command' &&
          node.admissionKind !== 'host')
      ) {
        reject(
          'invalid_runtime_plan',
          `Atomic node ${node.hierarchicalPath} must declare a supported admission kind.`
        );
      }
      if (node.outcome !== undefined) {
        reject(
          'invalid_runtime_plan',
          `Atomic node ${node.hierarchicalPath} must not declare a finish outcome.`
        );
      }
      if (node.gate !== undefined) {
        validateGate(node.hierarchicalPath, node.gate);
      }
    }
    if (node.kind === 'bounded-loop') {
      validateBoundedLoop(node.hierarchicalPath, node);
    }
    if (node.kind === 'finish') {
      if (node.outcome === undefined || node.outcome.length === 0) {
        reject(
          'invalid_runtime_plan',
          `Finish node ${node.hierarchicalPath} must declare a non-empty outcome.`
        );
      }
      if (node.gate !== undefined || node.admissionKind !== undefined) {
        reject(
          'invalid_runtime_plan',
          `Finish node ${node.hierarchicalPath} must not declare gate or admission meaning.`
        );
      }
    }
  }

  // Resolve dependency paths to NodeIds and reject dangling references.
  const pathToNodeId = new Map<string, NodeId>();
  for (const path of paths) {
    pathToNodeId.set(path, deriveNodeId(input.runId, path));
  }
  for (const node of input.nodes) {
    for (const required of node.requires) {
      if (!paths.has(required)) {
        reject(
          'invalid_runtime_plan',
          `Node ${node.hierarchicalPath} requires unknown node ${JSON.stringify(required)}.`
        );
      }
    }
  }

  // Acyclic root-DAG check (Kahn). A cycle would make the ready frontier undefined.
  assertAcyclic(input.nodes);

  const builtNodes: RuntimePlanNode[] = input.nodes.map((node) => {
    const requires = node.requires.map((path) => pathToNodeId.get(path)!);
    const nodeId = pathToNodeId.get(node.hierarchicalPath)!;
    if (node.kind === 'atomic') {
      const profilePath = (node as Readonly<{ profilePath?: string }>).profilePath;
      return {
        kind: 'atomic',
        nodeId,
        hierarchicalPath: node.hierarchicalPath,
        requires,
        admissionKind: node.admissionKind!,
        workspace: {
          access: node.workspace?.access ?? 'write',
        },
        adaptiveVerify: node.adaptiveVerify === true,
        ...(profilePath !== undefined ? { profilePath } : {}),
        ...(node.gate === undefined
          ? {}
          : {
              gate: {
                gateId: node.gate.gateId,
                decisionIds: [...node.gate.decisionIds],
                outcomes: { ...node.gate.outcomes },
              },
            }),
      } as RuntimePlanAtomicNode;
    }
    if (node.kind === 'bounded-loop') {
      const body = node.body!;
      if (body.kind === 'review-cycle') {
        return {
          kind: 'bounded-loop',
          nodeId,
          hierarchicalPath: node.hierarchicalPath,
          requires,
          maxIterations: node.maxIterations!,
          body: {
            kind: 'review-cycle',
            phases: body.phases.map((phase) => ({
              phase: phase.phase,
              profilePath: phase.profilePath,
              admissionKind: phase.admissionKind,
              workspace: {
                access: phase.workspace?.access ?? 'write',
              },
            })),
          },
          outcomes: {
            clean: node.outcomes!.clean,
            exhausted: node.outcomes!.exhausted,
          },
        } as RuntimePlanBoundedLoopNode;
      }
      // composite body kind
      const bodyPathToNodeId = new Map<string, NodeId>();
      for (const stage of body.stages) {
        bodyPathToNodeId.set(stage.hierarchicalPath, deriveNodeId(input.runId, stage.hierarchicalPath));
      }
      return {
        kind: 'bounded-loop',
        nodeId,
        hierarchicalPath: node.hierarchicalPath,
        requires,
        maxIterations: node.maxIterations!,
        body: {
          kind: 'composite',
          declarationId: body.declarationId,
          stages: body.stages.map((stage) => ({
            nodeId: bodyPathToNodeId.get(stage.hierarchicalPath)!,
            hierarchicalPath: stage.hierarchicalPath,
            profilePath: stage.profilePath,
            admissionKind: stage.admissionKind,
            workspace: {
              access: stage.workspace?.access ?? 'write',
            },
            requires: stage.requires.map((path) => bodyPathToNodeId.get(path)!),
          })),
          outcomes: { ...body.outcomes },
        },
        outcomes: {
          clean: node.outcomes!.clean,
          exhausted: node.outcomes!.exhausted,
        },
      } as RuntimePlanBoundedLoopNode;
    }
    return {
      kind: 'finish',
      nodeId,
      hierarchicalPath: node.hierarchicalPath,
      requires,
      outcome: node.outcome!,
    } as RuntimePlanFinishNode;
  });

  // Stable topological order: dependencies precede dependents so the reconciler
  // can fold node state in one pass; ties break by hierarchical path so that the
  // emitted ready frontier is identical for any declaration/insertion order.
  const topoOrder = topologicalOrder(
    input.nodes.map((node) => node.hierarchicalPath),
    input.nodes.map((node) => [...node.requires])
  );
  const pathIndex = new Map(topoOrder.map((path, index) => [path, index]));
  builtNodes.sort(
    (left, right) =>
      pathIndex.get(left.hierarchicalPath)! - pathIndex.get(right.hierarchicalPath)!
  );

  const finishNode = builtNodes.find(
    (node): node is RuntimePlanFinishNode => node.kind === 'finish'
  );

  return deepFreeze({
    format: 'change-run-runtime-plan/1',
    runId: input.runId,
    pipeline: input.pipeline,
    planDigest: input.planDigest,
    profileDigest: input.profileDigest,
    sourceRevisionDigest: input.sourceRevisionDigest,
    capabilityDigest: input.capabilityDigest,
    policyDigest: input.policyDigest,
    nodes: builtNodes,
    ...(input.implicitFinishOutcome === undefined
      ? {}
      : { implicitFinishOutcome: input.implicitFinishOutcome }),
    ...(finishNode === undefined ? {} : { finishNode }),
  } as RuntimePlan);
}

function validateBoundedLoop(
  path: string,
  node: RuntimePlanNodeInput
): void {
  if (
    !Number.isSafeInteger(node.maxIterations) ||
    node.maxIterations === undefined ||
    node.maxIterations < 1 ||
    node.maxIterations > 100
  ) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} maxIterations must be between 1 and 100.`
    );
  }
  if (node.body?.kind === 'review-cycle') {
    validateReviewCycleBody(path, node);
  } else if (node.body?.kind === 'composite') {
    validateCompositeBody(path, node);
  } else {
    reject(
      'unsupported_runtime_plan',
      `Bounded loop ${path} uses an unsupported body kind.`
    );
  }
  if (
    node.outcomes === undefined ||
    node.outcomes.clean.length === 0 ||
    node.outcomes.exhausted.length === 0
  ) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} must declare clean and exhausted outcomes.`
    );
  }
  if (
    node.admissionKind !== undefined ||
    node.gate !== undefined ||
    node.outcome !== undefined
  ) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} must not declare atomic, gate, or finish fields.`
    );
  }
}

function validateReviewCycleBody(
  path: string,
  node: RuntimePlanNodeInput
): void {
  const body = node.body as RuntimePlanReviewCycleBodyInput;
  const expected = ['review', 'triage', 'fix', 're-review'] as const;
  const actual = body.phases.map((phase) => phase.phase);
  if (
    actual.length !== expected.length ||
    actual.some((phase, index) => phase !== expected[index])
  ) {
    reject(
      'invalid_runtime_plan',
      `ReviewCycle body ${path} must declare review, triage, fix, re-review in order.`
    );
  }
  const profilePaths = new Set<string>();
  for (const phase of body.phases) {
    if (
      phase.profilePath.length === 0 ||
      phase.profilePath.length > 1024 ||
      phase.profilePath.includes('\\') ||
      profilePaths.has(phase.profilePath)
    ) {
      reject(
        'invalid_runtime_plan',
        `ReviewCycle phase profile path ${JSON.stringify(phase.profilePath)} is malformed or duplicated.`
      );
    }
    profilePaths.add(phase.profilePath);
    if (
      phase.admissionKind !== 'agent' &&
      phase.admissionKind !== 'command' &&
      phase.admissionKind !== 'host'
    ) {
      reject(
        'invalid_runtime_plan',
        `ReviewCycle phase ${phase.phase} must declare a supported admission kind.`
      );
    }
  }
}

function validateCompositeBody(
  path: string,
  node: RuntimePlanNodeInput
): void {
  const body = node.body as RuntimePlanCompositeBodyInput;
  if (body.stages.length === 0) {
    reject(
      'invalid_runtime_plan',
      `Composite body ${path} must declare at least one stage.`
    );
  }
  const stagePaths = new Set<string>();
  for (const stage of body.stages) {
    if (
      stage.hierarchicalPath.length === 0 ||
      stage.hierarchicalPath.length > 1024 ||
      stage.hierarchicalPath.includes('\\')
    ) {
      reject(
        'invalid_runtime_plan',
        `Composite body stage path ${JSON.stringify(stage.hierarchicalPath)} is malformed.`
      );
    }
    if (stagePaths.has(stage.hierarchicalPath)) {
      reject(
        'invalid_runtime_plan',
        `Composite body stage path ${JSON.stringify(stage.hierarchicalPath)} is declared more than once.`
      );
    }
    stagePaths.add(stage.hierarchicalPath);
    if (
      stage.profilePath.length === 0 ||
      stage.profilePath.length > 1024 ||
      stage.profilePath.includes('\\')
    ) {
      reject(
        'invalid_runtime_plan',
        `Composite body stage profile path ${JSON.stringify(stage.profilePath)} is malformed.`
      );
    }
    if (
      stage.admissionKind !== 'agent' &&
      stage.admissionKind !== 'command' &&
      stage.admissionKind !== 'host'
    ) {
      reject(
        'invalid_runtime_plan',
        `Composite body stage ${stage.hierarchicalPath} must declare a supported admission kind.`
      );
    }
  }
  // Acyclic body-internal dependency check.
  const bodyOrder = topologicalOrder(
    body.stages.map((s) => s.hierarchicalPath),
    body.stages.map((s) => [...s.requires])
  );
  if (bodyOrder.length !== body.stages.length) {
    reject(
      'invalid_runtime_plan',
      `Composite body ${path} internal dependency graph must be acyclic.`
    );
  }
  // Validate body-internal requires reference known stage paths.
  for (const stage of body.stages) {
    for (const required of stage.requires) {
      if (!stagePaths.has(required)) {
        reject(
          'invalid_runtime_plan',
          `Composite body stage ${stage.hierarchicalPath} requires unknown body stage ${JSON.stringify(required)}.`
        );
      }
    }
  }
  // Outcome keys must be non-empty.
  for (const key of Object.keys(body.outcomes)) {
    if (key.length === 0) {
      reject(
        'invalid_runtime_plan',
        `Composite body ${path} must not declare empty outcome keys.`
      );
    }
  }
}

function validateGate(path: string, gate: RuntimePlanGateInput): void {
  if (gate.gateId.length === 0 || gate.gateId.length > 256) {
    reject('invalid_runtime_plan', `Gate id on ${path} is out of bounds.`);
  }
  const seen = new Set<string>();
  for (const decisionId of gate.decisionIds) {
    if (decisionId.length === 0 || decisionId.length > 256) {
      reject('invalid_runtime_plan', `Gate decision id on ${path} is out of bounds.`);
    }
    if (seen.has(decisionId)) {
      reject(
        'invalid_runtime_plan',
        `Gate decision ids on ${path} must be unique in declared order.`
      );
    }
    seen.add(decisionId);
    if (!(decisionId in gate.outcomes)) {
      reject(
        'invalid_runtime_plan',
        `Gate decision ${decisionId} on ${path} has no declared outcome mapping.`
      );
    }
  }
}

function assertAcyclic(nodes: readonly RuntimePlanNodeInput[]): void {
  const order = topologicalOrder(
    nodes.map((node) => node.hierarchicalPath),
    nodes.map((node) => [...node.requires])
  );
  if (order.length !== nodes.length) {
    reject(
      'unsupported_runtime_plan',
      'Runtime plan root dependency graph must be acyclic.'
    );
  }
}

/**
 * Stable topological order via Kahn's algorithm. Returns paths in dependency
 * order, breaking ties lexicographically by path so the result is independent
 * of declaration order. If the graph contains a cycle, the returned list is
 * shorter than the input.
 */
function topologicalOrder(
  paths: readonly string[],
  requires: readonly (readonly string[])[]
): string[] {
  const indexByPath = new Map<string, number>();
  paths.forEach((path, index) => indexByPath.set(path, index));
  const incoming = requires.map((deps) =>
    deps.filter((dep) => indexByPath.has(dep)).length
  );
  const dependents = paths.map<number[]>(() => []);
  requires.forEach((deps, node) => {
    for (const dep of deps) {
      const depIndex = indexByPath.get(dep);
      if (depIndex !== undefined) {
        dependents[depIndex]!.push(node);
      }
    }
  });

  // A lexicographic min-heap of ready paths keeps the order stable regardless
  // of how the nodes were declared.
  const ready: number[] = [];
  const pushReady = (node: number): void => {
    ready.push(node);
    for (let i = ready.length - 1; i > 0; i -= 1) {
      const parent = (i - 1) >> 1;
      if (
        compareStrings(paths[ready[parent]]!, paths[ready[i]]!) <= 0
      ) {
        break;
      }
      [ready[parent], ready[i]] = [ready[i], ready[parent]];
    }
  };
  const popReady = (): number => {
    const top = ready[0]!;
    const last = ready.pop()!;
    if (ready.length > 0) {
      ready[0] = last;
      for (let i = 0; i * 2 + 1 < ready.length; ) {
        let smallest = i * 2 + 1;
        if (
          i * 2 + 2 < ready.length &&
          compareStrings(paths[ready[i * 2 + 2]!], paths[ready[smallest]!]!) < 0
        ) {
          smallest = i * 2 + 2;
        }
        if (compareStrings(paths[ready[i]!], paths[ready[smallest]!]!) <= 0) {
          break;
        }
        [ready[i], ready[smallest]] = [ready[smallest], ready[i]];
        i = smallest;
      }
    }
    return top;
  };

  paths.forEach((_, node) => {
    if (incoming[node] === 0) pushReady(node);
  });

  const order: string[] = [];
  while (ready.length > 0) {
    const node = popReady();
    order.push(paths[node]!);
    for (const dependent of dependents[node]!) {
      incoming[dependent]! -= 1;
      if (incoming[dependent] === 0) pushReady(dependent);
    }
  }
  return order;
}
