import {
  resolveDispatchRoute,
  type DetectedHostRuntime,
  type DispatchBridge,
  type DispatchMode,
} from '../runtime-adapters.js';
import {
  analyzeReconcilerSupport,
  type EffectiveRunPolicy,
} from './execution-plan-internal.js';
import {
  projectPreparedBoundedLoopPolicies,
  type AtomicStageNode,
  type CapabilityCatalogSnapshot,
  type DefinitionGraph,
  type PreparedBoundedLoopPolicy,
  type PreparedDefinition,
} from './definition.js';
import { PipelineGraph } from './graph.js';
import {
  resolveCapabilityBindings,
  resolveDiscoveryReconcilerSupportProfile,
  resolveNativeV2PolicyStages,
  type NativeV2ExecutionResolutionInputs,
} from './profile-resolver.js';
import {
  resolveEffectiveStage,
  type EffectiveStageConfig,
} from './stage-overrides.js';
import type {
  AgentRuntime,
  PipelineYaml,
  Stage,
  StageRole,
  VerifyPolicy,
} from './types.js';

export interface PreparedExecutionStageView {
  readonly id: string;
  readonly nodePath: string;
  readonly profilePath: string;
  readonly requires: readonly string[];
  readonly capability: Readonly<{ id: string; version: string }>;
  readonly role: StageRole;
  readonly workspace: 'none' | 'read' | 'write';
  readonly gate: boolean;
  readonly effectiveGate: Readonly<{ value: boolean; source: string }>;
  readonly verifyPolicy: VerifyPolicy | null;
  readonly leadReview: boolean;
  readonly runtime: Readonly<{ value: AgentRuntime; source: string }>;
  readonly dispatchMode: DispatchMode;
  readonly bridge: DispatchBridge | null;
  readonly model: Readonly<{ value: string | null; source: string }>;
  readonly effort: Readonly<{ value: string | null; source: string }>;
  readonly sandbox: 'read-only' | 'workspace-write';
  readonly sessionReuse: Readonly<{
    effective: 'never' | 'same-invocation';
    authored?: 'none' | 'stage' | 'run-planner' | 'review-thread';
    source: string;
  }>;
  readonly handoff: Readonly<EffectiveStageConfig['handoff']>;
}

/**
 * Public, adapter-free projection of every capability binding launch freezes.
 * This includes orchestration-owned paths (for example a FanOut evaluator or
 * bounded-loop recovery strategy) which are executable capabilities but are
 * not authored AtomicStage nodes and therefore must not be fabricated as
 * ordinary stages in the logical stage list.
 */
export interface PreparedExecutionCapabilityPathView {
  readonly profilePath: string;
  readonly capability: Readonly<{ id: string; version: string }>;
  readonly workspace: 'none' | 'read' | 'write';
}

/** Adapter-free projection of every effective policy stage launch freezes. */
export interface PreparedExecutionPolicyPathView {
  readonly profilePath: string;
  readonly role: string;
  readonly runtime: Readonly<{ value: AgentRuntime; source: string }>;
  readonly model: Readonly<{ value: string | null; source: string }>;
  readonly effort: Readonly<{ value: string | null; source: string }>;
  readonly sandbox: 'read-only' | 'workspace-write';
  readonly effectiveGate: Readonly<{ value: boolean; source: string }>;
  readonly sessionReuse: Readonly<{
    effective: 'never' | 'same-invocation';
    authored?: 'none' | 'stage' | 'run-planner' | 'review-thread';
    source: string;
  }>;
  readonly handoffTokenLimit: Readonly<{ value: number; source: string }>;
  readonly reuseRoundLimit: Readonly<{ value: number; source: string }>;
}

export interface PreparedPipelineExecutionView {
  readonly name: string;
  readonly description: string;
  readonly authoredVersion: 1 | 2;
  readonly buildOrder: readonly string[];
  readonly stages: readonly PreparedExecutionStageView[];
  readonly capabilityPaths: readonly PreparedExecutionCapabilityPathView[];
  readonly policyPaths: readonly PreparedExecutionPolicyPathView[];
  readonly boundedLoops: readonly PreparedBoundedLoopPolicy[];
  readonly availableEngines: readonly ('legacy' | 'reconciler')[];
  readonly reconcilerSupport: ReturnType<typeof analyzeReconcilerSupport>['reconcilerSupport'];
}

export interface PreparedExecutionViewInputs
  extends NativeV2ExecutionResolutionInputs {
  readonly host?: DetectedHostRuntime;
}

const EMPTY_INPUTS: PreparedExecutionViewInputs = {
  overrides: {
    gates: new Map(),
    models: new Map(),
    handoff: new Map(),
    runtimes: new Map(),
  },
  basePolicy: { effective: 'on', source: 'default' },
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function graphOrder(graph: DefinitionGraph): readonly string[] {
  const ids = graph.nodes.map((node) => node.id);
  const inDegree = new Map(ids.map((id) => [id, 0 as number] as const));
  const dependents = new Map(ids.map((id) => [id, [] as string[]] as const));
  for (const connection of graph.connections) {
    if (!inDegree.has(connection.from.node) || !inDegree.has(connection.to.node)) {
      continue;
    }
    inDegree.set(connection.to.node, inDegree.get(connection.to.node)! + 1);
    dependents.get(connection.from.node)!.push(connection.to.node);
  }
  const queue = ids.filter((id) => inDegree.get(id) === 0).sort(compareStrings);
  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const newlyReady: string[] = [];
    for (const dependent of dependents.get(current)!.sort(compareStrings)) {
      const next = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, next);
      if (next === 0) newlyReady.push(dependent);
    }
    queue.push(...newlyReady.sort(compareStrings));
  }
  return result;
}

function graphRequirements(graph: DefinitionGraph, nodeId: string): readonly string[] {
  return graph.connections
    .filter((connection) => connection.to.node === nodeId)
    .map((connection) => connection.from.node)
    .sort(compareStrings);
}

function stageFromAtomic(node: AtomicStageNode, gate: boolean): Stage {
  const execution = node.execution!;
  return {
    id: node.id,
    kind: 'standard',
    skill: node.capability.id.startsWith('skill:')
      ? node.capability.id.slice('skill:'.length)
      : node.capability.id,
    role: execution.role,
    requires: [],
    gate,
    leadReview: execution.leadReview ?? false,
    ...(execution.verifyPolicy ? { verifyPolicy: execution.verifyPolicy } : {}),
    ...(execution.runtime ? { runtime: execution.runtime } : {}),
    ...(execution.sessionReuse ? { sessionReuse: execution.sessionReuse } : {}),
    ...(execution.sandbox ? { sandbox: execution.sandbox } : {}),
    ...(execution.model ? { model: execution.model } : {}),
    ...(execution.effort ? { effort: execution.effort } : {}),
    ...(execution.handoff ? { handoff: execution.handoff } : {}),
  };
}

function projectNativeStage(
  definitionName: string,
  node: AtomicStageNode,
  nodePath: string,
  profilePath: string,
  requires: readonly string[],
  gate: boolean,
  policy: EffectiveRunPolicy['stages'][number],
  inputs: PreparedExecutionViewInputs
): PreparedExecutionStageView {
  const execution = node.execution!;
  const stage = stageFromAtomic(node, gate);
  const effective = resolveEffectiveStage(
    stage,
    { version: 1, name: definitionName, stages: [stage] },
    inputs
  );
  const route = resolveDispatchRoute(
    inputs.host?.runtime ?? 'unknown',
    policy.runtime as AgentRuntime
  );
  return {
    id: node.id,
    nodePath,
    profilePath,
    requires,
    capability: { ...node.capability },
    role: execution.role,
    workspace: execution.workspace.access,
    gate,
    effectiveGate: {
      value: policy.gate,
      source: policy.provenance.gate,
    },
    verifyPolicy: execution.verifyPolicy ?? null,
    leadReview: execution.leadReview ?? false,
    runtime: {
      value: policy.runtime as AgentRuntime,
      source: policy.provenance.runtime,
    },
    dispatchMode: route.mode,
    bridge: route.bridge ?? null,
    model: {
      value: policy.model === 'default' ? null : policy.model,
      source: policy.provenance.model,
    },
    effort: {
      value: policy.effort === 'default' ? null : policy.effort,
      source: policy.provenance.effort,
    },
    sandbox: policy.sandbox,
    sessionReuse: {
      effective: policy.sessionReuse,
      ...(policy.sessionReuseAuthored !== undefined
        ? { authored: policy.sessionReuseAuthored }
        : {}),
      source: policy.provenance.sessionReuse,
    },
    handoff: effective.handoff,
  };
}

function projectNativeV2Stages(
  prepared: PreparedDefinition,
  inputs: PreparedExecutionViewInputs
): readonly PreparedExecutionStageView[] {
  const definition = prepared.definition;
  const policyByPath = new Map(
    resolveNativeV2PolicyStages(prepared, inputs).map((policy) => [policy.nodeId, policy])
  );
  const result: PreparedExecutionStageView[] = [];
  const gateTargets = (graph: DefinitionGraph): ReadonlySet<string> =>
    new Set(
      graph.nodes
        .filter((candidate) => candidate.kind === 'Gate')
        .map((candidate) => candidate.target)
    );
  const rootGateTargets = gateTargets(definition.root);
  const rootById = new Map(definition.root.nodes.map((node) => [node.id, node]));
  for (const rootId of graphOrder(definition.root)) {
    const node = rootById.get(rootId)!;
    if (node.kind === 'AtomicStage') {
      const profilePath = `root:${node.id}`;
      const policy = policyByPath.get(profilePath);
      if (!policy) throw new Error(`No effective policy exists for ${profilePath}.`);
      result.push(
        projectNativeStage(
          definition.name,
          node,
          profilePath,
          profilePath,
          graphRequirements(definition.root, node.id).map((id) => `root:${id}`),
          rootGateTargets.has(node.id),
          policy,
          inputs
        )
      );
      continue;
    }
    const declarationId = node.kind === 'CompositeRef'
      ? node.declarationId
      : node.kind === 'BoundedLoop'
        ? node.body
        : null;
    if (declarationId === null) continue;
    const declaration = definition.declarations.find(
      (candidate) => candidate.id === declarationId
    );
    if (!declaration) continue;
    const declarationGateTargets = gateTargets(declaration.graph);
    const bodyById = new Map(declaration.graph.nodes.map((bodyNode) => [bodyNode.id, bodyNode]));
    for (const bodyId of graphOrder(declaration.graph)) {
      const bodyNode = bodyById.get(bodyId)!;
      if (bodyNode.kind !== 'AtomicStage') continue;
      const profilePath = `declaration:${declaration.id}/node:${bodyNode.id}`;
      const policy = policyByPath.get(profilePath);
      if (!policy) throw new Error(`No effective policy exists for ${profilePath}.`);
      result.push(
        projectNativeStage(
          definition.name,
          bodyNode,
          `root:${node.id}/node:${bodyNode.id}`,
          profilePath,
          graphRequirements(declaration.graph, bodyNode.id).map(
            (id) => `root:${node.id}/node:${id}`
          ),
          declarationGateTargets.has(bodyNode.id),
          policy,
          inputs
        )
      );
    }
  }
  return result;
}

function legacyPolicyStage(
  stage: Stage,
  effective: ReturnType<typeof resolveEffectiveStage>
): PreparedExecutionStageView {
  const workspace = stage.role === 'reviewer' ? 'read' : 'write';
  const sandbox = effective.runtime.value && stage.sandbox
    ? stage.sandbox
    : workspace === 'write'
      ? 'workspace-write'
      : 'read-only';
  const reuse = stage.sessionReuse;
  return {
    id: stage.id,
    nodePath: `stage:${stage.id}`,
    profilePath: `stage:${stage.id}`,
    requires: stage.requires.map((id) => `stage:${id}`),
    capability: { id: `skill:${stage.skill ?? stage.id}`, version: 'legacy' },
    role: stage.role ?? 'implementer',
    workspace,
    gate: stage.gate,
    effectiveGate: { value: effective.gate.effective, source: effective.gate.source },
    verifyPolicy: stage.verifyPolicy ?? null,
    leadReview: stage.leadReview,
    runtime: { value: effective.runtime.value, source: effective.runtime.source },
    dispatchMode: effective.dispatchMode,
    bridge: effective.bridge ?? null,
    model: effective.model,
    effort: { value: stage.effort ?? null, source: stage.effort ? 'stage' : 'default' },
    sandbox,
    sessionReuse: {
      effective: reuse === undefined || reuse === 'none' ? 'never' : 'same-invocation',
      ...(reuse !== undefined ? { authored: reuse } : {}),
      source: reuse === undefined ? 'default' : 'stage',
    },
    handoff: effective.handoff,
  };
}

function projectCapabilityPaths(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot
): readonly PreparedExecutionCapabilityPathView[] {
  try {
    return resolveCapabilityBindings(prepared, catalog).map((binding) => ({
      profilePath: binding.nodeId,
      capability: { ...binding.authoredCapability },
      workspace: binding.workspace.access,
    }));
  } catch (error) {
    // Authored v2 already failed closed before this helper is reached. A v1
    // compatibility definition may intentionally contain prompt-owned skills
    // outside the reconciler catalog; keep that legacy view inspectable while
    // engine support truthfully reports execution_profile_unavailable.
    if (prepared.authoredVersion === 2) throw error;
    return [];
  }
}

function projectPolicyPaths(
  prepared: PreparedDefinition,
  inputs: PreparedExecutionViewInputs
): readonly PreparedExecutionPolicyPathView[] {
  if (prepared.authoredVersion !== 2) return [];
  return resolveNativeV2PolicyStages(prepared, inputs).map((policy) => ({
    profilePath: policy.nodeId,
    role: policy.role,
    runtime: {
      value: policy.runtime as AgentRuntime,
      source: policy.provenance.runtime,
    },
    model: {
      value: policy.model === 'default' ? null : policy.model,
      source: policy.provenance.model,
    },
    effort: {
      value: policy.effort === 'default' ? null : policy.effort,
      source: policy.provenance.effort,
    },
    sandbox: policy.sandbox,
    effectiveGate: {
      value: policy.gate,
      source: policy.provenance.gate,
    },
    sessionReuse: {
      effective: policy.sessionReuse,
      ...(policy.sessionReuseAuthored !== undefined
        ? { authored: policy.sessionReuseAuthored }
        : {}),
      source: policy.provenance.sessionReuse,
    },
    handoffTokenLimit: {
      value: policy.handoffTokenLimit,
      source: policy.provenance.handoffTokenLimit,
    },
    reuseRoundLimit: {
      value: policy.reuseRoundLimit,
      source: policy.provenance.reuseRoundLimit,
    },
  }));
}

/**
 * Pure inspection boundary shared by read planes and launch-facing profile
 * resolution. The opaque compiled runtime plan is intentionally not exposed.
 */
export function projectPreparedPipelineExecutionView(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot,
  inputs: PreparedExecutionViewInputs = EMPTY_INPUTS
): PreparedPipelineExecutionView {
  // Resolve bindings eagerly so inspection fails closed at the same trusted
  // capability boundary as launch, even though the public view retains the
  // authored exact capability identity rather than adapter internals.
  // Native v2 capability identity is authored and exact, so inspection must
  // fail at the same trusted boundary as launch. Compatibility v1 may contain
  // prompt-owned primitives (notably auto-decompose) that intentionally have
  // no reconciler capability descriptor; its legacy view remains inspectable
  // while engine discovery reports the fail-closed support reason.
  if (prepared.authoredVersion === 2) {
    resolveCapabilityBindings(prepared, catalog);
  }
  const support = analyzeReconcilerSupport(
    prepared,
    resolveDiscoveryReconcilerSupportProfile(prepared, catalog)
  );
  const authored = prepared.authoredSource;
  const stages = prepared.authoredVersion === 2
    ? projectNativeV2Stages(prepared, inputs)
    : (() => {
        const pipeline = authored as PipelineYaml;
        return pipeline.stages.map((stage) =>
          legacyPolicyStage(stage, resolveEffectiveStage(stage, pipeline, inputs))
        );
      })();
  const buildOrder = prepared.authoredVersion === 2
    ? stages.map((stage) => stage.nodePath)
    : PipelineGraph.fromPipeline(authored as PipelineYaml).getBuildOrder();
  return Object.freeze({
    name: authored.name,
    description: authored.description ?? '',
    authoredVersion: prepared.authoredVersion,
    buildOrder: Object.freeze([...buildOrder]),
    stages: Object.freeze([...stages]),
    capabilityPaths: Object.freeze([
      ...projectCapabilityPaths(prepared, catalog),
    ]),
    policyPaths: Object.freeze([...projectPolicyPaths(prepared, inputs)]),
    boundedLoops: projectPreparedBoundedLoopPolicies(prepared),
    availableEngines: Object.freeze([...support.availableEngines]),
    reconcilerSupport: support.reconcilerSupport,
  });
}
