import { sanitizeAgentDiagnostic } from '../agent-diagnostics.js';
import {
  parseWorkerContractValue,
  type WorkerContract,
  type WorkerContractResult,
} from '../worker-contracts.js';
import type { CodexSandboxMode } from './invocation.js';
import type { LeafEffort } from '../pipeline-registry/types.js';

export type CodexDispatchFailureKind =
  | 'invalid-input'
  | 'runtime-unavailable'
  | 'spawn-failed'
  | 'thread-busy'
  | 'resume-cwd-mismatch'
  | 'timeout'
  | 'output-limit'
  | 'nonzero-exit'
  | 'thread-id-missing'
  | 'thread-id-mismatch'
  | 'last-message-missing'
  | 'last-message-invalid'
  | 'contract-invalid';

export interface CodexReceiptMetadata {
  threadId?: string;
  cwd?: string;
  sandbox?: CodexSandboxMode;
  model?: string;
  effort?: LeafEffort;
  warnings?: string[];
  transcript?: string;
}

export interface CodexSuccessReceipt extends CodexReceiptMetadata {
  ok: true;
  runtime: 'codex';
  dispatchMode: 'exec-bridge';
  bridge: 'codex-exec';
  contract: WorkerContract;
  threadId: string;
  cwd: string;
  result: WorkerContractResult;
}

export interface CodexFailureReceipt extends CodexReceiptMetadata {
  ok: false;
  runtime: 'codex';
  dispatchMode: 'exec-bridge';
  bridge: 'codex-exec';
  contract: WorkerContract;
  failure: { kind: CodexDispatchFailureKind; message: string };
  diagnostics?: {
    exitCode?: number;
    signal?: string;
    stdout?: string;
    stderr?: string;
    lastMessage?: string;
    cleanup?: string;
  };
}

export type CodexDispatchReceipt = CodexSuccessReceipt | CodexFailureReceipt;

export function codexFailureReceipt(
  contract: WorkerContract,
  kind: CodexDispatchFailureKind,
  message: string,
  options: CodexReceiptMetadata & { diagnostics?: CodexFailureReceipt['diagnostics'] } = {}
): CodexFailureReceipt {
  return {
    ok: false,
    runtime: 'codex',
    dispatchMode: 'exec-bridge',
    bridge: 'codex-exec',
    contract,
    failure: { kind, message },
    ...options,
  };
}

export function parseCodexLastMessage(
  text: string,
  contract: WorkerContract,
  metadata: CodexReceiptMetadata & { threadId: string; cwd: string }
): CodexDispatchReceipt {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch (error) {
    return codexFailureReceipt(
      contract,
      'last-message-invalid',
      `Codex last message is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { ...metadata, diagnostics: { lastMessage: sanitizeAgentDiagnostic(text) } }
    );
  }
  try {
    return {
      ok: true,
      runtime: 'codex',
      dispatchMode: 'exec-bridge',
      bridge: 'codex-exec',
      contract,
      ...metadata,
      result: parseWorkerContractValue(contract, value),
    };
  } catch (error) {
    return codexFailureReceipt(
      contract,
      'contract-invalid',
      error instanceof Error ? error.message : String(error),
      { ...metadata, diagnostics: { lastMessage: sanitizeAgentDiagnostic(text) } }
    );
  }
}
