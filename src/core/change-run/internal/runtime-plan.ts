import type {
  Digest,
  NodeId,
  RunId,
} from '../contracts.js';
import {
  openRuntimeExecutionProfile,
  type RuntimeExecutionProfile,
} from '../../pipeline-registry/execution-plan-internal.js';
import { isDeepStrictEqual } from 'node:util';
import type { BoundedLoopLifecyclePolicyV1 } from '../../pipeline-registry/definition.js';
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
  /**
   * ECP-4: when this atomic node is a FanOut member, this tag identifies the
   * owning FanOut node and whether the member is required (condition: always)
   * or optional (conditional). The reconciler's FanOut pass uses this to
   * filter candidates before the merged workspace-lock selection.
   */
  readonly fanOut?: Readonly<{ nodeId: NodeId; required: boolean }>;
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

export interface RuntimePlanGoalCyclePhase {
  readonly phase: 'work' | 'judge';
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
}

export interface RuntimePlanGoalCycleBody {
  readonly kind: 'goal-cycle';
  readonly variant: 'measure' | 'evaluate' | 'research';
  readonly phases: readonly RuntimePlanGoalCyclePhase[];
}

export interface RuntimePlanBoundedLoopNode {
  readonly kind: 'bounded-loop';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly limits: Readonly<{
    maxIterations: number;
    maxActions: number;
    budget: number;
  }>;
  readonly lifecycle: BoundedLoopLifecyclePolicyV1;
  readonly strategyProfilePath?: string;
  readonly body:
    | RuntimePlanReviewCycleBody
    | RuntimePlanCompositeBody
    | RuntimePlanGoalCycleBody;
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

// ─── ECP-4: Choice / FanOut / Join runtime plan nodes ───

export interface RuntimePlanChoiceNode {
  readonly kind: 'choice';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
  readonly outcomes: readonly string[];
  /** outcome → branch hierarchical path added to succeeded set when selected */
  readonly branches: Readonly<Record<string, string>>;
}

export interface RuntimePlanFanOutMember {
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly required: boolean;
  readonly condition: string; // 'always' | 'security-relevant' | ...
}

export interface RuntimePlanFanOutNode {
  readonly kind: 'fan-out';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly profilePath: string; // condition evaluator capability
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
  readonly members: readonly RuntimePlanFanOutMember[];
  readonly concurrencyCap: number;
  readonly budget: number;
  readonly joinNodeId: NodeId;
}

export interface RuntimePlanJoinNode {
  readonly kind: 'join';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly requiredMembers: readonly NodeId[];
  readonly optionalMembers: readonly NodeId[];
  readonly outcomes: Readonly<{ proceed: string; failed: string }>;
}

export type RuntimePlanNode =
  | RuntimePlanAtomicNode
  | RuntimePlanBoundedLoopNode
  | RuntimePlanFinishNode
  | RuntimePlanChoiceNode
  | RuntimePlanFanOutNode
  | RuntimePlanJoinNode;

export interface RuntimePlan {
  readonly format: 'change-run-runtime-plan/1';
  readonly runId: RunId;
  readonly pipeline: string;
  readonly planDigest: Digest;
  readonly profileDigest: Digest;
  readonly sourceRevisionDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly policyDigest: Digest;
  /**
   * Public-only launch-time execution authority. New Runs always persist it so
   * resume never rebinds an existing Run to the mutable host catalog. Optional
   * only for decoding pre-attestation RuntimePlan/1 files.
   */
  readonly executionProfile?: RuntimeExecutionProfile;
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

export interface RuntimePlanGoalCyclePhaseInput {
  readonly phase: 'work' | 'judge';
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace?: Readonly<{ access?: RuntimePlanWorkspaceAccess }>;
}

export interface RuntimePlanGoalCycleBodyInput {
  readonly kind: 'goal-cycle';
  readonly variant: 'measure' | 'evaluate' | 'research';
  readonly phases: readonly RuntimePlanGoalCyclePhaseInput[];
}

export interface RuntimePlanChoiceInput {
  readonly outcomes: readonly string[];
  /** outcome → branch hierarchical path */
  readonly branches: Readonly<Record<string, string>>;
}

export interface RuntimePlanFanOutMemberInput {
  readonly hierarchicalPath: string;
  readonly required: boolean;
  readonly condition: string;
}

export interface RuntimePlanFanOutInput {
  readonly members: readonly RuntimePlanFanOutMemberInput[];
  readonly concurrencyCap: number;
  readonly budget: number;
  readonly joinNodeId: string;
}

export interface RuntimePlanJoinInput {
  readonly requiredMembers: readonly string[];
  readonly optionalMembers: readonly string[];
  readonly outcomes: Readonly<{ proceed: string; failed: string }>;
}

export interface RuntimePlanNodeInput {
  readonly kind: 'atomic' | 'bounded-loop' | 'finish' | 'choice' | 'fan-out' | 'join';
  readonly hierarchicalPath: string;
  readonly requires: readonly string[];
  readonly admissionKind?: RuntimePlanAdmissionKind;
  readonly workspace?: Readonly<{ access?: RuntimePlanWorkspaceAccess }>;
  readonly adaptiveVerify?: boolean;
  readonly gate?: RuntimePlanGateInput;
  readonly outcome?: string;
  readonly limits?: Readonly<{
    maxIterations: number;
    maxActions: number;
    budget: number;
  }>;
  readonly lifecycle?: BoundedLoopLifecyclePolicyV1;
  readonly strategyProfilePath?: string;
  readonly body?:
    | RuntimePlanReviewCycleBodyInput
    | RuntimePlanCompositeBodyInput
    | RuntimePlanGoalCycleBodyInput;
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
  // ─── ECP-4 fields ───
  readonly choice?: RuntimePlanChoiceInput;
  readonly fanOut?: RuntimePlanFanOutInput;
  readonly join?: RuntimePlanJoinInput;
  /**
   * ECP-4: when this atomic node is a FanOut member, this tag identifies the
   * owning FanOut node and whether the member is required.
   */
  readonly fanOutTag?: Readonly<{ nodeId: string; required: boolean }>;
}

export interface RuntimePlanInput {
  readonly runId: RunId;
  readonly pipeline: string;
  readonly planDigest: Digest;
  readonly profileDigest: Digest;
  readonly sourceRevisionDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly policyDigest: Digest;
  readonly executionProfile?: RuntimeExecutionProfile;
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
 * ECP-4: reject a plan in which any node transitively depends on TWO branch
 * entries of the SAME choice.
 *
 * `requires` is AND semantics, and exactly one branch of a choice is ever
 * selected — the rest become permanently ineligible. So a rejoin node
 * downstream of both branches can never have all its requires satisfied. It is
 * deliberately NOT excluded by `choiceBranchExclusions` (excluding it would
 * silently drop authored work), which leaves it unadmittable AND still counted
 * by the implicit-finish check: the Run stalls at `waiting` forever, with no
 * escalate and no diagnostic. That is the worst possible failure mode.
 *
 * This is a purely static property of the plan — no Record is involved, and
 * the verdict cannot change as a Run progresses — so it is rejected at build
 * time, where the message can name the offending node and `pipeline start`
 * fails outright. The alternative (escalating at runtime) would re-derive the
 * same static fact on every reconcile and only surface after a Run was created.
 * Same reasoning as rejecting unresolvable fan-out/join member paths.
 */
function validateNoChoiceBranchConvergence(input: RuntimePlanInput): void {
  const choices = input.nodes.filter((node) => node.kind === 'choice');
  if (choices.length === 0) return;

  const dependents = new Map<string, string[]>();
  for (const node of input.nodes) {
    for (const required of node.requires) {
      const existing = dependents.get(required);
      if (existing === undefined) dependents.set(required, [node.hierarchicalPath]);
      else existing.push(node.hierarchicalPath);
    }
  }
  const reachableFrom = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of dependents.get(current) ?? []) queue.push(next);
    }
    return seen;
  };

  for (const choice of choices) {
    const branches = choice.choice?.branches ?? {};
    const entries = [...new Set(Object.values(branches))];
    if (entries.length < 2) continue;
    // reachedBy: node path -> the branch entries that transitively reach it.
    const reachedBy = new Map<string, string[]>();
    for (const entry of entries) {
      for (const reached of reachableFrom(entry)) {
        const existing = reachedBy.get(reached);
        if (existing === undefined) reachedBy.set(reached, [entry]);
        else existing.push(entry);
      }
    }
    for (const [path, viaEntries] of reachedBy) {
      if (viaEntries.length < 2) continue;
      const sorted = [...viaEntries].sort();
      reject(
        'invalid_runtime_plan',
        `Node ${JSON.stringify(path)} depends on ${sorted.length} branches of choice ${JSON.stringify(choice.hierarchicalPath)} (${sorted.map((e) => JSON.stringify(e)).join(', ')}). Only one branch is ever selected, so its requires can never all be satisfied and the Run would stall without finishing.`
      );
    }
  }
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

  const executionProfile =
    input.executionProfile === undefined
      ? undefined
      : openRuntimeExecutionProfile(input.executionProfile);
  if (
    executionProfile !== undefined &&
    (executionProfile.profileDigest !== input.profileDigest ||
      executionProfile.sourceRevision.semanticDigest !==
        input.sourceRevisionDigest ||
      executionProfile.capabilityProfileDigest !== input.capabilityDigest ||
      executionProfile.policyDigest !== input.policyDigest)
  ) {
    reject(
      'invalid_runtime_plan',
      'Runtime plan execution profile does not match its frozen digest fields.'
    );
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

  // Reject any unsupported semantic kind up front.
  for (const node of input.nodes) {
    if (
      node.kind !== 'atomic' &&
      node.kind !== 'bounded-loop' &&
      node.kind !== 'finish' &&
      node.kind !== 'choice' &&
      node.kind !== 'fan-out' &&
      node.kind !== 'join'
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
    if (node.kind === 'choice') {
      validateChoice(node.hierarchicalPath, node);
    }
    if (node.kind === 'fan-out') {
      validateFanOut(node.hierarchicalPath, node);
    }
    if (node.kind === 'join') {
      validateJoin(node.hierarchicalPath, node);
    }
  }

  validateNoChoiceBranchConvergence(input);

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
        ...(node.fanOutTag === undefined
          ? {}
          : {
              fanOut: {
                nodeId: pathToNodeId.get(node.fanOutTag.nodeId)!,
                required: node.fanOutTag.required,
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
          limits: { ...node.limits! },
          lifecycle: structuredClone(node.lifecycle!),
          ...(node.strategyProfilePath !== undefined
            ? { strategyProfilePath: node.strategyProfilePath }
            : {}),
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
      if (body.kind === 'goal-cycle') {
        return {
          kind: 'bounded-loop',
          nodeId,
          hierarchicalPath: node.hierarchicalPath,
          requires,
          limits: { ...node.limits! },
          lifecycle: structuredClone(node.lifecycle!),
          ...(node.strategyProfilePath !== undefined
            ? { strategyProfilePath: node.strategyProfilePath }
            : {}),
          body: {
            kind: 'goal-cycle',
            variant: body.variant,
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
        limits: { ...node.limits! },
        lifecycle: structuredClone(node.lifecycle!),
        ...(node.strategyProfilePath !== undefined
          ? { strategyProfilePath: node.strategyProfilePath }
          : {}),
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
    if (node.kind === 'finish') {
      return {
        kind: 'finish',
        nodeId,
        hierarchicalPath: node.hierarchicalPath,
        requires,
        outcome: node.outcome!,
      } as RuntimePlanFinishNode;
    }
    if (node.kind === 'choice') {
      const ci = node.choice!;
      return {
        kind: 'choice',
        nodeId,
        hierarchicalPath: node.hierarchicalPath,
        requires,
        profilePath: node.profilePath ?? node.hierarchicalPath,
        admissionKind: node.admissionKind ?? 'agent',
        workspace: { access: node.workspace?.access ?? 'none' },
        outcomes: [...ci.outcomes],
        branches: { ...ci.branches },
      } as RuntimePlanChoiceNode;
    }
    if (node.kind === 'fan-out') {
      const fi = node.fanOut!;
      const joinPath = fi.joinNodeId;
      const joinId = pathToNodeId.get(joinPath);
      if (joinId === undefined) {
        reject(
          'invalid_runtime_plan',
          `Fan-out node ${node.hierarchicalPath} references unknown join node ${JSON.stringify(joinPath)}.`
        );
      }
      const members = fi.members.map((m) => {
        const memberId = pathToNodeId.get(m.hierarchicalPath);
        if (memberId === undefined) {
          // Without this check an unresolved member path silently produces
          // `nodeId: undefined`, and the reconciler's FanOut pass finds no
          // matching atomic node — the fan-out stalls forever with every
          // member reported `ready` and nothing admitted.
          reject(
            'invalid_runtime_plan',
            `Fan-out node ${node.hierarchicalPath} references unknown member node ${JSON.stringify(m.hierarchicalPath)}.`
          );
        }
        return {
          nodeId: memberId!,
          hierarchicalPath: m.hierarchicalPath,
          required: m.required,
          condition: m.condition,
        };
      });
      return {
        kind: 'fan-out',
        nodeId,
        hierarchicalPath: node.hierarchicalPath,
        requires,
        profilePath: node.profilePath ?? node.hierarchicalPath,
        admissionKind: node.admissionKind ?? 'agent',
        workspace: { access: node.workspace?.access ?? 'none' },
        members,
        concurrencyCap: fi.concurrencyCap,
        budget: fi.budget,
        joinNodeId: joinId!,
      } as RuntimePlanFanOutNode;
    }
    // join
    {
      const ji = node.join!;
      const resolveJoinMember = (path: string): NodeId => {
        const memberId = pathToNodeId.get(path);
        if (memberId === undefined) {
          reject(
            'invalid_runtime_plan',
            `Join node ${node.hierarchicalPath} references unknown member node ${JSON.stringify(path)}.`
          );
        }
        return memberId!;
      };
      return {
        kind: 'join',
        nodeId,
        hierarchicalPath: node.hierarchicalPath,
        requires,
        requiredMembers: ji.requiredMembers.map(resolveJoinMember),
        optionalMembers: ji.optionalMembers.map(resolveJoinMember),
        outcomes: { proceed: ji.outcomes.proceed, failed: ji.outcomes.failed },
      } as RuntimePlanJoinNode;
    }
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
    ...(executionProfile === undefined ? {} : { executionProfile }),
    nodes: builtNodes,
    ...(input.implicitFinishOutcome === undefined
      ? {}
      : { implicitFinishOutcome: input.implicitFinishOutcome }),
    ...(finishNode === undefined ? {} : { finishNode }),
  } as RuntimePlan);
}

/**
 * Re-open the already-lowered RuntimePlan representation written beside a Run.
 * `createRuntimePlan` consumes path-based input, while persisted dependencies
 * are NodeIds, so decoding first reverses those derived identities and then
 * rebuilds the plan through the one structural validator. Exact deep equality
 * rejects unknown keys and non-canonical derived fields.
 */
export function openRuntimePlan(value: unknown): RuntimePlan {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('invalid_runtime_plan', 'Stored RuntimePlan must be an object.');
  }
  const stored = structuredClone(value) as RuntimePlan;
  if (
    stored.format !== 'change-run-runtime-plan/1' ||
    typeof stored.runId !== 'string' ||
    typeof stored.pipeline !== 'string' ||
    !Array.isArray(stored.nodes)
  ) {
    reject('invalid_runtime_plan', 'Stored RuntimePlan envelope is malformed.');
  }

  const rootPathById = new Map<string, string>();
  for (const node of stored.nodes) {
    if (
      node === null ||
      typeof node !== 'object' ||
      typeof node.nodeId !== 'string' ||
      typeof node.hierarchicalPath !== 'string' ||
      !Array.isArray(node.requires)
    ) {
      reject('invalid_runtime_plan', 'Stored RuntimePlan node is malformed.');
    }
    rootPathById.set(node.nodeId, node.hierarchicalPath);
  }
  const rootPath = (nodeId: NodeId): string => {
    const path = rootPathById.get(nodeId);
    if (path === undefined) {
      reject(
        'invalid_runtime_plan',
        `Stored RuntimePlan references unknown NodeId ${JSON.stringify(nodeId)}.`
      );
    }
    return path;
  };

  const nodes: RuntimePlanNodeInput[] = stored.nodes.map((node) => {
    const common = {
      hierarchicalPath: node.hierarchicalPath,
      requires: node.requires.map(rootPath),
    };
    if (node.kind === 'atomic') {
      return {
        kind: 'atomic',
        ...common,
        admissionKind: node.admissionKind,
        workspace: { ...node.workspace },
        adaptiveVerify: node.adaptiveVerify,
        ...(node.profilePath === undefined ? {} : { profilePath: node.profilePath }),
        ...(node.gate === undefined
          ? {}
          : {
              gate: {
                gateId: node.gate.gateId,
                decisionIds: [...node.gate.decisionIds],
                outcomes: { ...node.gate.outcomes },
              },
            }),
        ...(node.fanOut === undefined
          ? {}
          : {
              fanOutTag: {
                nodeId: rootPath(node.fanOut.nodeId),
                required: node.fanOut.required,
              },
            }),
      };
    }
    if (node.kind === 'bounded-loop') {
      const body = node.body;
      const decodedBody: RuntimePlanNodeInput['body'] =
        body.kind === 'composite'
          ? (() => {
              const bodyPathById = new Map<NodeId, string>(
                body.stages.map((stage: RuntimePlanCompositeStage) => [
                  stage.nodeId,
                  stage.hierarchicalPath,
                ])
              );
              const bodyPath = (nodeId: NodeId): string => {
                const path = bodyPathById.get(nodeId);
                if (path === undefined) {
                  reject(
                    'invalid_runtime_plan',
                    `Stored composite body references unknown NodeId ${JSON.stringify(nodeId)}.`
                  );
                }
                return path;
              };
              return {
                kind: 'composite' as const,
                declarationId: body.declarationId,
                stages: body.stages.map((stage: RuntimePlanCompositeStage) => ({
                  hierarchicalPath: stage.hierarchicalPath,
                  profilePath: stage.profilePath,
                  admissionKind: stage.admissionKind,
                  workspace: { ...stage.workspace },
                  requires: stage.requires.map(bodyPath),
                })),
                outcomes: { ...body.outcomes },
              };
            })()
          : {
              kind: body.kind,
              ...(body.kind === 'goal-cycle' ? { variant: body.variant } : {}),
              phases: body.phases.map((phase: RuntimePlanReviewCyclePhase | RuntimePlanGoalCyclePhase) => ({
                phase: phase.phase,
                profilePath: phase.profilePath,
                admissionKind: phase.admissionKind,
                workspace: { ...phase.workspace },
              })),
            } as RuntimePlanNodeInput['body'];
      return {
        kind: 'bounded-loop',
        ...common,
        limits: { ...node.limits },
        lifecycle: structuredClone(node.lifecycle),
        ...(node.strategyProfilePath === undefined
          ? {}
          : { strategyProfilePath: node.strategyProfilePath }),
        body: decodedBody,
        outcomes: { ...node.outcomes },
      };
    }
    if (node.kind === 'finish') {
      return { kind: 'finish', ...common, outcome: node.outcome };
    }
    if (node.kind === 'choice') {
      return {
        kind: 'choice',
        ...common,
        profilePath: node.profilePath,
        admissionKind: node.admissionKind,
        workspace: { ...node.workspace },
        choice: { outcomes: [...node.outcomes], branches: { ...node.branches } },
      };
    }
    if (node.kind === 'fan-out') {
      return {
        kind: 'fan-out',
        ...common,
        profilePath: node.profilePath,
        admissionKind: node.admissionKind,
        workspace: { ...node.workspace },
        fanOut: {
          members: node.members.map((member: RuntimePlanFanOutMember) => ({
            hierarchicalPath: member.hierarchicalPath,
            required: member.required,
            condition: member.condition,
          })),
          concurrencyCap: node.concurrencyCap,
          budget: node.budget,
          joinNodeId: rootPath(node.joinNodeId),
        },
      };
    }
    if (node.kind === 'join') {
      return {
        kind: 'join',
        ...common,
        join: {
          requiredMembers: node.requiredMembers.map(rootPath),
          optionalMembers: node.optionalMembers.map(rootPath),
          outcomes: { ...node.outcomes },
        },
      };
    }
    reject(
      'unsupported_runtime_plan',
      `Stored RuntimePlan has unsupported node kind ${JSON.stringify((node as { kind?: unknown }).kind)}.`
    );
  });

  const rebuilt = createRuntimePlan({
    runId: stored.runId,
    pipeline: stored.pipeline,
    planDigest: stored.planDigest,
    profileDigest: stored.profileDigest,
    sourceRevisionDigest: stored.sourceRevisionDigest,
    capabilityDigest: stored.capabilityDigest,
    policyDigest: stored.policyDigest,
    ...(stored.executionProfile === undefined
      ? {}
      : { executionProfile: stored.executionProfile }),
    nodes,
    ...(stored.implicitFinishOutcome === undefined
      ? {}
      : { implicitFinishOutcome: stored.implicitFinishOutcome }),
  });
  if (!isDeepStrictEqual(rebuilt, stored)) {
    reject(
      'invalid_runtime_plan',
      'Stored RuntimePlan contains non-canonical or unknown fields.'
    );
  }
  return rebuilt;
}

function validateChoice(
  path: string,
  node: RuntimePlanNodeInput
): void {
  const ci = node.choice;
  if (ci === undefined) {
    reject('invalid_runtime_plan', `Choice node ${path} must declare choice metadata.`);
  }
  if (ci!.outcomes.length < 2) {
    reject('invalid_runtime_plan', `Choice node ${path} must declare at least 2 outcomes.`);
  }
  for (const outcome of ci!.outcomes) {
    const branch = ci!.branches[outcome];
    if (branch === undefined || branch.length === 0) {
      reject(
        'invalid_runtime_plan',
        `Choice node ${path} outcome ${JSON.stringify(outcome)} must map to a non-empty branch path.`
      );
    }
  }
  if (
    node.admissionKind !== undefined &&
    node.admissionKind !== 'agent' &&
    node.admissionKind !== 'command' &&
    node.admissionKind !== 'host'
  ) {
    reject('invalid_runtime_plan', `Choice node ${path} must declare a supported admission kind.`);
  }
  if (node.gate !== undefined || node.outcome !== undefined || node.body !== undefined) {
    reject('invalid_runtime_plan', `Choice node ${path} must not declare gate, outcome, or body fields.`);
  }
}

function validateFanOut(
  path: string,
  node: RuntimePlanNodeInput
): void {
  const fi = node.fanOut;
  if (fi === undefined) {
    reject('invalid_runtime_plan', `Fan-out node ${path} must declare fanOut metadata.`);
  }
  if (fi!.members.length < 1) {
    reject('invalid_runtime_plan', `Fan-out node ${path} must declare at least 1 member.`);
  }
  if (
    !Number.isSafeInteger(fi!.concurrencyCap) ||
    fi!.concurrencyCap < 1 ||
    fi!.concurrencyCap > 32
  ) {
    reject('invalid_runtime_plan', `Fan-out node ${path} concurrencyCap must be between 1 and 32.`);
  }
  const requiredCount = fi!.members.filter((m) => m.required).length;
  if (!Number.isSafeInteger(fi!.budget) || fi!.budget < requiredCount) {
    reject(
      'invalid_runtime_plan',
      `Fan-out node ${path} budget (${fi!.budget}) must be >= required member count (${requiredCount}).`
    );
  }
  if (fi!.joinNodeId.length === 0) {
    reject('invalid_runtime_plan', `Fan-out node ${path} must reference a join node.`);
  }
  // Check member hierarchical paths for duplicates.
  const memberPaths = new Set<string>();
  for (const member of fi!.members) {
    if (member.hierarchicalPath.length === 0 || member.hierarchicalPath.includes('\\')) {
      reject(
        'invalid_runtime_plan',
        `Fan-out node ${path} member path ${JSON.stringify(member.hierarchicalPath)} is malformed.`
      );
    }
    if (memberPaths.has(member.hierarchicalPath)) {
      reject(
        'invalid_runtime_plan',
        `Fan-out node ${path} member path ${JSON.stringify(member.hierarchicalPath)} is declared more than once.`
      );
    }
    memberPaths.add(member.hierarchicalPath);
  }
  if (node.gate !== undefined || node.outcome !== undefined || node.body !== undefined) {
    reject('invalid_runtime_plan', `Fan-out node ${path} must not declare gate, outcome, or body fields.`);
  }
}

function validateJoin(
  path: string,
  node: RuntimePlanNodeInput
): void {
  const ji = node.join;
  if (ji === undefined) {
    reject('invalid_runtime_plan', `Join node ${path} must declare join metadata.`);
  }
  if (ji!.outcomes.proceed.length === 0 || ji!.outcomes.failed.length === 0) {
    reject('invalid_runtime_plan', `Join node ${path} must declare non-empty proceed and failed outcomes.`);
  }
  // Check required/optional are disjoint.
  const requiredSet = new Set(ji!.requiredMembers);
  for (const opt of ji!.optionalMembers) {
    if (requiredSet.has(opt)) {
      reject(
        'invalid_runtime_plan',
        `Join node ${path} has ${JSON.stringify(opt)} in both required and optional members.`
      );
    }
  }
  if (node.gate !== undefined || node.outcome !== undefined || node.body !== undefined) {
    reject('invalid_runtime_plan', `Join node ${path} must not declare gate, outcome, or body fields.`);
  }
}

function validateBoundedLoop(
  path: string,
  node: RuntimePlanNodeInput
): void {
  if (node.limits === undefined || node.lifecycle === undefined) {
    reject(
      'unsupported_runtime_plan',
      `Bounded loop ${path} uses a policy-free runtime-plan format that cannot be resumed safely.`
    );
  }
  for (const [name, value] of Object.entries(node.limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      reject(
        'invalid_runtime_plan',
        `Bounded loop ${path} ${name} must be a positive safe integer.`
      );
    }
  }
  validateBoundedLoopLifecycle(path, node.lifecycle, node.strategyProfilePath);
  if (node.body?.kind === 'review-cycle') {
    validateReviewCycleBody(path, node);
  } else if (node.body?.kind === 'composite') {
    validateCompositeBody(path, node);
  } else if (node.body?.kind === 'goal-cycle') {
    validateGoalCycleBody(path, node);
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

function validateBoundedLoopLifecycle(
  path: string,
  lifecycle: BoundedLoopLifecyclePolicyV1,
  strategyProfilePath: string | undefined
): void {
  if (lifecycle.version !== 1) {
    reject(
      'unsupported_runtime_plan',
      `Bounded loop ${path} uses unsupported lifecycle version ${JSON.stringify(lifecycle.version)}.`
    );
  }
  if (
    !Number.isSafeInteger(lifecycle.thresholds.stallIterations) ||
    lifecycle.thresholds.stallIterations < 1 ||
    !Number.isSafeInteger(lifecycle.thresholds.sameBlockerAttempts) ||
    lifecycle.thresholds.sameBlockerAttempts < 1 ||
    !Number.isSafeInteger(lifecycle.strategy.maxAttempts) ||
    lifecycle.strategy.maxAttempts < 0 ||
    lifecycle.strategy.requireMaterialChange !== true
  ) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} lifecycle thresholds and strategy bounds are invalid.`
    );
  }
  const exits = lifecycle.exits;
  const entries = Object.entries(exits);
  if (entries.length !== 6) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} lifecycle must declare exactly six trigger dispositions.`
    );
  }
  const strategySelected = entries.some(([, disposition]) => disposition.action === 'strategy');
  if (
    strategySelected &&
    (lifecycle.strategy.maxAttempts < 1 ||
      lifecycle.strategy.capability === undefined ||
      strategyProfilePath === undefined)
  ) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} selects strategy without a positive budget, capability, and frozen profile path.`
    );
  }
  if (
    !strategySelected &&
    (lifecycle.strategy.capability !== undefined || strategyProfilePath !== undefined)
  ) {
    reject(
      'invalid_runtime_plan',
      `Bounded loop ${path} carries an unreachable strategy binding.`
    );
  }
  for (const [trigger, disposition] of entries) {
    if (
      disposition.action !== 'strategy' &&
      (!('outcome' in disposition) ||
        typeof disposition.outcome !== 'string' ||
        disposition.outcome.length === 0)
    ) {
      reject(
        'invalid_runtime_plan',
        `Bounded loop ${path} lifecycle trigger ${trigger} lacks a typed outcome.`
      );
    }
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

function validateGoalCycleBody(
  path: string,
  node: RuntimePlanNodeInput
): void {
  const body = node.body as RuntimePlanGoalCycleBodyInput;
  if (
    body.variant !== 'measure' &&
    body.variant !== 'evaluate' &&
    body.variant !== 'research'
  ) {
    reject(
      'invalid_runtime_plan',
      `GoalCycle body ${path} variant must be measure, evaluate, or research.`
    );
  }
  const expected = ['work', 'judge'] as const;
  const actual = body.phases.map((phase) => phase.phase);
  if (
    actual.length !== expected.length ||
    actual.some((phase, index) => phase !== expected[index])
  ) {
    reject(
      'invalid_runtime_plan',
      `GoalCycle body ${path} must declare work, judge in order.`
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
        `GoalCycle phase profile path ${JSON.stringify(phase.profilePath)} is malformed or duplicated.`
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
        `GoalCycle phase ${phase.phase} must declare a supported admission kind.`
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
