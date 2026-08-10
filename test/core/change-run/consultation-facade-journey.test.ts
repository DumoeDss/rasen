import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type {
  Digest,
  JsonValue,
  NodeId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import { decodeChangeRunReceipt } from '../../../src/core/change-run/contracts.js';
import type {
  ExactTeacherAttemptPhase,
  ExactTeacherAttemptPhaseCommitter,
  ExactTeacherAttemptSeed,
  HostedTurnReceipt,
  SessionHost,
  SessionHostView,
} from '../../../src/core/session-host/contracts.js';
import {
  deriveContinuationRequestId,
  deriveConsultationId,
  deriveFreshStepRequestId,
  digestContinuationInput,
  digestTeacherConsultationAdvice,
} from '../../../src/core/change-run/consultation-contracts.js';
import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import {
  createCanonicalReceiptContinuationAuthority,
  decodeCanonicalRunRecord,
  digestCanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import { createBoundedEvidenceStore } from '../../../src/core/change-run/internal/evidence.js';
import { createFilesystemEvidenceStore } from '../../../src/core/change-run/internal/evidence-store-fs.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createHostEvidenceWriter } from '../../../src/core/change-run/internal/host-evidence-writer.js';
import {
  canonicalJson,
  digestLaunchIntent,
} from '../../../src/core/change-run/internal/identity.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import {
  createRuntimePlan,
  type RuntimePlan,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import { createWorkspaceReservationRegistry } from '../../../src/core/change-run/internal/reservations.js';
import {
  openStoredRuntimeContext,
  runtimeServiceReservationRegistry,
  StoredRuntimeContextError,
} from '../../../src/core/change-run/internal/runtime-context.js';
import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendOpenInput,
  BackendTermination,
  BackendEvent,
  BackendTurn,
} from '../../../src/core/session-host/backend.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
} from '../../../src/core/session-host/registry.js';
import type { ProcessScope } from '../../../src/core/session-host/process-scope.js';
import {
  createProcessAuthorityCoordinator,
  createProviderBackedProcessScope,
} from '../../../src/core/session-host/process-authority/index.js';
import { handleFrozenActionDispatch } from '../../../src/core/management-api/frozen-action-executor.js';
import { startManagementServer } from '../../../src/core/management-api/server.js';
import { observeStableWorkspaceManifest } from '../../../src/core/workspace-manifest.js';
import {
  buildExecutionCapabilityMatrix,
} from '../../../src/core/frozen-action-executor/capability-matrix.js';
import {
  dispatchGrantedAction,
  dispatchGrantedContinuation,
  type HostedBackendSeam,
} from '../../../src/core/frozen-action-executor/executor.js';
import { createProductionConsultationDriver } from '../../../src/core/frozen-action-executor/consultation-driver.js';
import {
  createExactTeacherAttemptJournal,
  createExactTeacherAttemptPersistence,
  createExactTeacherAuthorityPolicyForTesting,
} from '../../../src/core/frozen-action-executor/index.js';
import {
  createRuntimeExecutionProfile,
  type RuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import {
  TEST_ATTESTATION_AUTHORITY,
  createTestTrustedCompletionProducer,
  provisionTestTrustedExecutionAdapterCredentials,
  trustedDescriptor,
} from '../../fixtures/trusted-completion.js';
import { provisionTrustedExecutionAdapterCatalog } from '../../../src/core/pipeline-registry/trusted-execution-adapters.js';
import { prepareTestSessionTransport } from '../../helpers/session-host-backend.js';
import { createDeterministicProcessAuthorityProviderFixture } from '../../helpers/deterministic-process-authority-provider.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';
import {
  fixtureWorkspaceRevision,
  startRecord,
} from './reconciler-fixture.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) =>
  branded<Digest>(`sha256:${char.repeat(64)}`);

const RUN_ID = branded<RunId>(`run:${'7'.repeat(64)}`);
const SOURCE_SESSION_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_REQUEST_ID = '22222222-2222-2222-2222-222222222222';

function waitForPathSync(target: string, timeoutMs = 5_000): void {
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(target)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for deterministic fixture path ${target}.`);
    }
    Atomics.wait(signal, 0, 0, 10);
  }
}

function hostedReceipt(
  action: RunAction,
  requestId: string,
  state: 'settled' | 'sent' | 'ambiguous',
  digestChar = 'd'
): HostedTurnReceipt {
  if (action.kind !== 'agent') throw new Error('expected agent Action');
  return {
    format: 'rasen-session-host-turn-receipt/1',
    stableSessionId: SOURCE_SESSION_ID,
    backend: 'hosted',
    requestId,
    requestState: state,
    cwd: '/root',
    cwdDigest: 'c'.repeat(64),
    sandbox: action.agent.sandbox,
    authority: {
      invocationId: action.invocationId,
      role: action.agent.role,
      workspaceInstanceId: `workspace-instance:${'3'.repeat(64)}`,
      backend: 'hosted',
      handoffTokensUsed: 0,
      reuseRoundsServed: 0,
    },
    ...(state === 'settled'
      ? {
          resultRef: `host-result:sha256:${digestChar.repeat(64)}`,
          resultDigest: digestChar.repeat(64),
          result: '{"status":"DONE","summary":"implemented"}',
        }
      : {}),
    replayed: false,
  };
}

const consultationBinding = {
  sourceProfilePath: 'source',
  teacherProfilePath: 'teacher',
  maxConsultationsPerInvocation: 2,
  maxTeacherAttemptsPerConsultation: 2,
  limits: {
    maxQuestionBytes: 4096,
    maxAdviceBytes: 8192,
    maxAttemptedApproaches: 4,
    maxConstraints: 4,
    maxEvidencePointers: 4,
    maxAdviceSteps: 8,
    maxCautions: 4,
    maxEvidenceNotes: 4,
  },
} as const;

function capability(path: 'source' | 'teacher') {
  const teacher = path === 'teacher';
  return {
    nodeId: path,
    authoredCapability: { id: `skill:${path}`, version: '1' },
    contract: { id: path, version: '1', digest: digest(teacher ? '3' : '2') },
    actionKind: 'agent' as const,
    resultContract: {
      id: `${path}-result`,
      version: '1',
      digest: digest(teacher ? '5' : '4'),
    },
    evidenceContract: {
      id: `${path}-evidence`,
      version: '1',
      digest: digest(teacher ? '7' : '6'),
    },
    recovery: 'suspend-if-ambiguous' as const,
    workspace: {
      access: teacher ? ('read' as const) : ('write' as const),
      resources: ['worktree'],
    },
    effects: [],
    adapter: {
      id: `adapter:${path}`,
      version: '1',
      contentDigest: digest(teacher ? '9' : '8'),
      attestationAuthority: TEST_ATTESTATION_AUTHORITY,
    },
  };
}

function stage(path: 'source' | 'teacher') {
  const teacher = path === 'teacher';
  return {
    nodeId: path,
    role: teacher ? 'teacher' : 'implementer',
    model: teacher ? 'teacher-model' : 'implementer-model',
    effort: 'high',
    runtime: 'codex',
    sandbox: teacher ? ('read-only' as const) : ('workspace-write' as const),
    gate: false,
    sessionReuse: 'same-invocation' as const,
    handoffTokenLimit: 0,
    reuseRoundLimit: 0,
    provenance: {
      role: 'fixture',
      model: 'fixture',
      effort: 'fixture',
      runtime: 'fixture',
      sandbox: 'fixture',
      gate: 'fixture',
      sessionReuse: 'fixture',
      handoffTokenLimit: 'fixture',
      reuseRoundLimit: 'fixture',
    },
  };
}

function executionProfile(): RuntimeExecutionProfile {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:consultation-fixture',
      authoredContentDigest: digest('a'),
      semanticDigest: digest('b'),
    },
    capabilities: [capability('source'), capability('teacher')],
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 16,
      maxActions: 32,
      stages: [stage('source'), stage('teacher')],
    },
    consultations: [consultationBinding],
  });
}

function runtimePlan(
  profile: RuntimeExecutionProfile,
  boundedLoop = false
): RuntimePlan {
  return createRuntimePlan({
    runId: RUN_ID,
    pipeline: 'consultable-fixture',
    planDigest: digest('c'),
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
    executionProfile: profile,
    implicitFinishOutcome: 'consultable-fixture-completed',
    nodes: boundedLoop
      ? [
          {
            kind: 'bounded-loop' as const,
            hierarchicalPath: 'root/loop',
            requires: [],
            limits: { maxIterations: 3, maxActions: 8, budget: 8 },
            lifecycle: {
              version: 1 as const,
              thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
              strategy: {
                maxAttempts: 2,
                requireMaterialChange: true as const,
                capability: { id: 'skill:loop-strategy', version: '1' },
              },
              exits: {
                iterationLimit: { action: 'strategy' as const },
                actionLimit: { action: 'fail' as const, outcome: 'action-limit' },
                budgetLimit: { action: 'fail' as const, outcome: 'budget-limit' },
                stalled: { action: 'strategy' as const },
                blocked: { action: 'strategy' as const },
                strategyExhausted: {
                  action: 'fail' as const,
                  outcome: 'strategy-exhausted',
                },
              },
            },
            strategyProfilePath: 'loop-strategy',
            body: {
              kind: 'composite' as const,
              declarationId: 'consultable-loop',
              stages: [
                {
                  hierarchicalPath: 'root/loop/source',
                  profilePath: 'source',
                  admissionKind: 'agent' as const,
                  workspace: { access: 'write' as const },
                  requires: [],
                },
              ],
              outcomes: { done: 'done' },
            },
            outcomes: { clean: 'done', exhausted: 'exhausted' },
          },
        ]
      : [
          {
            kind: 'atomic' as const,
            hierarchicalPath: 'source',
            profilePath: 'source',
            requires: [],
            admissionKind: 'agent' as const,
            workspace: { access: 'write' as const },
          },
        ],
  });
}

const TASK_LOOP_WORK_PATH = 'declaration:task-loop/node:work';
const TASK_LOOP_JUDGE_PATH = 'declaration:task-loop/node:judge';
const TASK_LOOP_INPUT = Object.freeze({
  taskLoop: {
    format: 'task-loop-input/1',
    goal: 'Finish the consulted implementation safely.',
    artifactTargets: ['README.md'],
    bar: [{
      id: 'focused-check',
      criterion: 'The focused check passes.',
      evidenceHint: 'Run the focused consultation restart journey.',
    }],
    constraints: ['Preserve canonical source Session authority.'],
  },
  gatePolicy: { effective: 'off', source: 'flag' },
}) as Readonly<Record<string, JsonValue>>;

function taskLoopExecutionProfile(): RuntimeExecutionProfile {
  const sourceCapability = {
    ...capability('source'),
    nodeId: TASK_LOOP_WORK_PATH,
  };
  const judgeCapability = {
    ...capability('source'),
    nodeId: TASK_LOOP_JUDGE_PATH,
    authoredCapability: { id: 'skill:task-loop-judge', version: '1' },
    workspace: { access: 'read' as const, resources: ['worktree'] },
  };
  const shipCapability = {
    ...capability('source'),
    nodeId: 'root/ship',
    authoredCapability: { id: 'skill:ship', version: '1' },
  };
  const archiveCapability = {
    ...capability('source'),
    nodeId: 'root/archive',
    authoredCapability: { id: 'skill:archive', version: '1' },
  };
  const strategyCapability = {
    ...capability('source'),
    nodeId: 'loop-strategy',
    authoredCapability: { id: 'skill:loop-strategy', version: '1' },
  };
  const teacherCapability = {
    ...capability('teacher'),
    nodeId: 'teacher',
  };
  const sourceStage = {
    ...stage('source'),
    nodeId: TASK_LOOP_WORK_PATH,
    runtime: 'claude',
    sessionReuse: 'same-invocation' as const,
  };
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:task-loop-consultation-fixture',
      authoredContentDigest: digest('a'),
      semanticDigest: digest('b'),
    },
    capabilities: [
      sourceCapability,
      judgeCapability,
      shipCapability,
      archiveCapability,
      strategyCapability,
      teacherCapability,
    ],
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 16,
      maxActions: 32,
      stages: [
        sourceStage,
        {
          ...stage('source'),
          nodeId: TASK_LOOP_JUDGE_PATH,
          role: 'reviewer',
          runtime: 'codex',
          sandbox: 'read-only' as const,
          sessionReuse: 'never' as const,
        },
        { ...stage('source'), nodeId: 'root/ship', role: 'shipper' },
        { ...stage('source'), nodeId: 'root/archive', role: 'shipper' },
        { ...stage('source'), nodeId: 'loop-strategy', role: 'implementer' },
        { ...stage('teacher'), nodeId: 'teacher', runtime: 'claude' },
      ],
    },
    consultations: [{
      ...consultationBinding,
      sourceProfilePath: TASK_LOOP_WORK_PATH,
      teacherProfilePath: 'teacher',
    }],
  });
}

function taskLoopRuntimePlan(profile: RuntimeExecutionProfile): RuntimePlan {
  return createRuntimePlan({
    runId: RUN_ID,
    pipeline: 'task-loop',
    planDigest: digest('c'),
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
    executionProfile: profile,
    implicitFinishOutcome: 'task-loop-completed',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/iterate',
        requires: [],
        limits: { maxIterations: 2, maxActions: 8, budget: 8 },
        lifecycle: {
          version: 1,
          thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
          strategy: {
            maxAttempts: 1,
            requireMaterialChange: true,
            capability: { id: 'skill:loop-strategy', version: '1' },
          },
          exits: {
            iterationLimit: { action: 'strategy' },
            actionLimit: { action: 'fail', outcome: 'action-limit' },
            budgetLimit: { action: 'fail', outcome: 'budget-limit' },
            stalled: { action: 'strategy' },
            blocked: { action: 'strategy' },
            strategyExhausted: { action: 'fail', outcome: 'strategy-exhausted' },
          },
        },
        strategyProfilePath: 'loop-strategy',
        body: {
          kind: 'goal-cycle',
          variant: 'evaluate',
          phases: [
            {
              phase: 'work',
              profilePath: TASK_LOOP_WORK_PATH,
              admissionKind: 'agent',
              workspace: { access: 'write' },
            },
            {
              phase: 'judge',
              profilePath: TASK_LOOP_JUDGE_PATH,
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
          ],
        },
        outcomes: { clean: 'satisfied', exhausted: 'task_loop_exhausted' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root/ship',
        profilePath: 'root/ship',
        requires: ['root/iterate'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root/archive',
        profilePath: 'root/archive',
        requires: ['root/ship'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
    ],
  });
}

function fixture(
  options: Readonly<{
    boundedLoop?: boolean;
    taskLoop?: boolean;
    verifyHostedTurnReceipt?: (receipt: HostedTurnReceipt) => boolean;
    storeRoot?: string;
  }> = {}
) {
  const profile = options.taskLoop === true
    ? taskLoopExecutionProfile()
    : executionProfile();
  const plan = options.taskLoop === true
    ? taskLoopRuntimePlan(profile)
    : runtimePlan(profile, options.boundedLoop ?? false);
  const initialRecord = options.taskLoop === true
    ? decodeCanonicalRunRecord({
        ...startRecord(plan),
        launchRequestDigest: digestLaunchIntent({
          pipeline: plan.pipeline,
          engine: 'reconciler',
          inputs: TASK_LOOP_INPUT,
        }),
        inputs: TASK_LOOP_INPUT,
      })
    : startRecord(plan);
  const store =
    options.storeRoot === undefined
      ? createInMemoryRunStore()
      : createFilesystemRunStore(options.storeRoot);
  const evidenceStore =
    options.storeRoot === undefined
      ? createBoundedEvidenceStore({
          maxRunBytes: 1024 * 1024,
          maxEntries: 32,
        })
      : createFilesystemEvidenceStore(options.storeRoot, plan.runId, {
          maxRunBytes: 1024 * 1024,
          maxEntries: 32,
        });
  const reservations = createWorkspaceReservationRegistry();
  const capabilityByPath = new Map(
    profile.capabilities.map((entry) => [entry.nodeId, entry] as const)
  );
  const stageByPath = new Map(
    profile.policy.stages.map((entry) => [entry.nodeId, entry] as const)
  );
  const buildAction = (descriptor: {
    nodeId: string;
    occurrence: number;
    admissionKind: 'agent' | 'command' | 'host';
    profilePath?: string;
    input?: JsonValue;
  }): RunAction => {
    const path = descriptor.profilePath ?? 'source';
    const boundCapability = capabilityByPath.get(path);
    const boundStage = stageByPath.get(path);
    if (boundCapability === undefined || boundStage === undefined) {
      throw new Error(`No frozen profile for ${path}.`);
    }
    const sourceBinding = profile.consultations?.find(
      (entry) => entry.sourceProfilePath === path
    );
    return buildAgentAction(
      {
        capability: boundCapability,
        stage: boundStage,
        executionProfileDigest: profile.profileDigest,
        policyDigest: profile.policyDigest,
        ...(sourceBinding === undefined
          ? {}
          : { consultationBinding: sourceBinding }),
      },
      {
        runId: plan.runId,
        nodeId: descriptor.nodeId as NodeId,
        occurrence: descriptor.occurrence,
        attemptOrdinal: 0,
        expectedBeforeWorkspace: fixtureWorkspaceRevision,
      },
      { input: descriptor.input ?? { change: 'fixture-change' } }
    );
  };
  const makeRuntime = () =>
    createChangePipelineRuntime({
      store,
      plan,
      initialRecord,
      executionProfile: profile,
      evidenceStore,
      reservationRegistry: reservations,
      verifyHostedTurnReceipt: options.verifyHostedTurnReceipt ?? (() => true),
      buildAction,
    });
  const writer = createHostEvidenceWriter({
    runId: plan.runId,
    runStore: store,
    evidenceStore,
  });
  return {
    profile,
    plan,
    store,
    initialRecord,
    evidenceStore,
    reservations,
    writer,
    makeRuntime,
    taskLoop: options.taskLoop === true,
  };
}

async function startAndConsult(
  fx: ReturnType<typeof fixture>,
  projectRoot = '/root'
) {
  const runtime = fx.makeRuntime();
  const launchRequestDigest = fx.taskLoop
    ? digestLaunchIntent({
        pipeline: fx.plan.pipeline,
        engine: 'reconciler',
        inputs: TASK_LOOP_INPUT,
      })
    : undefined;
  const started = await runtime.start(
    {
      change: { projectRoot, changeId: 'fixture-change' },
      pipeline: fx.plan.pipeline,
      launchRequestId: branded(`launch:${'1'.repeat(64)}`),
      ...(fx.taskLoop ? { inputs: TASK_LOOP_INPUT, launchRequestDigest } : {}),
    },
    { deliveryMode: 'grant' }
  );
  const sourceAction = started.actions[0]!;
  const result = JSON.stringify({
    status: 'CONSULT',
    problemSummary: 'The continuation owner is unclear.',
    question: 'Which canonical state should own advice delivery?',
    attemptedApproaches: ['Inspected the reducer and SessionHost.'],
    constraints: ['Preserve exact source Session identity.'],
    evidencePointers: ['src/core/change-run/internal/reducer.ts'],
  });
  const submission = createTestTrustedCompletionProducer(
    sourceAction
  ).attestConsultation({
    change: { projectRoot, changeId: 'fixture-change' },
    record: fx.store.load(fx.plan.runId),
    action: sourceAction,
    result,
    resultDigest: createHash('sha256').update(result, 'utf8').digest('hex'),
    stableSessionId: SOURCE_SESSION_ID,
    requestId: SOURCE_REQUEST_ID,
    limits: consultationBinding.limits,
  });
  fx.writer.publishConsultation(submission.consultation, submission.uploads);
  const consulted = await runtime.consult(submission.consultation, {
    deliveryMode: 'grant',
  });
  return { runtime, sourceAction, submission, consulted };
}

describe('attested Teacher consultation Facade journey', () => {
  it('treats SessionHost output as untrusted until strict consultable parsing and digest validation', async () => {
    const fx = fixture();
    const runtime = fx.makeRuntime();
    const started = await runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: fx.plan.pipeline,
        launchRequestId: branded(`launch:${'2'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const sourceAction = started.actions[0]!;
    const producer = createTestTrustedCompletionProducer(sourceAction);
    const result = JSON.stringify({
      status: 'CONSULT',
      problemSummary: 'Need a second opinion.',
      question: 'Which invariant owns this transition?',
      attemptedApproaches: [],
      constraints: [],
      evidencePointers: [],
    });
    expect(() =>
      producer.attestConsultation({
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        record: fx.store.load(fx.plan.runId),
        action: sourceAction,
        result,
        resultDigest: '0'.repeat(64),
        stableSessionId: SOURCE_SESSION_ID,
        requestId: SOURCE_REQUEST_ID,
        limits: consultationBinding.limits,
      })
    ).toThrow(/result digest/i);
    const terminal = JSON.stringify({ status: 'DONE', summary: 'finished' });
    expect(() =>
      producer.attestConsultation({
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        record: fx.store.load(fx.plan.runId),
        action: sourceAction,
        result: terminal,
        resultDigest: createHash('sha256')
          .update(terminal, 'utf8')
          .digest('hex'),
        stableSessionId: SOURCE_SESSION_ID,
        requestId: SOURCE_REQUEST_ID,
        limits: consultationBinding.limits,
      })
    ).toThrow(/terminal, not CONSULT/i);
    expect(fx.store.load(fx.plan.runId).consultations).toBeUndefined();
  });

  it('drives the production CONSULT -> Teacher -> exact continuation loop from canonical receipts', async () => {
    const fx = fixture();
    const facade = fx.makeRuntime();
    const started = await facade.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: fx.plan.pipeline,
        launchRequestId: branded(`launch:${'a'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const sourceAction = started.actions[0]!;
    if (sourceAction.kind !== 'agent') throw new Error('expected source agent');
    const sourceSessionId = SOURCE_SESSION_ID;
    const teacherSessionId = '33333333-3333-3333-3333-333333333333';
    const sessions = new Map<string, ReturnType<NonNullable<HostedBackendSeam['inspectSession']>>>();
    const consultationId = deriveConsultationId(
      sourceAction.runId,
      sourceAction.actionId as never,
      1
    );

    const backend: HostedBackendSeam = {
      kind: 'hosted',
      inspectSession(sessionId) {
        return sessions.get(sessionId);
      },
      async executeTurn(input) {
        if (input.action.kind !== 'agent') throw new Error('expected agent turn');
        const continuation = input.sessionId !== undefined;
        const stableSessionId =
          input.sessionId ??
          (input.action.agent.role === 'teacher'
            ? teacherSessionId
            : sourceSessionId);
        const requestId =
          input.requestId ??
          deriveFreshStepRequestId(
            input.action.runId as never,
            input.action.actionId as never,
            input.action.attemptId as never
          );
        const result = continuation
          ? JSON.stringify({ status: 'DONE', summary: 'implemented with advice' })
          : input.action.agent.role === 'teacher'
            ? JSON.stringify({
                contract: 'teacher-consultation/advice/1',
                consultationId,
                teacherAttempt: 1,
                decision: 'correction',
                rationale: 'Keep advice delivery inside the canonical driver.',
                steps: ['Resume the exact source Session.'],
                cautions: ['Do not relay through LEAD.'],
                evidenceNotes: [],
              })
            : JSON.stringify({
                status: 'CONSULT',
                problemSummary: 'Need a direct second opinion.',
                question: 'Which boundary should own advice delivery?',
                attemptedApproaches: ['Inspected the canonical Record.'],
                constraints: ['Preserve the exact source Session.'],
                evidencePointers: ['src/core/change-run/internal/facade-runtime.ts'],
              });
        const resultDigest = createHash('sha256').update(result, 'utf8').digest('hex');
        const authority = {
          invocationId: input.action.invocationId,
          role: input.action.agent.role,
          workspaceInstanceId: fx.store.load(fx.plan.runId).workspaceInstanceId,
          backend: 'hosted' as const,
          handoffTokensUsed: 0,
          reuseRoundsServed: continuation ? 1 : 0,
        };
        sessions.set(stableSessionId, {
          sandbox: input.sandbox,
          authority,
        });
        const receipt: HostedTurnReceipt = {
          format: 'rasen-session-host-turn-receipt/1',
          stableSessionId,
          backend: 'hosted',
          backendSessionId: `backend-${stableSessionId}`,
          requestId,
          requestState: 'settled',
          cwd: '/root',
          cwdDigest: 'c'.repeat(64),
          sandbox: input.sandbox,
          authority,
          resultRef: `host-result:sha256:${resultDigest}`,
          resultDigest,
          result,
          replayed: false,
        };
        return {
          daemonAlive: true,
          turn: {
            ok: true,
            status: 'succeeded',
            hostedTurn: {
              stableSessionId,
              backendSessionId: receipt.backendSessionId,
              requestId,
              requestState: 'settled',
              result,
              resultDigest: `sha256:${resultDigest}`,
              resultRef: receipt.resultRef,
              receipt,
              replayed: false,
              cwd: '/root',
            },
          },
        };
      },
    };
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const backends = { hosted: backend };
    const executor = {
      matrix,
      backends,
      dispatch: (
        options: Omit<
          Parameters<typeof dispatchGrantedAction>[0],
          'matrix' | 'backends'
        >
      ) =>
        dispatchGrantedAction({ ...options, matrix, backends }),
      dispatchContinuation: (
        options: Omit<Parameters<typeof dispatchGrantedContinuation>[0], 'matrix' | 'backends'>
      ) => dispatchGrantedContinuation({ ...options, matrix, backends }),
    };
    const runRef = {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: fx.plan.runId,
    };
    const initial = await executor.dispatch({
      runRef,
      grantedAction: sourceAction,
      record: fx.store.load(fx.plan.runId),
      expectedRecordVersion: fx.store.load(fx.plan.runId).recordVersion,
      workspaceRevision: sourceAction.expectedBeforeWorkspace,
      requestedBackend: 'hosted',
      turnInput: JSON.stringify(sourceAction.agent.input),
    });
    expect(initial.kind).toBe('executed');
    const driven = await createProductionConsultationDriver({
      runRef,
      runtime: {
        plan: fx.plan,
        facade,
        store: fx.store,
        initialRecord: fx.initialRecord,
        evidenceStore: fx.evidenceStore,
        hostEvidenceWriter: fx.writer,
      },
      executor,
      producerFor: (action) => createTestTrustedCompletionProducer(action),
    }).driveInitial(sourceAction, initial);

    expect(driven.dispatches).toHaveLength(3);
    expect(driven.finalReceipt?.view.status).toBe('completed');
    const record = fx.store.load(fx.plan.runId);
    expect(Object.values(record.actions).some(
      (entry) => entry.action.kind === 'agent' && entry.action.agent.role === 'lead'
    )).toBe(false);
    expect(new Set(driven.dispatches.flatMap((dispatch) =>
      dispatch.kind === 'executed' && dispatch.outcome.hostedTurn
        ? [dispatch.outcome.hostedTurn.stableSessionId]
        : []
    ))).toEqual(new Set([sourceSessionId, teacherSessionId]));
  });

  it('bounds production Teacher infrastructure retries and releases each sponsored read before unavailable continuation', async () => {
    const fx = fixture();
    const facade = fx.makeRuntime();
    const started = await facade.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: fx.plan.pipeline,
        launchRequestId: branded(`launch:${'b'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const sourceAction = started.actions[0]!;
    if (sourceAction.kind !== 'agent') throw new Error('expected source agent');
    const sessions = new Map<
      string,
      ReturnType<NonNullable<HostedBackendSeam['inspectSession']>>
    >();
    const teacherActionIds: string[] = [];
    const reservationSnapshots: string[][] = [];
    let continuationInput: unknown;

    const backend: HostedBackendSeam = {
      kind: 'hosted',
      inspectSession(sessionId) {
        return sessions.get(sessionId);
      },
      async executeTurn(input) {
        if (input.action.kind !== 'agent') throw new Error('expected agent turn');
        const continuation = input.sessionId !== undefined;
        const stableSessionId = input.sessionId ?? SOURCE_SESSION_ID;
        const requestId =
          input.requestId ??
          deriveFreshStepRequestId(
            input.action.runId as never,
            input.action.actionId as never,
            input.action.attemptId as never
          );
        const result = continuation
          ? JSON.stringify({ status: 'DONE', summary: 'continued without Teacher' })
          : JSON.stringify({
              status: 'CONSULT',
              problemSummary: 'The preferred approach is unavailable.',
              question: 'What bounded fallback should be attempted?',
              attemptedApproaches: ['Tried the primary implementation.'],
              constraints: ['Do not wait indefinitely for infrastructure.'],
              evidencePointers: [],
            });
        if (continuation) {
          continuationInput = JSON.parse(input.input);
          reservationSnapshots.push(
            fx.reservations
              .snapshot(fx.store.load(fx.plan.runId).workspaceInstanceId)
              .map((entry) => entry.actionId)
          );
        }
        const resultDigest = createHash('sha256')
          .update(result, 'utf8')
          .digest('hex');
        const authority = {
          invocationId: input.action.invocationId,
          role: input.action.agent.role,
          workspaceInstanceId: fx.store.load(fx.plan.runId).workspaceInstanceId,
          backend: 'hosted' as const,
          handoffTokensUsed: 0,
          reuseRoundsServed: continuation ? 1 : 0,
        };
        sessions.set(stableSessionId, {
          sandbox: input.sandbox,
          authority,
        });
        const receipt: HostedTurnReceipt = {
          format: 'rasen-session-host-turn-receipt/1',
          stableSessionId,
          backend: 'hosted',
          backendSessionId: `backend-${stableSessionId}`,
          requestId,
          requestState: 'settled',
          cwd: '/root',
          cwdDigest: 'c'.repeat(64),
          sandbox: input.sandbox,
          authority,
          resultRef: `host-result:sha256:${resultDigest}`,
          resultDigest,
          result,
          replayed: false,
        };
        return {
          daemonAlive: true,
          turn: {
            ok: true,
            status: 'succeeded',
            hostedTurn: {
              stableSessionId,
              backendSessionId: receipt.backendSessionId,
              requestId,
              requestState: 'settled',
              result,
              resultDigest: `sha256:${resultDigest}`,
              resultRef: receipt.resultRef,
              receipt,
              replayed: false,
              cwd: '/root',
            },
          },
        };
      },
    };
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const backends = { hosted: backend };
    const executor = {
      matrix,
      backends,
      dispatch: (
        options: Omit<
          Parameters<typeof dispatchGrantedAction>[0],
          'matrix' | 'backends'
        >
      ) => {
        if (
          options.grantedAction.kind === 'agent' &&
          options.grantedAction.agent.role === 'teacher'
        ) {
          teacherActionIds.push(options.grantedAction.actionId);
          reservationSnapshots.push(
            fx.reservations
              .snapshot(fx.store.load(fx.plan.runId).workspaceInstanceId)
              .map((entry) => entry.actionId)
          );
          return Promise.resolve({
            kind: 'authority-unavailable' as const,
            selection: {
              kind: 'authority-unavailable' as const,
              reason: 'hosted-tier-unavailable' as const,
              message: 'Teacher execution authority is temporarily unavailable.',
              requested: 'hosted' as const,
            },
          });
        }
        return dispatchGrantedAction({ ...options, matrix, backends });
      },
      dispatchContinuation: (
        options: Omit<
          Parameters<typeof dispatchGrantedContinuation>[0],
          'matrix' | 'backends'
        >
      ) => dispatchGrantedContinuation({ ...options, matrix, backends }),
    };
    const runRef = {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: fx.plan.runId,
    };
    const initial = await executor.dispatch({
      runRef,
      grantedAction: sourceAction,
      record: fx.store.load(fx.plan.runId),
      expectedRecordVersion: fx.store.load(fx.plan.runId).recordVersion,
      workspaceRevision: sourceAction.expectedBeforeWorkspace,
      requestedBackend: 'hosted',
      turnInput: JSON.stringify(sourceAction.agent.input),
    });
    const driven = await createProductionConsultationDriver({
      runRef,
      runtime: {
        plan: fx.plan,
        facade,
        store: fx.store,
        initialRecord: fx.initialRecord,
        evidenceStore: fx.evidenceStore,
        hostEvidenceWriter: fx.writer,
      },
      executor,
      producerFor: (action) => createTestTrustedCompletionProducer(action),
    }).driveInitial(sourceAction, initial);

    expect(teacherActionIds).toHaveLength(2);
    expect(new Set(teacherActionIds).size).toBe(2);
    expect(driven.dispatches).toHaveLength(4);
    expect(continuationInput).toMatchObject({
      contract: 'teacher-consultation/unavailable/1',
      reason: 'teacher-attempt-limit-exhausted',
      teacherAttempts: { used: 2, max: 2 },
    });
    expect(reservationSnapshots).toHaveLength(3);
    expect(reservationSnapshots[0]).toContain(teacherActionIds[0]);
    expect(reservationSnapshots[1]).not.toContain(teacherActionIds[0]);
    expect(reservationSnapshots[1]).toContain(teacherActionIds[1]);
    expect(reservationSnapshots[2]).not.toContain(teacherActionIds[1]);
    expect(reservationSnapshots[2]).toEqual([sourceAction.actionId]);
    expect(driven.finalReceipt?.view.status).toBe('completed');
    expect(
      fx.reservations.snapshot(
        fx.store.load(fx.plan.runId).workspaceInstanceId
      )
    ).toEqual([]);
  });

  it.each([
    ['uncertain with a durable hosted receipt', 'uncertain'] as const,
    ['receiptless daemon-death execution loss', 'execution-lost'] as const,
  ])(
    'settles %s, consumes bounded Teacher attempts, and resumes the source',
    async (_label, failureKind) => {
      const fx = fixture();
      const { sourceAction, consulted } = await startAndConsult(fx);
      if (sourceAction.kind !== 'agent') throw new Error('expected source agent');
      const teacherActionIds: string[] = [];

      const backend: HostedBackendSeam = {
        kind: 'hosted',
        inspectSession(sessionId) {
          return sessionId === SOURCE_SESSION_ID
            ? {
                sandbox: sourceAction.agent.sandbox,
                authority: {
                  invocationId: sourceAction.invocationId,
                  role: sourceAction.agent.role,
                  workspaceInstanceId: fx.store.load(fx.plan.runId)
                    .workspaceInstanceId,
                  backend: 'hosted',
                  handoffTokensUsed: 0,
                  reuseRoundsServed: 0,
                },
              }
            : undefined;
        },
        async executeTurn(input) {
          if (input.action.kind !== 'agent') {
            throw new Error('expected agent turn');
          }
          if (input.action.agent.role === 'teacher') {
            teacherActionIds.push(input.action.actionId);
            if (failureKind === 'execution-lost') {
              return { daemonAlive: false, turn: undefined };
            }
            const requestId = deriveFreshStepRequestId(
              input.action.runId as never,
              input.action.actionId as never,
              input.action.attemptId as never
            );
            const digit = `${teacherActionIds.length + 2}`;
            const stableSessionId = `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
            const receipt: HostedTurnReceipt = {
              ...hostedReceipt(input.action, requestId, 'ambiguous'),
              stableSessionId,
            };
            return {
              daemonAlive: true,
              turn: {
                ok: false,
                code: 'teacher-host-uncertain',
                ambiguous: true,
                requestUnfinished: false,
                hostedTurn: {
                  stableSessionId,
                  requestId,
                  requestState: 'ambiguous',
                  receipt,
                  replayed: false,
                  cwd: '/root',
                },
              },
            };
          }

          if (input.sessionId !== SOURCE_SESSION_ID || input.requestId === undefined) {
            throw new Error('expected exact source continuation');
          }
          const result = JSON.stringify({
            status: 'DONE',
            summary: `continued after ${failureKind}`,
          });
          const receipt = hostedReceipt(
            input.action,
            input.requestId,
            'settled',
            failureKind === 'uncertain' ? 'e' : 'f'
          );
          return {
            daemonAlive: true,
            turn: {
              ok: true,
              status: 'succeeded',
              hostedTurn: {
                stableSessionId: SOURCE_SESSION_ID,
                requestId: input.requestId,
                requestState: 'settled',
                result,
                resultDigest: `sha256:${receipt.resultDigest}`,
                resultRef: receipt.resultRef,
                receipt: { ...receipt, result },
                replayed: false,
                cwd: '/root',
              },
            },
          };
        },
      };
      const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
      const backends = { hosted: backend };
      const executor = {
        matrix,
        backends,
        dispatch: (
          options: Omit<
            Parameters<typeof dispatchGrantedAction>[0],
            'matrix' | 'backends'
          >
        ) => dispatchGrantedAction({ ...options, matrix, backends }),
        dispatchContinuation: (
          options: Omit<
            Parameters<typeof dispatchGrantedContinuation>[0],
            'matrix' | 'backends'
          >
        ) => dispatchGrantedContinuation({ ...options, matrix, backends }),
      };
      const finalReceipt = await createProductionConsultationDriver({
        runRef: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: fx.plan.runId,
        },
        runtime: {
          plan: fx.plan,
          facade: fx.makeRuntime(),
          store: fx.store,
          initialRecord: fx.initialRecord,
          evidenceStore: fx.evidenceStore,
          hostEvidenceWriter: fx.writer,
        },
        executor,
        producerFor: (action) => createTestTrustedCompletionProducer(action),
      }).driveReceipt(consulted);

      expect(teacherActionIds).toHaveLength(2);
      const failures = fx.store
        .load(fx.plan.runId)
        .transitions.filter(
          (transition) => transition.kind === 'ConsultationTeacherAttemptFailed'
        );
      expect(failures).toHaveLength(2);
      expect(finalReceipt.view.status).toBe('completed');
      expect(
        fx.reservations.snapshot(
          fx.store.load(fx.plan.runId).workspaceInstanceId
        )
      ).toEqual([]);
    }
  );

  it('drives CONSULT -> direct Teacher -> exact source continuation -> DONE without a LEAD Action', async () => {
    const durableReceipts = new Set<string>();
    const fx = fixture({
      verifyHostedTurnReceipt: (candidate) =>
        durableReceipts.has(JSON.stringify(candidate)),
    });
    const { runtime, sourceAction, submission, consulted } =
      await startAndConsult(fx);
    expect(consulted.actions).toHaveLength(1);
    const teacherAction = consulted.actions[0]!;
    expect(teacherAction.kind).toBe('agent');
    if (teacherAction.kind !== 'agent') throw new Error('expected Teacher');
    expect(teacherAction.agent.role).toBe('teacher');
    expect(teacherAction.agent.sandbox).toBe('read-only');
    expect(teacherAction.workspace.access).toBe('read');
    expect(teacherAction.effects).toEqual([]);
    expect(
      Object.values(fx.store.load(fx.plan.runId).actions).some(
        (entry) =>
          entry.action.kind === 'agent' && entry.action.agent.role === 'lead'
      )
    ).toBe(false);
    expect(fx.reservations.snapshot('workspace-instance:' + '3'.repeat(64)))
      .toHaveLength(2);

    fx.writer.publishConsultation(submission.consultation, submission.uploads);
    const duplicateRequest = await runtime.consult(submission.consultation, {
      deliveryMode: 'grant',
    });
    expect(duplicateRequest.disposition).toBe('advanced');
    expect(duplicateRequest.actions).toEqual([teacherAction]);

    const consultationId = Object.keys(
      fx.store.load(fx.plan.runId).consultations ?? {}
    )[0]!;
    const advice = {
      contract: 'teacher-consultation/advice/1' as const,
      consultationId,
      teacherAttempt: 1,
      decision: 'correction' as const,
      rationale: 'Keep delivery in the canonical consultation state.',
      steps: ['Commit advice before granting continuation.'],
      cautions: ['Never replace the source Session.'],
      evidenceNotes: ['Reducer and SessionHost identities agree.'],
    };
    const teacherSubmission = createTestTrustedCompletionProducer(
      teacherAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: teacherAction,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: advice,
      },
      evidenceContent: Buffer.from(JSON.stringify(advice), 'utf8'),
    });
    fx.writer.publishCompletion(
      teacherSubmission.completion,
      teacherSubmission.uploads
    );
    const advised = await runtime.complete(teacherSubmission.completion, {
      deliveryMode: 'grant',
    });
    expect(advised.continuationGrants).toHaveLength(1);
    const grant = advised.continuationGrants![0]!;
    const receiptAuthority = createCanonicalReceiptContinuationAuthority(
      fx.store.load(fx.plan.runId)
    );
    expect(
      decodeChangeRunReceipt(advised, receiptAuthority).continuationGrants
    ).toEqual([grant]);
    if (grant.input.contract !== 'teacher-consultation/resume/1') {
      throw new Error('fixture requires an advice continuation');
    }
    const oversizedAdvice = {
      ...grant.input.advice,
      // The frozen binding allows 8 steps while the server-wide ceiling is 64.
      steps: Array.from({ length: 9 }, (_, index) => `step-${index + 1}`),
    };
    const oversizedInput = {
      ...grant.input,
      adviceDigest: digestTeacherConsultationAdvice(oversizedAdvice),
      advice: oversizedAdvice,
    };
    const oversizedInputDigest = digestContinuationInput(oversizedInput);
    const oversizedRequestId = deriveContinuationRequestId(
      grant.consultationId,
      oversizedInputDigest
    );
    const overFrozenLimits = structuredClone(advised) as {
      continuationGrants: Array<Record<string, unknown>>;
      view: { sections: Array<Record<string, unknown>> };
    };
    overFrozenLimits.continuationGrants[0] = {
      ...grant,
      requestId: oversizedRequestId,
      inputDigest: oversizedInputDigest,
      input: oversizedInput,
    };
    const overLimitConsultation = overFrozenLimits.view.sections.find(
      (section) => section.kind === 'consultation'
    ) as {
      entries: Array<{
        limits: Record<string, number>;
        continuation?: Record<string, unknown>;
      }>;
    };
    overLimitConsultation.entries[0]!.limits = {
      ...overLimitConsultation.entries[0]!.limits,
      // The envelope attempts to widen the same view limit used by the old
      // decoder. Canonical Record authority must still enforce eight steps.
      maxAdviceSteps: 9,
    };
    overLimitConsultation.entries[0]!.continuation = {
      requestId: oversizedRequestId,
      inputDigest: oversizedInputDigest,
      state: 'granted',
    };
    expect(() =>
      decodeChangeRunReceipt(overFrozenLimits, receiptAuthority)
    ).toThrow(/canonical frozen-limit authority|view limits/i);
    expect(() =>
      decodeChangeRunReceipt({
        ...advised,
        continuationGrants: [
          {
            ...grant,
            continuationText: 'caller-injected continuation text',
          },
        ],
      }, receiptAuthority)
    ).toThrow();
    expect(grant.stableSessionId).toBe(SOURCE_SESSION_ID);
    expect(grant.sourceActionId).toBe(sourceAction.actionId);
    expect(grant.input).toMatchObject({
      contract: 'teacher-consultation/resume/1',
      advice: { decision: 'correction' },
    });
    expect(fx.reservations.snapshot('workspace-instance:' + '3'.repeat(64)))
      .toHaveLength(1);

    const restarted = fx.makeRuntime();
    const replayedGrant = await restarted.resume(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        runId: fx.plan.runId,
      },
      { deliveryMode: 'grant' }
    );
    expect(replayedGrant.continuationGrants).toEqual([grant]);
    const replayedTeacher = await restarted.complete(
      teacherSubmission.completion,
      { deliveryMode: 'grant' }
    );
    expect(replayedTeacher.disposition).toBe('reused');

    const calls: Array<{ sessionId?: string; requestId?: string; input: string }> = [];
    const hosted: HostedBackendSeam = {
      kind: 'hosted',
      inspectSession(sessionId) {
        return sessionId === SOURCE_SESSION_ID && sourceAction.kind === 'agent'
          ? {
              sandbox: sourceAction.agent.sandbox,
              authority: {
                invocationId: sourceAction.invocationId,
                role: sourceAction.agent.role,
                workspaceInstanceId: fx.store.load(fx.plan.runId).workspaceInstanceId,
                backend: 'hosted',
                handoffTokensUsed: 0,
                reuseRoundsServed: 0,
              },
            }
          : undefined;
      },
      async executeTurn(input) {
        calls.push({
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          input: input.input,
        });
        return {
          daemonAlive: true,
          turn: {
            ok: true,
            status: 'succeeded',
            hostedTurn: {
              stableSessionId: input.sessionId!,
              requestId: input.requestId!,
              result: '{"status":"DONE","summary":"implemented"}',
              resultDigest: digest('d'),
              replayed: false,
              cwd: '/root',
            },
          },
        };
      },
    };
    const continuation = await dispatchGrantedContinuation({
      grant,
      record: fx.store.load(fx.plan.runId),
      matrix: buildExecutionCapabilityMatrix({ hostPlatform: 'linux' }),
      backends: { hosted },
    });
    expect(continuation.kind).toBe('executed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toBe(SOURCE_SESSION_ID);
    expect(calls[0]?.requestId).toBe(grant.requestId);
    expect(JSON.parse(calls[0]!.input)).toEqual(grant.input);

    const canonicalReceipt = hostedReceipt(
      sourceAction,
      grant.requestId,
      'settled',
      'd'
    );
    const beforeFabricatedSettlement = digestCanonicalRunRecord(
      fx.store.load(fx.plan.runId)
    );
    expect(() =>
      restarted.settleConsultationContinuation(
        {
          format: 'teacher-consultation/continuation-settlement/1',
          runId: fx.plan.runId,
          sourceActionId: sourceAction.actionId as never,
          consultationId: grant.consultationId,
          requestId: grant.requestId,
          expectedRecordVersion: grant.expectedRecordVersion,
          outcome: 'settled',
          receipt: canonicalReceipt,
        },
        { deliveryMode: 'grant' }
      )
    ).toThrow(/durable canonical Session/i);
    expect(digestCanonicalRunRecord(fx.store.load(fx.plan.runId))).toBe(
      beforeFabricatedSettlement
    );
    durableReceipts.add(JSON.stringify(canonicalReceipt));
    const settled = await restarted.settleConsultationContinuation(
      {
        format: 'teacher-consultation/continuation-settlement/1',
        runId: fx.plan.runId,
        sourceActionId: sourceAction.actionId as never,
        consultationId: grant.consultationId,
        requestId: grant.requestId,
        expectedRecordVersion: grant.expectedRecordVersion,
        outcome: 'settled',
        receipt: canonicalReceipt,
      },
      { deliveryMode: 'grant' }
    );
    expect(settled.disposition).toBe('advanced');
    const duplicateSettlement = await restarted.settleConsultationContinuation(
      {
        format: 'teacher-consultation/continuation-settlement/1',
        runId: fx.plan.runId,
        sourceActionId: sourceAction.actionId as never,
        consultationId: grant.consultationId,
        requestId: grant.requestId,
        expectedRecordVersion: grant.expectedRecordVersion,
        outcome: 'settled',
        receipt: hostedReceipt(sourceAction, grant.requestId, 'settled', 'd'),
      },
      { deliveryMode: 'grant' }
    );
    expect(duplicateSettlement.disposition).toBe('idempotent');
    expect(() =>
      restarted.settleConsultationContinuation(
        {
          format: 'teacher-consultation/continuation-settlement/1',
          runId: fx.plan.runId,
          sourceActionId: sourceAction.actionId as never,
          consultationId: grant.consultationId,
          requestId: grant.requestId,
          expectedRecordVersion: (grant.expectedRecordVersion + 1) as never,
          outcome: 'settled',
          receipt: hostedReceipt(sourceAction, grant.requestId, 'settled', 'd'),
        },
        { deliveryMode: 'grant' }
      )
    ).toThrow(/terminal settlement replay does not exactly match/i);
    expect(() =>
      restarted.settleConsultationContinuation(
        {
          format: 'teacher-consultation/continuation-settlement/1',
          runId: fx.plan.runId,
          sourceActionId: sourceAction.actionId as never,
          consultationId: grant.consultationId,
          requestId: grant.requestId,
          expectedRecordVersion: grant.expectedRecordVersion,
          outcome: 'settled',
          receipt: hostedReceipt(sourceAction, grant.requestId, 'settled', 'd'),
          unexpected: true,
        } as never,
        { deliveryMode: 'grant' }
      )
    ).toThrow();

    const finalResult = { status: 'DONE', summary: 'implemented' };
    const sourceCompletion = createTestTrustedCompletionProducer(
      sourceAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: sourceAction,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: finalResult,
      },
      evidenceContent: Buffer.from(JSON.stringify(finalResult), 'utf8'),
    });
    fx.writer.publishCompletion(
      sourceCompletion.completion,
      sourceCompletion.uploads
    );
    const finished = await restarted.complete(sourceCompletion.completion, {
      deliveryMode: 'grant',
    });
    expect(finished.disposition).toBe('terminal');
    expect(finished.view.status).toBe('completed');
    expect(fx.reservations.snapshot('workspace-instance:' + '3'.repeat(64)))
      .toEqual([]);
    const consultationSection = finished.view.sections.find(
      (section) => section.kind === 'consultation'
    );
    expect(consultationSection).toMatchObject({
      kind: 'consultation',
      version: 1,
      entries: [
        {
          consultationId,
          state: 'closed',
          teacher: { adviceDecision: 'correction' },
          continuation: { state: 'settled' },
        },
      ],
    });
  });

  it('rejects signed-field tampering and crossed Teacher advice before Record mutation', async () => {
    const fx = fixture();
    const { runtime, submission, consulted } = await startAndConsult(fx);
    const teacherAction = consulted.actions[0]!;
    const afterConsult = digestCanonicalRunRecord(fx.store.load(fx.plan.runId));
    expect(() =>
      fx.writer.publishConsultation(
        {
          ...submission.consultation,
          question: {
            ...submission.consultation.question,
            question: 'Caller-substituted question.',
          },
        },
        submission.uploads
      )
    ).toThrow(/canonical consultation claim/i);
    expect(digestCanonicalRunRecord(fx.store.load(fx.plan.runId))).toBe(
      afterConsult
    );

    const mutationObservation = createTestTrustedCompletionProducer(
      teacherAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: teacherAction,
      completion: {
        kind: 'effect-observation',
        effectId: `effect:${'e'.repeat(64)}` as never,
        status: 'succeeded',
        observation: { workspace: 'mutated' },
      },
      evidenceContent: Buffer.from('{"workspace":"mutated"}', 'utf8'),
    });
    fx.writer.publishCompletion(
      mutationObservation.completion,
      mutationObservation.uploads
    );
    await expect(async () => {
      await runtime.complete(mutationObservation.completion, {
        deliveryMode: 'grant',
      });
    }).rejects.toThrow(/effect|completion conflicts/i);
    expect(digestCanonicalRunRecord(fx.store.load(fx.plan.runId))).toBe(
      afterConsult
    );

    const crossedAdvice = {
      contract: 'teacher-consultation/advice/1' as const,
      consultationId: `consultation:${'f'.repeat(64)}`,
      teacherAttempt: 1,
      decision: 'plan' as const,
      rationale: 'This answer belongs elsewhere.',
      steps: [],
      cautions: [],
      evidenceNotes: [],
    };
    const crossed = createTestTrustedCompletionProducer(
      teacherAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: teacherAction,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: crossedAdvice,
      },
      evidenceContent: Buffer.from(JSON.stringify(crossedAdvice), 'utf8'),
    });
    fx.writer.publishCompletion(crossed.completion, crossed.uploads);
    await expect(async () => {
      await runtime.complete(crossed.completion, { deliveryMode: 'grant' });
    }).rejects.toThrow(/correlation/i);
    expect(digestCanonicalRunRecord(fx.store.load(fx.plan.runId))).toBe(
      afterConsult
    );
  });

  it('persists an ambiguous continuation across restart without replaying the grant', async () => {
    const fx = fixture();
    const { runtime, consulted } = await startAndConsult(fx);
    const teacherAction = consulted.actions[0]!;
    const consultationId = Object.keys(
      fx.store.load(fx.plan.runId).consultations ?? {}
    )[0]!;
    const advice = {
      contract: 'teacher-consultation/advice/1' as const,
      consultationId,
      teacherAttempt: 1,
      decision: 'stop' as const,
      rationale: 'Pause because the continuation outcome cannot be proven.',
      steps: [],
      cautions: ['Do not resend ambiguous input.'],
      evidenceNotes: [],
    };
    const completed = createTestTrustedCompletionProducer(
      teacherAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: teacherAction,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: advice,
      },
      evidenceContent: Buffer.from(JSON.stringify(advice), 'utf8'),
    });
    fx.writer.publishCompletion(completed.completion, completed.uploads);
    const advised = await runtime.complete(completed.completion, {
      deliveryMode: 'grant',
    });
    const grant = advised.continuationGrants![0]!;
    await runtime.settleConsultationContinuation(
      {
        format: 'teacher-consultation/continuation-settlement/1',
        runId: fx.plan.runId,
        sourceActionId: grant.sourceActionId,
        consultationId: grant.consultationId,
        requestId: grant.requestId,
        expectedRecordVersion: grant.expectedRecordVersion,
        outcome: 'ambiguous',
        receipt: hostedReceipt(
          fx.store.load(fx.plan.runId).actions[grant.sourceActionId]!.action,
          grant.requestId,
          'ambiguous'
        ),
        detail: 'The continuation was sent, but no terminal acknowledgement exists.',
      },
      { deliveryMode: 'grant' }
    );
    const restarted = fx.makeRuntime();
    const resumed = await restarted.resume(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        runId: fx.plan.runId,
      },
      { deliveryMode: 'grant' }
    );
    expect(resumed.continuationGrants).toBeUndefined();
    expect(resumed.view.sections.find((section) => section.kind === 'consultation'))
      .toMatchObject({
        entries: [
          {
            state: 'continuation-outcome-unknown',
            continuation: { state: 'ambiguous' },
            failure: { code: 'continuation-outcome-unknown' },
          },
        ],
      });
  });

  it('cancellation closes consultation state and releases source plus sponsored Teacher reservations', async () => {
    const fx = fixture();
    const { runtime } = await startAndConsult(fx);
    const record = fx.store.load(fx.plan.runId);
    expect(fx.reservations.snapshot(record.workspaceInstanceId)).toHaveLength(2);
    const cancelled = await runtime.control(
      {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: fx.plan.runId,
        },
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'cancel', reason: 'operator cancelled fixture' },
      },
      { deliveryMode: 'grant' }
    );
    expect(cancelled.view.status).toBe('cancelled');
    expect(fx.reservations.snapshot(record.workspaceInstanceId)).toEqual([]);
    expect(
      cancelled.view.sections.find((section) => section.kind === 'consultation')
    ).toMatchObject({
      entries: [
        {
          state: 'closed',
          failure: { code: 'source-terminal' },
        },
      ],
    });
  });

  it('bounds Teacher retries, releases each failed sponsored read, and resumes with typed unavailability', async () => {
    const fx = fixture();
    const { runtime, consulted } = await startAndConsult(fx);
    const firstTeacher = consulted.actions[0]!;
    const failTeacher = async (teacherAction: RunAction, attempt: number) => {
      const failure = { code: `teacher-failure-${attempt}` };
      const submission = createTestTrustedCompletionProducer(
        teacherAction
      ).attestCompletion({
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        record: fx.store.load(fx.plan.runId),
        action: teacherAction,
        completion: {
          kind: 'domain-action-result',
          status: 'failed',
          result: failure,
        },
        evidenceContent: Buffer.from(JSON.stringify(failure), 'utf8'),
      });
      fx.writer.publishCompletion(submission.completion, submission.uploads);
      return runtime.complete(submission.completion, { deliveryMode: 'grant' });
    };
    const firstFailure = await failTeacher(firstTeacher, 1);
    expect(firstFailure.actions).toHaveLength(1);
    const secondTeacher = firstFailure.actions[0]!;
    expect(secondTeacher.actionId).not.toBe(firstTeacher.actionId);
    expect(fx.reservations.snapshot('workspace-instance:' + '3'.repeat(64)))
      .toHaveLength(2);

    const secondFailure = await failTeacher(secondTeacher, 2);
    expect(secondFailure.actions).toEqual([]);
    expect(secondFailure.continuationGrants).toHaveLength(1);
    expect(secondFailure.continuationGrants![0]!.input).toMatchObject({
      contract: 'teacher-consultation/unavailable/1',
      reason: 'teacher-attempt-limit-exhausted',
      teacherAttempts: { used: 2, max: 2 },
    });
    expect(
      secondFailure.view.sections.find(
        (section) => section.kind === 'consultation'
      )
    ).toMatchObject({
      entries: [
        {
          state: 'continuation-granted',
          counters: {
            consultations: { used: 1, max: 2 },
            teacherAttempts: { used: 2, max: 2 },
          },
          failure: { code: 'teacher-attempt-limit-exhausted' },
        },
      ],
    });
    expect(fx.reservations.snapshot('workspace-instance:' + '3'.repeat(64)))
      .toHaveLength(1);
  });

  it('reopens a task-loop consultation from daemon-owned Session authority after restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-task-loop-consultation-reopen-'));
    const projectRoot = path.join(root, 'worktree');
    const storeRoot = path.join(root, 'runs');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', 'tracked.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: projectRoot, stdio: 'ignore' });

    try {
      const fx = fixture({ taskLoop: true, storeRoot });
      const { sourceAction, consulted } = await startAndConsult(fx, projectRoot);
      if (sourceAction.kind !== 'agent') throw new Error('expected task-loop source agent');
      const canonicalRoot = fs.realpathSync.native(projectRoot);
      const recordBeforeRestart = fx.store.load(fx.plan.runId);
      const sourceSession: SessionHostView = {
        sessionId: SOURCE_SESSION_ID,
        backend: sourceAction.agent.runtime,
        cwd: canonicalRoot,
        cwdDigest: digestSessionHostText(canonicalRoot),
        sandbox: sourceAction.agent.sandbox,
        authority: {
          invocationId: sourceAction.invocationId,
          role: sourceAction.agent.role,
          workspaceInstanceId: recordBeforeRestart.workspaceInstanceId,
          backend: 'hosted',
          handoffTokensUsed: 0,
          reuseRoundsServed: 0,
        },
        hostState: 'idle',
        state: 'idle',
        generation: 1,
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      };
      const daemonSourceHost = {
        inspect: (sessionId: string) =>
          sessionId === SOURCE_SESSION_ID ? sourceSession : undefined,
        list: () => [sourceSession],
      };

      const reopened = openStoredRuntimeContext({
        storeRoot,
        runId: fx.plan.runId,
        sourceSessionHost: daemonSourceHost,
      });
      const resumed = await reopened.facade.resume(
        {
          change: { projectRoot, changeId: 'fixture-change' },
          runId: fx.plan.runId,
        },
        { deliveryMode: 'grant' }
      );
      expect(resumed.actions).toEqual([]);
      expect(resumed.view.sections).toContainEqual(
        expect.objectContaining({ kind: 'task-loop' })
      );
      const recordAfterRestart = fx.store.load(fx.plan.runId);
      expect(recordAfterRestart.counters).toEqual(recordBeforeRestart.counters);
      expect(recordAfterRestart.transitions).toEqual(recordBeforeRestart.transitions);
      expect(recordAfterRestart.actions[consulted.actions[0]!.actionId]).toMatchObject({
        state: 'active',
      });
      const teacherAction = consulted.actions[0]!;
      const consultationId = Object.keys(recordAfterRestart.consultations ?? {})[0]!;
      const advice = {
        contract: 'teacher-consultation/advice/1' as const,
        consultationId,
        teacherAttempt: 1,
        decision: 'plan' as const,
        rationale: 'Continue only through the recovered source Session.',
        steps: ['Resume the paused source Session.'],
        cautions: [],
        evidenceNotes: [],
      };
      const teacherCompletion = createTestTrustedCompletionProducer(teacherAction).attestCompletion({
        change: { projectRoot, changeId: 'fixture-change' },
        record: recordAfterRestart,
        action: teacherAction,
        completion: {
          kind: 'domain-action-result',
          status: 'succeeded',
          result: advice,
        },
        evidenceContent: Buffer.from(JSON.stringify(advice), 'utf8'),
      });
      fx.writer.publishCompletion(teacherCompletion.completion, teacherCompletion.uploads);
      const advised = await reopened.facade.complete(teacherCompletion.completion, {
        deliveryMode: 'grant',
      });
      expect(advised.continuationGrants).toHaveLength(1);
      expect(
        fs.existsSync(path.join(
          canonicalRoot,
          'rasen',
          'changes',
          'fixture-change',
          'evidence',
          'task-loop-report.md'
        ))
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on missing or mismatched daemon Session authority before advice commitment, report, or Record mutation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-task-loop-authority-guard-'));
    const projectRoot = path.join(root, 'worktree');
    const storeRoot = path.join(root, 'runs');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', 'tracked.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: projectRoot, stdio: 'ignore' });

    try {
      const fx = fixture({ taskLoop: true, storeRoot });
      const { sourceAction } = await startAndConsult(fx, projectRoot);
      if (sourceAction.kind !== 'agent') throw new Error('expected task-loop source agent');
      const canonicalRoot = fs.realpathSync.native(projectRoot);
      const recordBeforeRestart = fx.store.load(fx.plan.runId);
      const digestBefore = digestCanonicalRunRecord(recordBeforeRestart);
      const reportPath = path.join(
        canonicalRoot,
        'rasen',
        'changes',
        'fixture-change',
        'evidence',
        'task-loop-report.md'
      );
      expect(fs.existsSync(reportPath)).toBe(false);

      // Missing authority: no daemon-owned SessionHost is supplied. A stored
      // reopen must fail closed instead of trusting any caller-derived cwd.
      // StoredRuntimeContextInput carries no cwd field, so request-supplied
      // workspace can never reach the trusted observer.
      const reopenedMissing = openStoredRuntimeContext({
        storeRoot,
        runId: fx.plan.runId,
      });
      let caughtMissing: unknown;
      try {
        await reopenedMissing.facade.resume(
          { change: { projectRoot, changeId: 'fixture-change' }, runId: fx.plan.runId },
          { deliveryMode: 'grant' }
        );
      } catch (error) {
        caughtMissing = error;
      }
      expect(caughtMissing).toBeInstanceOf(StoredRuntimeContextError);
      expect((caughtMissing as StoredRuntimeContextError).code).toBe(
        'task_loop_source_authority_unavailable'
      );
      expect(digestCanonicalRunRecord(fx.store.load(fx.plan.runId))).toBe(digestBefore);
      expect(fs.existsSync(reportPath)).toBe(false);

      // Mismatched authority: the daemon SessionHost returns a Session whose
      // recorded cwd digest disagrees with its own cwd (workspace drift).
      // Reopen must fail closed rather than let a caller repair the drift.
      const driftedSession: SessionHostView = {
        sessionId: SOURCE_SESSION_ID,
        backend: sourceAction.agent.runtime,
        cwd: canonicalRoot,
        cwdDigest: digestSessionHostText(path.join(canonicalRoot, 'drifted-cwd')),
        sandbox: sourceAction.agent.sandbox,
        authority: {
          invocationId: sourceAction.invocationId,
          role: sourceAction.agent.role,
          workspaceInstanceId: recordBeforeRestart.workspaceInstanceId,
          backend: 'hosted',
          handoffTokensUsed: 0,
          reuseRoundsServed: 0,
        },
        hostState: 'idle',
        state: 'idle',
        generation: 1,
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      };
      const driftedHost = {
        inspect: (sessionId: string) =>
          sessionId === SOURCE_SESSION_ID ? driftedSession : undefined,
        list: () => [driftedSession],
      };
      const reopenedDrifted = openStoredRuntimeContext({
        storeRoot,
        runId: fx.plan.runId,
        sourceSessionHost: driftedHost,
      });
      let caughtDrifted: unknown;
      try {
        await reopenedDrifted.facade.resume(
          { change: { projectRoot, changeId: 'fixture-change' }, runId: fx.plan.runId },
          { deliveryMode: 'grant' }
        );
      } catch (error) {
        caughtDrifted = error;
      }
      expect(caughtDrifted).toBeInstanceOf(StoredRuntimeContextError);
      expect((caughtDrifted as StoredRuntimeContextError).code).toBe(
        'task_loop_source_authority_mismatch'
      );
      expect(digestCanonicalRunRecord(fx.store.load(fx.plan.runId))).toBe(digestBefore);
      expect(fs.existsSync(reportPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps BoundedLoop progress and strategy accounting independent from consultation transitions', async () => {
    const fx = fixture({ boundedLoop: true });
    const { runtime, sourceAction, consulted } = await startAndConsult(fx);
    const lifecycle = (view: Awaited<ReturnType<typeof runtime.inspect>>) =>
      view.sections.find(
        (section) => section.kind === 'bounded-loop-lifecycle'
      );
    const consultation = (view: Awaited<ReturnType<typeof runtime.inspect>>) =>
      view.sections.find((section) => section.kind === 'consultation');
    const baseline = lifecycle(consulted.view);
    const accounting = (section: typeof baseline) => {
      if (section === undefined || section.kind !== 'bounded-loop-lifecycle') {
        throw new Error('missing bounded-loop lifecycle section');
      }
      return {
        iteration: section.iteration,
        limits: section.limits,
        progressFingerprint: section.progressFingerprint,
        stallStreak: section.stallStreak,
        blockerFingerprint: section.blockerFingerprint,
        blockedStreak: section.blockedStreak,
        strategy: section.strategy,
      };
    };
    expect(baseline).toMatchObject({
      iteration: 1,
      limits: {
        iterations: { used: 0, max: 3 },
        actions: { used: 1, max: 8 },
        budget: { used: 1, max: 8 },
      },
      stallStreak: 0,
      blockedStreak: 0,
      strategy: { attempts: 0, maxAttempts: 2 },
    });
    expect(consultation(consulted.view)).toMatchObject({
      entries: [
        {
          counters: {
            consultations: { used: 1, max: 2 },
            teacherAttempts: { used: 1, max: 2 },
          },
        },
      ],
    });

    const teacherAction = consulted.actions[0]!;
    const consultationId = Object.keys(
      fx.store.load(fx.plan.runId).consultations ?? {}
    )[0]!;
    const advice = {
      contract: 'teacher-consultation/advice/1' as const,
      consultationId,
      teacherAttempt: 1,
      decision: 'plan' as const,
      rationale: 'Continue the current loop attempt.',
      steps: ['Resume the exact source Session.'],
      cautions: [],
      evidenceNotes: [],
    };
    const teacherCompletion = createTestTrustedCompletionProducer(
      teacherAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: teacherAction,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: advice,
      },
      evidenceContent: Buffer.from(JSON.stringify(advice), 'utf8'),
    });
    fx.writer.publishCompletion(
      teacherCompletion.completion,
      teacherCompletion.uploads
    );
    const advised = await runtime.complete(teacherCompletion.completion, {
      deliveryMode: 'grant',
    });
    expect(accounting(lifecycle(advised.view))).toEqual(accounting(baseline));
    const grant = advised.continuationGrants![0]!;
    const settled = await runtime.settleConsultationContinuation(
      {
        format: 'teacher-consultation/continuation-settlement/1',
        runId: fx.plan.runId,
        sourceActionId: sourceAction.actionId as never,
        consultationId: grant.consultationId,
        requestId: grant.requestId,
        expectedRecordVersion: grant.expectedRecordVersion,
        outcome: 'settled',
        receipt: hostedReceipt(sourceAction, grant.requestId, 'settled', 'e'),
      },
      { deliveryMode: 'grant' }
    );
    expect(accounting(lifecycle(settled.view))).toEqual(accounting(baseline));
    expect(consultation(settled.view)).toMatchObject({
      entries: [
        {
          counters: {
            consultations: { used: 1, max: 2 },
            teacherAttempts: { used: 1, max: 2 },
          },
        },
      ],
    });

    const result = { outcome: 'done' };
    const sourceCompletion = createTestTrustedCompletionProducer(
      sourceAction
    ).attestCompletion({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      record: fx.store.load(fx.plan.runId),
      action: sourceAction,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result,
      },
      evidenceContent: Buffer.from(JSON.stringify(result), 'utf8'),
    });
    fx.writer.publishCompletion(
      sourceCompletion.completion,
      sourceCompletion.uploads
    );
    const finished = await runtime.complete(sourceCompletion.completion, {
      deliveryMode: 'grant',
    });
    expect(finished.view.status).toBe('completed');
  });
});

class HttpConsultationTransport implements AgentSessionTransport {
  readonly rootPid = 5252;
  readonly closed: Promise<unknown>;
  readonly inputs: BackendTurn[] = [];
  runtimeRef!: AgentSessionTransport['runtimeRef'];

  constructor(
    readonly backendSessionId: string,
    private readonly onTeacherInvocation?: (teacherAttempt: number) => void,
    private readonly terminateOverride?: (reason: string) => Promise<BackendTermination>,
    closed?: Promise<unknown>
  ) {
    this.closed = closed ?? new Promise<void>(() => undefined);
  }

  send(turn: BackendTurn) {
    this.inputs.push(turn);
    const backendSessionId = this.backendSessionId;
    const parsed = JSON.parse(turn.input) as {
      contract?: string;
      consultationId?: string;
      teacherAttempt?: number;
      teacherConsultation?: {
        contract?: string;
        consultationId?: string;
        teacherAttempt?: number;
      };
    };
    const invocation = parsed.teacherConsultation;
    if (invocation?.contract === 'teacher-consultation/invocation/1') {
      this.onTeacherInvocation?.(invocation.teacherAttempt ?? 0);
    }
    const content =
      invocation?.contract === 'teacher-consultation/invocation/1'
        ? JSON.stringify({
            contract: 'teacher-consultation/advice/1',
            consultationId: invocation.consultationId,
            teacherAttempt: invocation.teacherAttempt,
            decision: 'plan',
            rationale: 'Continue through the exact paused source Session.',
            steps: ['Apply the bounded correction and resume the same Session.'],
            cautions: ['Do not route through LEAD.'],
            evidenceNotes: [],
          })
        : parsed.contract === 'teacher-consultation/resume/1' ||
            parsed.contract === 'teacher-consultation/unavailable/1'
          ? JSON.stringify({ status: 'DONE', summary: 'continued after consultation' })
          : JSON.stringify({
              status: 'CONSULT',
              problemSummary: 'The source needs one bounded architectural decision.',
              question: 'Which canonical continuation should receive the advice?',
              attemptedApproaches: ['Inspected the frozen Action and Session receipt.'],
              constraints: ['Preserve the exact source Session.'],
              evidencePointers: ['src/core/frozen-action-executor/consultation-driver.ts'],
            });
    const events = (async function* (): AsyncGenerator<BackendEvent> {
      yield { type: 'init', sessionId: backendSessionId };
      yield { type: 'result', sessionId: backendSessionId, content };
    })();
    return Object.assign(events, { accepted: Promise.resolve() });
  }

  async terminate(reason: string) {
    if (this.terminateOverride !== undefined) {
      return this.terminateOverride(reason);
    }
    return { closed: true, cancelledBeforeWork: false };
  }
}

class HttpConsultationBackend implements AgentSessionBackend {
  readonly id = 'claude';
  readonly transports: HttpConsultationTransport[] = [];

  constructor(
    private readonly onTeacherInvocation?: (teacherAttempt: number) => void
  ) {}

  async prepare() {
    const transport = new HttpConsultationTransport(
      `http-consultation-${this.transports.length + 1}`,
      this.onTeacherInvocation
    );
    this.transports.push(transport);
    return prepareTestSessionTransport(transport);
  }
}

class ExactHttpConsultationBackend implements AgentSessionBackend {
  readonly id = 'claude';
  readonly transports: HttpConsultationTransport[] = [];

  constructor(
    private readonly processScope: ProcessScope,
    private readonly onTeacherInvocation?: (teacherAttempt: number) => void
  ) {}

  async prepare(input: BackendOpenInput) {
    const prepared = await this.processScope.prepare({
      command: process.execPath,
      args: [],
      cwd: input.cwd,
      env: {},
      signal: input.signal,
      ...(input.onExactAuthorityPhase === undefined
        ? {}
        : { onExactAuthorityPhase: input.onExactAuthorityPhase }),
    });
    return {
      runtimeRef: prepared.ref,
      activate: async () => {
        const live = await prepared.activate();
        const transport = new HttpConsultationTransport(
          `http-exact-teacher-${this.transports.length + 1}`,
          this.onTeacherInvocation,
          async (reason) => {
            const receipt = await this.processScope.terminate(live.ref, {
              reason,
              graceMs: 0,
            });
            return {
              closed:
                receipt.state === 'closed' &&
                receipt.exactScopeEmptyReceipt !== undefined,
              cancelledBeforeWork: false,
              ...(receipt.exactScopeEmptyReceipt === undefined
                ? {}
                : { exactScopeEmptyReceipt: receipt.exactScopeEmptyReceipt }),
            };
          },
          live.closed
        );
        transport.runtimeRef = live.ref;
        this.transports.push(transport);
        return transport;
      },
      abort: (reason: string) => prepared.abort(reason),
    };
  }
}

function createHttpExactTeacherLane(
  root: string,
  onTeacherInvocation?: (teacherAttempt: number) => void,
  authorityFixture = createDeterministicProcessAuthorityProviderFixture()
) {
  const provider = authorityFixture;
  const registry = createTestProcessAuthorityProviderRegistry([provider.provider]);
  const coordinator = createProcessAuthorityCoordinator({ registry });
  const selection = Object.freeze({
    providerId: provider.descriptor.providerId,
    capabilityId: provider.descriptor.capabilityId,
    protocolVersion: provider.descriptor.protocolVersion,
  });
  const processScope = createProviderBackedProcessScope({
    coordinator,
    selection,
    publishAuthority: provider.publisher,
    openRuntime: () => ({
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      rootExited: new Promise(() => undefined),
      exactScopeEmpty: new Promise(() => undefined),
    }),
  });
  const policy = createExactTeacherAuthorityPolicyForTesting({
    hostPlatform: 'linux',
    lane: Object.freeze({ selection, registry, coordinator, processScope }),
  });
  const sessionRegistry = createSessionHostRegistry({
    stateDir: path.join(root, 'exact-teacher-sessions'),
  });
  const committer = createExactTeacherAttemptPersistence({
    journal: createExactTeacherAttemptJournal({
      root: path.join(root, 'exact-teacher-attempts'),
    }),
    sessionRegistry,
  });
  const backend = new ExactHttpConsultationBackend(
    processScope,
    onTeacherInvocation
  );
  const host = createSessionHost({
    registry: sessionRegistry,
    backends: [backend],
    processScope,
    exactRetirementAuthority: 'coordinator-authenticated',
    exactTeacherAttemptCommitter: committer,
  });
  return Object.freeze({
    authorityFixture: provider,
    backend,
    committer,
    host,
    policy,
    selection,
    sessionRegistry,
  });
}

function postJson(
  port: number,
  token: string,
  route: string,
  body: unknown,
  onFlushed?: () => void
): Promise<{ status: number; body: string }> {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: route,
        agent: false,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': String(bytes.byteLength),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    request.on('error', reject);
    if (onFlushed === undefined) request.end(bytes);
    else request.end(bytes, onFlushed);
  });
}

describe('production management server consultation authority', () => {
  it('drives CONSULT -> Teacher -> exact continuation over real HTTP without a resolver override', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-consultation-http-'));
    const projectRoot = path.join(root, 'worktree');
    const storeRoot = path.join(root, 'runs');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', 'tracked.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const fx = fixture({ storeRoot });
    const runtime = fx.makeRuntime();
    const started = await runtime.start(
      {
        change: { projectRoot, changeId: 'fixture-change' },
        pipeline: fx.plan.pipeline,
        launchRequestId: branded(`launch:${'1'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const sourceAction = started.actions[0]!;
    const descriptors = fx.profile.capabilities.map((binding) =>
      trustedDescriptor({
        id: binding.adapter.id,
        version: binding.adapter.version,
        contentDigest: binding.adapter.contentDigest as Digest,
      })
    );
    provisionTrustedExecutionAdapterCatalog(root, descriptors);
    provisionTestTrustedExecutionAdapterCredentials(root, descriptors);

    const backend = new HttpConsultationBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir: path.join(root, 'sessions') }),
      backends: [backend],
    });
    const exactTeacher = createHttpExactTeacherLane(root);
    const token = 'consultation-http-token';
    const server = await startManagementServer({
      hostStateRoot: root,
      context: {
        token,
        launchProjectRoot: projectRoot,
        launchProjectRef: {
          projectId: 'consultation-http-project',
          name: 'consultation-http-project',
          root: projectRoot,
        },
        version: '0.2.0-test',
        uiAssetsDir: null,
      },
      // Deterministic backend only. The signer resolver is intentionally NOT
      // injected: startManagementServer must construct the production one.
      sessions: {
        sessionHostOverride: host,
        exactTeacherSessionHostOverride: exactTeacher.host,
        exactTeacherAttemptCommitterOverride: exactTeacher.committer,
        exactTeacherAuthorityPolicy: exactTeacher.policy,
      },
    });
    try {
      const head = fx.store.load(fx.plan.runId);
      const response = await postJson(
        server.port,
        token,
        '/api/v1/frozen-action-executor/dispatch',
        {
          runRef: {
            change: { projectRoot, changeId: 'fixture-change' },
            runId: fx.plan.runId,
          },
          grantedAction: sourceAction,
          expectedRecordVersion: head.recordVersion,
          workspaceRevision: sourceAction.expectedBeforeWorkspace,
          requestedBackend: 'hosted',
          turnInput: 'caller text is not the consultation authority',
          hostedSeam: {
            cwd: projectRoot,
            backend: backend.id,
            limits: {
              timeoutMs: 5_000,
              maxInputBytes: 64 * 1024,
              maxOutputBytes: 64 * 1024,
            },
          },
        }
      );
      expect(response.status, response.body).toBe(200);
      const settled = fx.store.load(fx.plan.runId);
      const consultation = Object.values(settled.consultations ?? {})[0]!;
      expect(consultation).toMatchObject({
        source: { actionId: sourceAction.actionId },
        teacher: { advice: { decision: 'plan' } },
        continuation: { state: 'settled' },
      });
      expect(settled.actions[sourceAction.actionId]).toMatchObject({
        state: 'closed',
        result: { status: 'succeeded' },
      });
      expect(backend.transports).toHaveLength(1);
      expect(backend.transports[0]!.inputs).toHaveLength(2);
      expect(exactTeacher.backend.transports).toHaveLength(1);
      expect(exactTeacher.backend.transports[0]!.inputs).toHaveLength(1);
    } finally {
      await server.stopServer();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      phase: 'request-sent',
      firstCommittedPhase: 'result-quarantined',
      replayCount: 3,
    },
    {
      phase: 'result-quarantined',
      firstCommittedPhase: 'hosted-receipt-verified',
      replayCount: 2,
    },
    {
      phase: 'hosted-receipt-verified',
      firstCommittedPhase: 'retirement-pending',
      replayCount: 1,
    },
    {
      phase: 'retirement-pending',
      firstCommittedPhase: 'exact-scope-empty',
      replayCount: 1,
    },
    {
      phase: 'exact-scope-empty',
      firstCommittedPhase: 'final-observation-stable',
      replayCount: 1,
    },
    {
      phase: 'final-observation-stable',
      firstCommittedPhase: 'advice-validated',
      replayCount: 1,
    },
    {
      phase: 'advice-validated',
      firstCommittedPhase: 'canonical-settled',
      replayCount: 1,
    },
  ] as const)(
    'replaces the production daemon at durable $phase without reactivation or duplicate work',
    async ({ phase, firstCommittedPhase, replayCount }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `rasen-consultation-replace-${phase}-`));
      const projectRoot = path.join(root, 'worktree');
      const storeRoot = path.join(root, 'runs');
      try {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
        execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        execFileSync('git', ['add', 'tracked.txt'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        execFileSync('git', ['commit', '-m', 'fixture'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });

        const fx = fixture({ storeRoot });
        const { sourceAction, consulted } = await startAndConsult(fx);
        if (sourceAction.kind !== 'agent') throw new Error('expected source agent');
        const teacherAction = consulted.actions[0]!;
        if (teacherAction.kind !== 'agent') throw new Error('expected Teacher agent');
        const active = fx.store.load(fx.plan.runId);
        const consultation = Object.values(active.consultations ?? {})[0]!;
        const original = createHttpExactTeacherLane(root);
        expect((await original.host.reconcileOnStart()).ready).toBe(true);
        const authority = original.policy.resolve();
        if (authority.state !== 'available') {
          throw new Error('expected exact Teacher provider fixture');
        }
        const requestId = deriveFreshStepRequestId(
          active.runId,
          teacherAction.actionId as never,
          teacherAction.attemptId as never
        );
        const seed: ExactTeacherAttemptSeed = {
          attemptId: teacherAction.attemptId,
          provider: authority.selection,
          runId: active.runId,
          actionId: teacherAction.actionId,
          invocationId: teacherAction.invocationId,
          attempt: consultation.teacher.attemptOrdinal,
          stableSessionId: requestId,
          requestId,
        };
        const baselineIdentity = observeStableWorkspaceManifest({ cwd: projectRoot }).digest;
        const exactInput = canonicalJson(teacherAction.agent.input);
        const turnLimits = {
          timeoutMs: 5_000,
          maxInputBytes: 64 * 1024,
          maxOutputBytes: 64 * 1024,
        };
        const hostedAuthority = {
          invocationId: teacherAction.invocationId,
          role: teacherAction.agent.role,
          workspaceInstanceId: active.workspaceInstanceId,
          backend: 'hosted' as const,
        };

        await original.committer.commit(seed, 'canonical-preflight');
        await original.committer.commit(seed, 'baseline-stable', {
          baselineIdentity,
        });
        const prepared = await original.host.dispatch({
          op: 'execute',
          requestId,
          newSessionId: requestId,
          backend: 'claude',
          cwd: projectRoot,
          input: exactInput,
          limits: turnLimits,
          sandbox: 'read-only',
          authority: hostedAuthority,
          exactTeacherAttempt: { mode: 'prepare-only', seed },
        });
        expect(prepared, JSON.stringify(prepared)).toMatchObject({
          ok: true,
          op: 'execute',
        });
        const activated = original.committer.load(seed.attemptId);
        expect(activated).toMatchObject({ phase: 'activated', ...seed });
        const processRef = activated?.processRef;
        if (processRef === undefined) throw new Error('fixture lost exact ProcessRef');
        await original.committer.commit(seed, 'request-sent', {
          baselineIdentity,
          processRef,
        });
        const settled = await original.host.dispatch({
          op: 'execute',
          requestId,
          sessionId: requestId,
          backend: 'claude',
          cwd: projectRoot,
          input: exactInput,
          limits: turnLimits,
          sandbox: 'read-only',
          authority: hostedAuthority,
          exactTeacherAttempt: { mode: 'send-prepared', seed },
        });
        if (
          !settled.ok ||
          settled.op !== 'execute' ||
          settled.receipt === undefined ||
          settled.result === undefined ||
          settled.resultRef === undefined ||
          settled.resultDigest === undefined
        ) {
          throw new Error('fixture exact Teacher request did not settle durably');
        }
        const hostedReceipt = {
          stableSessionId: settled.receipt.stableSessionId,
          requestId: settled.receipt.requestId,
          resultRef: settled.resultRef,
          resultDigest: settled.resultDigest,
        };
        const quarantineIdentity = `quarantine:sha256:${createHash('sha256')
          .update(settled.result, 'utf8')
          .digest('hex')}`;
        const phaseFacts = {
          baselineIdentity,
          processRef,
          hostedReceipt,
          quarantineIdentity,
        };
        const laterPhases: ExactTeacherAttemptPhase[] = [
          'result-quarantined',
          'hosted-receipt-verified',
          'retirement-pending',
          'exact-scope-empty',
          'final-observation-stable',
          'advice-validated',
        ];
        const targetIndex = laterPhases.indexOf(phase);
        for (let index = 0; index <= targetIndex; index += 1) {
          const next = laterPhases[index]!;
          if (next === 'exact-scope-empty') {
            const retired = await original.host.dispatch({
              op: 'retire',
              sessionId: requestId,
              reason: 'replacement-fixture-retirement',
            });
            expect(retired).toMatchObject({
              ok: true,
              op: 'retire',
              session: { state: 'exited' },
            });
          }
          await original.committer.commit(seed, next, phaseFacts);
        }
        expect(original.committer.load(seed.attemptId)?.phase).toBe(phase);
        expect(original.authorityFixture.workloadStarts()).toBe(1);
        expect(original.backend.transports).toHaveLength(1);
        expect(original.backend.transports[0]!.inputs).toHaveLength(1);

        const replacement = createHttpExactTeacherLane(
          root,
          undefined,
          original.authorityFixture
        );
        expect((await replacement.host.reconcileOnStart()).ready).toBe(true);
        const reopened = await replacement.committer.loadRecovery(seed.attemptId);
        expect(reopened?.journal.phase).toBe(phase);
        expect(reopened?.session?.exactTeacherAttempt?.phase).toBe(phase);
        const recoveredHostState =
          laterPhases.indexOf(phase) >= laterPhases.indexOf('exact-scope-empty')
            ? 'retired'
            : 'idle';
        expect(reopened?.session).toMatchObject({
          hostState: recoveredHostState,
          requests: [{ requestId, state: 'settled' }],
        });
        const replacementCommands: Parameters<SessionHost['dispatch']>[0][] = [];
        const replacementHost: SessionHost = Object.freeze({
          ...replacement.host,
          async dispatch(command) {
            replacementCommands.push(command);
            return replacement.host.dispatch(command);
          },
        });
        const committedPhases: ExactTeacherAttemptPhase[] = [];
        const baseCommitter = replacement.committer;
        const replacementCommitter: ExactTeacherAttemptPhaseCommitter = Object.freeze({
          load: (attemptId) => baseCommitter.load(attemptId),
          loadRecovery: (attemptId) => baseCommitter.loadRecovery(attemptId),
          async commit(actualSeed, nextPhase, facts) {
            await baseCommitter.commit(actualSeed, nextPhase, facts);
            committedPhases.push(nextPhase);
          },
        });
        const sourceSession = {
          sessionId: consultation.source.stableSessionId,
          backend: 'claude',
          cwd: projectRoot,
          turnLimits,
          sandbox: 'workspace-write' as const,
          authority: {
            invocationId: consultation.source.invocationId,
            role: sourceAction.agent.role,
            workspaceInstanceId: active.workspaceInstanceId,
            backend: 'hosted' as const,
            handoffTokensUsed: 0,
            reuseRoundsServed: 0,
          },
          hostState: 'idle' as const,
          state: 'running' as const,
          generation: 1,
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:01.000Z',
        };
        const sourceHost: SessionHost = Object.freeze({
          async dispatch(command) {
            return {
              ok: false as const,
              op: command.op,
              code: 'invalid-input' as const,
              message: 'replacement fixture has no source turn',
            };
          },
          inspect: (sessionId) =>
            sessionId === sourceSession.sessionId ? sourceSession : undefined,
          list: () => [sourceSession],
          verifyTurnReceipt: () => false,
          reconcileOnStart: async () => ({
            ready: true,
            inspected: 0,
            recovered: 0,
            interrupted: 0,
            failed: 0,
            diagnostics: [],
          }),
          shutdown: async () => undefined,
        });

        const result = await handleFrozenActionDispatch({
          host: sourceHost,
          exactTeacherHost: replacementHost,
          exactTeacherAuthorityPolicy: replacement.policy,
          exactTeacherAttemptCommitter: replacementCommitter,
          hostPlatform: 'linux',
          storeRoot,
          producerFor: async (action) => createTestTrustedCompletionProducer(action),
          reservationRegistry: fx.reservations,
          workspaceObserver: () => baselineIdentity,
          body: {
            runRef: {
              change: { projectRoot: '/root', changeId: 'fixture-change' },
              runId: active.runId,
            },
            teacherActionId: teacherAction.actionId,
            expectedRecordVersion: active.recordVersion,
          },
        });

        expect(result, JSON.stringify(result)).toMatchObject({
          ok: true,
          status: 200,
          result: { state: 'canonical-advice-settled' },
        });
        expect(JSON.stringify(result)).not.toContain(String(processRef));
        expect(replacementCommands).toHaveLength(replayCount);
        for (const command of replacementCommands) {
          expect(command).toMatchObject({
            op: 'execute',
            sessionId: requestId,
            requestId,
            exactTeacherAttempt: { mode: 'send-prepared', seed },
          });
          expect(command).not.toHaveProperty('newSessionId');
        }
        expect(replacement.backend.transports).toHaveLength(0);
        expect(replacement.authorityFixture.workloadStarts()).toBe(1);
        expect(replacement.committer.load(seed.attemptId)).toMatchObject({
          ...seed,
          processRef,
          phase: 'canonical-settled',
        });
        expect(committedPhases[0]).toBe(firstCommittedPhase);
        expect(committedPhases[committedPhases.length - 1]).toBe(
          'canonical-settled'
        );
        expect(
          fx.store.load(active.runId).consultations?.[consultation.consultationId]
        ).toMatchObject({
          teacher: { advice: { decision: 'plan' } },
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it('coalesces simultaneous HTTP recovery of one journal-first gap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-consultation-concurrent-'));
    const projectRoot = path.join(root, 'worktree');
    const storeRoot = path.join(root, 'runs');
    let server: Awaited<ReturnType<typeof startManagementServer>> | undefined;
    let releaseRecovery: (() => void) | undefined;
    try {
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
      execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      execFileSync('git', ['add', 'tracked.txt'], { cwd: projectRoot, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'fixture'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });

      const fx = fixture({ storeRoot });
      const { sourceAction, consulted } = await startAndConsult(fx);
      const teacherAction = consulted.actions[0]!;
      if (sourceAction.kind !== 'agent' || teacherAction.kind !== 'agent') {
        throw new Error('expected active source and Teacher agents');
      }
      const active = fx.store.load(fx.plan.runId);
      const consultation = Object.values(active.consultations ?? {})[0]!;
      const descriptors = fx.profile.capabilities.map((binding) =>
        trustedDescriptor({
          id: binding.adapter.id,
          version: binding.adapter.version,
          contentDigest: binding.adapter.contentDigest as Digest,
        })
      );
      provisionTrustedExecutionAdapterCatalog(root, descriptors);
      provisionTestTrustedExecutionAdapterCredentials(root, descriptors);

      const exactTeacher = createHttpExactTeacherLane(root);
      expect((await exactTeacher.host.reconcileOnStart()).ready).toBe(true);
      const authority = exactTeacher.policy.resolve();
      if (authority.state !== 'available') {
        throw new Error('expected exact Teacher provider fixture');
      }
      const requestId = deriveFreshStepRequestId(
        active.runId,
        teacherAction.actionId as never,
        teacherAction.attemptId as never
      );
      const seed: ExactTeacherAttemptSeed = {
        attemptId: teacherAction.attemptId,
        provider: authority.selection,
        runId: active.runId,
        actionId: teacherAction.actionId,
        invocationId: teacherAction.invocationId,
        attempt: consultation.teacher.attemptOrdinal,
        stableSessionId: requestId,
        requestId,
      };
      const baselineIdentity = observeStableWorkspaceManifest({ cwd: projectRoot }).digest;
      const turnLimits = {
        timeoutMs: 5_000,
        maxInputBytes: 64 * 1024,
        maxOutputBytes: 64 * 1024,
      };
      await exactTeacher.committer.commit(seed, 'canonical-preflight');
      await exactTeacher.committer.commit(seed, 'baseline-stable', {
        baselineIdentity,
      });
      const prepared = await exactTeacher.host.dispatch({
        op: 'execute',
        requestId,
        newSessionId: requestId,
        backend: 'claude',
        cwd: projectRoot,
        input: canonicalJson(teacherAction.agent.input),
        limits: turnLimits,
        sandbox: 'read-only',
        authority: {
          invocationId: teacherAction.invocationId,
          role: teacherAction.agent.role,
          workspaceInstanceId: active.workspaceInstanceId,
          backend: 'hosted',
        },
        exactTeacherAttempt: { mode: 'prepare-only', seed },
      });
      expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true });
      const activated = exactTeacher.committer.load(seed.attemptId);
      const processRef = activated?.processRef;
      if (processRef === undefined) throw new Error('fixture lost exact ProcessRef');
      await exactTeacher.committer.commit(seed, 'request-sent', {
        baselineIdentity,
        processRef,
        deferSessionProjection: true,
      });
      const settledTurn = await exactTeacher.host.dispatch({
        op: 'execute',
        requestId,
        sessionId: requestId,
        backend: 'claude',
        cwd: projectRoot,
        input: canonicalJson(teacherAction.agent.input),
        limits: turnLimits,
        sandbox: 'read-only',
        authority: {
          invocationId: teacherAction.invocationId,
          role: teacherAction.agent.role,
          workspaceInstanceId: active.workspaceInstanceId,
          backend: 'hosted',
        },
        exactTeacherAttempt: { mode: 'send-prepared', seed },
      });
      expect(settledTurn, JSON.stringify(settledTurn)).toMatchObject({
        ok: true,
        receipt: { requestState: 'settled' },
      });
      expect(exactTeacher.committer.load(seed.attemptId)).toMatchObject({
        phase: 'request-sent',
        journalRevision: 6,
      });
      expect(exactTeacher.sessionRegistry.get(seed.stableSessionId))
        .toMatchObject({ exactTeacherAttempt: { phase: 'activated', journalRevision: 5 } });

      let recoveryLoads = 0;
      let markFirstLoad!: () => void;
      const firstLoadReached = new Promise<void>((resolve) => {
        markFirstLoad = resolve;
      });
      const recoveryGate = new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      });
      const gatedCommitter: ExactTeacherAttemptPhaseCommitter = Object.freeze({
        load: (attemptId) => exactTeacher.committer.load(attemptId),
        async loadRecovery(attemptId) {
          recoveryLoads += 1;
          if (recoveryLoads === 1) {
            markFirstLoad();
            await recoveryGate;
          }
          return exactTeacher.committer.loadRecovery(attemptId);
        },
        commit: (actualSeed, phase, facts) =>
          exactTeacher.committer.commit(actualSeed, phase, facts),
      });
      const sourceSession = {
        sessionId: consultation.source.stableSessionId,
        backend: 'claude',
        cwd: projectRoot,
        turnLimits,
        sandbox: 'workspace-write' as const,
        authority: {
          invocationId: consultation.source.invocationId,
          role: sourceAction.agent.role,
          workspaceInstanceId: active.workspaceInstanceId,
          backend: 'hosted' as const,
          handoffTokensUsed: 0,
          reuseRoundsServed: 0,
        },
        hostState: 'idle' as const,
        state: 'running' as const,
        generation: 1,
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:01.000Z',
      };
      const sourceHost: SessionHost = Object.freeze({
        async dispatch(command) {
          return {
            ok: false as const,
            op: command.op,
            code: 'invalid-input' as const,
            message: 'concurrent recovery fixture has no source turn',
          };
        },
        inspect: (sessionId) =>
          sessionId === sourceSession.sessionId ? sourceSession : undefined,
        list: () => [sourceSession],
        verifyTurnReceipt: () => false,
        reconcileOnStart: async () => ({
          ready: true,
          inspected: 0,
          recovered: 0,
          interrupted: 0,
          failed: 0,
          diagnostics: [],
        }),
        shutdown: async () => undefined,
      });
      const token = 'consultation-concurrent-token';
      server = await startManagementServer({
        hostStateRoot: root,
        context: {
          token,
          launchProjectRoot: projectRoot,
          launchProjectRef: {
            projectId: 'consultation-concurrent-project',
            name: 'consultation-concurrent-project',
            root: projectRoot,
          },
          version: '0.2.0-test',
          uiAssetsDir: null,
        },
        sessions: {
          sessionHostOverride: sourceHost,
          exactTeacherSessionHostOverride: exactTeacher.host,
          exactTeacherAttemptCommitterOverride: gatedCommitter,
          exactTeacherAuthorityPolicy: exactTeacher.policy,
        },
      });

      const workloadsBefore = exactTeacher.authorityFixture.workloadStarts();
      const transportsBefore = exactTeacher.backend.transports.length;
      const inputsBefore = exactTeacher.backend.transports.reduce(
        (total, transport) => total + transport.inputs.length,
        0
      );
      const reservationsBefore = runtimeServiceReservationRegistry(storeRoot)
        .snapshot(active.workspaceInstanceId);
      expect(reservationsBefore).toHaveLength(2);
      let flushed = 0;
      let markBothFlushed!: () => void;
      const bothFlushed = new Promise<void>((resolve) => {
        markBothFlushed = resolve;
      });
      const onFlushed = (): void => {
        flushed += 1;
        if (flushed === 2) markBothFlushed();
      };
      const body = {
        runRef: {
          change: { projectRoot, changeId: 'fixture-change' },
          runId: active.runId,
        },
        teacherActionId: teacherAction.actionId,
        expectedRecordVersion: active.recordVersion,
      };
      const firstResponse = postJson(
        server.port,
        token,
        '/api/v1/frozen-action-executor/dispatch',
        body,
        onFlushed
      );
      const secondResponse = postJson(
        server.port,
        token,
        '/api/v1/frozen-action-executor/dispatch',
        body,
        onFlushed
      );
      await Promise.all([bothFlushed, firstLoadReached]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseRecovery();
      const responses = await Promise.all([firstResponse, secondResponse]);

      expect(responses[0]!.status, responses[0]!.body).toBe(200);
      expect(responses[1]!.status, responses[1]!.body).toBe(200);
      expect(responses[0]!.body).toBe(responses[1]!.body);
      expect(JSON.parse(responses[0]!.body), responses[0]!.body).toMatchObject({
        state: 'canonical-advice-settled',
      });
      expect(responses[0]!.body).not.toContain('consultation_driver_failed');
      expect(exactTeacher.backend.transports).toHaveLength(transportsBefore);
      expect(exactTeacher.backend.transports.reduce(
        (total, transport) => total + transport.inputs.length,
        0
      )).toBe(inputsBefore);
      expect(inputsBefore).toBe(1);
      expect(exactTeacher.authorityFixture.workloadStarts()).toBe(workloadsBefore);
      expect(exactTeacher.committer.load(seed.attemptId)).toMatchObject({
        phase: 'canonical-settled',
      });
      expect(exactTeacher.sessionRegistry.get(seed.stableSessionId))
        .toMatchObject({ exactTeacherAttempt: { phase: 'canonical-settled' } });
      const settledRecord = fx.store.load(active.runId);
      expect(settledRecord.transitions.filter((transition) =>
        transition.kind === 'ConsultationAdviceCommitted'
      )).toHaveLength(1);
      expect(settledRecord.transitions.filter((transition) =>
        transition.kind === 'ConsultationContinuationGranted'
      )).toHaveLength(1);
      const reservationsAfter = runtimeServiceReservationRegistry(storeRoot)
        .snapshot(active.workspaceInstanceId);
      expect(reservationsAfter.map((reservation) => reservation.actionId))
        .toContain(sourceAction.actionId);
      expect(reservationsAfter.map((reservation) => reservation.actionId))
        .not.toContain(teacherAction.actionId);
    } finally {
      releaseRecovery?.();
      await server?.stopServer();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { conflict: 'foreign-identity' },
    { conflict: 'same-phase-optional-facts' },
    { conflict: 'future-session-frontier' },
    { conflict: 'malformed-journal' },
  ] as const)(
    'retains $conflict through the real HTTP exact-Teacher path without durable mutation',
    async ({ conflict }) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), `rasen-consultation-http-${conflict}-`)
      );
      const projectRoot = path.join(root, 'worktree');
      const storeRoot = path.join(root, 'runs');
      let server: Awaited<ReturnType<typeof startManagementServer>> | undefined;
      try {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
        execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        execFileSync('git', ['add', 'tracked.txt'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
        execFileSync('git', ['commit', '-m', 'fixture'], {
          cwd: projectRoot,
          stdio: 'ignore',
        });

        const fx = fixture({ storeRoot });
        const { sourceAction, consulted } = await startAndConsult(fx);
        const teacherAction = consulted.actions[0]!;
        if (sourceAction.kind !== 'agent' || teacherAction.kind !== 'agent') {
          throw new Error('expected active source and Teacher agents');
        }
        const active = fx.store.load(fx.plan.runId);
        const consultation = Object.values(active.consultations ?? {})[0]!;
        const descriptors = fx.profile.capabilities.map((binding) =>
          trustedDescriptor({
            id: binding.adapter.id,
            version: binding.adapter.version,
            contentDigest: binding.adapter.contentDigest as Digest,
          })
        );
        provisionTrustedExecutionAdapterCatalog(root, descriptors);
        provisionTestTrustedExecutionAdapterCredentials(root, descriptors);

        const exactTeacher = createHttpExactTeacherLane(root);
        expect((await exactTeacher.host.reconcileOnStart()).ready).toBe(true);
        const authority = exactTeacher.policy.resolve();
        if (authority.state !== 'available') {
          throw new Error('expected exact Teacher provider fixture');
        }
        const requestId = deriveFreshStepRequestId(
          active.runId,
          teacherAction.actionId as never,
          teacherAction.attemptId as never
        );
        const seed: ExactTeacherAttemptSeed = {
          attemptId: teacherAction.attemptId,
          provider: authority.selection,
          runId: active.runId,
          actionId: teacherAction.actionId,
          invocationId: teacherAction.invocationId,
          attempt: consultation.teacher.attemptOrdinal,
          stableSessionId: requestId,
          requestId,
        };
        const baselineIdentity = observeStableWorkspaceManifest({ cwd: projectRoot }).digest;
        const turnLimits = {
          timeoutMs: 5_000,
          maxInputBytes: 64 * 1024,
          maxOutputBytes: 64 * 1024,
        };
        await exactTeacher.committer.commit(seed, 'canonical-preflight');
        await exactTeacher.committer.commit(seed, 'baseline-stable', {
          baselineIdentity,
        });
        const prepared = await exactTeacher.host.dispatch({
          op: 'execute',
          requestId,
          newSessionId: requestId,
          backend: 'claude',
          cwd: projectRoot,
          input: canonicalJson(teacherAction.agent.input),
          limits: turnLimits,
          sandbox: 'read-only',
          authority: {
            invocationId: teacherAction.invocationId,
            role: teacherAction.agent.role,
            workspaceInstanceId: active.workspaceInstanceId,
            backend: 'hosted',
          },
          exactTeacherAttempt: { mode: 'prepare-only', seed },
        });
        expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true });
        const activated = exactTeacher.committer.load(seed.attemptId);
        const processRef = activated?.processRef;
        if (processRef === undefined) throw new Error('fixture lost exact ProcessRef');
        if (conflict === 'future-session-frontier') {
          await exactTeacher.committer.commit(seed, 'request-sent', {
            baselineIdentity,
            processRef,
          });
        }

        const conflictRoot = path.join(root, `conflict-${conflict}`);
        const conflictJournal = createExactTeacherAttemptJournal({ root: conflictRoot });
        const journalSeed = conflict === 'foreign-identity'
          ? {
              ...seed,
              runId: 'run:foreign-private-identity',
              actionId: 'action:foreign-private-identity',
              invocationId: 'invocation:foreign-private-identity',
              requestId: 'request:foreign-private-identity',
            }
          : seed;
        conflictJournal.create({
          schema: 'rasen-exact-teacher-attempt-journal/1',
          recordVersion: 1,
          revision: 5,
          ...journalSeed,
          processRef,
          baselineIdentity: conflict === 'same-phase-optional-facts'
            ? 'workspace-baseline:foreign-private-fact'
            : baselineIdentity,
          phase: 'activated',
        });
        const journalPath = path.join(conflictRoot, fs.readdirSync(conflictRoot)[0]!);
        if (conflict === 'malformed-journal') {
          fs.appendFileSync(
            journalPath,
            Buffer.from('private-malformed-journal-diagnostic', 'utf8')
          );
        }
        const conflictCommitter = createExactTeacherAttemptPersistence({
          journal: conflictJournal,
          sessionRegistry: exactTeacher.sessionRegistry,
        });
        const sourceSession = {
          sessionId: consultation.source.stableSessionId,
          backend: 'claude',
          cwd: projectRoot,
          turnLimits,
          sandbox: 'workspace-write' as const,
          authority: {
            invocationId: consultation.source.invocationId,
            role: sourceAction.agent.role,
            workspaceInstanceId: active.workspaceInstanceId,
            backend: 'hosted' as const,
            handoffTokensUsed: 0,
            reuseRoundsServed: 0,
          },
          hostState: 'idle' as const,
          state: 'running' as const,
          generation: 1,
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:01.000Z',
        };
        const sourceHost: SessionHost = Object.freeze({
          async dispatch(command) {
            return {
              ok: false as const,
              op: command.op,
              code: 'invalid-input' as const,
              message: 'durable conflict fixture has no source turn',
            };
          },
          inspect: (sessionId) =>
            sessionId === sourceSession.sessionId ? sourceSession : undefined,
          list: () => [sourceSession],
          verifyTurnReceipt: () => false,
          reconcileOnStart: async () => ({
            ready: true,
            inspected: 0,
            recovered: 0,
            interrupted: 0,
            failed: 0,
            diagnostics: [],
          }),
          shutdown: async () => undefined,
        });
        const token = `consultation-conflict-${conflict}-token`;
        server = await startManagementServer({
          hostStateRoot: root,
          context: {
            token,
            launchProjectRoot: projectRoot,
            launchProjectRef: {
              projectId: `consultation-conflict-${conflict}`,
              name: `consultation-conflict-${conflict}`,
              root: projectRoot,
            },
            version: '0.2.0-test',
            uiAssetsDir: null,
          },
          sessions: {
            sessionHostOverride: sourceHost,
            exactTeacherSessionHostOverride: exactTeacher.host,
            exactTeacherAttemptCommitterOverride: conflictCommitter,
            exactTeacherAuthorityPolicy: exactTeacher.policy,
          },
        });

        const registryBefore = fs.readFileSync(
          exactTeacher.sessionRegistry.paths.registryPath
        );
        const journalBefore = fs.readFileSync(journalPath);
        const recordBefore = fx.store.load(active.runId);
        const sessionBefore = exactTeacher.sessionRegistry.get(seed.stableSessionId);
        const reservationsBefore = runtimeServiceReservationRegistry(storeRoot)
          .snapshot(active.workspaceInstanceId);
        const transportsBefore = exactTeacher.backend.transports.length;
        const inputsBefore = exactTeacher.backend.transports.reduce(
          (total, transport) => total + transport.inputs.length,
          0
        );
        const workloadsBefore = exactTeacher.authorityFixture.workloadStarts();

        for (let pass = 0; pass < 2; pass += 1) {
          const response = await postJson(
            server.port,
            token,
            '/api/v1/frozen-action-executor/dispatch',
            {
              runRef: {
                change: { projectRoot, changeId: 'fixture-change' },
                runId: active.runId,
              },
              teacherActionId: teacherAction.actionId,
              expectedRecordVersion: active.recordVersion,
            }
          );
          expect(response.status, response.body).toBe(200);
          expect(JSON.parse(response.body)).toMatchObject({
            state: 'authority-retained',
            reason: 'authority-identity-mismatch',
            adviceAllowed: false,
            sessionReleaseAllowed: false,
            sponsoredReservationReleaseAllowed: false,
          });
          expect(response.body).not.toContain(processRef);
          expect(response.body).not.toContain(authority.selection.providerId);
          expect(response.body).not.toContain('foreign-private');
          expect(response.body).not.toContain('malformed-journal-diagnostic');
          expect(response.body).not.toMatch(
            /processRef|capabilityId|protocolVersion|displayPid|nativeHandle|hostedReceipt|resultRef|resultDigest/u
          );
        }

        expect(fs.readFileSync(exactTeacher.sessionRegistry.paths.registryPath))
          .toEqual(registryBefore);
        expect(fs.readFileSync(journalPath)).toEqual(journalBefore);
        expect(fx.store.load(active.runId)).toEqual(recordBefore);
        expect(runtimeServiceReservationRegistry(storeRoot)
          .snapshot(active.workspaceInstanceId)).toEqual(reservationsBefore);
        expect(exactTeacher.sessionRegistry.get(seed.stableSessionId))
          .toEqual(sessionBefore);
        expect(exactTeacher.backend.transports).toHaveLength(transportsBefore);
        expect(exactTeacher.backend.transports.reduce(
          (total, transport) => total + transport.inputs.length,
          0
        )).toBe(inputsBefore);
        expect(exactTeacher.authorityFixture.workloadStarts()).toBe(workloadsBefore);
        expect(reservationsBefore.map((reservation) => reservation.actionId)).toEqual(
          expect.arrayContaining([sourceAction.actionId, teacherAction.actionId])
        );
        expect(reservationsBefore).toHaveLength(2);
        expect(recordBefore.transitions.filter((transition) =>
          transition.kind === 'ConsultationAdviceCommitted' ||
          transition.kind === 'ConsultationTeacherAttemptFailed' ||
          transition.kind === 'ConsultationUnavailable' ||
          transition.kind === 'ConsultationContinuationGranted'
        )).toEqual([]);
      } finally {
        await server?.stopServer();
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it('retains unsafe exact authority without advice, continuation, or reservation release', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-consultation-retained-'));
    const projectRoot = path.join(root, 'worktree');
    const storeRoot = path.join(root, 'runs');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', 'tracked.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const fx = fixture({ storeRoot });
    const started = await fx.makeRuntime().start(
      {
        change: { projectRoot, changeId: 'fixture-change' },
        pipeline: fx.plan.pipeline,
        launchRequestId: branded(`launch:${'3'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const sourceAction = started.actions[0]!;
    const descriptors = fx.profile.capabilities.map((binding) =>
      trustedDescriptor({
        id: binding.adapter.id,
        version: binding.adapter.version,
        contentDigest: binding.adapter.contentDigest as Digest,
      })
    );
    provisionTrustedExecutionAdapterCatalog(root, descriptors);
    provisionTestTrustedExecutionAdapterCredentials(root, descriptors);

    const backend = new HttpConsultationBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir: path.join(root, 'sessions') }),
      backends: [backend],
    });
    const exactTeacher = createHttpExactTeacherLane(root);
    exactTeacher.authorityFixture.setControl({
      state: 'control-loss',
      diagnostic: 'deterministic retained authority',
    });
    const token = 'consultation-retained-token';
    const server = await startManagementServer({
      hostStateRoot: root,
      context: {
        token,
        launchProjectRoot: projectRoot,
        launchProjectRef: {
          projectId: 'consultation-retained-project',
          name: 'consultation-retained-project',
          root: projectRoot,
        },
        version: '0.2.0-test',
        uiAssetsDir: null,
      },
      sessions: {
        sessionHostOverride: host,
        exactTeacherSessionHostOverride: exactTeacher.host,
        exactTeacherAttemptCommitterOverride: exactTeacher.committer,
        exactTeacherAuthorityPolicy: exactTeacher.policy,
      },
    });
    try {
      const head = fx.store.load(fx.plan.runId);
      const response = await postJson(
        server.port,
        token,
        '/api/v1/frozen-action-executor/dispatch',
        {
          runRef: {
            change: { projectRoot, changeId: 'fixture-change' },
            runId: fx.plan.runId,
          },
          grantedAction: sourceAction,
          expectedRecordVersion: head.recordVersion,
          workspaceRevision: sourceAction.expectedBeforeWorkspace,
          requestedBackend: 'hosted',
          turnInput: 'caller text is not the consultation authority',
          hostedSeam: {
            cwd: projectRoot,
            backend: backend.id,
            limits: {
              timeoutMs: 5_000,
              maxInputBytes: 64 * 1024,
              maxOutputBytes: 64 * 1024,
            },
          },
        }
      );
      expect(response.status, response.body).toBe(200);
      const driven = JSON.parse(response.body) as {
        retainedAuthority?: Record<string, unknown>;
      };
      expect(driven.retainedAuthority).toEqual({
        state: 'authority-retained',
        reason: 'authority-reconciliation-required',
      });
      expect(response.body).not.toContain('deterministic retained authority');

      const retained = fx.store.load(fx.plan.runId);
      const linked = retained.transitions.find(
        (transition) => transition.kind === 'ConsultationTeacherLinked'
      );
      if (linked?.kind !== 'ConsultationTeacherLinked') {
        throw new Error('fixture did not durably link the retained Teacher attempt');
      }
      expect(
        retained.transitions.filter((transition) =>
          transition.kind === 'ConsultationAdviceCommitted' ||
          transition.kind === 'ConsultationTeacherAttemptFailed' ||
          transition.kind === 'ConsultationUnavailable' ||
          transition.kind === 'ConsultationContinuationGranted'
        )
      ).toEqual([]);

      const sourceInputs = backend.transports.flatMap((transport) =>
        transport.inputs.map((turn) => JSON.parse(turn.input) as { contract?: string })
      );
      expect(
        sourceInputs.filter((entry) =>
          entry.contract === 'teacher-consultation/resume/1' ||
          entry.contract === 'teacher-consultation/unavailable/1'
        )
      ).toEqual([]);
      expect(exactTeacher.backend.transports).toHaveLength(1);
      expect(exactTeacher.backend.transports[0]!.inputs).toHaveLength(1);

      const reservations = runtimeServiceReservationRegistry(storeRoot).snapshot(
        retained.workspaceInstanceId
      );
      expect(reservations.map((reservation) => reservation.actionId)).toEqual(
        expect.arrayContaining([sourceAction.actionId, linked.teacherActionId])
      );
      expect(reservations).toHaveLength(2);
    } finally {
      exactTeacher.authorityFixture.setControl({ state: 'exact-scope-empty' });
      await server.stopServer();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a delayed child creates an early ignored path during the final fence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-consultation-ignored-'));
    const projectRoot = path.join(root, 'worktree');
    const storeRoot = path.join(root, 'runs');
    const ignoredFile = path.join(projectRoot, 'teacher-private.tmp');
    const delayedCreatedFile = path.join(projectRoot, 'a-delayed.tmp');
    const lateScanFile = path.join(projectRoot, 'z-late.bin');
    const delayedBarrier = path.join(root, 'delayed-writer.barrier');
    const delayedMarker = path.join(root, 'delayed-writer.marker');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'before\n', 'utf8');
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), '*.tmp\n', 'utf8');
    fs.writeFileSync(ignoredFile, 'source-owned\n', 'utf8');
    fs.writeFileSync(lateScanFile, Buffer.alloc(256 * 1024, 0x7a));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'teacher-test@example.invalid'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Teacher Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', 'tracked.txt', '.gitignore'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const fx = fixture({ storeRoot });
    const runtime = fx.makeRuntime();
    const started = await runtime.start(
      {
        change: { projectRoot, changeId: 'fixture-change' },
        pipeline: fx.plan.pipeline,
        launchRequestId: branded(`launch:${'2'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const sourceAction = started.actions[0]!;
    const descriptors = fx.profile.capabilities.map((binding) =>
      trustedDescriptor({
        id: binding.adapter.id,
        version: binding.adapter.version,
        contentDigest: binding.adapter.contentDigest as Digest,
      })
    );
    provisionTrustedExecutionAdapterCatalog(root, descriptors);
    provisionTestTrustedExecutionAdapterCredentials(root, descriptors);

    const mutations: number[] = [];
    const reservationSnapshots: string[][] = [];
    const serviceReservations = runtimeServiceReservationRegistry(storeRoot);
    let delayedWriter: ChildProcess | undefined;
    let barrierReleased = false;
    const backend = new HttpConsultationBackend();
    const exactTeacher = createHttpExactTeacherLane(root, (teacherAttempt) => {
      mutations.push(teacherAttempt);
      reservationSnapshots.push(
        serviceReservations
          .snapshot(fx.store.load(fx.plan.runId).workspaceInstanceId)
          .map((reservation) => reservation.actionId)
      );
      if (teacherAttempt === 1) {
        delayedWriter = spawn(
          process.execPath,
          [path.resolve('test/fixtures/change-run/delayed-workspace-writer.mjs')],
          {
            windowsHide: true,
            stdio: 'ignore',
            env: {
              RASEN_DELAYED_WRITER_BARRIER: delayedBarrier,
              RASEN_DELAYED_WRITER_TARGET: delayedCreatedFile,
              RASEN_DELAYED_WRITER_MARKER: delayedMarker,
            },
          }
        );
      } else {
        fs.appendFileSync(ignoredFile, 'teacher-attempt-2\n', 'utf8');
      }
    });
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir: path.join(root, 'sessions') }),
      backends: [backend],
    });
    const token = 'consultation-ignored-token';
    const server = await startManagementServer({
      hostStateRoot: root,
      context: {
        token,
        launchProjectRoot: projectRoot,
        launchProjectRef: {
          projectId: 'consultation-ignored-project',
          name: 'consultation-ignored-project',
          root: projectRoot,
        },
        version: '0.2.0-test',
        uiAssetsDir: null,
      },
      sessions: {
        sessionHostOverride: host,
        exactTeacherSessionHostOverride: exactTeacher.host,
        exactTeacherAttemptCommitterOverride: exactTeacher.committer,
        exactTeacherAuthorityPolicy: exactTeacher.policy,
        frozenActionWorkspaceObserver: (cwd) =>
          observeStableWorkspaceManifest({
            cwd,
            internalInstabilityRetries: 0,
            onPhase(event) {
              if (
                delayedWriter !== undefined &&
                !barrierReleased &&
                event.phase === 'after-file-read' &&
                event.relativePath === 'z-late.bin'
              ) {
                barrierReleased = true;
                fs.writeFileSync(delayedBarrier, 'release\n', 'utf8');
                waitForPathSync(delayedMarker);
              }
            },
          }).digest,
      },
    });
    try {
      const head = fx.store.load(fx.plan.runId);
      const response = await postJson(
        server.port,
        token,
        '/api/v1/frozen-action-executor/dispatch',
        {
          runRef: {
            change: { projectRoot, changeId: 'fixture-change' },
            runId: fx.plan.runId,
          },
          grantedAction: sourceAction,
          expectedRecordVersion: head.recordVersion,
          workspaceRevision: sourceAction.expectedBeforeWorkspace,
          requestedBackend: 'hosted',
          turnInput: 'caller text is not the consultation authority',
          hostedSeam: {
            cwd: projectRoot,
            backend: backend.id,
            limits: {
              timeoutMs: 5_000,
              maxInputBytes: 64 * 1024,
              maxOutputBytes: 64 * 1024,
            },
          },
        }
      );
      expect(response.status, response.body).toBe(200);
      const driven = JSON.parse(response.body) as {
        dispatches: Array<{
          kind: string;
          outcome?: { kind: string; source: string; message: string };
        }>;
      };
      expect(driven.dispatches).toHaveLength(2);
      expect(mutations).toEqual([1, 2]);
      expect(fs.readFileSync(delayedCreatedFile, 'utf8')).toBe(
        'delayed-teacher-write\n'
      );
      expect(fs.readFileSync(ignoredFile, 'utf8')).toContain('teacher-attempt-2');
      expect(barrierReleased).toBe(true);

      const settled = fx.store.load(fx.plan.runId);
      expect(
        settled.transitions.filter(
          (transition) => transition.kind === 'ConsultationAdviceCommitted'
        )
      ).toEqual([]);
      expect(
        settled.transitions.filter(
          (transition) => transition.kind === 'ConsultationTeacherAttemptFailed'
        )
      ).toHaveLength(2);
      const failedTeacherActionIds = settled.transitions.flatMap((transition) =>
        transition.kind === 'ConsultationTeacherAttemptFailed'
          ? [transition.teacherActionId]
          : []
      );
      expect(reservationSnapshots).toHaveLength(2);
      expect(reservationSnapshots[0]).toEqual(
        expect.arrayContaining([sourceAction.actionId, failedTeacherActionIds[0]])
      );
      expect(reservationSnapshots[0]).not.toContain(failedTeacherActionIds[1]);
      expect(reservationSnapshots[1]).toEqual(
        expect.arrayContaining([sourceAction.actionId, failedTeacherActionIds[1]])
      );
      expect(reservationSnapshots[1]).not.toContain(failedTeacherActionIds[0]);
      const teacherInputs = exactTeacher.backend.transports.flatMap((transport) =>
        transport.inputs.map((turn) => JSON.parse(turn.input) as {
          contract?: string;
          teacherConsultation?: { contract?: string };
        })
      );
      expect(
        teacherInputs.filter(
          (entry) =>
            entry.teacherConsultation?.contract ===
            'teacher-consultation/invocation/1'
        )
      ).toHaveLength(2);
      const sourceInputs = backend.transports.flatMap((transport) =>
        transport.inputs.map((turn) => JSON.parse(turn.input) as {
          contract?: string;
        })
      );
      expect(
        sourceInputs.filter(
          (entry) => entry.contract === 'teacher-consultation/resume/1'
        )
      ).toEqual([]);
      expect(
        sourceInputs.filter(
          (entry) => entry.contract === 'teacher-consultation/unavailable/1'
        )
      ).toHaveLength(1);
      expect(
        serviceReservations.snapshot(settled.workspaceInstanceId)
      ).toEqual([]);
    } finally {
      if (delayedWriter?.exitCode === null) delayedWriter.kill();
      await server.stopServer();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
