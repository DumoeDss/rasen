import type { HostedSessionSandbox, TurnLimits } from './contracts.js';
import type { ExactScopeEmptyReceipt } from './process-authority/coordinator.js';
import { isDeclaredUnprovenReceipt } from './process-scope.js';
import type {
  BestEffortScopeDeclaration,
  DeclaredUnprovenReceipt,
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
  sandbox: HostedSessionSandbox;
  resumeSessionId?: string;
  signal: AbortSignal;
  /** Exact provider lifecycle journal hook; absent on ordinary/source hosts. */
  onExactAuthorityPhase?: (
    phase: 'authority-published-inert' | 'activated',
    processRef: ProcessRef
  ) => Promise<void>;
}

export interface BackendTurn {
  requestId: string;
  input: string;
  limits: TurnLimits;
}

export interface BackendTermination {
  closed: boolean;
  cancelledBeforeWork: boolean;
  /** Coordinator-authenticated exact proof carried without structural promotion. */
  exactScopeEmptyReceipt?: ExactScopeEmptyReceipt;
  /**
   * Honest terminal of a declared best-effort scope, carried through to the
   * durable Record. Absent on the exact tier, whose close reporting is
   * unchanged: a boolean-only termination cannot express `cancelled /
   * emptiness-unproven`, so without this field the terminal dies at this seam.
   */
  unproven?: DeclaredUnprovenReceipt;
}

/**
 * Value an `AgentSessionTransport.closed` promise may carry. The seam type
 * stays `unknown` so an exact-tier transport may resolve nothing at all; a
 * declared best-effort transport resolves this shape so natural completion
 * reaches the Record with the same honesty a cancel does.
 */
export interface BackendClosure {
  readonly unproven?: DeclaredUnprovenReceipt;
  readonly exactScopeEmptyReceipt?: ExactScopeEmptyReceipt;
}

/**
 * Narrows whatever a transport resolved its `closed` promise with. Anything
 * that is not a declared-unproven terminal yields `undefined`, which is the
 * exact-tier answer and writes nothing.
 */
export function backendClosureTerminal(value: unknown): DeclaredUnprovenReceipt | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = (value as BackendClosure).unproven;
  return isDeclaredUnprovenReceipt(candidate) ? candidate : undefined;
}

export function backendClosureExactScopeEmptyReceipt(
  value: unknown
): ExactScopeEmptyReceipt | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as BackendClosure).exactScopeEmptyReceipt;
}

export interface BackendTurnStream extends AsyncIterable<BackendEvent> {
  /** Resolves only after the transport has accepted the complete stdin write. */
  readonly accepted: Promise<void>;
}

export interface AgentSessionTransport {
  readonly runtimeRef: ProcessRef;
  /** Observation only; never a process-control argument. */
  readonly displayPid?: number;
  /**
   * Settles when the transport's own scope is gone. A declared best-effort
   * transport resolves a `BackendClosure` carrying its honest terminal; read it
   * through `backendClosureTerminal`, never by shape-guessing.
   */
  readonly closed: Promise<unknown>;
  send(turn: BackendTurn): BackendTurnStream;
  terminate(reason: string): Promise<BackendTermination>;
}

export interface PreparedAgentSessionTransport {
  readonly runtimeRef: ProcessRef;
  readonly displayPid?: number;
  /**
   * Best-effort tier limits, known before activation so the host can record
   * them before any workload code runs. Absent means the exact tier.
   */
  readonly declaration?: BestEffortScopeDeclaration;
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
