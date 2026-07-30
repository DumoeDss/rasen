import {
  parseWorkerContractValue,
  type WorkerContract,
  type WorkerContractResult,
} from '../worker-contracts.js';

export type ClaudeDispatchFailureKind =
  | 'invalid-input'
  | 'runtime-unavailable'
  | 'spawn-failed'
  | 'session-busy'
  | 'resume-cwd-mismatch'
  | 'timeout'
  | 'output-limit'
  | 'nonzero-exit'
  | 'invalid-json'
  | 'claude-error-result'
  | 'structured-output-missing'
  | 'contract-invalid';

export interface ClaudeSuccessReceipt {
  ok: true;
  runtime: 'claude';
  dispatchMode: 'exec-bridge';
  bridge: 'claude-print';
  contract: WorkerContract;
  sessionId: string;
  cwd: string;
  result: WorkerContractResult;
}

export interface ClaudeFailureReceipt {
  ok: false;
  runtime: 'claude';
  dispatchMode: 'exec-bridge';
  bridge: 'claude-print';
  contract: WorkerContract;
  failure: {
    kind: ClaudeDispatchFailureKind;
    message: string;
  };
  sessionId?: string;
  cwd?: string;
  diagnostics?: {
    exitCode?: number;
    signal?: string;
    stdout?: string;
    stderr?: string;
    result?: string;
    errors?: string;
  };
}

export type ClaudeDispatchReceipt = ClaudeSuccessReceipt | ClaudeFailureReceipt;

interface ClaudeResultEnvelope {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  session_id?: unknown;
  structured_output?: unknown;
  result?: unknown;
  errors?: unknown;
}

const DIAGNOSTIC_LIMIT_BYTES = 8 * 1024;
const REDACTED = '<redacted>';
const STRUCTURED_DIAGNOSTIC_DEPTH = 8;
const STRUCTURED_DIAGNOSTIC_ENTRIES = 100;
const SENSITIVE_KEY =
  /api.?key|authorization|cookie|credential|password|passwd|private.?key|secret|token/i;

function redactDiagnosticString(value: string): string {
  return value
    .replace(
      /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
      `$1 ${REDACTED}`
    )
    .replace(
      /\b(api[_ -]?key|authorization|cookie|credential|password|passwd|private[_ -]?key|secret|token)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      `$1$2${REDACTED}`
    )
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(
      /\b(https?:\/\/)[^/\s@]+@/gi,
      `$1${REDACTED}@`
    );
}

function redactDiagnosticValue(
  value: unknown,
  key?: string,
  depth = 0
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactDiagnosticString(value);
  if (depth >= STRUCTURED_DIAGNOSTIC_DEPTH) return '<truncated>';
  if (Array.isArray(value)) {
    return value
      .slice(0, STRUCTURED_DIAGNOSTIC_ENTRIES)
      .map((item) => redactDiagnosticValue(item, undefined, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, STRUCTURED_DIAGNOSTIC_ENTRIES)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactDiagnosticValue(entryValue, entryKey, depth + 1),
        ])
    );
  }
  return value;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;

  const marker = '…<truncated>';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const contentLimit = Math.max(0, maxBytes - markerBytes);
  let end = contentLimit;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${encoded.subarray(0, end).toString('utf8')}${marker}`;
}

export function sanitizeClaudeDiagnostic(
  value: unknown,
  maxBytes = DIAGNOSTIC_LIMIT_BYTES
): string {
  const redacted = redactDiagnosticValue(value);
  const rendered =
    typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return truncateUtf8(rendered ?? String(redacted), maxBytes);
}

function envelopeDiagnostics(
  envelope: ClaudeResultEnvelope
): ClaudeFailureReceipt['diagnostics'] | undefined {
  const hasResult = Object.prototype.hasOwnProperty.call(envelope, 'result');
  const hasErrors = Object.prototype.hasOwnProperty.call(envelope, 'errors');
  if (!hasResult && !hasErrors) return undefined;

  const result = hasResult
    ? sanitizeClaudeDiagnostic(envelope.result, DIAGNOSTIC_LIMIT_BYTES / 2)
    : undefined;
  const errors = hasErrors
    ? sanitizeClaudeDiagnostic(envelope.errors, DIAGNOSTIC_LIMIT_BYTES / 2)
    : undefined;
  return {
    ...(result ? { result } : {}),
    ...(errors ? { errors } : {}),
  };
}

function failure(
  contract: WorkerContract,
  kind: ClaudeDispatchFailureKind,
  message: string,
  options: {
    sessionId?: string;
    cwd?: string;
    diagnostics?: ClaudeFailureReceipt['diagnostics'];
  } = {}
): ClaudeFailureReceipt {
  return {
    ok: false,
    runtime: 'claude',
    dispatchMode: 'exec-bridge',
    bridge: 'claude-print',
    contract,
    failure: { kind, message },
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  };
}

/** Parse exactly one Claude `--output-format json` result envelope. */
export function parseClaudeResultEnvelope(
  stdout: string,
  contract: WorkerContract,
  cwd: string
): ClaudeDispatchReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    return failure(
      contract,
      'invalid-json',
      `Claude stdout was not one valid JSON result envelope: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cwd }
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failure(contract, 'invalid-json', 'Claude result envelope must be a JSON object.', {
      cwd,
    });
  }

  const envelope = parsed as ClaudeResultEnvelope;
  const sessionId =
    typeof envelope.session_id === 'string' && envelope.session_id.trim()
      ? envelope.session_id
      : undefined;
  if (
    envelope.type !== 'result' ||
    envelope.subtype !== 'success' ||
    envelope.is_error !== false
  ) {
    const diagnostics = envelopeDiagnostics(envelope);
    return failure(
      contract,
      'claude-error-result',
      `Claude returned a non-success result envelope (type=${String(
        envelope.type
      )}, subtype=${String(envelope.subtype)}, is_error=${String(envelope.is_error)}).`,
      {
        cwd,
        ...(sessionId ? { sessionId } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      }
    );
  }
  if (!sessionId) {
    return failure(
      contract,
      'claude-error-result',
      'Claude success result omitted a non-empty session_id.',
      { cwd }
    );
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'structured_output')) {
    return failure(
      contract,
      'structured-output-missing',
      'Claude success result omitted structured_output; result prose is not authoritative.',
      { cwd, sessionId }
    );
  }
  try {
    const result = parseWorkerContractValue(contract, envelope.structured_output);
    return {
      ok: true,
      runtime: 'claude',
      dispatchMode: 'exec-bridge',
      bridge: 'claude-print',
      contract,
      sessionId,
      cwd,
      result,
    };
  } catch (error) {
    return failure(
      contract,
      'contract-invalid',
      error instanceof Error ? error.message : String(error),
      { cwd, sessionId }
    );
  }
}

export function claudeFailureReceipt(
  contract: WorkerContract,
  kind: ClaudeDispatchFailureKind,
  message: string,
  options?: Parameters<typeof failure>[3]
): ClaudeFailureReceipt {
  return failure(contract, kind, message, options);
}
