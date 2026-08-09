import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';

import {
  backendClosureTerminal,
  createAgentSessionBackendRegistry,
  type AgentSessionBackend,
  type AgentSessionTransport,
  type BackendEvent,
  type BackendTermination,
} from './backend.js';
import {
  canTransitionHostedSession,
  sanitizeHostDiagnostic,
  toSessionHostView,
  validateSessionHostCommand,
  type HostedProcessTerminal,
  type HostedRequestRecord,
  type HostedSessionRecord,
  type SessionHost,
  type SessionHostCommand,
  type SessionHostFailureCode,
  type SessionHostFilter,
  type SessionHostOutcome,
  type SessionHostView,
  type TurnLimits,
} from './contracts.js';
import {
  SessionHostRegistryError,
  digestSessionHostText,
  prunedRequestIdMayExist,
  type SessionHostRegistry,
} from './registry.js';
import { reduceBackendTurnEvents, SessionProtocolError } from './protocol.js';
import {
  noSessionHostOwnership,
  type SessionHostOwnership,
  type SessionHostWriterClaim,
} from './ownership.js';
import { createHostedProcessScope } from './process-capsule/hosted-process-scope.js';
import {
  ProcessScopeError,
  asProcessRef,
  declaredUnprovenTerminalLabel,
  receiptAuthorizesRelease,
  type DeclaredUnprovenReceipt,
  type ProcessRef,
  type ProcessScope,
} from './process-scope.js';

export interface CreateSessionHostOptions {
  registry: SessionHostRegistry;
  backends: readonly AgentSessionBackend[];
  uuid?: () => string;
  now?: () => Date;
  ownership?: SessionHostOwnership;
  processScope?: ProcessScope;
}

interface LiveTransport {
  transport: AgentSessionTransport;
  backend: AgentSessionBackend;
  claim: SessionHostWriterClaim;
  closing: boolean;
  released: boolean;
  termination?: Promise<BackendTermination>;
}

class HostOperationError extends Error {
  constructor(
    readonly code: SessionHostFailureCode,
    message: string
  ) {
    super(message);
    this.name = 'HostOperationError';
  }
}

function canonicalDirectory(cwd: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch (error) {
    throw new HostOperationError(
      'cwd-unavailable',
      `Hosted Session working directory is unavailable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}.`
    );
  }
  if (!stat.isDirectory()) {
    throw new HostOperationError(
      'cwd-unavailable',
      'Hosted Session working directory is not a directory.'
    );
  }
  try {
    return fs.realpathSync.native(cwd);
  } catch (error) {
    throw new HostOperationError(
      'cwd-unavailable',
      `Hosted Session working directory cannot be canonicalized: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}.`
    );
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

function latestRequest(
  record: HostedSessionRecord,
  requestId: string
): HostedRequestRecord | undefined {
  return [...record.requests].reverse().find((request) => request.requestId === requestId);
}

function activeRequest(record: HostedSessionRecord): HostedRequestRecord | undefined {
  return [...record.requests]
    .reverse()
    .find((request) => request.state === 'prepared' || request.state === 'sent');
}

function currentGenerationRequest(record: HostedSessionRecord): HostedRequestRecord | undefined {
  return [...record.requests]
    .reverse()
    .find(
      (request) =>
        request.generation === record.generation &&
        (request.state === 'prepared' ||
          request.state === 'sent' ||
          request.state === 'ambiguous')
    );
}

function transition(record: HostedSessionRecord, state: HostedSessionRecord['hostState']): void {
  if (!canTransitionHostedSession(record.hostState, state)) {
    throw new HostOperationError(
      'session-failed',
      `Invalid hosted Session transition ${record.hostState} -> ${state}.`
    );
  }
  record.hostState = state;
}

function mapFailure(error: unknown): { code: SessionHostFailureCode; message: string } {
  if (error instanceof HostOperationError) return error;
  if (error instanceof SessionProtocolError) {
    return {
      code: error.code.includes('limit') ? 'backend-output-limit' : 'backend-protocol-failed',
      message: error.message,
    };
  }
  if (error instanceof SessionHostRegistryError) {
    const code: SessionHostFailureCode =
      error.code === 'registry-busy'
        ? 'registry-busy'
        : error.code === 'stale-generation'
          ? 'session-busy'
          : error.code === 'registry-corrupt'
            ? 'registry-corrupt'
            : error.code === 'session-not-found'
              ? 'session-not-found'
              : 'session-failed';
    return { code, message: error.message };
  }
  if (error instanceof ProcessScopeError) {
    const preparation = [
      'containment-unsupported',
      'helper-integrity-failed',
      'containment-prepare-failed',
      'containment-not-established',
      'authority-persist-failed',
      'activation-failed',
    ].includes(error.code);
    return {
      code: preparation ? 'backend-spawn-failed' : 'session-busy',
      message: error.message,
    };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    [
      'session-busy',
      'session-failed',
      'backend-protocol-unsupported',
      'backend-spawn-failed',
      'backend-protocol-failed',
    ].includes((error as { code: string }).code)
  ) {
    return {
      code: (error as { code: SessionHostFailureCode }).code,
      message: error instanceof Error ? error.message : 'Hosted Session backend failed.',
    };
  }
  return {
    code: 'backend-spawn-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function collectTurnEvents(
  stream: AsyncIterable<BackendEvent>,
  limits: TurnLimits
): Promise<BackendEvent[]> {
  const events: BackendEvent[] = [];
  let bytes = 0;
  const initTimeoutMs = limits.initTimeoutMs ?? limits.timeoutMs;
  const noOutputTimeoutMs = limits.noOutputTimeoutMs ?? limits.timeoutMs;
  const overallTimeoutMs = limits.overallTimeoutMs ?? limits.timeoutMs;
  let initTimer: NodeJS.Timeout | undefined;
  let inactivityTimer: NodeJS.Timeout | undefined;
  let overallTimer: NodeJS.Timeout | undefined;
  let settled = false;
  let rejectClock!: (error: HostOperationError) => void;
  const clockFailure = new Promise<never>((_, reject) => {
    rejectClock = reject;
  });
  const failClock = (message: string) => {
    if (!settled) rejectClock(new HostOperationError('backend-timeout', message));
  };
  const armInactivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(
      () => failClock(`Backend turn produced no output for ${noOutputTimeoutMs}ms.`),
      noOutputTimeoutMs
    );
    inactivityTimer.unref?.();
  };
  initTimer = setTimeout(
    () => failClock(`Backend turn initialization exceeded ${initTimeoutMs}ms.`),
    initTimeoutMs
  );
  initTimer.unref?.();
  overallTimer = setTimeout(
    () => failClock(`Backend turn overall time exceeded ${overallTimeoutMs}ms.`),
    overallTimeoutMs
  );
  overallTimer.unref?.();
  armInactivity();
  const iterator = stream[Symbol.asyncIterator]();
  const read = (async () => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const event = next.value;
      bytes += Buffer.byteLength(JSON.stringify(event), 'utf8');
      if (bytes > limits.maxOutputBytes) {
        throw new HostOperationError(
          'backend-output-limit',
          `Backend turn exceeded ${limits.maxOutputBytes} output bytes.`
        );
      }
      events.push(event);
      if (event.type === 'init' && initTimer) {
        clearTimeout(initTimer);
        initTimer = undefined;
      }
      armInactivity();
    }
    return events;
  })();
  try {
    return await Promise.race([read, clockFailure]);
  } finally {
    settled = true;
    if (initTimer) clearTimeout(initTimer);
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (overallTimer) clearTimeout(overallTimer);
    void iterator.return?.().catch(() => undefined);
  }
}

async function awaitTurnAcceptance(
  accepted: Promise<void>,
  overallDeadline: number,
  overallTimeoutMs: number
): Promise<void> {
  const remainingMs = Math.max(0, overallDeadline - Date.now());
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HostOperationError(
        'backend-timeout',
        `Backend turn overall time exceeded ${overallTimeoutMs}ms while awaiting stdin acceptance.`
      ));
    }, remainingMs);
    timer.unref?.();
  });
  try {
    await Promise.race([accepted, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createSessionHost(options: CreateSessionHostOptions): SessionHost {
  const registry = options.registry;
  const backends = createAgentSessionBackendRegistry(options.backends);
  const uuid = options.uuid ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const ownership = options.ownership ?? noSessionHostOwnership;
  const processScope = options.processScope ?? createHostedProcessScope();
  const transports = new Map<string, LiveTransport>();
  const retainedPrepared = new Map<
    string,
    { sessionId: string; prepared: Awaited<ReturnType<AgentSessionBackend['prepare']>>; claim: SessionHostWriterClaim }
  >();
  const inFlightOpens = new Map<Promise<void>, AbortController>();
  const activeSessions = new Set<string>();
  const cancelledSessions = new Set<string>();
  const ephemeralResults = new Map<string, string>();
  const pendingTerminals = new Map<string, HostedProcessTerminal>();
  let ready = false;
  let draining = false;

  const timestamp = () => now().toISOString();
  const expected = (record: HostedSessionRecord) => ({
    generation: record.generation,
    revision: record.revision ?? 0,
  });
  async function updateLatest(
    sessionId: string,
    mutate: (current: HostedSessionRecord) => HostedSessionRecord,
    attempts = 4
  ): Promise<HostedSessionRecord> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const latest = registry.get(sessionId);
      if (!latest) {
        throw new SessionHostRegistryError('session-not-found', `Hosted Session ${sessionId} does not exist.`);
      }
      try {
        return await registry.update(sessionId, expected(latest), mutate);
      } catch (error) {
        if (!(error instanceof SessionHostRegistryError) || error.code !== 'stale-generation' || attempt + 1 >= attempts) {
          throw error;
        }
      }
    }
    throw new HostOperationError('session-busy', 'Hosted Session lifecycle remained contended.');
  }

  function inspect(sessionId: string): SessionHostView | undefined {
    const record = registry.get(sessionId);
    return record ? toSessionHostView(record) : undefined;
  }

  function list(filter?: SessionHostFilter): SessionHostView[] {
    return registry
      .list()
      .filter((record) => !filter?.backend || record.backend === filter.backend)
      .filter((record) => !filter?.state || record.hostState === filter.state)
      .map(toSessionHostView);
  }

  function failure(
    op: SessionHostCommand['op'],
    code: SessionHostFailureCode,
    message: string,
    record?: HostedSessionRecord,
    requestId?: string
  ): SessionHostOutcome {
    return {
      ok: false,
      op,
      code,
      message: sanitizeHostDiagnostic(message, 1024),
      ...(record ? { session: toSessionHostView(record) } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }

  async function persistFailure(
    record: HostedSessionRecord,
    requestId: string,
    error: unknown,
    sent: boolean
  ): Promise<HostedSessionRecord> {
    const mapped = mapFailure(error);
    try {
      const latest = registry.get(record.sessionId) ?? record;
      return await registry.update(latest.sessionId, expected(latest), (current) => {
        const request = latestRequest(current, requestId);
        if (!request || (request.state !== 'prepared' && request.state !== 'sent')) return current;
        request.state = sent ? 'ambiguous' : 'cancelled';
        request.diagnostic = mapped.code;
        if (!transports.has(current.sessionId)) current.process = undefined;
        current.updatedAt = timestamp();
        if (current.hostState === 'retired' || current.hostState === 'retiring') {
          return current;
        }
        current.recoveryReason = mapped.code;
        current.hostState = sent ? 'interrupted' : 'failed';
        return current;
      });
    } catch {
      return registry.get(record.sessionId) ?? record;
    }
  }

  async function markCloseUnobserved(
    sessionId: string,
    reason: string
  ): Promise<HostedSessionRecord | undefined> {
    return updateLatest(sessionId, (current) => {
      const request = currentGenerationRequest(current);
      if (request && (request.state === 'prepared' || request.state === 'sent')) {
        request.state = request.state === 'sent' ? 'ambiguous' : 'cancelled';
        request.diagnostic = reason;
      }
      if (current.hostState !== 'retired' && current.hostState !== 'retiring') {
        current.hostState = current.backendSessionId ? 'interrupted' : 'failed';
        current.recoveryReason = reason;
      }
      current.updatedAt = timestamp();
      return current;
    }).catch(() => registry.get(sessionId));
  }

  async function openTransport(
    backend: AgentSessionBackend,
    record: HostedSessionRecord,
    limits: TurnLimits,
    resumeSessionId?: string
  ): Promise<{ transport: AgentSessionTransport; record: HostedSessionRecord }> {
    let finishOpen!: () => void;
    const openFinished = new Promise<void>((resolve) => { finishOpen = resolve; });
    const openController = new AbortController();
    inFlightOpens.set(openFinished, openController);
    let claim: SessionHostWriterClaim | undefined;
    let prepared: Awaited<ReturnType<AgentSessionBackend['prepare']>> | undefined;
    let transport: AgentSessionTransport | undefined;
    let authorityRecord: HostedSessionRecord | undefined;
    let live: LiveTransport | undefined;
    let preparedTermination: Awaited<ReturnType<NonNullable<typeof prepared>['abort']>> | undefined;
    try {
      const acquiredClaim = await ownership.claim(record.sessionId, record.cwd);
      claim = acquiredClaim;
      prepared = await backend.prepare({
        cwd: record.cwd,
        limits,
        signal: openController.signal,
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
      authorityRecord = await registry.update(record.sessionId, expected(record), (current) => {
        current.process = {
          generation: current.generation,
          ownerToken: acquiredClaim.ownerToken,
          runtimeRef: prepared!.runtimeRef,
          ...(prepared!.displayPid ? { displayPid: prepared!.displayPid } : {}),
          preparedAt: timestamp(),
          ...(prepared!.declaration
            ? {
                declaration: {
                  tier: prepared!.declaration.tier,
                  exactCancel: prepared!.declaration.exactCancel,
                  scopeEmptyProof: prepared!.declaration.scopeEmptyProof,
                },
              }
            : {}),
        };
        current.updatedAt = timestamp();
        return current;
      });
      // Acceptance, not decoration: a declared tier's limits must be readable
      // in the Record before activation. If the declaration did not land, the
      // scope is aborted and no workload code runs.
      if (prepared.declaration && !authorityRecord.process?.declaration) {
        preparedTermination = await prepared.abort('declaration-not-recorded').catch(() => ({
          state: 'uncertain' as const,
          gracefulAttempted: false,
          forced: false,
        }));
        throw new ProcessScopeError(
          'authority-persist-failed',
          'Best-effort scope limits were not recorded before activation.',
          undefined,
          'prepare'
        );
      }
      if (openController.signal.aborted || draining) {
        preparedTermination = await prepared.abort('host-shutdown-before-activation').catch(() => ({
          state: 'uncertain' as const,
          gracefulAttempted: false,
          forced: false,
        }));
        if (!receiptAuthorizesRelease(preparedTermination, prepared.declaration !== undefined)) {
          await markCloseUnobserved(record.sessionId, 'shutdown-close-unobserved');
          throw new ProcessScopeError(
            'process-termination-unobserved',
            'Prepared ProcessScope did not prove close during shutdown.'
          );
        }
        throw new HostOperationError('session-busy', 'Hosted Session host began shutdown during process preparation.');
      }
      // This is the sole activation site. The opaque capability is already
      // durably published under generation/revision CAS before backend work.
      transport = await prepared.activate();
      if (transport.runtimeRef !== prepared.runtimeRef) {
        throw new ProcessScopeError(
          'containment-breach',
          'Activated transport replaced its durably published ProcessRef.'
        );
      }
      live = {
        transport,
        backend,
        claim: acquiredClaim,
        closing: false,
        released: false,
      };
      const publishedLive = live;
      transports.set(authorityRecord.sessionId, publishedLive);
      void transport.closed.then(
        (closure) => observeTransportClose(authorityRecord!.sessionId, publishedLive, closure),
        () => observeTransportClose(authorityRecord!.sessionId, publishedLive)
      );
      if (draining) {
        const termination = await closeLive(
          authorityRecord.sessionId,
          publishedLive,
          'host-shutdown-during-open'
        ).catch(() => ({ closed: false, cancelledBeforeWork: false }));
        if (!termination.closed) {
          publishedLive.closing = false;
          await markCloseUnobserved(
            authorityRecord.sessionId,
            'shutdown-close-unobserved'
          );
          throw new HostOperationError(
            'session-busy',
            'Hosted Session shutdown could not observe the late-open process close; exact authority is retained.'
          );
        }
        throw new HostOperationError(
          'session-busy',
          'Hosted Session host began shutdown while backend admission was in progress.'
        );
      }
      return { transport, record: authorityRecord };
    } catch (error) {
      const retainedLive = live && transports.get(record.sessionId) === live && !live.released;
      if (transport && !live?.released && !retainedLive) {
        const termination = await transport.terminate('ownership-bind-failed').catch(
          () => ({ closed: false, cancelledBeforeWork: false })
        );
        if (!termination.closed && claim && authorityRecord) {
          live = {
            transport,
            backend,
            claim,
            closing: false,
            released: false,
          };
          transports.set(record.sessionId, live);
          void transport.closed.then(
            (closure) => observeTransportClose(record.sessionId, live!, closure),
            () => observeTransportClose(record.sessionId, live!)
          );
          await markCloseUnobserved(record.sessionId, 'process-close-unobserved');
        }
      } else if (prepared && !transport) {
        preparedTermination ??= await prepared.abort(
          authorityRecord ? 'activation-failed' : 'authority-persist-failed'
        ).catch(() => ({
          state: 'uncertain' as const,
          gracefulAttempted: false,
          forced: false,
        }));
        if (!receiptAuthorizesRelease(preparedTermination, prepared.declaration !== undefined)) {
          retainedPrepared.set(String(prepared.runtimeRef), {
            sessionId: record.sessionId,
            prepared,
            claim: claim!,
          });
          if (authorityRecord) {
            await markCloseUnobserved(record.sessionId, 'activation-close-unobserved');
          }
        }
      }
      const authorityRetained = Boolean(
        (live && transports.get(record.sessionId) === live && !live.released) ||
        (prepared && retainedPrepared.has(String(prepared.runtimeRef)))
      );
      if (!authorityRetained) await claim?.release();
      const latest = registry.get(record.sessionId);
      if (!authorityRetained && claim && latest?.process?.ownerToken === claim.ownerToken) {
        const claimOwnerToken = claim.ownerToken;
        await registry.update(latest.sessionId, expected(latest), (current) => {
          if (current.process?.ownerToken === claimOwnerToken) current.process = undefined;
          current.updatedAt = timestamp();
          return current;
        }).catch(() => undefined);
      }
      if (authorityRetained && prepared && !transport) {
        throw new ProcessScopeError(
          'process-termination-unobserved',
          'Prepared ProcessScope close was not observed; opaque authority is retained.',
          { cause: error }
        );
      }
      throw error;
    } finally {
      inFlightOpens.delete(openFinished);
      finishOpen();
    }
  }

  async function closeLive(
    sessionId: string,
    live: LiveTransport,
    reason: string
  ) {
    if (live.termination) return live.termination;
    live.closing = true;
    const attempt = (async () => {
      try {
        const termination = await live.transport.terminate(reason);
        if (!termination.closed) {
          live.closing = false;
          live.termination = undefined;
          return termination;
        }
        // The live-close route is the production-normal one: cancelling a
        // RUNNING declared session must leave the honest terminal on the
        // Record, not only release the scope. Staged like every other close so
        // the caller's own CAS runs against an unbumped record.
        if (termination.unproven) noteProcessTerminal(sessionId, termination.unproven);
        await detachLive(sessionId, live);
        return termination;
      } catch (error) {
        live.closing = false;
        live.termination = undefined;
        throw error;
      }
    })();
    live.termination = attempt;
    return attempt;
  }

  async function detachLive(sessionId: string, live: LiveTransport): Promise<void> {
    if (transports.get(sessionId) === live) transports.delete(sessionId);
    if (!live.released) {
      live.released = true;
      await live.claim.release();
    }
  }

  function toHostedProcessTerminal(receipt: DeclaredUnprovenReceipt): HostedProcessTerminal {
    return {
      outcome: receipt.outcome,
      emptiness: 'unproven',
      label: declaredUnprovenTerminalLabel(receipt.outcome),
      groupObservedEmpty: receipt.groupObservedEmpty,
      forced: receipt.forced,
      recordedAt: timestamp(),
    };
  }

  /**
   * Staged rather than written inline: the close callers hold a pre-close
   * snapshot for their own generation/revision CAS, so the terminal is
   * persisted only after they finish.
   */
  function noteProcessTerminal(sessionId: string, receipt: DeclaredUnprovenReceipt): void {
    pendingTerminals.set(sessionId, toHostedProcessTerminal(receipt));
  }

  async function flushProcessTerminals(): Promise<void> {
    for (const [sessionId, terminal] of [...pendingTerminals]) {
      try {
        await updateLatest(sessionId, (current) => {
          // Permanent: release never rewrites it into a clean or proven outcome.
          current.processTerminal = terminal;
          current.updatedAt = timestamp();
          return current;
        });
        // Dropped only after the write landed. Deleting first would lose the
        // terminal permanently and silently on CAS exhaustion - the exact
        // failure class this staging exists to close.
        pendingTerminals.delete(sessionId);
      } catch (error) {
        // A record that no longer exists can never receive its terminal;
        // anything else (contention, a transient write failure) keeps the
        // staged terminal for the next flush.
        if (error instanceof SessionHostRegistryError && error.code === 'session-not-found') {
          pendingTerminals.delete(sessionId);
        }
      }
    }
  }

  async function closeDurableProcess(
    record: HostedSessionRecord,
    reason: string
  ): Promise<'closed' | 'live-or-uncertain'> {
    const facts = record.process;
    if (!facts) return 'closed';
    const ref = asProcessRef(facts.runtimeRef);
    // Declaration-gated release. The pre-start declaration on the Record is the
    // sole authority for releasing from a declared-unproven terminal; an
    // undeclared scope keeps the exact rule and fails closed.
    const declared = facts.declaration !== undefined;
    const observation = await processScope.inspect(ref);
    if (observation.state === 'foreign' || observation.state === 'uncertain') {
      return 'live-or-uncertain';
    }
    if (observation.state === 'declared-unproven') {
      if (!declared) return 'live-or-uncertain';
      noteProcessTerminal(record.sessionId, observation.terminal);
    }
    if (observation.controllable) {
      const receipt = await processScope.terminate(ref, { reason, graceMs: 5_000 });
      if (!receiptAuthorizesRelease(receipt, declared)) return 'live-or-uncertain';
      if (receipt.state === 'declared-unproven' && receipt.unproven) {
        noteProcessTerminal(record.sessionId, receipt.unproven);
      }
    }
    const localPrepared = retainedPrepared.get(String(ref));
    if (localPrepared) {
      retainedPrepared.delete(String(ref));
      await localPrepared.claim.release();
    }
    const released = await ownership.reapStaleOwner(record.sessionId, {
      ownerToken: facts.ownerToken,
    });
    return released === 'live-or-uncertain' ? 'live-or-uncertain' : 'closed';
  }

  async function observeTransportClose(
    sessionId: string,
    live: LiveTransport,
    closure?: unknown
  ): Promise<void> {
    if (live.closing || transports.get(sessionId) !== live) return;
    // Natural completion of a declared scope carries its honest terminal on the
    // transport's own close. Written inline rather than staged: this route owns
    // the CAS that clears the process facts, so the terminal lands atomically
    // with them instead of waiting for a flush that no dispatch will run.
    const terminal = backendClosureTerminal(closure);
    await detachLive(sessionId, live).catch(() => undefined);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const record = registry.get(sessionId);
      if (
        !record ||
        record.process?.ownerToken !== live.claim.ownerToken ||
        record.process?.runtimeRef !== live.transport.runtimeRef
      ) {
        return;
      }
      try {
        await registry.update(sessionId, expected(record), (current) => {
          if (
            current.process?.ownerToken !== live.claim.ownerToken ||
            current.process?.runtimeRef !== live.transport.runtimeRef
          ) {
            return current;
          }
          const request = currentGenerationRequest(current);
          // Declaration-gated exactly like every other release: only a scope
          // whose limits were published before the workload started may record
          // a declared-unproven terminal. Undeclared scopes are untouched.
          if (terminal && current.process?.declaration) {
            current.processTerminal = toHostedProcessTerminal(terminal);
          }
          current.process = undefined;
          current.updatedAt = timestamp();
          if (current.hostState === 'retired' || current.hostState === 'retiring') {
            return current;
          }
          if (request && (request.state === 'prepared' || request.state === 'sent')) {
            request.state = request.state === 'sent' ? 'ambiguous' : 'cancelled';
            request.diagnostic = request.state === 'ambiguous'
              ? 'resident-transport-closed-outcome-unknown'
              : 'resident-transport-closed-before-acceptance';
            current.hostState = request.state === 'ambiguous' ? 'interrupted' : 'failed';
            current.recoveryReason = request.diagnostic;
          } else if (current.hostState !== 'failed') {
            current.hostState = 'idle';
            current.recoveryReason = 'resident-transport-closed-exact-resume';
          }
          return current;
        });
        return;
      } catch (error) {
        if (!(error instanceof SessionHostRegistryError) || error.code !== 'stale-generation') return;
      }
    }
  }

  async function execute(command: Extract<SessionHostCommand, { op: 'execute' }>): Promise<SessionHostOutcome> {
    const backend = backends.get(command.backend);
    if (!backend) {
      return failure('execute', 'unsupported-backend', `Unsupported hosted Session backend "${command.backend}".`, undefined, command.requestId);
    }
    let canonicalCwd: string;
    try {
      canonicalCwd = canonicalDirectory(command.cwd);
    } catch (error) {
      const mapped = mapFailure(error);
      return failure('execute', mapped.code, mapped.message, undefined, command.requestId);
    }
    const inputDigest = digestSessionHostText(command.input);
    let record: HostedSessionRecord;
    let transport: AgentSessionTransport;
    let sent = false;

    if (command.sessionId) {
      const existing = registry.get(command.sessionId);
      if (!existing) {
        return failure('execute', 'session-not-found', `Hosted Session ${command.sessionId} was not found.`, undefined, command.requestId);
      }
      if (existing.hostState === 'retired' || existing.hostState === 'retiring') {
        return failure('execute', 'session-retired', 'Hosted Session is permanently retired.', existing, command.requestId);
      }
      if (existing.hostState === 'failed') {
        return failure('execute', 'session-failed', 'Hosted Session has no safe recovery path.', existing, command.requestId);
      }
      if (existing.hostState === 'interrupted') {
        return failure('execute', 'turn-outcome-unknown', 'The previous turn is ambiguous; restart the exact Session before sending new input.', existing, command.requestId);
      }
      if (existing.backend !== command.backend) {
        return failure('execute', 'invalid-input', 'Backend cannot change for an existing hosted Session.', existing, command.requestId);
      }
      if (!samePath(existing.cwd, canonicalCwd)) {
        return failure('execute', 'cwd-mismatch', 'Hosted Session is bound to a different canonical working directory.', existing, command.requestId);
      }
      const prior = latestRequest(existing, command.requestId);
      if (prior) {
        if (prior.inputDigest !== inputDigest) {
          return failure('execute', 'invalid-input', 'requestId was already used for different input.', existing, command.requestId);
        }
        if (prior.state === 'settled') {
          const result = ephemeralResults.get(`${existing.sessionId}:${command.requestId}`);
          return {
            ok: true,
            op: 'execute',
            session: toSessionHostView(existing),
            requestId: command.requestId,
            ...(result ? { result } : {}),
            ...(prior.resultDigest ? { resultDigest: prior.resultDigest } : {}),
            replayed: true,
          };
        }
        if (prior.state === 'prepared' || prior.state === 'sent') {
          return failure('execute', 'session-busy', 'Hosted Session request is already in progress.', existing, command.requestId);
        }
        return failure('execute', 'turn-outcome-unknown', 'The retained request has no safely replayable outcome.', existing, command.requestId);
      }
      if (prunedRequestIdMayExist(existing, command.requestId)) {
        return failure(
          'execute',
          'turn-outcome-unknown',
          'requestId may refer to a pruned terminal request; refusing a second stdin write.',
          existing,
          command.requestId
        );
      }
      if (activeSessions.has(existing.sessionId) || activeRequest(existing)) {
        return failure('execute', 'session-busy', 'Hosted Session already has an unfinished request.', existing, command.requestId);
      }

      const live = transports.get(existing.sessionId);
      if (live) {
        record = await registry.update(existing.sessionId, expected(existing), (current) => {
          transition(current, 'active');
          current.requests.push({
            requestId: command.requestId,
            inputDigest,
            generation: current.generation,
            state: 'prepared',
            preparedAt: timestamp(),
          });
          current.updatedAt = timestamp();
          return current;
        });
        transport = live.transport;
      } else {
        if (!existing.backendSessionId) {
          return failure('execute', 'session-failed', 'Hosted Session has no exact backend resume identity.', existing, command.requestId);
        }
        record = await registry.update(existing.sessionId, expected(existing), (current) => {
          transition(current, 'recovering');
          current.generation += 1;
          current.process = undefined;
          current.requests.push({
            requestId: command.requestId,
            inputDigest,
            generation: current.generation,
            state: 'prepared',
            preparedAt: timestamp(),
          });
          current.updatedAt = timestamp();
          return current;
        });
        try {
          ({ transport, record } = await openTransport(backend, record, command.limits, existing.backendSessionId));
        } catch (error) {
          const failed = await persistFailure(record, command.requestId, error, false);
          const mapped = mapFailure(error);
          return failure('execute', mapped.code, mapped.message, failed, command.requestId);
        }
      }
    } else {
      const sessionId = uuid();
      const createdAt = timestamp();
      record = await registry.create({
        sessionId,
        backend: backend.id,
        ...(backend.version ? { backendVersion: backend.version } : {}),
        cwd: canonicalCwd,
        cwdDigest: digestSessionHostText(canonicalCwd),
        hostState: 'starting',
        generation: 1,
        createdAt,
        updatedAt: createdAt,
        requests: [
          {
            requestId: command.requestId,
            inputDigest,
            generation: 1,
            state: 'prepared',
            preparedAt: createdAt,
          },
        ],
      });
      try {
        ({ transport, record } = await openTransport(backend, record, command.limits));
      } catch (error) {
        const failed = await persistFailure(record, command.requestId, error, false);
        const mapped = mapFailure(error);
        return failure('execute', mapped.code, mapped.message, failed, command.requestId);
      }
    }

    activeSessions.add(record.sessionId);
    try {
      const overallTimeoutMs = command.limits.overallTimeoutMs ?? command.limits.timeoutMs;
      const overallDeadline = Date.now() + overallTimeoutMs;
      const stream = transport.send({
        requestId: command.requestId,
        input: command.input,
        limits: command.limits,
      });
      if (!stream.accepted || typeof stream.accepted.then !== 'function') {
        throw new HostOperationError(
          'backend-protocol-failed',
          'Backend transport omitted mandatory stdin acceptance evidence.'
        );
      }
      await awaitTurnAcceptance(stream.accepted, overallDeadline, overallTimeoutMs);
      record = await registry.update(record.sessionId, expected(record), (current) => {
        const request = latestRequest(current, command.requestId)!;
        request.state = 'sent';
        request.sentAt = timestamp();
        if (current.hostState === 'starting' || current.hostState === 'recovering') {
          current.hostState = 'active';
        }
        if (current.process?.runtimeRef !== transport.runtimeRef) {
          throw new HostOperationError(
            'session-failed',
            'Hosted Session lost its opaque process authority before stdin acceptance.'
          );
        }
        current.updatedAt = timestamp();
        return current;
      });
      sent = true;
      const events = await collectTurnEvents(
        stream,
        command.limits
      );
      if (cancelledSessions.has(record.sessionId)) {
        throw new HostOperationError(
          'turn-outcome-unknown',
          'Hosted Session control interrupted the active generation before settlement.'
        );
      }
      const reduced = reduceBackendTurnEvents(events, {
        expectedBackendSessionId: record.backendSessionId,
        maxDiagnosticBytes: command.limits.maxDiagnosticBytes ?? 1024,
      });
      const resultDigest = digestSessionHostText(reduced.result);
      record = await registry.update(record.sessionId, expected(record), (current) => {
        const request = latestRequest(current, command.requestId)!;
        request.state = 'settled';
        request.settledAt = timestamp();
        request.resultDigest = resultDigest;
        request.resultRef = `host-result:sha256:${resultDigest}`;
        if (reduced.diagnostics) request.diagnostic = 'bounded-backend-diagnostics';
        current.backendSessionId = reduced.backendSessionId;
        current.hostState = 'idle';
        current.updatedAt = timestamp();
        current.recoveryReason = undefined;
        return current;
      });
      ephemeralResults.set(`${record.sessionId}:${command.requestId}`, reduced.result);
      return {
        ok: true,
        op: 'execute',
        session: toSessionHostView(record),
        requestId: command.requestId,
        result: reduced.result,
        resultDigest,
      };
    } catch (error) {
      const live = transports.get(record.sessionId);
      if (live) {
        const termination = await closeLive(record.sessionId, live, 'turn-failed').catch(
          () => ({ closed: false, cancelledBeforeWork: false })
        );
        if (!termination.closed) {
          const interrupted = await registry.update(record.sessionId, expected(record), (current) => {
            const request = latestRequest(current, command.requestId);
            if (request && (request.state === 'prepared' || request.state === 'sent')) {
              request.state = 'ambiguous';
              request.diagnostic = 'process-close-unobserved';
            }
            current.hostState = 'interrupted';
            current.recoveryReason = 'process-close-unobserved';
            current.updatedAt = timestamp();
            return current;
          }).catch(() => registry.get(record.sessionId) ?? record);
          const request = latestRequest(interrupted, command.requestId);
          const mapped = cancelledSessions.has(record.sessionId) &&
            (request?.state === 'sent' || request?.state === 'ambiguous')
            ? {
                code: 'turn-outcome-unknown' as const,
                message: 'Hosted Session control interrupted the active generation before settlement.',
              }
            : mapFailure(error);
          return failure('execute', mapped.code, mapped.message, interrupted, command.requestId);
        }
      }
      const failed = await persistFailure(record, command.requestId, error, sent);
      const request = latestRequest(failed, command.requestId);
      const mapped = cancelledSessions.has(record.sessionId) &&
        (request?.state === 'sent' || request?.state === 'ambiguous')
        ? {
            code: 'turn-outcome-unknown' as const,
            message: 'Hosted Session control interrupted the active generation before settlement.',
          }
        : mapFailure(error);
      return failure('execute', mapped.code, mapped.message, failed, command.requestId);
    } finally {
      activeSessions.delete(record.sessionId);
      cancelledSessions.delete(record.sessionId);
    }
  }

  async function cancel(command: Extract<SessionHostCommand, { op: 'cancel' }>): Promise<SessionHostOutcome> {
    const record = registry.get(command.sessionId);
    if (!record) return failure('cancel', 'session-not-found', 'Hosted Session was not found.');
    if (record.hostState === 'retired') {
      return { ok: true, op: 'cancel', session: toSessionHostView(record) };
    }
    const live = transports.get(record.sessionId);
    if (!live) {
      if (record.process && await closeDurableProcess(record, command.reason) !== 'closed') {
        return failure(
          'cancel',
          'session-busy',
          'Hosted Session has a surviving process-tree owner that this daemon cannot signal safely.',
          record
        );
      }
      const cleaned = record.process
        ? await updateLatest(record.sessionId, (current) => {
            if (current.process?.runtimeRef === record.process?.runtimeRef) current.process = undefined;
            current.updatedAt = timestamp();
            return current;
          })
        : record;
      return { ok: true, op: 'cancel', session: toSessionHostView(cleaned) };
    }
    cancelledSessions.add(record.sessionId);
    let cancelling: HostedSessionRecord;
    try {
      cancelling = await registry.update(record.sessionId, expected(record), (current) => {
        if (current.hostState === 'active') transition(current, 'cancelling');
        current.updatedAt = timestamp();
        return current;
      });
    } catch (error) {
      cancelledSessions.delete(record.sessionId);
      throw error;
    }
    let termination;
    try {
      termination = await closeLive(record.sessionId, live, command.reason);
    } catch (error) {
      const interrupted = await updateLatest(record.sessionId, (current) => {
        if (current.hostState === 'retired' || current.hostState === 'retiring') return current;
        const request = currentGenerationRequest(current);
        if (request) {
          request.state = 'ambiguous';
          request.diagnostic = 'cancel-close-failed';
        }
        current.hostState = 'interrupted';
        current.recoveryReason = 'cancel-close-failed';
        current.updatedAt = timestamp();
        return current;
      }).catch(() => registry.get(record.sessionId) ?? cancelling);
      return failure(
        'cancel',
        'backend-protocol-failed',
        error instanceof Error ? error.message : 'Hosted Session process close failed.',
        interrupted
      );
    }
    if (!termination.closed) {
      const interrupted = await updateLatest(record.sessionId, (current) => {
        if (current.hostState === 'retired' || current.hostState === 'retiring') return current;
        const request = currentGenerationRequest(current);
        if (request) {
          request.state = 'ambiguous';
          request.diagnostic = 'cancel-close-unobserved';
        }
        current.hostState = 'interrupted';
        current.recoveryReason = 'cancel-close-unobserved';
        current.updatedAt = timestamp();
        return current;
      });
      return failure(
        'cancel',
        'session-busy',
        'Hosted Session process-tree close was not observed; exact ownership is retained.',
        interrupted
      );
    }
    cancelling = await updateLatest(record.sessionId, (current) => {
      if (current.hostState === 'retired' || current.hostState === 'retiring') return current;
      const request = currentGenerationRequest(current);
      if (request) request.state = termination.cancelledBeforeWork ? 'cancelled' : 'ambiguous';
      current.process = undefined;
      current.hostState = request && !termination.cancelledBeforeWork ? 'interrupted' : 'idle';
      current.recoveryReason = request && !termination.cancelledBeforeWork ? 'cancelled-outcome-unknown' : undefined;
      current.updatedAt = timestamp();
      return current;
    });
    if (!activeSessions.has(record.sessionId)) cancelledSessions.delete(record.sessionId);
    return { ok: true, op: 'cancel', session: toSessionHostView(cancelling) };
  }

  async function restart(command: Extract<SessionHostCommand, { op: 'restart' }>): Promise<SessionHostOutcome> {
    const record = registry.get(command.sessionId);
    if (!record) return failure('restart', 'session-not-found', 'Hosted Session was not found.');
    if (record.hostState === 'retired' || record.hostState === 'retiring') {
      return failure('restart', 'session-retired', 'Hosted Session is permanently retired.', record);
    }
    if (activeSessions.has(record.sessionId) || transports.has(record.sessionId)) {
      return failure('restart', 'session-busy', 'Hosted Session still has a live owner.', record);
    }
    if (record.process && await closeDurableProcess(record, 'restart-stale-scope') !== 'closed') {
      return failure(
        'restart',
        'session-busy',
        'Hosted Session has a surviving or uncertain process-tree owner.',
        record
      );
    }
    if (!record.backendSessionId) {
      return failure('restart', 'session-failed', 'Hosted Session has no exact backend resume identity.', record);
    }
    const backend = backends.get(record.backend);
    if (!backend) return failure('restart', 'unsupported-backend', 'Hosted Session backend is unavailable.', record);
    try {
      canonicalDirectory(record.cwd);
      let recovering = await registry.update(record.sessionId, expected(record), (current) => {
        if (current.hostState === 'idle') transition(current, 'recovering');
        else if (current.hostState === 'interrupted') transition(current, 'recovering');
        else throw new HostOperationError('session-busy', `Cannot restart Session from ${current.hostState}.`);
        current.generation += 1;
        current.process = undefined;
        current.updatedAt = timestamp();
        return current;
      });
      const opened = await openTransport(backend, recovering, {
        timeoutMs: 30_000,
        maxInputBytes: 2 * 1024 * 1024,
        maxOutputBytes: 256 * 1024,
      }, record.backendSessionId);
      const transport = opened.transport;
      recovering = opened.record;
      recovering = await registry.update(record.sessionId, expected(recovering), (current) => {
        transition(current, 'idle');
        if (current.process?.runtimeRef !== transport.runtimeRef) {
          throw new HostOperationError(
            'session-failed',
            'Hosted Session lost its opaque process authority during restart.'
          );
        }
        current.recoveryReason = undefined;
        current.updatedAt = timestamp();
        return current;
      });
      return { ok: true, op: 'restart', session: toSessionHostView(recovering) };
    } catch (error) {
      const mapped = mapFailure(error);
      const live = transports.get(record.sessionId);
      const termination = live
        ? await closeLive(record.sessionId, live, 'restart-failed').catch(
            () => ({ closed: false, cancelledBeforeWork: false })
          )
        : { closed: true, cancelledBeforeWork: false };
      const latest = registry.get(record.sessionId) ?? record;
      const recovered = latest.hostState === 'recovering'
        ? await registry.update(latest.sessionId, expected(latest), (current) => {
            current.hostState = 'interrupted';
            if (termination.closed) current.process = undefined;
            current.recoveryReason = termination.closed ? mapped.code : 'restart-close-unobserved';
            current.updatedAt = timestamp();
            return current;
          }).catch(() => registry.get(record.sessionId) ?? latest)
        : latest;
      return failure('restart', mapped.code, mapped.message, recovered);
    }
  }

  async function retire(command: Extract<SessionHostCommand, { op: 'retire' }>): Promise<SessionHostOutcome> {
    let record = registry.get(command.sessionId);
    if (!record) return failure('retire', 'session-not-found', 'Hosted Session was not found.');
    if (record.hostState === 'retired') {
      return { ok: true, op: 'retire', session: toSessionHostView(record) };
    }
    if (
      !transports.has(record.sessionId) &&
      record.process &&
      await closeDurableProcess(record, 'retire-stale-scope') !== 'closed'
    ) {
      return failure(
        'retire',
        'session-busy',
        'Hosted Session has a surviving process-tree owner that must close before retirement.',
        record
      );
    }
    cancelledSessions.add(record.sessionId);
    try {
      record = await registry.update(record.sessionId, expected(record), (current) => {
        transition(current, 'retiring');
        current.retirementReason = sanitizeHostDiagnostic(command.reason, 256);
        current.updatedAt = timestamp();
        return current;
      });
      const live = transports.get(record.sessionId);
      if (live) {
        let termination;
        try {
          termination = await closeLive(record.sessionId, live, 'retired');
        } catch (error) {
          return failure(
            'retire',
            'backend-protocol-failed',
            error instanceof Error ? error.message : 'Hosted Session process close failed.',
            registry.get(record.sessionId) ?? record
          );
        }
        if (!termination.closed) {
          return failure(
            'retire',
            'session-busy',
            'Hosted Session process-tree close was not observed; retirement remains pending.',
            registry.get(record.sessionId) ?? record
          );
        }
      }
      record = await updateLatest(record.sessionId, (current) => {
        if (current.hostState === 'retired') return current;
        if (current.hostState !== 'retiring') {
          throw new HostOperationError(
            'session-busy',
            `Retirement intent lost its lifecycle fence in ${current.hostState}.`
          );
        }
        const request = currentGenerationRequest(current);
        if (request) {
          request.state = 'ambiguous';
          request.diagnostic = 'retired-outcome-unknown';
        }
        current.process = undefined;
        current.hostState = 'retired';
        current.updatedAt = timestamp();
        return current;
      });
      return { ok: true, op: 'retire', session: toSessionHostView(record) };
    } finally {
      if (!activeSessions.has(record.sessionId)) cancelledSessions.delete(record.sessionId);
    }
  }

  async function dispatch(raw: SessionHostCommand): Promise<SessionHostOutcome> {
    const validation = validateSessionHostCommand(raw);
    if (!validation.ok) {
      return failure(
        typeof (raw as { op?: unknown })?.op === 'string'
          ? ((raw as { op: SessionHostCommand['op'] }).op)
          : 'execute',
        'invalid-input',
        validation.message
      );
    }
    const command = validation.command;
    if (!ready) return failure(command.op, 'registry-corrupt', 'Hosted Session registry is not reconciled.');
    if (draining) return failure(command.op, 'session-busy', 'Hosted Session host is shutting down.');
    try {
      if (command.op === 'execute') return await execute(command);
      if (command.op === 'cancel') return await cancel(command);
      if (command.op === 'restart') return await restart(command);
      return await retire(command);
    } catch (error) {
      const mapped = mapFailure(error);
      return failure(command.op, mapped.code, mapped.message);
    } finally {
      await flushProcessTerminals();
    }
  }

  async function reconcileOnStart() {
    const report = {
      ready: false,
      inspected: 0,
      recovered: 0,
      interrupted: 0,
      failed: 0,
      diagnostics: [] as string[],
    };
    try {
      await registry.load();
      for (const original of registry.list()) {
        report.inspected += 1;
        if (original.hostState === 'retired') continue;
        const staleOwner = original.process
          ? await closeDurableProcess(original, 'daemon-reconcile-stale-scope')
          : 'closed';
        const survivingOwner = staleOwner === 'live-or-uncertain';
        if (original.process && staleOwner === 'closed') {
          report.diagnostics.push(
            `Hosted Session ${original.sessionId} exact stale process-tree owner was reaped.`
          );
        }
        if (original.hostState === 'retiring') {
          if (survivingOwner) {
            report.diagnostics.push(
              `Hosted Session ${original.sessionId} retains retirement intent until its exact owner closes.`
            );
            report.interrupted += 1;
          } else {
            await registry.update(original.sessionId, expected(original), (current) => {
              current.process = undefined;
              current.hostState = 'retired';
              current.updatedAt = timestamp();
              return current;
            });
            report.recovered += 1;
          }
          continue;
        }
        const request = currentGenerationRequest(original);
        if (survivingOwner) {
          const updated = await registry.update(original.sessionId, expected(original), (current) => {
            const currentRequest = activeRequest(current);
            if (currentRequest) {
              currentRequest.state = 'ambiguous';
              currentRequest.diagnostic = 'surviving-process-owner-unattachable';
            }
            current.updatedAt = timestamp();
            current.hostState = current.backendSessionId ? 'interrupted' : 'failed';
            current.recoveryReason = 'surviving-process-owner-unattachable';
            return current;
          });
          report.diagnostics.push(
            `Hosted Session ${original.sessionId} retains a live or uncertain process-tree owner.`
          );
          if (updated.hostState === 'interrupted') report.interrupted += 1;
          else report.failed += 1;
          continue;
        }
        if (request) {
          const updated = await registry.update(original.sessionId, expected(original), (current) => {
            const currentRequest = activeRequest(current);
            if (currentRequest) {
              currentRequest.state = 'ambiguous';
              currentRequest.diagnostic = 'host-restart-outcome-unknown';
            }
            current.process = undefined;
            current.updatedAt = timestamp();
            if (current.backendSessionId) {
              current.hostState = 'interrupted';
              current.recoveryReason = 'host-restart-outcome-unknown';
            } else {
              current.hostState = 'failed';
              current.recoveryReason = 'missing-resume-identity';
            }
            return current;
          });
          if (updated.hostState === 'interrupted') report.interrupted += 1;
          else report.failed += 1;
          continue;
        }
        if (original.hostState === 'starting' && !original.backendSessionId) {
          await registry.update(original.sessionId, expected(original), (current) => {
            current.hostState = 'failed';
            current.process = undefined;
            current.recoveryReason = 'missing-resume-identity';
            current.updatedAt = timestamp();
            return current;
          });
          report.failed += 1;
          continue;
        }
        if (original.hostState !== 'failed') {
          await registry.update(original.sessionId, expected(original), (current) => {
            current.hostState = 'idle';
            current.process = undefined;
            current.recoveryReason = 'daemon-restart-exact-resume';
            current.updatedAt = timestamp();
            return current;
          });
          report.recovered += 1;
        }
      }
      await flushProcessTerminals();
      ready = true;
      report.ready = true;
      return report;
    } catch (error) {
      const mapped = mapFailure(error);
      report.diagnostics.push(sanitizeHostDiagnostic(mapped.message, 512));
      return report;
    }
  }

  async function shutdown(reason: 'daemon-stop' | 'server-shutdown'): Promise<void> {
    draining = true;
    const retainedEntries = [...retainedPrepared.entries()];
    const closeRetained = Promise.all(retainedEntries.map(async ([ref, retained]) => {
      const receipt = await retained.prepared.abort(reason).catch(() => ({
        state: 'uncertain' as const,
        gracefulAttempted: false,
        forced: false,
      }));
      if (!receiptAuthorizesRelease(receipt, retained.prepared.declaration !== undefined)) {
        return false;
      }
      retainedPrepared.delete(ref);
      await retained.claim.release();
      const record = registry.get(retained.sessionId);
      if (record?.process?.runtimeRef === ref) {
        await registry.update(record.sessionId, expected(record), (current) => {
          if (current.process?.runtimeRef === ref) current.process = undefined;
          current.updatedAt = timestamp();
          return current;
        }).catch(() => undefined);
      }
      return true;
    }));
    const openingEntries = [...inFlightOpens.entries()];
    for (const [, controller] of openingEntries) controller.abort();
    const liveEntries = [...transports.entries()];
    const drainKnown = Promise.all(liveEntries.map(async ([sessionId, live]) => {
      let record = registry.get(sessionId);
      cancelledSessions.add(sessionId);
      if (record && record.hostState !== 'retired' && record.hostState !== 'retiring') {
        record = await registry.update(sessionId, expected(record), (current) => {
          if (current.hostState === 'active') transition(current, 'cancelling');
          current.recoveryReason = 'shutdown-intent';
          current.updatedAt = timestamp();
          return current;
        }).catch(() => registry.get(sessionId) ?? record!);
      }
      const termination = await closeLive(sessionId, live, reason).catch(
        () => ({ closed: false, cancelledBeforeWork: false })
      );
      record = registry.get(sessionId) ?? record;
      if (!record || record.hostState === 'retired' || record.hostState === 'retiring') {
        return termination.closed;
      }
      await updateLatest(sessionId, (current) => {
        if (current.hostState === 'retired' || current.hostState === 'retiring') return current;
        const request = currentGenerationRequest(current);
        if (request) request.state = 'ambiguous';
        if (termination.closed) current.process = undefined;
        current.hostState = request ? 'interrupted' : 'idle';
        current.recoveryReason = !termination.closed
          ? 'shutdown-close-unobserved'
          : request
            ? 'shutdown-outcome-unknown'
            : 'clean-shutdown-exact-resume';
        current.updatedAt = timestamp();
        return current;
      }).catch(() => undefined);
      return termination.closed;
    }));
    const [closed, retainedClosed] = await Promise.all([
      drainKnown,
      closeRetained,
      Promise.allSettled(openingEntries.map(([finished]) => finished)),
    ]);
    // The third and last flush point. A shutdown-routed close stages terminals
    // that no dispatch and no reconcile will ever drain - the daemon is going
    // away and `pendingTerminals` is in-memory only.
    await flushProcessTerminals();
    if (
      closed.some((value) => !value) ||
      retainedClosed.some((value) => !value) ||
      transports.size > 0 ||
      retainedPrepared.size > 0
    ) {
      throw new HostOperationError(
        'session-busy',
        'Hosted Session shutdown could not observe every exact process close; durable authority is retained for retry or reconciliation.'
      );
    }
  }

  return { dispatch, inspect, list, reconcileOnStart, shutdown };
}
