import type { AgentRuntimeSandbox } from '../pipeline-registry/types.js';
import type { RunStateWorker } from '../pipeline-registry/run-state.js';
import type { ClaudeReasoningEffort } from './invocation.js';

export interface BuildClaudeWorkerRecordOptions {
  sessionId: string;
  cwd: string;
  role?: string;
  model?: string;
  sandbox?: AgentRuntimeSandbox;
  effort?: ClaudeReasoningEffort;
  transcript?: string;
}

export function buildClaudeWorkerRecord(
  options: BuildClaudeWorkerRecordOptions
): RunStateWorker {
  return {
    runtime: 'claude',
    dispatchMode: 'exec-bridge',
    sessionId: options.sessionId,
    cwd: options.cwd,
    ...(options.role ? { role: options.role } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.transcript ? { transcript: options.transcript } : {}),
    updatedAt: new Date().toISOString(),
  };
}
