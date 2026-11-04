import type {
  SessionHost,
  SessionHostCommand,
  SessionHostOutcome,
  SessionHostView,
} from '../session-host/contracts.js';
import type { SessionRecordWire } from './wire-types.js';

export function hostedSessionToWire(view: SessionHostView): SessionRecordWire {
  return {
    id: view.sessionId,
    kind: 'hosted',
    task: 'Hosted agent session',
    cwd: view.cwd,
    ...(view.pid ? { pid: view.pid } : {}),
    ...(view.backendSessionId ? { agentSessionId: view.backendSessionId } : {}),
    state: view.state,
    startedAt: Date.parse(view.createdAt),
    lastOutputAt: Date.parse(view.updatedAt),
    ...(view.state === 'exited' ? { endedAt: Date.parse(view.updatedAt) } : {}),
    ...(view.state === 'exited'
      ? { terminationReason: view.hostState === 'retired' ? 'retired' : 'host-failed' }
      : {}),
    hostState: view.hostState,
    backend: view.backend,
    ...(view.backendSessionId ? { backendSessionId: view.backendSessionId } : {}),
    generation: view.generation,
    ...(view.currentRequest ? { currentRequest: { ...view.currentRequest } } : {}),
    // The HTTP surface is the only remote operator surface: the declared limits
    // and the honest terminal have to be readable here, or an operator sees a
    // released session with no record of what was never proven about it.
    ...(view.processDeclaration ? { processDeclaration: { ...view.processDeclaration } } : {}),
    ...(view.processTerminal ? { processTerminal: { ...view.processTerminal } } : {}),
    ...(view.recoveryReason ? { recoveryReason: view.recoveryReason } : {}),
    ...(view.retirementReason ? { retirementReason: view.retirementReason } : {}),
  };
}

export function hostedOutcomeStatus(outcome: SessionHostOutcome): number {
  if (outcome.ok) return outcome.op === 'execute' ? 201 : 200;
  if (outcome.code === 'invalid-input' || outcome.code === 'unsupported-backend') return 400;
  if (outcome.code === 'session-not-found') return 404;
  if (
    outcome.code === 'session-busy' ||
    outcome.code === 'stale-generation' ||
    outcome.code === 'cwd-mismatch' ||
    outcome.code === 'session-retired'
  ) {
    return 409;
  }
  if (outcome.code === 'turn-outcome-unknown' || outcome.code === 'session-failed') return 422;
  return 503;
}

export async function handleHostedSessionDispatch(
  host: SessionHost,
  command: SessionHostCommand
): Promise<{ status: number; response: SessionHostOutcome }> {
  const response = await host.dispatch(command);
  return { status: hostedOutcomeStatus(response), response };
}
