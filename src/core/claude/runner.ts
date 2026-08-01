import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { FileSystemUtils } from '../../utils/file-system.js';
import { spawnAgentCli } from '../agent-cli-process.js';
import { killProcessTree } from '../management-api/kill-tree.js';
import type { WorkerContract } from '../worker-contracts.js';
import type { ClaudePrintInvocation } from './invocation.js';
import {
  claudeFailureReceipt,
  parseClaudeResultEnvelope,
  sanitizeClaudeDiagnostic,
  type ClaudeDispatchReceipt,
} from './result.js';
import {
  bindClaudeSessionCwd,
  claimClaudeSessionWriter,
  ClaudeSessionBusyError,
  ClaudeSessionCwdMismatchError,
  ClaudeSessionStateError,
  type ClaudeSessionStateOptions,
  type ClaudeSessionWriterClaim,
} from './session-state.js';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;

export interface RunClaudePrintOptions {
  binary: string;
  invocation: ClaudePrintInvocation;
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnAgentCli;
  sessionStateDir?: string;
}

class BoundedUtf8Capture {
  private readonly decoder = new StringDecoder('utf8');
  private value = '';
  private capturedBytes = 0;
  private ended = false;
  exceeded = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    const remaining = Math.max(0, this.maxBytes - this.capturedBytes);
    const accepted = bytes.subarray(0, remaining);
    this.capturedBytes += accepted.length;
    this.value += this.decoder.write(accepted);
    if (accepted.length < bytes.length) this.exceeded = true;
  }

  finish(): string {
    if (!this.ended) {
      this.ended = true;
      this.value += this.decoder.end();
    }
    return this.value;
  }
}

function diagnostics(
  stdout: string,
  stderr: string,
  exitCode?: number | null,
  signal?: NodeJS.Signals | null
) {
  return {
    ...(typeof exitCode === 'number' ? { exitCode } : {}),
    ...(signal ? { signal } : {}),
    ...(stdout ? { stdout: sanitizeClaudeDiagnostic(stdout) } : {}),
    ...(stderr ? { stderr: sanitizeClaudeDiagnostic(stderr) } : {}),
  };
}

function sessionFailureReceipt(
  contract: WorkerContract,
  error: unknown,
  sessionId: string,
  cwd: string
): ClaudeDispatchReceipt {
  if (error instanceof ClaudeSessionBusyError) {
    return claudeFailureReceipt(contract, 'session-busy', error.message, {
      sessionId,
      cwd,
    });
  }
  if (error instanceof ClaudeSessionCwdMismatchError) {
    return claudeFailureReceipt(contract, 'resume-cwd-mismatch', error.message, {
      sessionId,
      cwd,
      diagnostics: { result: `recorded cwd: ${error.recordedCwd}` },
    });
  }
  return claudeFailureReceipt(
    contract,
    'spawn-failed',
    error instanceof ClaudeSessionStateError || error instanceof Error
      ? error.message
      : String(error),
    { sessionId, cwd }
  );
}

/**
 * Run one Claude print-mode turn, bound its process/output, then parse exactly
 * one structured result envelope.
 */
export async function runClaudePrint(
  options: RunClaudePrintOptions
): Promise<ClaudeDispatchReceipt> {
  const {
    binary,
    invocation,
    cwd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
  } = options;
  const canonicalCwd = FileSystemUtils.canonicalizeExistingPath(cwd);
  const contract: WorkerContract = invocation.contract;
  const resumeId = invocation.args.includes('--resume')
    ? invocation.args[invocation.args.indexOf('--resume') + 1]
    : undefined;
  const sessionState: ClaudeSessionStateOptions = {
    env: options.env ?? process.env,
    ...(options.sessionStateDir ? { stateDir: options.sessionStateDir } : {}),
  };

  let writerClaim: ClaudeSessionWriterClaim | undefined;
  if (resumeId) {
    try {
      writerClaim = await claimClaudeSessionWriter(
        resumeId,
        canonicalCwd,
        sessionState
      );
    } catch (error) {
      return sessionFailureReceipt(
        contract,
        error,
        resumeId,
        canonicalCwd
      );
    }
  }

  return new Promise((resolve) => {
    let child: ChildProcess;
    const stdoutCapture = new BoundedUtf8Capture(maxOutputBytes);
    const stderrCapture = new BoundedUtf8Capture(maxOutputBytes);
    let outputExceeded = false;
    let timedOut = false;
    let settled = false;
    let killCancel: (() => void) | undefined;
    let timer: NodeJS.Timeout | undefined;

    const finish = async (receipt: ClaudeDispatchReceipt) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      killCancel?.();
      await writerClaim?.release();

      if (receipt.ok && !resumeId) {
        try {
          await bindClaudeSessionCwd(
            receipt.sessionId,
            receipt.cwd,
            sessionState
          );
        } catch (error) {
          resolve(
            sessionFailureReceipt(
              contract,
              error,
              receipt.sessionId,
              receipt.cwd
            )
          );
          return;
        }
      }
      resolve(receipt);
    };

    const terminate = (cancellable = true) => {
      if (typeof child?.pid === 'number') {
        const treeKill = killProcessTree(child.pid, { graceMs: 250 });
        if (cancellable) killCancel = treeKill.cancel;
      }
    };

    try {
      child = (options.spawn ?? spawnAgentCli)(binary, invocation.args, {
        cwd: canonicalCwd,
        env: options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      void finish(
        claudeFailureReceipt(
          contract,
          'spawn-failed',
          error instanceof Error ? error.message : String(error),
          {
            ...(resumeId ? { sessionId: resumeId } : {}),
            cwd: canonicalCwd,
          }
        )
      );
      return;
    }

    try {
      if (writerClaim) {
        if (typeof child.pid !== 'number') {
          throw new ClaudeSessionStateError(
            'Claude worker did not expose a process-tree root PID.'
          );
        }
        // Publish the actual worker/process-tree root before releasing the
        // prompt. If the bridge dies after this point, a later process sees
        // the surviving tree and cannot reclaim the exact session.
        writerClaim.bindWorker(child.pid);
      }
      if (!child.stdin) {
        throw new Error(
          'Claude CLI stdin is not writable; spawn with stdin set to pipe.'
        );
      }
      child.stdin.end(invocation.stdin);
    } catch (error) {
      // No prompt was intentionally released when worker binding failed.
      // Keep the forced tree-kill armed even after resolving the receipt.
      child.stdin?.destroy();
      child.stdout?.resume();
      child.stderr?.resume();
      child.on('error', () => undefined);
      terminate(false);
      void finish(
        resumeId
          ? sessionFailureReceipt(
              contract,
              error,
              resumeId,
              canonicalCwd
            )
          : claudeFailureReceipt(
              contract,
              'spawn-failed',
              error instanceof Error ? error.message : String(error),
              { cwd: canonicalCwd }
            )
      );
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutCapture.append(chunk);
      if (stdoutCapture.exceeded && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrCapture.append(chunk);
      if (stderrCapture.exceeded && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
    });
    child.on('error', (error) => {
      const stdout = stdoutCapture.finish();
      const stderr = stderrCapture.finish();
      void finish(
        claudeFailureReceipt(
          contract,
          'spawn-failed',
          error.message,
          {
            ...(resumeId ? { sessionId: resumeId } : {}),
            cwd: canonicalCwd,
            diagnostics: diagnostics(stdout, stderr),
          }
        )
      );
    });
    child.on('close', (code, signal) => {
      const stdout = stdoutCapture.finish();
      const stderr = stderrCapture.finish();
      if (timedOut) {
        void finish(
          claudeFailureReceipt(
            contract,
            'timeout',
            `Claude worker exceeded the ${timeoutMs}ms timeout.`,
            {
              ...(resumeId ? { sessionId: resumeId } : {}),
              cwd: canonicalCwd,
              diagnostics: diagnostics(stdout, stderr, code, signal),
            }
          )
        );
        return;
      }
      if (outputExceeded) {
        void finish(
          claudeFailureReceipt(
            contract,
            'output-limit',
            `Claude worker output exceeded the ${maxOutputBytes}-byte capture limit.`,
            {
              ...(resumeId ? { sessionId: resumeId } : {}),
              cwd: canonicalCwd,
              diagnostics: diagnostics(stdout, stderr, code, signal),
            }
          )
        );
        return;
      }
      if (code !== 0) {
        void finish(
          claudeFailureReceipt(
            contract,
            'nonzero-exit',
            `Claude worker exited with code ${String(code)}${signal ? ` (${signal})` : ''}.`,
            {
              ...(resumeId ? { sessionId: resumeId } : {}),
              cwd: canonicalCwd,
              diagnostics: diagnostics(stdout, stderr, code, signal),
            }
          )
        );
        return;
      }
      const receipt = parseClaudeResultEnvelope(stdout, contract, canonicalCwd);
      if (!receipt.ok && stderr) {
        receipt.diagnostics = {
          ...(receipt.diagnostics ?? {}),
          stderr: sanitizeClaudeDiagnostic(stderr),
        };
      }
      void finish(receipt);
    });
  });
}
