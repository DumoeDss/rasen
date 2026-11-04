import type { Readable, Writable } from 'node:stream';

import {
  ProcessScopeError,
  type BackendRootExit,
  type LiveProcessScope,
  type ProcessControlFailure,
  type ProcessControlPhase,
  type ProcessObservation,
  type ProcessRef,
  type ProcessScope,
  type ScopeEmptyReceipt,
  type TerminationReceipt,
} from '../process-scope.js';
import {
  createProcessAuthorityPublicationAcknowledgement,
  isExactScopeEmptyReceipt,
  type ProcessAuthorityCoordinator,
  type ProcessAuthorityLifecycleOutcome,
  type ProcessAuthorityPublicationAcknowledgement,
  type ProcessAuthorityPublicationBinding,
} from './coordinator.js';
import type {
  AuthorityOperationContext,
  AuthorityPrepareInput,
  ProcessAuthorityReference,
  ProcessAuthoritySelection,
} from './types.js';

export interface ProviderBackedProcessRuntime {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly rootExited: Promise<ProcessAuthorityLifecycleOutcome>;
  readonly exactScopeEmpty: Promise<ProcessAuthorityLifecycleOutcome>;
}

export interface ProviderBackedProcessScopeOptions {
  readonly coordinator: ProcessAuthorityCoordinator;
  readonly selection: ProcessAuthoritySelection;
  /** Must durably publish the exact reference before returning its acknowledgement. */
  readonly publishAuthority: (
    binding: ProcessAuthorityPublicationBinding,
    context: AuthorityOperationContext
  ) => Promise<ProcessAuthorityPublicationAcknowledgement>;
  /** Supplies only transport streams and common outcomes; it receives no provider-private fields. */
  readonly openRuntime: (reference: ProcessAuthorityReference) => ProviderBackedProcessRuntime;
}

function asAuthorityReference(ref: ProcessRef): ProcessAuthorityReference | undefined {
  const value = String(ref);
  return value.startsWith('rasen-process-authority/1:')
    ? value as ProcessAuthorityReference
    : undefined;
}

function controlFailure(
  outcome: ProcessAuthorityLifecycleOutcome
): ProcessControlFailure | undefined {
  const legacyPhase = (phase: import('./types.js').AuthorityOperationPhase | undefined): ProcessControlPhase => {
    if (phase === 'publish') return 'prepare';
    if (phase === 'exact-empty-observation') return 'scope-empty';
    return phase ?? 'inspect';
  };
  if (outcome.state === 'timeout') {
    return { code: 'process-control-timeout', phase: legacyPhase(outcome.phase) };
  }
  if (outcome.state === 'control-loss') {
    return { code: 'process-control-lost', phase: legacyPhase(outcome.phase) };
  }
  return undefined;
}

function retainedDiagnostic(outcome: ProcessAuthorityLifecycleOutcome): string {
  return 'diagnostic' in outcome
    ? outcome.diagnostic
    : `Process authority remains retained in ${outcome.state}.`;
}

export function mapProcessAuthorityObservation(
  outcome: ProcessAuthorityLifecycleOutcome
): ProcessObservation {
  if (outcome.state === 'live') return { state: 'live', controllable: true };
  if (outcome.state === 'root-exited') return { state: 'root-exited', controllable: true };
  if (outcome.state === 'prepared-inert' || outcome.state === 'published-inert') {
    return { state: 'prepared', controllable: true };
  }
  if (isExactScopeEmptyReceipt(outcome)) {
    return {
      state: 'closed',
      controllable: false,
      exactScopeEmptyReceipt: outcome,
    };
  }
  if (outcome.state === 'ordering-conflict') {
    return { state: 'uncertain', controllable: false, diagnostic: outcome.diagnostic };
  }
  return {
    state: 'uncertain',
    controllable: false,
    diagnostic: retainedDiagnostic(outcome),
    ...(controlFailure(outcome) ? { failure: controlFailure(outcome) } : {}),
  };
}

export function mapProcessAuthorityControlOutcome(
  outcome: ProcessAuthorityLifecycleOutcome,
  gracefulAttempted: boolean
): TerminationReceipt {
  if (isExactScopeEmptyReceipt(outcome)) {
    return {
      state: 'closed',
      gracefulAttempted,
      forced: true,
      exactScopeEmptyReceipt: outcome,
    };
  }
  if (outcome.state === 'live' || outcome.state === 'root-exited') {
    return {
      state: 'retained',
      gracefulAttempted,
      forced: false,
      diagnostic: `Process authority remains ${outcome.state}.`,
    };
  }
  return {
    state: 'uncertain',
    gracefulAttempted,
    forced: false,
    diagnostic: retainedDiagnostic(outcome),
    ...(controlFailure(outcome) ? { failure: controlFailure(outcome) } : {}),
  };
}

function authorityError(
  code: ConstructorParameters<typeof ProcessScopeError>[0],
  outcome: ProcessAuthorityLifecycleOutcome | { readonly diagnostic: string }
): ProcessScopeError {
  return new ProcessScopeError(code, retainedDiagnostic(outcome as ProcessAuthorityLifecycleOutcome));
}

function disposeRuntimeBridge(runtime: ProviderBackedProcessRuntime): void {
  for (const stream of [runtime.stdin, runtime.stdout, runtime.stderr]) {
    try {
      stream.destroy();
    } catch {
      // Runtime disposal is best-effort after exact authority reconciliation.
    }
  }
}

export function createProviderBackedProcessScope(
  options: ProviderBackedProcessScopeOptions
): ProcessScope {
  const scope: ProcessScope = {
    async prepare(input) {
      const authorityInput: AuthorityPrepareInput = {
        command: input.command,
        args: [...input.args],
        cwd: input.cwd,
        env: { ...input.env },
        ...(input.windowsVerbatimArguments === undefined
          ? {}
          : { windowsVerbatimArguments: input.windowsVerbatimArguments }),
      };
      const prepared = await options.coordinator.prepare(
        options.selection,
        authorityInput,
        input.signal
      );
      if (prepared.state !== 'prepared-inert') {
        if (prepared.state === 'timeout' || prepared.state === 'control-loss') {
          throw new ProcessScopeError(
            prepared.state === 'timeout' ? 'process-control-timeout' : 'process-control-lost',
            prepared.diagnostic,
            undefined,
            'prepare'
          );
        }
        throw new ProcessScopeError('containment-unsupported', prepared.diagnostic);
      }
      const ref = prepared.reference as unknown as ProcessRef;
      let activated = false;
      return Object.freeze({
        ref,
        async activate(): Promise<LiveProcessScope> {
          if (activated) {
            throw new ProcessScopeError('activation-failed', 'Provider-backed ProcessScope activation is exactly once.');
          }
          activated = true;
          const published = await prepared.publish(options.publishAuthority);
          if (published.state !== 'published-inert') {
            throw authorityError('authority-persist-failed', published);
          }
          await input.onExactAuthorityPhase?.('authority-published-inert', ref);
          let runtime: ProviderBackedProcessRuntime;
          try {
            runtime = options.openRuntime(prepared.reference);
            if (
              !runtime ||
              typeof runtime !== 'object' ||
              !runtime.stdin ||
              !runtime.stdout ||
              !runtime.stderr ||
              !runtime.rootExited ||
              typeof runtime.rootExited.then !== 'function' ||
              !runtime.exactScopeEmpty ||
              typeof runtime.exactScopeEmpty.then !== 'function'
            ) {
              throw new TypeError('Provider-backed runtime bridge is malformed.');
            }
          } catch (error) {
            const aborted = await published.abort('runtime-bridge-open-failed');
            throw new ProcessScopeError(
              isExactScopeEmptyReceipt(aborted)
                ? 'activation-failed'
                : 'process-authority-uncertain',
              isExactScopeEmptyReceipt(aborted)
                ? 'Provider-backed runtime bridge could not be opened before activation.'
                : retainedDiagnostic(aborted),
              { cause: error }
            );
          }
          const activation = await published.activate();
          if (activation.state !== 'live' && activation.state !== 'root-exited') {
            const reconciled = await options.coordinator.terminate(prepared.reference, {
              reason: 'activation-failed-reconciliation',
              graceMs: 0,
            });
            disposeRuntimeBridge(runtime);
            if (isExactScopeEmptyReceipt(reconciled)) {
              throw authorityError('activation-failed', activation);
            }
            throw authorityError('process-authority-uncertain', reconciled);
          }
          await input.onExactAuthorityPhase?.('activated', ref);
          const rootExited = activation.state === 'root-exited'
            ? Promise.resolve<BackendRootExit>({
                state: 'root-exited',
                code: activation.code,
                signal: activation.signal,
              })
            : runtime.rootExited.then((outcome): BackendRootExit => {
                if (outcome.state !== 'root-exited') {
                  throw authorityError('process-authority-uncertain', outcome);
                }
                return { state: 'root-exited', code: outcome.code, signal: outcome.signal };
              });
          const closed = runtime.exactScopeEmpty.then(async (outcome): Promise<ScopeEmptyReceipt> => {
            // A runtime frame is only a wakeup. It is deliberately unable to
            // mint the coordinator's WeakSet-backed authority receipt.
            if (outcome.state !== 'exact-scope-empty') {
              throw authorityError('process-termination-unobserved', outcome);
            }
            const authenticated = await options.coordinator.inspect(prepared.reference);
            if (!isExactScopeEmptyReceipt(authenticated)) {
              throw authorityError('process-termination-unobserved', authenticated);
            }
            return { state: 'scope-empty', exactScopeEmptyReceipt: authenticated };
          });
          return Object.freeze({
            ref,
            stdin: runtime.stdin,
            stdout: runtime.stdout,
            stderr: runtime.stderr,
            rootExited,
            closed,
          });
        },
        async abort(reason: string) {
          return mapProcessAuthorityControlOutcome(await prepared.abort(reason), false);
        },
      });
    },

    async inspect(ref) {
      const reference = asAuthorityReference(ref);
      if (!reference) {
        return {
          state: 'uncertain',
          controllable: false,
          diagnostic: 'Legacy ProcessScope authority is not promoted by the provider adapter.',
        };
      }
      return mapProcessAuthorityObservation(await options.coordinator.inspect(reference));
    },

    async terminate(ref, intent) {
      const reference = asAuthorityReference(ref);
      if (!reference) {
        return {
          state: 'uncertain',
          gracefulAttempted: false,
          forced: false,
          diagnostic: 'Legacy ProcessScope authority is not promoted by the provider adapter.',
        };
      }
      return mapProcessAuthorityControlOutcome(
        await options.coordinator.terminate(reference, intent),
        true
      );
    },
  };
  return Object.freeze(scope);
}

/** Convenience for trusted hosts that have just durably written the exact binding. */
export function acknowledgePublishedProcessAuthority(
  binding: ProcessAuthorityPublicationBinding
): ProcessAuthorityPublicationAcknowledgement {
  return createProcessAuthorityPublicationAcknowledgement(binding);
}
