/**
 * Codex run-state worker identity.
 *
 * Builds a record satisfying the existing `RunStateWorkerSchema`
 * (`src/core/pipeline-registry/run-state.ts`) — no schema change was needed
 * (design D9): `runtime: 'codex'` already exists, and the rollout JSONL path
 * is recorded in the existing `transcript` field, whose documented semantics
 * ("the durable cross-session pointer to the worker's persisted
 * conversation") match a rollout path exactly. `turnId` is left unset in exec
 * mode — bare codex-cli {@link CODEX_CLI_VERSION_PREMISE} `codex exec --json`
 * events carry no turn id (`docs/codex-parity/solutions/14`), and recording a
 * stale rollout-derived one would imply a precision exec mode does not have.
 *
 * `effort` is typed as {@link CodexReasoningEffort} and run through the same
 * {@link clampLeafEffort} the builder applies, so a record can never claim an
 * effort (`ultra`) that no leaf dispatch actually ran with — a caller cannot
 * accidentally poison run-state with a value the dispatch itself would have
 * clamped away.
 */
import type { CODEX_CLI_VERSION_PREMISE } from './codex-home.js';
import { clampLeafEffort, type CodexReasoningEffort } from './invocation.js';
import type { AgentRuntimeSandbox } from '../pipeline-registry/types.js';
import type { RunStateWorker } from '../pipeline-registry/run-state.js';

export interface BuildCodexWorkerRecordOptions {
  threadId: string;
  model: string;
  sandbox: AgentRuntimeSandbox;
  effort: CodexReasoningEffort;
  /** Rollout JSONL path, if known — recorded in the record's `transcript` pointer. */
  rolloutPath?: string;
  role?: string;
}

/**
 * Build a `runtime: 'codex'` run-state worker record from a completed
 * dispatch. Conforms to `RunStateWorkerSchema`; `turnId` is never set.
 */
export function buildCodexWorkerRecord(options: BuildCodexWorkerRecordOptions): RunStateWorker {
  const { effort } = clampLeafEffort(options.effort);
  const record: RunStateWorker = {
    runtime: 'codex',
    threadId: options.threadId,
    model: options.model,
    sandbox: options.sandbox,
    effort,
    updatedAt: new Date().toISOString(),
  };
  if (options.rolloutPath) record.transcript = options.rolloutPath;
  if (options.role) record.role = options.role;
  return record;
}
