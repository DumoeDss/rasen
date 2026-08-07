import type { TurnLimits } from './contracts.js';
import type {
  ProcessRef,
  TerminationReceipt,
} from './process-scope.js';

export type BackendEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'result'; sessionId: string; content: string }
  | { type: string; [key: string]: unknown };

export interface BackendOpenInput {
  cwd: string;
  limits: TurnLimits;
  resumeSessionId?: string;
  signal: AbortSignal;
}

export interface BackendTurn {
  requestId: string;
  input: string;
  limits: TurnLimits;
}

export interface BackendTermination {
  closed: boolean;
  cancelledBeforeWork: boolean;
}

export interface BackendTurnStream extends AsyncIterable<BackendEvent> {
  /** Resolves only after the transport has accepted the complete stdin write. */
  readonly accepted: Promise<void>;
}

export interface AgentSessionTransport {
  readonly runtimeRef: ProcessRef;
  /** Observation only; never a process-control argument. */
  readonly displayPid?: number;
  readonly closed: Promise<unknown>;
  send(turn: BackendTurn): BackendTurnStream;
  terminate(reason: string): Promise<BackendTermination>;
}

export interface PreparedAgentSessionTransport {
  readonly runtimeRef: ProcessRef;
  readonly displayPid?: number;
  activate(): Promise<AgentSessionTransport>;
  abort(reason: string): Promise<TerminationReceipt>;
}

export interface AgentSessionBackend {
  readonly id: string;
  readonly version?: string;
  prepare(input: BackendOpenInput): Promise<PreparedAgentSessionTransport>;
}

export function createAgentSessionBackendRegistry(
  backends: readonly AgentSessionBackend[]
): ReadonlyMap<string, AgentSessionBackend> {
  const registry = new Map<string, AgentSessionBackend>();
  for (const backend of backends) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(backend.id)) {
      throw new Error(`Invalid agent Session backend id "${backend.id}".`);
    }
    if (registry.has(backend.id)) {
      throw new Error(`Duplicate agent Session backend id "${backend.id}".`);
    }
    registry.set(backend.id, backend);
  }
  return registry;
}
