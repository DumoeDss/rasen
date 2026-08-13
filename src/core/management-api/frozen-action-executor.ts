/**
 * `POST /api/v1/frozen-action-executor/dispatch` — the daemon face of the
 * frozen-action session executor (task 7.1 driver-face wiring).
 *
 * Routes a granted frozen Action through the shared `dispatchGrantedAction`
 * contract at the daemon seam (where the `SessionHost` lives). The CLI, Canvas,
 * interactive launcher, and daemon all reach the executor through this one
 * endpoint, so no face maintains a second Run or Session truth (design D7). The
 * executor validates the granted ActionView against the committed Record
 * (loaded read-only, same path as `run-control.ts`), selects a backend through
 * the capability matrix (never silently rerouting), drives the SessionHost, and
 * reconciles the host outcome into a typed Action outcome.
 *
 * Like `hosted-sessions/execute`, this endpoint drives the trusted daemon-owned
 * `SessionHost` in-process (the daemon is the trusted path, not a browser). It
 * performs NO Record mutation: completion is written only through the canonical
 * Facade `complete` path (run-control spawns the CLI for that). This endpoint
 * returns the typed `ExecutionDispatchResult` the caller completes from.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

import type {
  ExactTeacherAttemptRecoverySnapshot,
  ExactTeacherAttemptPhaseCommitter,
  ExactTeacherAttemptSeed,
  HostedRequestRecord,
  HostedTurnReceipt,
  SessionHost,
  TurnLimits,
} from '../session-host/contracts.js';
import {
  isExactScopeEmptyReceipt,
  type ProcessAuthorityLifecycleOutcome,
  type ProcessAuthoritySelection,
} from '../session-host/process-authority/index.js';
import {
  decodeAgentContinuationGrant,
  decodeRunAction,
  decodeTeacherConsultationAdvice,
  decodeWorkspaceRevision,
  deriveFreshStepRequestId,
  openStoredRuntimeContext,
  StoredRuntimeContextError,
  type AgentContinuationGrant,
  type ExactChangeRunRef,
  type RunAction,
  type RuntimeContext,
  type WorkspaceRevision,
} from '../change-run/index.js';
import { decodeCanonicalRunRecord, type CanonicalRunRecord } from '../change-run/internal/record.js';
import { projectRunView } from '../change-run/internal/projector.js';
import { TrustedCompletionProducerError } from '../change-run/internal/trusted-completion-producer.js';
import type { WorkspaceReservationRegistry } from '../change-run/internal/reservations.js';
import { canonicalJson } from '../change-run/internal/identity.js';
import { observeStableWorkspaceManifest } from '../workspace-manifest.js';
import {
  EXACT_TEACHER_ATTEMPT_PHASES,
  classifyExactTeacherAuthorityRecovery,
  createExactTeacherAttemptModule,
  createProductionConsultationDriver,
  createProductionExecutor,
  summarizeExactTeacherRetainedWait,
  type ExecutionBackendId,
  type ExactTeacherAttemptModule,
  type ExactTeacherAttemptModuleOptions,
  type ExactTeacherAttemptLocator,
  type ExactTeacherAttemptRecoveryState,
  type ExactTeacherAuthorityRecoveryDisposition,
  type ExactTeacherResolvedAttempt,
  type ExactTeacherAuthorityPolicy,
  type ExactTeacherProviderPublicationFact,
  type HostedBackendSeamOptions,
  type ProductionExecutor,
  type TrustedCompletionProducerResolver,
} from '../frozen-action-executor/index.js';
import { createProductionRoutedTurnExecutor } from '../frozen-action-executor/index.js';

const MAX_DISPATCH_BODY_BYTES = 2 * 1024 * 1024;

export interface FrozenActionDispatchBody {
  readonly runRef: ExactChangeRunRef;
  readonly grantedAction: RunAction;
  readonly expectedRecordVersion: number;
  readonly workspaceRevision: WorkspaceRevision;
  readonly requestedBackend?: ExecutionBackendId;
  readonly explicitDefaultBackend?: ExecutionBackendId;
  readonly turnInput: string;
  readonly hostedSeam?: { readonly cwd: string; readonly backend: string; readonly limits: TurnLimits };
}

export interface FrozenActionContinuationBody {
  readonly runRef: ExactChangeRunRef;
  readonly grant: AgentContinuationGrant;
  readonly requestedBackend?: ExecutionBackendId;
  readonly explicitDefaultBackend?: ExecutionBackendId;
}

export type FrozenActionDispatchResult =
  | { readonly ok: true; readonly status: number; readonly result: unknown }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string };

function findHeadRecordFile(dirPath: string): string | null {
  let files: string[];
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return null;
  }
  let bestVersion = -1;
  for (const file of files) {
    const match = /^record-v(\d+)\.json$/.exec(file);
    if (match) {
      const version = Number.parseInt(match[1]!, 10);
      if (version > bestVersion) bestVersion = version;
    }
  }
  if (bestVersion === -1) return null;
  return path.join(dirPath, `record-v${bestVersion}.json`);
}

function loadHeadRecord(storeRoot: string, runId: string): CanonicalRunRecord | null {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const file = findHeadRecordFile(path.join(storeRoot, dirName));
  if (file === null) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return decodeCanonicalRunRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Resolve the machine run-store root (`<dataDir>/runs`), the same location
 * `run-control.ts` resolves. Returns null if the data directory is unavailable.
 */
async function resolveRunStoreRoot(): Promise<string | null> {
  try {
    const { getGlobalDataDir } = await import('../global-config.js');
    return path.join(getGlobalDataDir(), 'runs');
  } catch {
    return null;
  }
}

function badRequest(code: string, message: string): FrozenActionDispatchResult {
  return { ok: false, status: 400, code, message };
}

function participatesInConsultation(
  record: CanonicalRunRecord,
  action: RunAction
): boolean {
  if (action.kind === 'agent' && action.agent.consultation?.eligible === true) {
    return true;
  }
  return Object.values(record.consultations ?? {}).some(
    (consultation) =>
      consultation.source.actionId === action.actionId ||
      consultation.teacher.actionId === action.actionId
  );
}

function consultationDriverFailure(error: unknown): FrozenActionDispatchResult {
  if (error instanceof TrustedCompletionProducerError) {
    return { ok: false, status: 503, code: error.code, message: error.message };
  }
  if (error instanceof StoredRuntimeContextError) {
    return { ok: false, status: 409, code: error.code, message: error.message };
  }
  return {
    ok: false,
    status: 409,
    code: 'consultation_driver_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function signerUnavailable(): FrozenActionDispatchResult {
  return {
    ok: false,
    status: 503,
    code: 'attestation_signer_unavailable',
    message:
      'The daemon has no trusted completion producer for this frozen Action authority.',
  };
}

type HostedSeamResolution =
  | { readonly ok: true; readonly seam: HostedBackendSeamOptions }
  | { readonly ok: false; readonly message: string };

function sourceHostedSeam(
  host: SessionHost,
  record: CanonicalRunRecord,
  consultationId: string
): HostedSeamResolution {
  const consultation = record.consultations?.[consultationId];
  const source =
    consultation === undefined
      ? undefined
      : record.actions[consultation.source.actionId];
  const session =
    consultation === undefined
      ? undefined
      : host.inspect(consultation.source.stableSessionId);
  if (
    consultation === undefined ||
    source?.action.kind !== 'agent' ||
    session === undefined ||
    session.turnLimits === undefined ||
    session.authority?.invocationId !== consultation.source.invocationId ||
    session.authority.role !== source.action.agent.role ||
    session.authority.workspaceInstanceId !== record.workspaceInstanceId ||
    session.authority.backend !== 'hosted'
  ) {
    return {
      ok: false,
      message:
        'The canonical source Session has no exact cwd/backend/limits authority for Teacher execution.',
    };
  }
  return {
    ok: true,
    seam: {
      cwd: session.cwd,
      backend: session.backend,
      limits: session.turnLimits,
    },
  };
}

function observeWorkspace(cwd: string): string {
  return observeStableWorkspaceManifest({ cwd }).digest;
}

function workspaceObservationFailure(
  result: Extract<
    Awaited<ReturnType<ProductionExecutor['dispatch']>>,
    { kind: 'executed' }
  >,
  message: string
) {
  return {
    ...result,
    outcome: {
      kind: 'failed' as const,
      backend: result.backend,
      source: 'workspace-observation' as const,
      message,
      ...(result.outcome.hostedTurn === undefined
        ? {}
        : { hostedTurn: result.outcome.hostedTurn }),
    },
  };
}

interface ManagementExactTeacherAttemptContext {
  readonly locator: ExactTeacherAttemptLocator;
  readonly record: CanonicalRunRecord;
  readonly action: Extract<RunAction, { kind: 'agent' }>;
  readonly consultationId: string;
  readonly seam: HostedBackendSeamOptions;
  readonly authority: ReturnType<ExactTeacherAuthorityPolicy['resolve']>;
  runtime?: RuntimeContext;
  receipt?: HostedTurnReceipt;
  rawResult?: string;
  validatedAdvice?: unknown;
}

function managementExactTeacherContext(
  attempt: ExactTeacherResolvedAttempt
): ManagementExactTeacherAttemptContext {
  return attempt.canonicalContext as ManagementExactTeacherAttemptContext;
}

function managementExactTeacherSeed(
  attempt: ExactTeacherResolvedAttempt
): ExactTeacherAttemptSeed {
  if (attempt.provider === undefined) {
    throw new Error('Exact Teacher provider tuple is unavailable.');
  }
  return Object.freeze({
    attemptId: attempt.attemptId,
    provider: attempt.provider,
    runId: attempt.runId,
    actionId: attempt.actionId,
    invocationId: attempt.invocationId,
    attempt: attempt.attempt,
    stableSessionId: attempt.stableSessionId,
    requestId: attempt.requestId,
  });
}

function sameExactTeacherProvider(
  left: ProcessAuthoritySelection,
  right: ProcessAuthoritySelection
): boolean {
  return left.providerId === right.providerId &&
    left.capabilityId === right.capabilityId &&
    left.protocolVersion === right.protocolVersion;
}

function matchingRecoveryRequest(
  state: ExactTeacherAttemptRecoveryState
): HostedRequestRecord | undefined {
  return state.session?.requests.find(
    (request) => request.requestId === state.journal.requestId
  );
}

function recoveryPhaseFacts(
  state: ExactTeacherAttemptRecoveryState
) {
  return Object.freeze({
    ...(state.journal.baselineIdentity === undefined
      ? {}
      : { baselineIdentity: state.journal.baselineIdentity }),
    ...(state.journal.processRef === undefined
      ? {}
      : { processRef: state.journal.processRef }),
    ...(state.journal.hostedReceipt === undefined
      ? {}
      : { hostedReceipt: state.journal.hostedReceipt }),
    ...(state.journal.quarantineIdentity === undefined
      ? {}
      : { quarantineIdentity: state.journal.quarantineIdentity }),
  });
}

function exactTeacherRecoveryObservation(
  outcome: ProcessAuthorityLifecycleOutcome
) {
  switch (outcome.state) {
    case 'prepared-inert':
    case 'published-inert':
    case 'live':
    case 'root-exited':
      return Object.freeze({ state: outcome.state });
    case 'exact-scope-empty':
      return Object.freeze({ state: 'exact-scope-empty' as const, receipt: outcome });
    case 'timeout':
    case 'control-loss':
    case 'authority-unavailable':
    case 'authority-uncertain':
    case 'identity-drift':
    case 'event-gap':
      return Object.freeze({ state: outcome.state });
    default:
      return Object.freeze({ state: 'event-gap' as const });
  }
}

function createManagementExactTeacherAttemptModule(input: Readonly<{
  host: SessionHost;
  exactTeacherHost?: SessionHost;
  exactTeacherAuthorityPolicy?: ExactTeacherAuthorityPolicy;
  exactTeacherAttemptCommitter?: ExactTeacherAttemptPhaseCommitter;
  workspaceObserver?: (cwd: string) => string;
  hostPlatform: string;
  storeRoot: string;
  producerFor: TrustedCompletionProducerResolver;
  reservationRegistry?: WorkspaceReservationRegistry;
}>): ExactTeacherAttemptModule {
  const runtimeFor = (
    context: ManagementExactTeacherAttemptContext
  ): RuntimeContext => {
    context.runtime ??= openStoredRuntimeContext({
      storeRoot: input.storeRoot,
      runId: context.record.runId,
      sourceSessionHost: input.host,
      ...(input.reservationRegistry === undefined
        ? {}
        : { reservationRegistry: input.reservationRegistry }),
      verifyHostedTurnReceipt: (receipt) =>
        input.host.verifyTurnReceipt(receipt) ||
        (input.exactTeacherHost?.verifyTurnReceipt(receipt) ?? false),
    });
    return context.runtime;
  };

  const providerPublication = async (
    attempt: ExactTeacherResolvedAttempt,
    snapshot: ExactTeacherAttemptRecoverySnapshot
  ): Promise<ExactTeacherProviderPublicationFact> => {
    const preparedIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
      'authority-prepared-inert'
    );
    const phaseIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
      snapshot.journal.phase
    );
    const context = managementExactTeacherContext(attempt);
    if (
      context.authority.state !== 'available'
    ) {
      return Object.freeze({ state: 'authority-uncertain' });
    }
    if (!sameExactTeacherProvider(
      snapshot.journal.provider,
      context.authority.selection
    )) {
      return Object.freeze({ state: 'event-gap' });
    }
    if (phaseIndex < preparedIndex) return Object.freeze({ state: 'absent' });
    if (snapshot.journal.processRef === undefined) {
      return Object.freeze({ state: 'event-gap' });
    }
    let observation: ProcessAuthorityLifecycleOutcome;
    try {
      observation = await context.authority.lane.coordinator.inspect(
        snapshot.journal.processRef as never
      );
    } catch {
      return Object.freeze({ state: 'authority-uncertain' });
    }
    if (observation.state === 'prepared-inert') {
      return Object.freeze({
        state: 'prepared-inert',
        provider: snapshot.journal.provider,
        processRef: snapshot.journal.processRef,
      });
    }
    if (observation.state === 'exact-scope-empty') {
      return Object.freeze({
        state: 'exact-scope-empty',
        provider: snapshot.journal.provider,
        processRef: snapshot.journal.processRef,
      });
    }
    if (
      observation.state === 'published-inert' ||
      observation.state === 'live' ||
      observation.state === 'root-exited'
    ) {
      return Object.freeze({
        state: 'published-inert',
        provider: snapshot.journal.provider,
        processRef: snapshot.journal.processRef,
      });
    }
    return Object.freeze({ state: 'authority-uncertain' });
  };

  const replayDurableSettledResult = async (
    attempt: ExactTeacherResolvedAttempt,
    state: ExactTeacherAttemptRecoveryState
  ): Promise<
    | {
        readonly state: 'settled';
        readonly result: string;
        readonly quarantineIdentity: string;
        readonly hostedReceipt: Readonly<{
          stableSessionId: string;
          requestId: string;
          resultRef: string;
          resultDigest: string;
        }>;
      }
    | { readonly state: 'retained'; readonly reason: string }
  > => {
    const context = managementExactTeacherContext(attempt);
    const request = matchingRecoveryRequest(state);
    if (request?.state !== 'settled') {
      return Object.freeze({
        state: 'retained',
        reason: 'durable-request-result-not-settled',
      });
    }
    if (input.exactTeacherHost === undefined) {
      return Object.freeze({ state: 'retained', reason: 'exact-host-unavailable' });
    }
    const outcome = await input.exactTeacherHost.dispatch({
      op: 'execute',
      requestId: attempt.requestId,
      sessionId: attempt.stableSessionId,
      backend: context.seam.backend,
      cwd: context.seam.cwd,
      input: canonicalJson(context.action.agent.input),
      limits: context.seam.limits,
      sandbox: context.action.agent.sandbox as 'read-only',
      authority: {
        invocationId: context.action.invocationId,
        role: context.action.agent.role,
        workspaceInstanceId: context.record.workspaceInstanceId,
        backend: 'hosted',
      },
      exactTeacherAttempt: {
        mode: 'send-prepared',
        seed: managementExactTeacherSeed(attempt),
      },
    });
    if (
      !outcome.ok ||
      outcome.receipt === undefined ||
      outcome.receipt.requestState !== 'settled' ||
      outcome.result === undefined ||
      outcome.resultRef === undefined ||
      outcome.resultDigest === undefined
    ) {
      return Object.freeze({
        state: 'retained',
        reason: outcome.ok ? 'durable-settled-result-incomplete' : outcome.message,
      });
    }
    const digest = createHash('sha256')
      .update(outcome.result, 'utf8')
      .digest('hex');
    if (
      digest !== outcome.resultDigest ||
      request.resultRef !== outcome.resultRef ||
      request.resultDigest !== outcome.resultDigest ||
      outcome.receipt.stableSessionId !== attempt.stableSessionId ||
      outcome.receipt.requestId !== attempt.requestId ||
      input.exactTeacherHost.verifyTurnReceipt(outcome.receipt) !== true
    ) {
      return Object.freeze({
        state: 'retained',
        reason: 'durable-settled-result-identity-mismatch',
      });
    }
    const hostedReceipt = Object.freeze({
      stableSessionId: outcome.receipt.stableSessionId,
      requestId: outcome.receipt.requestId,
      resultRef: outcome.resultRef,
      resultDigest: outcome.resultDigest,
    });
    if (
      state.journal.hostedReceipt !== undefined &&
      JSON.stringify(state.journal.hostedReceipt) !== JSON.stringify(hostedReceipt)
    ) {
      return Object.freeze({
        state: 'retained',
        reason: 'durable-hosted-receipt-identity-mismatch',
      });
    }
    const quarantineIdentity = `quarantine:sha256:${digest}`;
    if (
      state.journal.quarantineIdentity !== undefined &&
      state.journal.quarantineIdentity !== quarantineIdentity
    ) {
      return Object.freeze({
        state: 'retained',
        reason: 'durable-quarantine-identity-mismatch',
      });
    }
    context.receipt = outcome.receipt;
    context.rawResult = outcome.result;
    return Object.freeze({
      state: 'settled',
      result: outcome.result,
      quarantineIdentity,
      hostedReceipt,
    });
  };

  const reconcilePersistedAuthority = async (
    attempt: ExactTeacherResolvedAttempt,
    state: ExactTeacherAttemptRecoveryState,
    reason: string
  ): Promise<ExactTeacherAuthorityRecoveryDisposition> => {
    const context = managementExactTeacherContext(attempt);
    if (
      context.authority.state !== 'available' ||
      state.journal.processRef === undefined ||
      !sameExactTeacherProvider(
        state.journal.provider,
        context.authority.selection
      )
    ) {
      return classifyExactTeacherAuthorityRecovery({
        persisted: { state: 'journal-malformed' },
        observation: { state: 'authority-uncertain' },
      });
    }
    const persisted = Object.freeze({
      state: 'available' as const,
      provider: state.journal.provider,
      processRef: state.journal.processRef,
    });
    let observed: ProcessAuthorityLifecycleOutcome;
    try {
      observed = await context.authority.lane.coordinator.inspect(
        state.journal.processRef as never
      );
    } catch {
      return classifyExactTeacherAuthorityRecovery({
        persisted,
        observation: { state: 'control-loss' },
      });
    }
    let disposition = classifyExactTeacherAuthorityRecovery({
      persisted,
      observation: exactTeacherRecoveryObservation(observed),
    });
    if (disposition.state !== 'recover') return disposition;
    let controlled: ProcessAuthorityLifecycleOutcome;
    try {
      controlled = await context.authority.lane.coordinator.terminate(
        state.journal.processRef as never,
        { reason, graceMs: 5_000 }
      );
    } catch {
      return classifyExactTeacherAuthorityRecovery({
        persisted,
        observation: { state: 'control-loss' },
      });
    }
    disposition = classifyExactTeacherAuthorityRecovery({
      persisted,
      observation: exactTeacherRecoveryObservation(controlled),
    });
    return disposition;
  };

  const callbacks: ExactTeacherAttemptModuleOptions = {
    async resolveCanonicalAttempt(locator) {
      const record = loadHeadRecord(input.storeRoot, locator.runRef.runId);
      if (
        record === null ||
        record.change.changeId !== locator.runRef.change.changeId ||
        record.recordVersion !== locator.expectedRecordVersion
      ) {
        throw new Error('Exact Teacher canonical locator is stale or unavailable.');
      }
      const committed = record.actions[locator.teacherActionId];
      const action = committed?.action;
      const consultation = Object.values(record.consultations ?? {}).find(
        (candidate) => candidate.teacher.actionId === locator.teacherActionId
      );
      const activeAttempt =
        committed?.state === 'active' && consultation?.state === 'teacher-active';
      const durableAttempt =
        !activeAttempt && action?.kind === 'agent'
          ? input.exactTeacherAttemptCommitter?.load(action.attemptId)
          : undefined;
      if (
        (!activeAttempt && durableAttempt === undefined) ||
        action?.kind !== 'agent' ||
        consultation === undefined ||
        consultation.teacher.attemptId !== action.attemptId
      ) {
        throw new Error('Exact Teacher locator does not resolve the active canonical attempt.');
      }
      const seam = sourceHostedSeam(input.host, record, consultation.consultationId);
      if (!seam.ok) throw new Error(seam.message);
      const authority = input.exactTeacherAuthorityPolicy?.resolve() ?? Object.freeze({
        state: 'authority-unavailable' as const,
        platform: input.hostPlatform,
        reason: 'provider-unavailable' as const,
        diagnostic: 'No server-owned exact Teacher authority policy is configured.',
      });
      const requestId = deriveFreshStepRequestId(
        record.runId,
        action.actionId as never,
        action.attemptId as never
      );
      const context: ManagementExactTeacherAttemptContext = {
        locator,
        record,
        action,
        consultationId: consultation.consultationId,
        seam: seam.seam,
        authority,
      };
      return Object.freeze({
        attemptId: action.attemptId,
        runId: record.runId,
        actionId: action.actionId,
        invocationId: action.invocationId,
        attempt: consultation.teacher.attemptOrdinal,
        stableSessionId: requestId,
        requestId,
        ...(authority.state === 'available'
          ? { provider: authority.selection }
          : {}),
        canonicalContext: context,
      });
    },
    async commitPhase(attempt, phase, facts) {
      if (
        input.exactTeacherAttemptCommitter === undefined ||
        attempt.provider === undefined
      ) {
        return;
      }
      await input.exactTeacherAttemptCommitter.commit(
        managementExactTeacherSeed(attempt),
        phase,
        facts === undefined
          ? undefined
          : {
              ...(facts.processRef === undefined
                ? {}
                : { processRef: facts.processRef }),
              ...(facts.baselineIdentity === undefined
                ? {}
                : { baselineIdentity: facts.baselineIdentity }),
              ...(facts.hostedReceipt === undefined
                ? {}
                : { hostedReceipt: facts.hostedReceipt }),
              ...(facts.quarantineIdentity === undefined
                ? {}
                : { quarantineIdentity: facts.quarantineIdentity }),
            }
      );
    },
    async captureBaseline(attempt) {
      return Object.freeze({ identity: (input.workspaceObserver ?? observeWorkspace)(
        managementExactTeacherContext(attempt).seam.cwd
      ) });
    },
    async prepareAuthority(attempt) {
      const context = managementExactTeacherContext(attempt);
      if (context.authority.state === 'authority-unavailable') {
        return Object.freeze({
          state: 'authority-unavailable' as const,
          reason: context.authority.diagnostic,
        });
      }
      if (input.exactTeacherHost === undefined) {
        return Object.freeze({
          state: 'authority-unavailable' as const,
          reason: 'Exact Teacher SessionHost assembly is unavailable.',
        });
      }
      if (input.exactTeacherAttemptCommitter === undefined) {
        return Object.freeze({
          state: 'authority-unavailable' as const,
          reason: 'Exact Teacher durable attempt persistence is unavailable.',
        });
      }
      const seed = managementExactTeacherSeed(attempt);
      const prepared = await input.exactTeacherHost.dispatch({
        op: 'execute',
        requestId: attempt.requestId,
        newSessionId: attempt.stableSessionId,
        backend: context.seam.backend,
        cwd: context.seam.cwd,
        input: canonicalJson(context.action.agent.input),
        limits: context.seam.limits,
        sandbox: context.action.agent.sandbox as 'read-only',
        authority: {
          invocationId: context.action.invocationId,
          role: context.action.agent.role,
          workspaceInstanceId: context.record.workspaceInstanceId,
          backend: 'hosted',
        },
        exactTeacherAttempt: { mode: 'prepare-only', seed },
      });
      if (!prepared.ok) {
        const durable = input.exactTeacherAttemptCommitter.load(attempt.attemptId);
        if (durable !== undefined) {
          return Object.freeze({
            state: 'retained' as const,
            reason: prepared.message,
          });
        }
        return Object.freeze({
          state: 'authority-unavailable' as const,
          reason: prepared.message,
        });
      }
      const durable = input.exactTeacherAttemptCommitter.load(attempt.attemptId);
      if (durable === undefined || durable.phase !== 'activated') {
        return Object.freeze({
          state: 'retained' as const,
          reason: 'Exact Teacher authority activation was not durably journaled.',
        });
      }
      return Object.freeze({
        state: 'prepared-inert' as const,
        processRef: durable.processRef,
        provider: context.authority.selection,
        authority: context.authority.lane,
      });
    },
    async publishAuthority(_attempt, prepared) {
      return Object.freeze({
        state: 'published-inert' as const,
        processRef: prepared.processRef,
        ...(prepared.provider === undefined ? {} : { provider: prepared.provider }),
        authority: prepared.authority,
      });
    },
    async activateAuthority(_attempt, published) {
      return Object.freeze({
        state: 'activated' as const,
        processRef: published.processRef,
        ...(published.provider === undefined ? {} : { provider: published.provider }),
        authority: published.authority,
      });
    },
    async executeOnce(attempt) {
      const context = managementExactTeacherContext(attempt);
      const record = loadHeadRecord(input.storeRoot, context.record.runId);
      if (
        record === null ||
        record.recordVersion !== context.locator.expectedRecordVersion
      ) {
        return Object.freeze({ state: 'retained' as const, reason: 'canonical-frontier-mismatch' });
      }
      if (input.exactTeacherHost === undefined) {
        return Object.freeze({ state: 'retained' as const, reason: 'exact-host-unavailable' });
      }
      const outcome = await input.exactTeacherHost.dispatch({
        op: 'execute',
        requestId: attempt.requestId,
        sessionId: attempt.stableSessionId,
        backend: context.seam.backend,
        cwd: context.seam.cwd,
        input: canonicalJson(context.action.agent.input),
        limits: context.seam.limits,
        sandbox: context.action.agent.sandbox as 'read-only',
        authority: {
          invocationId: context.action.invocationId,
          role: context.action.agent.role,
          workspaceInstanceId: record.workspaceInstanceId,
          backend: 'hosted',
        },
        exactTeacherAttempt: {
          mode: 'send-prepared',
          seed: managementExactTeacherSeed(attempt),
        },
      });
      if (
        !outcome.ok ||
        outcome.receipt === undefined ||
        outcome.result === undefined ||
        outcome.resultDigest === undefined ||
        outcome.resultRef === undefined ||
        outcome.receipt.requestState !== 'settled'
      ) {
        return Object.freeze({
          state: 'retained' as const,
          reason: outcome.ok ? 'exact-host-result-incomplete' : outcome.message,
        });
      }
      const hostedReceipt = outcome.receipt;
      const hostedResult = outcome.result;
      const hostedResultRef = outcome.resultRef;
      const hostedResultDigest = outcome.resultDigest;
      context.receipt = hostedReceipt;
      context.rawResult = hostedResult;
      return Object.freeze({
        state: 'settled' as const,
        result: hostedResult,
        hostedReceipt: Object.freeze({
          stableSessionId: hostedReceipt.stableSessionId,
          requestId: hostedReceipt.requestId,
          resultRef: hostedResultRef,
          resultDigest: hostedResultDigest,
        }),
      });
    },
    async quarantineResult(_attempt, settled) {
      return Object.freeze({
        identity: `quarantine:sha256:${createHash('sha256')
          .update(settled.result, 'utf8')
          .digest('hex')}`,
        result: settled.result,
        hostedReceipt: settled.hostedReceipt,
      });
    },
    async verifyHostedReceipt(attempt) {
      const receipt = managementExactTeacherContext(attempt).receipt;
      return receipt !== undefined &&
        input.exactTeacherHost?.verifyTurnReceipt(receipt) === true;
    },
    async retireAuthority(attempt) {
      const context = managementExactTeacherContext(attempt);
      if (input.exactTeacherHost === undefined || context.receipt === undefined) {
        return Object.freeze({ state: 'authority-unavailable' as const });
      }
      const outcome = await input.exactTeacherHost.dispatch({
        op: 'retire',
        sessionId: context.receipt.stableSessionId,
        reason: 'exact-teacher-attempt-settled',
      });
      if (outcome.ok && isExactScopeEmptyReceipt(outcome.exactScopeEmptyReceipt)) {
        return Object.freeze({
          state: 'exact-scope-empty' as const,
          receipt: outcome.exactScopeEmptyReceipt,
        });
      }
      return Object.freeze({
        state: outcome.ok ? 'declared-unproven' as const : 'authority-uncertain' as const,
      });
    },
    classifyAuthorityRecovery({ persisted, observation }) {
      return classifyExactTeacherAuthorityRecovery({ persisted, observation });
    },
    async recoverAuthority(attempt, _authority, operation) {
      const context = managementExactTeacherContext(attempt);
      if (input.exactTeacherHost === undefined || context.receipt === undefined) {
        return Object.freeze({ state: 'authority-unavailable' as const });
      }
      const outcome = await input.exactTeacherHost.dispatch({
        op: 'retire',
        sessionId: context.receipt.stableSessionId,
        reason: `exact-teacher-${operation}`,
      });
      if (outcome.ok && isExactScopeEmptyReceipt(outcome.exactScopeEmptyReceipt)) {
        return Object.freeze({
          state: 'exact-scope-empty' as const,
          receipt: outcome.exactScopeEmptyReceipt,
        });
      }
      return Object.freeze({ state: 'authority-uncertain' as const });
    },
    async releaseSponsoredReservation() {
      // The canonical Facade owns the actual reservation delta. This boundary
      // merely proves the Module reached a release-eligible authority state;
      // settlement below applies the delta atomically with canonical state.
    },
    async captureFinalObservation(attempt, baseline) {
      try {
        const identity = (input.workspaceObserver ?? observeWorkspace)(
          managementExactTeacherContext(attempt).seam.cwd
        );
        return identity === baseline.identity
          ? Object.freeze({ state: 'stable' as const, identity })
          : Object.freeze({
              state: 'failed' as const,
              reason: 'Read-only Teacher workspace mutation was observed.',
            });
      } catch (error) {
        return Object.freeze({
          state: 'failed' as const,
          reason: `Final Teacher workspace observation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    async validateAdvice(attempt, quarantine) {
      const context = managementExactTeacherContext(attempt);
      const record = loadHeadRecord(input.storeRoot, context.record.runId);
      if (record === null) {
        return Object.freeze({ state: 'invalid' as const, reason: 'Canonical Run disappeared.' });
      }
      const consultation = record.consultations?.[context.consultationId];
      if (consultation === undefined) {
        return Object.freeze({ state: 'invalid' as const, reason: 'Canonical consultation disappeared.' });
      }
      try {
        const parsed = JSON.parse(quarantine.result) as unknown;
        const advice = decodeTeacherConsultationAdvice(
          parsed,
          consultation.binding.limits
        );
        if (
          advice.consultationId !== consultation.consultationId ||
          advice.teacherAttempt !== consultation.teacher.attemptOrdinal
        ) {
          throw new Error('Teacher advice correlation does not match the canonical attempt.');
        }
        return Object.freeze({ state: 'valid' as const, advice });
      } catch (error) {
        return Object.freeze({
          state: 'invalid' as const,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async settleAdvice(attempt, advice) {
      const context = managementExactTeacherContext(attempt);
      const runtime = runtimeFor(context);
      const record = runtime.store.load(context.record.runId);
      const producer = await input.producerFor(context.action);
      const raw = context.rawResult;
      if (raw === undefined) throw new Error('Quarantined Teacher result bytes are unavailable.');
      const submission = producer.attestCompletion({
        change: context.locator.runRef.change,
        record,
        action: context.action,
        completion: { kind: 'domain-action-result', status: 'succeeded', result: advice },
        evidenceContent: Buffer.from(raw, 'utf8'),
      });
      runtime.hostEvidenceWriter.publishCompletion(
        submission.completion,
        submission.uploads
      );
      return runtime.facade.complete(submission.completion, {
        deliveryMode: 'grant',
      });
    },
    async settleUnavailable(attempt, reason) {
      const context = managementExactTeacherContext(attempt);
      const runtime = runtimeFor(context);
      const record = runtime.store.load(context.record.runId);
      return runtime.facade.settleConsultationTeacherFailure(
        {
          format: 'teacher-consultation/teacher-failure-settlement/1',
          runId: record.runId,
          consultationId: context.consultationId as never,
          teacherActionId: context.action.actionId as never,
          expectedRecordVersion: record.recordVersion,
          outcome: context.receipt === undefined ? 'authority-unavailable' : 'failed',
          detail: reason.slice(0, 4096) || 'Exact Teacher advice is unavailable.',
          ...(context.receipt === undefined ? {} : { receipt: context.receipt }),
        },
        { deliveryMode: 'grant' }
      );
    },
    async loadRecoveryState(attempt) {
      const snapshot = await input.exactTeacherAttemptCommitter?.loadRecovery(
        attempt.attemptId
      );
      if (snapshot === undefined) return undefined;
      const context = managementExactTeacherContext(attempt);
      const current = loadHeadRecord(input.storeRoot, context.record.runId);
      if (current === null) {
        throw new Error('Exact Teacher canonical Run disappeared during recovery.');
      }
      const consultation = Object.values(current.consultations ?? {}).find(
        (candidate) => candidate.teacher.actionId === attempt.actionId
      );
      const committed = current.actions[attempt.actionId];
      const settlement =
        committed?.state === 'active' && consultation?.state === 'teacher-active'
          ? 'pending' as const
          : 'settled' as const;
      return Object.freeze({
        canonical: Object.freeze({
          attemptId: attempt.attemptId,
          runId: attempt.runId,
          actionId: attempt.actionId,
          invocationId: attempt.invocationId,
          attempt: attempt.attempt,
          stableSessionId: attempt.stableSessionId,
          requestId: attempt.requestId,
          settlement,
        }),
        journal: snapshot.journal,
        ...(snapshot.session === undefined ? {} : { session: snapshot.session }),
        publication: await providerPublication(attempt, snapshot),
      });
    },
    async executeRecoveryOperation(attempt, operation, state) {
      const safeUnavailable = async (reason: string) => {
        await callbacks.releaseSponsoredReservation(attempt);
        const receipt = await callbacks.settleUnavailable(attempt, reason);
        return Object.freeze({
          state: 'settled' as const,
          settlement: Object.freeze({
            state: 'canonical-unavailable-settled' as const,
            reason,
            receipt,
          }),
        });
      };
      const retain = (reason: string) =>
        Object.freeze({ state: 'retained' as const, reason });
      const advance = () => Object.freeze({ state: 'advanced' as const });
      const facts = recoveryPhaseFacts(state);

      switch (operation) {
        case 'capture-stable-baseline': {
          const baseline = await callbacks.captureBaseline(attempt);
          await callbacks.commitPhase(attempt, 'baseline-stable', {
            baselineIdentity: baseline.identity,
          });
          return advance();
        }
        case 'prepare-provider-authority': {
          const prepared = await callbacks.prepareAuthority(attempt);
          if (prepared.state === 'retained') return retain(prepared.reason);
          if (prepared.state === 'authority-unavailable') {
            return safeUnavailable(prepared.reason);
          }
          // The exact SessionHost owns prepare -> publish -> activate and
          // journals each boundary before returning. A durable reread decides
          // which frontier actually landed; the replacement never guesses.
          return advance();
        }
        case 'adopt-durable-publication':
          await callbacks.commitPhase(
            attempt,
            'authority-published-inert',
            facts
          );
          return advance();
        case 'publish-provider-authority': {
          // A replacement has no in-memory PreparedProcessAuthority handle.
          // Reconcile the authenticated opaque reference to exact empty rather
          // than reconstructing publication authority or selecting a provider.
          const disposition = await reconcilePersistedAuthority(
            attempt,
            state,
            'exact-teacher-recovery-before-publication'
          );
          return disposition.state === 'exact-scope-empty'
            ? safeUnavailable('Exact Teacher authority was safely retired before publication recovery.')
            : retain(
                disposition.state === 'retained'
                  ? disposition.reason
                  : 'authority-recovery-incomplete'
              );
        }
        case 'activate-exact-authority': {
          const context = managementExactTeacherContext(attempt);
          if (
            context.authority.state !== 'available' ||
            state.journal.processRef === undefined ||
            !sameExactTeacherProvider(
              state.journal.provider,
              context.authority.selection
            )
          ) {
            return retain('persisted-provider-tuple-unavailable');
          }
          let observed: ProcessAuthorityLifecycleOutcome;
          try {
            observed = await context.authority.lane.coordinator.inspect(
              state.journal.processRef as never
            );
          } catch {
            return retain('control-loss');
          }
          if (observed.state === 'live' || observed.state === 'root-exited') {
            await callbacks.commitPhase(attempt, 'activated', facts);
            return advance();
          }
          if (observed.state === 'exact-scope-empty') {
            return safeUnavailable(
              'Exact Teacher authority reached exact empty before activation recovery.'
            );
          }
          if (observed.state !== 'published-inert') {
            return retain(exactTeacherRecoveryObservation(observed).state);
          }
          const disposition = await reconcilePersistedAuthority(
            attempt,
            state,
            'exact-teacher-recovery-before-activation'
          );
          return disposition.state === 'exact-scope-empty'
            ? safeUnavailable('Exact Teacher authority was safely retired before activation recovery.')
            : retain(
                disposition.state === 'retained'
                  ? disposition.reason
                  : 'authority-recovery-incomplete'
              );
        }
        case 'commit-request-send-intent':
          await callbacks.commitPhase(attempt, 'request-sent', facts);
          return advance();
        case 'reconcile-request-delivery': {
          const request = matchingRecoveryRequest(state);
          if (request?.state === 'prepared') {
            const context = managementExactTeacherContext(attempt);
            if (
              context.authority.state !== 'available' ||
              state.journal.processRef === undefined
            ) {
              return retain('persisted-provider-tuple-unavailable');
            }
            const turn = await callbacks.executeOnce(attempt, {
              state: 'activated',
              processRef: state.journal.processRef,
              provider: state.journal.provider,
              authority: context.authority.lane,
            });
            if (turn.state === 'settled') {
              const quarantine = await callbacks.quarantineResult(attempt, turn);
              await callbacks.commitPhase(attempt, 'result-quarantined', {
                ...facts,
                hostedReceipt: quarantine.hostedReceipt,
                quarantineIdentity: quarantine.identity,
              });
              return advance();
            }
          }
          // A sent or ambiguous request is never written again. It may become
          // unavailable only after the persisted authority proves exact empty.
          const disposition = await reconcilePersistedAuthority(
            attempt,
            state,
            'exact-teacher-ambiguous-request-recovery'
          );
          return disposition.state === 'exact-scope-empty'
            ? safeUnavailable('Exact Teacher request outcome remained unavailable after exact retirement.')
            : retain(
                disposition.state === 'retained'
                  ? disposition.reason
                  : 'authority-recovery-incomplete'
              );
        }
        case 'quarantine-settled-result': {
          const replay = await replayDurableSettledResult(attempt, state);
          if (replay.state === 'retained') return replay;
          await callbacks.commitPhase(attempt, 'result-quarantined', {
            ...facts,
            hostedReceipt: replay.hostedReceipt,
            quarantineIdentity: replay.quarantineIdentity,
          });
          return advance();
        }
        case 'verify-hosted-receipt': {
          const replay = await replayDurableSettledResult(attempt, state);
          if (replay.state === 'retained') return replay;
          if (!(await callbacks.verifyHostedReceipt(attempt, {
            identity: replay.quarantineIdentity,
            result: replay.result,
            hostedReceipt: replay.hostedReceipt,
          }))) {
            return retain('hosted-receipt-mismatch');
          }
          await callbacks.commitPhase(
            attempt,
            'hosted-receipt-verified',
            facts
          );
          return advance();
        }
        case 'commit-retirement-intent':
          await callbacks.commitPhase(attempt, 'retirement-pending', facts);
          return advance();
        case 'reconcile-exact-retirement': {
          const disposition = await reconcilePersistedAuthority(
            attempt,
            state,
            'exact-teacher-replacement-retirement'
          );
          if (disposition.state !== 'exact-scope-empty') {
            return retain(
              disposition.state === 'retained'
                ? disposition.reason
                : 'authority-recovery-incomplete'
            );
          }
          await callbacks.commitPhase(attempt, 'exact-scope-empty', facts);
          await callbacks.releaseSponsoredReservation(attempt);
          return advance();
        }
        case 'capture-final-observation': {
          if (state.journal.baselineIdentity === undefined) {
            return retain('durable-baseline-identity-unavailable');
          }
          const observation = await callbacks.captureFinalObservation(
            attempt,
            { identity: state.journal.baselineIdentity }
          );
          if (observation.state === 'failed') {
            return safeUnavailable(observation.reason);
          }
          await callbacks.commitPhase(
            attempt,
            'final-observation-stable',
            facts
          );
          return advance();
        }
        case 'validate-quarantined-advice': {
          const replay = await replayDurableSettledResult(attempt, state);
          if (replay.state === 'retained') return replay;
          const validation = await callbacks.validateAdvice(attempt, {
            identity: replay.quarantineIdentity,
            result: replay.result,
            hostedReceipt: replay.hostedReceipt,
          });
          if (validation.state === 'invalid') {
            return safeUnavailable(validation.reason);
          }
          managementExactTeacherContext(attempt).validatedAdvice = validation.advice;
          await callbacks.commitPhase(attempt, 'advice-validated', facts);
          return advance();
        }
        case 'settle-canonical-advice': {
          let advice = managementExactTeacherContext(attempt).validatedAdvice;
          if (advice === undefined) {
            const replay = await replayDurableSettledResult(attempt, state);
            if (replay.state === 'retained') return replay;
            const validation = await callbacks.validateAdvice(attempt, {
              identity: replay.quarantineIdentity,
              result: replay.result,
              hostedReceipt: replay.hostedReceipt,
            });
            if (validation.state === 'invalid') {
              return safeUnavailable(validation.reason);
            }
            advice = validation.advice;
          }
          const receipt = await callbacks.settleAdvice(attempt, advice);
          await callbacks.commitPhase(attempt, 'canonical-settled', facts);
          return Object.freeze({
            state: 'settled' as const,
            settlement: Object.freeze({
              state: 'canonical-advice-settled' as const,
              receipt,
            }),
          });
        }
        case 'adopt-canonical-settlement': {
          await callbacks.commitPhase(attempt, 'canonical-settled', facts);
          const context = managementExactTeacherContext(attempt);
          const runtime = runtimeFor(context);
          const record = runtime.store.load(context.record.runId);
          return Object.freeze({
            state: 'settled' as const,
            settlement: Object.freeze({
              state: 'canonical-advice-settled' as const,
              receipt: Object.freeze({
                format: 'change-run-receipt/1' as const,
                disposition: 'idempotent' as const,
                view: projectRunView(record, 'active', runtime.plan),
                actions: Object.freeze([]),
                // A settled Teacher advice receipt admits nothing, so it
                // carries no agent candidates.
                candidates: Object.freeze([]),
              }),
            }),
          });
        }
      }
    },
  };
  return createExactTeacherAttemptModule(callbacks);
}

function consultationBoundExecutor(input: Readonly<{
  host: SessionHost;
  exactTeacherHost?: SessionHost;
  exactTeacherAuthorityPolicy?: ExactTeacherAuthorityPolicy;
  hostPlatform: string;
  initial?: ProductionExecutor;
}>): ProductionExecutor {
  const base =
    input.initial ?? createProductionExecutor({ hostPlatform: input.hostPlatform });
  const rejected = (message: string) =>
    Promise.resolve({
      kind: 'rejected' as const,
      code: 'receipt_conflict' as const,
      message,
    });
  return Object.freeze({
    matrix: base.matrix,
    backends: base.backends,
    dispatch: (options: Parameters<ProductionExecutor['dispatch']>[0]) => {
      const consultation = Object.values(
        options.record.consultations ?? {}
      ).find(
        (candidate) =>
          candidate.teacher.actionId === options.grantedAction.actionId
      );
      if (consultation === undefined) {
        return base.dispatch(options);
      }
      const exactAuthority = input.exactTeacherAuthorityPolicy?.resolve();
      if (exactAuthority?.state === 'authority-unavailable') {
        return Promise.resolve({
          kind: 'authority-unavailable' as const,
          selection: {
            kind: 'authority-unavailable' as const,
            reason: 'hosted-tier-unavailable' as const,
            requested: 'hosted' as const,
            message: exactAuthority.diagnostic,
          },
        });
      }
      if (
        exactAuthority?.state === 'available' &&
        input.exactTeacherHost === undefined
      ) {
        return Promise.resolve({
          kind: 'authority-unavailable' as const,
          selection: {
            kind: 'authority-unavailable' as const,
            reason: 'hosted-tier-unavailable' as const,
            requested: 'hosted' as const,
            message: 'Exact Teacher SessionHost assembly is unavailable.',
          },
        });
      }
      const resolved = sourceHostedSeam(
        input.host,
        options.record,
        consultation.consultationId
      );
      if (!resolved.ok) return rejected(resolved.message);
      let before: string;
      try {
        before = observeWorkspace(resolved.seam.cwd);
      } catch (error) {
        return Promise.resolve({
          kind: 'authority-unavailable' as const,
          selection: {
            kind: 'authority-unavailable' as const,
            reason: 'hosted-tier-unavailable' as const,
            requested: 'hosted' as const,
            message: `Read-only Teacher workspace observation is unavailable before execution: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
      return createProductionExecutor({
        hostPlatform: input.hostPlatform,
        host: input.exactTeacherHost ?? input.host,
        hostedSeamOptions: resolved.seam,
      }).dispatch(options).then((result) => {
        let after: string;
        try {
          after = observeWorkspace(resolved.seam.cwd);
        } catch (error) {
          return result.kind === 'executed'
            ? workspaceObservationFailure(
                result,
                `Read-only Teacher workspace observation failed closed after execution; advice is rejected: ${error instanceof Error ? error.message : String(error)}`
              )
            : result;
        }
        if (after === before || result.kind !== 'executed') return result;
        return workspaceObservationFailure(
          result,
          'Read-only Teacher workspace mutation was observed; advice is rejected.'
        );
      });
    },
    dispatchContinuation: (
      options: Parameters<ProductionExecutor['dispatchContinuation']>[0]
    ) => {
      const resolved = sourceHostedSeam(
        input.host,
        options.record,
        options.grant.consultationId
      );
      if (!resolved.ok) return rejected(resolved.message);
      return createProductionExecutor({
        hostPlatform: input.hostPlatform,
        host: input.host,
        hostedSeamOptions: resolved.seam,
      }).dispatchContinuation(options);
    },
  });
}

/**
 * Handle `POST /api/v1/frozen-action-executor/dispatch`. The body is a
 * {@link FrozenActionDispatchBody}; the URL path carries the changeId + runId
 * (cross-checked against the body's runRef, same as run-control). Loads the head
 * Record read-only, constructs the production executor bound to the daemon's
 * `SessionHost`, dispatches the granted Action, and returns the typed
 * `ExecutionDispatchResult`.
 */
export async function handleFrozenActionDispatch(input: Readonly<{
  host: SessionHost;
  exactTeacherHost?: SessionHost;
  exactTeacherAuthorityPolicy?: ExactTeacherAuthorityPolicy;
  exactTeacherAttemptCommitter?: ExactTeacherAttemptPhaseCommitter;
  exactTeacherAttemptModule?: ExactTeacherAttemptModule;
  hostPlatform: string;
  body: unknown;
  bodyBytes?: number;
  storeRoot?: string;
  producerFor?: TrustedCompletionProducerResolver;
  reservationRegistry?: WorkspaceReservationRegistry;
  /** Server-owned deterministic stability seam; never decoded from the body. */
  workspaceObserver?: (cwd: string) => string;
}>): Promise<FrozenActionDispatchResult> {
  if ((input.bodyBytes ?? 0) > MAX_DISPATCH_BODY_BYTES) {
    return { ok: false, status: 413, code: 'body_too_large', message: 'Dispatch body exceeds the size limit.' };
  }
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return badRequest('bad_request', 'Dispatch body must be a JSON object.');
  }

  const envelope = input.body as {
    runRef?: unknown;
    teacherActionId?: unknown;
    grantedAction?: unknown;
    expectedRecordVersion?: unknown;
    workspaceRevision?: unknown;
    requestedBackend?: unknown;
    explicitDefaultBackend?: unknown;
    turnInput?: unknown;
    hostedSeam?: unknown;
  };

  // --- Decode the runRef (the body's authority; the endpoint is path-flat) ---
  let runRef: ExactChangeRunRef;
  try {
    if (envelope.runRef === null || typeof envelope.runRef !== 'object') {
      throw new Error('runRef must be an object.');
    }
    const ref = envelope.runRef as { change?: { changeId?: unknown }; runId?: unknown };
    if (typeof ref.change?.changeId !== 'string' || typeof ref.runId !== 'string') {
      throw new Error('runRef must carry change.changeId and runId strings.');
    }
    runRef = envelope.runRef as ExactChangeRunRef;
  } catch (err) {
    return badRequest('invalid_run_ref', err instanceof Error ? err.message : String(err));
  }
  const changeId = runRef.change.changeId;
  const runId = runRef.runId;

  if (envelope.teacherActionId !== undefined) {
    const allowed = new Set([
      'runRef',
      'teacherActionId',
      'expectedRecordVersion',
    ]);
    const forbidden = Object.keys(envelope).find((key) => !allowed.has(key));
    if (forbidden !== undefined) {
      return badRequest(
        'external_teacher_authority_field_forbidden',
        `Exact Teacher execution accepts only a canonical locator; field "${forbidden}" is forbidden.`
      );
    }
    if (
      typeof envelope.teacherActionId !== 'string' ||
      envelope.teacherActionId.length === 0
    ) {
      return badRequest(
        'invalid_teacher_action_id',
        'teacherActionId must be a non-empty canonical Action identity.'
      );
    }
    if (
      typeof envelope.expectedRecordVersion !== 'number' ||
      !Number.isSafeInteger(envelope.expectedRecordVersion) ||
      envelope.expectedRecordVersion <= 0
    ) {
      return badRequest(
        'invalid_expected_record_version',
        'expectedRecordVersion must be a positive safe integer.'
      );
    }
    const exactStoreRoot = input.storeRoot ?? (await resolveRunStoreRoot());
    if (exactStoreRoot === null) {
      return {
        ok: false,
        status: 500,
        code: 'run_store_unavailable',
        message: 'Machine data directory is not available.',
      };
    }
    const exactRecord = loadHeadRecord(exactStoreRoot, runId);
    if (
      exactRecord === null ||
      exactRecord.change.changeId !== changeId
    ) {
      return {
        ok: false,
        status: 404,
        code: 'run_not_found',
        message: `No matching Run record found for ${runId}.`,
      };
    }
    const consultation = Object.values(exactRecord.consultations ?? {}).find(
      (candidate) => candidate.teacher.actionId === envelope.teacherActionId
    );
    const committed = exactRecord.actions[envelope.teacherActionId];
    const activeAttempt =
      committed?.state === 'active' && consultation?.state === 'teacher-active';
    const durableAttempt =
      !activeAttempt && committed?.action.kind === 'agent'
        ? input.exactTeacherAttemptCommitter?.load(committed.action.attemptId)
        : undefined;
    if (
      consultation === undefined ||
      committed === undefined ||
      (!activeAttempt && durableAttempt === undefined)
    ) {
      return badRequest(
        'invalid_teacher_attempt_locator',
        'teacherActionId does not address the canonical active or recoverable Teacher attempt.'
      );
    }
    let exactTeacherAttemptModule = input.exactTeacherAttemptModule;
    if (exactTeacherAttemptModule === undefined) {
      if (input.producerFor === undefined) return signerUnavailable();
      exactTeacherAttemptModule = createManagementExactTeacherAttemptModule({
        host: input.host,
        ...(input.exactTeacherHost === undefined
          ? {}
          : { exactTeacherHost: input.exactTeacherHost }),
        ...(input.exactTeacherAuthorityPolicy === undefined
          ? {}
          : { exactTeacherAuthorityPolicy: input.exactTeacherAuthorityPolicy }),
        ...(input.exactTeacherAttemptCommitter === undefined
          ? {}
          : { exactTeacherAttemptCommitter: input.exactTeacherAttemptCommitter }),
        ...(input.workspaceObserver === undefined
          ? {}
          : { workspaceObserver: input.workspaceObserver }),
        hostPlatform: input.hostPlatform,
        storeRoot: exactStoreRoot,
        producerFor: input.producerFor,
        ...(input.reservationRegistry === undefined
          ? {}
          : { reservationRegistry: input.reservationRegistry }),
      });
    }
    try {
      const result = await exactTeacherAttemptModule.executeAndSettle({
        runRef,
        teacherActionId: envelope.teacherActionId,
        expectedRecordVersion: envelope.expectedRecordVersion,
      });
      return {
        ok: true,
        status: 200,
        result: result.state === 'authority-retained'
          ? Object.freeze({
              ...result,
              reason: summarizeExactTeacherRetainedWait(result.reason).reason,
            })
          : result,
      };
    } catch (error) {
      return consultationDriverFailure(error);
    }
  }

  // --- Decode the granted Action + workspace revision through the strict schemas ---
  let grantedAction: RunAction;
  try {
    grantedAction = decodeRunAction(envelope.grantedAction);
  } catch (err) {
    return badRequest('invalid_granted_action', err instanceof Error ? err.message : String(err));
  }
  if (typeof envelope.expectedRecordVersion !== 'number' || !Number.isInteger(envelope.expectedRecordVersion)) {
    return badRequest('invalid_expected_record_version', 'expectedRecordVersion must be an integer.');
  }
  let workspaceRevision: WorkspaceRevision;
  try {
    workspaceRevision = decodeWorkspaceRevision(envelope.workspaceRevision);
  } catch (err) {
    return badRequest('invalid_workspace_revision', err instanceof Error ? err.message : String(err));
  }
  if (typeof envelope.turnInput !== 'string' || envelope.turnInput.length === 0) {
    return badRequest('invalid_turn_input', 'turnInput must be a non-empty string.');
  }
  if (envelope.requestedBackend !== undefined && envelope.requestedBackend !== 'hosted' && envelope.requestedBackend !== 'in-tool') {
    return badRequest('invalid_backend', 'requestedBackend must be "hosted" or "in-tool".');
  }
  // --- Load the head Record read-only (no mutation here) ---
  const storeRoot = input.storeRoot ?? (await resolveRunStoreRoot());
  if (storeRoot === null) {
    return { ok: false, status: 500, code: 'run_store_unavailable', message: 'Machine data directory is not available.' };
  }
  const record = loadHeadRecord(storeRoot, runId);
  if (record === null) {
    return { ok: false, status: 404, code: 'run_not_found', message: `No Run record found for ${runId}.` };
  }
  if (record.change.changeId !== changeId) {
    return { ok: false, status: 404, code: 'run_not_found', message: `Run ${runId} does not belong to change ${changeId}.` };
  }
  const consultationDriven = participatesInConsultation(record, grantedAction);
  const teacherConsultation = Object.values(record.consultations ?? {}).find(
    (consultation) =>
      consultation.teacher.actionId === grantedAction.actionId
  );
  if (teacherConsultation !== undefined && envelope.hostedSeam !== undefined) {
    return badRequest(
      'external_teacher_hosted_seam_forbidden',
      'Teacher cwd/backend/limits are resolved only from the canonical source Session.'
    );
  }
  if (teacherConsultation !== undefined) {
    return badRequest(
      'legacy_teacher_dispatch_forbidden',
      'Teacher work must be addressed only by the canonical exact-attempt locator.'
    );
  }
  if (
    teacherConsultation === undefined &&
    (envelope.hostedSeam === null || typeof envelope.hostedSeam !== 'object')
  ) {
    return badRequest(
      'invalid_hosted_seam',
      'hostedSeam is required only for the initial non-Teacher dispatch.'
    );
  }
  const producerFor = input.producerFor;
  if (consultationDriven && producerFor === undefined) {
    return signerUnavailable();
  }
  let runtime: RuntimeContext | undefined;
  if (consultationDriven) {
    try {
      runtime = openStoredRuntimeContext({
        storeRoot,
        runId: record.runId,
        sourceSessionHost: input.host,
        ...(input.reservationRegistry === undefined
          ? {}
          : { reservationRegistry: input.reservationRegistry }),
        verifyHostedTurnReceipt: (receipt) =>
          input.host.verifyTurnReceipt(receipt) ||
          (input.exactTeacherHost?.verifyTurnReceipt(receipt) ?? false),
      });
    } catch (error) {
      return consultationDriverFailure(error);
    }
  }

  // --- Construct the production executor bound to the daemon's SessionHost + dispatch ---
  const hostedSeam = envelope.hostedSeam as {
    cwd: string;
    backend: string;
    limits: TurnLimits;
  };
  const executeRoutedTurn = createProductionRoutedTurnExecutor({
    cwd: hostedSeam.cwd,
    limits: hostedSeam.limits,
  });
  const hostedSeamOptions = {
    cwd: hostedSeam.cwd,
    backend: hostedSeam.backend,
    limits: hostedSeam.limits,
    executeRoutedTurn,
  } as HostedBackendSeamOptions;
  const initialExecutor =
    teacherConsultation === undefined
      ? createProductionExecutor({
          hostPlatform: input.hostPlatform,
          host: input.host,
          hostedSeamOptions,
        })
      : undefined;
  const executor = consultationDriven
    ? consultationBoundExecutor({
        host: input.host,
        ...(input.exactTeacherHost === undefined
          ? {}
          : { exactTeacherHost: input.exactTeacherHost }),
        ...(input.exactTeacherAuthorityPolicy === undefined
          ? {}
          : { exactTeacherAuthorityPolicy: input.exactTeacherAuthorityPolicy }),
        hostPlatform: input.hostPlatform,
        ...(initialExecutor === undefined ? {} : { initial: initialExecutor }),
      })
    : initialExecutor!;
  const result = await executor.dispatch({
    runRef,
    grantedAction,
    record,
    expectedRecordVersion: envelope.expectedRecordVersion,
    workspaceRevision,
    requestedBackend: envelope.requestedBackend as ExecutionBackendId | undefined,
    explicitDefaultBackend: envelope.explicitDefaultBackend as ExecutionBackendId | undefined,
    // This face does NOT derive turn input server-side. Every Action reaching
    // here keeps its caller-transported prompt, because its committed
    // `agent.turnInput` is what authenticates those bytes. Deriving
    // `canonicalJson(agent.input)` for a consultation-driven Action used to
    // overwrite the eligible SOURCE implementer's LEAD-rendered prompt, which
    // then failed its own binding with `execution_input_mismatch` before any
    // backend and made `CONSULT` unreachable in production.
    //
    // The Teacher arm below is a BACKSTOP, currently unreachable: a granted
    // Teacher is already refused ~95 lines above with
    // `legacy_teacher_dispatch_forbidden` (pinned by
    // `test/core/management-api/frozen-action-executor.test.ts`), so
    // `teacherConsultation` is provably `undefined` here. The Teacher's bytes
    // are actually kept server-derived by `executeOnce` in
    // `createManagementExactTeacherAttemptModule`, which builds
    // `canonicalJson(action.agent.input)` on its own path. Keep this arm so the
    // Decision 13 property survives if that refusal is ever relaxed; do not
    // read it as the control that enforces it today.
    turnInput:
      teacherConsultation !== undefined && grantedAction.kind === 'agent'
        ? canonicalJson(grantedAction.agent.input)
        : envelope.turnInput,
  });

  if (!consultationDriven) {
    return { ok: true, status: 200, result };
  }

  try {
    if (runtime === undefined || producerFor === undefined) {
      return signerUnavailable();
    }
    const driven = await createProductionConsultationDriver({
      runRef,
      runtime,
      executor,
      producerFor,
      exactTeacherAttemptModule: createManagementExactTeacherAttemptModule({
        host: input.host,
        ...(input.exactTeacherHost === undefined
          ? {}
          : { exactTeacherHost: input.exactTeacherHost }),
        ...(input.exactTeacherAuthorityPolicy === undefined
          ? {}
          : { exactTeacherAuthorityPolicy: input.exactTeacherAuthorityPolicy }),
        ...(input.exactTeacherAttemptCommitter === undefined
          ? {}
          : { exactTeacherAttemptCommitter: input.exactTeacherAttemptCommitter }),
        ...(input.workspaceObserver === undefined
          ? {}
          : { workspaceObserver: input.workspaceObserver }),
        hostPlatform: input.hostPlatform,
        storeRoot,
        producerFor,
        ...(input.reservationRegistry === undefined
          ? {}
          : { reservationRegistry: input.reservationRegistry }),
      }),
    }).driveInitial(grantedAction, result);
    return { ok: true, status: 200, result: driven };
  } catch (error) {
    return consultationDriverFailure(error);
  }
}

/**
 * Handle `POST /api/v1/frozen-action-executor/continue`. The daemon loads the
 * current canonical Record, strictly decodes the continuation against the
 * consultation's frozen limits, and drives the same production executor and
 * resident SessionHost as fresh Action dispatch. The client cannot provide
 * continuation text: the executor serializes only `grant.input` after exact
 * Record/Action/Session correlation.
 */
export async function handleFrozenActionContinuation(input: Readonly<{
  host: SessionHost;
  exactTeacherHost?: SessionHost;
  exactTeacherAuthorityPolicy?: ExactTeacherAuthorityPolicy;
  exactTeacherAttemptCommitter?: ExactTeacherAttemptPhaseCommitter;
  hostPlatform: string;
  body: unknown;
  bodyBytes?: number;
  storeRoot?: string;
  producerFor?: TrustedCompletionProducerResolver;
  reservationRegistry?: WorkspaceReservationRegistry;
  /** Server-owned deterministic stability seam; never decoded from the body. */
  workspaceObserver?: (cwd: string) => string;
}>): Promise<FrozenActionDispatchResult> {
  if ((input.bodyBytes ?? 0) > MAX_DISPATCH_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'body_too_large',
      message: 'Continuation body exceeds the size limit.',
    };
  }
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return badRequest('bad_request', 'Continuation body must be a JSON object.');
  }
  const envelope = input.body as {
    runRef?: unknown;
    grant?: unknown;
    requestedBackend?: unknown;
    explicitDefaultBackend?: unknown;
    hostedSeam?: unknown;
  };
  if (
    envelope.runRef === null ||
    typeof envelope.runRef !== 'object' ||
    typeof (envelope.runRef as { change?: { changeId?: unknown } }).change?.changeId !==
      'string' ||
    typeof (envelope.runRef as { runId?: unknown }).runId !== 'string'
  ) {
    return badRequest(
      'invalid_run_ref',
      'runRef must carry change.changeId and runId strings.'
    );
  }
  const runRef = envelope.runRef as ExactChangeRunRef;
  const storeRoot = input.storeRoot ?? (await resolveRunStoreRoot());
  if (storeRoot === null) {
    return {
      ok: false,
      status: 500,
      code: 'run_store_unavailable',
      message: 'Machine data directory is not available.',
    };
  }
  const record = loadHeadRecord(storeRoot, runRef.runId);
  if (
    record === null ||
    record.change.changeId !== runRef.change.changeId
  ) {
    return {
      ok: false,
      status: 404,
      code: 'run_not_found',
      message: `No matching Run record found for ${runRef.runId}.`,
    };
  }
  const rawConsultationId =
    envelope.grant !== null && typeof envelope.grant === 'object'
      ? (envelope.grant as { consultationId?: unknown }).consultationId
      : undefined;
  const consultation =
    typeof rawConsultationId === 'string'
      ? record.consultations?.[rawConsultationId]
      : undefined;
  if (consultation === undefined) {
    return badRequest(
      'invalid_continuation_grant',
      'Continuation grant does not identify a canonical consultation.'
    );
  }
  let grant: AgentContinuationGrant;
  try {
    grant = decodeAgentContinuationGrant(
      envelope.grant,
      consultation.binding.limits
    );
  } catch (error) {
    return badRequest(
      'invalid_continuation_grant',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (
    envelope.requestedBackend !== undefined &&
    envelope.requestedBackend !== 'hosted' &&
    envelope.requestedBackend !== 'in-tool'
  ) {
    return badRequest(
      'invalid_backend',
      'requestedBackend must be "hosted" or "in-tool".'
    );
  }
  if (envelope.hostedSeam !== undefined) {
    return badRequest(
      'external_continuation_hosted_seam_forbidden',
      'Continuation cwd/backend/limits are resolved only from the canonical source Session.'
    );
  }
  const producerFor = input.producerFor;
  if (producerFor === undefined) return signerUnavailable();
  const executor = consultationBoundExecutor({
    host: input.host,
    hostPlatform: input.hostPlatform,
  });
  try {
    const runtime = openStoredRuntimeContext({
      storeRoot,
      runId: record.runId,
      sourceSessionHost: input.host,
      ...(input.reservationRegistry === undefined
        ? {}
        : { reservationRegistry: input.reservationRegistry }),
        verifyHostedTurnReceipt: (receipt) => input.host.verifyTurnReceipt(receipt),
    });
    const driven = await createProductionConsultationDriver({
      runRef,
      runtime,
      executor,
      producerFor,
      exactTeacherAttemptModule: createManagementExactTeacherAttemptModule({
        host: input.host,
        ...(input.exactTeacherHost === undefined
          ? {}
          : { exactTeacherHost: input.exactTeacherHost }),
        ...(input.exactTeacherAuthorityPolicy === undefined
          ? {}
          : { exactTeacherAuthorityPolicy: input.exactTeacherAuthorityPolicy }),
        ...(input.exactTeacherAttemptCommitter === undefined
          ? {}
          : { exactTeacherAttemptCommitter: input.exactTeacherAttemptCommitter }),
        ...(input.workspaceObserver === undefined
          ? {}
          : { workspaceObserver: input.workspaceObserver }),
        hostPlatform: input.hostPlatform,
        storeRoot,
        producerFor,
        ...(input.reservationRegistry === undefined
          ? {}
          : { reservationRegistry: input.reservationRegistry }),
      }),
    }).driveContinuation(grant);
    return { ok: true, status: 200, result: driven };
  } catch (error) {
    return consultationDriverFailure(error);
  }
}
