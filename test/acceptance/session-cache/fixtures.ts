import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import { createCanonicalWait } from '../../../src/core/change-run/internal/waits.js';
import { deriveInvocationId } from '../../../src/core/change-run/internal/identity.js';
import type {
  NodeId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import type {
  HostLifecycleEvent,
  HostSnapshot,
  SessionSupervisor,
} from '../../../src/core/management-api/supervisor.js';
import { freezeProductionPreparedPipelineRegistry } from '../../../src/core/pipeline-registry/prepared-registry.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { createRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import {
  startRecord,
} from '../../core/change-run/reconciler-fixture.js';

export const ACCEPTANCE_PIPELINES = [
  'bug-fix',
  'small-feature',
  'full-feature',
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
] as const;

export interface AcceptanceFileManifest {
  root: string;
  runsRoot: string;
  runDirectory: string;
  workspace: string;
  actionFile: string;
  transcriptDirectory: string;
  files: readonly string[];
}

export function buildAcceptanceFileManifest(
  root: string,
  runId: string,
  sessionId: string,
  pathApi: Pick<typeof path, 'join' | 'resolve'> = path
): AcceptanceFileManifest {
  const resolvedRoot = pathApi.resolve(root);
  const runsRoot = pathApi.join(resolvedRoot, 'runs');
  const runDirectory = pathApi.join(
    runsRoot,
    runId.replace(/[^a-z0-9]/giu, '_')
  );
  const workspace = pathApi.join(resolvedRoot, 'workspace');
  const actionFile = pathApi.join(resolvedRoot, 'fixtures', 'action.json');
  const transcriptDirectory = pathApi.join(
    resolvedRoot,
    'transcripts',
    sessionId
  );
  return {
    root: resolvedRoot,
    runsRoot,
    runDirectory,
    workspace,
    actionFile,
    transcriptDirectory,
    files: [
      pathApi.join(runDirectory, 'HEAD'),
      pathApi.join(runDirectory, 'record-v1.json'),
      pathApi.join(runDirectory, 'sessions.json'),
      actionFile,
      pathApi.join(transcriptDirectory, `${sessionId}.jsonl`),
    ],
  };
}

const registryPromise = freezeProductionPreparedPipelineRegistry(process.cwd(), {
  reporter: false,
});

function exactRunId(pipeline: string): RunId {
  return `run:${createHash('sha256').update(`acceptance:${pipeline}`).digest('hex')}` as RunId;
}

export async function createCanonicalAcceptanceRun(
  root: string,
  pipeline: (typeof ACCEPTANCE_PIPELINES)[number],
  agentInput?: Record<string, unknown>
) {
  const registry = await registryPromise;
  const resolution = registry.load(pipeline);
  const prepared = resolution.prepared;
  const authored = prepared.authoredSource as {
    name: string;
    stages: Array<{
      id: string;
      role?: string;
      model?: string;
      gate?: boolean;
      verifyPolicy?: string;
    }>;
  };
  const isV2Authored = prepared.authoredVersion === 2;
  const sourceDisplayName = isV2Authored
    ? prepared.definition.name
    : authored.name;
  const digest = `sha256:${prepared.digests.source}` as const;
  const sourceRevision = {
    layer: resolution.source,
    kind: 'pipeline-yaml' as const,
    sourceId: `${resolution.source}:${sourceDisplayName}`,
    authoredContentDigest: digest,
    semanticDigest: digest,
  };
  const policyStages = isV2Authored ? [] : authored.stages.map((stage) => ({
    nodeId: `stage:${stage.id}`,
    role: stage.role ?? 'implementer',
    model: stage.model ?? 'default',
    effort: 'medium',
    runtime: 'claude',
    sandbox:
      stage.verifyPolicy === 'adaptive' || stage.id === 'verify'
        ? ('read-only' as const)
        : ('workspace-write' as const),
    gate: stage.gate ?? false,
    sessionReuse: 'same-invocation' as const,
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 8,
    provenance: {
      role: 'stage',
      model: stage.model ? 'stage' : 'default',
      effort: 'acceptance',
      runtime: 'acceptance',
      sandbox: 'default',
      gate: 'stage',
      sessionReuse: 'acceptance',
      handoffTokenLimit: 'acceptance',
      reuseRoundLimit: 'acceptance',
    },
  }));
  const resolvedProfile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    policyStages,
    sourceRevision,
    { maxAttempts: 32, maxActions: 128 }
  );
  const profile = isV2Authored
    ? createRuntimeExecutionProfile({
        sourceRevision: resolvedProfile.sourceRevision,
        capabilities: resolvedProfile.capabilities,
        policy: {
          ...resolvedProfile.policy,
          stages: resolvedProfile.policy.stages.map((stage) => ({
            ...stage,
            sessionReuse: 'same-invocation' as const,
            handoffTokenLimit: 10_000,
            reuseRoundLimit: 8,
            provenance: {
              ...stage.provenance,
              sessionReuse: 'acceptance',
              handoffTokenLimit: 'acceptance',
              reuseRoundLimit: 'acceptance',
            },
          })),
        },
      })
    : resolvedProfile;
  const plan = lowerRuntimePlan(prepared, profile, exactRunId(pipeline));
  let record = startRecord(plan);
  let action: Extract<RunAction, { kind: 'agent' }> | undefined;
  for (let step = 0; step < 32 && action === undefined; step += 1) {
    const result = reconcile(plan, record);
    if (!result.ok) throw new Error(result.failure.message);
    const candidate = result.actions[0];
    if (candidate === undefined) {
      throw new Error(`Pipeline ${pipeline} produced no reconciler action.`);
    }
    if (candidate.kind === 'await-gate') {
      const invocationId = deriveInvocationId(
        plan.runId,
        candidate.nodeId,
        0
      );
      const wait = createCanonicalWait(plan.runId, {
        kind: 'gate',
        nodeId: candidate.nodeId,
        invocationId,
        occurrence: 0,
        gateId: candidate.gateId,
        decisionIds: candidate.decisionIds,
      });
      const awaited = reduceCanonicalRunRecord(record, {
        kind: 'await-gate',
        wait,
      });
      if (!awaited.ok) throw new Error(awaited.failure.message);
      const decisionId = candidate.decisionIds[0]!;
      const decided = reduceCanonicalRunRecord(awaited.record, {
        kind: 'decide-gate',
        waitId: wait.waitId,
        decisionId,
        outcome: decisionId,
      });
      if (!decided.ok) throw new Error(decided.failure.message);
      record = decided.record;
      continue;
    }
    if (candidate.kind !== 'admit' || candidate.admissionKind !== 'agent') {
      throw new Error(
        `Pipeline ${pipeline} did not reach an agent admission (${candidate.kind}).`
      );
    }
    const profilePath =
      candidate.profilePath
      ?? plan.nodes.find((node) => node.nodeId === candidate.nodeId)
        ?.hierarchicalPath;
    if (profilePath === undefined) {
      throw new Error(`No profile path for ${candidate.nodeId}.`);
    }
    const capability = profile.capabilities.find(
      (entry) => entry.nodeId === profilePath
    );
    const stage = profile.policy.stages.find(
      (entry) => entry.nodeId === profilePath
    );
    if (capability === undefined || stage === undefined) {
      throw new Error(`No frozen binding for ${profilePath}.`);
    }
    const built = buildAgentAction(
      {
        capability,
        stage,
        executionProfileDigest: profile.profileDigest,
        policyDigest: profile.policyDigest,
      },
      {
        runId: plan.runId,
        nodeId: candidate.nodeId as NodeId,
        occurrence: candidate.occurrence,
        attemptOrdinal: 0,
        expectedBeforeWorkspace: record.currentWorkspaceRevision,
      },
      {
        input:
          agentInput
          ?? candidate.input
          ?? { acceptancePipeline: pipeline },
      }
    );
    if (built.kind !== 'agent') {
      throw new Error(`Expected an agent action for ${pipeline}.`);
    }
    const admitted = reduceCanonicalRunRecord(record, {
      kind: 'admit-action',
      action: built,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    if (!admitted.ok) throw new Error(admitted.failure.message);
    record = admitted.record;
    action = built;
  }
  if (action === undefined) {
    throw new Error(`Pipeline ${pipeline} did not admit an action.`);
  }

  const manifest = buildAcceptanceFileManifest(
    root,
    plan.runId,
    `claude-${pipeline}`
  );
  fs.mkdirSync(manifest.workspace, { recursive: true });
  fs.mkdirSync(path.dirname(manifest.actionFile), { recursive: true });
  fs.mkdirSync(manifest.transcriptDirectory, { recursive: true });
  fs.writeFileSync(manifest.actionFile, `${JSON.stringify(action, null, 2)}\n`);
  fs.writeFileSync(
    path.join(manifest.transcriptDirectory, `claude-${pipeline}.jsonl`),
    `${JSON.stringify({ type: 'result', usage: { input_tokens: 1 } })}\n`
  );
  createFilesystemRunStore(manifest.runsRoot).create(plan.runId, record);

  return {
    plan,
    action,
    record,
    manifest,
  };
}

type NextTurn =
  | { ok: true; result?: Record<string, unknown> }
  | {
      ok: false;
      code:
        | 'delivery_uncertain'
        | 'write_failed'
        | 'turn_timeout'
        | 'no_output_timeout';
    };

let acceptanceSupervisorSequence = 0;

export function createAcceptanceSupervisor() {
  acceptanceSupervisorSequence += 1;
  const supervisorIdentity = acceptanceSupervisorSequence;
  const hosts = new Map<string, HostSnapshot>();
  const listeners = new Set<(event: HostLifecycleEvent) => void>();
  let sequence = 0;
  let nextTurn: NextTurn = { ok: true };
  let wakeGate: Promise<void> | undefined;
  let releaseWake: (() => void) | undefined;
  const calls = {
    create: [] as unknown[],
    wake: [] as unknown[],
    recover: [] as unknown[],
    retire: [] as string[],
    shutdown: 0,
    deliveredMessages: [] as string[],
  };

  function createHost(cwd: string, sessionId: string): HostSnapshot {
    sequence += 1;
    const host: HostSnapshot = {
      id: `acceptance-host-${supervisorIdentity}-${sequence}`,
      state: 'idle',
      cwd,
      pid: 50_000 + supervisorIdentity * 100 + sequence,
      sessionId,
      createdAt: Date.now(),
    };
    hosts.set(host.id, host);
    return host;
  }

  const supervisor = {
    async createHost(input: { cwd: string; message: string }) {
      calls.create.push(input);
      calls.deliveredMessages.push(input.message);
      const host = createHost(input.cwd, `claude-session-${sequence + 1}`);
      return {
        ok: true as const,
        host,
        result: { type: 'result', result: 'bounded-bootstrap-result' },
      };
    },
    async wakeHost(id: string, input: { message: string }) {
      calls.wake.push({ id, input });
      calls.deliveredMessages.push(input.message);
      const existing = hosts.get(id);
      if (existing === undefined) {
        return {
          ok: false as const,
          status: 404 as const,
          code: 'host_not_found' as const,
          message: id,
        };
      }
      hosts.set(id, { ...existing, state: 'waking' });
      if (wakeGate !== undefined) await wakeGate;
      wakeGate = undefined;
      releaseWake = undefined;
      if (!nextTurn.ok) {
        const failed = nextTurn;
        nextTurn = { ok: true };
        const lost = { ...existing, state: 'lost' as const, pid: undefined };
        hosts.set(id, lost);
        return {
          ok: false as const,
          status: 409 as const,
          code: failed.code,
          message: failed.code,
          host: lost,
        };
      }
      const idle = { ...existing, state: 'idle' as const };
      hosts.set(id, idle);
      return {
        ok: true as const,
        host: idle,
        result: nextTurn.result ?? {
          type: 'result',
          result: 'bounded-wake-result',
        },
      };
    },
    async recoverHost(input: {
      cwd: string;
      claudeSessionId: string;
      message: string;
    }) {
      calls.recover.push(input);
      calls.deliveredMessages.push(input.message);
      const host = createHost(input.cwd, input.claudeSessionId);
      return {
        ok: true as const,
        host,
        result: { type: 'result', result: 'bounded-recovery-result' },
      };
    },
    async retireHost(id: string) {
      calls.retire.push(id);
      const existing = hosts.get(id);
      if (existing === undefined) {
        return {
          ok: false as const,
          status: 404 as const,
          code: 'host_not_found' as const,
          message: id,
        };
      }
      const retired = {
        ...existing,
        state: 'retired' as const,
        pid: undefined,
      };
      hosts.set(id, retired);
      return { ok: true as const, host: retired };
    },
    getHost(id: string) {
      const host = hosts.get(id);
      return host === undefined ? undefined : { ...host };
    },
    subscribeHostLifecycle(listener: (event: HostLifecycleEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async shutdownAll() {
      calls.shutdown += 1;
      for (const host of hosts.values()) {
        listeners.forEach((listener) =>
          listener({
            type: 'lost',
            reason: 'owner-shutdown',
            host: { ...host, state: 'lost', pid: undefined },
          })
        );
      }
      hosts.clear();
    },
  } as unknown as SessionSupervisor;

  return {
    supervisor,
    hosts,
    calls,
    pauseNextWake() {
      wakeGate = new Promise<void>((resolve) => {
        releaseWake = resolve;
      });
      return () => releaseWake?.();
    },
    failNextWake(code: Extract<NextTurn, { ok: false }>['code']) {
      nextTurn = { ok: false, code };
    },
    loseHost(hostId: string, reason = 'injected-process-loss') {
      const host = hosts.get(hostId);
      if (host === undefined) throw new Error(`Unknown host ${hostId}`);
      const lost = { ...host, state: 'lost' as const, pid: undefined };
      hosts.delete(hostId);
      listeners.forEach((listener) =>
        listener({ type: 'lost', reason, host: lost })
      );
    },
  };
}
