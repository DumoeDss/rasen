import type {
  AgentTurnInputCandidate,
  ChangeRunReceipt,
  ExactChangeRunRef,
  RunAction,
} from '../../src/core/change-run/contracts.js';
import type {
  ChangePipelineRuntime,
  StartChangePipeline,
} from '../../src/core/change-run/facade.js';

function trustedTestTurnInput(candidate: AgentTurnInputCandidate): string {
  return [
    'rasen trusted test driver turn input',
    `candidate=${candidate.candidateId}`,
    `run=${candidate.runId}`,
    `recordVersion=${candidate.recordVersion}`,
    `node=${candidate.nodeId}`,
    `occurrence=${candidate.occurrence}`,
    `profile=${candidate.profilePath ?? ''}`,
    `input=${JSON.stringify(candidate.input ?? null)}`,
  ].join('\n');
}

export async function admitPreviewedCandidates(
  runtime: ChangePipelineRuntime,
  ref: ExactChangeRunRef,
  preview: ChangeRunReceipt,
  render: (candidate: AgentTurnInputCandidate) => string = trustedTestTurnInput
): Promise<ChangeRunReceipt> {
  if (preview.actions.length > 0 || preview.candidates.length === 0) return preview;

  const pending = new Map(
    preview.candidates.map((candidate) => [candidate.candidateId, candidate] as const)
  );
  if (pending.size !== preview.candidates.length) {
    throw new Error('trusted test driver received duplicate candidate identities');
  }

  return runtime.admit(ref, {
    deliveryMode: 'grant',
    resolveAgentTurnInput: (candidate) => {
      const exact = pending.get(candidate.candidateId);
      if (exact === undefined || JSON.stringify(exact) !== JSON.stringify(candidate)) {
        throw new Error(`trusted test driver received an unpreviewed candidate: ${candidate.candidateId}`);
      }
      pending.delete(candidate.candidateId);
      return render(exact);
    },
    finalizeAgentTurnInputs: () => {
      if (pending.size !== 0) {
        throw new Error(
          `trusted test driver manifest contains unused candidates: ${[...pending.keys()].join(', ')}`
        );
      }
    },
  });
}

/**
 * Canonical in-process stand-in for the trusted pipeline driver. Runtime
 * mutations still preview first; only exact returned candidates are admitted.
 */
export function createAdmittingChangePipelineDriver(
  runtime: ChangePipelineRuntime,
  render: (candidate: AgentTurnInputCandidate) => string = trustedTestTurnInput
): ChangePipelineRuntime {
  const admitFrom = async (
    ref: ExactChangeRunRef,
    preview: Promise<ChangeRunReceipt>
  ): Promise<ChangeRunReceipt> =>
    admitPreviewedCandidates(runtime, ref, await preview, render);

  return {
    // Spread first so every runtime method the facade grows (consultation
    // settlement, teacher failure, ...) is forwarded unchanged; only the
    // mutations that can preview candidates are wrapped below.
    ...runtime,
    start: async (request: StartChangePipeline, context) => {
      const preview = runtime.start(request, context);
      const receipt = await preview;
      return admitPreviewedCandidates(
        runtime,
        { change: request.change, runId: receipt.view.runId },
        receipt,
        render
      );
    },
    resume: (request, context) => admitFrom(request, runtime.resume(request, context)),
    admit: (request, context) => runtime.admit(request, context),
    complete: (request, context) =>
      admitFrom(
        { change: request.change, runId: request.runId },
        runtime.complete(request, context)
      ),
    inspect: (ref) => runtime.inspect(ref),
    control: (request, context) =>
      admitFrom(request.ref, runtime.control(request, context)),
  };
}

export function oneGrantedAction(receipt: ChangeRunReceipt): RunAction {
  if (receipt.actions.length !== 1) {
    throw new Error(`trusted test driver expected one granted Action, got ${receipt.actions.length}`);
  }
  return receipt.actions[0]!;
}
