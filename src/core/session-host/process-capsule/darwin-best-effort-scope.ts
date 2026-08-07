import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import {
  asProcessRef,
  BEST_EFFORT_SCOPE_SEMANTICS,
  ProcessScopeError,
  type BackendRootExit,
  type BestEffortScopeDeclaration,
  type DeclaredUnprovenReceipt,
  type LiveProcessScope,
  type PreparedProcessScope,
  type ProcessControlPhase,
  type ProcessObservation,
  type ProcessPrepareInput,
  type ProcessRef,
  type ProcessScope,
  type TerminationIntent,
  type TerminationReceipt,
} from '../process-scope.js';

const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_FINAL_OBSERVATION_MS = 2_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 10_000;

/**
 * The declaration this tier publishes before any workload starts. Both limit
 * flags are literal `false` and no code path can widen them.
 */
export const DARWIN_BEST_EFFORT_DECLARATION: BestEffortScopeDeclaration = Object.freeze({
  tier: 'best-effort',
  exactCancel: false,
  scopeEmptyProof: false,
  semantics: BEST_EFFORT_SCOPE_SEMANTICS,
});

/**
 * Whole-group process control. Every method addresses the group, never the
 * leader alone; the escalation decision reads `groupPresent` exclusively.
 */
export interface ProcessGroupControl {
  signalGroup(groupId: number, signal: NodeJS.Signals): void;
  groupPresent(groupId: number): boolean;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export function createNativeProcessGroupControl(
  kill: (pid: number, signal: NodeJS.Signals | 0) => void = (pid, signal) => {
    process.kill(pid, signal);
  }
): ProcessGroupControl {
  return {
    signalGroup(groupId, signal) {
      // Negative pid addresses the whole POSIX process group, never the leader.
      kill(-groupId, signal);
    },
    groupPresent(groupId) {
      try {
        kill(-groupId, 0);
        return true;
      } catch (error) {
        if (isErrnoCode(error, 'ESRCH')) return false;
        // EPERM (and anything else) means the group is observably still there
        // and simply not ours to signal. An unreaped member also keeps the
        // group visible; the poll tolerates that transient state by continuing
        // rather than concluding either way.
        return true;
      }
    },
  };
}

export interface DarwinBestEffortProcessScopeOptions {
  spawn?: typeof spawn;
  control?: ProcessGroupControl;
  /** Interval of the whole-group emptiness poll. */
  pollIntervalMs?: number;
  /** Budget of the single post-SIGKILL observation. */
  finalObservationMs?: number;
  /** Deadline for the prepare/activate/inspect/terminate control phases. */
  controlTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type ScopePhase = 'prepared' | 'live' | 'root-exited' | 'terminal';

interface ScopeState {
  readonly ref: ProcessRef;
  readonly input: ProcessPrepareInput;
  phase: ScopePhase;
  groupId?: number;
  child?: ChildProcess;
  rootExit?: BackendRootExit;
  terminal?: DeclaredUnprovenReceipt;
  /** Latched on the first cancel; a cancelled scope never settles 'completed'. */
  cancelling?: boolean;
  cancelInFlight?: Promise<DeclaredUnprovenReceipt>;
  settleTerminal(receipt: DeclaredUnprovenReceipt): void;
  readonly closed: Promise<DeclaredUnprovenReceipt>;
}

function unprovenReceipt(
  outcome: DeclaredUnprovenReceipt['outcome'],
  detail: {
    groupObservedEmpty: boolean;
    forced: boolean;
    rootExit?: BackendRootExit;
    diagnostic?: string;
  }
): DeclaredUnprovenReceipt {
  // `emptiness` is a literal. There is deliberately no branch that can turn a
  // group-emptiness observation into a scope-emptiness proof.
  return Object.freeze({
    state: 'declared-unproven',
    outcome,
    emptiness: 'unproven',
    groupObservedEmpty: detail.groupObservedEmpty,
    forced: detail.forced,
    ...(detail.rootExit
      ? { rootExit: { code: detail.rootExit.code, signal: detail.rootExit.signal } }
      : {}),
    ...(detail.diagnostic ? { diagnostic: detail.diagnostic } : {}),
  });
}

function terminationFrom(receipt: DeclaredUnprovenReceipt): TerminationReceipt {
  return {
    state: 'declared-unproven',
    gracefulAttempted: receipt.outcome === 'cancelled',
    forced: receipt.forced,
    unproven: receipt,
  };
}

function timeoutReceipt(phase: ProcessControlPhase, message: string): TerminationReceipt {
  return {
    state: 'uncertain',
    gracefulAttempted: true,
    forced: false,
    diagnostic: message,
    failure: { code: 'process-control-timeout', phase },
  };
}

export function createDarwinBestEffortProcessScope(
  options: DarwinBestEffortProcessScopeOptions = {}
): ProcessScope {
  const spawnProcess = options.spawn ?? spawn;
  const control = options.control ?? createNativeProcessGroupControl();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const finalObservationMs = options.finalObservationMs ?? DEFAULT_FINAL_OBSERVATION_MS;
  const controlTimeoutMs = options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  // Deliberately not unref'd: an in-flight bounded observation must hold the
  // event loop, or a cancel could be abandoned mid-protocol and the terminal
  // would never be recorded.
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const scopes = new Map<ProcessRef, ScopeState>();

  async function withPhaseDeadline<T>(
    phase: ProcessControlPhase,
    budgetMs: number,
    work: Promise<T>
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new ProcessScopeError(
            'process-control-timeout',
            `macOS best-effort scope ${phase} exceeded its bound.`,
            undefined,
            phase
          )
        );
      }, budgetMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      settled = true;
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Whole-group emptiness poll. Returns true only when the group is observed
   * absent within the budget. This observation is the sole escalation input and
   * is never promoted into a scope-emptiness proof.
   */
  async function pollGroupEmpty(groupId: number, budgetMs: number): Promise<boolean> {
    const deadline = now() + Math.max(0, budgetMs);
    for (;;) {
      if (!control.groupPresent(groupId)) return true;
      const remaining = deadline - now();
      if (remaining <= 0) return false;
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  async function runCancelProtocol(
    state: ScopeState,
    intent: TerminationIntent
  ): Promise<DeclaredUnprovenReceipt> {
    const groupId = state.groupId;
    if (groupId === undefined) {
      return unprovenReceipt('never-activated', {
        groupObservedEmpty: false,
        forced: false,
        diagnostic: 'no workload ran',
      });
    }
    let groupObservedEmpty = false;
    let forced = false;

    // 1. Group SIGTERM. ESRCH here means the group is already gone; the
    //    terminal stays emptiness-unproven regardless.
    try {
      control.signalGroup(groupId, 'SIGTERM');
    } catch (error) {
      if (!isErrnoCode(error, 'ESRCH')) throw error;
      groupObservedEmpty = true;
    }

    // 2. Bounded grace keyed on WHOLE-GROUP emptiness. Leader exit is recorded
    //    on state.rootExit and is deliberately never read here.
    if (!groupObservedEmpty) {
      groupObservedEmpty = await pollGroupEmpty(groupId, intent.graceMs);
    }

    // 3. Escalation reads group emptiness only. A leader that exited instantly
    //    while a descendant survives still reaches this branch.
    if (!groupObservedEmpty) {
      forced = true;
      try {
        control.signalGroup(groupId, 'SIGKILL');
      } catch (error) {
        if (!isErrnoCode(error, 'ESRCH')) throw error;
        groupObservedEmpty = true;
      }
      if (!groupObservedEmpty) {
        groupObservedEmpty = await pollGroupEmpty(groupId, finalObservationMs);
      }
    }

    // 4. Always cancelled / emptiness-unproven, group-observed-empty included:
    //    a descendant can leave the group with setsid()/setpgid() and survive.
    return unprovenReceipt('cancelled', {
      groupObservedEmpty,
      forced,
      ...(state.rootExit ? { rootExit: state.rootExit } : {}),
    });
  }

  async function cancel(
    state: ScopeState,
    intent: TerminationIntent
  ): Promise<DeclaredUnprovenReceipt> {
    if (state.terminal) return state.terminal;
    if (state.cancelInFlight) return state.cancelInFlight;
    state.cancelling = true;
    const attempt = runCancelProtocol(state, intent).then((receipt) => {
      state.settleTerminal(receipt);
      return receipt;
    });
    state.cancelInFlight = attempt;
    try {
      return await attempt;
    } finally {
      state.cancelInFlight = undefined;
    }
  }

  /**
   * Natural completion: after the leader exits, observe whole-group emptiness
   * and settle a completion terminal that carries the same unproven honesty.
   */
  function watchNaturalCompletion(state: ScopeState): void {
    void (async () => {
      const groupId = state.groupId;
      if (groupId === undefined) return;
      for (;;) {
        if (state.terminal || state.cancelling) return;
        if (!control.groupPresent(groupId)) break;
        await sleep(pollIntervalMs);
      }
      if (state.terminal || state.cancelInFlight) return;
      state.settleTerminal(
        unprovenReceipt('completed', {
          groupObservedEmpty: true,
          forced: false,
          ...(state.rootExit ? { rootExit: state.rootExit } : {}),
        })
      );
    })();
  }

  function activateChild(state: ScopeState): Promise<LiveProcessScope> {
    const input = state.input;
    let child: ChildProcess;
    try {
      child = spawnProcess(input.command, [...input.args], {
        cwd: input.cwd,
        env: { ...input.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // POSIX setsid(): a new session implies a new process group whose id
        // equals the leader pid. Descendants are born into that group.
        detached: true,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      throw new ProcessScopeError(
        'activation-failed',
        'macOS best-effort scope could not start the workload leader.',
        { cause: error },
        'activate'
      );
    }
    let resolveRootExit!: (value: BackendRootExit) => void;
    const rootExited = new Promise<BackendRootExit>((settle) => {
      resolveRootExit = settle;
    });
    return new Promise<LiveProcessScope>((resolve, reject) => {
      const fail = (error: unknown) => {
        reject(
          error instanceof ProcessScopeError
            ? error
            : new ProcessScopeError(
                'activation-failed',
                'macOS best-effort scope leader failed to start.',
                { cause: error },
                'activate'
              )
        );
      };
      child.once('error', fail);
      child.once('spawn', () => {
        child.removeListener('error', fail);
        const leaderPid = child.pid;
        if (
          typeof leaderPid !== 'number' ||
          !child.stdin ||
          !child.stdout ||
          !child.stderr
        ) {
          child.kill('SIGKILL');
          fail(
            new ProcessScopeError(
              'activation-failed',
              'macOS best-effort scope leader exposed no group id or no stdio.',
              undefined,
              'activate'
            )
          );
          return;
        }
        state.child = child;
        state.groupId = leaderPid;
        state.phase = 'live';
        child.once('exit', (code, signal) => {
          // Exactly one of code / signal is meaningful, reported distinctly
          // from any emptiness statement.
          state.rootExit = {
            state: 'root-exited',
            code: signal === null ? code : null,
            signal: signal ?? null,
          };
          if (state.phase === 'live') state.phase = 'root-exited';
          resolveRootExit(state.rootExit);
          watchNaturalCompletion(state);
        });
        resolve({
          ref: state.ref,
          displayPid: leaderPid,
          stdin: child.stdin as Writable,
          stdout: child.stdout as Readable,
          stderr: child.stderr as Readable,
          rootExited,
          closed: state.closed,
        });
      });
    });
  }

  return {
    async prepare(input): Promise<PreparedProcessScope> {
      if (input.signal?.aborted) {
        throw new ProcessScopeError(
          'containment-prepare-failed',
          'macOS best-effort scope preparation was cancelled.',
          undefined,
          'prepare'
        );
      }
      if (!path.isAbsolute(input.command)) {
        // Refused before any process exists; the tier never resolves PATH.
        throw new ProcessScopeError(
          'containment-prepare-failed',
          'macOS best-effort scope requires a server-resolved absolute command.',
          undefined,
          'prepare'
        );
      }
      const ref = asProcessRef(
        `rasen-process-scope/1:${randomBytes(24).toString('base64url')}`
      );
      let settle!: (value: DeclaredUnprovenReceipt) => void;
      const closed = new Promise<DeclaredUnprovenReceipt>((resolve) => {
        settle = resolve;
      });
      void closed.catch(() => undefined);
      const state: ScopeState = {
        ref,
        input,
        phase: 'prepared',
        closed,
        settleTerminal(receipt) {
          if (state.terminal) return;
          state.terminal = receipt;
          state.phase = 'terminal';
          settle(receipt);
        },
      };
      scopes.set(ref, state);
      return {
        ref,
        declaration: DARWIN_BEST_EFFORT_DECLARATION,
        async activate(): Promise<LiveProcessScope> {
          if (state.phase !== 'prepared') {
            throw new ProcessScopeError(
              'activation-failed',
              'ProcessScope activation is exactly once.',
              undefined,
              'activate'
            );
          }
          return withPhaseDeadline('activate', controlTimeoutMs, activateChild(state));
        },
        async abort(reason): Promise<TerminationReceipt> {
          if (state.terminal) return terminationFrom(state.terminal);
          if (state.phase === 'prepared') {
            // Nothing was created, so nothing is signalled.
            const receipt = unprovenReceipt('never-activated', {
              groupObservedEmpty: false,
              forced: false,
              diagnostic: 'no workload ran',
            });
            state.settleTerminal(receipt);
            return terminationFrom(receipt);
          }
          return terminationFrom(await cancel(state, { reason, graceMs: 0 }));
        },
      };
    },

    async inspect(ref): Promise<ProcessObservation> {
      const state = scopes.get(ref);
      // A ref minted by a previous daemon lifetime is absent here. It is
      // reported foreign and no signal is ever derived from it.
      if (!state) return { state: 'foreign', controllable: false };
      if (state.terminal) {
        return { state: 'declared-unproven', controllable: false, terminal: state.terminal };
      }
      if (state.phase === 'prepared') return { state: 'prepared', controllable: true };
      if (state.phase === 'root-exited') return { state: 'root-exited', controllable: true };
      return { state: 'live', controllable: true };
    },

    async terminate(ref, intent): Promise<TerminationReceipt> {
      const state = scopes.get(ref);
      if (!state) {
        return {
          state: 'uncertain',
          gracefulAttempted: false,
          forced: false,
          diagnostic: 'process identity is foreign to this daemon lifetime',
        };
      }
      if (state.terminal) return terminationFrom(state.terminal);
      if (state.phase === 'prepared') {
        const receipt = unprovenReceipt('never-activated', {
          groupObservedEmpty: false,
          forced: false,
          diagnostic: 'no workload ran',
        });
        state.settleTerminal(receipt);
        return terminationFrom(receipt);
      }
      const budgetMs = Math.max(0, intent.graceMs) + finalObservationMs + controlTimeoutMs;
      try {
        return terminationFrom(
          await withPhaseDeadline('terminate', budgetMs, cancel(state, intent))
        );
      } catch (error) {
        if (error instanceof ProcessScopeError && error.code === 'process-control-timeout') {
          return timeoutReceipt('terminate', error.message);
        }
        throw error;
      }
    },
  };
}
