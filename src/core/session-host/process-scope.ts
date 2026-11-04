import { PassThrough, type Readable, type Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';

import type { ExactScopeEmptyReceipt } from './process-authority/coordinator.js';

declare const processRefBrand: unique symbol;
export type ProcessRef = string & { readonly [processRefBrand]: true };

export interface ProcessPrepareInput {
  /** Server-resolved absolute executable. Never resolved by the capsule through PATH. */
  command: string;
  args: readonly string[];
  cwd: string;
  /** Explicit non-sensitive allowlist. The helper never inherits the daemon environment. */
  env: Readonly<Record<string, string>>;
  windowsVerbatimArguments?: boolean;
  signal?: AbortSignal;
  /** Dedicated exact-Teacher journal hook; ignored by ordinary scopes. */
  onExactAuthorityPhase?: (
    phase: 'authority-published-inert' | 'activated',
    processRef: ProcessRef
  ) => Promise<void>;
}

export interface TerminationIntent {
  reason: string;
  graceMs: number;
}

export type ProcessObservation =
  | { state: 'prepared' | 'live' | 'root-exited'; controllable: true }
  | {
      state: 'closed';
      controllable: false;
      /** Coordinator-authenticated proof, present only on provider-backed exact authority. */
      exactScopeEmptyReceipt?: ExactScopeEmptyReceipt;
    }
  | { state: 'foreign'; controllable: false }
  | {
      state: 'declared-unproven';
      controllable: false;
      terminal: DeclaredUnprovenReceipt;
    }
  | {
      state: 'uncertain';
      controllable: false;
      diagnostic: string;
      failure?: ProcessControlFailure;
    };

export type ProcessControlPhase =
  | 'prepare'
  | 'activate'
  | 'abort'
  | 'terminate'
  | 'inspect'
  | 'scope-empty';

export interface ProcessControlFailure {
  code: 'process-control-timeout' | 'process-control-lost';
  phase: ProcessControlPhase;
}

export interface BackendRootExit {
  state: 'root-exited';
  code: number | null;
  signal: string | null;
}

export interface ScopeEmptyReceipt {
  state: 'scope-empty';
  /** Coordinator-authenticated proof, never reconstructed from serialized shape. */
  exactScopeEmptyReceipt?: ExactScopeEmptyReceipt;
}

/**
 * Descriptive vocabulary of the declared best-effort tier. Deliberately NOT
 * added to RECURSIVE_PROCESS_SCOPE_SEMANTICS: this tier claims no part of the
 * frozen recursive capability, and the frozen constant stays untouched.
 */
export const BEST_EFFORT_SCOPE_SEMANTICS = Object.freeze([
  'own-process-group',
  'group-signal-cancel',
  'emptiness-keyed-escalation',
  'exact-root-exit',
  'bounded-controls',
  'honest-unproven-terminal',
] as const);

/**
 * Descriptive vocabulary of the win32 declared best-effort tier. The Job object
 * is the containment primitive there, so the mechanism tokens differ from the
 * POSIX list while the honesty tokens are shared. Added alongside
 * BEST_EFFORT_SCOPE_SEMANTICS, which is not modified: neither list claims any
 * part of the frozen recursive capability.
 */
export const WIN32_BEST_EFFORT_SCOPE_SEMANTICS = Object.freeze([
  'own-job-object',
  'job-kill-cancel',
  'kill-on-job-close-teardown',
  'exact-root-exit',
  'bounded-controls',
  'honest-unproven-terminal',
] as const);

export type BestEffortScopeSemantic =
  | (typeof BEST_EFFORT_SCOPE_SEMANTICS)[number]
  | (typeof WIN32_BEST_EFFORT_SCOPE_SEMANTICS)[number];

/**
 * Limits a best-effort scope declares before it starts. Absence of a
 * declaration means the exact tier, whose behavior this addition never alters.
 * Both flags are literal `false`: this tier cannot ever declare them true.
 */
export interface BestEffortScopeDeclaration {
  readonly tier: 'best-effort';
  readonly exactCancel: false;
  readonly scopeEmptyProof: false;
  readonly semantics: readonly BestEffortScopeSemantic[];
}

export type DeclaredUnprovenOutcome = 'cancelled' | 'completed' | 'never-activated';

/**
 * Terminal of a declared best-effort scope. Distinct from `closed` (a proven
 * scope-empty claim) and from `uncertain` (a transient unknown awaiting
 * reconciliation): unproven-by-design is itself terminal. `groupObservedEmpty`
 * is diagnostic detail only and never upgrades `emptiness`.
 */
export interface DeclaredUnprovenReceipt {
  readonly state: 'declared-unproven';
  readonly outcome: DeclaredUnprovenOutcome;
  readonly emptiness: 'unproven';
  readonly groupObservedEmpty: boolean;
  readonly forced: boolean;
  readonly rootExit?: { readonly code: number | null; readonly signal: string | null };
  readonly diagnostic?: string;
}

export const DECLARED_UNPROVEN_TERMINAL_LABELS = Object.freeze({
  cancelled: 'cancelled / emptiness-unproven',
  completed: 'completed / emptiness-unproven',
  'never-activated': 'never-activated / emptiness-unproven',
} as const);

export function declaredUnprovenTerminalLabel(outcome: DeclaredUnprovenOutcome): string {
  return DECLARED_UNPROVEN_TERMINAL_LABELS[outcome];
}

export function isDeclaredUnprovenReceipt(value: unknown): value is DeclaredUnprovenReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DeclaredUnprovenReceipt>;
  return candidate.state === 'declared-unproven' && candidate.emptiness === 'unproven';
}

export interface TerminationReceipt {
  state: 'closed' | 'retained' | 'uncertain' | 'declared-unproven';
  gracefulAttempted: boolean;
  forced: boolean;
  diagnostic?: string;
  failure?: ProcessControlFailure;
  /** Present exactly when state is 'declared-unproven'. */
  unproven?: DeclaredUnprovenReceipt;
  /** Present only when the exact provider coordinator authenticated empty. */
  exactScopeEmptyReceipt?: ExactScopeEmptyReceipt;
}

export interface LiveProcessScope {
  readonly ref: ProcessRef;
  /** Observation only. Callers must never feed it back into a control method. */
  readonly displayPid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly rootExited: Promise<BackendRootExit>;
  readonly closed: Promise<ScopeEmptyReceipt | DeclaredUnprovenReceipt>;
}

export interface PreparedProcessScope {
  readonly ref: ProcessRef;
  readonly displayPid?: number;
  /** Present only on a declared best-effort tier; absent means the exact tier. */
  readonly declaration?: BestEffortScopeDeclaration;
  activate(): Promise<LiveProcessScope>;
  abort(reason: string): Promise<TerminationReceipt>;
}

/**
 * Deep external seam between durable Session lifecycle and process authority.
 * ProcessRef is the sole control capability; PID/PGID/Job/native handles are
 * deliberately absent from every method.
 */
export interface ProcessScope {
  prepare(input: ProcessPrepareInput): Promise<PreparedProcessScope>;
  inspect(ref: ProcessRef): Promise<ProcessObservation>;
  terminate(ref: ProcessRef, intent: TerminationIntent): Promise<TerminationReceipt>;
}

export class ProcessScopeError extends Error {
  constructor(
    readonly code:
      | 'containment-unsupported'
      | 'helper-integrity-failed'
      | 'containment-prepare-failed'
      | 'containment-not-established'
      | 'authority-persist-failed'
      | 'activation-failed'
      | 'process-identity-foreign'
      | 'process-authority-uncertain'
      | 'process-control-lost'
      | 'process-control-timeout'
      | 'process-termination-unobserved'
      | 'containment-breach',
    message: string,
    options?: ErrorOptions,
    readonly phase?: ProcessControlPhase,
  ) {
    super(message, options);
    this.name = 'ProcessScopeError';
  }
}

export function asProcessRef(value: string): ProcessRef {
  if (
    !/^(?:rasen-process-scope\/1:[A-Za-z0-9_-]{16,4096}|rasen-process-authority\/1:[A-Za-z0-9_-]{16,32768})$/.test(value)
  ) {
    throw new ProcessScopeError('process-authority-uncertain', 'ProcessRef is malformed.');
  }
  return value as ProcessRef;
}

/**
 * Declaration-gated release rule.
 *
 * Exact-tier scopes keep the pre-existing rule byte-for-byte: only a proven
 * scope-empty receipt authorises release. A declared-unproven terminal
 * authorises release only when the pre-start declaration is present; an
 * undeclared scope presenting one is refused, fail closed.
 */
export function receiptAuthorizesRelease(
  receipt: Pick<TerminationReceipt, 'state'>,
  declared: boolean
): boolean {
  if (receipt.state === 'closed') return true;
  return declared && receipt.state === 'declared-unproven';
}

export interface DeterministicProcessScopeOptions {
  onActivate?: (ref: ProcessRef) => void;
  onTerminate?: (ref: ProcessRef, intent: TerminationIntent) => void;
  inspectState?: ProcessObservation['state'];
  terminationState?: TerminationReceipt['state'];
  rootExitAfterActivation?: Omit<BackendRootExit, 'state'>;
  scopeEmptyAfterRootExit?: boolean;
}

/** Deterministic adapter at the same seam as the native production capsule. */
export function createDeterministicProcessScope(
  options: DeterministicProcessScopeOptions = {}
): ProcessScope {
  const records = new Map<ProcessRef, 'prepared' | 'live' | 'root-exited' | 'closed'>();
  const closeScope = new Map<ProcessRef, () => void>();

  return {
    async prepare() {
      const ref = asProcessRef(
        `rasen-process-scope/1:${randomBytes(24).toString('base64url')}`
      );
      records.set(ref, 'prepared');
      let finished = false;
      let resolveRootExited!: (value: BackendRootExit) => void;
      const rootExited = new Promise<BackendRootExit>((resolve) => {
        resolveRootExited = resolve;
      });
      let resolveClosed!: (value: ScopeEmptyReceipt) => void;
      const closed = new Promise<ScopeEmptyReceipt>((resolve) => {
        resolveClosed = resolve;
      });
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const close = () => {
        if (finished) return;
        finished = true;
        records.set(ref, 'closed');
        stdin.destroy();
        stdout.end();
        stderr.end();
        resolveClosed({ state: 'scope-empty' });
      };
      closeScope.set(ref, close);
      return {
        ref,
        displayPid: 4242,
        async activate() {
          if (records.get(ref) !== 'prepared') {
            throw new ProcessScopeError('activation-failed', 'ProcessScope activation is exactly once.');
          }
          records.set(ref, 'live');
          options.onActivate?.(ref);
          if (options.rootExitAfterActivation) {
            queueMicrotask(() => {
              if (records.get(ref) !== 'live') return;
              records.set(ref, 'root-exited');
              resolveRootExited({ state: 'root-exited', ...options.rootExitAfterActivation! });
              if (options.scopeEmptyAfterRootExit) close();
            });
          }
          return { ref, displayPid: 4242, stdin, stdout, stderr, rootExited, closed };
        },
        async abort() {
          close();
          return { state: 'closed', gracefulAttempted: false, forced: true };
        },
      };
    },
    async inspect(ref) {
      const override = options.inspectState;
      if (override === 'foreign') return { state: 'foreign', controllable: false };
      if (override === 'uncertain') {
        return { state: 'uncertain', controllable: false, diagnostic: 'deterministic uncertainty' };
      }
      if (override === 'closed') return { state: 'closed', controllable: false };
      const state = records.get(ref);
      if (state === 'prepared' || state === 'live' || state === 'root-exited') {
        return { state, controllable: true };
      }
      if (state === 'closed') return { state: 'closed', controllable: false };
      return { state: 'foreign', controllable: false };
    },
    async terminate(ref, intent) {
      const observation = await this.inspect(ref);
      if (!observation.controllable) {
        return {
          state: observation.state === 'closed' ? 'closed' : options.terminationState ?? 'uncertain',
          gracefulAttempted: false,
          forced: false,
          ...(observation.state === 'uncertain' ? { diagnostic: observation.diagnostic } : {}),
        };
      }
      options.onTerminate?.(ref, intent);
      const state = options.terminationState ?? 'closed';
      if (state === 'closed') closeScope.get(ref)?.();
      return { state, gracefulAttempted: true, forced: state === 'closed' };
    },
  };
}
